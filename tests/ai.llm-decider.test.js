// ai.llm-decider.test.js — runnable in Node (node tests/...).
//
// Phase 3b: the hybrid decider. With a mocked Gemini transport we verify the
// success path (source 'llm'), automatic fallback to the built-in CognitiveAI on
// every failure mode (source 'fallback', still a legal action), the keyless
// short-circuit, per-seat throttling, observe() delegation, and an AI-vs-AI hand
// driven through the real engine where one seat is LLM-backed.

import { cards, HoldemEngine, GameState } from '../src/engine/index.js';
import { LLMDecider, CognitiveAI, GeminiClient, PERSONA_DESCRIPTIONS } from '../src/ai/index.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { const r = fn(); if (r instanceof Promise) return r.then(() => { console.log(`  \u2713 ${name}`); passed++; }, e => { console.error(`  \u2717 ${name}\n      ${e.message}`); failed++; }); console.log(`  \u2713 ${name}`); passed++; }
  catch (e) { console.error(`  \u2717 ${name}\n      ${e.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
const quietLog = { warn() {} };

function makeView({ hole = 'As Ks', board = 'Ad 7c 2s', toCall = 100, currentBet = 100, stack = 1000, pot = 300, minRaise = 100 } = {}) {
  const canRaise = stack > toCall;
  return {
    handNumber: 1, state: 'FLOP', board: cards(board), potTotal: pot, smallBlind: 25, bigBlind: 50,
    currentBet, minRaise, toCall, buttonSeat: 0, sbSeat: 1, bbSeat: 2,
    you: { seat: 0, id: 'hero', stack, holeCards: cards(hole), committedRound: 0, committedTotal: 0, folded: false, allIn: false },
    legal: { canFold: true, canCheck: toCall === 0, canCall: toCall > 0, callAmount: Math.min(toCall, stack), callIsAllIn: stack <= toCall, canRaise, minRaiseTo: canRaise ? currentBet + minRaise : null, maxRaiseTo: canRaise ? currentBet + (stack - toCall) : null, raiseAllInOnly: false, toCall },
    players: [
      { seat: 0, id: 'hero', folded: false, allIn: false, out: false, stack, committedTotal: 0, committedRound: 0, holeCards: null, cardCount: 2 },
      { seat: 1, id: 'villain', folded: false, allIn: false, out: false, stack: 900, committedTotal: 100, committedRound: 100, holeCards: null, cardCount: 2 },
    ],
    actionsThisHand: [{ seat: 1, street: 'FLOP', type: 'bet', amount: 100, total: 100 }],
  };
}
const ok = obj => ({ ok: true, status: 200, json: async () => obj });
const reply = decision => ok({ candidates: [{ content: { parts: [{ text: JSON.stringify(decision) }], role: 'model' } }] });
const decider = (overrides = {}) => LLMDecider.fromArchetype('Shark', 1000, {
  apiKey: 'KEY', minIntervalMs: 0, logger: quietLog, fallbackOpts: { samples: 150, seed: 7 }, ...overrides,
});

console.log('Success path');

test('a valid Gemini reply is used directly (source = llm)', async () => {
  const d = decider({ client: new GeminiClient({ fetchImpl: async () => reply({ action: 'raise', amount: 400, reasoning: '밸류', tableTalk: 'gg' }) }) });
  const a = await d.decide(makeView());
  assert(a.source === 'llm' && a.type === 'raise' && a.amount === 400 && a.tableTalk === 'gg', JSON.stringify(a));
  assert(typeof a.delayMs === 'number', 'LLM action still gets a think-time delay');
  assert(d.lastSource === 'llm', 'lastSource tracked');
});

console.log('Fallback on every failure mode (spec 4.3 §3)');

async function fallsBack(client, reason, extra = {}) {
  const events = [];
  const d = decider({ client, onFallback: e => events.push(e), ...extra });
  const a = await d.decide(makeView());
  assert(a.source === 'fallback' && a.fallbackReason === reason, `expected fallback/${reason}, got ${a.source}/${a.fallbackReason}`);
  assert(['fold', 'check', 'call', 'raise'].includes(a.type), 'fallback still returns a legal action type');
  assert(events.length === 1 && events[0].reason === reason, 'onFallback fired with reason');
  return a;
}
test('network error → fallback', () => fallsBack(new GeminiClient({ fetchImpl: async () => { throw new Error('down'); } }), 'network'));
test('HTTP 500 → fallback', () => fallsBack(new GeminiClient({ fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) }), 'http'));
test('malformed JSON → fallback', () => fallsBack(new GeminiClient({ fetchImpl: async () => ok({ candidates: [{ content: { parts: [{ text: 'nope' }] } }] }) }), 'parse'));
test('timeout → fallback', () => {
  const hanging = (_u, { signal }) => new Promise((_r, rej) => signal.addEventListener('abort', () => { const e = new Error('a'); e.name = 'AbortError'; rej(e); }));
  return fallsBack(new GeminiClient({ fetchImpl: hanging, timeoutMs: 20 }), 'timeout');
});
test('429 twice → fallback (ratelimit)', () => fallsBack(new GeminiClient({ backoffMs: 5, fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) }) }), 'ratelimit'));

console.log('Keyless seat & throttle (spec 4.1 / 4.3 §5)');

test('no API key → silent built-in decision (no fallback signal)', async () => {
  const events = [];
  const d = decider({ apiKey: '', onFallback: e => events.push(e), client: new GeminiClient({ fetchImpl: async () => { throw new Error('should not be called'); } }) });
  const a = await d.decide(makeView());
  assert(a.source === 'fallback' && a.fallbackReason === 'nokey', JSON.stringify(a));
  assert(events.length === 0, 'keyless is normal operation, not a fallback event');
});
test('per-seat minimum interval throttles rapid calls', async () => {
  const slept = [];
  const clock = [0, 0, 200, 200]; let i = 0;
  const d = decider({
    minIntervalMs: 1000,
    now: () => (i < clock.length ? clock[i++] : clock[clock.length - 1]),
    sleep: ms => { slept.push(ms); return Promise.resolve(); },
    client: new GeminiClient({ fetchImpl: async () => reply({ action: 'call' }) }),
  });
  await d.decide(makeView()); // t=0: first call, no wait
  await d.decide(makeView()); // t=200: must wait 1000-200 = 800ms
  assert(slept.length === 1 && slept[0] === 800, `expected one 800ms sleep, got ${JSON.stringify(slept)}`);
});

console.log('Warmth: observation flows to the fallback model');

test('observeAction / observeHandEnd delegate to the built-in model', () => {
  const d = decider();
  d.observeAction('villain', 'raise');
  assert(d.getStats('villain').raises === 1, 'opponent stat updated on the fallback model');
  d.observeHandEnd({ won: false, potSize: 1500, startStack: 2000, hadEquityAtShowdown: 0.85 });
  assert(d.fallback.state.tiltLevel > 0, 'tilt updated on the fallback model');
});

console.log('Integration: an LLM-backed seat in a real hand');

async function playHand(engine, agents) {
  let guard = 0;
  while (engine.currentActor() !== null) {
    if (++guard > 300) throw new Error('hand did not terminate');
    const seat = engine.currentActor();
    const action = await agents[seat].decide(engine.getView(seat)); // await tolerates sync deciders too
    engine.applyAction(seat, action);
  }
}

test('LLM seat (mocked) plays a full hand vs cognitive seats; chips conserved', async () => {
  const engine = new HoldemEngine({
    seats: [{ id: 'LLM', stack: 4000 }, { id: 'Rock', stack: 4000 }, { id: 'Maniac', stack: 4000 }],
    smallBlind: 25, bigBlind: 50, button: 0,
  });
  const llmSeat = decider({ client: new GeminiClient({ fetchImpl: async () => reply({ action: 'call', tableTalk: 'I call.' }) }) });
  const agents = [
    llmSeat,
    CognitiveAI.fromArchetype('Rock', 4000, { samples: 120, seed: 1 }),
    CognitiveAI.fromArchetype('Maniac', 4000, { samples: 120, seed: 2 }),
  ];
  const start = 12000;
  engine.startHand();
  await playHand(engine, agents);
  assert(engine.state === GameState.PAYOUT || engine.state === GameState.WAITING, `state=${engine.state}`);
  assert(engine.seats.reduce((s, p) => s + p.stack, 0) === start, 'chips conserved with an LLM seat in play');
  assert(llmSeat.lastSource === 'llm', 'the mocked LLM path was exercised');
});

(async () => { await new Promise(r => setTimeout(r, 150)); console.log(`\n${passed} passed, ${failed} failed`); if (failed > 0) process.exit(1); })();
