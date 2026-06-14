// card.js — the card system (spec 3.3). Cards are drawn entirely in code (SVG):
// faces with mirrored corner indices, precise vector suit pips in the
// traditional arrangement, and stylised J/Q/K monograms; a guilloché back with
// a double border and central emblem. Micro-noise overlay, 12px corners. Suit
// colours come from the design tokens (ink / danger). No external assets.

import { PALETTE } from './tokens.js';

let _uid = 0;

// Card geometry: spec calls 90px width with 12px corners; keep the ratio fixed.
export const CARD_W = 90, CARD_H = 126, CARD_R = 12;

// Precise vector suit glyphs, authored in a 0..100 box.
export const SUIT_PATHS = {
  h: 'M50 88 C20 64 6 45 6 29 C6 15 17 7 29 7 C39 7 46 13 50 21 C54 13 61 7 71 7 C83 7 94 15 94 29 C94 45 80 64 50 88 Z',
  s: 'M50 8 C64 30 92 44 92 62 C92 75 82 83 72 83 C65 83 58 79 55 73 C56 81 59 89 67 93 L33 93 C41 89 44 81 45 73 C42 79 35 83 28 83 C18 83 8 75 8 62 C8 44 36 30 50 8 Z',
  d: 'M50 5 C58 28 70 42 88 50 C70 58 58 72 50 95 C42 72 30 58 12 50 C30 42 42 28 50 5 Z',
  c: 'M50 7 C60 7 68 15 68 25 C68 29 67 32 65 35 C70 32 75 31 79 31 C89 31 96 39 96 49 C96 59 88 66 79 66 C71 66 64 62 60 56 C61 65 64 78 70 92 L30 92 C36 78 39 65 40 56 C36 62 29 66 21 66 C12 66 4 59 4 49 C4 39 11 31 21 31 C25 31 30 32 35 35 C33 32 32 29 32 25 C32 15 40 7 50 7 Z',
};

export const SUIT_IS_RED = { h: true, d: true, s: false, c: false };
export function suitColor(suit) { return SUIT_IS_RED[suit] ? PALETTE.danger : PALETTE.ink; }
export function rankLabel(rank) { return rank === 14 ? 'A' : rank === 13 ? 'K' : rank === 12 ? 'Q' : rank === 11 ? 'J' : String(rank); }
export const isCourt = rank => rank >= 11 && rank <= 13;
export const isAce = rank => rank === 14;

// Traditional pip arrangement. Columns L/C/R, rows r1..r5 plus the inner extras
// used by 7/8/10. `flip` rotates a pip 180° (bottom-half orientation).
const COL = { L: 30, C: 45, R: 60 };
const ROW = { r1: 30, r2: 45, r3: 63, r4: 81, r5: 96, cHi: 39, cLo: 87 };
const P = (col, row, flip = false) => ({ x: COL[col], y: ROW[row], flip });
const PIP_LAYOUT = {
  2: [P('C', 'r1'), P('C', 'r5', true)],
  3: [P('C', 'r1'), P('C', 'r3'), P('C', 'r5', true)],
  4: [P('L', 'r1'), P('R', 'r1'), P('L', 'r5', true), P('R', 'r5', true)],
  5: [P('L', 'r1'), P('R', 'r1'), P('C', 'r3'), P('L', 'r5', true), P('R', 'r5', true)],
  6: [P('L', 'r1'), P('R', 'r1'), P('L', 'r3'), P('R', 'r3'), P('L', 'r5', true), P('R', 'r5', true)],
  7: [P('L', 'r1'), P('R', 'r1'), P('C', 'cHi'), P('L', 'r3'), P('R', 'r3'), P('L', 'r5', true), P('R', 'r5', true)],
  8: [P('L', 'r1'), P('R', 'r1'), P('C', 'cHi'), P('L', 'r3'), P('R', 'r3'), P('C', 'cLo', true), P('L', 'r5', true), P('R', 'r5', true)],
  9: [P('L', 'r1'), P('R', 'r1'), P('L', 'r2'), P('R', 'r2'), P('C', 'r3'), P('L', 'r4', true), P('R', 'r4', true), P('L', 'r5', true), P('R', 'r5', true)],
  10: [P('L', 'r1'), P('R', 'r1'), P('C', 'cHi'), P('L', 'r2'), P('R', 'r2'), P('L', 'r4', true), P('R', 'r4', true), P('C', 'cLo', true), P('L', 'r5', true), P('R', 'r5', true)],
};
export function pipLayout(rank) { return PIP_LAYOUT[rank] ? PIP_LAYOUT[rank].map(p => ({ ...p })) : []; }

// A suit glyph centred at (cx,cy) at pixel size s, optionally flipped.
function suitGlyph(suit, cx, cy, s, { flip = false, color } = {}) {
  const fill = color || suitColor(suit);
  const t = `translate(${cx - s / 2} ${cy - s / 2}) scale(${s / 100})${flip ? ' rotate(180 50 50)' : ''}`;
  return `<path class="suit suit-${suit}" d="${SUIT_PATHS[suit]}" fill="${fill}" transform="${t}"/>`;
}

// Top-left corner index (rank over a small suit), used twice — the second
// rotated 180° about the card centre into the bottom-right corner.
function cornerIndex(rank, suit) {
  const c = suitColor(suit), lbl = rankLabel(rank);
  return `<g class="corner-index">
    <text x="11" y="20" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-weight="700" font-size="${lbl.length > 1 ? 13 : 16}" fill="${c}">${lbl}</text>
    ${suitGlyph(suit, 11, 31, 11)}
  </g>`;
}

function noiseDefs(id) {
  return `<filter id="${id}" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.6 0"/>
  </filter>`;
}

function courtMonogram(rank, suit) {
  const c = suitColor(suit), lbl = rankLabel(rank);
  return `<g class="court">
    <rect x="20" y="26" width="50" height="74" rx="6" fill="none" stroke="${PALETTE.gold}" stroke-width="1.6"/>
    <rect x="24" y="30" width="42" height="66" rx="4" fill="none" stroke="${c}" stroke-width="1" opacity="0.55"/>
    ${suitGlyph(suit, 45, 41, 17)}
    <text x="45" y="66" text-anchor="middle" dominant-baseline="central" font-family="Georgia,'Times New Roman',serif" font-weight="700" font-size="40" fill="${c}">${lbl}</text>
    ${suitGlyph(suit, 45, 90, 17, { flip: true })}
  </g>`;
}

// Full card face for a {rank, suit}.
export function cardFaceSVG(card, { width = CARD_W, idPrefix } = {}) {
  const { rank, suit } = card;
  const pre = idPrefix || `cf${rank}${suit}_${_uid++}`;
  const noiseId = `${pre}-noise`;
  const height = Math.round(width * CARD_H / CARD_W);

  let center = '';
  if (isAce(rank)) center = suitGlyph(suit, 45, 63, 46);
  else if (isCourt(rank)) center = courtMonogram(rank, suit);
  else center = pipLayout(rank).map(p => suitGlyph(suit, p.x, p.y, 15, { flip: p.flip })).join('');

  return `<svg class="playing-card" data-card="${rankLabel(rank)}${suit}" width="${width}" height="${height}" viewBox="0 0 ${CARD_W} ${CARD_H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${rankLabel(rank)} of ${suit}">
  <defs>${noiseDefs(noiseId)}</defs>
  <rect x="0.6" y="0.6" width="${CARD_W - 1.2}" height="${CARD_H - 1.2}" rx="${CARD_R}" fill="${PALETTE.paper}" stroke="#0000001f" stroke-width="1"/>
  <g class="card-center">${center}</g>
  ${cornerIndex(rank, suit)}
  <g transform="rotate(180 ${CARD_W / 2} ${CARD_H / 2})">${cornerIndex(rank, suit)}</g>
  <rect x="0.6" y="0.6" width="${CARD_W - 1.2}" height="${CARD_H - 1.2}" rx="${CARD_R}" fill="url(#${noiseId})" opacity="0.05"/>
</svg>`;
}

// Card back: guilloché lattice + concentric rosette, double border, emblem.
export function cardBackSVG({ width = CARD_W, idPrefix } = {}) {
  const pre = idPrefix || `cb_${_uid++}`;
  const noiseId = `${pre}-noise`, gid = `${pre}-g`, rosette = `${pre}-ros`;
  const height = Math.round(width * CARD_H / CARD_W);
  const g = PALETTE.gold, felt = PALETTE.felt900, felt2 = PALETTE.felt700;

  // guilloché: interwoven rotated ellipses forming a rosette
  let petals = '';
  for (let a = 0; a < 180; a += 18) petals += `<ellipse cx="45" cy="63" rx="30" ry="11" fill="none" stroke="${g}" stroke-width="0.5" opacity="0.5" transform="rotate(${a} 45 63)"/>`;
  // diagonal lattice
  let lattice = '';
  for (let i = -CARD_H; i < CARD_W; i += 7) lattice += `<line x1="${i}" y1="0" x2="${i + CARD_H}" y2="${CARD_H}" stroke="${g}" stroke-width="0.4" opacity="0.16"/><line x1="${i}" y1="${CARD_H}" x2="${i + CARD_H}" y2="0" stroke="${g}" stroke-width="0.4" opacity="0.16"/>`;

  return `<svg class="playing-card card-back" data-card="back" width="${width}" height="${height}" viewBox="0 0 ${CARD_W} ${CARD_H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="card back">
  <defs>
    ${noiseDefs(noiseId)}
    <clipPath id="${gid}"><rect x="6" y="6" width="${CARD_W - 12}" height="${CARD_H - 12}" rx="7"/></clipPath>
    <radialGradient id="${rosette}" cx="50%" cy="50%" r="60%"><stop offset="0%" stop-color="${felt2}"/><stop offset="100%" stop-color="${felt}"/></radialGradient>
  </defs>
  <rect x="0.6" y="0.6" width="${CARD_W - 1.2}" height="${CARD_H - 1.2}" rx="${CARD_R}" fill="${felt}"/>
  <g clip-path="url(#${gid})">
    <rect x="6" y="6" width="${CARD_W - 12}" height="${CARD_H - 12}" fill="url(#${rosette})"/>
    <g class="guilloche">${lattice}${petals}</g>
  </g>
  <rect x="4.5" y="4.5" width="${CARD_W - 9}" height="${CARD_H - 9}" rx="8" fill="none" stroke="${g}" stroke-width="1.4"/>
  <rect x="8" y="8" width="${CARD_W - 16}" height="${CARD_H - 16}" rx="6" fill="none" stroke="${g}" stroke-width="0.7" opacity="0.7"/>
  <g class="emblem">
    <circle cx="45" cy="63" r="15" fill="${felt}" stroke="${g}" stroke-width="1"/>
    <path d="M45 52 L54 63 L45 74 L36 63 Z" fill="none" stroke="${g}" stroke-width="1"/>
    <text x="45" y="63.5" text-anchor="middle" dominant-baseline="central" font-family="Georgia,'Times New Roman',serif" font-weight="700" font-size="11" fill="${g}">A</text>
  </g>
  <rect x="0.6" y="0.6" width="${CARD_W - 1.2}" height="${CARD_H - 1.2}" rx="${CARD_R}" fill="url(#${noiseId})" opacity="0.05"/>
</svg>`;
}
