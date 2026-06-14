// app.settings.test.js — runnable in Node (node tests/...).
//
// Phase 6b: settings normalization/validation, building controller seats with
// injected factories (keyless Gemini falls back to built-in), the key-stripping
// serializer (spec 4.1), and the dev-panel trace formatting (spec 2.4).

import { HoldemEngine } from '../src/engine/index.js';
import { CognitiveAI } from '../src/ai/index.js';
import { DEFAULT_SETTINGS, ARCHETYPE_NAMES, normalizeSettings, buildSeats, serializeSettings, formatTrace, devPanelHTML } from '../src/app/index.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  \u2713 ${name}`); passed++; }
  catch (e) { console.error(`  \u2717 ${name}\n      ${e.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

console.log('normalizeSettings');

test('clamps seat count to 2–6 and keeps seat 0 human', () => {
  assert(normalizeSettings({ seatCount: 1 }).seatCount === 2, 'min 2');
  assert(normalizeSettings({ seatCount: 9 }).seatCount === 6, 'max 6');
  const s = normalizeSettings({ seatCount: 3 });
  assert(s.seats.length === 3 && s.seats[0].human === true, 'seat0 human, length matches');
});

test('a Gemini seat without a key falls back to built-in; with a key it stays', () => {
  const noKey = normalizeSettings({ seatCount: 2, seats: [{ human: true }, { archetype: 'Shark', engine: 'gemini' }] });
  assert(noKey.seats[1].engine === 'builtin', 'keyless gemini → builtin');
  const keyed = normalizeSettings({ seatCount: 2, seats: [{ human: true }, { archetype: 'Shark', engine: 'gemini', apiKey: ' k-123 ' }] });
  assert(keyed.seats[1].engine === 'gemini' && keyed.seats[1].apiKey === 'k-123', 'keyed gemini kept + trimmed');
});

test('an invalid archetype is replaced with a valid default; blinds stay consistent', () => {
  const s = normalizeSettings({ seatCount: 2, seats: [{ human: true }, { archetype: 'Wizard' }], smallBlind: 9999, bigBlind: 100 });
  assert(ARCHETYPE_NAMES.includes(s.seats[1].archetype), 'archetype defaulted');
  assert(s.smallBlind <= s.bigBlind, 'small blind clamped at/below big blind');
});

console.log('buildSeats');

test('builds human + factory-made deciders, routing keyed seats to Gemini', () => {
  const settings = normalizeSettings({ seatCount: 3, seats: [{ human: true }, { archetype: 'Rock', engine: 'builtin' }, { archetype: 'Shark', engine: 'gemini', apiKey: 'k' }] });
  const built = buildSeats(settings, {
    makeBuiltin: seat => ({ kind: 'builtin', a: seat.archetype }),
    makeGemini: seat => ({ kind: 'gemini', a: seat.archetype }),
  });
  assert(built[0].human === true, 'seat0 human');
  assert(built[1].decider.kind === 'builtin' && built[1].engine === 'builtin', 'builtin seat');
  assert(built[2].decider.kind === 'gemini' && built[2].engine === 'gemini', 'gemini seat with key');
});

console.log('serializeSettings (spec 4.1: keys are memory-only)');

test('the persistable form never contains an API key', () => {
  const json = serializeSettings({ seatCount: 2, seats: [{ human: true }, { archetype: 'Shark', engine: 'gemini', apiKey: 'secret-key' }] });
  const text = JSON.stringify(json);
  assert(!text.includes('secret-key') && !text.includes('apiKey'), 'no key persisted');
});

console.log('formatTrace + devPanelHTML (spec 2.4)');

test('formats a real CognitiveAI trace into percentages, v(x), and a range', () => {
  const engine = new HoldemEngine({ seats: [{ id: 'A', stack: 5000 }, { id: 'B', stack: 5000 }], smallBlind: 25, bigBlind: 50, button: 0 });
  engine.startHand();
  const ai = CognitiveAI.fromArchetype('Shark', 5000, { samples: 120, seed: 3, devMode: true });
  ai.decide(engine.getView(engine.currentActor()));
  const vm = formatTrace(ai.lastTrace);
  assert(vm.available && /%$/.test(vm.equity) && /%$/.test(vm.tilt), 'equity/tilt as %');
  assert(/%$/.test(vm.distribution.aggressive) && typeof vm.pv.aggressive === 'number', 'distribution % + numeric v(x)');
  assert(Array.isArray(vm.rangeTop) && vm.rangeTop.length > 0, 'estimated range present');
  assert(['fold', 'passive', 'aggressive'].includes(vm.chosen), 'chosen decision bucket');
});

test('a null trace is reported as unavailable; the panel renders values', () => {
  assert(formatTrace(null).available === false, 'null → unavailable');
  const html = devPanelHTML([{ name: 'Shark', source: 'builtin', trace: { equity: 0.5, distribution: { fold: 0.1, passive: 0.2, aggressive: 0.7 }, estRangeTopHands: ['AA', 'KK'], chosen: 'raise', pv: { fold: -1, passive: 0, aggressive: 2 } } }]);
  assert(html.includes('Shark') && html.includes('50%') && html.includes('AA'), 'panel shows seat, equity, range');
  assert(devPanelHTML([{ name: 'Bot', source: 'gemini', trace: null }]).includes('Gemini'), 'gemini seat without a local trace');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
