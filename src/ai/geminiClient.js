// geminiClient.js — optional LLM decision path (spec §4 / Document 4).
//
// This module is a PURE transport + prompt + mapping layer. It performs no
// fallback itself: on any failure it throws a typed GeminiError, and the
// Phase-3b decider catches it and falls back to the built-in CognitiveAI.
//
// Network access is injected (`fetchImpl`) so the browser uses real `fetch`
// while tests inject a mock — no live calls, no key required to test.

import { cardToString } from '../engine/cards.js';
import { ActionType } from '../engine/contracts.js';

// Configurable in the settings UI; kept as a constant seam here (spec 4.1).
export const GEMINI_MODEL = 'gemini-flash-lite-3.1';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const delay = ms => new Promise(r => setTimeout(r, ms));

export class GeminiError extends Error {
  // reason ∈ 'nokey' | 'timeout' | 'network' | 'http' | 'ratelimit' | 'parse'
  constructor(reason, message) { super(message || reason); this.name = 'GeminiError'; this.reason = reason; }
}

// Per-archetype style sentence injected into the persona prompt.
export const PERSONA_DESCRIPTIONS = {
  Rock: '극도로 타이트하고 신중함. 프리미엄 핸드만 플레이하며 좀처럼 블러프하지 않음.',
  CallingStation: '콜을 매우 자주 함. 좀처럼 폴드하지 않고 공격적이지 않으며 쇼다운을 즐김.',
  Maniac: '매우 공격적이고 변덕스러움. 자주 레이즈하고 블러프 빈도가 높음.',
  Shark: '균형 잡히고 분석적. 상대 성향을 읽어 익스플로잇하며 능숙하게 블러프함.',
};

// REST endpoint for a generateContent call (spec 4.1).
export function buildEndpoint(model, apiKey) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
}

// System prompt = persona template + strict output rules (spec 4.2).
export function buildSystemPrompt(name, personaDescription) {
  return [
    `당신은 텍사스 홀덤 플레이어 "${name}"입니다. 스타일: ${personaDescription}.`,
    '반드시 아래 JSON 한 개만 출력하십시오. 다른 텍스트 금지.',
    '{"action":"fold|check|call|raise","amount":숫자(레이즈 시 총 베팅액),',
    ' "reasoning":"한 문장","tableTalk":"테이블에서 할 짧은 말(선택)"}',
    '규칙: amount는 [minRaise, myStack] 범위. check 불가 상황에서 check 금지.',
  ].join('\n');
}

function positionLabel(view) {
  const s = view.you.seat;
  if (s === view.buttonSeat) return 'Button(BTN)';
  if (s === view.sbSeat) return 'Small Blind(SB)';
  if (s === view.bbSeat) return 'Big Blind(BB)';
  return `Seat ${s}`;
}

// User message = full public game state for this decision (spec 4.2).
export function serializeGameView(view, { recentHands = [], opponentStats = [] } = {}) {
  const hole = view.you.holeCards.map(cardToString).join(' ');
  const board = view.board.length ? view.board.map(cardToString).join(' ') : '(없음)';
  const opps = view.players.filter(p => p.seat !== view.you.seat)
    .map(p => `  - ${p.id} 좌석${p.seat}: 스택 ${p.stack}${p.folded ? ' (폴드)' : ''}${p.allIn ? ' (올인)' : ''}`).join('\n');
  const hist = (view.actionsThisHand || [])
    .map(a => `${a.street} 좌석${a.seat} ${a.type}${a.amount ? ' ' + a.amount : ''}`).join(', ') || '(없음)';
  const stats = opponentStats.length
    ? opponentStats.map(s => `  - ${s.id}: VPIP ${pct(s.vpip)}, PFR ${pct(s.pfr)}, AF ${num(s.af)}`).join('\n')
    : '  (데이터 없음)';
  const raiseRange = view.legal.canRaise ? `${view.legal.minRaiseTo} ~ ${view.legal.maxRaiseTo}` : '레이즈 불가';
  return [
    `[페이즈] ${view.state}`,
    `[내 홀카드] ${hole}`,
    `[보드] ${board}`,
    `[팟] ${view.potTotal}`,
    `[내 스택] ${view.you.stack}  [포지션] ${positionLabel(view)}`,
    `[콜 필요 금액] ${view.toCall}  [미니멈 레이즈(총액)] ${view.legal.minRaiseTo ?? '-'}  [레이즈 가능 범위] ${raiseRange}`,
    '[상대]', opps || '  (없음)',
    `[이번 핸드 베팅 히스토리] ${hist}`,
    '[최근 5핸드 요약]', recentHands.length ? '  ' + recentHands.join('\n  ') : '  (없음)',
    '[상대 통계]', stats,
    '위 상황에서 당신의 행동을 JSON으로만 답하십시오.',
  ].join('\n');
}
const pct = x => (x == null ? '-' : `${Math.round(x * 100)}%`);
const num = x => (x == null ? '-' : (Math.round(x * 100) / 100).toString());

// generateContent request body (spec 4.2): JSON-only output, temperature 0.9.
export function buildRequestBody(systemPrompt, userMessage) {
  return {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.9 },
  };
}

// Pull the model's text out of the Gemini response envelope.
export function extractText(json) {
  const t = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof t !== 'string' || !t.trim()) throw new GeminiError('parse', 'no text in response');
  return t;
}

// Parse the (possibly fence-wrapped) JSON the model returned.
export function parseDecisionJSON(text) {
  const cleaned = text.replace(/```json\s*|\s*```/g, '').trim();
  try { return JSON.parse(cleaned); }
  catch { throw new GeminiError('parse', 'decision JSON did not parse'); }
}

// Keep table talk short and non-toxic (spec 4.3 §4).
const BANNED = ['fuck', 'shit', 'bitch', 'asshole', '씨발', '시발', '개새끼', '병신'];
export function sanitizeTableTalk(raw) {
  if (typeof raw !== 'string') return '';
  let t = raw.trim().slice(0, 60);                       // 60-char cap
  for (const w of BANNED) t = t.split(new RegExp(w, 'gi')).join('***');
  return t;
}

// Validate the decision against the seat's legal actions and repair anything
// illegal to the nearest legal action; clamp raise size to [min, max] (spec 4.3 §2).
export function mapToAction(parsed, view) {
  const L = view.legal;
  let act = String(parsed?.action || '').toLowerCase();
  if (!['fold', 'check', 'call', 'raise'].includes(act)) act = L.canCheck ? 'check' : (L.toCall > 0 ? 'call' : 'check');

  if (act === 'raise' && !L.canRaise) act = L.toCall > 0 ? 'call' : 'check';
  if (act === 'check' && L.toCall > 0) act = 'call';
  if (act === 'call' && L.toCall === 0) act = 'check';
  if (act === 'fold' && L.toCall === 0) act = 'check';          // never fold for free

  const action = { type: ActionType[act.toUpperCase()] };
  if (act === 'raise') {
    const want = Number(parsed?.amount);
    action.amount = L.raiseAllInOnly ? L.maxRaiseTo
      : (Number.isFinite(want) ? clamp(Math.round(want), L.minRaiseTo, L.maxRaiseTo) : L.minRaiseTo);
  }
  if (typeof parsed?.reasoning === 'string' && parsed.reasoning.trim()) action.reasoning = parsed.reasoning.trim().slice(0, 200);
  const talk = sanitizeTableTalk(parsed?.tableTalk);
  if (talk) action.tableTalk = talk;
  action.source = 'llm';
  return action;
}

export class GeminiClient {
  constructor({ fetchImpl, model = GEMINI_MODEL, timeoutMs = 8000, backoffMs = 1000 } = {}) {
    this.fetchImpl = fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    this.model = model;
    this.timeoutMs = timeoutMs;     // spec 4.3 §1
    this.backoffMs = backoffMs;     // spec 4.3 §5
  }

  // Request one decision. Throws GeminiError on any failure (caught by 3b → fallback).
  async requestDecision(view, { name, personaDescription, apiKey, model = this.model, prompt = {} } = {}) {
    if (!apiKey) throw new GeminiError('nokey', 'no API key for this seat');     // spec 4.1
    if (!this.fetchImpl) throw new GeminiError('network', 'no fetch available');
    const url = buildEndpoint(model, apiKey);
    const body = JSON.stringify(buildRequestBody(buildSystemPrompt(name, personaDescription), serializeGameView(view, prompt)));

    for (let attempt = 0; attempt < 2; attempt++) {                              // one 429 retry
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      let res;
      try {
        res = await this.fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: ctrl.signal });
      } catch (e) {
        clearTimeout(timer);
        throw e?.name === 'AbortError' ? new GeminiError('timeout', `>${this.timeoutMs}ms`) : new GeminiError('network', e?.message);
      }
      clearTimeout(timer);

      if (res.status === 429) {                                                  // spec 4.3 §5
        if (attempt === 0) { await delay(this.backoffMs); continue; }
        throw new GeminiError('ratelimit', '429 after backoff retry');
      }
      if (!res.ok) throw new GeminiError('http', `HTTP ${res.status}`);

      let json;
      try { json = await res.json(); } catch { throw new GeminiError('parse', 'body not JSON'); }
      return mapToAction(parseDecisionJSON(extractText(json)), view);            // spec 4.3 §2
    }
  }
}
