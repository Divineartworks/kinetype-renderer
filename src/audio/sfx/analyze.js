// Tiny analysis helpers: peak dBFS, duration, spectral centroid (Hann-windowed magnitude FFT).
import { SR } from './synth.js';

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let l = 2; l <= n; l <<= 1) {
    const a = -2 * Math.PI / l;
    for (let i = 0; i < n; i += l) for (let k = 0; k < l / 2; k++) {
      const c = Math.cos(a * k), s = Math.sin(a * k), u = i + k, v = u + l / 2;
      const tr = re[v] * c - im[v] * s, ti = re[v] * s + im[v] * c;
      re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti;
    }
  }
}

export function analyze(x, sr = SR) {
  let pk = 0, sum = 0;
  for (const v of x) { pk = Math.max(pk, Math.abs(v)); sum += v; }
  let n = 1; while (n < x.length * 2) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < x.length; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (x.length - 1 || 1)));
  fft(re, im);
  let num = 0, den = 0;
  for (let k = 1; k < n / 2; k++) { const m = Math.hypot(re[k], im[k]); num += m * k * sr / n; den += m; }
  return { dur: x.length / sr, peakDb: 20 * Math.log10(pk || 1e-9), centroid: den ? num / den : 0, dc: sum / x.length };
}
