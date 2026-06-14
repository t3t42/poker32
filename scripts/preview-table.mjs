// preview-table.mjs — generate a self-contained demo/table.html: a composed
// scene (table + seats + cards + chips + HUD) from a sample snapshot, built with
// the REAL render modules and the real CSS inlined. Static; opens in a browser.
//   node scripts/preview-table.mjs

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sceneHTML, potOddsPct, equityPct, handRankHint, PALETTE } from '../src/render/index.js';
import { cards } from '../src/engine/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, 'demo');
mkdirSync(out, { recursive: true });
const css = f => readFileSync(join(root, 'src', 'render', f), 'utf8');

const hero = cards('As Qs'), board = cards('Ah Kd 7c');
const snapshot = {
  pot: 1387, board, heroSeat: 0,
  seats: [
    { name: 'You', stack: 4200, committed: 200, holeCards: hero, isActive: true },
    { name: 'Rock', stack: 3800, committed: 200, cardCount: 2 },
    { name: 'Maniac', stack: 0, committed: 1000, cardCount: 2, allIn: true },
    { name: 'Shark', stack: 5100, committed: 0, cardCount: 2, folded: true, isButton: true },
  ],
};
const hud = { potOdds: potOddsPct(150, snapshot.pot), equity: equityPct(0.58), hint: handRankHint(hero, board) };

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Table + HUD \u2014 preview</title>
<style>
${css('tokens.css')}
${css('cards.css')}
${css('table.css')}
  body{ margin:0; min-height:100vh; display:grid; place-items:center; gap:18px;
        background:radial-gradient(140% 120% at 50% 0%, #123 0%, #050a08 70%); padding:40px 16px; }
  h1{ font-family:Georgia,serif; color:var(--gold); letter-spacing:.06em; margin:0;
      text-shadow:0 1px 0 #0008, 0 0 18px ${PALETTE.goldGlow}; font-size:24px; }
  p.cap{ font-family:Georgia,serif; color:#cdbf9e; font-style:italic; margin:0; opacity:.75; font-size:13px; }
</style></head>
<body>
  <h1>Table &amp; HUD</h1>
  <p class="cap">composed from a gameView snapshot &mdash; flop, side pot, all-in, dealer button</p>
  ${sceneHTML(snapshot, { hud })}
</body></html>`;

writeFileSync(join(out, 'table.html'), html);
console.log('wrote demo/table.html');
