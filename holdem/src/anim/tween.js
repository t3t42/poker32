// tween.js — interpolation primitives shared by the animator. Pure; GPU-only
// outputs (transform/opacity). The parabola gives deals/bets their arc.

export const lerp = (a, b, t) => a + (b - a) * t;

// Quadratic-bezier point from `from` to `to`, lifted by `liftPx` at the apex
// (negative y = upward on screen). p=0 → from, p=1 → to, p=0.5 → apex.
export function parabolaPoint(from, to, liftPx, p) {
  const cx = (from.x + to.x) / 2;
  const cy = (from.y + to.y) / 2 - liftPx;
  const u = 1 - p;
  return {
    x: u * u * from.x + 2 * u * p * cx + p * p * to.x,
    y: u * u * from.y + 2 * u * p * cy + p * p * to.y,
  };
}

// Build a CSS transform from animatable props. Only transform/opacity are ever
// animated (spec 3.4: 60fps, no layout-triggering properties).
export function transformString({ x = 0, y = 0, rotate = 0, rotateY = 0, scale = 1 } = {}) {
  let t = `translate(${round(x)}px, ${round(y)}px)`;
  if (rotateY) t += ` perspective(1000px) rotateY(${round(rotateY)}deg)`;
  if (rotate) t += ` rotate(${round(rotate)}deg)`;
  if (scale !== 1) t += ` scale(${round(scale, 4)})`;
  return t;
}
const round = (n, d = 2) => { const f = 10 ** d; return Math.round(n * f) / f; };
