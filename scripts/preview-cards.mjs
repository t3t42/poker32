// preview-cards.mjs — generate a self-contained demo/cards.html (all 52 faces +
// the back) from the REAL card module, so the preview never drifts. Static SVG,
// opens with a double-click, no server.   node scripts/preview-cards.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cardFaceSVG, cardBackSVG, rankLabel, PALETTE, EASES } from '../src/render/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'demo');
mkdirSync(out, { recursive: true });

const SUITS = ['s', 'h', 'd', 'c'];
const SUIT_NAME = { s: 'Spades', h: 'Hearts', d: 'Diamonds', c: 'Clubs' };
const W = 92;

const rows = SUITS.map(suit => {
  const cells = [];
  for (let rank = 2; rank <= 14; rank++) cells.push(`<div class="cell">${cardFaceSVG({ rank, suit }, { width: W })}</div>`);
  return `<section><h2>${SUIT_NAME[suit]}</h2><div class="row">${cells.join('')}</div></section>`;
}).join('');

const back = `<section><h2>Back</h2><div class="row">${[0, 1, 2].map(() => `<div class="cell">${cardBackSVG({ width: W })}</div>`).join('')}</div></section>`;

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Card system \u2014 preview</title>
<style>
  :root{ --gold:${PALETTE.gold}; --paper:${PALETTE.paper}; --ease-pop:${EASES.pop}; }
  *{ box-sizing:border-box; }
  body{ margin:0; min-height:100vh; color:var(--paper); font-family:Georgia,'Times New Roman',serif;
        background:radial-gradient(120% 90% at 50% 12%, ${PALETTE.felt700} 0%, ${PALETTE.felt900} 60%, #07271d 100%);
        padding:44px 22px 80px; }
  header{ text-align:center; margin-bottom:30px; }
  h1{ font-size:30px; letter-spacing:.06em; margin:0 0 6px; color:var(--gold); text-shadow:0 1px 0 #00000066, 0 0 18px ${PALETTE.goldGlow}; }
  header p{ margin:0; opacity:.7; font-style:italic; font-size:14px; }
  section{ max-width:1120px; margin:0 auto 26px; }
  h2{ font-size:12px; letter-spacing:.22em; text-transform:uppercase; opacity:.6; border-bottom:1px solid #ffffff22; padding-bottom:7px; margin:26px 0 16px; }
  .row{ display:flex; flex-wrap:wrap; gap:12px; }
  .cell{ line-height:0; }
  .playing-card{ display:block; border-radius:12px; filter:drop-shadow(0 2px 4px rgba(0,0,0,.35));
                 transition:transform .18s var(--ease-pop), filter .18s ease; will-change:transform; }
  .playing-card:hover{ transform:translateY(-4px); filter:drop-shadow(0 10px 18px rgba(0,0,0,.45)); }
  @media (prefers-reduced-motion: reduce){ .playing-card,.playing-card:hover{ transition:none; transform:none; } }
</style></head>
<body>
  <header><h1>Playing Card System</h1><p>code-drawn SVG &mdash; vector suits, traditional pips, court monograms, guilloch&eacute; back</p></header>
  ${rows}
  ${back}
</body></html>`;

writeFileSync(join(out, 'cards.html'), html);
console.log('wrote demo/cards.html');
