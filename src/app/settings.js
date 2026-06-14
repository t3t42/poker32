// settings.js — game settings: normalization/validation, building the
// controller's seat list, and a persistable view that NEVER includes API keys
// (spec 4.1: keys are memory-only). Pure + factory-injected → Node-testable.

import { ARCHETYPES } from '../ai/personalities.js';

export const ARCHETYPE_NAMES = Object.keys(ARCHETYPES); // Rock, CallingStation, Maniac, Shark

export const DEFAULT_SETTINGS = {
  seatCount: 4,
  startingStack: 10000,
  smallBlind: 50,
  bigBlind: 100,
  blindIncreaseEveryHands: 0,   // 0 = OFF (spec 1.1)
  blindMultiplier: 2,
  sound: false,
  reducedMotion: false,
  seats: [{ human: true, name: 'You' }, { archetype: 'Rock' }, { archetype: 'Maniac' }, { archetype: 'Shark' }],
};

const intOr = (v, d) => (Number.isFinite(+v) ? Math.round(+v) : d);
const numOr = (v, d) => (Number.isFinite(+v) ? +v : d);
const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, intOr(v, lo)));

// Coerce arbitrary input into a valid, internally-consistent settings object.
export function normalizeSettings(raw = {}) {
  const s = { ...DEFAULT_SETTINGS, ...raw };
  s.seatCount = clampInt(s.seatCount, 2, 6);
  s.startingStack = Math.max(100, intOr(s.startingStack, 10000));
  s.bigBlind = Math.max(2, intOr(s.bigBlind, 100));
  s.smallBlind = Math.max(1, Math.min(intOr(s.smallBlind, Math.floor(s.bigBlind / 2)), s.bigBlind));
  s.blindIncreaseEveryHands = Math.max(0, intOr(s.blindIncreaseEveryHands, 0));
  s.blindMultiplier = Math.max(1, numOr(s.blindMultiplier, 2));
  s.sound = !!s.sound;
  s.reducedMotion = !!s.reducedMotion;

  const rawSeats = Array.isArray(raw.seats) ? raw.seats : DEFAULT_SETTINGS.seats;
  const seats = [{ human: true, name: (rawSeats[0] && rawSeats[0].name) || 'You' }];
  for (let i = 1; i < s.seatCount; i++) {
    const r = rawSeats[i] || {};
    const archetype = ARCHETYPE_NAMES.includes(r.archetype) ? r.archetype : ARCHETYPE_NAMES[(i - 1) % ARCHETYPE_NAMES.length];
    const apiKey = typeof r.apiKey === 'string' ? r.apiKey.trim() : '';
    let engine = r.engine === 'gemini' ? 'gemini' : 'builtin';
    if (engine === 'gemini' && !apiKey) engine = 'builtin';   // no key → Gemini unavailable (spec 4.1)
    seats.push({ archetype, engine, apiKey, name: r.name || archetype });
  }
  s.seats = seats;
  return s;
}

// Build the controller's seats from settings. `makeBuiltin`/`makeGemini` are
// injected so this is testable without the browser AI/Gemini stack.
export function buildSeats(settings, { makeBuiltin, makeGemini }) {
  const s = normalizeSettings(settings);
  return s.seats.map((seat, i) => {
    if (seat.human) return { human: true, name: seat.name || 'You', seat: i };
    if (seat.engine === 'gemini' && seat.apiKey) return { decider: makeGemini(seat, s, i), name: seat.name, engine: 'gemini', seat: i };
    return { decider: makeBuiltin(seat, s, i), name: seat.name, engine: 'builtin', seat: i };
  });
}

// A persistable snapshot — API keys are intentionally dropped (memory-only).
export function serializeSettings(settings) {
  const s = normalizeSettings(settings);
  return { ...s, seats: s.seats.map(({ apiKey, ...rest }) => rest) };
}
