// effects.js — deterministic logic behind the cinematic catalogue (spec 3.4).
// Pure (no DOM/Canvas): particle physics, shockwave rings, the slow-mo/shake/
// vignette config by hand strength, hand-name letter stagger, the pot rolling
// counter, the turn-timer ring colour/arc, and event→effect-cue mapping. The
// demo/Phase-6 renderer draws these on a Canvas/overlay.

// ---- particles (WIN gold burst, quads+ full-screen, ambient dust) ----
export function spawnBurst(cx, cy, { count = 90, speed = [80, 260], angle = [0, 360], life = [0.6, 1.2], size = [2, 6], rng = Math.random } = {}) {
  const ps = [];
  for (let i = 0; i < count; i++) {
    const a = (angle[0] + rng() * (angle[1] - angle[0])) * Math.PI / 180;
    const sp = speed[0] + rng() * (speed[1] - speed[0]);
    ps.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0, life: life[0] + rng() * (life[1] - life[0]), size: size[0] + rng() * (size[1] - size[0]), opacity: 1 });
  }
  return ps;
}
export function stepParticles(ps, dt, { gravity = 420, drag = 0 } = {}) {
  const alive = [];
  for (const p of ps) {
    p.age += dt;
    if (p.age >= p.life) continue;
    p.vy += gravity * dt;
    if (drag) { p.vx *= 1 - drag * dt; p.vy *= 1 - drag * dt; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.opacity = 1 - p.age / p.life;
    alive.push(p);
  }
  return alive;
}

// ---- shockwave ring (ALL-IN) ----
export function shockwave(t, { duration = 600, maxR = 220 } = {}) {
  const p = Math.min(t / duration, 1);
  return { radius: maxR * p, opacity: 1 - p, done: p >= 1 };
}

// ---- big-hand cinematic config (spec: 포카드+ slow-mo/vignette/shake; royal special) ----
// category is the engine hand rank 0..8 (8 = straight flush); quads+ = 7+.
export function cinematicForCategory(category, { royal = false } = {}) {
  if (royal) return { slowmo: 0.5, slowmoMs: 600, shake: 4, vignette: 0.9, fullscreen: true, royal: true, particles: 140 };
  if (category >= 7) return { slowmo: 0.5, slowmoMs: 600, shake: 3, vignette: 0.7, fullscreen: true, royal: false, particles: 120 };
  return { slowmo: 1, slowmoMs: 0, shake: 0, vignette: 0, fullscreen: false, royal: false, particles: 0 };
}

// ---- hand-name typography (letter-by-letter stagger) ----
export function letterStagger(text, perLetterMs = 45) {
  return [...(text || '')].map((ch, i) => ({ ch, delay: i * perLetterMs }));
}

// ---- pot rolling counter ----
export function rollCounter(from, to, p, easing = t => t) {
  const e = easing(Math.min(Math.max(p, 0), 1));
  return Math.round(from + (to - from) * e);
}

// ---- turn-timer ring: colour cyan→amber→red, and dash for the gauge ----
const CYAN = [57, 194, 215], AMBER = [230, 180, 40], RED = [224, 69, 79];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
export function timerColor(frac) {
  frac = Math.min(Math.max(frac, 0), 1);
  const rgb = frac >= 0.5 ? mix(AMBER, CYAN, (frac - 0.5) / 0.5) : mix(RED, AMBER, frac / 0.5);
  return `rgb(${rgb.join(', ')})`;
}
export function timerArc(frac, circumference) {
  frac = Math.min(Math.max(frac, 0), 1);
  return { dasharray: circumference, dashoffset: circumference * (1 - frac) };
}

// ---- event → effect cues (the Phase-6 adapter renders each cue) ----
export function effectsForEvent(event) {
  switch (event.type) {
    case 'WIN':
      return [{ effect: 'potBurst', at: event.at, particles: event.particles || 90 }, { effect: 'winnerGlow', target: event.seat }, { effect: 'potCounter', from: event.from || 0, to: event.to || 0 }];
    case 'SHOWDOWN': {
      const cine = cinematicForCategory(event.category ?? 0, { royal: !!event.royal });
      const cues = [{ effect: 'cardGlow', cards: event.winningCards || [] }, { effect: 'handName', text: event.handName || '', letters: letterStagger(event.handName || '') }];
      if (cine.fullscreen) cues.push({ effect: 'cinematic', config: cine });
      return cues;
    }
    case 'ALL_IN':
      return [{ effect: 'shockwave', at: event.at, rings: 2 }, { effect: 'banner', text: 'ALL IN' }, { effect: 'seatRim', target: event.seat, color: 'danger' }];
    default:
      return [];
  }
}
