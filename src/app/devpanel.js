// devpanel.js — the developer-mode panel (spec 2.4): turn a CognitiveAI decision
// `trace` into a readable view-model (equity, prospect value v(x), tilt, the
// estimated opponent range, and the action distribution) and render it. Pure.

const pct = x => (x == null ? '\u2014' : Math.round(x * 100) + '%');
const r2 = x => (x == null || x === -Infinity ? '\u2014' : Math.round(x * 100) / 100);

export function formatTrace(trace, { source = 'builtin' } = {}) {
  if (!trace) return { source, available: false };
  const d = trace.distribution || {};
  return {
    source, available: true,
    equity: pct(trace.equity),
    equityVsRandom: pct(trace.equityVsRandom),
    equityVsRange: trace.equityVsRange == null ? '\u2014' : pct(trace.equityVsRange),
    potOdds: pct(trace.potOdds),
    tilt: pct(trace.tilt),
    system2: pct(trace.system2Weight),
    pv: { fold: r2(trace.pv && trace.pv.fold), passive: r2(trace.pv && trace.pv.passive), aggressive: r2(trace.pv && trace.pv.aggressive) },
    rangeTop: (trace.estRangeTopHands || []).slice(0, 6),
    distribution: { fold: pct(d.fold), passive: pct(d.passive), aggressive: pct(d.aggressive) },
    chosen: trace.chosen || '\u2014',
  };
}

// rows: [{ name, source, trace }]
export function devPanelHTML(rows = []) {
  const card = ({ name, source, trace }) => {
    const vm = formatTrace(trace, { source });
    if (!vm.available) return `<div class="dev-seat"><div class="dev-name">${name}</div><div class="dev-empty">${source === 'gemini' ? 'Gemini (no local trace)' : 'no decision yet'}</div></div>`;
    const bar = (label, value) => `<div class="dev-row"><span>${label}</span><b>${value}</b></div>`;
    return `<div class="dev-seat">
      <div class="dev-name">${name}${source === 'gemini' ? ' \u00b7 LLM' : ''} <span class="dev-chosen">${vm.chosen}</span></div>
      ${bar('equity', vm.equity)}${bar('eq vs range', vm.equityVsRange)}${bar('pot odds', vm.potOdds)}
      ${bar('tilt', vm.tilt)}${bar('System 2', vm.system2)}
      ${bar('v(x) f/c/r', vm.pv.fold + ' / ' + vm.pv.passive + ' / ' + vm.pv.aggressive)}
      ${bar('P(f/c/r)', vm.distribution.fold + ' / ' + vm.distribution.passive + ' / ' + vm.distribution.aggressive)}
      <div class="dev-row"><span>range</span><b class="dev-range">${vm.rangeTop.join(' ') || '\u2014'}</b></div>
    </div>`;
  };
  return `<div class="devpanel"><div class="dev-title">Developer mode</div>${rows.map(card).join('')}</div>`;
}
