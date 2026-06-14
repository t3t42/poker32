// anim.effects.test.js — runnable in Node (node tests/...).
//
// Phase 5b: deterministic logic behind the cinematics — particle physics,
// shockwave, big-hand config, letter stagger, rolling counter, turn-timer ring,
// event→cue mapping, and the synthesised-sound specs + mute gating. The visual
// effects themselves are verified in demo/effects.html.

import { spawnBurst, stepParticles, shockwave, cinematicForCategory, letterStagger, rollCounter, timerColor, timerArc, effectsForEvent, soundSpec, SoundBoard } from '../src/anim/index.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  \u2713 ${name}`); passed++; }
  catch (e) { console.error(`  \u2717 ${name}\n      ${e.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t;

console.log('Particles');

test('burst spawns the requested count within the spec 60–120 range', () => {
  assert(spawnBurst(0, 0).length === 90, 'default 90');
  assert(spawnBurst(0, 0, { count: 120 }).length === 120, 'count param');
  for (const p of spawnBurst(10, 20, { rng: () => 0.5 })) assert(p.x === 10 && p.y === 20 && p.life > 0, 'origin + life');
});
test('particles advance by velocity + gravity, fade, and die after their life', () => {
  const ps = [{ x: 0, y: 0, vx: 100, vy: 0, age: 0, life: 1, size: 3, opacity: 1 }];
  const a = stepParticles(ps, 0.1, { gravity: 400 });
  assert(near(a[0].x, 10) && near(a[0].vy, 40) && a[0].opacity < 1, 'moved + gravity + fade');
  assert(stepParticles([{ x: 0, y: 0, vx: 0, vy: 0, age: 0.99, life: 1 }], 0.1).length === 0, 'expired removed');
});

console.log('Shockwave & cinematic config');

test('shockwave grows and fades over its duration', () => {
  assert(near(shockwave(0).radius, 0) && shockwave(0).opacity === 1, 'starts small/opaque');
  const end = shockwave(600, { duration: 600, maxR: 200 });
  assert(near(end.radius, 200) && near(end.opacity, 0) && end.done, 'ends full/clear');
});
test('quads+ and royal trigger slow-mo/shake/vignette; small hands do not', () => {
  const royal = cinematicForCategory(8, { royal: true });
  assert(royal.royal && royal.fullscreen && royal.slowmo === 0.5, 'royal special');
  assert(cinematicForCategory(7).fullscreen && cinematicForCategory(7).shake === 3, 'quads cinematic');
  const pair = cinematicForCategory(1);
  assert(!pair.fullscreen && pair.slowmo === 1 && pair.shake === 0, 'pair = no cinematic');
});

console.log('Typography, counter, timer ring');

test('hand-name letters stagger with increasing delay', () => {
  const ls = letterStagger('FLUSH', 40);
  assert(ls.length === 5 && ls[0].delay === 0 && ls[4].delay === 160, 'stagger');
});
test('pot counter rolls from→to as an integer', () => {
  assert(rollCounter(0, 1000, 0) === 0 && rollCounter(0, 1000, 1) === 1000, 'endpoints');
  const mid = rollCounter(0, 1000, 0.5);
  assert(Number.isInteger(mid) && mid > 0 && mid < 1000, 'integer midpoint');
});
test('timer ring colour shifts cyan→amber→red; arc dashoffset tracks fraction', () => {
  assert(timerColor(1) === 'rgb(57, 194, 215)', 'full = cyan');
  assert(timerColor(0) === 'rgb(224, 69, 79)', 'empty = red');
  assert(timerColor(0.5) === 'rgb(230, 180, 40)', 'half = amber');
  assert(timerArc(1, 100).dashoffset === 0 && timerArc(0, 100).dashoffset === 100, 'gauge sweep');
});

console.log('Event → effect cues (spec 3.4)');

test('WIN, SHOWDOWN, and ALL-IN map to the right cues', () => {
  const win = effectsForEvent({ type: 'WIN', seat: 0, from: 0, to: 1200 }).map(c => c.effect);
  assert(win.includes('potBurst') && win.includes('winnerGlow') && win.includes('potCounter'), 'win cues');
  const royal = effectsForEvent({ type: 'SHOWDOWN', handName: 'Royal Flush', category: 8, royal: true }).map(c => c.effect);
  assert(royal.includes('handName') && royal.includes('cardGlow') && royal.includes('cinematic'), 'royal showdown cues');
  const small = effectsForEvent({ type: 'SHOWDOWN', handName: 'Pair', category: 1 }).map(c => c.effect);
  assert(!small.includes('cinematic'), 'no cinematic for a pair');
  const allin = effectsForEvent({ type: 'ALL_IN', seat: 2 }).map(c => c.effect);
  assert(allin.includes('shockwave') && allin.includes('banner') && allin.includes('seatRim'), 'all-in cues');
});

console.log('Sound (spec 3.5)');

test('sound specs exist for the table sounds', () => {
  assert(soundSpec('cardSlide').kind === 'noise' && soundSpec('chip').kind === 'clicks' && soundSpec('win').kind === 'tones', 'specs');
  assert(soundSpec('nope') === null, 'unknown → null');
});
test('SoundBoard honours mute and lazily builds one context', () => {
  let made = 0;
  const fakeCtx = () => { made++; return {}; };               // bare ctx; renderSound is optional-chained
  const muted = new SoundBoard({ ctxFactory: fakeCtx, muted: true });
  assert(muted.play('win') === false && made === 0, 'muted plays nothing, no context');
  const on = new SoundBoard({ ctxFactory: fakeCtx });
  assert(on.play('chip') === true && on.play('win') === true && made === 1, 'unmuted plays, context cached');
  on.setMuted(true);
  assert(on.play('win') === false, 'toggle to mute');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
