// The picker and the practice page. It talks only to your own server (/api/state, /api/start,
// /api/turn and /api/new), never to the Conversations API directly. Every text from the API is set
// as text, never as HTML.
import { faceFor } from '/faces.js';

const loading = document.querySelector('#loading');
const pickerSection = document.querySelector('#picker');
const choose = document.querySelector('#choose');
const roomSelect = document.querySelector('#room');
const modeSelect = document.querySelector('#mode');
const description = document.querySelector('#room-description');
const topicInput = document.querySelector('#topic');
const peopleBox = document.querySelector('#people');
const seatsLine = document.querySelector('#seats');
const refused = document.querySelector('#refused');
const startButton = document.querySelector('#start');

const practiceSection = document.querySelector('#practice');
const turns = document.querySelector('#turns');
const form = document.querySelector('#composer');
const input = document.querySelector('#message');
const button = form.querySelector('button');
const newButton = document.querySelector('#new');

let picker = null; // what the server sent: rooms grouped by category, the people, open practice's limits
let generation = 0; // which practice the page shows; a late reply from an earlier one is dropped

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function dollars(micro) {
  return '$' + (micro / 1e6).toFixed(2);
}

async function post(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  return await response.json();
}

// ---------------------------------- The picker ----------------------------------

const kind = () => choose.elements.kind.value; // "room" or "open"
const shape = () => choose.elements.shape.value; // "one_on_one" or "room"
const ticked = () => [...peopleBox.querySelectorAll('input[type="checkbox"]:checked')].map((box) => box.value);

function roomById(id) {
  for (const group of picker.groups) for (const room of group.rooms) if (room.room_id === id) return room;
  return null;
}

// The limit for the current choice: the room's seats, or open practice's.
function limit() {
  if (kind() === 'room') return roomById(roomSelect.value) ?? { min: 1, max: 0, seats: 'Choose a room.' };
  return picker.open[shape()];
}

function showSeats() {
  const n = ticked().length;
  seatsLine.textContent = limit().seats + ' You have ' + n + ' ticked.';
}

function showRefused(text) {
  refused.textContent = text;
  refused.hidden = false;
}

function clearRefused() {
  refused.hidden = true;
  refused.textContent = '';
}

function tick(ids) {
  for (const box of peopleBox.querySelectorAll('input[type="checkbox"]')) box.checked = ids.includes(box.value);
}

// Choosing a room shows its description and modes, and ticks its recommended people.
function chooseRoom() {
  const room = roomById(roomSelect.value);
  if (!room) return;
  description.textContent = room.description;
  modeSelect.replaceChildren(...room.modes.map((m) => {
    const option = el('option', '', m.label);
    option.value = m.id;
    return option;
  }));
  modeSelect.value = room.modes.some((m) => m.id === 'guided') ? 'guided' : room.modes[0]?.id ?? '';
  tick(room.recommended);
  showSeats();
}

function chooseKind() {
  const room = kind() === 'room';
  document.querySelector('#room-part').hidden = !room;
  document.querySelector('#open-part').hidden = room;
  clearRefused();
  if (room) chooseRoom();
  else { tick([]); showSeats(); }
}

function buildPicker() {
  // Each room by its title, under its category's label. The room id is only the option's value.
  roomSelect.replaceChildren(...picker.groups.map((group) => {
    const optgroup = el('optgroup');
    optgroup.label = group.label;
    for (const room of group.rooms) {
      const option = el('option', '', room.title);
      option.value = room.room_id;
      optgroup.append(option);
    }
    return optgroup;
  }));
  // A checkbox for every person: anyone may join any room, within the room's seats.
  peopleBox.replaceChildren(...picker.people.map((person) => {
    const label = el('label', 'person');
    const box = el('input');
    box.type = 'checkbox';
    box.name = 'people';
    box.value = person.persona_id;
    label.append(box, ' ' + person.name + ', ' + person.role);
    return label;
  }));
  if (!picker.groups.length) {
    choose.elements.kind.value = 'open';
    choose.querySelector('input[name="kind"][value="room"]').disabled = true;
  }
  chooseKind();
}

function showPicker() {
  practiceSection.hidden = true;
  pickerSection.hidden = false;
  startButton.disabled = false;
  document.title = 'Pick your practice';
}

for (const radio of choose.querySelectorAll('input[name="kind"]')) radio.addEventListener('change', chooseKind);
for (const radio of choose.querySelectorAll('input[name="shape"]')) radio.addEventListener('change', () => { clearRefused(); showSeats(); });
roomSelect.addEventListener('change', () => { clearRefused(); chooseRoom(); });
peopleBox.addEventListener('change', () => { clearRefused(); showSeats(); });

// Start practice, only within the limit. The server checks the same limits again.
choose.addEventListener('submit', async (submit) => {
  submit.preventDefault();
  clearRefused();
  const people = ticked();
  const { min, max, seats } = limit();
  if (people.length < min || people.length > max) return showRefused(seats + ' You have ' + people.length + ' ticked.');
  const topic = topicInput.value.trim();
  if (kind() === 'open' && topic.length > picker.open.topic_max) return showRefused('Keep the topic to ' + picker.open.topic_max + ' characters or fewer.');
  const body = kind() === 'room'
    ? { kind: 'room', room_id: roomSelect.value, mode: modeSelect.value, people }
    : { kind: 'open', cast_shape: shape(), people, topic };
  startButton.disabled = true;
  const waiting = el('p', 'waiting', 'Preparing your practice…');
  startButton.after(waiting);
  try {
    const data = await post('/api/start', body);
    if (data.practice) return showPractice(data.practice);
    // A refused choice or a failed opening: say so, and keep the picker as it was.
    showRefused(data.refused ?? data.failed ?? "That didn't go through. Try again in a moment.");
  } catch {
    showRefused('The connection dropped. Press Start practice to try again.');
  } finally {
    waiting.remove();
    startButton.disabled = false;
  }
});

// ------------------------------- The practice page -------------------------------

// One saved turn: each character's line under their name, with their face (matched by speaker_id),
// the Coach in its own panel, and, apart from the conversation, the safety status and the receipt.
function showTurn(turn) {
  const item = el('li', 'turn');
  const scene = el('div', 'scene');
  for (const line of turn.lines) {
    const bubble = el('div', 'line');
    const face = (turn.faces ?? []).find((f) => f.speaker_id === line.speaker_id);
    if (face) bubble.append(faceFor({ ...face, name: line.name }));
    bubble.append(el('p', 'speaker', line.name), el('p', 'words', line.text));
    scene.append(bubble);
  }
  if (!turn.lines.length && turn.text) scene.append(el('p', 'words unattributed', turn.text));
  item.append(scene);
  if (turn.coach) {
    const coach = el('aside', 'coach');
    coach.append(el('p', 'coach-label', 'Coach'), el('p', 'words', turn.coach));
    item.append(coach);
  }
  const meta = el('div', 'meta');
  meta.append(el('span', 'chip safety-' + turn.safety.level, 'Safety: ' + turn.safety.level + ' · action: ' + turn.safety.action));
  if (turn.receipt.units !== undefined) meta.append(el('span', 'chip', 'Receipt: ' + turn.receipt.units + ' text turn · ' + dollars(turn.receipt.amount_micro_usd) + ' · ' + turn.receipt.settlement));
  meta.append(el('span', 'chip', 'Request: ' + turn.receipt.request_id));
  item.append(meta);
  turns.append(item);
  item.scrollIntoView({ block: 'end' });
}

function showUser(text) {
  const item = el('li', 'turn user');
  item.append(el('p', 'words', text));
  turns.append(item);
  item.scrollIntoView({ block: 'end' });
  return item;
}

function showFailure(text) {
  const item = el('li', 'turn failed');
  item.append(el('p', 'words', text));
  turns.append(item);
  item.scrollIntoView({ block: 'end' });
}

function ready(on) {
  input.disabled = !on;
  button.disabled = !on;
  if (on) input.focus();
}

// The practice: its title (or "Open practice" and the topic), the people in it, and its turns.
function showPractice(practice) {
  generation += 1;
  pickerSection.hidden = true;
  practiceSection.hidden = false;
  document.querySelector('#title').textContent = practice.title;
  document.title = practice.title;
  const topicLine = document.querySelector('#topic-line');
  topicLine.textContent = practice.topic ? 'Topic: ' + practice.topic : '';
  topicLine.hidden = !practice.topic;
  document.querySelector('#cast').textContent = 'With ' + practice.cast.map((c) => c.name + ', ' + c.role).join('; ');
  turns.replaceChildren();
  for (const turn of practice.turns) {
    if (turn.learner_text) showUser(turn.learner_text);
    showTurn(turn);
  }
  ready(true);
}

form.addEventListener('submit', async (submit) => {
  submit.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  const mine = generation;
  const sent = showUser(text);
  input.value = '';
  ready(false);
  const waiting = el('li', 'turn waiting', 'They are answering…');
  turns.append(waiting);
  try {
    const data = await post('/api/turn', { message: text });
    if (mine !== generation) return;
    waiting.remove();
    if (data.failed) {
      showFailure(data.failed);
      // Not committed and not charged: the words go back in the box, to send again as a new request.
      if (data.again) {
        sent.classList.add('not-sent');
        input.value = text;
      }
    } else showTurn(data.turn);
  } catch {
    if (mine !== generation) return;
    waiting.remove();
    showFailure('The connection dropped. Try again.');
  } finally {
    if (mine === generation) ready(true);
  }
});

input.addEventListener('keydown', (key) => {
  if (key.key === 'Enter' && !key.shiftKey) {
    key.preventDefault();
    form.requestSubmit();
  }
});

// New practice: back to the picker. A new choice prepares a new session; the earlier one stays as it was.
newButton.addEventListener('click', async () => {
  generation += 1;
  ready(false);
  try {
    await post('/api/new');
  } catch { /* the picker still opens; the next start replaces the practice */ }
  turns.replaceChildren();
  clearRefused();
  showPicker();
  document.querySelector('#picker-title').focus();
});

async function load() {
  try {
    const data = await (await fetch('/api/state')).json();
    if (data.failed) { loading.textContent = data.failed; return; }
    loading.remove();
    picker = data.picker;
    buildPicker();
    if (data.practice) showPractice(data.practice);
    else showPicker();
  } catch {
    loading.textContent = 'The connection dropped. Reload the page to try again.';
  }
}

load();
