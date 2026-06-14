// ai.gemini.test.js — runnable in Node (node tests/...).
//
// Phase 3a: the Gemini transport/prompt/mapping layer, exercised with a MOCKED
// fetch (no live calls). Covers prompt construction, the 8s timeout, 429
// backoff+retry, error typing, response parsing, and — critically — mapping the
// model's JSON onto a LEGAL engine Action with clamping/repair.

import { cards } from '../src/engine/index.js';
import {
  GEMINI_MODEL, GeminiError, GeminiClient, PERSONA_DESCRIPTIONS,
  buildEndpoint, buildSystemPrompt, serializeGameView, buildRequestBody,
  extractText, parseDecisionJSON, sanitizeTableTalk, mapToAction,
} from '../src/ai/index.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { const r = fn(); if (r instanceof Promise) return r.then(() => { console.log(`  \u2713 ${name}`); passed++; }, e => { console.error(`  \u2717 ${name}\n      ${e.message}`); failed++; }); console.log(`  \u2713 ${name}`); passed++; }
  catch (e) { console.error(`  \u2717 ${name}\n      ${e.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
async function expectReason(promise, reason) {
  try { await promise; throw new Error(`expected GeminiError(${reason}) but it resolved`); }
  catch (e) { assert(e instanceof GeminiError && e.reason === reason, `expected reason ${reason}, got ${e.reason || e.message}`); }
}

// --- view + fetch fakes ---
function makeView({ hole = 'As Ks', board = 'Ad 7c 2s', state = 'FLOP', toCall = 100, currentBet = 100, stack = 1000, pot = 300, minRaise = 100 } = {}) {
  const maxRaiseTo = currentBet === 0 ? stack : currentBet + (stack - toCall);
  const canRaise = stack > toCall;
  return {
    handNumber: 1, state, board: cards(board), potTotal: pot, smallBlind: 25, bigBlind: 50,
    currentBet, minRaise, toCall, buttonSeat: 0, sbSeat: 1, bbSeat: 2,
    you: { seat: 0, id: 'hero', stack, holeCards: cards(hole), committedRound: 0, committedTotal: 0, folded: false, allIn: false },
    legal: {
      canFold: true, canCheck: toCall === 0, canCall: toCall > 0, callAmount: Math.min(toCall, stack),
      callIsAllIn: stack <= toCall, canRaise, minRaiseTo: canRaise ? currentBet + minRaise : null,
      maxRaiseTo: canRaise ? maxRaiseTo : null, raiseAllInOnly: false, toCall,
    },
    players: [
      { seat: 0, id: 'hero', folded: false, allIn: false, out: false, stack, committedTotal: 0, committedRound: 0, holeCards: null, cardCount: 2 },
      { seat: 1, id: 'villain', folded: false, allIn: false, out: false, stack: 900, committedTotal: 100, committedRound: 100, holeCards: null, cardCount: 2 },
    ],
    actionsThisHand: [{ seat: 1, street: 'FLOP', type: 'bet', amount: 100, total: 100 }],
  };
}
const ok = obj => ({ ok: true, status: 200, json: async () => obj });
const geminiReply = decision => ok({ candidates: [{ content: { parts: [{ text: JSON.stringify(decision) }], role: 'model' }, finishReason: 'STOP' }] });
const seat = { name: 'Shark', personaDescription: PERSONA_DESCRIPTIONS.Shark, apiKey: 'TEST_KEY' };

console.log('Prompt construction (spec 4.1/4.2)');

test('model constant and endpoint', () => {
  assert(GEMINI_MODEL === 'gemini-flash-lite-3.1', 'model constant');
  const url = buildEndpoint(GEMINI_MODEL, 'abc123');
  assert(url.includes('gemini-flash-lite-3.1:generateContent') && url.includes('key=abc123'), url);
});
test('system prompt carries name, persona, and the JSON-only rule', () => {
  const sp = buildSystemPrompt('Shark', PERSONA_DESCRIPTIONS.Shark);
  assert(sp.includes('"Shark"') && sp.includes(PERSONA_DESCRIPTIONS.Shark) && sp.includes('JSON 한 개만') && sp.includes('check 금지'), 'prompt content');
});
test('serialized state includes the public decision inputs', () => {
  const s = serializeGameView(makeView(), { opponentStats: [{ id: 'villain', vpip: 0.3, pfr: 0.2, af: 2.5 }] });
  for (const frag of ['As Ks', 'Ad 7c 2s', '[팟] 300', '[콜 필요 금액] 100', 'VPIP 30%', 'AF 2.5', 'bet 100']) assert(s.includes(frag), `missing "${frag}"`);
});
test('request body sets JSON mime type and temperature 0.9', () => {
  const b = buildRequestBody('sys', 'user');
  assert(b.generationConfig.responseMimeType === 'application/json' && b.generationConfig.temperature === 0.9, 'generationConfig');
  assert(b.system_instruction.parts[0].text === 'sys' && b.contents[0].parts[0].text === 'user', 'parts');
});

console.log('Response parsing');

test('extractText pulls the candidate text; missing → parse error', () => {
  assert(extractText({ candidates: [{ content: { parts: [{ text: '{"action":"call"}' }] } }] }) === '{"action":"call"}');
  let threw = false; try { extractText({ candidates: [] }); } catch (e) { threw = e.reason === 'parse'; }
  assert(threw, 'empty candidates → parse error');
});
test('parseDecisionJSON tolerates ```json fences', () => {
  const d = parseDecisionJSON('```json\n{"action":"raise","amount":300}\n```');
  assert(d.action === 'raise' && d.amount === 300, 'fenced JSON parsed');
});

console.log('Action mapping & repair (spec 4.3 §2)');

test('valid raise maps and clamps to [min,max]', () => {
  const v = makeView({ toCall: 100, currentBet: 100, stack: 1000 }); // min 200, max 1000
  assert(mapToAction({ action: 'raise', amount: 99999 }, v).amount === v.legal.maxRaiseTo, 'over-cap clamps to max');
  assert(mapToAction({ action: 'raise', amount: 50 }, v).amount === v.legal.minRaiseTo, 'under-min clamps to min');
});
test('illegal check (facing a bet) repaired to call', () => {
  const a = mapToAction({ action: 'check' }, makeView({ toCall: 100 }));
  assert(a.type === 'call', `got ${a.type}`);
});
test('raise when raising is impossible repaired to call/check', () => {
  const v = makeView({ toCall: 100, stack: 80 }); v.legal.canRaise = false; v.legal.minRaiseTo = null; v.legal.maxRaiseTo = null;
  assert(mapToAction({ action: 'raise', amount: 500 }, v).type === 'call', 'no-raise → call');
});
test('fold offered for free is converted to check', () => {
  assert(mapToAction({ action: 'fold' }, makeView({ toCall: 0, currentBet: 0 })).type === 'check', 'free fold → check');
});
test('unknown action falls back to a safe legal action', () => {
  assert(mapToAction({ action: 'banana' }, makeView({ toCall: 100 })).type === 'call', 'unknown facing bet → call');
});
test('table talk is capped at 60 chars and profanity-filtered', () => {
  assert(sanitizeTableTalk('x'.repeat(80)).length === 60, '60-char cap');
  assert(!/fuck/i.test(sanitizeTableTalk('what the fuck')), 'profanity masked');
  const a = mapToAction({ action: 'call', tableTalk: 'nice hand!' }, makeView({ toCall: 100 }));
  assert(a.tableTalk === 'nice hand!' && a.source === 'llm', 'table talk passthrough + source tag');
});

console.log('Transport: success, errors, timeout, retry');

test('happy path returns a mapped legal Action', async () => {
  const client = new GeminiClient({ fetchImpl: async () => geminiReply({ action: 'raise', amount: 400, reasoning: '밸류', tableTalk: '레이즈' }) });
  const a = await client.requestDecision(makeView(), seat);
  assert(a.type === 'raise' && a.amount === 400 && a.reasoning === '밸류' && a.tableTalk === '레이즈' && a.source === 'llm', JSON.stringify(a));
});
test('missing API key → nokey (so the seat falls back)', () => expectReason(new GeminiClient({ fetchImpl: async () => geminiReply({ action: 'call' }) }).requestDecision(makeView(), { ...seat, apiKey: '' }), 'nokey'));
test('HTTP 500 → http error', () => expectReason(new GeminiClient({ fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) }).requestDecision(makeView(), seat), 'http'));
test('network rejection → network error', () => expectReason(new GeminiClient({ fetchImpl: async () => { throw new Error('ECONNREFUSED'); } }).requestDecision(makeView(), seat), 'network'));
test('malformed model output → parse error', () => expectReason(new GeminiClient({ fetchImpl: async () => ok({ candidates: [{ content: { parts: [{ text: 'not json at all' }] } }] }) }).requestDecision(makeView(), seat), 'parse'));
test('8-second timeout via AbortController (short timeout in test)', () => {
  const hanging = (_u, { signal }) => new Promise((_res, rej) => signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); }));
  return expectReason(new GeminiClient({ fetchImpl: hanging, timeoutMs: 20 }).requestDecision(makeView(), seat), 'timeout');
});
test('429 then 200: backs off and retries once, then succeeds', async () => {
  let n = 0;
  const client = new GeminiClient({ backoffMs: 5, fetchImpl: async () => (++n === 1 ? { ok: false, status: 429, json: async () => ({}) } : geminiReply({ action: 'call' })) });
  const a = await client.requestDecision(makeView(), seat);
  assert(n === 2 && a.type === 'call', `calls=${n} type=${a.type}`);
});
test('429 twice → ratelimit error', () => expectReason(new GeminiClient({ backoffMs: 5, fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) }) }).requestDecision(makeView(), seat), 'ratelimit'));

(async () => {
  // allow async tests to settle
  await new Promise(r => setTimeout(r, 100));
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
