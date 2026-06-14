// equity.js — Monte Carlo equity estimation (spec 2.1 step ①, ≥1000 sims).
//
// Estimates the hero's probability of winning (ties counted as fractional pot
// share) given hole cards, an optional partial board, and either a number of
// uniform-random opponents or per-opponent estimated ranges.
//
// Note on randomness: the *real* game deck (engine/deck.js) shuffles with
// crypto.getRandomValues. This SIMULATOR draws hypothetical run-outs, so it uses
// a fast seeded PRNG (mulberry32) — seeded from crypto by default, but
// injectable for deterministic tests. Math.random() is never used.

import { fullDeck, cardToString } from '../engine/cards.js';
import { evaluate7, compareScores } from '../engine/handEvaluator.js';

// --- seeded PRNG (mulberry32): fast, deterministic, returns [0,1) ---
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cryptoSeed() {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (c && c.getRandomValues) { const b = new Uint32Array(1); c.getRandomValues(b); return b[0]; }
  return (Date.now() ^ (Date.now() << 11)) >>> 0; // non-crypto fallback (never Math.random)
}

function shuffleInPlace(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

// Weighted draw of a non-conflicting 2-card combo from a Range; null if none fit.
function sampleRangeCombo(range, usedSet, rnd) {
  const all = range._allCombos || (range._allCombos = range.combos([]));
  let total = 0; const cand = [];
  for (const c of all) {
    if (c.cards.some(cd => usedSet.has(cardToString(cd)))) continue;
    cand.push(c); total += c.weight;
  }
  if (cand.length === 0 || total <= 0) return null;
  let x = rnd() * total;
  for (const c of cand) { x -= c.weight; if (x <= 0) return c.cards; }
  return cand[cand.length - 1].cards;
}

/**
 * General equity. `opponents` is an array; each entry is either a Range
 * (sampled) or null (uniform random hole cards).
 * @returns {{ equity:number, win:number, tie:number, lose:number, samples:number }}
 */
export function equity(hole, board = [], opponents = [null], opts = {}) {
  const samples = opts.samples ?? 1500;                 // spec: ≥1000
  const rnd = opts.random ?? mulberry32(opts.seed ?? cryptoSeed());
  const knownSet = new Set([...hole, ...board].map(cardToString));
  const deckBase = fullDeck().filter(c => !knownSet.has(cardToString(c)));
  const heroNeed = 5 - board.length;

  let wins = 0, ties = 0;
  const heroBase = [...hole];
  for (let s = 0; s < samples; s++) {
    const used = new Set(knownSet);
    const oppHoles = [];
    for (const opp of opponents) {
      if (opp && typeof opp.combos === 'function') {
        const combo = sampleRangeCombo(opp, used, rnd);
        if (combo) { oppHoles.push(combo); for (const c of combo) used.add(cardToString(c)); }
        else oppHoles.push(null);                       // range exhausted → fall back to uniform
      } else oppHoles.push(null);
    }
    const remaining = deckBase.filter(c => !used.has(cardToString(c)));
    shuffleInPlace(remaining, rnd);
    let idx = 0;
    for (let o = 0; o < oppHoles.length; o++) {
      if (oppHoles[o] === null) oppHoles[o] = [remaining[idx++], remaining[idx++]];
    }
    const fullBoard = heroNeed > 0 ? board.concat(remaining.slice(idx, idx + heroNeed)) : board;
    idx += heroNeed;

    const heroScore = evaluate7([...heroBase, ...fullBoard]).score;
    let beatsAll = true, tieCount = 0;
    for (const oh of oppHoles) {
      const cmp = compareScores(evaluate7([...oh, ...fullBoard]).score, heroScore);
      if (cmp > 0) { beatsAll = false; break; }
      if (cmp === 0) tieCount++;
    }
    if (!beatsAll) continue;
    if (tieCount > 0) ties += 1 / (tieCount + 1);
    else wins++;
  }
  const eq = (wins + ties) / samples;
  return { equity: eq, win: wins / samples, tie: ties / samples, lose: 1 - eq, samples };
}

// Hero vs N uniform-random opponents.
export function equityVsRandom(hole, board, numOpponents = 1, opts = {}) {
  return equity(hole, board, Array.from({ length: numOpponents }, () => null), opts);
}

// Hero vs explicit per-opponent ranges (ranges.length = number of opponents).
export function equityVsRanges(hole, board, ranges, opts = {}) {
  return equity(hole, board, ranges, opts);
}

// Pot odds → the break-even equity needed to call. spec 2.2(B) System-2 input.
export function potOdds(toCall, pot) {
  if (toCall <= 0) return 0;
  return toCall / (pot + toCall);
}
