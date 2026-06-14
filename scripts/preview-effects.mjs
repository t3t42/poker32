// preview-effects.mjs — self-contained demo/effects.html running the REAL
// effects + sound modules (inlined, no server). Canvas particles/shockwave/
// sweep/vignette, an SVG turn-timer ring, a rolling pot counter, hand-name
// letter stagger, and a sound toggle.   node scripts/preview-effects.mjs

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, 'demo');
mkdirSync(out, { recursive: true });
const read = (...p) => readFileSync(join(root, ...p), 'utf8');
const strip = s => s.replace(/^\s*import\s+[^\n]*\n/gm, '').replace(/^\s*export\s+(?=(const|function|class|let|var)\b)/gm, '');
const bundle = [read('src', 'anim', 'effects.js'), read('src', 'anim', 'sound.js')].map(strip).join('\n');

const driver = `
const cv = document.getElementById('cv'), g = cv.getContext('2d'), W = cv.width, H = cv.height;
const board = new SoundBoard({ muted: document.getElementById('mute').checked });
let parts = [], rings = [], sweep = null, vignette = 0, last = 0;

function loop(ts) {
  const dt = Math.min((ts - last) / 1000 || 0, 0.05); last = ts;
  g.clearRect(0, 0, W, H);
  parts = stepParticles(parts, dt, { gravity: 360 });
  for (const p of parts) { g.globalAlpha = Math.max(0, p.opacity); g.fillStyle = '#f1d98a'; g.beginPath(); g.arc(p.x, p.y, p.size, 0, 7); g.fill(); }
  g.globalAlpha = 1;
  rings = rings.filter(r => { const s = shockwave(ts - r.t0, { duration: 700, maxR: 320 }); if (s.done) return false; g.strokeStyle = 'rgba(57,194,215,' + s.opacity.toFixed(3) + ')'; g.lineWidth = 4; g.beginPath(); g.arc(W / 2, H / 2, s.radius, 0, 7); g.stroke(); return true; });
  if (sweep) { const p = Math.min((ts - sweep.t0) / 900, 1), x = -200 + (W + 400) * p; const gr = g.createLinearGradient(x - 130, 0, x + 130, 0); gr.addColorStop(0, 'rgba(212,175,55,0)'); gr.addColorStop(.5, 'rgba(245,222,140,.55)'); gr.addColorStop(1, 'rgba(212,175,55,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H); if (p >= 1) sweep = null; }
  if (vignette > 0) { const rg = g.createRadialGradient(W / 2, H / 2, H * .2, W / 2, H / 2, H * .72); rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(1, 'rgba(0,0,0,' + vignette + ')'); g.fillStyle = rg; g.fillRect(0, 0, W, H); }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function shake(px, ms) { const t0 = performance.now(); (function s() { const e = performance.now() - t0; if (e > ms) { cv.style.transform = ''; return; } cv.style.transform = 'translate(' + ((Math.random() * 2 - 1) * px).toFixed(1) + 'px,' + ((Math.random() * 2 - 1) * px).toFixed(1) + 'px)'; requestAnimationFrame(s); })(); }

document.getElementById('win').onclick = () => { parts = parts.concat(spawnBurst(W / 2, H / 2, { count: 90, speed: [120, 340], life: [.7, 1.3] })); board.play('win'); };
document.getElementById('allin').onclick = () => { rings.push({ t0: performance.now() }); setTimeout(() => rings.push({ t0: performance.now() }), 150); board.play('chip'); };
document.getElementById('quads').onclick = () => { const c = cinematicForCategory(7); vignette = c.vignette; parts = parts.concat(spawnBurst(W / 2, H / 2, { count: c.particles })); shake(c.shake, 600); board.play('win'); setTimeout(() => vignette = 0, 900); };
document.getElementById('royal').onclick = () => { const c = cinematicForCategory(8, { royal: true }); vignette = c.vignette; sweep = { t0: performance.now() }; parts = parts.concat(spawnBurst(W / 2, H / 2, { count: c.particles, size: [3, 8] })); shake(c.shake, 700); board.play('win'); setTimeout(() => vignette = 0, 1200); };

const ring = document.getElementById('ring'), C = 2 * Math.PI * 52; ring.setAttribute('stroke-dasharray', C);
document.getElementById('timer').onclick = () => { const T = 6000, t0 = performance.now(); (function tk() { const f = Math.max(0, 1 - (performance.now() - t0) / T); ring.setAttribute('stroke', timerColor(f)); ring.setAttribute('stroke-dashoffset', timerArc(f, C).dashoffset); if (f > 0) requestAnimationFrame(tk); })(); };

const counter = document.getElementById('counter');
document.getElementById('count').onclick = () => { const T = 1200, t0 = performance.now(); (function tk() { const p = Math.min((performance.now() - t0) / T, 1); counter.textContent = rollCounter(0, 12345, p, x => 1 - Math.pow(1 - x, 3)).toLocaleString(); if (p < 1) requestAnimationFrame(tk); })(); };

const nameEl = document.getElementById('handname');
document.getElementById('name').onclick = () => { nameEl.innerHTML = ''; for (const { ch, delay } of letterStagger('ROYAL FLUSH', 70)) { const s = document.createElement('span'); s.textContent = ch === ' ' ? '\\u00a0' : ch; s.className = 'ltr'; nameEl.appendChild(s); setTimeout(() => s.classList.add('in'), delay); } };

document.getElementById('mute').onchange = e => board.setMuted(e.target.checked);
document.getElementById('card').onclick = () => board.play('cardSlide');
document.getElementById('chip').onclick = () => board.play('chip');
`;

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cinematics \u2014 preview</title>
<style>
  body{ margin:0; min-height:100vh; display:flex; flex-direction:column; align-items:center; gap:14px; padding:30px 16px;
        font-family:Georgia,'Times New Roman',serif; color:#f6f1e7; background:radial-gradient(140% 120% at 50% 0%, #123 0%, #050a08 70%); }
  h1{ color:#d4af37; margin:0; font-size:23px; letter-spacing:.06em; text-shadow:0 0 18px rgba(212,175,55,.5); }
  .controls{ display:flex; flex-wrap:wrap; gap:8px; justify-content:center; max-width:760px; }
  button{ font:inherit; font-size:13px; color:#f6f1e7; background:rgba(212,175,55,.14); border:1px solid rgba(212,175,55,.5); padding:7px 13px; border-radius:999px; cursor:pointer; }
  button:hover{ background:rgba(212,175,55,.26); }
  label{ font-size:13px; opacity:.85; display:flex; gap:6px; align-items:center; }
  .stagewrap{ position:relative; width:720px; height:430px; border-radius:50%/46%; overflow:hidden;
              background:radial-gradient(60% 60% at 50% 44%, #14543f, #0b3d2e 78%, #07271d); box-shadow: inset 0 0 0 16px #3a2620, 0 24px 60px #000a; }
  #cv{ position:absolute; inset:0; width:100%; height:100%; }
  .overlay{ position:absolute; inset:0; display:grid; place-items:center; pointer-events:none; }
  #ring{ transform:rotate(-90deg); transform-origin:center; }
  #counter{ position:absolute; top:18px; left:50%; transform:translateX(-50%); font-size:26px; color:#d4af37; text-shadow:0 0 12px rgba(212,175,55,.6); }
  #handname{ position:absolute; bottom:24px; left:0; right:0; text-align:center; font-size:34px; letter-spacing:.08em; color:#f1d98a; text-shadow:0 0 16px rgba(212,175,55,.6); }
  .ltr{ display:inline-block; opacity:0; transform:translateY(14px) scale(.8); transition:opacity .25s, transform .25s cubic-bezier(.34,1.56,.64,1); }
  .ltr.in{ opacity:1; transform:none; }
  @media (prefers-reduced-motion: reduce){ .ltr{ transition:none; } }
</style></head>
<body>
  <h1>Cinematic catalogue</h1>
  <div class="controls">
    <button id="win">Win burst</button>
    <button id="allin">All-in shockwave</button>
    <button id="quads">Quads (slow-mo + shake + vignette)</button>
    <button id="royal">Royal flush sweep</button>
    <button id="timer">Turn timer</button>
    <button id="count">Pot counter</button>
    <button id="name">Hand name</button>
    <button id="card">\u266a card</button>
    <button id="chip">\u266a chip</button>
    <label><input type="checkbox" id="mute"> Mute</label>
  </div>
  <div class="stagewrap">
    <canvas id="cv" width="720" height="430"></canvas>
    <div id="counter">0</div>
    <div class="overlay"><svg width="130" height="130" viewBox="0 0 130 130"><circle cx="65" cy="65" r="52" fill="none" stroke="#ffffff22" stroke-width="7"/><circle id="ring" cx="65" cy="65" r="52" fill="none" stroke="#39c2d7" stroke-width="7" stroke-linecap="round"/></svg></div>
    <div id="handname"></div>
  </div>
  <script>
${bundle}
${driver}
  </script>
</body></html>`;

writeFileSync(join(out, 'effects.html'), html);
console.log('wrote demo/effects.html');
