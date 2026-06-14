// ai.decide.test.js — runnable in Node (node tests/...).
//
// Phase 2b-ii: the assembled decision pipeline. Behavioural tendencies are
// asserted on the (deterministic) action DISTRIBUTION in decide()'s trace —
// precise and fast, no frequency sampling — plus an AI-vs-AI hand driven
// through the real engine to prove decide() always emits a legal action.

import { cards, HoldemEngine, GameState } from '../src/engine/index.js';
import { CognitiveAI, makePersonality } from '../src/ai/index.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  \u2713 ${name}`); passed++; }
  catch (e) { console.error(`  \u2717 ${name}\n      ${e.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

// Build a minimal gameView in the shape decide() reads.
function makeView({ hole, board = '', state = 'FLOP', pot = 200, stack = 1000, currentBet = 0,
  committedRound = 0, minRaise = 100, bigBlind = 100, smallBlind = 50, seat = 0, numOpps = 1,
  actions = [], handNumber = 1 } = {}) {
  const toCall = Math.max(currentBet - committedRound, 0);
  const canCheck = toCall === 0;
  const callAmount = Math.min(toCall, stack);
  const maxRaiseTo = committedRound + stack;
  const fullRaiseTo = currentBet + minRaise;
  const canRaise = maxRaiseTo > currentBet;
  const legal = {
    canFold: true, canCheck, canCall: !canCheck && callAmount > 0, callAmount,
    callIsAllIn: !canCheck && stack <= toCall, canRaise,
    minRaiseTo: canRaise ? Math.min(fullRaiseTo, maxRaiseTo) : null,
    maxRaiseTo: canRaise ? maxRaiseTo : null,
    raiseAllInOnly: canRaise ? fullRaiseTo > maxRaiseTo : false, toCall,
  };
  const players = [{ seat, id: 'hero', folded: false, allIn: false, out: false, committedTotal: committedRound, committedRound, holeCards: null, cardCount: 2 }];
  for (let i = 1; i <= numOpps; i++) players.push({ seat: i, id: 'opp' + i, folded: false, allIn: false, out: false, committedTotal: currentBet, committedRound: currentBet, holeCards: null, cardCount: 2 });
  return {
    handNumber, state, board: board ? cards(board) : [], potTotal: pot, smallBlind, bigBlind,
    currentBet, minRaise, toCall, buttonSeat: 0, sbSeat: 1, bbSeat: 0,
    you: { seat, id: 'hero', stack, holeCards: cards(hole), committedRound, committedTotal: committedRound, folded: false, allIn: false },
    legal, isYourTurn: true, players, actionsThisHand: actions,
  };
}
const ai = (personality, opts = {}) => new CognitiveAI({ personality, samples: 300, seed: 0xABCD, sessionStartStack: 1000, ...opts });
const distOf = (agent, view) => { agent.decide(view); return agent.lastTrace.distribution; };

console.log('decide() legality');

test('decide always returns a legal action', () => {
  const a = ai('Shark', { devMode: true });
  const spots = [
    makeView({ hole: 'As Ah', board: 'Ad Kd 2c', currentBet: 100, pot: 300 }), // facing bet
    makeView({ hole: '7d 2c', board: 'As Kd Qh', currentBet: 0, pot: 200 }),    // can check
    makeView({ hole: 'Kh Qh', board: 'Js Ts 2c', currentBet: 900, committedRound: 50, stack: 200, pot: 1000 }), // raise-all-in-only-ish
  ];
  for (const v of spots) {
    const act = a.decide(v);
    if (act.type === 'raise') assert(v.legal.canRaise && act.amount >= v.legal.minRaiseTo && act.amount <= v.legal.maxRaiseTo, `raise ${act.amount} within [${v.legal.minRaiseTo},${v.legal.maxRaiseTo}]`);
    if (act.type === 'check') assert(v.legal.canCheck, 'check only when allowed');
    if (act.type === 'call') assert(!v.legal.canCheck, 'call only when facing a bet');
    if (act.type === 'fold') assert(v.legal.toCall > 0, 'fold only when facing a bet');
  }
});

console.log('Hand strength → action');

test('a monster rarely folds', () => {
  const d = distOf(ai('Rock'), makeView({ hole: 'As Ah', board: 'Ad Kd 2c', currentBet: 150, pot: 400 }));
  assert((d.fold ?? 0) < 0.2, `fold prob with trips aces should be low; got ${(d.fold ?? 0).toFixed(2)}`);
});
test('a Rock folds trash to a big bet', () => {
  const d = distOf(ai('Rock'), makeView({ hole: '7d 2c', board: 'As Kd Qh', currentBet: 300, pot: 400 }));
  assert(d.fold > 0.6, `Rock should mostly fold; got ${d.fold.toFixed(2)}`);
});

console.log('Archetype differences (same equity path)');

test('a Calling Station folds less than a Rock in the same spot', () => {
  const v = () => makeView({ hole: 'Ts 9s', board: 'As Kd 2c', currentBet: 100, pot: 300 });
  const station = distOf(ai('CallingStation'), v());
  const rock = distOf(ai('Rock'), v());
  assert(station.fold < rock.fold, `station ${station.fold.toFixed(2)} < rock ${rock.fold.toFixed(2)}`);
});
test('higher aggression bets more for value (isolated parameter)', () => {
  const v = () => makeView({ hole: 'Ah Qc', board: 'Qd 7c 2s', currentBet: 0, pot: 200 }); // top pair, can check
  const loud = distOf(ai(makePersonality('Shark', { aggression: 0.9 })), v());
  const quiet = distOf(ai(makePersonality('Shark', { aggression: 0.2 })), v());
  assert(loud.aggressive > quiet.aggressive, `aggressive: loud ${loud.aggressive.toFixed(2)} > quiet ${quiet.aggressive.toFixed(2)}`);
});

console.log('Affect: tilt & prospect-theory risk');

test('tilt makes a player fold less (same hand)', () => {
  const v = () => makeView({ hole: '7d 2c', board: 'As Kd Qh', currentBet: 250, pot: 300 }); // trash vs big bet → calm folds a lot
  const calm = ai('Shark'); const tilted = ai('Shark'); tilted.state.tiltLevel = 0.8;
  const dCalm = distOf(calm, v()); const dTilt = distOf(tilted, v());
  assert(dTilt.fold < dCalm.fold, `tilted ${dTilt.fold.toFixed(2)} < calm ${dCalm.fold.toFixed(2)}`);
});
test('a player who is down (loss domain) gambles more — Prospect Theory', () => {
  const v = () => makeView({ hole: 'Js 9s', board: 'As Kd 4c', currentBet: 120, pot: 300, stack: 1000 });
  const down = ai('Shark', { sessionStartStack: 2000 });  // started at 2000, now 1000 → behind
  const even = ai('Shark', { sessionStartStack: 1000 });  // at reference
  const dDown = distOf(down, v()); const dEven = distOf(even, v());
  assert(dDown.fold < dEven.fold, `down ${dDown.fold.toFixed(2)} < even ${dEven.fold.toFixed(2)} (risk-seeking in losses)`);
});

console.log('Anchoring & Theory of Mind');

test('a larger anchor pulls the raise size up (spec 2.2 D)', () => {
  const v = makeView({ hole: 'Ah Kh', board: 'Kd 7c 2s', currentBet: 100, committedRound: 0, stack: 5000, pot: 300 });
  const a = ai('Rock'); a._anchorHand = v.handNumber;
  a._anchor = 200; const small = a._raiseTo(v);
  a._anchor = 900; const big = a._raiseTo(v);
  assert(big > small, `anchored raise: big ${big} > small ${small}`);
});
test('ToM: a Shark estimates equity vs ranges; a Rock does not', () => {
  const acts = [{ seat: 1, street: 'PREFLOP', type: 'raise', amount: 300, total: 300 }];
  const v = () => makeView({ hole: 'Ah Qc', board: 'Qd 7c 2s', currentBet: 0, pot: 700, actions: acts });
  const shark = ai('Shark'); shark.decide(v());
  const rock = ai('Rock'); rock.decide(v());
  assert(shark.lastTrace.equityVsRange !== null, 'Shark (L2) models opponent ranges');
  assert(rock.lastTrace.equityVsRange === null, 'Rock (L0) uses own hand strength only');
});

console.log('Behavioural tell (spec 2.2 \u2014 \uac01 \uc544\ud0a4\ud0c0\uc785 \uc9c0\uc5f0)');

test('Rock & Shark timing is steady; leaky archetypes vary with strength', () => {
  const rock = ai('Rock'), shark = ai('Shark'), maniac = ai('Maniac'), station = ai('CallingStation');
  assert(rock.tellMean(0.9) === rock.tellMean(0.2), 'Rock steady');
  assert(shark.tellMean(0.9) === shark.tellMean(0.2), 'Shark hides tells (uniform)');
  assert(maniac.tellMean(0.9) !== maniac.tellMean(0.2), 'Maniac leaks');
  assert(station.tellMean(0.9) !== station.tellMean(0.2), 'Calling Station leaks');
  assert(rock.tellMean(0.5) > maniac.tellMean(0.5), 'Rock thinks longer than Maniac');
});

console.log('Dev trace & learning');

test('dev mode attaches a full pipeline trace', () => {
  const a = ai('Shark', { devMode: true });
  const act = a.decide(makeView({ hole: 'As Ah', board: 'Ad Kd 2c', currentBet: 100, pot: 300 }));
  const t = act.trace;
  assert(t && typeof t.equity === 'number' && t.distribution && typeof t.system2Weight === 'number' && 'tilt' in t, 'trace populated');
});
test('observation updates tilt and opponent stats', () => {
  const a = ai('Maniac');
  a.observeHandEnd({ won: false, potSize: 1500, startStack: 2000, hadEquityAtShowdown: 0.85 });
  assert(a.state.tiltLevel > 0, 'bad beat raised tilt');
  a.observeAction('villain', 'raise');
  assert(a.getStats('villain').raises === 1, 'opponent aggression tracked');
});

console.log('Integration: AI vs AI through the engine');

function playHand(engine, agents) {
  let guard = 0;
  while (engine.currentActor() !== null) {
    if (++guard > 300) throw new Error('hand did not terminate');
    const seat = engine.currentActor();
    const action = agents[seat].decide(engine.getView(seat));
    engine.applyAction(seat, action);
  }
}

test('four archetypes play a full hand; chips conserved, board legal, payout reached', () => {
  const engine = new HoldemEngine({
    seats: [{ id: 'Rock', stack: 5000 }, { id: 'Station', stack: 5000 }, { id: 'Maniac', stack: 5000 }, { id: 'Shark', stack: 5000 }],
    smallBlind: 25, bigBlind: 50, button: 0,
  });
  const agents = [
    CognitiveAI.fromArchetype('Rock', 5000, { samples: 150, seed: 1 }),
    CognitiveAI.fromArchetype('CallingStation', 5000, { samples: 150, seed: 2 }),
    CognitiveAI.fromArchetype('Maniac', 5000, { samples: 150, seed: 3 }),
    CognitiveAI.fromArchetype('Shark', 5000, { samples: 150, seed: 4 }),
  ];
  const start = engine.seats.reduce((s, p) => s + p.stack, 0);
  engine.startHand();
  playHand(engine, agents);
  assert(engine.state === GameState.PAYOUT || engine.state === GameState.WAITING, `state=${engine.state}`);
  assert(engine.board.length <= 5, 'board legal');
  assert(engine.seats.reduce((s, p) => s + p.stack, 0) === start, 'chips conserved');
});

test('several consecutive hands run without error and conserve chips', () => {
  const engine = new HoldemEngine({
    seats: [{ id: 'A', stack: 3000 }, { id: 'B', stack: 3000 }, { id: 'C', stack: 3000 }],
    smallBlind: 25, bigBlind: 50, button: 0,
  });
  const agents = ['Shark', 'Maniac', 'Rock'].map((n, i) => CognitiveAI.fromArchetype(n, 3000, { samples: 120, seed: i + 10 }));
  const start = 9000;
  for (let h = 0; h < 4; h++) {
    if (engine.seats.filter(p => p.stack > 0).length < 2) break;
    engine.startHand();
    playHand(engine, agents);
    assert(engine.seats.reduce((s, p) => s + p.stack, 0) === start, `chips conserved after hand ${h + 1}`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
