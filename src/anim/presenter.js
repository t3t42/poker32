// presenter.js — converts (normalized) engine events into an animation queue
// (spec: engine events → animation queue). Each step is a pure descriptor the
// Timeline schedules; reduced motion collapses every step to an instant cut.
//
// The Phase-6 adapter fills each event's coordinates from the render layout, so
// this module stays DOM-free and testable. Phase-5a covers the core motions;
// the cinematic catalogue (WIN, SHOWDOWN, ALL-IN, timer…) is Phase-5b.

const MS = {
  deal: 420, dealStagger: 100,      // DEAL: parabola + 720° spin + bounce, 100ms stagger
  flip: 380,                         // FLIP: 3D rotateY 0→180
  bet: 320, betStagger: 40,          // BET: chip arc, 40ms stagger
  collect: 360, collectStagger: 20,  // COLLECT: bets → pot
  boardSlide: 300, boardStagger: 120,// FLOP/TURN/RIVER: slide-in → flip
};
export const MOTION_MS = MS;

const dealStep = e => ({
  id: e.id, kind: 'deal', path: 'parabola', lift: e.lift ?? 90,
  from: { x: e.from.x, y: e.from.y, rotate: 0, scale: 0.92, opacity: 0 },
  to: { x: e.to.x, y: e.to.y, rotate: 720, scale: 1, opacity: 1 },
  duration: MS.deal, delay: (e.order || 0) * MS.dealStagger, easing: 'deal',
});
const flipStep = e => ({
  id: e.id, kind: 'flip', from: { rotateY: 0 }, to: { rotateY: 180 },
  duration: MS.flip, delay: e.delay || 0, easing: 'smooth', faceUp: e.faceUp !== false,
});
const betStep = e => ({
  id: e.id, kind: 'bet', path: 'parabola', lift: e.lift ?? 40,
  from: { x: e.from.x, y: e.from.y, scale: 0.9, opacity: 0.85 },
  to: { x: e.to.x, y: e.to.y, scale: 1, opacity: 1 },
  duration: MS.bet, delay: (e.order || 0) * MS.betStagger, easing: 'pop',
});
const collectStep = (it, i) => ({
  id: it.id, kind: 'collect', from: { x: it.from.x, y: it.from.y, opacity: 1 },
  to: { x: it.to.x, y: it.to.y, scale: 0.92, opacity: 0.9 },
  duration: MS.collect, delay: i * MS.collectStagger, easing: 'collect',
});
function boardReveal(e) {
  const steps = [];
  (e.cards || []).forEach((c, i) => {
    const base = i * MS.boardStagger;
    steps.push({ id: c.id, kind: 'deal', path: 'parabola', lift: 30, from: { x: c.from.x, y: c.from.y, rotate: 0, scale: 0.96, opacity: 0 }, to: { x: c.to.x, y: c.to.y, rotate: 0, scale: 1, opacity: 1 }, duration: MS.boardSlide, delay: base, easing: 'deal' });
    steps.push({ id: c.id, kind: 'flip', from: { rotateY: 0 }, to: { rotateY: 180 }, duration: MS.flip, delay: base + MS.boardSlide, easing: 'smooth', faceUp: true });
  });
  return steps;
}

const MOTIONS = {
  DEAL: e => [dealStep(e)],
  BURN: e => [{ ...dealStep({ ...e, lift: 40 }), to: { x: e.to.x, y: e.to.y, rotate: 360, scale: 0.9, opacity: 0.55 } }],
  FLIP: e => [flipStep(e)],
  BET: e => [betStep(e)],
  POST_BLIND: e => [betStep(e)],
  COLLECT: e => (e.items || []).map(collectStep),
  FLOP: boardReveal, TURN: boardReveal, RIVER: boardReveal,
};

const instant = s => ({ ...s, duration: 0, delay: 0 });

export class Presenter {
  constructor({ reducedMotion = false } = {}) { this.reducedMotion = !!reducedMotion; }
  setReducedMotion(v) { this.reducedMotion = !!v; }            // spec 3.4 toggle / prefers-reduced-motion
  present(event) {
    const f = MOTIONS[event.type];
    let steps = f ? f(event) : [];
    return this.reducedMotion ? steps.map(instant) : steps;
  }
  presentAll(events) { return events.flatMap(e => this.present(e)); }
}
