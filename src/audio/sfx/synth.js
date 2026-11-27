// Procedural UI sound design. Pure + deterministic: same args -> identical bytes.
// 48 kHz mono Float32Array, every generator seeded through kit/rng. No samples, no Math.random.
import { hash, mulberry32 } from '../../kit/rng.js';

export const SR = 48000;
const TAU = Math.PI * 2;
const prng = (...k) => mulberry32(hash(...k));
const len = (sec) => Math.max(1, Math.round(sec * SR));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const noise = (r, n) => { const x = new Float64Array(n); for (let i = 0; i < n; i++) x[i] = r() * 2 - 1; return x; };

/** TPT state-variable filter; fc may be a number or fn(i)->Hz (time-varying). mode: bp|lp|hp. */
function svf(x, fc, q, mode = 'bp') {
  const n = x.length, y = new Float64Array(n), k = 1 / q;
  let s1 = 0, s2 = 0;
  for (let i = 0; i < n; i++) {
    const f = typeof fc === 'function' ? fc(i) : fc;
    const g = Math.tan(Math.PI * clamp(f, 20, SR * 0.45) / SR);
    const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    const v3 = x[i] - s2, v1 = a1 * s1 + a2 * v3, v2 = s2 + a2 * s1 + a3 * v3;
    s1 = 2 * v1 - s1; s2 = 2 * v2 - s2;
    y[i] = mode === 'lp' ? v2 : mode === 'hp' ? x[i] - k * v1 - v2 : k * v1;
  }
  return y;
}

/** Remove DC, 2 ms raised-cosine fades, scale to a given peak, return Float32Array. */
function finish(x, peak = 0.9) {
  const n = x.length;
  let px = 0, py = 0;
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) { py = x[i] - px + 0.9975 * py; px = x[i]; y[i] = py; } // DC blocker
  const nf = Math.min(Math.round(0.002 * SR), n >> 1);
  for (let i = 0; i < nf; i++) { const w = 0.5 - 0.5 * Math.cos(Math.PI * i / nf); y[i] *= w; y[n - 1 - i] *= w; }
  let m = 0, mx = 0;
  for (let i = 0; i < n; i++) m += y[i];
  m /= n;
  for (let i = 0; i < n; i++) { y[i] -= m * (i < nf || i >= n - nf ? 0 : 1); mx = Math.max(mx, Math.abs(y[i])); }
  const out = new Float32Array(n), s = mx > 0 ? peak / mx : 0;
  for (let i = 0; i < n; i++) out[i] = y[i] * s;
  return out;
}

/** Add a decaying sine partial with raised-cosine attack into buf (additive). */
function partial(buf, t0, f, amp, tau, att = 0.003, glide = 0) {
  const i0 = Math.round(t0 * SR);
  let ph = 0;
  for (let i = i0; i < buf.length; i++) {
    const t = (i - i0) / SR;
    if (t > tau * 9) break;
    const fi = f * (1 + glide * Math.exp(-t / 0.004));
    ph += TAU * fi / SR;
    const a = t < att ? 0.5 - 0.5 * Math.cos(Math.PI * t / att) : 1;
    buf[i] += amp * a * Math.exp(-t / tau) * Math.sin(ph);
  }
}
/** Add a noise burst: exp-decay envelope with fast attack. */
function burst(buf, sig, t0, amp, tau, att = 0.0004) {
  const i0 = Math.round(t0 * SR);
  for (let i = 0; i < sig.length && i + i0 < buf.length; i++) {
    const t = i / SR;
    buf[i + i0] += sig[i] * amp * Math.exp(-t / tau) * (t < att ? t / att : 1);
  }
}

// ---------------------------------------------------------------- sounds
/** Soft tick: filtered noise + tiny low body thump. ~40 ms. */
export function tap(seed = 1) {
  const r = prng(seed, 'tap'), n = len(0.045), b = new Float64Array(n);
  const fc = 1900 * (1 + 0.1 * (r() - 0.5)), f0 = 215 * (1 + 0.12 * (r() - 0.5));
  burst(b, svf(noise(r, n), fc, 0.9), 0, 1, 0.0055);
  partial(b, 0, f0, 0.55, 0.006, 0.0006, 0.35);
  return finish(svf(b, 6500, 0.7, 'lp'), 0.9);
}

const keyKind = (ch) => {
  const c = String(ch ?? '');
  if (c === ' ' || c === 'space') return 'space';
  if (c === '\b' || c === '⌫' || /^backspace$/i.test(c)) return 'back';
  if (c === '\n' || c === '⏎' || /^(enter|return)$/i.test(c)) return 'enter';
  return 'key';
};
/** Keyboard click; per-char variation of pitch, brightness, decay. space softer/lower, back/enter heavier. */
export function key(seed = 1, ch = 'a') {
  const kind = keyKind(ch), r = prng(seed, 'key', ch), j = [r(), r(), r(), r(), r()];
  const P = {
    key:   { dur: 0.026, fc: 1700 + 1500 * j[0], q: 1.1, nTau: 0.0032 * (0.8 + 0.5 * j[1]), f: 310 + 130 * j[2], bAmp: 0.45, bTau: 0.0045, up: 0.25 },
    space: { dur: 0.034, fc: 1100 + 500 * j[0], q: 0.8, nTau: 0.0045 * (0.8 + 0.4 * j[1]), f: 150 + 30 * j[2], bAmp: 0.7, bTau: 0.008, up: 0.15 },
    back:  { dur: 0.034, fc: 1900 + 700 * j[0], q: 0.9, nTau: 0.004 * (0.8 + 0.4 * j[1]), f: 190 + 40 * j[2], bAmp: 0.8, bTau: 0.007, up: 0.2 },
    enter: { dur: 0.035, fc: 1700 + 600 * j[0], q: 0.9, nTau: 0.0042 * (0.8 + 0.4 * j[1]), f: 170 + 30 * j[2], bAmp: 0.9, bTau: 0.0075, up: 0.22 },
  }[kind];
  const n = len(P.dur), b = new Float64Array(n);
  burst(b, svf(noise(r, n), P.fc, P.q), 0, 1, P.nTau, 0.0003);
  partial(b, 0, P.f, P.bAmp, P.bTau, 0.0005, 0.25);
  const rel = 0.0155 + 0.003 * j[3]; // key-up: smaller click
  burst(b, svf(noise(r, n), P.fc * 1.3, P.q), rel, P.up, P.nTau * 0.7, 0.0003);
  return finish(svf(b, 6000, 0.7, 'lp'), 0.9);
}

/** Soft air whoosh: band-passed noise, swept centre frequency, smooth envelope. dur 0.15-0.6 s. */
export function swipe(seed = 1, dur = 0.3, dir = 1) {
  const d = clamp(dur, 0.15, 0.6), r = prng(seed, 'swipe'), n = len(d);
  const lo = 450 * (1 + 0.1 * (r() - 0.5)), hi = 2600 * (1 + 0.1 * (r() - 0.5));
  const sm = (u) => u * u * (3 - 2 * u);
  const x = svf(noise(r, n), (i) => { const u = sm(i / n); return dir >= 0 ? lo + (hi - lo) * u : hi + (lo - hi) * u; }, 0.8);
  for (let i = 0; i < n; i++) { const u = i / n; x[i] *= Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 2); }
  return finish(svf(x, 5500, 0.7, 'lp'), 0.9);
}

/** Refined two-note chime E6 -> B6, sine partials + gentle inharmonic shimmer. ~0.75 s. */
export function notify(seed = 1) {
  const r = prng(seed, 'notify'), b = new Float64Array(len(0.75));
  const note = (t0, f, tau) => {
    partial(b, t0, f, 1, tau, 0.004);
    partial(b, t0, f * 1.0025, 0.35, tau * 1.1, 0.004);   // slow beating shimmer
    partial(b, t0, f * 2, 0.16, tau * 0.55, 0.003);
    partial(b, t0, f * 2.76, 0.05, tau * 0.3, 0.002);     // inharmonic sparkle
  };
  note(0, 1318.5 * (1 + 0.002 * (r() - 0.5)), 0.17);
  note(0.135, 1975.5 * (1 + 0.002 * (r() - 0.5)), 0.24);
  return finish(b, 0.9);
}

/** Small bright rising figure C6-E6-G6 (+ soft top octave). <= 0.65 s. */
export function success(seed = 1) {
  const r = prng(seed, 'success'), b = new Float64Array(len(0.65));
  const fs = [1046.5, 1318.5, 1568.0], ts = [0.0, 0.07, 0.14], taus = [0.09, 0.1, 0.2];
  fs.forEach((f, i) => {
    f *= 1 + 0.002 * (r() - 0.5);
    partial(b, ts[i], f, 1, taus[i], 0.003);
    partial(b, ts[i], f * 1.003, 0.3, taus[i], 0.003);
    partial(b, ts[i], f * 2, 0.2, taus[i] * 0.5, 0.002);
  });
  partial(b, 0.14, 2093.0, 0.35, 0.22, 0.004); // octave sparkle under the last note
  return finish(b, 0.9);
}

/** Very short metallic counter tick. ~20 ms. */
export function tick(seed = 1) {
  const r = prng(seed, 'tick'), n = len(0.02), b = new Float64Array(n);
  const j = 1 + 0.06 * (r() - 0.5);
  partial(b, 0, 3300 * j, 0.7, 0.0016, 0.0003);
  partial(b, 0, 5000 * j, 0.25, 0.0012, 0.0003);
  burst(b, svf(noise(r, n), 4000, 1.0, 'hp'), 0, 0.2, 0.0015, 0.0002);
  return finish(svf(b, 9000, 0.7, 'lp'), 0.9);
}

/** Soft bright coin ping: short grace note then a ring. ~0.4 s. */
export function coin(seed = 1) {
  const r = prng(seed, 'coin'), b = new Float64Array(len(0.4));
  const j = 1 + 0.004 * (r() - 0.5);
  partial(b, 0, 1976 * j, 0.5, 0.03, 0.0015);
  partial(b, 0.055, 2637 * j, 1, 0.11, 0.0015);
  partial(b, 0.055, 2637 * j * 2.41, 0.12, 0.05, 0.001);
  partial(b, 0.055, 2637 * j * 1.003, 0.3, 0.12, 0.0015);
  return finish(b, 0.9);
}

/** Very soft air for cuts: slow downward-swept filtered noise. */
export function whooshCut(seed = 1, dur = 0.35) {
  const d = clamp(dur, 0.15, 0.6), r = prng(seed, 'whoosh-cut'), n = len(d);
  const x = svf(noise(r, n), (i) => 1700 - 1100 * (i / n), 0.55);
  for (let i = 0; i < n; i++) x[i] *= Math.pow(Math.sin(Math.PI * i / n), 2);
  return finish(svf(x, 3000, 0.7, 'lp'), 0.9);
}

/** Registry. gen(seed, opts) -> Float32Array; gain = default linear level relative to the others. */
export const SOUNDS = {
  tap:          { name: 'tap', description: 'soft UI tap tick (noise burst + low body)', gain: 0.55, gen: (s) => tap(s) },
  key:          { name: 'key', description: 'keyboard click, per-char variation; space/backspace/enter variants', gain: 0.4, gen: (s, o = {}) => key(s, o.ch) },
  swipe:        { name: 'swipe', description: 'soft air whoosh for swipes/scrolls (0.15-0.6 s)', gain: 0.35, gen: (s, o = {}) => swipe(s, o.dur ?? 0.3, o.dir ?? 1) },
  notify:       { name: 'notify', description: 'refined two-note chime E6->B6', gain: 0.6, gen: (s) => notify(s) },
  success:      { name: 'success', description: 'bright small rising figure C6-E6-G6', gain: 0.6, gen: (s) => success(s) },
  tick:         { name: 'tick', description: 'subtle metallic counter tick', gain: 0.3, gen: (s) => tick(s) },
  coin:         { name: 'coin', description: 'soft bright coin ping', gain: 0.5, gen: (s) => coin(s) },
  'whoosh-cut': { name: 'whoosh-cut', description: 'very soft transition air for cuts', gain: 0.2, gen: (s, o = {}) => whooshCut(s, o.dur ?? 0.35) },
};
