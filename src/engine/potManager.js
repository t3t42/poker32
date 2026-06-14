// potManager.js — Side-pot construction and distribution.
//
// Two pure stages, deliberately decoupled from hand evaluation AND from seating
// so each is unit-testable in isolation:
//   buildPots(contributions)            — pure chip math (eligibility per layer)
//   distribute(pots, scores, seatOrder) — awards each layer to its best hand
//
// Rules (spec 1.2):
//  • Pots are layered by all-in (contribution) levels.
//  • A folded player's chips STAY in the pot, but the player can never WIN.
//  • Ties split equally; indivisible leftover chips are handed out one at a time
//    starting from the first seat LEFT of the dealer button.

import { compareScores } from './handEvaluator.js';

/**
 * @param {{ playerId:any, committed:number, folded:boolean }[]} contributions
 *   committed = total chips this player has put into the pot this hand.
 * @returns {{ amount:number, eligible:any[] }[]} main pot first.
 */
export function buildPots(contributions) {
  // Distinct positive contribution levels define the layer boundaries.
  const caps = [...new Set(
    contributions.filter(c => c.committed > 0).map(c => c.committed),
  )].sort((a, b) => a - b);

  const pots = [];
  let prev = 0;
  for (const cap of caps) {
    const layer = cap - prev;
    const contributors = contributions.filter(c => c.committed >= cap);
    // Every contributor (folded included) funds `layer` chips into this slice…
    const amount = layer * contributors.length;
    // …but only non-folded contributors are eligible to win it.
    const eligible = contributors.filter(c => !c.folded).map(c => c.playerId);
    if (amount > 0) pots.push({ amount, eligible });
    prev = cap;
  }

  // Merge adjacent layers with identical eligibility. Purely cosmetic — payouts
  // are identical either way — so the UI shows "main + side" not thin slivers.
  const merged = [];
  for (const p of pots) {
    const last = merged[merged.length - 1];
    if (last && sameSet(last.eligible, p.eligible)) last.amount += p.amount;
    else merged.push({ amount: p.amount, eligible: [...p.eligible] });
  }
  return merged;
}

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every(x => s.has(x));
}

/**
 * @param {{ amount:number, eligible:any[] }[]} pots
 * @param {Map<any, number[]>} scores  playerId → hand score array (evaluate7)
 * @param {any[]} seatOrder  playerIds ordered from the first seat LEFT of the
 *   button; used to resolve indivisible leftover chips.
 * @returns {{ payouts: Map<any,number>, potResults: object[] }}
 */
export function distribute(pots, scores, seatOrder) {
  const payouts = new Map();
  const add = (pid, n) => payouts.set(pid, (payouts.get(pid) || 0) + n);
  const orderIndex = new Map(seatOrder.map((pid, i) => [pid, i]));
  const potResults = [];

  for (const pot of pots) {
    const contenders = pot.eligible.filter(pid => scores.has(pid));
    if (contenders.length === 0) {
      potResults.push({ amount: pot.amount, winners: [], perWinner: 0, oddChipsTo: [] });
      continue;
    }

    let best = null;
    for (const pid of contenders) {
      if (best === null || compareScores(scores.get(pid), scores.get(best)) > 0) best = pid;
    }
    const winners = contenders
      .filter(pid => compareScores(scores.get(pid), scores.get(best)) === 0)
      .sort((x, y) => (orderIndex.get(x) ?? 0) - (orderIndex.get(y) ?? 0));

    const perWinner = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - perWinner * winners.length;
    const oddChipsTo = [];
    for (const w of winners) {
      let n = perWinner;
      if (remainder > 0) { n += 1; remainder--; oddChipsTo.push(w); }
      add(w, n);
    }
    potResults.push({ amount: pot.amount, winners, perWinner, oddChipsTo });
  }
  return { payouts, potResults };
}

/**
 * Canonical odd-chip / action order: the seat immediately clockwise of the
 * button (the small-blind seat) comes first; the button comes last.
 * @param {{ playerId:any, seat:number }[]} players
 * @param {number} buttonSeat
 * @param {number} numSeats
 */
export function seatOrderFromButton(players, buttonSeat, numSeats) {
  const key = seat => (seat - buttonSeat - 1 + numSeats) % numSeats;
  return [...players].sort((a, b) => key(a.seat) - key(b.seat)).map(p => p.playerId);
}
