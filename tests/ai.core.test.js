// ai.core.test.js — runnable in Node (node tests/...).
//
// Phase 2a: validates the analytical core the decision pipeline will sit on —
// Monte-Carlo equity (against known reference equities, with a fixed seed for
// determinism), preflop ranges (Chen ranking), Bayesian-style range updates,
// and opponent statistics arithmetic.

import { cards } from '../src/engine/index.js';
import {
  equityVsRandom, equityVsRanges, potOdds, mulberry32,
  Range, topPercentRange, chenScore, strengthFraction, comboCount, TOTAL_COMBOS,
  OpponentStats, reweightByPreflopAction, updateOnShowdown,
} from '../src/ai/index.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  \u2713 ${name}`); passed++; }
  catch (e) { console.error(`  \u2717 ${name}\n      ${e.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function near(a, b, tol, msg) { assert(Math.abs(a - b) <= tol, `${msg || ''} expected ~${b} (±${tol}) got ${a.toFixed(4)}`); }

const SEED = 0xC0FFEE;
const keyRange = key => new Range().set(key, 1);

console.log('Monte-Carlo equity');

test('AA vs 1 random opponent \u2248 0.85', () => {
  const r = equityVsRandom(cards('As Ah'), [], 1, { samples: 12000, seed: SEED });
  near(r.equity, 0.852, 0.03, 'AA vs random');
});
test('AA vs KK \u2248 0.82', () => {
  const r = equityVsRanges(cards('As Ah'), [], [keyRange('KK')], { samples: 12000, seed: SEED });
  near(r.equity, 0.82, 0.03, 'AA vs KK');
});
test('AKs vs QQ is a near coin-flip (\u2248 0.46)', () => {
  const r = equityVsRanges(cards('As Ks'), [], [keyRange('QQ')], { samples: 12000, seed: SEED });
  near(r.equity, 0.46, 0.04, 'AKs vs QQ');
});
test('AA crushes 72o (\u2248 0.88)', () => {
  const r = equityVsRanges(cards('As Ah'), [], [keyRange('72o')], { samples: 12000, seed: SEED });
  near(r.equity, 0.88, 0.03, 'AA vs 72o');
});
test('the nuts on a full board is exactly 1.0', () => {
  // hero holds quad aces on a completed board; nothing can beat or tie it
  const r = equityVsRandom(cards('As Ad'), cards('Ah Ac Kd 2s 3h'), 1, { samples: 400, seed: SEED });
  assert(r.equity === 1, `expected 1.0 got ${r.equity}`);
});
test('a royal flush on the board splits with one opponent (0.5)', () => {
  const r = equityVsRandom(cards('2c 3c'), cards('As Ks Qs Js Ts'), 1, { samples: 400, seed: SEED });
  near(r.equity, 0.5, 1e-9, 'everyone plays the board');
});
test('equity drops as opponents are added', () => {
  const a = equityVsRandom(cards('As Ah'), [], 1, { samples: 8000, seed: SEED }).equity;
  const b = equityVsRandom(cards('As Ah'), [], 4, { samples: 8000, seed: SEED }).equity;
  assert(a > b, `1-opp (${a.toFixed(3)}) should exceed 4-opp (${b.toFixed(3)})`);
});
test('a fixed seed is reproducible', () => {
  const o = { samples: 3000, seed: 42 };
  assert(equityVsRandom(cards('Jh Tc'), [], 2, o).equity === equityVsRandom(cards('Jh Tc'), [], 2, o).equity);
});
test('pot odds', () => {
  near(potOdds(50, 150), 0.25, 1e-9, '50 to win 200');
  assert(potOdds(0, 100) === 0, 'nothing to call → 0');
});

console.log('Preflop ranges (Chen)');

test('Chen ranks AA > KK > 72o', () => {
  assert(chenScore('AA') > chenScore('KK'), 'AA > KK');
  assert(chenScore('KK') > chenScore('72o'), 'KK > 72o');
  assert(strengthFraction('AA') === 1, 'AA is the strongest (fraction 1)');
});
test('top 10% range holds premiums, drops trash', () => {
  const r = topPercentRange(0.10);
  assert(r.get('AA') > 0 && r.get('KK') > 0 && r.get('AKs') > 0, 'premiums present');
  assert(r.get('72o') === 0 && r.get('32o') === 0, 'trash excluded');
  const frac = r.keys().reduce((n, k) => n + comboCount(k), 0) / TOTAL_COMBOS;
  assert(frac >= 0.04 && frac <= 0.2, `~10% by combos; got ${(frac * 100).toFixed(1)}%`);
});
test('Range.combos excludes dead cards', () => {
  assert(keyRange('AA').combos([]).length === 6, 'AA has 6 combos');
  assert(keyRange('AA').combos(cards('As')).length === 3, 'removing the As leaves 3');
});

console.log('Bayesian range updates');

test('a preflop raise tightens the range; a check loosens it', () => {
  const base = topPercentRange(0.5);
  const raised = reweightByPreflopAction(base, 'raise');
  const checked = reweightByPreflopAction(base, 'check');
  assert(raised.meanChen() > base.meanChen(), 'raise → stronger mean');
  assert(checked.meanChen() < base.meanChen(), 'check → weaker mean');
});
test('a showdown observation concentrates weight on the shown hand', () => {
  const base = topPercentRange(0.5);
  const after = updateOnShowdown(base, 'AA', 5);
  assert(after.get('AA') === 5, `AA weight boosted; got ${after.get('AA')}`);
  assert(after.get('AA') > after.get('KK'), 'shown hand outweighs neighbours');
});

console.log('Opponent statistics');

test('VPIP / PFR / AF / c-bet compute correctly', () => {
  const s = new OpponentStats();
  for (let i = 0; i < 7; i++) s.recordHand({ voluntaryPutIn: false, raisedPreflop: false });
  s.recordHand({ voluntaryPutIn: true, raisedPreflop: false });
  s.recordHand({ voluntaryPutIn: true, raisedPreflop: true });
  s.recordHand({ voluntaryPutIn: true, raisedPreflop: true });
  ['bet', 'bet', 'bet', 'raise', 'raise', 'call', 'call', 'call', 'call', 'call'].forEach(a => s.recordAction(a));
  [true, true, true, false].forEach(m => s.recordCbetOpportunity(m));
  near(s.VPIP, 0.30, 1e-9, 'VPIP');
  near(s.PFR, 0.20, 1e-9, 'PFR');
  near(s.AF, 1.0, 1e-9, 'AF = (3+2)/5');
  near(s.cbet, 0.75, 1e-9, 'c-bet 3/4');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
