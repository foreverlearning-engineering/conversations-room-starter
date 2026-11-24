// Your first practice room: a small server that keeps the Conversations API key, and a page
// where a user rehearses a hard conversation. Node 24+, no packages. Start it with: npm start
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, appendFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  catalog, prepareRoom, sendOpening, sendTurn, playback, lookup, isConfigured,
  ConversationsError, type CastMember, type Turn, type TurnResult,
} from './conversations.ts';

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC = join(import.meta.dirname, 'public');
const RECEIPTS = join(import.meta.dirname, 'receipts.jsonl');

// The ready-made room this step uses, found in the catalog by its title.
const ROOM_TITLE = 'Direct Feedback To A Report';

// One practice session per user. A real app keeps this in its database.
interface Practice { sessionId: string; title: string; cast: CastMember[]; turns: Turn[]; openingReceipt?: TurnResult['receipt'] }
const practices = new Map<string, Practice>();
const starting = new Map<string, Promise<Practice>>();

const FILES: Record<string, string> = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' };
const TYPES: Record<string, string> = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8' };

// A pseudonymous user id kept in a cookie: never a name or an email.
function userId(request: IncomingMessage, response: ServerResponse): string {
  const match = /(?:^|;\s*)user=([A-Za-z0-9_-]{1,128})/.exec(request.headers.cookie ?? '');
  if (match) return match[1];
  const id = 'user-' + randomUUID();
  response.setHeader('Set-Cookie', 'user=' + id + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000');
  return id;
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 20000) throw new Error('Message too long');
  }
  return JSON.parse(raw || '{}');
}

function reply(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
}

// What the user sees when a request fails: your app's own short words. The API's own message is
// for you, in the server log with the request id; never show it to the user.
function forUser(e: ConversationsError): string {
  if (e.status === 429) return 'The room is busy right now. Try again in a moment.';
  if (e.status === 402) return 'Practice is paused for now. Try again later.';
  return "That didn't go through. Try again in a moment.";
}

// What the page shows for one saved turn.
function view(turn: Turn, receipt?: TurnResult['receipt']) {
  return {
    operation: turn.operation,
    learner_text: turn.learner_text,
    // Each character's line under their own name. With no structure, the saved text, no speaker.
    lines: turn.structure === 'available' ? [...turn.cast].sort((a, b) => a.order - b.order).map((s) => ({ name: s.display_name, text: s.text })) : [],
    text: turn.structure === 'available' ? null : turn.text,
    coach: turn.coach?.text?.trim() ? turn.coach.text : null,
    safety: { level: turn.safety.level, action: turn.safety.response_action },
    receipt: receipt ? { request_id: receipt.request_id, units: receipt.text?.units ?? 0, amount_micro_usd: receipt.text?.amount_micro_usd ?? 0, settlement: receipt.text?.settlement ?? 'unknown' } : { request_id: turn.request_id },
  };
}

// Keep the receipt: one line per confirmed turn.
async function keep(user: string, result: TurnResult) {
  await appendFile(RECEIPTS, JSON.stringify({
    at: new Date().toISOString(),
    request_id: result.receipt.request_id,
    session_id: result.receipt.session_id,
    user_id: user,
    operation: result.turn.operation,
    safety_level: result.safety.level,
    units: result.receipt.text?.units ?? 0,
    amount_micro_usd: result.receipt.text?.amount_micro_usd ?? 0,
    settlement: result.receipt.text?.settlement ?? 'unknown',
  }) + '\n');
}

// A turn whose outcome is uncertain is looked up, never sent again under a new key.
async function recover(user: string, practice: Practice, e: ConversationsError): Promise<Turn | 'pending' | null> {
  if (e.code !== 'INCOMPLETE' || !e.requestId) return null;
  try {
    const found = await lookup(user, e.requestId);
    if (found.status === 'in_progress') return 'pending';
    if (found.status !== 'committed') return null;
    const saved = (await playback(user, practice.sessionId)).find((t) => t.request_id === e.requestId);
    return saved ?? null;
  } catch (error) {
    console.error('Lookup failed:', (error as Error).message);
    return null;
  }
}

// Prepare the room for a new user (free), then its opening (a billable text turn), once.
async function startPractice(user: string): Promise<Practice> {
  const rooms = await catalog(user);
  const room = rooms.rooms.find((r) => r.title === ROOM_TITLE);
  if (!room) throw new ConversationsError(404, 'ROOM_NOT_IN_CATALOG', 'The room "' + ROOM_TITLE + '" is not in this key\'s catalog.');
  const persona = room.recommended_personas[0] ?? rooms.personas[0]?.persona_id;
  const mode = room.modes.includes('guided') ? 'guided' : room.modes[0];
  const session = await prepareRoom(user, { roomId: room.room_id, mode, personaIds: [persona] });
  const practice: Practice = { sessionId: session.session_id, title: room.title, cast: session.cast, turns: [] };
  try {
    const opening = await sendOpening(user, session.session_id);
    await keep(user, opening);
    practice.turns.push(opening.turn);
    practice.openingReceipt = opening.receipt;
  } catch (error) {
    // If an opening fails, its conversation closes without charge: the next visit prepares a new one.
    const e = error instanceof ConversationsError ? error : new ConversationsError(500, 'SERVER_ERROR', (error as Error).message);
    const saved = await recover(user, practice, e);
    if (saved && saved !== 'pending') practice.turns.push(saved);
    else throw e;
  }
  practices.set(user, practice);
  return practice;
}

async function start(request: IncomingMessage, response: ServerResponse) {
  const user = userId(request, response);
  try {
    let practice = practices.get(user);
    if (!practice) {
      let pending = starting.get(user);
      if (!pending) {
        pending = startPractice(user).finally(() => starting.delete(user));
        starting.set(user, pending);
      }
      practice = await pending;
    }
    reply(response, 200, {
      title: practice.title,
      cast: practice.cast.map((c) => ({ name: c.display_name, role: c.role })),
      turns: practice.turns.map((t, i) => view(t, i === 0 ? practice.openingReceipt : undefined)),
    });
  } catch (error) {
    const e = error instanceof ConversationsError ? error : new ConversationsError(500, 'SERVER_ERROR', (error as Error).message);
    console.error('Starting the room failed:', e.status, e.code, e.message, e.requestId ? 'request ' + e.requestId : '');
    reply(response, 200, { failed: forUser(e) });
  }
}

async function turn(request: IncomingMessage, response: ServerResponse) {
  const user = userId(request, response);
  const { message } = await readJson(request);
  const practice = practices.get(user);
  if (!practice) return reply(response, 409, { failed: 'The room is not open yet. Reload the page.' });
  if (typeof message !== 'string' || !message.trim()) return reply(response, 400, { failed: 'Type a message first.' });
  try {
    const result = await sendTurn(user, practice.sessionId, message.trim());
    await keep(user, result);
    practice.turns.push(result.turn);
    reply(response, 200, { turn: view(result.turn, result.receipt) });
  } catch (error) {
    const e = error instanceof ConversationsError ? error : new ConversationsError(500, 'SERVER_ERROR', (error as Error).message);
    console.error('Turn failed:', e.status, e.code, e.message, e.requestId ? 'request ' + e.requestId : '');
    const saved = await recover(user, practice, e);
    if (saved === 'pending') return reply(response, 200, { failed: 'That reply is still on its way. Reload the page in a moment.' });
    if (saved) {
      practice.turns.push(saved);
      return reply(response, 200, { turn: view(saved) });
    }
    reply(response, 200, { failed: forUser(e) });
  }
}

const server = createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (request.method === 'POST' && request.url === '/api/start') return await start(request, response);
    if (request.method === 'POST' && request.url === '/api/turn') return await turn(request, response);
    const file = request.method === 'GET' ? FILES[(request.url ?? '/').split('?')[0]] : undefined;
    if (!file) {
      response.writeHead(404).end('Not found');
      return;
    }
    userId(request, response);
    const body = await readFile(join(PUBLIC, file));
    response.writeHead(200, { 'Content-Type': TYPES[file.split('.').pop()!], 'Cache-Control': 'no-store' }).end(body);
  } catch (error) {
    if (!response.headersSent) response.writeHead(500).end('Server error');
    console.error(error);
  }
});

if (!isConfigured()) console.warn('Set FOREVERLEARNING_API_KEY and FOREVERLEARNING_ASSIGNMENT_ID. Copy .env.example to .env and fill it in.');
server.listen(PORT, '127.0.0.1', () => console.log('Your practice room is running at http://localhost:' + PORT));
