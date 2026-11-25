// Pick the room and the cast: step 1's practice room, plus a picker. The user chooses a ready-made
// room and the people in it, or practices on their own topic, then practices as in step 1.
// Node 24+, no packages. Start it with: npm start
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, appendFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  catalog, prepareRoom, prepareOpen, sendOpening, sendTurn, playback, lookup, isConfigured,
  ConversationsError, type Catalog, type CastMember, type Session, type Turn, type TurnResult,
} from './conversations.ts';

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC = join(import.meta.dirname, 'public');
const RECEIPTS = join(import.meta.dirname, 'receipts.jsonl');

// Open practice: one person for one-on-one, two to five for a room. A topic is optional.
const OPEN_SEATS = { one_on_one: { min: 1, max: 1 }, room: { min: 2, max: 5 } } as const;
const TOPIC_MAX = 240;

// One practice session per user at a time. New practice starts another; the earlier session stays
// as it was (this step never ends a session). A real app keeps this in its database.
interface Practice {
  sessionId: string;
  title: string;
  topic: string | null;
  cast: CastMember[];
  turns: Turn[];
  receipts: Map<string, TurnResult['receipt']>;
}
const practices = new Map<string, Practice>();
const starting = new Set<string>();

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

function asError(error: unknown): ConversationsError {
  return error instanceof ConversationsError ? error : new ConversationsError(500, 'SERVER_ERROR', (error as Error).message);
}

// What the user sees when a request fails: your app's own short words. The API's own message is
// for you, in the server log with the request id; never show it to the user.
function forUser(e: ConversationsError): string {
  if (e.status === 429) return 'The room is busy right now. Try again in a moment.';
  if (e.status === 402) return 'Practice is paused for now. Try again later.';
  if (e.notCommitted) return "That didn't go through, and nothing was charged. Send your message again.";
  return "That didn't go through. Try again in a moment.";
}

// "This room seats 1 to 2 people": a room's limit in words.
function seats(min: number, max: number): string {
  const people = (n: number) => n + (n === 1 ? ' person' : ' people');
  return min === max ? people(min) : min + ' to ' + people(max);
}

// The catalog is the same for every user of your key: read it once (no charge) and keep it for an hour.
let cached: { at: number; catalog: Catalog } | null = null;
async function rooms(user: string): Promise<Catalog> {
  if (!cached || Date.now() - cached.at > 3600_000) cached = { at: Date.now(), catalog: await catalog(user) };
  return cached.catalog;
}

// What the picker shows: every room that needs no topic consent (rooms that do come in a later
// step), by title, grouped under its category's label; every person by name and role; and each
// mode by its label. The page never shows a room id: it only sends it back as the choice.
function pickerView(c: Catalog) {
  const label = (list: { id: string; label: string }[], id: string) => list.find((x) => x.id === id)?.label ?? id.replaceAll('_', ' ');
  const listed = c.rooms.filter((r) => !r.topic_consent_required);
  const order = [...c.categories.map((x) => x.id), ...listed.map((r) => r.category_id)].filter((id, i, all) => all.indexOf(id) === i);
  const people = new Set(c.personas.map((p) => p.persona_id));
  return {
    groups: order.map((id) => ({
      label: label(c.categories, id),
      rooms: listed.filter((r) => r.category_id === id).map((r) => ({
        room_id: r.room_id,
        title: r.title,
        description: r.description,
        modes: r.modes.filter((m) => m !== 'open_practice').map((m) => ({ id: m, label: label(c.modes, m) })),
        min: r.min_participants,
        max: r.max_participants,
        seats: 'This room seats ' + seats(r.min_participants, r.max_participants) + '.',
        recommended: r.recommended_personas.filter((id) => people.has(id)),
      })),
    })).filter((g) => g.rooms.length),
    people: c.personas.map((p) => ({ persona_id: p.persona_id, name: p.display_name, role: p.role })),
    open: {
      one_on_one: { ...OPEN_SEATS.one_on_one, seats: 'One-on-one seats exactly 1 person.' },
      room: { ...OPEN_SEATS.room, seats: 'A room seats ' + seats(OPEN_SEATS.room.min, OPEN_SEATS.room.max) + '.' },
      topic_max: TOPIC_MAX,
    },
  };
}

// The user's choice, checked on the server with the same limits the picker shows. Either the setup
// to prepare, or a short reason in plain words.
type Checked = { refused: string } | { title: string; topic: string | null; prepare: (user: string) => Promise<Session> };
function check(choice: Record<string, unknown>, c: Catalog): Checked {
  const people = Array.isArray(choice.people) ? choice.people.filter((x): x is string => typeof x === 'string') : [];
  if (!people.length) return { refused: 'Tick the people you want in the practice.' };
  if (new Set(people).size !== people.length || people.some((id) => !c.personas.some((p) => p.persona_id === id))) {
    return { refused: 'Choose people from the list, each one once.' };
  }
  const ticked = ' You have ' + people.length + ' ticked.';
  if (choice.kind === 'room') {
    const room = c.rooms.find((r) => r.room_id === choice.room_id && !r.topic_consent_required);
    if (!room) return { refused: 'Choose a room from the list.' };
    const mode = typeof choice.mode === 'string' && room.modes.includes(choice.mode) && choice.mode !== 'open_practice' ? choice.mode : null;
    if (!mode) return { refused: 'Choose a mode from the list.' };
    if (people.length < room.min_participants || people.length > room.max_participants) {
      return { refused: 'This room seats ' + seats(room.min_participants, room.max_participants) + '.' + ticked };
    }
    return { title: room.title, topic: null, prepare: (user) => prepareRoom(user, { roomId: room.room_id, mode, personaIds: people }) };
  }
  if (choice.kind === 'open') {
    const shape = choice.cast_shape === 'one_on_one' || choice.cast_shape === 'room' ? choice.cast_shape : null;
    if (!shape) return { refused: 'Choose One-on-one or A room.' };
    const limit = OPEN_SEATS[shape];
    if (people.length < limit.min || people.length > limit.max) {
      return { refused: (shape === 'one_on_one' ? 'One-on-one seats exactly 1 person.' : 'A room seats ' + seats(limit.min, limit.max) + '.') + ticked };
    }
    const topic = typeof choice.topic === 'string' ? choice.topic.trim() : '';
    if (topic.length > TOPIC_MAX) return { refused: 'Keep the topic to ' + TOPIC_MAX + ' characters or fewer.' };
    return { title: 'Open practice', topic: topic || null, prepare: (user) => prepareOpen(user, { castShape: shape, personaIds: people, topic: topic || undefined }) };
  }
  return { refused: 'Choose a ready-made room or open practice.' };
}

// What the page shows for one saved turn.
function view(turn: Turn, receipt?: TurnResult['receipt']) {
  return {
    operation: turn.operation,
    learner_text: turn.learner_text,
    // Each character's line under their own name. With no structure, the saved text, no speaker.
    lines: turn.structure === 'available' ? [...turn.cast].sort((a, b) => a.order - b.order).map((s) => ({ speaker_id: s.speaker_id, name: s.display_name, text: s.text })) : [],
    text: turn.structure === 'available' ? null : turn.text,
    coach: turn.coach?.text?.trim() ? turn.coach.text : null,
    // Each character's mood and presence on this turn, for the faces (public/faces.js). The page
    // matches each face to its line by speaker_id.
    faces: (turn.characters ?? []).map((c) => ({ speaker_id: c.speaker_id, persona_id: c.persona_id, expression: c.expression, group: c.expression_group, presence: c.presence })),
    safety: { level: turn.safety.level, action: turn.safety.response_action },
    receipt: receipt ? { request_id: receipt.request_id, units: receipt.text?.units ?? 0, amount_micro_usd: receipt.text?.amount_micro_usd ?? 0, settlement: receipt.text?.settlement ?? 'unknown' } : { request_id: turn.request_id },
  };
}

// What the page shows for a practice: its title (or "Open practice" and the topic), the people in
// it, and its saved turns.
function practiceView(p: Practice) {
  return {
    title: p.title,
    topic: p.topic,
    cast: [...p.cast].sort((a, b) => a.seat - b.seat).map((c) => ({ name: c.display_name, role: c.role })),
    turns: p.turns.map((t) => view(t, p.receipts.get(t.turn_id))),
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
    return (await playback(user, practice.sessionId)).find((t) => t.request_id === e.requestId) ?? null;
  } catch (error) {
    console.error('Lookup failed:', (error as Error).message);
    return null;
  }
}

// The picker, and the user's current practice if there is one.
async function state(request: IncomingMessage, response: ServerResponse) {
  const user = userId(request, response);
  try {
    const practice = practices.get(user);
    reply(response, 200, { picker: pickerView(await rooms(user)), practice: practice ? practiceView(practice) : null });
  } catch (error) {
    const e = asError(error);
    console.error('Reading the catalog failed:', e.status, e.code, e.message, e.requestId ? 'request ' + e.requestId : '');
    reply(response, 200, { failed: "The rooms didn't load. Reload the page to try again." });
  }
}

// Start practice: check the choice, prepare one session (no charge), then request its opening
// (a billable text turn), once.
async function start(request: IncomingMessage, response: ServerResponse) {
  const user = userId(request, response);
  const choice = await readJson(request);
  if (starting.has(user)) return reply(response, 409, { refused: 'Your practice is already starting.' });
  starting.add(user);
  try {
    const checked = check(choice, await rooms(user));
    if ('refused' in checked) return reply(response, 400, { refused: checked.refused });
    let session: Session;
    try {
      session = await checked.prepare(user);
    } catch (error) {
      const e = asError(error);
      console.error('Preparing the practice failed:', e.status, e.code, e.message, e.requestId ? 'request ' + e.requestId : '');
      // A refused setup: say so in your own words and keep the picker. Preparing adds no charge.
      if (e.status === 400) return reply(response, 400, { refused: "This practice can't start with that choice. Change the room, the mode or the people, then start again. Preparing a practice adds no charge." });
      throw e;
    }
    const practice: Practice = { sessionId: session.session_id, title: checked.title, topic: checked.topic, cast: session.cast, turns: [], receipts: new Map() };
    try {
      const opening = await sendOpening(user, session.session_id);
      await keep(user, opening);
      practice.turns.push(opening.turn);
      practice.receipts.set(opening.turn.turn_id, opening.receipt);
    } catch (error) {
      // If an opening fails, its conversation closes without charge: the next start prepares a new one.
      const e = asError(error);
      const saved = await recover(user, practice, e);
      if (saved && saved !== 'pending') practice.turns.push(saved);
      else throw e;
    }
    practices.set(user, practice);
    reply(response, 200, { practice: practiceView(practice) });
  } catch (error) {
    const e = asError(error);
    console.error('Starting the practice failed:', e.status, e.code, e.message, e.requestId ? 'request ' + e.requestId : '');
    reply(response, 200, { failed: e.status === 429 || e.status === 402 ? forUser(e) : "The practice didn't open. Press Start practice to try again." });
  } finally {
    starting.delete(user);
  }
}

// New practice: back to the picker. The earlier session stays as it was.
async function newPractice(request: IncomingMessage, response: ServerResponse) {
  const user = userId(request, response);
  practices.delete(user);
  reply(response, 200, { ok: true });
}

async function turn(request: IncomingMessage, response: ServerResponse) {
  const user = userId(request, response);
  const { message } = await readJson(request);
  const practice = practices.get(user);
  if (!practice) return reply(response, 409, { failed: 'Start a practice first.' });
  if (typeof message !== 'string' || !message.trim()) return reply(response, 400, { failed: 'Type a message first.' });
  try {
    // A new request under its own new Idempotency-Key, every time (see conversations.ts).
    const result = await sendTurn(user, practice.sessionId, message.trim());
    await keep(user, result);
    practice.turns.push(result.turn);
    practice.receipts.set(result.turn.turn_id, result.receipt);
    reply(response, 200, { turn: view(result.turn, result.receipt) });
  } catch (error) {
    const e = asError(error);
    console.error('Turn failed:', e.status, e.code, e.message, e.requestId ? 'request ' + e.requestId : '');
    // An error status instead of an event stream, or an error event before done: nothing was
    // committed or charged, and it is final. The user may send it again, as a new request.
    if (e.notCommitted) return reply(response, 200, { failed: forUser(e), again: true });
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
    if (request.method === 'GET' && request.url === '/api/state') return await state(request, response);
    if (request.method === 'POST' && request.url === '/api/start') return await start(request, response);
    if (request.method === 'POST' && request.url === '/api/new') return await newPractice(request, response);
    if (request.method === 'POST' && request.url === '/api/turn') return await turn(request, response);
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
server.listen(PORT, '127.0.0.1', () => console.log('Your practice picker is running at http://localhost:' + PORT));
