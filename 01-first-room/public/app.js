// The practice page. It talks only to your own server (/api/start and /api/turn), never to the
// Conversations API directly. Every text from the API is set as text, never as HTML.
const turns = document.querySelector('#turns');
const form = document.querySelector('#composer');
const input = document.querySelector('#message');
const button = form.querySelector('button');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function dollars(micro) {
  return '$' + (micro / 1e6).toFixed(2);
}

// One saved turn: each character's line under their name, the Coach in its own panel, and,
// apart from the conversation, the safety status and the receipt.
function showTurn(turn) {
  const item = el('li', 'turn');
  const scene = el('div', 'scene');
  for (const line of turn.lines) {
    const bubble = el('div', 'line');
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
    for (const turn of data.turns) {
      if (turn.learner_text) showUser(turn.learner_text);
      showTurn(turn);
    }
    ready(true);
  } catch {
    waiting.remove();
    showFailure('The connection dropped. Reload the page to try again.');
  }
}

form.addEventListener('submit', async (submit) => {
  submit.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  showUser(text);
  input.value = '';
  ready(false);
  const waiting = el('li', 'turn waiting', 'They are answering…');
  turns.append(waiting);
  try {
    const data = await post('/api/turn', { message: text });
    waiting.remove();
    if (data.failed) showFailure(data.failed);
    else showTurn(data.turn);
  } catch {
    waiting.remove();
    showFailure('The connection dropped. Try again.');
  } finally {
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
