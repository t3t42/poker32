// table.js — the table surface and seat geometry (spec 3.5). The surface is
// drawn as code (SVG): wood trim, stitched leather rail, radially-shaded felt
// with a noise overlay, a centre watermark, and the betting line. Seat geometry
// is pure (testable); the scene composer places widgets at these points.

import { PALETTE } from './tokens.js';

let _uid = 0;
const TAU = Math.PI * 2;

// Seats around an ellipse, hero (index 0) at bottom-centre, others distributed.
// Returns pixel anchors plus the inward direction (toward the pot) per seat.
export function seatLayout(n, { width = 900, height = 560, ringX = 0.9, ringY = 0.92 } = {}) {
  const cx = width / 2, cy = height / 2;
  const rx = (width / 2) * ringX, ry = (height / 2) * ringY;
  const seats = [];
  for (let i = 0; i < n; i++) {
    const theta = Math.PI / 2 + i * (TAU / n);     // 90° = bottom (y grows down)
    const x = cx + rx * Math.cos(theta), y = cy + ry * Math.sin(theta);
    const inward = Math.atan2(cy - y, cx - x);      // points at the table centre
    seats.push({ index: i, x, y, inward, isHero: i === 0 });
  }
  return seats;
}

// A point fraction `t` from a seat toward the table centre (where committed
// chips and the betting line sit).
export function towardCenter(seat, width, height, t) {
  return { x: seat.x + (width / 2 - seat.x) * t, y: seat.y + (height / 2 - seat.y) * t };
}

function noiseDefs(id) {
  return `<filter id="${id}"><feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" stitchTiles="stitch" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.7 0"/></filter>`;
}

export function tableSVG({ width = 900, height = 560, idPrefix } = {}) {
  const pre = idPrefix || `tbl_${_uid++}`;
  const noiseId = `${pre}-noise`, feltId = `${pre}-felt`, woodId = `${pre}-wood`, clipId = `${pre}-clip`;
  const cx = width / 2, cy = height / 2;
  const e = (rx, ry, attrs) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" ${attrs}/>`;
  const trimRx = cx - 2, trimRy = cy - 2;
  const railRx = cx - 16, railRy = cy - 16;
  const feltRx = cx - 46, feltRy = cy - 46;
  const lineRx = feltRx * 0.7, lineRy = feltRy * 0.7;

  return `<svg class="poker-table" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="poker table">
  <defs>
    ${noiseDefs(noiseId)}
    <radialGradient id="${feltId}" cx="50%" cy="46%" r="62%"><stop offset="0%" stop-color="${PALETTE.felt700}"/><stop offset="78%" stop-color="${PALETTE.felt900}"/><stop offset="100%" stop-color="#07271d"/></radialGradient>
    <linearGradient id="${woodId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#6b4526"/><stop offset="50%" stop-color="${PALETTE.wood}"/><stop offset="100%" stop-color="#3f2815"/></linearGradient>
    <clipPath id="${clipId}">${e(feltRx, feltRy, '')}</clipPath>
  </defs>
  ${e(trimRx, trimRy, `fill="url(#${woodId})"`)}
  ${e(railRx + 8, railRy + 8, `fill="none" stroke="#241712" stroke-width="2" opacity="0.6"`)}
  ${e(railRx, railRy, `fill="${PALETTE.railLeather}"`)}
  ${e(railRx - 3, railRy - 3, `fill="none" stroke="#5a3d33" stroke-width="1.4" stroke-dasharray="2 6" opacity="0.8"`)}
  ${e(feltRx, feltRy, `fill="url(#${feltId})"`)}
  <g clip-path="url(#${clipId})">${e(feltRx, feltRy, `fill="url(#${noiseId})" opacity="0.06"`)}</g>
  ${e(lineRx, lineRy, `fill="none" stroke="${PALETTE.gold}" stroke-width="1.2" stroke-dasharray="1 9" opacity="0.5"`)}
  <g class="watermark" opacity="0.10" transform="translate(${cx} ${cy})">
    <circle r="54" fill="none" stroke="${PALETTE.gold}" stroke-width="2"/>
    <circle r="44" fill="none" stroke="${PALETTE.gold}" stroke-width="1"/>
    <text x="0" y="2" text-anchor="middle" dominant-baseline="central" font-family="Georgia,'Times New Roman',serif" font-weight="700" font-size="42" fill="${PALETTE.gold}">A</text>
  </g>
</svg>`;
}
