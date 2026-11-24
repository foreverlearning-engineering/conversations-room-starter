// Team Desk's page: the week's one-to-ones, and the practice panel, now with a practice room from
// the Conversations API. The panel talks only to Team Desk's own server (/api/practice/...).
const meetings = document.querySelector('#meetings');
const body = document.querySelector('#practice-body');
const openButton = document.querySelector('#practice-open');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const list = await (await fetch('/api/one-to-ones')).json();
for (const m of list) {
  const li = el('li');
  li.append(el('strong', '', m.name), el('span', 'muted', ' · ' + m.when), el('p', '', m.topic));
  meetings.append(li);
}

// ---------- The practice panel ----------
const log = el('ol', 'p-log');
log.setAttribute('aria-live', 'polite');
const form = el('form', 'p-form');
const input = el('textarea');
input.rows = 2;
input.placeholder = 'Say what you would say to Jon';
input.setAttribute('aria-label', 'What you would say');
const send = el('button', 'primary', 'Send');
send.type = 'submit';
form.append(input, send);

const dollars = (micro) => '$' + (micro / 1e6).toFixed(2);

function showTurn(turn) {
  const item = el('li', 'p-turn');
  if (turn.learner_text) item.append(el('p', 'p-you', turn.learner_text));
  for (const line of turn.lines) {
    const bubble = el('div', 'p-line');
    bubble.append(el('span', 'p-name', line.name), el('p', '', line.text));
    item.append(bubble);
  }
  if (!turn.lines.length && turn.text) item.append(el('p', 'p-line', turn.text));
  if (turn.coach) {
    const coach = el('div', 'p-coach');
    coach.append(el('span', 'p-coach-label', 'Coach'), el('p', '', turn.coach));
    item.append(coach);
  }
  const meta = el('p', 'p-meta');
  meta.append(el('span', 'p-safety p-' + turn.safety.level, 'Safety: ' + turn.safety.level + ' · action: ' + turn.safety.action));
  if (turn.receipt.units !== undefined) meta.append(el('span', '', ' · Receipt: ' + turn.receipt.units + ' text turn · ' + dollars(turn.receipt.amount_micro_usd) + ' · ' + turn.receipt.settlement));
  meta.append(el('span', 'p-request', ' · Request: ' + turn.receipt.request_id));
  item.append(meta);
  log.append(item);
  item.scrollIntoView({ block: 'nearest' });
}

function note(text, className = 'p-note') {
  const item = el('li', className, text);
  log.append(item);
  return item;
}

async function post(path, payload) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload ?? {}) });
  return await response.json();
}

openButton.addEventListener('click', async () => {
  openButton.disabled = true;
  body.replaceChildren(log);
  const waiting = note('Opening the room…');
  try {
    const data = await post('/api/practice/start');
    waiting.remove();
    if (data.failed) { note(data.failed, 'p-failed'); openButton.disabled = false; return; }
    document.querySelector('#practice-intro').textContent = data.title + ', with ' + data.cast.map((c) => c.name).join(' and ') + '.';
    for (const turn of data.turns) showTurn(turn);
    openButton.hidden = true;
    body.append(form);
    input.focus();
  } catch {
    waiting.remove();
    note('The connection dropped. Try again.', 'p-failed');
    openButton.disabled = false;
  }
});

form.addEventListener('submit', async (submit) => {
  submit.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  send.disabled = true;
  const mine = note(text, 'p-turn p-you');
  const waiting = note('Jon is answering…');
  try {
    const data = await post('/api/practice/turn', { message: text });
    waiting.remove();
    if (data.failed) note(data.failed, 'p-failed');
    else { mine.remove(); showTurn(data.turn); }
  } catch {
    waiting.remove();
    note('The connection dropped. Try again.', 'p-failed');
  } finally {
    send.disabled = false;
    input.focus();
  }
});

input.addEventListener('keydown', (key) => {
  if (key.key === 'Enter' && !key.shiftKey) {
    key.preventDefault();
    form.requestSubmit();
  }
});
