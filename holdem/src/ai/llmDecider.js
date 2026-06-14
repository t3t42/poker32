// llmDecider.js — the hybrid seat decider (spec 4.3 §3, §5).
//
// decide(view) tries the Gemini path and, on ANY failure or timeout, falls back
// immediately to the same seat's built-in CognitiveAI (same personality preset),
// so the game never stalls. The fallback model is kept warm: observe*() always
// flow into it, so a mid-hand fallback has real opponent stats and affect.

import { GeminiClient, GeminiError, PERSONA_DESCRIPTIONS } from './geminiClient.js';
import { CognitiveAI } from './cognitiveAI.js';

export class LLMDecider {
  constructor({ client, fallback, name, personaDescription, apiKey, model,
    minIntervalMs = 1000, onFallback = null, logger = console, now, sleep } = {}) {
    if (!fallback) throw new Error('LLMDecider requires a CognitiveAI fallback');
    this.client = client || new GeminiClient();
    this.fallback = fallback;
    this.name = name || fallback.p?.name || 'AI';
    this.personaDescription = personaDescription ?? PERSONA_DESCRIPTIONS[fallback.p?.name] ?? '';
    this._apiKey = typeof apiKey === 'function' ? apiKey : () => apiKey;   // memory-only, may be supplied at runtime
    this.model = model;
    this.minIntervalMs = minIntervalMs;          // spec 4.3 §5 — per-seat call spacing
    this.onFallback = onFallback;                // UI hook (e.g. blink the seat icon)
    this.logger = logger;
    this.now = now || (() => Date.now());
    this.sleep = sleep || (ms => new Promise(r => setTimeout(r, ms)));
    this.lastCallAt = -Infinity;
    this.lastSource = null;                       // 'llm' | 'fallback'
    this.lastReason = null;
  }

  static fromArchetype(name, sessionStartStack = 10000, { client, apiKey, model, minIntervalMs, onFallback, logger, now, sleep, fallbackOpts = {} } = {}) {
    const fallback = CognitiveAI.fromArchetype(name, sessionStartStack, fallbackOpts);
    return new LLMDecider({ client, fallback, name, personaDescription: PERSONA_DESCRIPTIONS[name], apiKey, model, minIntervalMs, onFallback, logger, now, sleep });
  }

  async decide(view, promptExtras = {}) {
    const apiKey = this._apiKey();
    if (!apiKey) return this._fallbackDecide(view, 'nokey', { silent: true }); // keyless seat → built-in (spec 4.1)

    const wait = this.minIntervalMs - (this.now() - this.lastCallAt);
    if (wait > 0) await this.sleep(wait);
    this.lastCallAt = this.now();

    try {
      const action = await this.client.requestDecision(view, {
        name: this.name, personaDescription: this.personaDescription, apiKey, model: this.model, prompt: promptExtras,
      });
      if (action.delayMs == null) action.delayMs = this.fallback.tell(0.5); // personality-flavoured think time
      this.lastSource = 'llm'; this.lastReason = null;
      return action;
    } catch (e) {
      return this._fallbackDecide(view, e instanceof GeminiError ? e.reason : 'error');
    }
  }

  _fallbackDecide(view, reason, { silent = false } = {}) {
    const action = this.fallback.decide(view);   // built-in cognitive model, identical persona
    action.source = 'fallback';
    action.fallbackReason = reason;
    this.lastSource = 'fallback'; this.lastReason = reason;
    if (!silent) {
      if (this.onFallback) this.onFallback({ reason, seat: view.you?.seat, name: this.name });
      this.logger?.warn?.(`[Gemini fallback] seat ${view.you?.seat} (${this.name}): ${reason}`);
    }
    return action;
  }

  // Keep the fallback model's stats/affect warm regardless of which path decided.
  observeAction(...args) { return this.fallback.observeAction(...args); }
  observeHandEnd(...args) { return this.fallback.observeHandEnd(...args); }
  getStats(id) { return this.fallback.getStats(id); }
}
