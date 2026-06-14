// cognitiveAI.js — the cognitive AI agent. Implements the spec 2.1 pipeline:
//   ① equity (Monte Carlo)        → equity.js
//   ② prospect-theory value v(x)  → prospect.js
//   ③ bias/affect correction      → cognitiveState.js (tilt, anchoring, recency)
//   ④ opponent model + ToM        → range.js / opponentModel.js
//   ⑤ action distribution + sample
//   ⑥ behavioural tell (delay)
//
// decide(gameView) → Action consumes ONLY the engine's anti-cheat view, so the
// agent can never see another seat's hole cards. observe*() feed post-hand and
// per-action information back into OpponentStats and CognitiveState.

import { equityVsRandom, equityVsRanges, potOdds, mulberry32 } from './equity.js';
import { value, weightProb } from './prospect.js';
import { topPercentRange, handTopFraction } from './range.js';
import { OpponentStats, exploitAdjustments, reweightByPreflopAction } from './opponentModel.js';
import { CognitiveState } from './cognitiveState.js';
import { makePersonality } from './personalities.js';
import { ActionType } from '../engine/contracts.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export class CognitiveAI {
  constructor({ personality, sessionStartStack = 10000, samples = 1000, seed, devMode = false } = {}) {
    this.p = typeof personality === 'string' ? makePersonality(personality) : personality;
    this.state = new CognitiveState(this.p, sessionStartStack);
    this.samples = samples;                       // Monte-Carlo sims (spec: ≥1000)
    this.rng = mulberry32((seed ?? 0x1234567) >>> 0);
    this.devMode = devMode;
    this.opponents = new Map();                   // id → OpponentStats
    this.self = new OpponentStats();              // our own image (ToM L2)
    this._anchor = 0; this._anchorHand = -1;
    this._lastRangeTop = [];
    this.lastTrace = null;
  }
  static fromArchetype(name, sessionStartStack = 10000, opts = {}) {
    return new CognitiveAI({ personality: makePersonality(name), sessionStartStack, ...opts });
  }
  getStats(id) { if (!this.opponents.has(id)) this.opponents.set(id, new OpponentStats()); return this.opponents.get(id); }

  // ---------- the decision ----------
  decide(view) {
    if (!view || !view.legal) throw new Error('decide() called when this seat is not to act');

    // per-hand anchor reset + capture (spec 2.2 D: first meaningful bet this hand)
    if (this._anchorHand !== view.handNumber) { this._anchor = 0; this._anchorHand = view.handNumber; }
    if (this._anchor === 0 && view.currentBet > view.bigBlind) this._anchor = view.currentBet;

    const s2 = this.state.system2Weight(this._loadCtx(view));      // dual-process mix (②/B)
    const eqInfo = this._effectiveEquity(view, this.p.tomMax, s2);  // ① + ④
    const pv = this._prospectValues(view, eqInfo.eq);               // ②
    const dist = this._distribution(view, eqInfo.eq, pv, s2);       // ③ + ④ + ⑤
    const key = this._sample(dist);
    const action = this._toAction(view, key, eqInfo.eq);
    action.delayMs = this.tell(eqInfo.eq);                          // ⑥

    const trace = {
      equity: eqInfo.eq, equityVsRandom: eqInfo.eqRandom, equityVsRange: eqInfo.eqRange,
      system2Weight: s2, tilt: this.state.tiltLevel, potOdds: potOdds(view.toCall, view.potTotal),
      pv, distribution: dist, estRangeTopHands: this._lastRangeTop, chosen: key, anchor: this._anchor,
    };
    this.lastTrace = trace;
    action.reasoning = this._reason(eqInfo.eq, dist, key, view);
    if (this.devMode) action.trace = trace;
    return action;
  }

  // ① + ④ — equity, blending a naive (vs random) and an opponent-aware (vs
  // estimated ranges) estimate by the System-2 weight. ToM L0 stays naive.
  _effectiveEquity(view, tomLevel, s2) {
    const opps = this._liveOpps(view);
    const n = opps.length || 1;
    const o = { samples: this.samples, random: this.rng };
    const eqRandom = equityVsRandom(view.you.holeCards, view.board, n, o).equity;
    if (tomLevel >= 1 && opps.length) {
      const ranges = this._opponentRanges(view, opps);
      const eqRange = equityVsRanges(view.you.holeCards, view.board, ranges, { samples: this.samples, random: this.rng }).equity;
      return { eq: s2 * eqRange + (1 - s2) * eqRandom, eqRandom, eqRange };
    }
    return { eq: eqRandom, eqRandom, eqRange: null };
  }

  // ④ — estimate each opponent's range: a VPIP-based prior, narrowed by their
  // strongest observed action this hand (raise > call > check). spec 2.2 F/G.
  _opponentRanges(view, opps) {
    const ranges = opps.map(o => {
      const st = this.getStats(o.id);
      const pct = st.hands >= 8 ? clamp(st.VPIP, 0.08, 0.9) : 0.5;
      let range = topPercentRange(pct);
      const acts = (view.actionsThisHand || []).filter(a => a.seat === o.seat && a.type !== 'blind');
      const signal = acts.some(a => a.type === 'raise' || a.type === 'bet') ? 'raise'
        : acts.some(a => a.type === 'call') ? 'call'
          : acts.some(a => a.type === 'check') ? 'check' : null;
      return signal ? reweightByPreflopAction(range, signal) : range;
    });
    // dev panel: strongest hands in the first opponent's estimated range
    const first = ranges[0];
    this._lastRangeTop = first.keys().sort((a, b) => first.get(b) - first.get(a)).slice(0, 6);
    return ranges;
  }

  // ② — prospect-theory value of each action, from the session reference point.
  _prospectValues(view, eq) {
    const r = this.state.referenceStack, lam = this.p.lossAversionLambda;
    const stack = view.you.stack, pot = view.potTotal;
    const v = x => value(x - r, lam);

    const pvFold = v(stack);
    const cost = view.legal.canCheck ? 0 : view.legal.callAmount;
    const pvPassive = weightProb(eq) * v(stack + pot) + weightProb(1 - eq) * v(stack - cost);

    let pvAgg = -Infinity;
    if (view.legal.canRaise) {
      const raiseTo = this._raiseTo(view);
      const add = raiseTo - view.you.committedRound;
      const n = this._liveOpps(view).length || 1;
      const fe = Math.pow(this._foldEquity(view, add), n);          // all opponents must fold
      pvAgg = weightProb(fe) * v(stack + pot)
        + weightProb((1 - fe) * eq) * v(stack + pot + add)
        + weightProb((1 - fe) * (1 - eq)) * v(stack - add);
    }
    return { fold: pvFold, passive: pvPassive, aggressive: pvAgg };
  }

  // ⑤ — turn prospect values into an action distribution. Dual-process sets the
  // softmax temperature (more System-2 → sharper); archetype params and affect
  // (tilt, exploit, draw-chase, preflop range gate) reshape it.
  _distribution(view, eq, pv, s2) {
    const L = view.legal, p = this.p, tilt = this.state.tiltLevel;
    const present = [];
    if (L.canFold && L.toCall > 0) present.push('fold');   // folding when you can check is dominated
    present.push('passive');
    if (L.canRaise) present.push('aggressive');

    const pvs = present.map(k => pv[k]);
    const mn = Math.min(...pvs), span = (Math.max(...pvs) - mn) || 1;
    // Softmax temperature. Tilt's erraticism enters through s2 (which already
    // carries −0.4·tilt); the NET tilt direction — more bluffing, less folding —
    // is set by the explicit spec-2.2-C terms below, not by flattening here.
    const T = 0.18 * (1.25 - 0.5 * s2);
    const out = {}; let z = 0;
    for (const k of present) { const e = Math.exp(((pv[k] - mn) / span) / T); out[k] = e; z += e; }
    for (const k of present) out[k] /= z;

    const isBluff = eq < 0.5;
    if ('aggressive' in out) {
      const aggF = isBluff ? p.bluffFrequency * (1 + 1.2 * tilt) : (0.5 + p.aggression); // spec 2.2 C bluff mapping
      out.aggressive *= Math.max(aggF, 0.01) * 2.2;
    }
    if ('passive' in out) {
      let callB = (0.7 + p.preflopPct) * (1 - p.aggression * 0.4);   // looser continue lighter; aggressive prefer raising
      if (eq > 0.25 && eq < 0.45) callB *= this.state.drawChaseMultiplier(); // recency draw-chase (spec 2.2 E)
      out.passive *= Math.max(callB, 0.05);
    }
    if ('fold' in out) {
      out.fold *= Math.max((1.3 - p.preflopPct) * (1 - 0.3 * tilt), 0.05); // tilt folds less (spec 2.2 C)
    }
    // preflop opening gate: hands outside our (tilt-widened) range rarely continue
    if (view.state === 'PREFLOP' && L.toCall > 0) {
      const eff = p.preflopPct * (1 + 0.5 * tilt);
      if (handTopFraction(view.you.holeCards) > eff) {
        if ('passive' in out) out.passive *= 0.12;
        if ('aggressive' in out) out.aggressive *= (p.bluffFrequency > 0 ? 0.2 : 0.1);
      }
    }
    // exploit (spec 2.2 G): bluff more vs foldy fields, lean value vs callers
    const ex = this._aggregateExploit(view);
    if (isBluff && 'aggressive' in out) out.aggressive *= clamp(1 + ex.bluffWiden - ex.valueWiden * 0.5, 0.1, 3);

    let s = 0; for (const k in out) s += out[k];
    for (const k in out) out[k] /= s || 1;
    return out;
  }

  // ③ raise sizing with anchoring (spec 2.2 D): blend a pot-fraction "optimal"
  // size (scaled by aggression) toward the hand's first observed bet size.
  _raiseTo(view) {
    const L = view.legal;
    if (L.raiseAllInOnly) return L.maxRaiseTo;
    const potAfter = view.potTotal + view.toCall;
    const frac = 0.5 + this.p.aggression * 0.6;
    let optimal = view.currentBet + Math.round(frac * Math.max(potAfter, view.bigBlind));
    if (this._anchor > 0) optimal = Math.round((1 - this.p.anchoringStrength) * optimal + this.p.anchoringStrength * this._anchor);
    return clamp(optimal, L.minRaiseTo, L.maxRaiseTo);
  }

  // Fold equity: probability a single opponent folds to our raise. Built from
  // opponent tendencies (tight fold more; calling stations fold less), raise
  // size pressure, and — for ToM L2 — our own table image.
  _foldEquity(view, add) {
    const opps = this._liveOpps(view);
    let tight = 0.5, station = 0, n = 0, sumV = 0;
    for (const o of opps) { const st = this.getStats(o.id); if (st.hands >= 8) { sumV += st.VPIP; n++; } }
    if (n) { const avg = sumV / n; tight = clamp(1 - avg, 0, 1); station = clamp(avg - 0.4, 0, 0.5); }
    const sizePressure = Math.min(add / (view.potTotal + 1) * 0.25, 0.25);
    let fe = 0.38 + sizePressure + (tight - 0.5) * 0.3 - station * 0.3;
    if (this.p.tomMax >= 2) fe += (this._selfImageTightness() - 0.5) * 0.3;
    return clamp(fe, 0.05, 0.92);
  }
  _selfImageTightness() { return this.self.hands >= 8 ? clamp(1 - this.self.VPIP, 0.1, 0.9) : 0.5; }

  _aggregateExploit(view) {
    const opps = this._liveOpps(view); let vw = 0, bw = 0, n = 0;
    for (const o of opps) { const a = exploitAdjustments(this.getStats(o.id)); vw += a.valueWiden; bw += a.bluffWiden; n++; }
    return n ? { valueWiden: vw / n, bluffWiden: bw / n } : { valueWiden: 0, bluffWiden: 0 };
  }

  // ⑥ behavioural tell — think-time. Mean is steady for Rock/Shark (strengthLeak
  // 0) and strength-correlated for the leaky archetypes; jitter adds variability.
  tellMean(eq) {
    const t = this.p.tell;
    if (t.strengthLeak === 0) return t.baseMs;
    const indecision = 1 - Math.abs(eq - 0.5) * 2;
    return Math.max(150, t.baseMs * (1 + 0.3 * indecision + t.strengthLeak * (0.5 - eq)));
  }
  tell(eq) {
    const t = this.p.tell;
    const j = t.jitter * (this.rng() * 2 - 1);
    return Math.max(120, Math.round(this.tellMean(eq) * (1 + j)));
  }

  // ---------- helpers ----------
  _liveOpps(view) { return view.players.filter(q => q.seat !== view.you.seat && !q.folded && !q.out); }
  _loadCtx(view) {
    const active = view.players.filter(q => !q.folded && !q.out).length;
    const eff = Math.max(view.you.stack + view.you.committedTotal, 1);
    return { activePlayers: active, potToStackRatio: view.potTotal / eff };
  }
  _sample(dist) {
    let x = this.rng(); for (const k in dist) { x -= dist[k]; if (x <= 0) return k; }
    return Object.keys(dist).pop();
  }
  _toAction(view, key, eq) {
    if (key === 'aggressive' && view.legal.canRaise) return { type: ActionType.RAISE, amount: this._raiseTo(view) };
    if (key === 'fold' && view.legal.canFold && view.legal.toCall > 0) return { type: ActionType.FOLD };
    return view.legal.canCheck ? { type: ActionType.CHECK } : { type: ActionType.CALL };
  }
  _reason(eq, dist, key, view) {
    const pct = (x) => `${Math.round(x * 100)}%`;
    const label = key === 'aggressive' ? (eq < 0.5 ? 'bluff/semibluff' : 'value raise') : key === 'fold' ? 'fold' : (view.legal.canCheck ? 'check' : 'call');
    return `eq ${pct(eq)} vs odds ${pct(potOdds(view.toCall, view.potTotal))} (tilt ${eq && this.state.tiltLevel.toFixed(2)}) → ${label}`;
  }

  // ---------- learning hooks ----------
  // Per-action observation (drives AF / bets / calls). isSelf updates our image.
  observeAction(playerId, kind, { isSelf = false } = {}) {
    (isSelf ? this.self : this.getStats(playerId)).recordAction(kind);
  }
  // End-of-hand observation: updates affect (tilt/recency) and per-opponent stats.
  observeHandEnd(result = {}) {
    this.state.recordHandResult(result);
    if (Array.isArray(result.opponents)) {
      for (const o of result.opponents) {
        const st = this.getStats(o.id);
        st.recordHand({ voluntaryPutIn: !!o.voluntaryPutIn, raisedPreflop: !!o.raisedPreflop });
        if (o.shownHand) st.recordShowdown(o.shownHand);
      }
    }
    if (result.self) this.self.recordHand({ voluntaryPutIn: !!result.self.voluntaryPutIn, raisedPreflop: !!result.self.raisedPreflop });
  }
}
