// ai.psychology.test.js — runnable in Node (node tests/...).
//
// Phase 2b-i: archetype presets (spec 2.3), Prospect-Theory value/weighting
// (spec 2.2 A), and the cognitive state machine — tilt triggers/decay (2.2 C),
// cognitive load + S1/S2 weight (2.2 B), recency/gambler's fallacy (2.2 E).

import {
  ARCHETYPES, makePersonality, TOM, PT,
  value, weightProb, relativeOutcome, prospectValue,
  CognitiveState,
} from '../src/ai/index.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  \u2713 ${name}`); passed++; }
  catch (e) { console.error(`  \u2717 ${name}\n      ${e.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function near(a, b, tol, msg) { assert(Math.abs(a - b) <= tol, `${msg || ''} expected ~${b} got ${a}`); }

console.log('Archetypes (spec 2.3)');

test('preset parameters match the spec table', () => {
  assert(ARCHETYPES.Rock.preflopPct === 0.12 && ARCHETYPES.Rock.lossAversionLambda === 2.5 && ARCHETYPES.Rock.tomMax === TOM.L0, 'Rock');
  assert(ARCHETYPES.CallingStation.preflopPct === 0.35 && ARCHETYPES.CallingStation.aggression === 0.15 && ARCHETYPES.CallingStation.tomMax === TOM.L0, 'Calling Station');
  assert(ARCHETYPES.Maniac.aggression === 0.90 && ARCHETYPES.Maniac.bluffFrequency === 0.40 && ARCHETYPES.Maniac.tiltSusceptibility === 1.0 && ARCHETYPES.Maniac.tomMax === TOM.L1, 'Maniac');
  assert(ARCHETYPES.Shark.system2Capacity === 0.9 && ARCHETYPES.Shark.tomMax === TOM.L2 && ARCHETYPES.Shark.tell.strengthLeak === 0, 'Shark hides tells');
});
test('makePersonality applies overrides without mutating the preset', () => {
  const p = makePersonality('Shark', { aggression: 0.7 });
  assert(p.aggression === 0.7 && ARCHETYPES.Shark.aggression === 0.65, 'override is local');
});

console.log('Prospect Theory (spec 2.2 A)');

test('losses loom larger than equal gains by factor \u03bb', () => {
  const lambda = 2.0;
  near(-value(-100, lambda) / value(100, lambda), lambda, 1e-9, 'loss/gain ratio = λ');
});
test('value is concave in gains (diminishing sensitivity)', () => {
  assert(value(200, 2) - value(100, 2) < value(100, 2) - value(0, 2), 'concavity');
});
test('probability weighting overweights longshots, underweights near-certainties', () => {
  assert(weightProb(0.05) > 0.05, 'w(.05) > .05');
  assert(weightProb(0.99) < 0.99, 'w(.99) < .99');
  assert(weightProb(0) === 0 && weightProb(1) === 1, 'endpoints fixed');
});
test('reference-point helpers', () => {
  assert(relativeOutcome(1200, -200, 1000) === 0, 'x = stack + Δ − r');
  assert(prospectValue(1500, 1000, 1.8) === value(500, 1.8), 'end-stack value from r');
});

console.log('Cognitive state — tilt (spec 2.2 C)');

const persona = name => makePersonality(name);

test('a bad beat tilts a Maniac far more than a Rock (susceptibility)', () => {
  const beat = { won: false, potSize: 1200, startStack: 2000, hadEquityAtShowdown: 0.85 };
  const rock = new CognitiveState(persona('Rock'), 2000); rock.recordHandResult({ ...beat });
  const maniac = new CognitiveState(persona('Maniac'), 2000); maniac.recordHandResult({ ...beat });
  assert(maniac.tiltLevel > rock.tiltLevel && rock.tiltLevel > 0, `maniac ${maniac.tiltLevel.toFixed(3)} > rock ${rock.tiltLevel.toFixed(3)}`);
});
test('tilt decays toward calm over uneventful hands (×0.92/hand)', () => {
  const s = new CognitiveState(persona('Maniac'), 2000);
  s.recordHandResult({ won: false, potSize: 1200, startStack: 2000, hadEquityAtShowdown: 0.85 });
  const peak = s.tiltLevel;
  for (let i = 0; i < 10; i++) s.recordHandResult({ won: true, potSize: 0, startStack: 2000 }); // small calm wins
  assert(s.tiltLevel < peak * 0.5, `decayed ${peak.toFixed(3)} → ${s.tiltLevel.toFixed(3)}`);
});
test('a big-pot win calms more than a small win', () => {
  const big = new CognitiveState(persona('Shark'), 2000); big.tiltLevel = 0.5;
  big.recordHandResult({ won: true, potSize: 1500, startStack: 2000 });
  const small = new CognitiveState(persona('Shark'), 2000); small.tiltLevel = 0.5;
  small.recordHandResult({ won: true, potSize: 0, startStack: 2000 });
  assert(big.tiltLevel < small.tiltLevel, `big-win ${big.tiltLevel.toFixed(3)} < small-win ${small.tiltLevel.toFixed(3)}`);
});
test('three losses in a row add tilt', () => {
  const s = new CognitiveState(persona('Shark'), 2000);
  s.recordHandResult({ won: false, potSize: 0, startStack: 2000 });
  s.recordHandResult({ won: false, potSize: 0, startStack: 2000 });
  const before = s.tiltLevel; // streak 2, no streak trigger yet
  s.recordHandResult({ won: false, potSize: 0, startStack: 2000 }); // streak 3 → +0.10·susc
  assert(before === 0 && s.tiltLevel > 0, `streak trigger fired: ${s.tiltLevel.toFixed(3)}`);
});

console.log('Cognitive state — load & dual-process (spec 2.2 B)');

test('cognitive load rises with multiway pots and tilt, stays in [0,1]', () => {
  const s = new CognitiveState(persona('Shark'), 2000);
  assert(s.cognitiveLoad({ activePlayers: 2, potToStackRatio: 0 }) === 0, 'calm heads-up = 0');
  const multi = s.cognitiveLoad({ activePlayers: 5, potToStackRatio: 0 });
  assert(multi > 0 && multi <= 1, `multiway load ${multi}`);
  s.tiltLevel = 0.8;
  assert(s.cognitiveLoad({ activePlayers: 2, potToStackRatio: 0 }) > 0, 'tilt adds load');
  assert(s.cognitiveLoad({ activePlayers: 9, potToStackRatio: 5 }) === 1, 'clamped at 1');
});
test('System-2 weight = capacity − load − 0.4·tilt', () => {
  const shark = new CognitiveState(persona('Shark'), 2000);
  near(shark.system2Weight({ activePlayers: 2, potToStackRatio: 0 }), 0.9, 1e-9, 'calm Shark uses full capacity');
  shark.tiltLevel = 0.5;
  near(shark.system2Weight({ activePlayers: 2, potToStackRatio: 0 }), 0.9 - 0.25 - 0.2, 1e-9, 'tilt + tilt-load reduce S2');
  const rock = new CognitiveState(persona('Rock'), 2000);
  near(rock.system2Weight({ activePlayers: 2, potToStackRatio: 0 }), 0.5, 1e-9, 'Rock capacity 0.5');
});

console.log('Cognitive state — recency (spec 2.2 E)');

test('gambler\u2019s fallacy: Maniac chases after losses, Rock retreats', () => {
  const maniac = new CognitiveState(persona('Maniac'), 2000);
  const rock = new CognitiveState(persona('Rock'), 2000);
  for (let i = 0; i < 3; i++) { maniac.recordHandResult({ won: false }); rock.recordHandResult({ won: false }); }
  assert(maniac.drawChaseMultiplier() > 1, `maniac chases (${maniac.drawChaseMultiplier().toFixed(2)})`);
  assert(rock.drawChaseMultiplier() < 1, `rock retreats (${rock.drawChaseMultiplier().toFixed(2)})`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
