// deck.js — Cryptographically-shuffled deck.
//
// Spec 1.2: shuffle = Fisher–Yates + crypto.getRandomValues(). Math.random() is
// forbidden as the production shuffle source. We also reject the naive
// `value % n` integer draw, which biases toward smaller indices; instead we use
// rejection sampling so every index is equiprobable.

import { fullDeck } from './cards.js';

// Resolved lazily (not at module load) so the engine file stays browser-pure
// while still working under a Node test harness that polyfills WebCrypto.
function getRandomValues(arr) {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error('crypto.getRandomValues unavailable — provide a WebCrypto polyfill.');
  }
  return c.getRandomValues(arr);
}

// Unbiased integer in [0, n) via rejection sampling over 32-bit values.
export function randomInt(n) {
  if (!Number.isInteger(n) || n <= 0) throw new Error('randomInt: n must be a positive integer');
  if (n === 1) return 0;
  const UINT32 = 0x100000000;                 // 2^32
  const limit = Math.floor(UINT32 / n) * n;   // largest multiple of n ≤ 2^32
  const buf = new Uint32Array(1);
  let x;
  do { getRandomValues(buf); x = buf[0]; } while (x >= limit);
  return x % n;
}

// In-place Fisher–Yates (Durstenfeld): walk from the end, swap with a uniformly
// random earlier-or-equal index.
export function fisherYates(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

export class Deck {
  constructor() { this.reset(); }

  reset() { this.cards = fullDeck(); this.drawn = []; return this; }

  shuffle() { fisherYates(this.cards); return this; }

  get remaining() { return this.cards.length; }

  draw(n = 1) {
    if (n > this.cards.length) throw new Error('Deck underflow');
    const out = this.cards.splice(0, n);
    this.drawn.push(...out);
    return n === 1 ? out[0] : out;
  }

  // A burn card is drawn and discarded (kept in `drawn` for audit / animation).
  burn() { return this.draw(1); }
}
