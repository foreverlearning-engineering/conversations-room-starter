// Faces for the characters. Each saved turn reports, for every character, a mood (expression_group,
// one of five), a finer expression (one of 16) and whether they are present. This file turns that
// into a face beside the character's line: drawn in code, unless you give it your own artwork.
// Faces are simulated responses of the characters in this practice, never a reading of a real person.

// ============================ YOUR OWN ARTWORK GOES HERE ============================
// To use your own faces, put the image files in public/faces/ and write each file's address
// below. Any entry you leave as null keeps the drawn face. Nothing else on the page needs to change.
//
//   moods        One image per mood: the five moods the API reports, plus "neutral" for a turn
//                with no expression reported (for example a safety moment).
//   expressions  Optional: finer art for any of the 16 detailed expressions. It wins over its mood.
//   characters   Optional: art for one character, by persona id, per mood or expression. It wins
//                over both. Persona ids are in the catalog and on each session's cast.
//
// Example:
//   moods: { more_open: '/faces/open.png', more_strained: '/faces/strained.png', ... }
//   characters: { jon_guarded_report: { more_careful: '/faces/jon-careful.png' } }
export const MY_ARTWORK = {
  moods: {
    steady_and_engaged: null,
    more_open: null,
    more_careful: null,
    more_strained: null,
    participating_less: null,
    neutral: null,
  },
  expressions: {
    composed: null, attentive: null, steadying: null, warmed: null,
    candid: null, collaborative: null, relieved: null, guarded: null,
    apprehensive: null, irritated: null, defensive: null, dismissed: null,
    hurt: null, withdrawn: null, sullen: null, resigned: null,
  },
  characters: {},
};
// ========================== END OF YOUR OWN ARTWORK ==========================

// The words for each mood. The page shows the face; the words are its label for screen readers
// and its tooltip.
export const MOOD_WORDS = {
  steady_and_engaged: 'steady and engaged',
  more_open: 'more open',
  more_careful: 'more careful',
  more_strained: 'more strained',
  participating_less: 'participating less',
  neutral: 'no expression reported',
};
const PRESENCE_WORDS = { present: '', stepped_away: ', stepped away', left: ', has left the room' };

// The drawn faces: a head color, brows, eyes and a mouth for each mood.
const DRAWN = {
  steady_and_engaged: { fill: '#dfe9e8', brows: ['M11 13 L17 13', 'M23 13 L29 13'], pupils: 17, mouth: 'M13 26 Q20 30 27 26' },
  more_open: { fill: '#e3f1e8', brows: ['M11 11 Q14 9 17 11', 'M23 11 Q26 9 29 11'], pupils: 17, mouth: 'M12 24 Q20 33 28 24' },
  more_careful: { fill: '#f6edd6', brows: ['M11 14 L17 13', 'M23 13 L29 14'], pupils: 17, mouth: 'M14 27 L26 27' },
  more_strained: { fill: '#f7dde2', brows: ['M11 12 L17 15', 'M23 15 L29 12'], pupils: 17, mouth: 'M13 29 Q20 23 27 29' },
  participating_less: { fill: '#e6e6e6', brows: ['M11 14 L17 14', 'M23 14 L29 14'], pupils: 19, mouth: 'M16 28 L24 28' },
  neutral: { fill: '#ececec', brows: [], pupils: 17, mouth: 'M14 27 L26 27' },
};

function artworkFor(c, mood) {
  const own = MY_ARTWORK.characters[c.persona_id] ?? {};
  return own[c.expression] ?? own[mood] ?? MY_ARTWORK.expressions[c.expression] ?? MY_ARTWORK.moods[mood] ?? null;
}

function drawn(mood) {
  const d = DRAWN[mood];
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 40 40');
  const add = (tag, attrs) => {
    const node = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    svg.append(node);
  };
  add('circle', { cx: 20, cy: 20, r: 18, fill: d.fill, stroke: '#1b1f1f', 'stroke-width': 1.2 });
  for (const b of d.brows) add('path', { d: b, stroke: '#1b1f1f', 'stroke-width': 1.6, fill: 'none', 'stroke-linecap': 'round' });
  add('circle', { cx: 14, cy: d.pupils, r: 1.8, fill: '#1b1f1f' });
  add('circle', { cx: 26, cy: d.pupils, r: 1.8, fill: '#1b1f1f' });
  add('path', { d: d.mouth, stroke: '#1b1f1f', 'stroke-width': 1.6, fill: 'none', 'stroke-linecap': 'round' });
  return svg;
}

// A face for one character on one turn: { name, persona_id, expression, group, presence }.
export function faceFor(c) {
  const mood = c.group && DRAWN[c.group] ? c.group : 'neutral';
  const label = (c.name ? c.name + ': ' : '') + MOOD_WORDS[mood] + (PRESENCE_WORDS[c.presence] ?? '');
  const art = artworkFor(c, mood);
  let face;
  if (art) {
    face = document.createElement('img');
    face.src = art;
    face.alt = label;
  } else {
    face = drawn(mood);
    face.setAttribute('role', 'img');
    face.setAttribute('aria-label', label);
  }
  face.classList.add('face', 'face-' + mood, 'presence-' + (c.presence ?? 'present'));
  face.dataset.mood = mood;
  const tip = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  if (!art) { tip.textContent = label; face.prepend(tip); } else face.title = label;
  return face;
}
