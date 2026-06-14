// render.chips.test.js — runnable in Node (node tests/...).
//
// Phase 4a: chip denomination logic, stack layout geometry, and the structure
// of the code-drawn SVG. Visual quality is checked in the generated preview
// (demo/chips.html); this suite locks the pure logic and the SVG contract.

import { chipBreakdown, chipsForAmount, chipStyle, chipSVG, stackLayout, CHIP_DENOMINATIONS } from '../src/render/index.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  \u2713 ${name}`); passed++; }
  catch (e) { console.error(`  \u2717 ${name}\n      ${e.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
const sum = b => b.reduce((s, x) => s + x.value * x.count, 0);

console.log('Denomination breakdown (spec 3.2)');

test('greedy breakdown reconstructs the amount, largest-first', () => {
  const b = chipBreakdown(1387);
  assert(JSON.stringify(b) === JSON.stringify([{ value: 1000, count: 1 }, { value: 100, count: 3 }, { value: 25, count: 3 }, { value: 5, count: 2 }, { value: 1, count: 2 }]), JSON.stringify(b));
  assert(sum(b) === 1387, 'sum');
});
test('empty and exact amounts', () => {
  assert(chipBreakdown(0).length === 0, 'zero → no chips');
  assert(JSON.stringify(chipBreakdown(100)) === JSON.stringify([{ value: 100, count: 1 }]), 'exact denom');
  for (let a = 1; a < 600; a += 37) assert(sum(chipBreakdown(a)) === a, `reconstruct ${a}`);
});
test('chipsForAmount flattens to the right count and sum', () => {
  const flat = chipsForAmount(1387);
  assert(flat.length === 11 && flat.reduce((s, v) => s + v, 0) === 1387, `len ${flat.length}`);
  assert(flat[0] === 1000, 'largest first');
});
test('chipStyle resolves colours; unknown value throws', () => {
  assert(chipStyle(25).face === '#1e7a46' && chipStyle(1000).name === 'gold', 'palette');
  let threw = false; try { chipStyle(7); } catch { threw = true; }
  assert(threw, 'unknown denomination throws');
});

console.log('SVG structure (spec 3.2)');

test('a chip draws shadow, sheen, ring, monogram, and N edge spots', () => {
  const svg = chipSVG(1000, { spots: 8 });
  assert(svg.includes('data-value="1000"') && svg.includes('>1K<'), 'value + label');
  assert(svg.includes('feDropShadow'), 'drop shadow');
  assert(svg.includes('radialGradient'), 'face sheen gradient');
  assert((svg.match(/class="edge-spot"/g) || []).length === 8, 'eight edge spots');
  assert(svg.includes('stroke-width="2"'), 'denomination ring');
});
test('edge-spot count is configurable (6–8)', () => {
  assert((chipSVG(5, { spots: 6 }).match(/class="edge-spot"/g) || []).length === 6, 'six spots');
});
test('unique gradient/filter ids per chip avoid collisions on one page', () => {
  const a = chipSVG(100), b = chipSVG(100);
  const idA = a.match(/id="([^"]+)-sheen"/)[1], idB = b.match(/id="([^"]+)-sheen"/)[1];
  assert(idA !== idB, `ids should differ: ${idA} vs ${idB}`);
});

console.log('Stack layout (spec 3.2)');

test('multi-column split past 20 chips', () => {
  const pos = stackLayout(47);
  assert(pos.length === 47, 'count');
  assert(pos[19].col === 0 && pos[20].col === 1 && pos[20].row === 0, '21st chip starts column 1');
  assert(pos[46].col === 2, '47th chip in column 2');
  const cols = new Set(pos.map(p => p.col));
  assert(cols.size === 3, `three columns, got ${cols.size}`);
});
test('every chip gets a 1–3px jitter', () => {
  for (const p of stackLayout(60)) assert(Math.abs(p.jitterX) >= 1 && Math.abs(p.jitterX) <= 3, `jitter ${p.jitterX}`);
});
test('layout is deterministic under an injected rng', () => {
  const pos = stackLayout(5, { rng: () => 0.5 });
  assert(pos.every(p => p.jitterX === 2), `fixed rng → jitter 2, got ${pos.map(p => p.jitterX)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
