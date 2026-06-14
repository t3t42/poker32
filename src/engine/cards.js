// cards.js — Card primitives. Owned by the GameEngine value layer.
//
// A card is { rank: 2..14, suit: 's'|'h'|'d'|'c' }, where 14 = Ace.
// The Ace is always stored as 14; the wheel (A-2-3-4-5) is handled inside the
// evaluator, where the Ace is allowed to play LOW as the 5-high straight.

export const SUITS = ['s', 'h', 'd', 'c'];
export const SUIT_SYMBOL = { s: '\u2660', h: '\u2665', d: '\u2666', c: '\u2663' }; // ♠♥♦♣

// LOGICAL colour only ('red' | 'black'). Concrete hex values belong to the
// design-token layer (Renderer); they are never hard-coded in the engine.
export const SUIT_COLOR = { s: 'black', c: 'black', h: 'red', d: 'red' };

export const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const RANK_LABELS = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

export function rankLabel(r) {
  return RANK_LABELS[r] || (r === 10 ? '10' : String(r));
}

export function makeCard(rank, suit) {
  return { rank, suit };
}

export function cardToString(card) {
  return rankLabel(card.rank) + card.suit;
}

// Parse "As", "Td" / "10d", "2c" → { rank, suit }. Convenience for fixtures/tests.
export function parseCard(str) {
  const s = String(str).trim();
  const suit = s.slice(-1).toLowerCase();
  const r = s.slice(0, -1).toUpperCase();
  const map = { A: 14, K: 13, Q: 12, J: 11, T: 10, '10': 10 };
  const rank = map[r] ?? Number(r);
  if (!SUITS.includes(suit) || !RANKS.includes(rank)) throw new Error(`Bad card: "${str}"`);
  return { rank, suit };
}

// Parse a whitespace-separated string of cards, e.g. cards('Ah Kh Qh Jh Th').
export function cards(str) {
  return String(str).trim().split(/\s+/).map(parseCard);
}

export function fullDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push({ rank: r, suit: s });
  return d; // 52 cards
}
