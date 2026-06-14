// engine.orchestration.test.js — runnable in Node (node tests/...).
//
// Covers spec Document-5 items at the orchestration layer:
//  • an incomplete all-in raise does NOT reopen the action (and a full one does),
//  • all-in run-out reaches showdown with a complete board,
//  • uncontested win pays without a showdown,
//  • the anti-cheat view never leaks opponents' hole cards,
//  • a full hand drives PREFLOP→…→PAYOUT with chips conserved.

import { HoldemEngine, ActionType, GameState, parseCard } from '../src/engine/index.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  \u2713 ${name}`); passed++; }
  catch (e) { console.error(`  \u2717 ${name}\n      ${e.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
const FOLD = { type: ActionType.FOLD };
const CHECK = { type: ActionType.CHECK };
const CALL = { type: ActionType.CALL };
const raiseTo = n => ({ type: ActionType.RAISE, amount: n });

// Deterministic deck for replayable showdowns. Draws in fixed order.
class StackedDeck {
  constructor(list) { this.cards = list.map(parseCard); this.i = 0; this.drawn = []; }
  draw(n = 1) { const out = this.cards.slice(this.i, this.i + n); this.i += n; this.drawn.push(...out); return n === 1 ? out[0] : out; }
  burn() { return this.draw(1); }
}
const chips = e => e.seats.reduce((s, p) => s + p.stack, 0);

console.log('Betting rules');

test('incomplete all-in raise does NOT reopen the action', () => {
  // 3-handed, button=0 → SB=1, BB=2, first to act preflop = button (seat 0).
  const e = new HoldemEngine({
    seats: [{ id: 'A', stack: 1000 }, { id: 'B', stack: 1000 }, { id: 'C', stack: 270 }],
    smallBlind: 50, bigBlind: 100, button: 0,
  });
  e.startHand();
  assert(e.currentActor() === 0, `button acts first 3-handed; actor=${e.currentActor()}`);
  e.applyAction(0, raiseTo(200));   // A: full raise (increment 100 = min) → minRaise stays 100
  e.applyAction(1, CALL);           // B: calls 200
  // C (BB) has 170 behind over a 100 blind; a full raise needs 300 but C can only reach 270 → SHORT all-in.
  const cView = e.legalActions(2);
  assert(cView.raiseAllInOnly === true, 'C can only raise all-in (short)');
  e.applyAction(2, raiseTo(270));   // C: incomplete all-in raise
  // Action returns to A, who already acted. The short all-in must NOT let A re-raise.
  assert(e.currentActor() === 0, `back to A; actor=${e.currentActor()}`);
  const aView = e.legalActions(0);
  assert(aView.canRaise === false, 'A must NOT be able to raise after a short all-in');
  assert(aView.canCall === true && aView.callAmount === 70, `A may only call 70; got ${aView.callAmount}`);
  assert(e.minRaise === 100, `minRaise must stay 100 (unchanged by short all-in); got ${e.minRaise}`);
});

test('a FULL raise DOES reopen the action', () => {
  const e = new HoldemEngine({
    seats: [{ id: 'A', stack: 1000 }, { id: 'B', stack: 1000 }, { id: 'C', stack: 1000 }],
    smallBlind: 50, bigBlind: 100, button: 0,
  });
  e.startHand();
  e.applyAction(0, raiseTo(200)); // A full raise
  e.applyAction(1, CALL);         // B calls
  e.applyAction(2, raiseTo(400)); // C full re-raise (increment 200) → reopens
  assert(e.currentActor() === 0, 'back to A');
  const aView = e.legalActions(0);
  assert(aView.canRaise === true, 'A may raise again after a full re-raise');
  assert(aView.minRaiseTo === 600, `min re-raise = 400 + 200 = 600; got ${aView.minRaiseTo}`);
});

console.log('Run-out / uncontested');

test('uncontested win pays the last player standing, no showdown', () => {
  const e = new HoldemEngine({
    seats: [{ id: 'A', stack: 1000 }, { id: 'B', stack: 1000 }, { id: 'C', stack: 1000 }],
    smallBlind: 50, bigBlind: 100, button: 0,
  });
  const start = chips(e);
  e.startHand();              // SB=B(50), BB=C(100)
  e.applyAction(0, FOLD);     // A folds
  e.applyAction(1, FOLD);     // B (SB) folds → only C remains
  assert(e.state === GameState.PAYOUT, `state=${e.state}`);
  assert(e.seats[2].stack === 1050, `C wins blinds → 1050; got ${e.seats[2].stack}`);
  assert(e.seats[1].stack === 950 && e.seats[0].stack === 1000, 'B loses SB, A untouched');
  assert(e.board.length === 0, 'no community cards on an uncontested win');
  assert(chips(e) === start, 'chips conserved');
});

test('all-in run-out deals a full board and reaches payout', () => {
  // Heads-up, button=0 → A is SB/button, B is BB. Stacked so A makes trip aces.
  const deck = ['2c', 'As', '7d', 'Ah', '3s', 'Ad', 'Kh', 'Qc', '4s', '9h', '5s', 'Tc'];
  const e = new HoldemEngine({
    seats: [{ id: 'A', stack: 1000 }, { id: 'B', stack: 1000 }],
    smallBlind: 50, bigBlind: 100, button: 0,
    deckFactory: () => new StackedDeck(deck),
  });
  e.startHand();
  assert(e.currentActor() === 0, 'SB/button acts first preflop heads-up');
  e.applyAction(0, raiseTo(1000)); // A shoves
  e.applyAction(1, CALL);          // B calls all-in
  assert(e.board.length === 5, `board should be run out to 5; got ${e.board.length}`);
  assert(e.state === GameState.PAYOUT, `state=${e.state}`);
  assert(e.seats[0].stack === 2000 && e.seats[1].stack === 0, `A (trip aces) wins 2000; got ${e.seats[0].stack}/${e.seats[1].stack}`);
  assert(chips(e) === 2000, 'chips conserved');
});

console.log('Anti-cheat view');

test('getView never exposes opponents\u2019 hole cards', () => {
  const e = new HoldemEngine({
    seats: [{ id: 'A', stack: 1000 }, { id: 'B', stack: 1000 }],
    smallBlind: 50, bigBlind: 100, button: 0,
  });
  e.startHand();
  const v = e.getView(0);
  assert(v.you.holeCards.length === 2, 'I can see my own 2 cards');
  const opp = v.players.find(p => p.seat === 1);
  assert(opp.holeCards === null, "opponent's hole cards must be hidden");
  assert(opp.cardCount === 2, 'but I can see the opponent HAS 2 cards');
});

console.log('Full hand');

test('a checked-down hand runs PREFLOP\u2192\u2026\u2192PAYOUT with chips conserved', () => {
  const deck = ['2c', 'As', '7d', 'Ah', '3s', 'Ad', 'Kh', 'Qc', '4s', '9h', '5s', 'Tc'];
  const states = [];
  const e = new HoldemEngine({
    seats: [{ id: 'A', stack: 1000 }, { id: 'B', stack: 1000 }],
    smallBlind: 50, bigBlind: 100, button: 0,
    deckFactory: () => new StackedDeck(deck),
    onEvent: ev => { if (ev.type === 'STATE') states.push(ev.state); },
  });
  e.startHand();
  e.applyAction(0, CALL);   // A (SB) completes
  e.applyAction(1, CHECK);  // B (BB) checks → flop
  e.applyAction(1, CHECK); e.applyAction(0, CHECK); // flop checked (BB first postflop HU)
  e.applyAction(1, CHECK); e.applyAction(0, CHECK); // turn checked
  e.applyAction(1, CHECK); e.applyAction(0, CHECK); // river checked → showdown
  assert(e.state === GameState.PAYOUT, `state=${e.state}`);
  assert(e.board.length === 5, 'full board');
  assert(e.seats[0].stack === 1100 && e.seats[1].stack === 900, `A (trip aces) wins the 200 pot; got ${e.seats[0].stack}/${e.seats[1].stack}`);
  assert(chips(e) === 2000, 'chips conserved');
  assert(JSON.stringify(states) === JSON.stringify(['PREFLOP', 'FLOP', 'TURN', 'RIVER', 'SHOWDOWN', 'PAYOUT']),
    `state progression was ${states.join(' → ')}`);
});

test('button rotates and blinds re-post across two hands', () => {
  const e = new HoldemEngine({
    seats: [{ id: 'A', stack: 1000 }, { id: 'B', stack: 1000 }, { id: 'C', stack: 1000 }],
    smallBlind: 50, bigBlind: 100, button: 0,
  });
  e.startHand();
  assert(e.buttonSeat === 0 && e.sbSeat === 1 && e.bbSeat === 2, 'hand 1 positions');
  e.applyAction(0, FOLD); e.applyAction(1, FOLD); // end hand 1 quickly
  e.startHand();
  assert(e.buttonSeat === 1 && e.sbSeat === 2 && e.bbSeat === 0, `hand 2 button should advance; got btn=${e.buttonSeat}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
