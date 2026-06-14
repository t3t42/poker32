// opponentModel.js — Opponent statistics + range updates (spec 2.2 F/G).
//
// OpponentStats tracks the standard exploit metrics the AI keys off:
//   VPIP — Voluntarily Put $ In Pot %  (how loose preflop)
//   PFR  — PreFlop Raise %             (how aggressive preflop)
//   AF   — Aggression Factor = (bets+raises)/calls  (postflop aggression)
//   c-bet% — continuation-bet frequency
//
// The range updates implement the spec's "conjugate-update approximation": start
// from a uniform chart prior and shift weight toward hands consistent with the
// observed action / showdown. These are tractable, direction-correct
// reweightings (the spec explicitly models an approximation), not exact
// posteriors — exact hand strength is always evaluate7 at showdown.

import { Range, strengthFraction } from './range.js';

export class OpponentStats {
  constructor() {
    this.hands = 0;
    this.vpip = 0; this.pfr = 0;
    this.bets = 0; this.raises = 0; this.calls = 0;
    this.cbetOpp = 0; this.cbetMade = 0;
    this.showdowns = []; // observed revealed hand keys
  }
  recordHand({ voluntaryPutIn = false, raisedPreflop = false } = {}) {
    this.hands += 1;
    if (voluntaryPutIn) this.vpip += 1;
    if (raisedPreflop) this.pfr += 1;
  }
  recordAction(kind) {
    if (kind === 'bet') this.bets += 1;
    else if (kind === 'raise') this.raises += 1;
    else if (kind === 'call') this.calls += 1;
  }
  recordCbetOpportunity(made) { this.cbetOpp += 1; if (made) this.cbetMade += 1; }
  recordShowdown(handKey) { this.showdowns.push(handKey); }

  get VPIP() { return this.hands ? this.vpip / this.hands : 0; }
  get PFR() { return this.hands ? this.pfr / this.hands : 0; }
  get AF() {
    const agg = this.bets + this.raises;
    return this.calls > 0 ? agg / this.calls : (agg > 0 ? Infinity : 0);
  }
  get cbet() { return this.cbetOpp ? this.cbetMade / this.cbetOpp : 0; }
}

// Reweight a range given a preflop action. Aggression concentrates weight on
// strong hands; calling favours middling hands; checking/limping downweights
// premiums (which usually raise). `k` controls sharpness.
export function reweightByPreflopAction(range, action, k = 2) {
  const out = range.clone();
  for (const key of out.keys()) {
    const s = strengthFraction(key);
    let factor;
    if (action === 'raise' || action === 'bet') factor = Math.pow(s, k);
    else if (action === 'call') factor = 1 - Math.abs(s - 0.5) * 1.5;   // peak at medium
    else if (action === 'check' || action === 'limp') factor = Math.pow(1 - s, k * 0.75);
    else factor = 1;
    out.set(key, out.get(key) * Math.max(factor, 0));
  }
  return out;
}

// Showdown observation: shift weight toward the revealed hand (and, lightly,
// toward hands of similar strength). spec 2.2 G "관측 핸드 유형의 가중치 상향".
export function updateOnShowdown(range, shownKey, boost = 5, neighbourPull = 0.6) {
  const out = range.clone();
  out.set(shownKey, (out.get(shownKey) || 1) * boost);
  if (neighbourPull > 0) {
    const sRef = strengthFraction(shownKey);
    for (const key of out.keys()) {
      if (key === shownKey) continue;
      const closeness = 1 - Math.min(Math.abs(strengthFraction(key) - sRef) / 0.15, 1);
      if (closeness > 0) out.set(key, out.get(key) * (1 + neighbourPull * closeness));
    }
  }
  return out;
}

// Exploit cues derived from stats (consumed by the Phase 2b action pipeline).
// spec 2.2 G: loose opponents → widen value; high fold rate → widen bluffs.
export function exploitAdjustments(stats) {
  return {
    valueWiden: stats.VPIP > 0.35 ? (stats.VPIP - 0.35) * 2 : 0, // bet thinner vs loose/calling
    bluffWiden: stats.AF < 1 && stats.hands >= 10 ? 0.2 : 0,     // bluff more vs passive/foldy
  };
}
