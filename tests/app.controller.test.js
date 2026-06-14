// app.controller.test.js — runnable in Node (node tests/...).
//
// Phase 6a: the pure adapters (geometry, gameView→scene, engine-event→anim) and
// the Controller loop — run headlessly with stubbed animation/input to prove a
// full hand plays (AI seats + a human seat), chips conserved, events animated.

import { HoldemEngine, GameState } from '../src/engine/index.js';
import { CognitiveAI } from '../src/ai/index.js';
import { tableGeometry, viewToScene, AnimMapper, cardId, boardId, betChipId, Controller } from '../src/app/index.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { const r = fn(); if (r instanceof Promise) return r.then(() => { console.log(`  \u2713 ${name}`); passed++; }, e => { console.error(`  \u2717 ${name}\n      ${e.message}`); failed++; }); console.log(`  \u2713 ${name}`); passed++; }
  catch (e) { console.error(`  \u2717 ${name}\n      ${e.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

console.log('Geometry');

test('hero sits at the bottom; board and pot are central', () => {
  const g = tableGeometry({ width: 900, height: 560, seatCount: 4, heroSeat: 2 });
  assert(g.seatPos(2).y > 280, 'hero (seat 2) at the bottom half');
  assert(Math.abs(g.board(2).x - 450) < 1, 'middle board card centred');
  assert(Math.abs(g.pot().x - 450) < 1, 'pot centred');
});

console.log('viewToScene');

test('snapshot rotates hero first and hides opponents\u2019 cards', () => {
  const engine = new HoldemEngine({ seats: [{ id: 'A', stack: 1000 }, { id: 'B', stack: 1000 }, { id: 'C', stack: 1000 }], smallBlind: 25, bigBlind: 50, button: 0 });
  engine.startHand();
  const scene = viewToScene(engine.getView(1), { heroSeat: 1, names: ['A', 'B', 'C'], activeSeat: engine.currentActor() });
  assert(scene.heroSeat === 0 && scene.seats[0].name === 'B', 'hero rotated to front');
  assert(Array.isArray(scene.seats[0].holeCards) && scene.seats[0].holeCards.length === 2, 'hero sees own cards');
  assert(scene.seats[1].holeCards === null && scene.seats[1].cardCount === 2, 'opponent face-down');
  assert(typeof scene.pot === 'number', 'pot present');
});

console.log('AnimMapper (events → animation events)');

test('maps deals, board, bets, and collect with stable ids', () => {
  const g = tableGeometry({ seatCount: 2, heroSeat: 0 });
  const m = new AnimMapper({ seatCount: 2 });
  const out = m.mapBatch([
    { type: 'DEAL', seat: 0, card: {} }, { type: 'DEAL', seat: 1, card: {} }, { type: 'DEAL', seat: 0, card: {} },
    { type: 'POST_BLIND', seat: 1, amount: 50 },
  ], g);
  const deals = out.filter(o => o.type === 'DEAL');
  assert(deals.length === 3 && deals[0].id === cardId(0, 0) && deals[2].id === cardId(0, 1), 'per-seat card index');
  assert(deals[0].order === 0 && deals[2].order === 2, 'deal stagger order');
  const bet = out.find(o => o.type === 'BET');
  assert(bet.id === betChipId(1) && bet.from && bet.to, 'blind → chip arc');
  const flop = m.mapBatch([{ type: 'FLOP', cards: [{}, {}, {}] }], g);
  assert(flop[0].cards.length === 3 && flop[0].cards[0].id === boardId(0), 'flop board ids');
  const turn = m.mapBatch([{ type: 'TURN', cards: [{}] }], g);
  assert(turn[0].cards[0].id === boardId(3), 'board index persists into the turn');
  const col = m.mapBatch([{ type: 'COLLECT', amount: 100, pot: 100 }], g);
  assert(col[0].type === 'COLLECT' && col[0].items.length === 2, 'collect gathers both seats');
});

console.log('Controller loop');

function spyAnim() { const calls = []; const fn = anim => { calls.push(anim); return Promise.resolve(); }; fn.calls = calls; return fn; }

test('AI-only: plays a full hand, conserves chips, renders and animates', async () => {
  const engine = new HoldemEngine({ seats: [{ id: 'Rock', stack: 3000 }, { id: 'Maniac', stack: 3000 }, { id: 'Shark', stack: 3000 }], smallBlind: 25, bigBlind: 50, button: 0 });
  const seats = ['Rock', 'Maniac', 'Shark'].map((n, i) => ({ decider: CognitiveAI.fromArchetype(n, 3000, { samples: 100, seed: i + 1 }) }));
  const play = spyAnim(); let scenes = 0;
  const c = new Controller({ engine, seats, heroSeat: 0, onScene: () => scenes++, playAnimations: play, wait: () => Promise.resolve() });
  await c.playHand();
  assert(engine.state === GameState.PAYOUT || engine.state === GameState.WAITING, `state=${engine.state}`);
  assert(engine.seats.reduce((s, p) => s + p.stack, 0) === 9000, 'chips conserved');
  assert(scenes > 0, 'rendered');
  const flat = play.calls.flat();
  assert(flat.some(a => a.type === 'DEAL') && flat.some(a => a.type === 'BET'), 'deal + bet animated');
});

test('human seat: the loop awaits the action bar and applies its choice', async () => {
  const engine = new HoldemEngine({ seats: [{ id: 'You', stack: 2000 }, { id: 'AI', stack: 2000 }], smallBlind: 25, bigBlind: 50, button: 0 });
  const seats = [{ human: true }, { decider: CognitiveAI.fromArchetype('Rock', 2000, { samples: 80, seed: 5 }) }];
  let asked = 0;
  const askHuman = view => { asked++; return Promise.resolve(view.legal.canCheck ? { type: 'check' } : { type: 'call' }); };
  const c = new Controller({ engine, seats, heroSeat: 0, askHuman, playAnimations: () => Promise.resolve(), wait: () => Promise.resolve() });
  await c.playHand();
  assert(asked > 0, 'human was asked to act');
  assert(engine.seats.reduce((s, p) => s + p.stack, 0) === 4000, 'chips conserved with a human seat');
});

(async () => { await new Promise(r => setTimeout(r, 50)); console.log(`\n${passed} passed, ${failed} failed`); if (failed > 0) process.exit(1); })();
