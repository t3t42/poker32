// chip.js — the chip system (spec 3.2). Pure logic (breakdown, stack layout) is
// framework-agnostic and Node-testable; chips are drawn as SVG strings (no DOM
// dependency, no external image assets) so each chip can later be a transform-
// animatable element (Phase 5). Colours come only from tokens.js.

import { CHIP_DENOMINATIONS, CHIP_BY_VALUE } from './tokens.js';

let _uid = 0;

// ---------- colour helpers ----------
const clampByte = n => Math.max(0, Math.min(255, Math.round(n)));
function hexToRgb(hex) {
  const h = hex.replace('#', ''); const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
const rgbToHex = (r, g, b) => '#' + [r, g, b].map(x => clampByte(x).toString(16).padStart(2, '0')).join('');
function darken(hex, f = 0.6) { const [r, g, b] = hexToRgb(hex); return rgbToHex(r * f, g * f, b * f); }
function lighten(hex, f = 0.2) { const [r, g, b] = hexToRgb(hex); return rgbToHex(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f); }

// ---------- pure logic ----------
export function chipStyle(value) {
  const d = CHIP_BY_VALUE[value];
  if (!d) throw new Error(`No chip denomination for value ${value}`);
  return d;
}

// Greedy largest-first breakdown of an amount into chip denominations.
export function chipBreakdown(amount) {
  let rem = Math.max(0, Math.floor(amount));
  const out = [];
  for (const d of CHIP_DENOMINATIONS) {            // already descending
    const count = Math.floor(rem / d.value);
    if (count > 0) { out.push({ value: d.value, count }); rem -= count * d.value; }
  }
  return out;
}

// Flat list of chip values (largest first) representing the amount.
export function chipsForAmount(amount) {
  const flat = [];
  for (const { value, count } of chipBreakdown(amount)) for (let i = 0; i < count; i++) flat.push(value);
  return flat;
}

// Position chips in a stack: bottom-up vertical stagger, a fresh column past
// `maxPerColumn`, and a 1–3px horizontal jitter per chip (spec 3.2). `rng` is
// injectable for deterministic tests; cosmetic only (never game logic).
export function stackLayout(count, { maxPerColumn = 20, jitterMax = 3, rng = Math.random } = {}) {
  const pos = [];
  for (let i = 0; i < count; i++) {
    const magnitude = 1 + Math.floor(rng() * jitterMax); // 1..jitterMax
    const sign = rng() < 0.5 ? -1 : 1;
    pos.push({ index: i, col: Math.floor(i / maxPerColumn), row: i % maxPerColumn, jitterX: magnitude * sign });
  }
  return pos;
}

// ---------- SVG drawing ----------
// One chip in a 0..100 viewBox: drop shadow → side thickness → top face (sheen)
// → 6–8 edge spots → concentric denomination ring → central gold monogram disc.
export function chipSVG(value, { size = 72, spots = 8, idPrefix } = {}) {
  const d = chipStyle(value);
  const pre = idPrefix || `chip${value}_${_uid++}`;
  const rim = darken(d.face, 0.55);
  const sheenId = `${pre}-sheen`, shadowId = `${pre}-shadow`;

  let spotsSvg = '';
  for (let i = 0; i < spots; i++) {
    const a = i * 360 / spots;
    spotsSvg += `<rect class="edge-spot" x="46.4" y="3.4" width="7.2" height="13" rx="3.2" fill="${d.edge}" transform="rotate(${a} 50 50)"/>`;
  }

  const fontSize = d.label.length > 2 ? 17 : 22;
  return `<svg class="chip chip-${d.name}" data-value="${value}" width="${size}" height="${size}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${value} chip">
  <defs>
    <radialGradient id="${sheenId}" cx="38%" cy="32%" r="78%">
      <stop offset="0%" stop-color="${lighten(d.face, 0.30)}"/>
      <stop offset="60%" stop-color="${d.face}"/>
      <stop offset="100%" stop-color="${darken(d.face, 0.82)}"/>
    </radialGradient>
    <filter id="${shadowId}" x="-30%" y="-20%" width="160%" height="170%">
      <feDropShadow dx="0" dy="3.2" stdDeviation="3" flood-color="#000" flood-opacity="0.45"/>
    </filter>
  </defs>
  <g filter="url(#${shadowId})">
    <circle cx="50" cy="53.5" r="46" fill="${rim}"/>
    <circle cx="50" cy="50" r="46" fill="url(#${sheenId})"/>
    <g class="edge-spots">${spotsSvg}</g>
    <circle cx="50" cy="50" r="34.5" fill="none" stroke="${d.ring}" stroke-width="2"/>
    <circle cx="50" cy="50" r="30" fill="none" stroke="${d.ring}" stroke-width="1" opacity="0.7"/>
    <circle cx="50" cy="50" r="20.5" fill="${d.monoDisc}"/>
    <circle cx="50" cy="50" r="20.5" fill="none" stroke="${darken(d.monoDisc, 0.78)}" stroke-width="0.8"/>
    <text class="chip-mono" x="50" y="50.5" text-anchor="middle" dominant-baseline="central" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="${fontSize}" fill="${d.mono}">${d.label}</text>
  </g>
</svg>`;
}

// Expose colour helpers for sibling renderers (table/HUD) so they, too, derive
// shades from the canonical tokens rather than hardcoding new hex values.
export const colorUtil = { darken, lighten };
