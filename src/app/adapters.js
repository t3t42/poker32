// adapters.js — pure glue between the engine and the renderer/animation layers.
//   tableGeometry: where seats/cards/chips/pot sit (hero rotated to the bottom)
//   viewToScene:   getView → the snapshot sceneHTML draws
//   AnimMapper:    engine events → normalized animation events (+ effect cues)
// All pure/deterministic → Node-testable; the browser supplies the DOM.

import { seatLayout, towardCenter } from '../render/table.js';

// Stable element ids shared by the renderer DOM and the animation targets.
export const cardId = (seat, idx) => `c${seat}_${idx}`;
export const boardId = i => `b${i}`;
export const betChipId = seat => `bet${seat}`;

// Engine seat → display slot so the hero (human) is always bottom-centre.
export function tableGeometry({ width = 900, height = 560, seatCount = 2, heroSeat = 0 } = {}) {
  const slots = seatLayout(seatCount, { width, height });
  const slotOf = seat => slots[(seat - heroSeat + seatCount) % seatCount];
  const deck = () => ({ x: width / 2, y: height * 0.12 });
  const seatPos = seat => { const s = slotOf(seat); return { x: s.x, y: s.y }; };
  const seatCard = (seat, idx) => { const p = towardCenter(slotOf(seat), width, height, 0.26); return { x: p.x + (idx - 0.5) * 30, y: p.y }; };
  const board = i => ({ x: width / 2 + (i - 2) * 64, y: height * 0.42 });
  const pot = () => ({ x: width / 2, y: height * 0.56 });
  const bet = seat => towardCenter(slotOf(seat), width, height, 0.5);
  return { deck, seatPos, seatCard, board, pot, bet, slotOf };
}

// getView → scene snapshot. Seats are rotated so the hero is first (bottom);
// only the hero's hole cards are present (others are face-down counts).
export function viewToScene(view, { heroSeat = 0, names = [], activeSeat = null } = {}) {
  const seats = view.players.map(p => ({
    seat: p.seat,
    name: names[p.seat] || p.id || `Seat ${p.seat}`,
    stack: p.stack,
    committed: p.committedRound || 0,
    holeCards: p.seat === view.you.seat ? view.you.holeCards : null,
    cardCount: p.cardCount ?? 2,
    folded: !!p.folded, allIn: !!p.allIn,
    isButton: !!p.isButton,
    isActive: activeSeat != null && p.seat === activeSeat,
  }));
  const rotated = seats.slice(heroSeat).concat(seats.slice(0, heroSeat));
  return { pot: view.potTotal, board: view.board.slice(), heroSeat: 0, seats: rotated };
}

// Engine events → normalized animation events (consumed by Presenter) and
// effect cues (WIN/ALL_IN/SHOWDOWN). Tracks per-hand card indices.
export class AnimMapper {
  constructor({ seatCount = 2 } = {}) { this.n = seatCount; this.reset(); }
  reset() { this.dealIdx = {}; this.boardIdx = 0; }
  mapBatch(events, geo) {
    const out = [];
    let dealOrder = 0, betOrder = 0;
    for (const e of events) {
      switch (e.type) {
        case 'DEAL': {
          const i = (this.dealIdx[e.seat] = (this.dealIdx[e.seat] ?? -1) + 1);
          out.push({ type: 'DEAL', id: cardId(e.seat, i), from: geo.deck(), to: geo.seatCard(e.seat, i), order: dealOrder++ });
          break;
        }
        case 'FLOP': case 'TURN': case 'RIVER': {
          const cards = e.cards.map(() => { const bi = this.boardIdx++; return { id: boardId(bi), from: geo.deck(), to: geo.board(bi) }; });
          out.push({ type: e.type, cards });
          break;
        }
        case 'POST_BLIND': case 'BET':
          out.push({ type: 'BET', id: betChipId(e.seat), from: geo.seatPos(e.seat), to: geo.bet(e.seat), order: betOrder++, amount: e.amount });
          break;
        case 'COLLECT': {
          const items = [];
          for (let s = 0; s < this.n; s++) items.push({ id: betChipId(s), from: geo.bet(s), to: geo.pot() });
          out.push({ type: 'COLLECT', items });
          break;
        }
        case 'ALL_IN': out.push({ type: 'ALL_IN', seat: e.seat, at: geo.seatPos(e.seat) }); break;
        case 'SHOWDOWN': out.push({ type: 'SHOWDOWN', reveals: e.reveals }); break;
        case 'WIN': out.push({ type: 'WIN', at: geo.pot(), payouts: e.payouts }); break;
        // ACTION (fold/check), BURN, STATE carry no motion of their own here.
      }
    }
    return out;
  }
}
