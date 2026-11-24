// Team Desk's page: the week's one-to-ones, and a practice panel with nothing in it yet.
const meetings = document.querySelector('#meetings');
const body = document.querySelector('#practice-body');

const list = await (await fetch('/api/one-to-ones')).json();
for (const m of list) {
  const li = document.createElement('li');
  const name = document.createElement('strong');
  name.textContent = m.name;
  const when = document.createElement('span');
  when.className = 'muted';
  when.textContent = ' · ' + m.when;
  const topic = document.createElement('p');
  topic.textContent = m.topic;
  li.append(name, when, topic);
  meetings.append(li);
}

document.querySelector('#practice-open').addEventListener('click', () => {
  body.textContent = 'Practice is coming soon.';
});
