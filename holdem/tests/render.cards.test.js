// render.cards.test.js — runnable in Node (node tests/...).
//
// Phase 4b: suit colour and rank label mapping, the traditional pip-count
// layouts, and the structure of the code-drawn card faces and back. Visual
// quality is checked in the generated preview (demo/cards.html).

import { cardFaceSVG, cardBackSVG, pipLayout, suitColor, rankLabel, isCourt, isAce, SUIT_PATHS } from '../src/render/index.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  \u2713 ${name}`); passed++; }
  catch (e) { console.error(`  \u2717 ${name}\n      ${e.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
const count = (s, re) => (s.match(re) || []).length;

console.log('Suit & rank mapping');

test('red suits use danger, black suits use ink', () => {
  assert(suitColor('h') === suitColor('d') && suitColor('h') !== suitColor('s'), 'red vs black');
  assert(suitColor('s') === suitColor('c'), 'spades = clubs (black)');
});
test('rank labels: A K Q J and 10', () => {
  assert(rankLabel(14) === 'A' && rankLabel(13) === 'K' && rankLabel(12) === 'Q' && rankLabel(11) === 'J' && rankLabel(10) === '10' && rankLabel(2) === '2', 'labels');
  assert(isAce(14) && isCourt(13) && isCourt(11) && !isCourt(10) && !isAce(13), 'classification');
});
test('all four suits have vector path data', () => {
  for (const s of ['h', 's', 'd', 'c']) assert(typeof SUIT_PATHS[s] === 'string' && SUIT_PATHS[s].startsWith('M'), `path ${s}`);
});

console.log('Pip layouts (traditional counts)');

test('each number rank lays out exactly that many pips; courts/ace use none', () => {
  for (let r = 2; r <= 10; r++) assert(pipLayout(r).length === r, `rank ${r} → ${pipLayout(r).length} pips`);
  assert(pipLayout(11).length === 0 && pipLayout(14).length === 0, 'court/ace have no pip grid');
});
test('bottom-half pips are flipped', () => {
  assert(pipLayout(10).some(p => p.flip) && pipLayout(10).some(p => !p.flip), 'mix of flipped/unflipped');
});

console.log('Card face SVG (spec 3.3)');

test('a number card renders its pips, two corner indices, and noise overlay', () => {
  const svg = cardFaceSVG({ rank: 7, suit: 'h' });
  assert(svg.includes('data-card="7h"'), 'data-card');
  assert(count(svg, /class="corner-index"/g) === 2, 'two mirrored corner indices');
  assert(count(svg, /class="suit suit-h"/g) >= 7, 'seven pips (+ index glyphs)');
  assert(svg.includes('feTurbulence'), 'micro-noise');
  assert(svg.includes(`rx="12"`), '12px corner radius');
});
test('a court card renders a monogram with its letter', () => {
  const svg = cardFaceSVG({ rank: 12, suit: 's' });
  assert(svg.includes('class="court"') && svg.includes('>Q<'), 'queen monogram');
});
test('an ace renders a single large central suit glyph', () => {
  const svg = cardFaceSVG({ rank: 14, suit: 'd' });
  assert(svg.includes('data-card="Ad"') && svg.includes('class="card-center"'), 'ace center');
});
test('unique noise ids per card avoid page collisions', () => {
  const a = cardFaceSVG({ rank: 2, suit: 'c' }), b = cardFaceSVG({ rank: 2, suit: 'c' });
  assert(a.match(/id="([^"]+)-noise"/)[1] !== b.match(/id="([^"]+)-noise"/)[1], 'ids differ');
});

console.log('Card back SVG (spec 3.3)');

test('the back has a guilloché pattern, double border, and central emblem', () => {
  const svg = cardBackSVG();
  assert(svg.includes('class="guilloche"'), 'guilloché');
  assert(count(svg, /fill="none" stroke="#d4af37"/g) >= 2, 'double gold border');
  assert(svg.includes('class="emblem"'), 'central emblem');
  assert(svg.includes('data-card="back"'), 'tagged as back');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
