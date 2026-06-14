// sound.js — synthesised sounds (spec 3.5: Web Audio, toggle). soundSpec is a
// pure descriptor (testable); SoundBoard lazily builds an AudioContext and plays
// specs, honouring a mute toggle. No external audio assets.

export function soundSpec(name) {
  switch (name) {
    case 'cardSlide': return { kind: 'noise', duration: 0.12, filter: { type: 'highpass', freq: 1200 }, gain: 0.18 };
    case 'deal': return { kind: 'noise', duration: 0.08, filter: { type: 'bandpass', freq: 2000 }, gain: 0.12 };
    case 'chip': return { kind: 'clicks', count: 3, spread: 0.03, freq: [1800, 2600], dur: 0.04, gain: 0.15 };
    case 'win': return { kind: 'tones', notes: [523, 659, 784, 1047], noteMs: 120, gain: 0.2 };
    default: return null;
  }
}

function renderSound(ctx, spec) {
  const now = ctx.currentTime ?? 0;
  const out = ctx.createGain?.();
  out?.connect?.(ctx.destination);
  if (out?.gain?.setValueAtTime) out.gain.setValueAtTime(spec.gain ?? 0.15, now);

  if (spec.kind === 'noise') {
    const sr = ctx.sampleRate || 44100, n = Math.floor(sr * spec.duration);
    const buf = ctx.createBuffer?.(1, Math.max(1, n), sr);
    const data = buf?.getChannelData?.(0);
    if (data) for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource?.(); if (src) src.buffer = buf;
    if (spec.filter && ctx.createBiquadFilter) { const f = ctx.createBiquadFilter(); f.type = spec.filter.type; f.frequency?.setValueAtTime?.(spec.filter.freq, now); src?.connect?.(f); f.connect?.(out); }
    else src?.connect?.(out);
    src?.start?.(now); src?.stop?.(now + spec.duration);
  } else if (spec.kind === 'clicks') {
    for (let i = 0; i < spec.count; i++) {
      const t = now + i * spec.spread, o = ctx.createOscillator?.();
      o?.frequency?.setValueAtTime?.(spec.freq[0] + Math.random() * (spec.freq[1] - spec.freq[0]), t);
      o?.connect?.(out); o?.start?.(t); o?.stop?.(t + spec.dur);
    }
  } else if (spec.kind === 'tones') {
    spec.notes.forEach((f, i) => {
      const t = now + i * spec.noteMs / 1000, o = ctx.createOscillator?.();
      o?.frequency?.setValueAtTime?.(f, t); o?.connect?.(out); o?.start?.(t); o?.stop?.(t + spec.noteMs / 1000);
    });
  }
}

function defaultCtxFactory() {
  const C = typeof AudioContext !== 'undefined' ? AudioContext : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null);
  return C ? () => new C() : null;
}

export class SoundBoard {
  constructor({ ctxFactory, muted = false } = {}) { this.muted = !!muted; this._factory = ctxFactory; this.ctx = null; }
  setMuted(m) { this.muted = !!m; }
  _ensure() {
    if (this.muted) return null;
    if (!this.ctx) {
      const make = this._factory || defaultCtxFactory();   // a factory returning an AudioContext
      this.ctx = make ? make() : null;
    }
    return this.ctx;
  }
  play(name) {
    if (this.muted) return false;
    const spec = soundSpec(name), ctx = this._ensure();
    if (!ctx || !spec) return false;
    try { renderSound(ctx, spec); } catch { return false; }
    return true;
  }
}
