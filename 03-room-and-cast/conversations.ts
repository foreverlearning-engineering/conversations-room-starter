// A small Conversations API client for your server. The key is read from the environment
// and never leaves this process. Guide: https://developers.foreverlearning.ai/docs/conversation-practice/
import { randomUUID } from 'node:crypto';

const API_VERSION = '2026-12-01';

export interface Room {
  room_id: string;
  title: string;
  category_id: string;
  description: string;
  modes: string[];
  min_participants: number;
  max_participants: number;
  recommended_personas: string[];
  topic_consent_required: boolean;
}
export interface Persona { persona_id: string; display_name: string; role: string; role_family?: string }
export interface Label { id: string; label: string }
export interface Catalog { content_release: string; rooms: Room[]; personas: Persona[]; categories: Label[]; modes: Label[] }

export interface CastMember { speaker_id: string; persona_id: string; display_name: string; role: string; seat: number }
export interface Session { session_id: string; state: string; mode: string; room_id: string | null; cast: CastMember[] }

export interface Safety { level: 'unknown' | 'clear' | 'watch' | 'warning' | 'critical'; response_action: 'none' | 'support' | 'escalate'; evaluated: boolean; source: string }
export interface Segment { speaker_id: string; display_name: string; order: number; text: string; language: string }
export interface Character { speaker_id: string; persona_id: string; expression: string | null; expression_group: string | null; presence: 'present' | 'stepped_away' | 'left' }
export interface Turn {
  turn_id: string;
  request_id: string;
  session_id: string;
  ordinal: number;
  operation: 'opening' | 'turn' | 'closeout';
  learner_text: string | null;
  cast: Segment[];
  coach: { text: string; language: string } | null;
  text: string;
  safety: Safety;
  structure: 'available' | 'unavailable';
  state: 'active' | 'closed';
  characters: Character[] | null;
}
export interface Meter { unit: string; units: number; amount_micro_usd: number; settlement: string }
export interface Receipt { request_id: string; session_id: string; content_release: string; text: Meter | null; audio: Meter | null }
export interface TurnResult { turn: Turn; safety: Safety; receipt: Receipt; ended: boolean }

export class ConversationsError extends Error {
  status: number;
  code: string;
  requestId: string;
  // True when the API said so itself: an error status instead of an event stream, or an error event
  // before done. Nothing was committed or charged, and the user may send the message again.
  notCommitted: boolean;
  constructor(status: number, code: string, message: string, requestId = '', notCommitted = false) {
    super(message);
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.notCommitted = notCommitted;
  }
}

function settings() {
  const key = process.env.FOREVERLEARNING_API_KEY ?? '';
  const base = (process.env.FOREVERLEARNING_BASE_URL ?? 'https://developers-api.foreverlearning.ai/v1').replace(/\/+$/, '');
  const assignment = process.env.FOREVERLEARNING_ASSIGNMENT_ID ?? '';
  return { key, base, assignment };
}

export function isConfigured(): boolean {
  const { key, assignment } = settings();
  return key.length > 0 && assignment.length > 0;
}

// Every request names the user (a pseudonymous id), the assignment and the interface version.
// Every POST carries its own new idempotency key: the same key means the same request.
function headers(userId: string, idempotencyKey?: string): Record<string, string> {
  const { key, assignment } = settings();
  const h: Record<string, string> = {
    Authorization: 'Bearer ' + key,
    'X-User-Id': userId,
    'X-Assignment-Id': assignment,
    'FL-API-Version': API_VERSION,
  };
  if (idempotencyKey) {
    h['Idempotency-Key'] = idempotencyKey;
    h['Content-Type'] = 'application/json';
  }
  return h;
}

async function failure(response: Response): Promise<ConversationsError> {
  let code = 'HTTP_' + response.status;
  let message = 'The Conversations API returned HTTP ' + response.status + '.';
  let requestId = response.headers.get('x-request-id') ?? '';
  try {
    const body = await response.json() as { code?: string; message?: string; request_id?: string };
    if (body.code) code = body.code;
    if (body.message) message = body.message;
    if (body.request_id) requestId = body.request_id;
  } catch { /* keep the HTTP status */ }
  return new ConversationsError(response.status, code, message, requestId, true);
}

async function getJson<T>(userId: string, path: string): Promise<T> {
  const { base } = settings();
  const response = await fetch(base + path, { headers: headers(userId), redirect: 'error' });
  if (!response.ok) throw await failure(response);
  return await response.json() as T;
}

// The rooms, people and options your key can use: its rooms, its people, and the labels of its
// categories and modes. No charge.
export async function catalog(userId: string): Promise<Catalog> {
  const all: Catalog = { content_release: '', rooms: [], personas: [], categories: [], modes: [] };
  const add = (list: Label[], more: Label[] | undefined) => {
    for (const x of more ?? []) if (!list.some((y) => y.id === x.id)) list.push(x);
  };
  let cursor: string | null = null;
  do {
    const page: Catalog & { next_cursor: string | null } = await getJson(userId, '/conversation/catalog' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''));
    all.content_release = page.content_release;
    all.rooms.push(...page.rooms);
    all.personas.push(...page.personas);
    add(all.categories, page.categories);
    add(all.modes, page.modes);
    cursor = page.next_cursor;
  } while (cursor);
  return all;
}

// Prepare one practice session. Nothing is generated and nothing is charged. A setup the API
// refuses (a room's seat limit, a person twice, an unknown person) is HTTP 400 DEVELOPER_INVALID_REQUEST.
async function prepare(userId: string, setup: Record<string, unknown>, controls: Record<string, string>): Promise<Session> {
  const { base } = settings();
  const response = await fetch(base + '/conversation/sessions', {
    method: 'POST',
    headers: headers(userId, randomUUID()),
    body: JSON.stringify({ setup, controls }),
    redirect: 'error',
  });
  if (!response.ok) throw await failure(response);
  return await response.json() as Session;
}

// A ready-made room, in one of its modes, with the people the user chose, each by persona id.
export async function prepareRoom(userId: string, room: { roomId: string; mode: string; personaIds: string[] }, controls: Record<string, string> = {}): Promise<Session> {
  return await prepare(userId, { kind: 'room', room_id: room.roomId, mode: room.mode, participants: room.personaIds.map((id) => ({ persona_id: id })) }, controls);
}

// Open practice on the user's own topic: one person ("one_on_one") or two to five ("room").
export async function prepareOpen(userId: string, open: { castShape: 'one_on_one' | 'room'; personaIds: string[]; topic?: string }, controls: Record<string, string> = {}): Promise<Session> {
  const setup: Record<string, unknown> = { kind: 'open', mode: 'open_practice', cast_shape: open.castShape, participants: open.personaIds.map((id) => ({ persona_id: id })) };
  if (open.topic) setup.topic = open.topic;
  return await prepare(userId, setup, controls);
}

// Read a session's saved turns, in order. No charge.
export async function playback(userId: string, sessionId: string): Promise<Turn[]> {
  const turns: Turn[] = [];
  let cursor: string | null = null;
  do {
    const page: { turns: Turn[]; next_cursor: string | null } = await getJson(userId, '/conversation/sessions/' + encodeURIComponent(sessionId) + '/playback' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''));
    turns.push(...page.turns);
    cursor = page.next_cursor;
  } while (cursor);
  return turns;
}

// Look up a turn whose outcome is uncertain, without starting another. No charge.
export async function lookup(userId: string, requestId: string): Promise<{ status: string; session_id?: string }> {
  return await getJson(userId, '/requests/' + encodeURIComponent(requestId));
}

// Read the event stream of one generated turn. The reply arrives complete: the saved
// conversation_turn event carries it, and the final done event confirms it with its receipt.
async function readTurn(response: Response, sessionId: string, requireEnd: boolean): Promise<TurnResult> {
  if (!response.ok || !response.body) throw await failure(response);
  let requestId = '';
  let streamSession = '';
  let turn: Turn | undefined;
  let safety: Safety | undefined;
  let receipt: Receipt | undefined;
  let ended = false;

  const handle = (event: Record<string, any>) => {
    switch (event.type) {
      case 'metadata':
        requestId = event.request_id;
        streamSession = event.sessionId;
        break;
      case 'safety_status':
        safety = event as Safety;
        break;
      case 'conversation_turn':
        turn = event.turn as Turn;
        break;
      case 'session_ended':
        ended = true;
        break;
      case 'done':
        if (event.sessionId === streamSession && event.receipt?.request_id === requestId && event.receipt?.session_id === streamSession) receipt = event.receipt;
        break;
      case 'error':
        throw new ConversationsError(502, event.code ?? 'TURN_FAILED', event.message ?? 'The turn did not complete.', event.request_id ?? requestId, true);
      default:
        break; // content and display_complete are provisional; unknown future events are ignored.
    }
  };

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replaceAll('\r\n', '\n');
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
        if (data) handle(JSON.parse(data));
      }
    }
  } catch (error) {
    if (error instanceof ConversationsError) throw error;
    // The connection ended early: the turn may still have been saved.
  }

  // A turn is complete only when done arrived with the same identity as the metadata event.
  if (!receipt || !turn || !safety || turn.request_id !== requestId || (requireEnd && !ended)) {
    throw new ConversationsError(502, 'INCOMPLETE', 'The turn was not confirmed. Look it up with GET /v1/requests/' + requestId + ' before sending anything again.', requestId);
  }
  if (streamSession !== sessionId) throw new ConversationsError(502, 'SESSION_MISMATCH', 'The reply belongs to a different session.', requestId);
  return { turn, safety, receipt, ended };
}

// Each call is a new request under its own new Idempotency-Key. Send a message again only when the
// first try was not committed (an error status or an error event); an uncertain one is looked up.
async function chat(userId: string, body: Record<string, unknown>, sessionId: string): Promise<TurnResult> {
  const { base } = settings();
  const response = await fetch(base + '/chat', {
    method: 'POST',
    headers: { ...headers(userId, randomUUID()), Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    redirect: 'error',
  });
  return await readTurn(response, sessionId, false);
}

// The room's opening: the first characters speak. A billable text turn, with no learner message.
export async function sendOpening(userId: string, sessionId: string): Promise<TurnResult> {
  return await chat(userId, { session_id: sessionId, conversation: { operation: 'opening' } }, sessionId);
}

// One learner turn. A billable text turn.
export async function sendTurn(userId: string, sessionId: string, prompt: string, controls?: Record<string, string>): Promise<TurnResult> {
  const conversation: Record<string, unknown> = { operation: 'turn' };
  if (controls && Object.keys(controls).length) conversation.controls = controls;
  return await chat(userId, { session_id: sessionId, prompt, conversation }, sessionId);
}
