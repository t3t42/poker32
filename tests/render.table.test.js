// render.table.test.js — runnable in Node (node tests/...).
//
// Phase 4c: seat geometry, the table-surface SVG, HUD value helpers + panel
// markup, and the scene composer that places cards/chips/seats from a snapshot.
// Visual quality is checked in the generated preview (demo/table.html).

import { seatLayout, towardCenter, tableSVG, potOddsPct, equityPct, handRankHint, hudHTML, sceneHTML } from '../src/render/index.js';
import { cards } from '../src/engine/index.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  \u2713 ${name}`); passed++; }
  catch (e) { console.error(`  \u2717 ${name}\n      ${e.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
const count = (s, re) => (s.match(re) || []).length;

console.log('Seat geometry (spec 3.5)');

test('n seats, hero at bottom-centre, all within bounds', () => {
  const W = 900, H = 560;
  for (const n of [2, 3, 4, 6]) {
    const s = seatLayout(n, { width: W, height: H });
    assert(s.length === n, `count ${n}`);
    assert(Math.abs(s[0].x - W / 2) < 1 && s[0].y > H / 2, 'hero bottom-centre');
    assert(s.every(p => p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H), 'within bounds');
  }
});
test('towardCenter interpolates toward the table centre', () => {
  const s = seatLayout(2, { width: 900, height: 560 })[0];
  const mid = towardCenter(s, 900, 560, 0.5);
  assert(Math.abs(mid.x - (s.x + 450) / 2) < 1 && Math.abs(mid.y - (s.y + 280) / 2) < 1, 'midpoint');
  const full = towardCenter(s, 900, 560, 1);
  assert(Math.abs(full.x - 450) < 1 && Math.abs(full.y - 280) < 1, 't=1 reaches centre');
});

console.log('Table surface');

test('table draws felt, stitched rail, betting line, and watermark', () => {
  const svg = tableSVG({ width: 800, height: 500 });
  assert(svg.includes('radialGradient'), 'felt shading');
  assert(svg.includes('feTurbulence'), 'felt noise');
  assert(count(svg, /stroke-dasharray/g) >= 2, 'rail stitching + betting line');
  assert(svg.includes('class="watermark"'), 'centre watermark');
});

console.log('HUD (spec 3.5)');

test('pot odds and equity format as percentages', () => {
  assert(potOddsPct(100, 300) === '25%', 'pot odds 100 into 300');
  assert(potOddsPct(0, 0) === '\u2014', 'no action');
  assert(equityPct(0.632) === '63%' && equityPct(null) === '\u2014', 'equity');
});
test('hand-rank hint reads made hands and preflop holdings', () => {
  const madeFlush = handRankHint(cards('Ah Kh'), cards('Qh 7h 2h'));
  assert(/flush/i.test(madeFlush), `flush detected: ${madeFlush}`);
  assert(/Pair of As/i.test(handRankHint(cards('As Ad'), [])), 'preflop pocket pair');
  assert(/suited/i.test(handRankHint(cards('Ah Kh'), [])), 'preflop suited');
});
test('hud panel renders the three values', () => {
  const h = hudHTML({ potOdds: '25%', equity: '63%', hint: 'Flush' });
  assert(h.includes('hud-panel') && h.includes('25%') && h.includes('63%') && h.includes('Flush'), 'panel content');
});

console.log('Scene composition');

const snapshot = {
  pot: 1387, board: cards('Ah Kd 7c'), heroSeat: 0,
  seats: [
    { name: 'You', stack: 4200, committed: 200, holeCards: cards('As Qs'), isButton: false, isActive: true },
    { name: 'Rock', stack: 3800, committed: 200, cardCount: 2, folded: false },
    { name: 'Maniac', stack: 0, committed: 1000, cardCount: 2, allIn: true },
    { name: 'Shark', stack: 5100, committed: 0, cardCount: 2, folded: true, isButton: true },
  ],
};

test('scene places board, pot, seat names, and the dealer button', () => {
  const html = sceneHTML(snapshot, { hud: { potOdds: '25%', equity: '58%', hint: 'Top pair' } });
  assert(html.includes('poker-table'), 'table surface');
  assert(html.includes('Pot 1,387'), 'pot label');
  for (const n of ['You', 'Rock', 'Maniac', 'Shark']) assert(html.includes(`>${n}</div>`), `seat ${n}`);
  assert(html.includes('class="dealer"'), 'dealer button');
  assert(html.includes('hud-panel'), 'HUD mounted');
});
test('hero sees card faces; opponents show backs', () => {
  const html = sceneHTML(snapshot);
  assert(html.includes('data-card="As"') && html.includes('data-card="Qs"'), 'hero hole cards as faces');
  assert(count(html, /data-card="back"/g) >= 6, 'three live opponents × 2 backs');
  assert(html.includes('data-card="Ah"'), 'board card rendered');
});
test('all-in and folded states are marked', () => {
  const html = sceneHTML(snapshot);
  assert(html.includes('seat-plate hero active') || html.includes('hero') && html.includes('active'), 'hero + active');
  assert(/seat-plate[^"]*allin/.test(html), 'all-in seat');
  assert(/seat-plate[^"]*folded/.test(html), 'folded seat');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
