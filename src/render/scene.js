// scene.js — compose a static table scene from a snapshot derived from the
// engine's gameView. Places the board, the pot, and each seat (name, stack,
// cards, committed chips, dealer button, fold/all-in/active state) at the
// geometry from table.js, plus an optional HUD. Returns an HTML string; the app
// (Phase 6) adapts getView → snapshot and animation (Phase 5) drives motion.

import { tableSVG, seatLayout, towardCenter } from './table.js';
import { chipSVG, chipBreakdown } from './chip.js';
import { cardFaceSVG, cardBackSVG } from './card.js';
import { hudHTML } from './hud.js';

const at = (x, y, html, cls = '') => `<div class="abs ${cls}" style="left:${x}px;top:${y}px">${html}</div>`;

// A small pile of chips for an amount: one short stack per denomination.
function chipPile(amount, { size = 32, maxPerStack = 6 } = {}) {
  if (!amount) return '';
  const stagger = Math.round(size * 0.16);
  const cols = chipBreakdown(amount).map(({ value, count }) => {
    const shown = Math.min(count, maxPerStack);
    let stack = '';
    for (let i = 0; i < shown; i++) stack += `<div class="ch" style="bottom:${i * stagger}px">${chipSVG(value, { size })}</div>`;
    const h = size + (shown - 1) * stagger;
    return `<div class="pile-col"><div class="pile-stack" style="width:${size}px;height:${h}px">${stack}</div>${count > maxPerStack ? `<div class="pile-x">\u00d7${count}</div>` : ''}</div>`;
  }).join('');
  return `<div class="pile">${cols}</div>`;
}

function hand(cards, cardCount, isHero, w = 48) {
  if (isHero && Array.isArray(cards) && cards.length) return `<div class="hand">${cards.map(c => cardFaceSVG(c, { width: w })).join('')}</div>`;
  const n = cardCount ?? (Array.isArray(cards) ? cards.length : 2);
  return `<div class="hand">${Array.from({ length: n }, () => cardBackSVG({ width: w })).join('')}</div>`;
}

export function sceneHTML(snapshot, { width = 900, height = 560, hud = null } = {}) {
  const { pot = 0, board = [], heroSeat = 0, seats = [] } = snapshot;
  const cx = width / 2, cy = height / 2;
  const seatPos = seatLayout(seats.length, { width, height });

  // community board + pot
  const boardHTML = at(cx, cy - 42, `<div class="board">${board.map(c => cardFaceSVG(c, { width: 58 })).join('')}</div>`, 'board-anchor');
  const potHTML = at(cx, cy + 52, `<div class="pot">${chipPile(pot, { size: 30 })}<div class="pot-label">Pot ${pot.toLocaleString()}</div></div>`, 'pot-anchor');

  // seats
  const seatHTML = seats.map((s, i) => {
    const p = seatPos[i];
    const isHero = i === heroSeat;
    const cardsPt = towardCenter(p, width, height, 0.26);
    const betPt = towardCenter(p, width, height, 0.52);
    const btnPt = towardCenter(p, width, height, 0.16);
    const cls = ['seat-plate', isHero ? 'hero' : '', s.folded ? 'folded' : '', s.allIn ? 'allin' : '', s.isActive ? 'active' : ''].filter(Boolean).join(' ');
    const plate = at(p.x, p.y, `<div class="${cls}"><div class="seat-name">${s.name}</div><div class="seat-stack">${(s.stack ?? 0).toLocaleString()}</div></div>`);
    const cards = at(cardsPt.x, cardsPt.y, hand(s.holeCards, s.cardCount, isHero), s.folded ? 'muck' : '');
    const bet = s.committed ? at(betPt.x, betPt.y, `<div class="commit">${chipPile(s.committed, { size: 26, maxPerStack: 5 })}<div class="commit-x">${s.committed.toLocaleString()}</div></div>`) : '';
    const button = s.isButton ? at(btnPt.x, btnPt.y, `<div class="dealer" title="dealer">D</div>`) : '';
    return cards + plate + bet + button;
  }).join('');

  const hudBlock = hud ? `<div class="hud-mount">${hudHTML(hud)}</div>` : '';

  return `<div class="table-scene" style="width:${width}px;height:${height}px">
    <div class="table-bg">${tableSVG({ width, height })}</div>
    ${boardHTML}${potHTML}${seatHTML}${hudBlock}
  </div>`;
}
