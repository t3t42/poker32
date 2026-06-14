// cognitiveState.js — Per-AI psychology that persists across hands.
//
// Holds the affective/cognitive variables the decision pipeline reads:
//   • tiltLevel ∈ [0,1]            — Affect Heuristic (spec 2.2 C)
//   • cognitiveLoad(ctx)           — Dual-Process load (spec 2.2 B)
//   • system2Weight(ctx)           — S1/S2 mix: cap − load − 0.4·tilt
//   • recent buffer / lossStreak   — recency & gambler's fallacy (spec 2.2 E)
//   • referenceStack               — Prospect-Theory reference r (spec 2.2 A)
// recordHandResult(...) is the post-hand hook (called from observe() in 2b-ii).

const clamp01 = x => Math.max(0, Math.min(1, x));

export class CognitiveState {
  constructor(personality, sessionStartStack) {
    this.p = personality;
    this.referenceStack = sessionStartStack; // r — session start stack (spec 2.2 A)
    this.tiltLevel = 0;
    this.handsPlayed = 0;
    this.lossStreak = 0;
    this.recent = []; // last N=10 hand outcomes { won, netChips }
  }

  /**
   * Update affect/recency after a completed hand.
   * @param {object} r
   * @param {boolean} r.won
   * @param {number}  [r.potSize]              pot size this hand
   * @param {number}  [r.startStack]           our stack at the hand's start
   * @param {number|null} [r.hadEquityAtShowdown]  our equity when we got it in
   * @param {boolean} [r.bluffCaught]
   * @param {number}  [r.netChips]
   */
  recordHandResult({ won, potSize = 0, startStack = 1, hadEquityAtShowdown = null, bluffCaught = false, netChips = 0 }) {
    // --- tilt accrual triggers (spec 2.2 C) ---
    let dTilt = 0;
    if (hadEquityAtShowdown !== null && hadEquityAtShowdown >= 0.8 && !won) dTilt += 0.30; // bad beat
    if (!won && potSize >= startStack * 0.5) dTilt += 0.15;                                 // big pot loss
    if (bluffCaught) dTilt += 0.10;                                                          // bluff snapped off
    if (won) this.lossStreak = 0; else this.lossStreak += 1;
    if (!won && this.lossStreak >= 3) dTilt += 0.10;                                         // 3+ losses

    // Per-hand decay ×0.92, scaled accrual, big-pot-win bonus (spec 2.2 C).
    let t = this.tiltLevel * 0.92 + dTilt * this.p.tiltSusceptibility;
    if (won && potSize >= startStack * 0.5) t -= 0.15;
    this.tiltLevel = clamp01(t);

    this.handsPlayed += 1;
    this.recent.push({ won, netChips });
    if (this.recent.length > 10) this.recent.shift();
  }

  // Cognitive load rises with multiway pots, big pots (vs stack), fatigue, and
  // tilt. High load → the pipeline leans on System 1 → human-like mistakes.
  cognitiveLoad({ activePlayers = 2, potToStackRatio = 0 } = {}) {
    const multiway = clamp01((activePlayers - 2) * 0.15);
    const potPressure = clamp01(potToStackRatio * 0.5);
    const fatigue = clamp01(this.handsPlayed / 200);
    const tiltLoad = this.tiltLevel * 0.5;
    return clamp01(multiway + potPressure + fatigue + tiltLoad);
  }

  // Weight on deliberate System-2 reasoning. spec 2.2 B (w = cap − load) and
  // spec 2.2 C (tilt subtracts 0.4·tilt from the System-2 weight).
  system2Weight(ctx = {}) {
    return clamp01(this.p.system2Capacity - this.cognitiveLoad(ctx) - 0.4 * this.tiltLevel);
  }

  // Recency / gambler's fallacy (spec 2.2 E): after consecutive non-winning
  // hands, irrationally adjust draw chasing. Aggressive archetypes chase harder
  // ("I'm due"), passive ones retreat.
  drawChaseMultiplier() {
    if (this.lossStreak < 2) return 1;
    const intensity = Math.min((this.lossStreak - 1) * 0.15, 0.6);
    const dir = this.p.aggression >= 0.5 ? +1 : -1;
    return 1 + dir * intensity;
  }
}
