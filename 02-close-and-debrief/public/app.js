// The practice page. It talks only to your own server (/api/start, /api/turn, /api/finish), never
// to the Conversations API directly. Every text from the API is set as text, never as HTML.
import { faceFor } from '/faces.js';

const turns = document.querySelector('#turns');
const form = document.querySelector('#composer');
const input = document.querySelector('#message');
const button = form.querySelector('button[type="submit"]');
const finishButton = document.querySelector('#finish');
const debriefBox = document.querySelector('#debrief');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function dollars(micro) {
  return '$' + (micro / 1e6).toFixed(2);
}

// One saved turn, with an id the debrief links to: your own words, each character's line under
// their name, the Coach in its own panel, then the safety status and the receipt.
function showTurn(turn) {
  const item = el('li', 'turn');
  item.id = 'turn-' + turn.ordinal;
  if (turn.learner_text) item.append(el('p', 'words user', turn.learner_text));
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
    coach.append(el('p', 'coach-label', turn.operation === 'closeout' ? 'Coach, closing' : 'Coach'), el('p', 'words', turn.coach));
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

function showPending(text) {
  const item = el('li', 'turn pending');
  item.append(el('p', 'words user', text));
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

// Links to the turns a debrief line came from.
function turnLinks(numbers) {
  const span = el('span', 'refs');
  for (const n of numbers) {
    if (!document.getElementById('turn-' + n)) continue;
    const a = el('a', 'ref', 'turn ' + n);
    a.href = '#turn-' + n;
    span.append(' ', a);
  }
  return span;
}

function section(title) {
  const box = el('section', 'debrief-part');
  box.append(el('h3', '', title));
  debriefBox.append(box);
  return box;
}

function showDebrief(d) {
  debriefBox.replaceChildren(el('h2', '', 'Your debrief'));
  debriefBox.hidden = false;
  if (!d.available) {
    debriefBox.append(el('p', 'words', d.message));
    return;
  }
  const claims = (title, list) => {
    if (!list.length) return;
    const box = section(title);
    const ul = el('ul');
    for (const c of list) { const li = el('li', '', c.text); li.append(turnLinks(c.turns)); ul.append(li); }
    box.append(ul);
  };
  claims('What happened', d.what_happened);
  claims('What it means', d.what_it_means);
  if (d.insights.length) {
    const box = section('Key moments');
    for (const k of d.insights) {
      const card = el('div', 'insight');
      const title = el('p', 'insight-title', k.title);
      title.append(turnLinks(k.turns));
      card.append(title, el('p', 'words', k.takeaway), el('p', 'words next', 'Next time: ' + k.next));
      box.append(card);
    }
  }
  if (d.responses.length) {
    const box = section('How they responded');
    for (const r of d.responses) box.append(el('p', 'words', r.name + ': ' + r.moments.map((m) => m.how + ' ' + m.when).join(', then ') + '.'));
    box.append(el('p', 'small', d.note));
  }
  if (d.comparison) {
    const box = section('Compared with last time');
    box.append(el('p', 'words', d.comparison.before + ' earlier practice' + (d.comparison.before === 1 ? '' : 's') + ' of this room, ' + (d.comparison.same_conditions ? 'under the same conditions.' : 'under different conditions.')));
    if (d.comparison.new.length) box.append(el('p', 'words', 'New this time: ' + d.comparison.new.join('; ') + '.'));
  }
  if (d.next.length) {
    const box = section('Your next practice');
    const ul = el('ul');
    for (const n of d.next) ul.append(el('li', '', n));
    box.append(ul);
  }
  if (d.coach.length) {
    const box = section('From the Coach');
    for (const p of d.coach) box.append(el('p', 'words', p));
  }
  debriefBox.scrollIntoView({ block: 'start' });
}

function ready(on) {
  input.disabled = !on;
  button.disabled = !on;
  finishButton.disabled = !on;
  if (on) input.focus();
}

function closed() {
  input.disabled = true;
  button.disabled = true;
  finishButton.disabled = true;
  form.hidden = true;
}

async function post(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  return await response.json();
}

async function open() {
  const waiting = el('li', 'turn waiting', 'The room is opening…');
  turns.append(waiting);
  try {
    const data = await post('/api/start');
    waiting.remove();
    if (data.failed) return showFailure(data.failed);
    document.querySelector('#title').textContent = data.title;
    document.querySelector('#cast').textContent = 'With ' + data.cast.map((c) => c.name + ', ' + c.role).join('; ');
    for (const turn of data.turns) showTurn(turn);
    if (data.closed) { closed(); if (data.debrief) showDebrief(data.debrief); }
    else ready(true);
  } catch {
    waiting.remove();
    showFailure('The connection dropped. Reload the page to try again.');
  }
}

form.addEventListener('submit', async (submit) => {
  submit.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  const pending = showPending(text);
  input.value = '';
  ready(false);
  const waiting = el('li', 'turn waiting', 'They are answering…');
  turns.append(waiting);
  try {
    const data = await post('/api/turn', { message: text });
    waiting.remove();
    if (data.failed) showFailure(data.failed);
    else { pending.remove(); showTurn(data.turn); }
  } catch {
    waiting.remove();
    showFailure('The connection dropped. Try again.');
  } finally {
    ready(true);
  }
});

finishButton.addEventListener('click', async () => {
  ready(false);
  const waiting = el('li', 'turn waiting', 'Closing the practice…');
  turns.append(waiting);
  try {
    const data = await post('/api/finish');
    waiting.remove();
    if (data.failed) { showFailure(data.failed); ready(true); return; }
    showTurn(data.turn);
    closed();
    showDebrief(data.debrief);
  } catch {
    waiting.remove();
    showFailure('The connection dropped. Press Finish again: it closes the same practice.');
    ready(true);
  }
});

input.addEventListener('keydown', (key) => {
  if (key.key === 'Enter' && !key.shiftKey) {
    key.preventDefault();
    form.requestSubmit();
  }
});

open();
