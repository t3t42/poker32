// easing.js — cubic-bezier easing (spec 3.1 tokens, used per-motion in 3.4).
// Returns p∈[0,1] → eased value; overshoot curves (pop, deal) intentionally
// exceed 1 mid-flight and resolve to exactly 1 at p=1.

export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const bezX = t => ((ax * t + bx) * t + cx) * t;
  const bezY = t => ((ay * t + by) * t + cy) * t;
  const dBezX = t => (3 * ax * t + 2 * bx) * t + cx;
  function solveX(x) {
    let t = x;
    for (let i = 0; i < 8; i++) { const e = bezX(t) - x; if (Math.abs(e) < 1e-6) return t; const d = dBezX(t); if (Math.abs(d) < 1e-6) break; t -= e / d; }
    let lo = 0, hi = 1; t = x;
    for (let i = 0; i < 32; i++) { const e = bezX(t); if (Math.abs(e - x) < 1e-6) break; if (e < x) lo = t; else hi = t; t = (lo + hi) / 2; }
    return t;
  }
  return p => (p <= 0 ? 0 : p >= 1 ? 1 : bezY(solveX(p)));
}

export const EASINGS = {
  linear: p => p,
  deal: cubicBezier(0.18, 0.9, 0.32, 1.08),      // arrival overshoot/bounce
  collect: cubicBezier(0.5, -0.28, 0.74, 0.05),  // easeInBack
  pop: cubicBezier(0.34, 1.56, 0.64, 1),         // overshoot
  smooth: cubicBezier(0.4, 0, 0.2, 1),           // standard ease (flips)
};
export function easeByName(name) { return EASINGS[name] || EASINGS.linear; }
