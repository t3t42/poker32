// hud.js — the toggleable glassmorphism HUD (spec 3.5): pot odds, live equity
// (Monte-Carlo, supplied by the AI layer), and a hand-rank hint. Pure helpers
// produce the values; hudHTML renders the panel (styled by table.css).

import { evaluate7 } from '../engine/handEvaluator.js';
import { rankLabel } from './card.js';

// Break-even equity to call, as a percentage string (e.g. "25%").
export function potOddsPct(toCall, pot) {
  const denom = pot + toCall;
  return denom > 0 ? `${Math.round((toCall / denom) * 100)}%` : '—';
}
export function equityPct(equity) {
  return equity == null ? '—' : `${Math.round(equity * 100)}%`;
}

// A short made-hand / draw hint from the hero's cards + board.
export function handRankHint(holeCards, board = []) {
  const all = [...(holeCards || []), ...(board || [])];
  if (all.length >= 5) return evaluate7(all).name;
  if (holeCards && holeCards.length === 2) {
    const [a, b] = holeCards;
    if (a.rank === b.rank) return `Pair of ${rankLabel(a.rank)}s`;
    const hi = a.rank >= b.rank ? a : b;
    return `${rankLabel(hi.rank)} high${a.suit === b.suit ? ', suited' : ''}`;
  }
  return '—';
}

// The HUD panel markup. `data`: { potOdds, equity, hint }.
export function hudHTML({ potOdds = '—', equity = '—', hint = '—' } = {}) {
  const row = (label, value, cls = '') => `<div class="hud-row"><span class="hud-label">${label}</span><span class="hud-value ${cls}">${value}</span></div>`;
  return `<div class="hud-panel" role="status" aria-label="hand insights">
    <div class="hud-title">Insights</div>
    ${row('Pot odds', potOdds)}
    ${row('Win chance', equity, 'hud-equity')}
    ${row('Your hand', hint, 'hud-hint')}
  </div>`;
}
