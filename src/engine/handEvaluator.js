// handEvaluator.js — Exact hand evaluation (5–7 cards → best 5).
//
// Strategy: enumerate all C(7,5)=21 five-card subsets, score each exactly, and
// keep the maximum. Brute force is a deliberate correctness choice:
//   • Each 5-card subset is scored in isolation, so a flush and a straight that
//     do NOT share a suit can never be misread as a straight flush.
//   • 21 subsets is negligible cost, even inside Monte-Carlo equity loops
//     (Phase 2): ~21 cheap scorings per evaluation.
//
// A hand score is the array [category, ...tiebreakers], compared
// lexicographically. Within one category every score array has the same length,
// so comparison never runs off the end.

import { rankLabel } from './cards.js';

export const CATEGORY = {
  HIGH_CARD: 0, ONE_PAIR: 1, TWO_PAIR: 2, TRIPS: 3, STRAIGHT: 4,
  FLUSH: 5, FULL_HOUSE: 6, QUADS: 7, STRAIGHT_FLUSH: 8,
};

const CATEGORY_NAME = {
  0: 'High Card', 1: 'One Pair', 2: 'Two Pair', 3: 'Three of a Kind',
  4: 'Straight', 5: 'Flush', 6: 'Full House', 7: 'Four of a Kind', 8: 'Straight Flush',
};

// Score EXACTLY five cards → { cat, tb }.
export function rank5(five) {
  const ranksDesc = five.map(c => c.rank).sort((a, b) => b - a);
  const flush = five.every(c => c.suit === five[0].suit);

  // Straight detection (returns the high card, or null).
  const uniq = [...new Set(ranksDesc)].sort((a, b) => b - a);
  let straightHigh = null;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    // Wheel: A-2-3-4-5 → Ace plays low, 5 is the high card.
    else if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) straightHigh = 5;
  }

  // Rank multiplicities, sorted by (count desc, rank desc): the defining
  // pattern comes first, kickers follow already in descending order.
  const counts = new Map();
  for (const r of ranksDesc) counts.set(r, (counts.get(r) || 0) + 1);
  const groups = [...counts.entries()]
    .map(([r, c]) => ({ r, c }))
    .sort((a, b) => b.c - a.c || b.r - a.r);

  const straight = straightHigh !== null;

  if (straight && flush) return { cat: 8, tb: [straightHigh] };
  if (groups[0].c === 4) return { cat: 7, tb: [groups[0].r, groups[1].r] };
  if (groups[0].c === 3 && groups[1].c === 2) return { cat: 6, tb: [groups[0].r, groups[1].r] };
  if (flush) return { cat: 5, tb: ranksDesc.slice() };
  if (straight) return { cat: 4, tb: [straightHigh] };
  if (groups[0].c === 3) return { cat: 3, tb: [groups[0].r, groups[1].r, groups[2].r] };
  if (groups[0].c === 2 && groups[1].c === 2) return { cat: 2, tb: [groups[0].r, groups[1].r, groups[2].r] };
  if (groups[0].c === 2) return { cat: 1, tb: [groups[0].r, groups[1].r, groups[2].r, groups[3].r] };
  return { cat: 0, tb: ranksDesc.slice() };
}

// Lexicographic comparison of two score arrays. >0 if a beats b, 0 if tied.
export function compareScores(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? -1, y = b[i] ?? -1;
    if (x !== y) return x - y;
  }
  return 0;
}

// All k-combinations of arr, as arrays of elements (lexicographic by index).
export function combinations(arr, k) {
  const res = [];
  const n = arr.length;
  if (k > n) return res;
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    res.push(idx.map(i => arr[i]));
    let i = k - 1;
    while (i >= 0 && idx[i] === i + n - k) i--;
    if (i < 0) break;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
  return res;
}

// Evaluate 5, 6, or 7 cards → best 5-card hand.
export function evaluate7(handCards) {
  if (handCards.length < 5) throw new Error('evaluate7 needs ≥5 cards');
  let bestScore = null, best5 = null;
  for (const five of combinations(handCards, 5)) {
    const { cat, tb } = rank5(five);
    const score = [cat, ...tb];
    if (bestScore === null || compareScores(score, bestScore) > 0) {
      bestScore = score; best5 = five;
    }
  }
  return { score: bestScore, category: bestScore[0], best5, ...describe(bestScore) };
}

// Human-readable name/detail for showdown typography (Phase 5).
function describe(score) {
  const cat = score[0];
  const tb = score.slice(1);
  const L = rankLabel;
  let name = CATEGORY_NAME[cat];
  let detail = '';
  if (cat === 8) name = tb[0] === 14 ? 'Royal Flush' : 'Straight Flush';
  switch (cat) {
    case 8: detail = tb[0] === 14 ? '' : `${L(tb[0])}-high`; break;
    case 7: detail = `Four ${L(tb[0])}s`; break;
    case 6: detail = `${L(tb[0])}s full of ${L(tb[1])}s`; break;
    case 5: detail = `${L(tb[0])}-high`; break;
    case 4: detail = `${L(tb[0])}-high`; break;
    case 3: detail = `Three ${L(tb[0])}s`; break;
    case 2: detail = `${L(tb[0])}s & ${L(tb[1])}s`; break;
    case 1: detail = `Pair of ${L(tb[0])}s`; break;
    case 0: detail = `${L(tb[0])}-high`; break;
  }
  return { name, detail };
}
