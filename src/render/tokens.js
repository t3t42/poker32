// tokens.js — the SINGLE source of design tokens (spec 3.1) for code that needs
// the values programmatically (Canvas/SVG). tokens.css mirrors the environment
// tokens for DOM/CSS. Chip face colours live ONLY here (they are drawn as SVG),
// so there is exactly one definition per value — no scattered hardcoded colours.

export const PALETTE = {
  felt900: '#0b3d2e', felt700: '#14543f',        // felt
  railLeather: '#3a2620', wood: '#5c3a21',        // rail / trim
  gold: '#d4af37', goldGlow: 'rgba(212,175,55,.55)',
  ink: '#101418', paper: '#f6f1e7',               // cards
  danger: '#e0454f', info: '#39c2d7',
};

export const EASES = {
  deal: 'cubic-bezier(.18,.9,.32,1.08)',
  collect: 'cubic-bezier(.5,-.28,.74,.05)',       // easeInBack
  pop: 'cubic-bezier(.34,1.56,.64,1)',            // overshoot
};

// Chip denominations (spec 3.2). Per value: disc `face`, `edge` spot colour,
// denomination `ring` colour, central `mono` text colour on a `monoDisc`.
export const CHIP_DENOMINATIONS = [
  { value: 1000, name: 'gold',   label: '1K',  face: '#c8a13a', edge: '#3a2c10', ring: '#f1d98a', mono: '#2a2008', monoDisc: '#f1d98a' },
  { value: 500,  name: 'purple', label: '500', face: '#5b2a86', edge: '#ead9ff', ring: '#d4af37', mono: '#f6f1e7', monoDisc: '#d4af37' },
  { value: 100,  name: 'black',  label: '100', face: '#15181c', edge: '#d4af37', ring: '#d4af37', mono: '#f6f1e7', monoDisc: '#1f2429' },
  { value: 25,   name: 'green',  label: '25',  face: '#1e7a46', edge: '#f6f1e7', ring: '#d4af37', mono: '#f6f1e7', monoDisc: '#155f37' },
  { value: 5,    name: 'red',    label: '5',   face: '#c0392b', edge: '#f6f1e7', ring: '#d4af37', mono: '#f6f1e7', monoDisc: '#9c2b20' },
  { value: 1,    name: 'white',  label: '1',   face: '#f1ece1', edge: '#2a3550', ring: '#b08d2a', mono: '#1b2030', monoDisc: '#e7dcc2' },
];
export const CHIP_BY_VALUE = Object.fromEntries(CHIP_DENOMINATIONS.map(d => [d.value, d]));
