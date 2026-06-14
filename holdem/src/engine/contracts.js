// contracts.js — Cross-layer contracts (the "seams").
//
// These shapes are fixed by the spec (SSOT). Engine → AILayer → Presenter →
// Renderer all agree on them, so later phases plug in without churn. Enums are
// real exports; the GameView shape is finalised in Phase 1b/2 alongside the
// state machine and AI layer.

// Game progression state machine (spec 1.1). EVERY transition goes THROUGH the
// machine — no layer mutates the phase directly.
export const GameState = {
  WAITING: 'WAITING', PREFLOP: 'PREFLOP', FLOP: 'FLOP', TURN: 'TURN',
  RIVER: 'RIVER', SHOWDOWN: 'SHOWDOWN', PAYOUT: 'PAYOUT',
};

// The only verbs an actor may return from decide(gameView) → Action.
export const ActionType = { FOLD: 'fold', CHECK: 'check', CALL: 'call', RAISE: 'raise' };

/**
 * @typedef {Object} Action
 * @property {'fold'|'check'|'call'|'raise'} type
 * @property {number} [amount]    For RAISE: the TOTAL bet for this round (spec 4.2).
 * @property {string} [reasoning] One-sentence rationale (dev mode / Gemini).
 * @property {string} [tableTalk] Optional short table-talk line (Gemini, spec 4.3).
 */

// Engine → Presenter event taxonomy (spec 1.3 / 3.4). Phase 1b emits the
// structural events; Phase 5 enriches payloads to drive the animation queue.
export const EventType = {
  DEAL: 'DEAL', FLIP: 'FLIP', BURN: 'BURN',
  FLOP: 'FLOP', TURN: 'TURN', RIVER: 'RIVER',
  POST_BLIND: 'POST_BLIND', BET: 'BET', COLLECT: 'COLLECT',
  ACTION: 'ACTION', // non-chip action (fold / check)
  ALL_IN: 'ALL_IN', SHOWDOWN: 'SHOWDOWN', WIN: 'WIN',
  STATE: 'STATE', // phase transition
};

/**
 * gameView — PUBLIC information only, handed to each actor. CRITICAL (spec 1.3):
 * it must NEVER contain another player's hole cards (anti-cheat). Finalised in
 * Phase 1b/2 alongside the state machine and AI layer.
 * @typedef {Object} GameView
 */
