// engine.value-layer.test.js — runnable in Node (node tests/...).
//
// Covers the spec Document-5 acceptance items reachable at the value layer:
// hand ranking incl. wheel + full kicker tiebreaks, board-play split, multi-way
// side pots, and the odd-chip rule. Plus category-ordering and shuffle validity.

import {
  cards, cardToString,
  Deck, randomInt,
  evaluate7, compareScores,
  buildPots, distribute, seatOrderFromButton,
} from '../src/engine/index.js';

// WebCrypto polyfill so the crypto shuffle runs under older Node, while the
// engine file itself stays browser-pure. (No-op on Node 19+ / browsers.)
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.getRandomValues) {
  const { webcrypto } = await import('node:crypto');
  globalThis.crypto = webcrypto;
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  \u2713 ${name}`); passed++; }
  catch (e) { console.error(`  \u2717 ${name}\n      ${e.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eqArr(a, b, msg) {
  assert(JSON.stringify(a) === JSON.stringify(b), `${msg || ''} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`);
}

const score = s => evaluate7(cards(s)).score;
const beats = (a, b) => compareScores(score(a), score(b)) > 0;

console.log('Hand evaluator');

test('wheel A-2-3-4-5 loses to 6-high straight', () => {
  assert(beats('6c 5d 4h 3s 2c', 'Ah 5c 4d 3h 2s'), '6-high must beat the wheel');
});
test('wheel is a 5-high straight (not ace-high)', () => {
  eqArr(evaluate7(cards('Ah 5c 4d 3h 2s')).score, [4, 5]);
});
test('straight flush beats four of a kind', () => {
  assert(beats('9h 8h 7h 6h 5h', 'Ac Ad Ah As Kc'));
});
test('royal flush is labelled and unbeaten by king-high SF', () => {
  const royal = evaluate7(cards('Ah Kh Qh Jh Th'));
  assert(royal.name === 'Royal Flush', `name was ${royal.name}`);
  assert(beats('Ah Kh Qh Jh Th', 'Kh Qh Jh Th 9h'));
});
test('full house: trips first, then pair', () => {
  assert(beats('Kc Kd Kh Tc Td', 'Tc Td Th Kc Kd')); // KKK·TT > TTT·KK
});
test('flush high-card tiebreak', () => {
  assert(beats('Ac Tc 8c 5c 3c', 'Kc Qc 8c 5c 3c'));
});
test('one pair kicker tiebreak', () => {
  assert(beats('Ah Ad Kc Qd Jh', 'Ah Ad Kc Qd Th'));
});
test('two pair tiebreak (top, bottom, kicker)', () => {
  assert(beats('Ah Ad 5c 5d Kh', 'Kh Kd 5c 5d Ah')); // AA55K > KK55A
  assert(beats('Ah Ad 5c 5d Qh', 'Ah Ad 4c 4d Kh')); // AA55 > AA44 (bottom pair wins)
});
test('evaluate7 selects best 5 of 7 (flush over two pair)', () => {
  assert(evaluate7(cards('Ac Kc 9c 4c 2c Kd 9d')).category === 5);
});
test('evaluate7 finds the wheel inside 7 cards', () => {
  eqArr(evaluate7(cards('Ah 2c 3d 4s 5h Kd Qc')).score, [4, 5]);
});
test('identical board-play hands tie', () => {
  const board = cards('Ah Kh Qh Jh Th');
  const p1 = evaluate7([...board, ...cards('2c 3d')]).score;
  const p2 = evaluate7([...board, ...cards('2s 3h')]).score;
  assert(compareScores(p1, p2) === 0, 'board play must tie');
});
test('full category ordering chain', () => {
  const chain = [
    'Ah Kh Qh Jh Th', // 8 royal / straight flush
    'Ac Ad Ah As Kd', // 7 quads
    'Kc Kd Kh Qc Qd', // 6 full house
    'Ac Tc 8c 5c 3c', // 5 flush
    '6c 5d 4h 3s 2c', // 4 straight
    'Qc Qd Qh 9c 7d', // 3 trips
    'Ah Ad 5c 5d Kh', // 2 two pair
    'Ah Ad Kc Qd Jh', // 1 one pair
    'Ah Kd 9c 7s 5h', // 0 high card
  ];
  for (let i = 0; i < chain.length - 1; i++) {
    assert(compareScores(score(chain[i]), score(chain[i + 1])) > 0, `${chain[i]} should beat ${chain[i + 1]}`);
  }
});

console.log('Pot manager');

test('single pot, one winner takes all', () => {
  const pots = buildPots([
    { playerId: 'A', committed: 100, folded: false },
    { playerId: 'B', committed: 100, folded: false },
  ]);
  eqArr(pots.map(p => p.amount), [200]);
  const scores = new Map([['A', score('Ah Ad Kc Qd Jh')], ['B', score('Kh Kd Qc Jd Th')]]);
  const { payouts } = distribute(pots, scores, ['A', 'B']);
  assert(payouts.get('A') === 200 && !payouts.get('B'), 'A wins all 200');
});
test('split pot, even amount', () => {
  const pots = buildPots([
    { playerId: 'A', committed: 100, folded: false },
    { playerId: 'B', committed: 100, folded: false },
  ]);
  const tie = score('Ah Kh Qh Jh Th');
  const { payouts } = distribute(pots, new Map([['A', tie], ['B', tie]]), ['A', 'B']);
  assert(payouts.get('A') === 100 && payouts.get('B') === 100);
});
test('odd chip goes to first seat left of button', () => {
  const tie = score('Ah Kh Qh Jh Th');
  const order = seatOrderFromButton(
    [{ playerId: 'A', seat: 0 }, { playerId: 'B', seat: 1 }], /*button*/0, /*seats*/2);
  eqArr(order, ['B', 'A'], 'order starts left of button');
  const { payouts } = distribute([{ amount: 101, eligible: ['A', 'B'] }],
    new Map([['A', tie], ['B', tie]]), order);
  assert(payouts.get('B') === 51 && payouts.get('A') === 50, 'B (left of button) gets the odd chip');
});
test('board-play splits among 3 survivors (leftover chips from button)', () => {
  const tie = score('Ah Kh Qh Jh Th');
  const order = seatOrderFromButton(
    [{ playerId: 'A', seat: 0 }, { playerId: 'B', seat: 1 }, { playerId: 'C', seat: 2 }], 0, 3);
  eqArr(order, ['B', 'C', 'A']);
  const { payouts } = distribute([{ amount: 302, eligible: ['A', 'B', 'C'] }],
    new Map([['A', tie], ['B', tie], ['C', tie]]), order);
  assert(payouts.get('B') === 101 && payouts.get('C') === 101 && payouts.get('A') === 100, '101/101/100');
});
test('3-way all-in builds correct main/side pots', () => {
  const pots = buildPots([
    { playerId: 'A', committed: 100, folded: false },
    { playerId: 'B', committed: 200, folded: false },
    { playerId: 'C', committed: 300, folded: false },
  ]);
  eqArr(pots.map(p => p.amount), [300, 200, 100], 'main 300 / side1 200 / side2 100');
  eqArr(pots.map(p => p.eligible.length), [3, 2, 1], 'eligibility shrinks by layer');
});
test('3-way all-in distributes per layer by best eligible hand', () => {
  const pots = buildPots([
    { playerId: 'A', committed: 100, folded: false }, // shortest stack, best hand
    { playerId: 'B', committed: 200, folded: false },
    { playerId: 'C', committed: 300, folded: false },
  ]);
  const scores = new Map([
    ['A', score('Ah Ad Ac As 2d')], // quad aces  (best overall)
    ['B', score('Kh Kd Kc Ks 3d')], // quad kings
    ['C', score('Qh Qd Qc Qs 4d')], // quad queens
  ]);
  const order = seatOrderFromButton(
    [{ playerId: 'A', seat: 0 }, { playerId: 'B', seat: 1 }, { playerId: 'C', seat: 2 }], 0, 3);
  const { payouts } = distribute(pots, scores, order);
  assert(payouts.get('A') === 300, `main→A: got ${payouts.get('A')}`);  // eligible everywhere but only wins main
  assert(payouts.get('B') === 200, `side1→B: got ${payouts.get('B')}`); // best of {B,C}
  assert(payouts.get('C') === 100, `side2→C: got ${payouts.get('C')}`); // only contender
});
test('folded contributor funds the pot but cannot win', () => {
  const pots = buildPots([
    { playerId: 'A', committed: 100, folded: true },  // folds AFTER committing 100
    { playerId: 'B', committed: 100, folded: false },
    { playerId: 'C', committed: 100, folded: false },
  ]);
  eqArr(pots.map(p => p.amount), [300], 'folded chips still in the pot');
  assert(pots[0].eligible.length === 2 && !pots[0].eligible.includes('A'), 'A is not eligible');
  const scores = new Map([['B', score('Ah Ad Kc Qd Jh')], ['C', score('Kh Kd Qc Jd Th')]]);
  const { payouts } = distribute(pots, scores, ['B', 'C']);
  assert(payouts.get('B') === 300 && !payouts.get('A'), 'B wins all 300; A gets nothing');
});

console.log('Deck / shuffle');

test('shuffle yields a valid 52-card permutation', () => {
  for (let trial = 0; trial < 5; trial++) {
    const d = new Deck().shuffle();
    assert(d.remaining === 52, 'should hold 52 cards');
    assert(new Set(d.cards.map(cardToString)).size === 52, 'all 52 unique');
  }
});
test('randomInt is in range and roughly uniform', () => {
  const N = 6, counts = new Array(N).fill(0), trials = 60000;
  for (let i = 0; i < trials; i++) { const x = randomInt(N); assert(x >= 0 && x < N, 'in range'); counts[x]++; }
  const expected = trials / N;
  for (const c of counts) assert(Math.abs(c - expected) < expected * 0.1, `skew detected: ${counts}`);
});
test('draw and burn reduce remaining', () => {
  const d = new Deck();
  d.burn();
  const hole = d.draw(2);
  assert(hole.length === 2 && d.remaining === 49, `remaining was ${d.remaining}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
