// prospect.js — Prospect Theory (Kahneman & Tversky, 1979). spec 2.2(A).
//
// Outcomes are evaluated as gains/losses relative to a reference point r
// (the session-start stack), NOT as absolute wealth. Two human regularities:
//   • Loss aversion: losses loom larger than equal gains (factor λ).
//   • Diminishing sensitivity: the value curve is concave for gains and convex
//     for losses → people are risk-averse in gains, risk-seeking in losses.
// Probability weighting w(p) (Tversky & Kahneman, 1992 single-parameter form)
// overweights small probabilities — why long-shot draws get chased.

import { PT } from './personalities.js';

/**
 * Subjective value of an outcome x (chips relative to the reference point).
 *   v(x) =  x^α            for x ≥ 0
 *   v(x) = −λ·(−x)^β       for x < 0
 * @param {number} x       chips above (+) or below (−) the reference point
 * @param {number} lambda  loss-aversion λ (archetype-specific, 1.5–2.5)
 */
export function value(x, lambda, { alpha = PT.alpha, beta = PT.beta } = {}) {
  if (x >= 0) return Math.pow(x, alpha);
  return -lambda * Math.pow(-x, beta);
}

/**
 * Probability weighting w(p) = p^γ / (p^γ + (1−p)^γ)^(1/γ).
 * Inverse-S: overweights low p, underweights high p. spec 2.2(A).
 */
export function weightProb(p, gamma = PT.gamma) {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const num = Math.pow(p, gamma);
  return num / Math.pow(num + Math.pow(1 - p, gamma), 1 / gamma);
}

// Gain/loss relative to the reference point: x = currentStack + expectedChange − r.
export function relativeOutcome(currentStack, expectedChange, referenceStack) {
  return currentStack + expectedChange - referenceStack;
}

// Convenience: the prospect-theory value of ending a hand at `endStack`,
// measured from the reference point, using a personality's loss aversion.
export function prospectValue(endStack, referenceStack, lambda, opts) {
  return value(endStack - referenceStack, lambda, opts);
}
