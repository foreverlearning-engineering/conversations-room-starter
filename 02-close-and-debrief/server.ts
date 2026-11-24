// Close and debrief: step 1's practice room, plus a Finish button that closes the practice and a
// debrief page tied to the moments that mattered. Node 24+, no packages. Start it with: npm start
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, appendFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  catalog, prepareRoom, sendOpening, sendTurn, closeSession, debrief, playback, lookup, isConfigured,
  ConversationsError, type CastMember, type Turn, type TurnResult, type Debrief, type Reference,
} from './conversations.ts';

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC = join(import.meta.dirname, 'public');
const RECEIPTS = join(import.meta.dirname, 'receipts.jsonl');

// The ready-made room this step uses, found in the catalog by its title.
const ROOM_TITLE = 'Direct Feedback To A Report';

// One practice session per user. A real app keeps this in its database.
interface Practice {
  sessionId: string;
  title: string;
  cast: CastMember[];
  turns: Turn[];
  receipts: Map<string, TurnResult['receipt']>;
  closeOperationId?: string; // kept, so a retried Finish is the same closeout
  closed?: boolean;
}
const practices = new Map<string, Practice>();
const starting = new Map<string, Promise<Practice>>();

const FILES: Record<string, string> = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css', '/faces.js': 'faces.js' };
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

// What the page shows for one saved turn. Each turn carries its ordinal, so the debrief can link
// back to it.
function view(turn: Turn, receipt?: TurnResult['receipt']) {
  return {
    ordinal: turn.ordinal,
    operation: turn.operation,
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

const RESPONSE_WORDS: Record<string, string> = {
  steady_and_engaged: 'steady and engaged',
  more_open: 'more open',
  more_careful: 'more careful',
  more_strained: 'more strained',
  participating_less: 'participating less',
};

// The debrief, in plain words. Each line keeps the turns it points to, so the page can link to
// them. A reference names a learner turn; this step links it to the saved turn with that ordinal.
function debriefView(d: Debrief, practice: Practice) {
  if (d.status !== 'available' || !d.review) {
    const why = d.unavailable_reason === 'insufficient_evidence'
      ? 'This practice was too short for a debrief. Next time, stay with the conversation a few more turns before you finish.'
      : d.unavailable_reason === 'not_closed'
        ? 'The debrief is ready once the practice is closed.'
        : "The debrief isn't available for this practice.";
    return { available: false, message: why };
  }
  const r = d.review;
  const turnsOf = (refs: Reference[]) => [...new Set(refs.map((x) => x.learner_turn ?? x.turn_number).filter((n): n is number => typeof n === 'number'))];
  const claim = (c: { text: string; evidence_refs: Reference[] }) => ({ text: c.text, turns: turnsOf(c.evidence_refs) });
  const names = new Map(practice.cast.map((c) => [c.persona_id, c.display_name]));
  return {
    available: true,
    what_happened: r.reflection.what_happened.available ? r.reflection.what_happened.claims.map(claim) : [],
    what_it_means: r.reflection.what_it_means.available ? r.reflection.what_it_means.claims.map(claim) : [],
    insights: r.reflection.key_insights.map((k) => ({ title: k.title, takeaway: k.takeaway, next: k.next_experiment, turns: turnsOf(k.evidence_refs) })),
    responses: r.persona_response_arcs.status === 'unavailable' ? [] : r.persona_response_arcs.arcs.map((a) => ({
      name: names.get(a.persona_id) ?? 'A character',
      moments: a.moments.map((m) => ({ when: m.stage === 'opening' ? 'at the start' : 'later', how: RESPONSE_WORDS[m.response_code] ?? m.response_code.replaceAll('_', ' '), turn: m.evidence_ref.learner_turn })),
    })),
    next: r.next_practice.map((n) => n.label).filter((x): x is string => Boolean(x)),
    coach: r.coaching_closeout?.paragraphs ?? [],
    comparison: r.same_scenario_comparison.available
      ? { before: r.same_scenario_comparison.prior_comparable_sessions ?? 0, same_conditions: r.same_scenario_comparison.comparability === 'same_conditions', new: (r.same_scenario_comparison.new_this_session ?? []).map((x) => x.label), again: (r.same_scenario_comparison.recorded_similarities ?? []).map((x) => x.label) }
      : null,
    // Faces and debriefs describe simulated characters in a recorded practice, never a real person.
    note: 'How the characters responded is how they were written to respond in this practice, not a reading of you.',
  };
}

// Keep the receipt: one line per confirmed turn, the opening and the closeout included.
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
    return (await playback(user, practice.sessionId)).find((t) => t.request_id === e.requestId) ?? null;
  } catch (error) {
    console.error('Lookup failed:', (error as Error).message);
    return null;
  }
}

function asError(error: unknown): ConversationsError {
  return error instanceof ConversationsError ? error : new ConversationsError(500, 'SERVER_ERROR', (error as Error).message);
}

// Prepare the room for a new user (no charge), then its opening (a billable text turn), once.
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
    // If an opening fails, its conversation closes without charge: the next visit prepares a new one.
    const e = asError(error);
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
    const p = practice;
    reply(response, 200, {
      title: p.title,
      cast: p.cast.map((c) => ({ name: c.display_name, role: c.role })),
      turns: p.turns.map((t) => view(t, p.receipts.get(t.turn_id))),
      closed: Boolean(p.closed),
      debrief: p.closed ? debriefView(await debrief(user, p.sessionId), p) : null,
    });
  } catch (error) {
    const e = asError(error);
    console.error('Starting the room failed:', e.status, e.code, e.message, e.requestId ? 'request ' + e.requestId : '');
    reply(response, 200, { failed: forUser(e) });
  }
}

async function turn(request: IncomingMessage, response: ServerResponse) {
  const user = userId(request, response);
  const { message } = await readJson(request);
  const practice = practices.get(user);
  if (!practice) return reply(response, 409, { failed: 'The room is not open yet. Reload the page.' });
  if (practice.closed) return reply(response, 409, { failed: 'This practice is finished.' });
  if (typeof message !== 'string' || !message.trim()) return reply(response, 400, { failed: 'Type a message first.' });
  try {
    const result = await sendTurn(user, practice.sessionId, message.trim());
    await keep(user, result);
    practice.turns.push(result.turn);
    practice.receipts.set(result.turn.turn_id, result.receipt);
    reply(response, 200, { turn: view(result.turn, result.receipt) });
  } catch (error) {
    const e = asError(error);
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

// Finish: the closeout (a billable text turn, charged when saved), then the debrief (no charge).
async function finish(request: IncomingMessage, response: ServerResponse) {
  const user = userId(request, response);
  const practice = practices.get(user);
  if (!practice) return reply(response, 409, { failed: 'The room is not open yet. Reload the page.' });
  try {
    if (!practice.closed) {
      practice.closeOperationId ??= randomUUID();
      try {
        const result = await closeSession(user, practice.sessionId, practice.closeOperationId);
        await keep(user, result);
        practice.turns.push(result.turn);
        practice.receipts.set(result.turn.turn_id, result.receipt);
      } catch (error) {
        const e = asError(error);
        const saved = await recover(user, practice, e);
        if (saved === 'pending') return reply(response, 200, { failed: 'The practice is still closing. Reload the page in a moment.' });
        if (!saved) throw e;
        practice.turns.push(saved);
      }
      practice.closed = true;
    }
    const closing = practice.turns.at(-1)!;
    reply(response, 200, { turn: view(closing, practice.receipts.get(closing.turn_id)), debrief: debriefView(await debrief(user, practice.sessionId), practice) });
  } catch (error) {
    const e = asError(error);
    console.error('Finish failed:', e.status, e.code, e.message, e.requestId ? 'request ' + e.requestId : '');
    reply(response, 200, { failed: forUser(e) });
  }
}

const server = createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (request.method === 'POST' && request.url === '/api/start') return await start(request, response);
    if (request.method === 'POST' && request.url === '/api/turn') return await turn(request, response);
    if (request.method === 'POST' && request.url === '/api/finish') return await finish(request, response);
    // Your own face artwork, from public/faces/ (see public/faces.js).
    const art = request.method === 'GET' ? /^\/faces\/([A-Za-z0-9_-]+\.(png|jpe?g|webp|gif|svg))$/.exec((request.url ?? '').split('?')[0]) : null;
    if (art) {
      const types: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };
      try {
        const body = await readFile(join(PUBLIC, 'faces', art[1]));
        response.writeHead(200, { 'Content-Type': types[art[2]], 'Cache-Control': 'no-store' }).end(body);
      } catch {
        response.writeHead(404).end('Not found');
      }
      return;
    }
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
