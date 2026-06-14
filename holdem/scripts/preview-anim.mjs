// preview-anim.mjs — generate a self-contained, double-click-openable
// demo/anim.html that runs the REAL animation modules (no server needed). The
// source files are inlined (imports/exports stripped) so the demo never drifts.
//   node scripts/preview-anim.mjs

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, 'demo');
mkdirSync(out, { recursive: true });

const read = (...p) => readFileSync(join(root, ...p), 'utf8');
// Strip ES module syntax so files can be concatenated into one script scope.
const strip = s => s.replace(/^\s*import\s+[^\n]*\n/gm, '').replace(/^\s*export\s+(?=(const|function|class|let|var)\b)/gm, '');
// Dedupe the per-module `let _uid = 0;` (chip.js + card.js) → one shared counter.
const dropUid = s => s.replace(/^\s*let _uid = 0;\s*$/gm, '');

const bundle = [
  'let _uid = 0;',
  read('src', 'render', 'tokens.js'),
  read('src', 'anim', 'easing.js'),
  read('src', 'anim', 'tween.js'),
  read('src', 'render', 'chip.js'),
  read('src', 'render', 'card.js'),
  read('src', 'anim', 'presenter.js'),
  read('src', 'anim', 'animator.js'),
].map(s => dropUid(strip(s))).join('\n');

const driver = `
// ---- demo driver ----
const stage = document.getElementById('stage');
const reduced = document.getElementById('reduced');
const els = {};
const DECK = { x: 612, y: 26 };
const HERO = [{ x: 300, y: 360 }, { x: 360, y: 360 }];
const VILL = [{ x: 300, y: 30 }, { x: 360, y: 30 }];
const BOARD = [0,1,2,3,4].map(i => ({ x: 214 + i * 66, y: 188 }));
const POT = { x: 348, y: 250 };
const HBET = { x: 330, y: 300 }, VBET = { x: 330, y: 96 };
const presenter = new Presenter({ reducedMotion: reduced.checked });
const apply = domApply(id => els[id]);
const run = events => play(new Timeline(presenter.presentAll(events), { reducedMotion: presenter.reducedMotion }), apply);

function cardEl(id, card) {
  const d = document.createElement('div'); d.className = 'card'; d.id = id;
  d.innerHTML = '<div class="layer back">' + cardBackSVG({ width: 60 }) + '</div><div class="layer face">' + cardFaceSVG(card, { width: 60 }) + '</div>';
  d.style.opacity = 0; d.style.transform = transformString(DECK); stage.appendChild(d); els[id] = d; return d;
}
function chipEl(id, value, at) {
  const d = document.createElement('div'); d.className = 'chip'; d.id = id;
  d.innerHTML = chipSVG(value, { size: 40 }); d.style.transform = transformString(at); stage.appendChild(d); els[id] = d; return d;
}

const HOLE = { c00:{rank:14,suit:'s'}, c01:{rank:12,suit:'s'}, c10:{rank:7,suit:'h'}, c11:{rank:7,suit:'d'} };
const BOARDC = [{rank:14,suit:'h'},{rank:13,suit:'d'},{rank:7,suit:'c'},{rank:2,suit:'s'},{rank:9,suit:'h'}];
let boardShown = 0;

function reset() {
  stage.querySelectorAll('.card,.chip').forEach(n => n.remove()); for (const k in els) delete els[k]; boardShown = 0;
  cardEl('c00', HOLE.c00); cardEl('c01', HOLE.c01); cardEl('c10', HOLE.c10); cardEl('c11', HOLE.c11);
  BOARDC.forEach((c, i) => cardEl('b' + i, c));
  ['k0','k1','k2','k3'].forEach((id, i) => chipEl(id, [100,25,100,500][i], i < 2 ? HERO[0] : VILL[0]));
}
reset();

document.getElementById('deal').onclick = () => run([
  { type:'DEAL', id:'c00', from:DECK, to:HERO[0], order:0 },
  { type:'DEAL', id:'c10', from:DECK, to:VILL[0], order:1 },
  { type:'DEAL', id:'c01', from:DECK, to:HERO[1], order:2 },
  { type:'DEAL', id:'c11', from:DECK, to:VILL[1], order:3 },
]);
document.getElementById('flip').onclick = () => run([{ type:'FLIP', id:'c00' }, { type:'FLIP', id:'c01' }]);
document.getElementById('board').onclick = () => {
  if (boardShown === 0) { run([{ type:'FLOP', cards:[0,1,2].map(i => ({ id:'b'+i, from:DECK, to:BOARD[i] })) }]); boardShown = 3; }
  else if (boardShown < 5) { run([{ type: boardShown===3?'TURN':'RIVER', cards:[{ id:'b'+boardShown, from:DECK, to:BOARD[boardShown] }] }]); boardShown++; }
};
document.getElementById('bet').onclick = () => run([
  { type:'BET', id:'k0', from:HERO[0], to:HBET, order:0 }, { type:'BET', id:'k1', from:HERO[0], to:HBET, order:1 },
  { type:'BET', id:'k2', from:VILL[0], to:VBET, order:0 }, { type:'BET', id:'k3', from:VILL[0], to:VBET, order:1 },
]);
document.getElementById('collect').onclick = () => run([{ type:'COLLECT', items:[
  { id:'k0', from:HBET, to:POT }, { id:'k1', from:HBET, to:POT }, { id:'k2', from:VBET, to:POT }, { id:'k3', from:VBET, to:POT },
] }]);
document.getElementById('reset').onclick = reset;
reduced.onchange = () => presenter.setReducedMotion(reduced.checked);
`;

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Animation \u2014 preview</title>
<style>
  body{ margin:0; min-height:100vh; display:flex; flex-direction:column; align-items:center; gap:16px; padding:32px 16px;
        font-family:Georgia,'Times New Roman',serif; color:#f6f1e7;
        background:radial-gradient(140% 120% at 50% 0%, #123 0%, #050a08 70%); }
  h1{ color:#d4af37; letter-spacing:.06em; margin:0; font-size:24px; text-shadow:0 0 18px rgba(212,175,55,.5); }
  .controls{ display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
  button{ font:inherit; font-size:13px; color:#f6f1e7; background:rgba(212,175,55,.14); border:1px solid rgba(212,175,55,.5);
          padding:7px 14px; border-radius:999px; cursor:pointer; }
  button:hover{ background:rgba(212,175,55,.26); }
  label{ font-size:13px; opacity:.85; display:flex; gap:6px; align-items:center; margin-left:8px; }
  #stage{ position:relative; width:720px; height:430px; border-radius:50%/46%;
          background:radial-gradient(60% 60% at 50% 44%, #14543f, #0b3d2e 78%, #07271d);
          box-shadow: inset 0 0 0 16px #3a2620, inset 0 0 0 18px #241712, 0 24px 60px #000a; }
  .card{ position:absolute; width:60px; height:84px; transform-style:preserve-3d; will-change:transform,opacity; }
  .card .layer{ position:absolute; inset:0; backface-visibility:hidden; -webkit-backface-visibility:hidden; line-height:0;
                filter:drop-shadow(0 3px 6px rgba(0,0,0,.5)); }
  .card .back{ transform:rotateY(0deg); } .card .face{ transform:rotateY(180deg); }
  .chip{ position:absolute; line-height:0; will-change:transform; }
  @media (prefers-reduced-motion: reduce){ .card,.chip{ will-change:auto; } }
</style></head>
<body>
  <h1>Animation &mdash; deal, flip, bet, collect</h1>
  <div class="controls">
    <button id="deal">Deal hole</button>
    <button id="board">Flop / Turn / River</button>
    <button id="flip">Flip your hand</button>
    <button id="bet">Bet</button>
    <button id="collect">Collect pot</button>
    <button id="reset">Reset</button>
    <label><input type="checkbox" id="reduced"> Reduce motion</label>
  </div>
  <div id="stage"></div>
  <script>
${bundle}
${driver}
  </script>
</body></html>`;

writeFileSync(join(out, 'anim.html'), html);
console.log('wrote demo/anim.html');
