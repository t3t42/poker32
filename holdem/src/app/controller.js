// controller.js — the game loop. Buffers engine events as they fire, animates
// them, renders the scene, then asks the current actor (human via UI, AI via a
// decider) for an action and applies it — repeating until the hand ends. All
// timing/animation/rendering/input is injected, so the loop is testable
// headlessly (no DOM, no rAF) and reusable by the browser app shell.

import { viewToScene, AnimMapper, tableGeometry } from './adapters.js';

export class Controller {
  constructor({
    engine, seats, geometry, mapper, heroSeat = 0, names = [],
    onScene, playAnimations, askHuman, wait, onDecision,
  } = {}) {
    if (!engine || !seats) throw new Error('Controller needs an engine and seats');
    this.engine = engine;
    this.seats = seats;                       // [{ human:true } | { decider }]
    this.heroSeat = heroSeat;
    this.names = names;
    this.geo = geometry || tableGeometry({ seatCount: engine.numSeats, heroSeat });
    this.mapper = mapper || new AnimMapper({ seatCount: engine.numSeats });
    this.onScene = onScene || (() => {});
    this.playAnimations = playAnimations || (() => Promise.resolve());
    this.askHuman = askHuman || (() => { throw new Error('no human input handler'); });
    this.wait = wait || (ms => new Promise(r => setTimeout(r, ms)));
    this.onDecision = onDecision || null;
    this._buffer = [];
    engine.onEvent = e => this._buffer.push(e);   // capture events as they emit
  }

  _render(activeSeat) {
    this.onScene(viewToScene(this.engine.getView(this.heroSeat), { heroSeat: this.heroSeat, names: this.names, activeSeat }));
  }
  _flush() {
    const evs = this._buffer; this._buffer = [];
    return this.playAnimations(this.mapper.mapBatch(evs, this.geo), evs);
  }

  // Play one hand to completion.
  async playHand() {
    this.mapper.reset();
    this._buffer = [];
    this.engine.startHand();
    await this._flush();                       // deal + blinds
    while (this.engine.currentActor() !== null) {
      const actor = this.engine.currentActor();
      this._render(actor);
      const view = this.engine.getView(actor);
      let action;
      if (this.seats[actor] && this.seats[actor].human) {
        action = await this.askHuman(view);
      } else {
        action = await this.seats[actor].decider.decide(view);
        if (this.onDecision) this.onDecision(actor, action, this.seats[actor].decider);
        if (action && action.delayMs) await this.wait(action.delayMs);
      }
      this.engine.applyAction(actor, action);
      await this._flush();                     // animate this action's events
    }
    this._render(null);                        // final (showdown / payout)
    return this.engine.lastResult;
  }
}
