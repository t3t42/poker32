// gameEngine.js — Hold'em orchestration (Phase 1b).
//
// A render-free state machine that drives a full hand:
//   WAITING → PREFLOP → FLOP → TURN → RIVER → SHOWDOWN → PAYOUT → (next hand)
// All phase transitions go THROUGH this engine. It owns no DOM and no AI; an
// external runner (Phase 2+) reads getView(seat) → asks an actor to decide() →
// calls applyAction(seat, action). Tests drive applyAction with scripted lines.
//
// Betting correctness (spec 1.2):
//  • Minimum raise = at least the previous raise increment.
//  • An incomplete (short) all-in raise increases the amount to call but does
//    NOT reopen the betting — players who already acted may only call or fold.
// This is modelled with a per-seat `canRaise` right that only a FULL bet/raise
// reopens; a short all-in leaves it untouched.

import { Deck } from './deck.js';
import { evaluate7 } from './handEvaluator.js';
import { buildPots, distribute, seatOrderFromButton } from './potManager.js';
import { GameState, ActionType, EventType } from './contracts.js';

export class HoldemEngine {
  constructor(config = {}) {
    const seats = (config.seats || []).map((s, i) => ({
      id: s.id ?? `P${i}`,
      seat: i,
      stack: s.stack ?? 10000,
      out: (s.stack ?? 10000) <= 0,
      // per-hand fields (reset in startHand):
      holeCards: [], folded: false, allIn: false,
      committedRound: 0, committedTotal: 0, hasActed: false, canRaise: true,
    }));
    if (seats.length < 2) throw new Error('Need at least 2 seats');

    this.seats = seats;
    this.numSeats = seats.length;
    this.smallBlind = config.smallBlind ?? 50;
    this.bigBlind = config.bigBlind ?? 100;
    this.buttonSeat = config.button ?? 0;
    this.options = {
      blindIncreaseEveryHands: config.blindIncreaseEveryHands ?? 0, // 0 = OFF (spec default)
      blindMultiplier: config.blindMultiplier ?? 2,
    };
    // Injectable for deterministic tests / replay; defaults to a crypto shuffle.
    this.deckFactory = config.deckFactory || (() => new Deck().shuffle());
    this.onEvent = config.onEvent || null;

    this.state = GameState.WAITING;
    this.board = [];
    this.deck = null;
    this.handNumber = 0;
    this.actorSeat = null;
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.lastAggressorSeat = null;
    this.pot = 0;            // chips already pulled to the centre (settled streets)
    this.sbSeat = null;
    this.bbSeat = null;
    this.events = [];
    this.lastResult = null;  // showdown / payout summary of the most recent hand
    this.handActions = [];
  }

  // ---------- events ----------
  _emit(type, payload = {}) {
    const ev = { type, ...payload, state: this.state, hand: this.handNumber };
    this.events.push(ev);
    if (this.onEvent) this.onEvent(ev);
    return ev;
  }

  // ---------- seat predicates ----------
  _inHand(p) { return !p.out; }               // dealt into this hand
  _live(p) { return !p.out && !p.folded; }    // still contesting the pot
  _canAct(p) { return !p.out && !p.folded && !p.allIn && p.stack > 0; }

  _nextSeatWhere(fromSeat, pred) {
    for (let k = 1; k <= this.numSeats; k++) {
      const idx = (fromSeat + k) % this.numSeats;
      if (pred(this.seats[idx])) return idx;
    }
    return null;
  }
  _canActCount() { return this.seats.filter(p => this._canAct(p)).length; }
  _liveSeats() { return this.seats.filter(p => this._live(p)); }
  _hasNonAllInOpponent(seat) {
    return this.seats.some(p => p.seat !== seat && this._live(p) && !p.allIn && p.stack > 0);
  }
  currentActor() { return this.actorSeat; }

  // ---------- hand lifecycle ----------
  startHand() {
    // Rotate the button to the next seat with chips (skipped on the first hand).
    if (this.handNumber > 0) {
      const nb = this._nextSeatWhere(this.buttonSeat, p => p.stack > 0);
      if (nb !== null) this.buttonSeat = nb;
    }
    this.handNumber += 1;

    // Optional blind escalation every N hands (spec 1.1; default OFF).
    const N = this.options.blindIncreaseEveryHands;
    if (N > 0 && this.handNumber > 1 && (this.handNumber - 1) % N === 0) {
      this.smallBlind = Math.round(this.smallBlind * this.options.blindMultiplier);
      this.bigBlind = Math.round(this.bigBlind * this.options.blindMultiplier);
    }

    // Reset per-hand state.
    this.board = [];
    this.pot = 0;
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.lastAggressorSeat = null;
    this.actorSeat = null;
    this.lastResult = null;
    this.handActions = []; // public per-hand betting log (for views / dev panel)
    for (const p of this.seats) {
      p.out = p.stack <= 0;
      p.holeCards = []; p.folded = false; p.allIn = false;
      p.committedRound = 0; p.committedTotal = 0; p.hasActed = false; p.canRaise = true;
    }

    const inHand = this.seats.filter(p => this._inHand(p));
    if (inHand.length < 2) {
      this.state = GameState.WAITING;
      this._emit(EventType.STATE, { note: 'game-over' });
      return this;
    }

    this.deck = this.deckFactory();
    this.state = GameState.PREFLOP;
    this._emit(EventType.STATE);

    // Blind positions. Heads-up: the button posts the small blind.
    if (inHand.length === 2) {
      this.sbSeat = this.buttonSeat;
      this.bbSeat = this._nextSeatWhere(this.buttonSeat, p => this._inHand(p));
    } else {
      this.sbSeat = this._nextSeatWhere(this.buttonSeat, p => this._inHand(p));
      this.bbSeat = this._nextSeatWhere(this.sbSeat, p => this._inHand(p));
    }
    this._postBlind(this.sbSeat, this.smallBlind, 'SB');
    this._postBlind(this.bbSeat, this.bigBlind, 'BB');
    this.currentBet = this.bigBlind;
    this.minRaise = this.bigBlind;          // first legal raise increment = one BB
    this.lastAggressorSeat = this.bbSeat;

    // Deal hole cards: two passes, starting from the seat left of the button.
    const order = seatOrderFromButton(
      inHand.map(p => ({ playerId: p.seat, seat: p.seat })), this.buttonSeat, this.numSeats,
    ).map(seatIdx => this.seats[seatIdx]);
    for (let pass = 0; pass < 2; pass++) {
      for (const p of order) {
        const card = this.deck.draw(1);
        p.holeCards.push(card);
        this._emit(EventType.DEAL, { seat: p.seat, card });
      }
    }

    // Open preflop betting (general rule: first to act is left of the BB).
    this.actorSeat = this._firstToAct(true);
    if (this.actorSeat === null) { this._settleStreet(); this._advancePhase(); }
    return this;
  }

  _postBlind(seat, amount, which) {
    const p = this.seats[seat];
    const pay = Math.min(amount, p.stack);
    p.stack -= pay; p.committedRound += pay; p.committedTotal += pay;
    if (p.stack === 0) p.allIn = true;
    this._emit(EventType.POST_BLIND, { seat, amount: pay, blind: which });
    this.handActions.push({ seat, street: 'PREFLOP', type: 'blind', amount: pay, blind: which });
    if (p.allIn) this._emit(EventType.ALL_IN, { seat });
  }

  // First to act: preflop = left of BB; postflop = left of button (= SB seat,
  // or BB in heads-up). Skips folded / all-in players.
  _firstToAct(preflop) {
    const start = preflop ? this.bbSeat : this.buttonSeat;
    return this._nextSeatWhere(start, p => this._canAct(p));
  }

  // ---------- legality ----------
  legalActions(seat) {
    const p = this.seats[seat];
    if (this.actorSeat !== seat || !this._canAct(p)) {
      return { canFold: false, canCheck: false, canCall: false, canRaise: false };
    }
    const toCall = Math.max(this.currentBet - p.committedRound, 0);
    const canCheck = toCall === 0;
    const callAmount = Math.min(toCall, p.stack);              // all-in call if stack < toCall
    const callIsAllIn = !canCheck && p.stack <= toCall;
    const maxRaiseTo = p.committedRound + p.stack;             // total if shoving all-in
    const fullRaiseTo = this.currentBet + this.minRaise;
    // A raise needs (a) chips beyond a call and (b) an opponent who could call it.
    const canRaise = p.canRaise && this._hasNonAllInOpponent(seat) && maxRaiseTo > this.currentBet;
    return {
      canFold: true,
      canCheck,
      canCall: !canCheck && callAmount > 0,
      callAmount,
      callIsAllIn,
      canRaise,
      minRaiseTo: canRaise ? Math.min(fullRaiseTo, maxRaiseTo) : null,
      maxRaiseTo: canRaise ? maxRaiseTo : null,
      // true when the only legal raise is a short all-in (can't reach a full raise)
      raiseAllInOnly: canRaise ? fullRaiseTo > maxRaiseTo : false,
      toCall,
    };
  }

  // ---------- apply an action ----------
  applyAction(seat, action) {
    if (this.actorSeat !== seat) throw new Error(`Not seat ${seat}'s turn (actor=${this.actorSeat})`);
    const p = this.seats[seat];
    const la = this.legalActions(seat);

    switch (action.type) {
      case ActionType.FOLD:
        p.folded = true; p.hasActed = true; p.canRaise = false;
        this._emit(EventType.ACTION, { seat, action: 'fold' });
        this.handActions.push({ seat, street: this.state, type: 'fold', amount: 0 });
        break;

      case ActionType.CHECK:
        if (!la.canCheck) throw new Error('Illegal check (facing a bet)');
        p.hasActed = true; p.canRaise = false;
        this._emit(EventType.ACTION, { seat, action: 'check' });
        this.handActions.push({ seat, street: this.state, type: 'check', amount: 0 });
        break;

      case ActionType.CALL: {
        if (la.canCheck) throw new Error('Nothing to call — use check');
        this._commit(p, la.callAmount);
        p.hasActed = true; p.canRaise = false;
        this._emit(EventType.BET, { seat, amount: la.callAmount, total: p.committedRound, kind: 'call' });
        this.handActions.push({ seat, street: this.state, type: 'call', amount: la.callAmount, total: p.committedRound });
        if (p.allIn) this._emit(EventType.ALL_IN, { seat });
        break;
      }

      case ActionType.RAISE: {
        if (!la.canRaise) throw new Error('Raising is not allowed here');
        const raiseTo = action.amount;
        const isAllIn = raiseTo === la.maxRaiseTo;
        const legalFull = raiseTo >= this.currentBet + this.minRaise && raiseTo <= la.maxRaiseTo;
        if (!(legalFull || (isAllIn && raiseTo > this.currentBet))) {
          throw new Error(`Illegal raise to ${raiseTo} (min ${la.minRaiseTo}, max ${la.maxRaiseTo})`);
        }
        const currentBetBefore = this.currentBet;
        const increment = raiseTo - currentBetBefore;
        const fullRaise = increment >= this.minRaise;
        const added = raiseTo - p.committedRound;     // chips this action puts in
        const kind = currentBetBefore === 0 ? 'bet' : 'raise';
        this._commit(p, added);
        p.hasActed = true;
        this.currentBet = raiseTo;
        this._emit(EventType.BET, { seat, amount: added, total: raiseTo, kind });
        this.handActions.push({ seat, street: this.state, type: kind, amount: added, total: raiseTo });
        if (p.allIn) this._emit(EventType.ALL_IN, { seat });

        if (fullRaise) {
          // FULL raise → reopen the action: everyone else still able to act may raise again.
          this.minRaise = increment;
          this.lastAggressorSeat = seat;
          p.canRaise = false;
          for (const q of this.seats) if (q.seat !== seat && this._canAct(q)) q.canRaise = true;
        } else {
          // Short all-in → raises the call amount but does NOT reopen the betting.
          // minRaise and lastAggressorSeat stay put; others' canRaise is untouched,
          // so anyone who already acted can now only call the extra or fold.
          p.canRaise = false;
        }
        break;
      }

      default:
        throw new Error(`Unknown action "${action.type}"`);
    }

    // Everyone but one folded → uncontested win, no showdown.
    if (this._liveSeats().length === 1) {
      this._settleStreet();
      this._awardUncontested(this._liveSeats()[0]);
      return this;
    }

    const next = this._nextActor(seat);
    if (next !== null) { this.actorSeat = next; return this; }

    // Betting round closed.
    this.actorSeat = null;
    this._settleStreet();
    this._advancePhase();
    return this;
  }

  _commit(p, amount) {
    const amt = Math.min(amount, p.stack);
    p.stack -= amt; p.committedRound += amt; p.committedTotal += amt;
    if (p.stack === 0) p.allIn = true;
  }

  // Next player who must act: still able to act AND either facing an unmatched
  // bet, or has not yet had a turn this round (covers the BB option).
  _nextActor(afterSeat) {
    return this._nextSeatWhere(afterSeat, p =>
      this._canAct(p) && (p.committedRound < this.currentBet || !p.hasActed));
  }

  // Pull this street's bets into the central pot; reset round state for the next.
  _settleStreet() {
    let pulled = 0;
    for (const p of this.seats) { pulled += p.committedRound; p.committedRound = 0; }
    if (pulled > 0) { this.pot += pulled; this._emit(EventType.COLLECT, { amount: pulled, pot: this.pot }); }
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.lastAggressorSeat = null;
    for (const p of this.seats) { p.hasActed = false; p.canRaise = true; }
  }

  // Deal community cards (with a burn). Returns the freshly dealt cards.
  _dealCommunity(n) {
    this.deck.burn();
    this._emit(EventType.BURN, {});
    const dealt = [];
    for (let i = 0; i < n; i++) { const c = this.deck.draw(1); this.board.push(c); dealt.push(c); }
    return dealt;
  }

  // Advance to the next street; open betting if ≥2 players can act, otherwise
  // run the board out and head to showdown.
  _advancePhase() {
    const live = this._liveSeats();
    if (live.length === 1) { this._awardUncontested(live[0]); return; }
    if (this.state === GameState.RIVER) { this._showdown(); return; }

    let dealt, streetEvent;
    if (this.state === GameState.PREFLOP) { this.state = GameState.FLOP; this._emit(EventType.STATE); dealt = this._dealCommunity(3); streetEvent = EventType.FLOP; }
    else if (this.state === GameState.FLOP) { this.state = GameState.TURN; this._emit(EventType.STATE); dealt = this._dealCommunity(1); streetEvent = EventType.TURN; }
    else /* TURN */ { this.state = GameState.RIVER; this._emit(EventType.STATE); dealt = this._dealCommunity(1); streetEvent = EventType.RIVER; }
    this._emit(streetEvent, { cards: dealt });

    if (this._canActCount() >= 2) {
      this.actorSeat = this._firstToAct(false);
      if (this.actorSeat === null) this._advancePhase(); // safety: nobody can act
    } else {
      this._advancePhase();                               // run-out
    }
  }

  _awardUncontested(winner) {
    const amount = this.pot;
    winner.stack += amount;
    this.pot = 0;
    this.state = GameState.PAYOUT;
    const payouts = [{ seat: winner.seat, amount }];
    this._emit(EventType.WIN, { payouts, uncontested: true });
    this._emit(EventType.STATE);
    this.lastResult = { uncontested: true, payouts };
    this.actorSeat = null;
  }

  _showdown() {
    this.state = GameState.SHOWDOWN;
    this._emit(EventType.STATE);

    const live = this._liveSeats();
    const scores = new Map();
    const reveals = [];
    for (const p of live) {
      const r = evaluate7([...p.holeCards, ...this.board]);
      scores.set(p.id, r.score);
      reveals.push({ seat: p.seat, holeCards: p.holeCards.slice(), best5: r.best5, name: r.name, detail: r.detail });
    }
    this._emit(EventType.SHOWDOWN, { reveals });

    // Side pots use EVERY in-hand player's total contribution (folded included).
    const inHand = this.seats.filter(p => this._inHand(p));
    const pots = buildPots(inHand.map(p => ({ playerId: p.id, committed: p.committedTotal, folded: p.folded })));
    const seatOrder = seatOrderFromButton(
      inHand.map(p => ({ playerId: p.id, seat: p.seat })), this.buttonSeat, this.numSeats);
    const { payouts, potResults } = distribute(pots, scores, seatOrder);

    const byId = new Map(this.seats.map(p => [p.id, p]));
    const payoutList = [];
    for (const [id, amt] of payouts) { byId.get(id).stack += amt; payoutList.push({ seat: byId.get(id).seat, amount: amt }); }
    this.pot = 0;
    this.state = GameState.PAYOUT;
    this._emit(EventType.WIN, {
      payouts: payoutList,
      pots: potResults.map(r => ({ amount: r.amount, winners: r.winners.map(id => byId.get(id).seat) })),
    });
    this._emit(EventType.STATE);
    this.lastResult = { reveals, payouts: payoutList, pots: potResults };
    this.actorSeat = null;
  }

  // ---------- anti-cheat public view (spec 1.3) ----------
  // PUBLIC info + only the requesting seat's own hole cards. Other players'
  // hole cards are NEVER exposed; this is the boundary AIs see.
  getView(seat) {
    const me = this.seats[seat];
    const liveBets = this.seats.reduce((s, p) => s + p.committedRound, 0);
    return {
      handNumber: this.handNumber,
      state: this.state,
      board: this.board.slice(),
      actionsThisHand: this.handActions.slice(),
      potTotal: this.pot + liveBets,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      buttonSeat: this.buttonSeat,
      sbSeat: this.sbSeat,
      bbSeat: this.bbSeat,
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      toCall: me ? Math.max(this.currentBet - me.committedRound, 0) : 0,
      isYourTurn: this.actorSeat === seat,
      legal: this.actorSeat === seat ? this.legalActions(seat) : null,
      you: me ? {
        seat, id: me.id, stack: me.stack, holeCards: me.holeCards.slice(),
        committedRound: me.committedRound, committedTotal: me.committedTotal,
        folded: me.folded, allIn: me.allIn,
      } : null,
      players: this.seats.map(p => ({
        seat: p.seat, id: p.id, stack: p.stack,
        committedRound: p.committedRound, committedTotal: p.committedTotal,
        folded: p.folded, allIn: p.allIn, out: p.out,
        isButton: p.seat === this.buttonSeat,
        cardCount: p.holeCards.length,
        holeCards: p.seat === seat ? p.holeCards.slice() : null, // anti-cheat
      })),
    };
  }
}
