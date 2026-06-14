// animator.js — schedule and run animation steps. The Timeline is a pure,
// samplable function of time (testable without rAF); `play` drives it with
// requestAnimationFrame in the browser; `domApply` writes transform/opacity
// (and flip face-swap) to elements. 60fps, transform/opacity only (spec 3.4).

import { easeByName } from './easing.js';
import { lerp, parabolaPoint, transformString } from './tween.js';

function propsAt(s, t) {
  const start = s.delay || 0, dur = s.duration || 0, end = start + dur;
  if (dur === 0 || t >= end) return { ...s.to };
  if (t <= start) return { ...s.from };
  const p = easeByName(s.easing)((t - start) / dur);
  const out = {};
  for (const k of new Set([...Object.keys(s.from), ...Object.keys(s.to)])) out[k] = lerp(s.from[k] ?? 0, s.to[k] ?? 0, p);
  if (s.path === 'parabola') { const pt = parabolaPoint({ x: s.from.x, y: s.from.y }, { x: s.to.x, y: s.to.y }, s.lift || 0, p); out.x = pt.x; out.y = pt.y; }
  return out;
}

export class Timeline {
  constructor(steps = [], { reducedMotion = false } = {}) {
    this.steps = reducedMotion ? steps.map(s => ({ ...s, duration: 0, delay: 0 })) : steps;
    this.duration = this.steps.reduce((m, s) => Math.max(m, (s.delay || 0) + (s.duration || 0)), 0);
  }
  // Apply the correct props for every step at time t. Multiple steps on one
  // target are MERGED (e.g. a deal sets x/y/scale, a later flip adds rotateY),
  // so a flip never clobbers a card's position.
  sampleAt(t, apply) {
    const byId = new Map();
    for (const s of this.steps) {
      const prev = byId.get(s.id) || { props: {}, meta: {} };
      prev.props = { ...prev.props, ...propsAt(s, t) };
      prev.meta[s.kind] = s;
      byId.set(s.id, prev);
    }
    for (const [id, { props, meta }] of byId) apply(id, props, meta);
  }
  done(t) { return t >= this.duration; }
}

export const buildTimeline = (steps, opts) => new Timeline(steps, opts);

// Drive a timeline to completion. raf/now injectable for tests.
export function play(timeline, apply, { raf, now, onDone } = {}) {
  raf = raf || (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame.bind(globalThis) : cb => setTimeout(() => cb(), 16));
  now = now || (typeof performance !== 'undefined' ? () => performance.now() : () => Date.now());
  const start = now();
  (function frame() {
    const t = now() - start;
    timeline.sampleAt(t, apply);
    if (timeline.done(t)) { onDone && onDone(); } else raf(frame);
  })();
}

// Browser apply: write transform + opacity, and flip the face at rotateY > 90.
export function domApply(resolve) {
  const get = typeof resolve === 'function' ? resolve : id => resolve[id];
  return (id, props) => {
    const el = get(id);
    if (!el) return;
    el.style.transform = transformString(props);
    if (props.opacity != null) el.style.opacity = props.opacity;
    if (props.rotateY != null) el.dataset.flipped = props.rotateY > 90 ? '1' : '0';
  };
}
