// range.js — Starting-hand representation, preflop ranking, and weighted ranges.
//
// • 169 canonical starting-hand classes (pairs / suited / offsuit), each
//   expandable to concrete 2-card combos (1326 total).
// • Preflop strength via the Chen formula (Chen & Ankenman) — a documented,
//   O(1) heuristic used to derive "top X%" opening ranges. This is a STRATEGY
//   heuristic (the spec models human-like play), not a hand-evaluation
//   approximation; exact hand strength at showdown remains evaluate7.
// • Range: a weighted Map over hand keys, the substrate for Bayesian opponent
//   modelling (spec 2.2 G). The prior is a uniformly-weighted chart per spec.

import { SUITS, makeCard, cardToString } from '../engine/cards.js';

const RANK_CHAR = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: 'T', 9: '9', 8: '8', 7: '7', 6: '6', 5: '5', 4: '4', 3: '3', 2: '2' };
const CHAR_RANK = Object.fromEntries(Object.entries(RANK_CHAR).map(([r, c]) => [c, +r]));
const RANKS_DESC = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];

export function parseKey(key) {
  const hi = CHAR_RANK[key[0]], lo = CHAR_RANK[key[1]];
  if (key.length === 2) return { hi, lo, pair: true, suited: false };
  return { hi, lo, pair: false, suited: key[2] === 's' };
}

export function handKey(hi, lo, suited) {
  if (hi < lo) [hi, lo] = [lo, hi];
  if (hi === lo) return RANK_CHAR[hi] + RANK_CHAR[lo];
  return RANK_CHAR[hi] + RANK_CHAR[lo] + (suited ? 's' : 'o');
}

// All 169 canonical keys.
export const ALL_KEYS = (() => {
  const keys = [];
  for (let a = 0; a < RANKS_DESC.length; a++) {
    for (let b = a; b < RANKS_DESC.length; b++) {
      const hi = RANKS_DESC[a], lo = RANKS_DESC[b];
      if (hi === lo) keys.push(handKey(hi, lo, false));
      else { keys.push(handKey(hi, lo, true)); keys.push(handKey(hi, lo, false)); }
    }
  }
  return keys;
})();

// Concrete 2-card combos for a hand class.
export function combosForKey(key) {
  const { hi, lo, pair, suited } = parseKey(key);
  const out = [];
  if (pair) {
    for (let i = 0; i < SUITS.length; i++) for (let j = i + 1; j < SUITS.length; j++) {
      out.push([makeCard(hi, SUITS[i]), makeCard(lo, SUITS[j])]);   // C(4,2) = 6
    }
  } else if (suited) {
    for (const s of SUITS) out.push([makeCard(hi, s), makeCard(lo, s)]); // 4
  } else {
    for (const s1 of SUITS) for (const s2 of SUITS) if (s1 !== s2) {
      out.push([makeCard(hi, s1), makeCard(lo, s2)]);                // 12
    }
  }
  return out;
}

export function comboCount(key) { const { pair, suited } = parseKey(key); return pair ? 6 : suited ? 4 : 12; }
export const TOTAL_COMBOS = ALL_KEYS.reduce((n, k) => n + comboCount(k), 0); // 1326

// --- Chen formula ---
function chenCardPoints(r) {
  if (r === 14) return 10; if (r === 13) return 8; if (r === 12) return 7; if (r === 11) return 6;
  return r / 2; // T..2
}
export function chenScore(key) {
  const { hi, lo, pair, suited } = parseKey(key);
  if (pair) return Math.ceil(Math.max(chenCardPoints(hi) * 2, 5));
  let s = chenCardPoints(hi);
  if (suited) s += 2;
  const gap = hi - lo - 1;
  if (gap === 1) s -= 1; else if (gap === 2) s -= 2; else if (gap === 3) s -= 4; else if (gap >= 4) s -= 5;
  if ((gap === 0 || gap === 1) && hi < 12) s += 1; // straight/connector bonus (both below Q)
  return Math.ceil(s);
}

const CHEN = new Map(ALL_KEYS.map(k => [k, chenScore(k)]));
const CHEN_MIN = Math.min(...CHEN.values());
const CHEN_MAX = Math.max(...CHEN.values());
const KEYS_BY_CHEN_DESC = [...ALL_KEYS].sort((a, b) => CHEN.get(b) - CHEN.get(a) || parseKey(b).hi - parseKey(a).hi);

// Normalised preflop strength in [0,1].
export function strengthFraction(key) { return (CHEN.get(key) - CHEN_MIN) / (CHEN_MAX - CHEN_MIN); }

export class Range {
  constructor(weights) { this.weights = weights instanceof Map ? weights : new Map(); this._allCombos = null; }
  set(key, w) { this.weights.set(key, w); this._allCombos = null; return this; }
  get(key) { return this.weights.get(key) ?? 0; }
  keys() { return [...this.weights.keys()]; }
  clone() { return new Range(new Map(this.weights)); }

  // Expand to concrete combos, excluding any that use a dead (known) card.
  combos(deadCards = []) {
    const dead = new Set(deadCards.map(cardToString));
    const out = [];
    for (const [key, w] of this.weights) {
      if (w <= 0) continue;
      for (const combo of combosForKey(key)) {
        if (combo.some(c => dead.has(cardToString(c)))) continue;
        out.push({ cards: combo, weight: w });
      }
    }
    return out;
  }

  // Weight-averaged Chen score (a coarse "how strong is this range" summary).
  meanChen() {
    let num = 0, den = 0;
    for (const [key, w] of this.weights) { num += w * CHEN.get(key); den += w; }
    return den ? num / den : 0;
  }
}

// "Top X%" opening range by Chen rank (whole hand classes, weight 1.0).
export function topPercentRange(pct) {
  const target = pct * TOTAL_COMBOS;
  const r = new Range();
  let cum = 0;
  for (const key of KEYS_BY_CHEN_DESC) {
    r.set(key, 1);
    cum += comboCount(key);
    if (cum >= target) break;
  }
  return r;
}

// Uniformly-weighted full prior over all starting hands (spec 2.2 G prior).
export function fullRange() { const r = new Range(); for (const k of ALL_KEYS) r.set(k, 1); return r; }

// Reduce two concrete hole cards to their canonical class key (e.g. "AKs").
export function holeToKey(a, b) {
  let hi = a, lo = b;
  if (hi.rank < lo.rank) [hi, lo] = [lo, hi];
  if (hi.rank === lo.rank) return RANK_CHAR[hi.rank] + RANK_CHAR[lo.rank];
  return handKey(hi.rank, lo.rank, hi.suit === lo.suit);
}

// Top-fraction a hand class sits in by Chen rank (0 = strongest … 1 = weakest).
// Ties share the group's cumulative fraction, so "is this in the top X%?" is
// `keyTopFraction(key) <= X`.
const _TOP_FRAC = (() => {
  const m = new Map();
  let cum = 0, i = 0;
  while (i < KEYS_BY_CHEN_DESC.length) {
    const c = CHEN.get(KEYS_BY_CHEN_DESC[i]); const group = [];
    let j = i;
    while (j < KEYS_BY_CHEN_DESC.length && CHEN.get(KEYS_BY_CHEN_DESC[j]) === c) { group.push(KEYS_BY_CHEN_DESC[j]); cum += comboCount(KEYS_BY_CHEN_DESC[j]); j++; }
    for (const k of group) m.set(k, cum / TOTAL_COMBOS);
    i = j;
  }
  return m;
})();
export function keyTopFraction(key) { return _TOP_FRAC.get(key); }
export function handTopFraction(holeCards) { return keyTopFraction(holeToKey(holeCards[0], holeCards[1])); }
