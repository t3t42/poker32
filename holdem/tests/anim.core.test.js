// anim.core.test.js — runnable in Node (node tests/...).
//
// Phase 5a: easing curves, tween/parabola math, the event→step Presenter,
// the samplable Timeline (merging + scheduling + reduced-motion), and the play
// loop (driven by a fake clock). Motion itself is verified in demo/anim.html.

import { cubicBezier, EASINGS, easeByName, lerp, parabolaPoint, transformString, Presenter, MOTION_MS, Timeline, play, domApply } from '../src/anim/index.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  \u2713 ${name}`); passed++; }
  catch (e) { console.error(`  \u2717 ${name}\n      ${e.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t;
const samples = (f, n = 21) => Array.from({ length: n + 1 }, (_, i) => f(i / n));

console.log('Easing (spec 3.1)');

test('endpoints are pinned to 0 and 1', () => {
  for (const k of ['deal', 'collect', 'pop', 'smooth', 'linear']) assert(EASINGS[k](0) === 0 && EASINGS[k](1) === 1, `${k} endpoints`);
  assert(near(EASINGS.linear(0.5), 0.5), 'linear midpoint');
});
test('overshoot (pop/deal) exceeds 1 mid-flight; easeInBack (collect) dips below 0', () => {
  assert(Math.max(...samples(EASINGS.pop)) > 1, 'pop overshoots');
  assert(Math.max(...samples(EASINGS.deal)) > 1, 'deal overshoots');
  assert(Math.min(...samples(EASINGS.collect)) < 0, 'collect undershoots');
});
test('easeByName falls back to linear', () => { assert(easeByName('nope')(0.4) === 0.4, 'fallback'); });

console.log('Tween');

test('parabola hits endpoints and lifts the apex by half', () => {
  const from = { x: 0, y: 100 }, to = { x: 100, y: 100 };
  assert(near(parabolaPoint(from, to, 40, 0).x, 0) && near(parabolaPoint(from, to, 40, 1).x, 100), 'endpoints');
  assert(near(parabolaPoint(from, to, 40, 0.5).y, 100 - 20), 'apex lifted by lift/2');
});
test('transform string emits only transform-safe props', () => {
  const s = transformString({ x: 10, y: 20, rotate: 45, scale: 1.2 });
  assert(s.includes('translate(10px, 20px)') && s.includes('rotate(45deg)') && s.includes('scale(1.2)'), s);
  assert(transformString({ rotateY: 120 }).includes('perspective(1000px) rotateY(120deg)'), 'flip uses perspective');
});

console.log('Presenter (event → steps, spec 3.4)');

test('DEAL → parabolic spin step, staggered by order', () => {
  const [s] = new Presenter().present({ type: 'DEAL', id: 'c0', from: { x: 450, y: 0 }, to: { x: 100, y: 500 }, order: 2 });
  assert(s.kind === 'deal' && s.path === 'parabola' && s.duration === MOTION_MS.deal, 'deal step');
  assert(s.to.rotate === 720 && s.to.opacity === 1 && s.from.opacity === 0, '720° spin + fade in');
  assert(s.delay === 2 * MOTION_MS.dealStagger, '100ms stagger');
});
test('FLIP → 3D rotateY 0→180', () => {
  const [s] = new Presenter().present({ type: 'FLIP', id: 'c0' });
  assert(s.kind === 'flip' && s.from.rotateY === 0 && s.to.rotateY === 180 && s.duration === MOTION_MS.flip, 'flip step');
});
test('BET → chip arc staggered 40ms; COLLECT → one step per item', () => {
  const [b] = new Presenter().present({ type: 'BET', id: 'chip', from: { x: 0, y: 0 }, to: { x: 9, y: 9 }, order: 3 });
  assert(b.kind === 'bet' && b.path === 'parabola' && b.delay === 3 * MOTION_MS.betStagger, 'bet arc');
  const steps = new Presenter().present({ type: 'COLLECT', items: [{ id: 'a', from: { x: 0, y: 0 }, to: { x: 5, y: 5 } }, { id: 'b', from: { x: 1, y: 1 }, to: { x: 5, y: 5 } }] });
  assert(steps.length === 2 && steps.every(s => s.kind === 'collect'), 'collect per item');
});
test('FLOP → slide-in then flip for each board card', () => {
  const steps = new Presenter().present({ type: 'FLOP', cards: [0, 1, 2].map(i => ({ id: 'b' + i, from: { x: 400, y: 280 }, to: { x: 300 + i * 64, y: 280 } })) });
  assert(steps.length === 6, 'three cards × (slide + flip)');
  assert(steps.filter(s => s.kind === 'deal').length === 3 && steps.filter(s => s.kind === 'flip').length === 3, 'kinds');
  const flip0 = steps.find(s => s.id === 'b0' && s.kind === 'flip');
  assert(flip0.delay >= MOTION_MS.boardSlide, 'flip waits for the slide to arrive');
});
test('reduced motion collapses every step to an instant cut', () => {
  const p = new Presenter({ reducedMotion: true });
  const steps = p.present({ type: 'DEAL', id: 'c0', from: { x: 1, y: 2 }, to: { x: 3, y: 4 }, order: 3 });
  assert(steps.every(s => s.duration === 0 && s.delay === 0), 'all instant');
});

console.log('Timeline (scheduling + merge)');

const dealSteps = new Presenter().present({ type: 'DEAL', id: 'c0', from: { x: 0, y: 0 }, to: { x: 100, y: 100 }, order: 0 });

test('samples from at t=0, to at end, and interpolates between', () => {
  const tl = new Timeline(dealSteps);
  let at0, atEnd, atMid;
  tl.sampleAt(0, (id, p) => (at0 = p));
  tl.sampleAt(MOTION_MS.deal, (id, p) => (atEnd = p));
  tl.sampleAt(MOTION_MS.deal / 2, (id, p) => (atMid = p));
  assert(at0.opacity === 0 && atEnd.opacity === 1, 'opacity 0→1');
  assert(atEnd.rotate === 720 && atMid.rotate > 0 && atMid.rotate < 720, 'spin progresses');
  assert(atMid.opacity > 0 && atMid.opacity < 1, 'mid opacity');
});
test('duration is the max of delay+duration; staggered step waits', () => {
  const steps = new Presenter().present({ type: 'DEAL', id: 'c1', from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, order: 2 });
  assert(new Timeline(steps).duration === 2 * MOTION_MS.dealStagger + MOTION_MS.deal, 'duration includes delay');
});
test('a flip merges with a deal on the same id without clobbering position', () => {
  const steps = [
    ...new Presenter().present({ type: 'DEAL', id: 'c0', from: { x: 0, y: 0 }, to: { x: 80, y: 90 }, order: 0 }),
    { id: 'c0', kind: 'flip', from: { rotateY: 0 }, to: { rotateY: 180 }, duration: 100, delay: MOTION_MS.deal, easing: 'smooth' },
  ];
  const tl = new Timeline(steps);
  let props;
  tl.sampleAt(MOTION_MS.deal + 50, (id, p) => (props = p)); // deal done, flip mid
  assert(near(props.x, 80) && near(props.y, 90), 'position preserved from the deal');
  assert(props.rotateY > 0 && props.rotateY < 180, 'flip in progress on the same element');
});
test('reduced-motion timeline jumps to final state at t=0', () => {
  const tl = new Timeline(dealSteps, { reducedMotion: true });
  let p; tl.sampleAt(0, (id, x) => (p = x));
  assert(p.opacity === 1 && p.rotate === 720 && tl.done(0), 'instant final');
});

console.log('Play loop & DOM apply');

test('play drives a timeline to completion (fake clock)', () => {
  const tl = new Timeline(dealSteps);
  const seen = []; let done = false;
  let t = 0; const now = () => t; const raf = cb => { t += 90; cb(); };
  play(tl, (id, p) => seen.push(p), { now, raf, onDone: () => (done = true) });
  assert(done, 'onDone fired');
  assert(seen[seen.length - 1].opacity === 1 && seen[seen.length - 1].rotate === 720, 'ends at final state');
});
test('domApply writes transform/opacity and flips the face past 90°', () => {
  const el = { style: {}, dataset: {} };
  const apply = domApply({ c0: el });
  apply('c0', { x: 5, y: 6, opacity: 0.5, rotateY: 120 });
  assert(el.style.transform.includes('translate(5px, 6px)') && el.style.opacity === 0.5 && el.dataset.flipped === '1', 'applied + flipped');
  apply('c0', { rotateY: 30 });
  assert(el.dataset.flipped === '0', 'face restored below 90°');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
