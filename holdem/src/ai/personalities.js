// personalities.js — Archetype parameter presets (spec 2.3) + shared constants.
//
// Each preset is the exact row from the spec's archetype table. The `tell`
// block operationalises the "behavioural tell (delay)" column for Phase 2b-ii:
//   baseMs       — typical think time
//   jitter       — variability (erratic vs steady)
//   strengthLeak — how much hand strength bleeds into timing (a readable tell);
//                  Shark = 0 → uniform timing that hides strength.
// ToM ceilings (spec 2.2 F): Rock/CallingStation L0, Maniac L1, Shark L2.

export const TOM = { L0: 0, L1: 1, L2: 2 };

// Prospect-theory constants shared across archetypes (spec 2.2 A).
export const PT = { alpha: 0.88, beta: 0.88, gamma: 0.61 };

function deepFreeze(o) {
  for (const k of Object.keys(o)) if (o[k] && typeof o[k] === 'object') deepFreeze(o[k]);
  return Object.freeze(o);
}

export const ARCHETYPES = deepFreeze({
  Rock: {
    name: 'Rock',
    preflopPct: 0.12, aggression: 0.25, bluffFrequency: 0.05,
    lossAversionLambda: 2.5, tiltSusceptibility: 0.3, anchoringStrength: 0.5,
    system2Capacity: 0.5, tomMax: TOM.L0,
    tell: { baseMs: 1500, jitter: 0.10, strengthLeak: 0.0 }, // long & steady
  },
  CallingStation: {
    name: 'CallingStation',
    preflopPct: 0.35, aggression: 0.15, bluffFrequency: 0.05,
    lossAversionLambda: 2.0, tiltSusceptibility: 0.4, anchoringStrength: 0.5,
    system2Capacity: 0.3, tomMax: TOM.L0,
    tell: { baseMs: 1400, jitter: 0.20, strengthLeak: 0.30 }, // long, leaky
  },
  Maniac: {
    name: 'Maniac',
    preflopPct: 0.45, aggression: 0.90, bluffFrequency: 0.40,
    lossAversionLambda: 1.5, tiltSusceptibility: 1.0, anchoringStrength: 0.3,
    system2Capacity: 0.4, tomMax: TOM.L1,
    tell: { baseMs: 600, jitter: 0.60, strengthLeak: 0.20 }, // short & erratic
  },
  Shark: {
    name: 'Shark',
    preflopPct: 0.22, aggression: 0.65, bluffFrequency: 0.20,
    lossAversionLambda: 1.8, tiltSusceptibility: 0.4, anchoringStrength: 0.2,
    system2Capacity: 0.9, tomMax: TOM.L2,
    tell: { baseMs: 1000, jitter: 0.15, strengthLeak: 0.0 }, // uniform → hides tells
  },
});

// Resolve a personality by name, optionally overriding individual parameters.
export function makePersonality(name, overrides = {}) {
  const base = ARCHETYPES[name];
  if (!base) throw new Error(`Unknown archetype "${name}"`);
  return { ...base, ...overrides, tell: { ...base.tell, ...(overrides.tell || {}) } };
}
