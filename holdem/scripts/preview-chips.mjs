// preview-chips.mjs — generate a self-contained demo/chips.html from the REAL
// chip module, so the preview never drifts from the code. Static SVG only:
// opens with a double-click, no server, no external assets.
//   node scripts/preview-chips.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chipSVG, chipBreakdown, stackLayout, CHIP_DENOMINATIONS, PALETTE, EASES } from '../src/render/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'demo');
mkdirSync(out, { recursive: true });

// One vertical stack of `count` chips of a single denomination.
function stackHTML(value, count, size = 64) {
  const stagger = Math.round(size * 0.14);
  const colGap = Math.round(size * 0.95);
  const pos = stackLayout(count, { rng: mulberry(value * 131 + count) });
  const cols = Math.max(1, Math.ceil(count / 20));
  const perCol = Math.min(count, 20);
  const w = size + (cols - 1) * colGap;
  const h = size + (perCol - 1) * stagger;
  const chips = pos.map(p =>
    `<div class="ch" style="left:${p.col * colGap + p.jitterX}px;bottom:${p.row * stagger}px;z-index:${p.row + p.col * 100}">${chipSVG(value, { size })}</div>`
  ).join('');
  return `<div class="stack" style="width:${w}px;height:${h}px">${chips}</div>
    <div class="cap">${count} \u00d7 ${value}</div>`;
}

// tiny deterministic rng so the preview is stable build-to-build
function mulberry(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const denomRow = CHIP_DENOMINATIONS.map(d =>
  `<figure>${chipSVG(d.value, { size: 104 })}<figcaption>${d.label} <span>&middot; ${d.name}</span></figcaption></figure>`
).join('');

const stacksRow = [3, 8, 20, 47].map(n => `<div class="col">${stackHTML(100, n)}</div>`).join('');

const POT = 1387;
const potRow = chipBreakdown(POT).map(({ value, count }) => `<div class="col">${stackHTML(value, count, 56)}</div>`).join('');

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chip system \u2014 preview</title>
<style>
  :root{ --gold:${PALETTE.gold}; --paper:${PALETTE.paper}; --ink:${PALETTE.ink};
         --ease-pop:${EASES.pop}; }
  *{ box-sizing:border-box; }
  body{ margin:0; min-height:100vh; color:var(--paper);
        font-family:Georgia,'Times New Roman',serif;
        background:
          radial-gradient(120% 90% at 50% 18%, ${PALETTE.felt700} 0%, ${PALETTE.felt900} 62%, #07271d 100%);
        padding:48px 24px 80px; }
  header{ text-align:center; margin-bottom:40px; }
  h1{ font-size:30px; letter-spacing:.06em; margin:0 0 6px; color:var(--gold);
      text-shadow:0 1px 0 #00000066, 0 0 18px ${PALETTE.goldGlow}; }
  header p{ margin:0; opacity:.7; font-style:italic; font-size:14px; }
  .section-title{ max-width:980px; margin:46px auto 18px; font-size:13px; letter-spacing:.22em;
      text-transform:uppercase; opacity:.62; border-bottom:1px solid #ffffff22; padding-bottom:8px; }
  .denoms{ max-width:980px; margin:0 auto; display:flex; flex-wrap:wrap; gap:26px; justify-content:center; }
  figure{ margin:0; text-align:center; transition:transform .25s var(--ease-pop); }
  figure:hover{ transform:translateY(-6px) scale(1.04); }
  figcaption{ margin-top:10px; font-size:15px; font-weight:700; color:var(--gold); }
  figcaption span{ color:var(--paper); opacity:.5; font-weight:400; font-size:12px; }
  .stacks{ max-width:980px; margin:0 auto; display:flex; flex-wrap:wrap; gap:34px; align-items:flex-end; justify-content:center; }
  .col{ display:flex; flex-direction:column; align-items:center; }
  .stack{ position:relative; }
  .ch{ position:absolute; line-height:0; filter:drop-shadow(0 1px 1px #0006); }
  .cap{ margin-top:16px; font-size:12px; letter-spacing:.08em; opacity:.6; }
</style></head>
<body>
  <header>
    <h1>Casino Chip System</h1>
    <p>code-drawn SVG &mdash; denomination palette, edge spots, monogram, stacking</p>
  </header>

  <div class="section-title">Denominations</div>
  <div class="denoms">${denomRow}</div>

  <div class="section-title">Stacking &mdash; 1&ndash;3px jitter, multi-column past 20</div>
  <div class="stacks">${stacksRow}</div>

  <div class="section-title">Pot breakdown &mdash; ${POT} chips</div>
  <div class="stacks">${potRow}</div>
</body></html>`;

writeFileSync(join(out, 'chips.html'), html);
console.log('wrote demo/chips.html');
