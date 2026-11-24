// The practice room inside Team Desk: two routes on your own server, and the only code that calls
// the Conversations API. The key stays here. Your page calls /api/practice/start and
// /api/practice/turn; it never calls the API itself.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { appendFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  catalog, prepareRoom, sendOpening, sendTurn, playback, lookup, isConfigured,
  ConversationsError, type CastMember, type Turn, type TurnResult,
} from './conversations.ts';

const RECEIPTS = join(import.meta.dirname, 'receipts.jsonl');

// The ready-made room for a hard one-to-one, found in the catalog by its title.
const ROOM_TITLE = 'Direct Feedback To A Report';

interface Practice { sessionId: string; title: string; cast: CastMember[]; turns: Turn[]; receipts: Map<string, TurnResult['receipt']> }
const practices = new Map<string, Practice>();
const starting = new Map<string, Promise<Practice>>();

if (!isConfigured()) console.warn('Practice room: set FOREVERLEARNING_API_KEY and FOREVERLEARNING_ASSIGNMENT_ID (see .env.example).');

// Your product's own user id, never a name or an email. Team Desk has no sign-in in this sample,
// so it keeps a pseudonymous id in a cookie; a real product passes its own opaque user id.
function userId(request: IncomingMessage, response: ServerResponse): string {
  const match = /(?:^|;\s*)practice_user=([A-Za-z0-9_-]{1,128})/.exec(request.headers.cookie ?? '');
  if (match) return match[1];
  const id = 'user-' + randomUUID();
  response.setHeader('Set-Cookie', 'practice_user=' + id + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000');
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

// Your product's own words when something fails. The API's message goes to your server log.
function forUser(e: ConversationsError): string {
  if (e.status === 429) return 'Practice is busy right now. Try again in a moment.';
  if (e.status === 402) return 'Practice is paused for now. Try again later.';
  return "That didn't go through. Try again in a moment.";
}
function asError(error: unknown): ConversationsError {
  return error instanceof ConversationsError ? error : new ConversationsError(500, 'SERVER_ERROR', (error as Error).message);
}

function view(turn: Turn, receipt?: TurnResult['receipt']) {
  return {
    learner_text: turn.learner_text,
    lines: turn.structure === 'available' ? [...turn.cast].sort((a, b) => a.order - b.order).map((s) => ({ speaker_id: s.speaker_id, name: s.display_name, text: s.text })) : [],
    text: turn.structure === 'available' ? null : turn.text,
    coach: turn.coach?.text?.trim() ? turn.coach.text : null,
    // Each character's mood and presence on this turn, for the faces (public/faces.js).
    faces: (turn.characters ?? []).map((c) => ({ speaker_id: c.speaker_id, persona_id: c.persona_id, expression: c.expression, group: c.expression_group, presence: c.presence })),
    safety: { level: turn.safety.level, action: turn.safety.response_action },
    receipt: receipt ? { request_id: receipt.request_id, units: receipt.text?.units ?? 0, amount_micro_usd: receipt.text?.amount_micro_usd ?? 0, settlement: receipt.text?.settlement ?? 'unknown' } : { request_id: turn.request_id },
  };
}

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

// An uncertain turn is looked up, never sent again under a new key.
async function recover(user: string, practice: Practice, e: ConversationsError): Promise<Turn | 'pending' | null> {
  if (e.code !== 'INCOMPLETE' || !e.requestId) return null;
  try {
    const found = await lookup(user, e.requestId);
    if (found.status === 'in_progress') return 'pending';
    if (found.status !== 'committed') return null;
    return (await playback(user, practice.sessionId)).find((t) => t.request_id === e.requestId) ?? null;
  } catch {
    return null;
  }
}

async function startPractice(user: string): Promise<Practice> {
  const rooms = await catalog(user);
  const room = rooms.rooms.find((r) => r.title === ROOM_TITLE);
  if (!room) throw new ConversationsError(404, 'ROOM_NOT_IN_CATALOG', 'The room "' + ROOM_TITLE + '" is not in this key\'s catalog.');
  const persona = room.recommended_personas[0] ?? rooms.personas[0]?.persona_id;
  const mode = room.modes.includes('guided') ? 'guided' : room.modes[0];
  const session = await prepareRoom(user, { roomId: room.room_id, mode, personaIds: [persona] });
  const practice: Practice = { sessionId: session.session_id, title: room.title, cast: session.cast, turns: [], receipts: new Map() };
  try {
    const opening = await sendOpening(user, session.session_id);
    await keep(user, opening);
    practice.turns.push(opening.turn);
    practice.receipts.set(opening.turn.turn_id, opening.receipt);
  } catch (error) {
    const e = asError(error);
    const saved = await recover(user, practice, e);
    if (saved && saved !== 'pending') practice.turns.push(saved);
    else throw e;
  }
  practices.set(user, practice);
  return practice;
}

// Returns true when it answered the request.
export async function handlePractice(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  if (request.method !== 'POST' || !['/api/practice/start', '/api/practice/turn'].includes(request.url ?? '')) return false;
  const user = userId(request, response);
  if (request.url === '/api/practice/start') {
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
      const p = practice;
      reply(response, 200, { title: p.title, cast: p.cast.map((c) => ({ name: c.display_name, role: c.role })), turns: p.turns.map((t) => view(t, p.receipts.get(t.turn_id))) });
    } catch (error) {
      const e = asError(error);
      console.error('Practice start failed:', e.status, e.code, e.message, e.requestId ? 'request ' + e.requestId : '');
      reply(response, 200, { failed: forUser(e) });
    }
    return true;
  }
  const practice = practices.get(user);
  const { message } = await readJson(request);
  if (!practice) { reply(response, 409, { failed: 'Open the practice first.' }); return true; }
  if (typeof message !== 'string' || !message.trim()) { reply(response, 400, { failed: 'Type what you would say first.' }); return true; }
  try {
    const result = await sendTurn(user, practice.sessionId, message.trim());
    await keep(user, result);
    practice.turns.push(result.turn);
    practice.receipts.set(result.turn.turn_id, result.receipt);
    reply(response, 200, { turn: view(result.turn, result.receipt) });
  } catch (error) {
    const e = asError(error);
    console.error('Practice turn failed:', e.status, e.code, e.message, e.requestId ? 'request ' + e.requestId : '');
    const saved = await recover(user, practice, e);
    if (saved === 'pending') reply(response, 200, { failed: 'That reply is still on its way. Reload in a moment.' });
    else if (saved) { practice.turns.push(saved); reply(response, 200, { turn: view(saved) }); }
    else reply(response, 200, { failed: forUser(e) });
  }
  return true;
}
