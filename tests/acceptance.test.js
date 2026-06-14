// acceptance.test.js — runnable in Node (node tests/...).
//
// Phase 6c: the spec Doc-5 acceptance checklist, automated end-to-end against the
// real modules. Each block maps to one checklist item. The few things that can't
// be asserted in Node (true on-screen 60fps, the visual feel) are covered by the
// transform/opacity-only check here and the manual notes in ACCEPTANCE.md.

import { HoldemEngine, GameState, evaluate7, compareScores, buildPots, distribute, cards } from '../src/engine/index.js';
import { CognitiveAI, LLMDecider, GeminiClient, OpponentStats, exploitAdjustments } from '../src/ai/index.js';
import { Presenter, Timeline } from '../src/anim/index.js';
import { Controller, AnimMapper, tableGeometry } from '../src/app/index.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { const r = fn(); if (r instanceof Promise) return r.then(() => { console.log(`  \u2713 ${name}`); passed++; }, e => { console.error(`  \u2717 ${name}\n      ${e.message}`); failed++; }); console.log(`  \u2713 ${name}`); passed++; }
  catch (e) { console.error(`  \u2717 ${name}\n      ${e.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

// A deck that yields a fixed sequence (draw(1) → one card, burn() → discard one).
function stackedDeck(cardArr) {
  const arr = cardArr.slice();
  return { draw(n = 1) { const out = arr.splice(0, n); return n === 1 ? out[0] : out; }, burn() { return arr.splice(0, 1)[0]; }, shuffle() { return this; }, get remaining() { return arr.length; } };
}

// Heads-up hand stacked so the flop actor (Hero, BB) holds a weak hand on a dry
// board AND faces a bet — so folding/calling/bluff-raising are all live options.
// seat0='V' (button) bets the flop; the returned view is Hero facing that bet.
function flopJunkView(stack = 5000) {
  const deck = '7d 2c 8h 3s Tc Kd 9c 4h Th Js Td 5c'; // s1c1 s0c1 s1c2 s0c2 | burn flop | burn turn | burn river
  const engine = new HoldemEngine({ seats: [{ id: 'V', stack }, { id: 'Hero', stack }], smallBlind: 50, bigBlind: 100, button: 0, deckFactory: () => stackedDeck(cards(deck)) });
  engine.startHand();
  while (engine.state === GameState.PREFLOP && engine.currentActor() !== null) { const a = engine.currentActor(); const L = engine.legalActions(a); engine.applyAction(a, L.canCheck ? { type: 'check' } : { type: 'call' }); }
  let a = engine.currentActor(); engine.applyAction(a, { type: 'check' });                       // Hero checks the flop
  a = engine.currentActor(); const L = engine.legalActions(a); engine.applyAction(a, { type: 'raise', amount: Math.min(L.maxRaiseTo, 300) }); // V bets
  const actor = engine.currentActor();                                                            // Hero, now facing a bet
  return { engine, actor, view: engine.getView(actor) };
}

console.log('1) Hand ranking — the wheel loses to a 6-high straight');

test('A-2-3-4-5 (5-high) < 2-3-4-5-6 (6-high)', () => {
  const wheel = evaluate7(cards('Ah 2d 3c 4s 5h Kd Qc'));
  const six = evaluate7(cards('2h 3d 4c 5s 6h Kd Qc'));
  assert(wheel.name && six.name, 'both evaluated');
  assert(compareScores(six.score, wheel.score) > 0, 'six-high beats the wheel');
  assert(compareScores(wheel.score, six.score) < 0, 'wheel loses');
});

console.log('2) Board play — all survivors split');

test('when the board is the best five, both players split and stacks return even', () => {
  // Broadway on board (T J Q K A), both hole hands junk → both play the board.
  const deck = '2c 3d 4h 5d 7c Ts Jh Qd 8c Kc 9c As';
  let win = null;
  const engine = new HoldemEngine({ seats: [{ id: 'A', stack: 1000 }, { id: 'B', stack: 1000 }], smallBlind: 50, bigBlind: 100, button: 0, deckFactory: () => stackedDeck(cards(deck)), onEvent: e => { if (e.type === 'WIN') win = e; } });
  engine.startHand();
  while (engine.currentActor() !== null) { const a = engine.currentActor(); const L = engine.legalActions(a); engine.applyAction(a, L.canCheck ? { type: 'check' } : { type: 'call' }); }
  assert(engine.seats[0].stack === 1000 && engine.seats[1].stack === 1000, `even split restores stacks (got ${engine.seats.map(s => s.stack)})`);
  assert(win && win.payouts, 'a WIN with payouts was emitted');
});

console.log('3) Side pots — three all-in stacks split into main/side correctly');

test('contributions 100/300/300 build a 300 main (all eligible) and a 400 side (B,C)', () => {
  const pots = buildPots([{ playerId: 0, committed: 100, folded: false }, { playerId: 1, committed: 300, folded: false }, { playerId: 2, committed: 300, folded: false }]);
  const main = pots[0], side = pots[1];
  assert(main.amount === 300 && main.eligible.length === 3, `main 300 / all eligible (got ${main.amount}, ${main.eligible.length})`);
  assert(side.amount === 400 && side.eligible.length === 2 && !side.eligible.includes(0), `side 400 / only B,C (got ${side.amount})`);
  // A holds the best hand but is only eligible for the main; B beats C for the side.
  const scores = new Map([
    [0, evaluate7(cards('Ah Kh Qh Jh Th 2c 3d')).score], // royal flush
    [1, evaluate7(cards('Ac Ad As Kc Kd 2h 3s')).score], // aces full
    [2, evaluate7(cards('2c 3d 5h 7s 9c Jc Kd')).score], // king high
  ]);
  const { payouts } = distribute(pots, scores, [0, 1, 2]);
  assert(payouts.get(0) === 300, `A wins exactly the main pot (got ${payouts.get(0)})`);
  assert(payouts.get(1) === 400, `B wins the side pot (got ${payouts.get(1)})`);
  assert((payouts.get(2) || 0) === 0, 'C (worst hand) wins nothing');
});

console.log('4) Betting — an incomplete all-in raise does not reopen the action');

test('a short all-in raise leaves prior callers unable to re-raise', () => {
  const engine = new HoldemEngine({ seats: [{ id: 'P0', stack: 1000 }, { id: 'P1', stack: 1000 }, { id: 'P2', stack: 380 }], smallBlind: 50, bigBlind: 100, button: 0 });
  engine.startHand();
  let a = engine.currentActor(); engine.applyAction(a, { type: 'raise', amount: 300 }); // UTG raises to 300
  a = engine.currentActor(); engine.applyAction(a, { type: 'call' });                     // caller matches 300
  a = engine.currentActor(); const L = engine.legalActions(a);
  assert(L.raiseAllInOnly === true, 'short stack can only shove (below a full raise)');
  engine.applyAction(a, { type: 'raise', amount: L.maxRaiseTo });                          // all-in to 380 (raise of 80)
  a = engine.currentActor();
  assert(a !== null, 'action returns to a prior caller');
  assert(engine.legalActions(a).canRaise === false, 'the incomplete shove did not reopen raising');
});

console.log('5) Tilt — a bad beat raises bluffing, which then decays');

test('a bad beat spikes tilt; high tilt raises P(aggressive); 10 hands decay it', () => {
  // (a) trigger
  const ai = CognitiveAI.fromArchetype('Maniac', 5000, { samples: 200, seed: 7, devMode: true });
  ai.state.recordHandResult({ won: false, hadEquityAtShowdown: 0.85, potSize: 1000, startStack: 5000 });
  const peak = ai.state.tiltLevel;
  assert(peak > 0.2, `bad beat spiked tilt (got ${peak.toFixed(2)})`);
  // (b) effect: the same weak hand facing a bet, decided at zero vs high tilt
  const { view } = flopJunkView();
  const calm = CognitiveAI.fromArchetype('Shark', 5000, { samples: 600, seed: 11, devMode: true });
  const tilted = CognitiveAI.fromArchetype('Shark', 5000, { samples: 600, seed: 11, devMode: true });
  tilted.state.tiltLevel = 0.6;
  calm.decide(view); tilted.decide(view);
  assert(tilted.lastTrace.distribution.aggressive > calm.lastTrace.distribution.aggressive, `tilt raised bluffing (${calm.lastTrace.distribution.aggressive.toFixed(3)} → ${tilted.lastTrace.distribution.aggressive.toFixed(3)})`);
  assert(tilted.lastTrace.distribution.fold < calm.lastTrace.distribution.fold, `tilt lowered folding (${calm.lastTrace.distribution.fold.toFixed(3)} → ${tilted.lastTrace.distribution.fold.toFixed(3)})`);
  // (c) decay over uneventful hands (no fresh triggers) — the ×0.92/hand cool-off
  for (let i = 0; i < 10; i++) ai.state.recordHandResult({ won: true, netChips: 0 });
  assert(ai.state.tiltLevel < peak * 0.5, `tilt decayed within 10 hands (${peak.toFixed(2)} → ${ai.state.tiltLevel.toFixed(2)})`);
});

console.log('6) Exploit — the Shark bluffs more against a foldy/passive opponent');

test('a passive opponent (AF<1, ≥10 hands) widens bluffs; the Shark acts on it', () => {
  const foldy = new OpponentStats(); foldy.hands = 15; foldy.calls = 10; // AF = 0
  assert(exploitAdjustments(foldy).bluffWiden > 0, 'foldy read → bluffWiden > 0');
  const loose = new OpponentStats(); loose.hands = 20; loose.vpip = 12; // VPIP 0.6
  assert(exploitAdjustments(loose).valueWiden > 0, 'loose read → valueWiden > 0');
  // integration: same view, one Shark reads 'V' as foldy, the control has no read
  const { view } = flopJunkView();
  const reader = CognitiveAI.fromArchetype('Shark', 5000, { samples: 400, seed: 21, devMode: true });
  const control = CognitiveAI.fromArchetype('Shark', 5000, { samples: 400, seed: 21, devMode: true });
  const s = reader.getStats('V'); s.hands = 15; s.calls = 10; // foldy/passive
  reader.decide(view); control.decide(view);
  assert(reader.lastTrace.distribution.aggressive > control.lastTrace.distribution.aggressive, `exploit raised the bluff (${control.lastTrace.distribution.aggressive.toFixed(3)} → ${reader.lastTrace.distribution.aggressive.toFixed(3)})`);
});

console.log('7) Gemini — a failing client never stalls the game (fallback)');

test('a throwing/timed-out client yields a legal fallback action', async () => {
  const failing = new GeminiClient({ fetchImpl: () => Promise.reject(new Error('network down')) });
  const d = LLMDecider.fromArchetype('Shark', 5000, { client: failing, apiKey: 'k', fallbackOpts: { samples: 120, seed: 3 }, logger: () => {} });
  const { view } = flopJunkView();
  const action = await d.decide(view);
  assert(['fold', 'check', 'call', 'raise'].includes(action.type), `legal action type (got ${action.type})`);
  assert(action.source === 'fallback', `served by the built-in fallback (got ${action.source})`);
});

test('a full hand with a failing Gemini seat plays to completion', async () => {
  const engine = new HoldemEngine({ seats: [{ id: 'You', stack: 3000 }, { id: 'G', stack: 3000 }, { id: 'R', stack: 3000 }], smallBlind: 25, bigBlind: 50, button: 0 });
  const failing = new GeminiClient({ fetchImpl: () => Promise.reject(new Error('boom')) });
  const seats = [
    { human: true },
    { decider: LLMDecider.fromArchetype('Maniac', 3000, { client: failing, apiKey: 'k', minIntervalMs: 0, fallbackOpts: { samples: 80, seed: 2 }, logger: () => {} }), engine: 'gemini' },
    { decider: CognitiveAI.fromArchetype('Rock', 3000, { samples: 80, seed: 4 }) },
  ];
  const c = new Controller({ engine, seats, heroSeat: 0, askHuman: v => Promise.resolve(v.legal.canCheck ? { type: 'check' } : { type: 'call' }), playAnimations: () => Promise.resolve(), wait: () => Promise.resolve() });
  await c.playHand();
  assert(engine.seats.reduce((s, p) => s + p.stack, 0) === 9000, 'chips conserved through Gemini fallback');
});

console.log('8) Accessibility — reduce motion replaces every animation with an instant cut');

test('reduced motion makes all steps instant (duration 0) and the timeline zero-length', () => {
  const p = new Presenter({ reducedMotion: true });
  const steps = p.presentAll([{ type: 'DEAL', id: 'c0', from: { x: 0, y: 0 }, to: { x: 100, y: 50 }, order: 0 }, { type: 'BET', id: 'b0', from: { x: 0, y: 0 }, to: { x: 50, y: 50 }, order: 0 }, { type: 'FLOP', cards: [{ id: 'f0', from: { x: 0, y: 0 }, to: { x: 80, y: 40 } }, { id: 'f1', from: { x: 0, y: 0 }, to: { x: 140, y: 40 } }, { id: 'f2', from: { x: 0, y: 0 }, to: { x: 200, y: 40 } }] }]);
  assert(steps.length > 0 && steps.every(s => s.duration === 0), 'all steps instant');
  assert(new Timeline(steps, { reducedMotion: true }).duration === 0, 'timeline collapses to 0');
});

console.log('9) 60fps — the animation system only ever drives transform/opacity');

test('no step animates a layout-triggering property', () => {
  const allowed = new Set(['x', 'y', 'rotate', 'rotateY', 'scale', 'opacity']);
  const p = new Presenter();
  const geo = tableGeometry({ seatCount: 3, heroSeat: 0 });
  const mapper = new AnimMapper({ seatCount: 3 });
  const anim = mapper.mapBatch([
    { type: 'DEAL', seat: 0, card: {} }, { type: 'DEAL', seat: 1, card: {} },
    { type: 'POST_BLIND', seat: 1, amount: 50 }, { type: 'FLOP', cards: [{}, {}, {}] }, { type: 'COLLECT', amount: 100, pot: 100 },
  ], geo);
  const steps = p.presentAll(anim);
  for (const s of steps) for (const bag of [s.from, s.to]) if (bag) for (const k of Object.keys(bag)) assert(allowed.has(k), `step "${s.kind}" animates "${k}" — not a transform/opacity property`);
  assert(steps.length > 0, 'produced steps to check');
});

(async () => { await new Promise(r => setTimeout(r, 60)); console.log(`\n${passed} passed, ${failed} failed`); if (failed > 0) process.exit(1); })();
