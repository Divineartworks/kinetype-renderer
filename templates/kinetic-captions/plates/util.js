// Shared helpers for background plates: seeded value noise, low-res CPU fields
// scaled up (a plate is a soft, out-of-focus world behind the speaker, so a
// 96-px-wide field drawn smoothly at 1080 wide reads as depth of field), and
// deterministic particles. Everything is a pure function of (seed, t, u).
import { mulberry32, hash } from '../../../src/kit/rng.js';

const LAT = 256;
const lattices = new Map();
/** A 256² table of seeded values in [0,1). */
export function lattice(seed) {
  let tab = lattices.get(seed);
  if (!tab) {
    const r = mulberry32(hash('plate-lattice', seed));
    tab = new Float32Array(LAT * LAT);
    for (let i = 0; i < tab.length; i++) tab[i] = r();
    lattices.set(seed, tab);
  }
  return tab;
}
const fade = (x) => x * x * (3 - 2 * x);
/** Smooth value noise in [0,1). */
export function noise2(tab, x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = fade(x - xi), fy = fade(y - yi);
  const x0 = xi & 255, y0 = yi & 255, x1 = (x0 + 1) & 255, y1 = (y0 + 1) & 255;
  const a = tab[y0 * LAT + x0], b = tab[y0 * LAT + x1], c = tab[y1 * LAT + x0], d = tab[y1 * LAT + x1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
/** Fractal noise, normalised to ~[0,1). */
export function fbm(tab, x, y, oct = 4) {
  let s = 0, amp = 0.5, norm = 0, f = 1;
  for (let o = 0; o < oct; o++) { s += amp * noise2(tab, x * f + o * 17.3, y * f + o * 9.1); norm += amp; amp *= 0.5; f *= 2.03; }
  return s / norm;
}

const scratch = new Map();
/** A CPU-backed scratch canvas (deterministic readback), cached by key. */
export function canvas(key, w, h) {
  let s = scratch.get(key);
  if (!s || s.c.width !== w || s.c.height !== h) {
    const c = new OffscreenCanvas(w, h);
    const g = c.getContext('2d', { willReadFrequently: true });
    s = { c, g, img: g.createImageData(w, h) };
    scratch.set(key, s);
  }
  return s;
}
/** Fill a low-res field: fn(nx, ny) → [r, g, b] (0..255), returns the canvas. */
export function field(key, w, h, fn) {
  const s = canvas(key, w, h);
  const d = s.img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = fn((x + 0.5) / w, (y + 0.5) / h);
    const i = (y * w + x) * 4;
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
  }
  s.g.putImageData(s.img, 0, 0);
  return s.c;
}
/** Draw a small canvas stretched over the frame, smoothly. */
export function blit(g, c, W, H) {
  g.save();
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(c, 0, 0, W, H);
  g.restore();
}
/** Colour ramp: stops [[pos, [r,g,b]], …], x in 0..1. */
export function ramp(stops, x) {
  if (x <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [p1, c1] = stops[i];
    if (x <= p1) {
      const [p0, c0] = stops[i - 1];
      const k = (x - p0) / (p1 - p0 || 1);
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
    }
  }
  return stops[stops.length - 1][1];
}
export const hex = (h) => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const rgba = (c, a) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
/** Soft radial glow. */
export function glow(g, x, y, r, c, a) {
  if (a <= 0.002 || r <= 0) return;
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, rgba(c, a));
  gr.addColorStop(0.4, rgba(c, a * 0.45));
  gr.addColorStop(1, rgba(c, 0));
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, 2 * r, 2 * r);
}
/** Deterministic per-particle random in [0,1). */
export const rnd = (seed, id, i, k) => hash(seed, id, i, k) / 4294967296;
/** Vertical gradient fill of the whole frame. */
export function sky(g, W, H, stops) {
  const gr = g.createLinearGradient(0, 0, 0, H);
  for (const [p, c] of stops) gr.addColorStop(p, typeof c === 'string' ? c : rgba(c, 1));
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
}
/** Dark vignette so the speaker pops off the plate. */
export function vignette(g, W, H, a = 0.55) {
  const gr = g.createRadialGradient(W / 2, H * 0.42, Math.min(W, H) * 0.3, W / 2, H * 0.42, Math.hypot(W, H) * 0.62);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, `rgba(0,0,0,${a})`);
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
}
export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const fract = (x) => x - Math.floor(x);
