// Reusable looks. Each is a pure function of its inputs (time included).
import { hash, mulberry32, shuffle } from './rng.js';

/**
 * Print misregistration: redraw a layer in two ink colours at small opposed
 * offsets under the key layer. `draw(fillOverride|null)` must draw the layer.
 * amount 0..1 scales the offset (use a beat pulse so it only fires on impacts).
 */
export function misregister(g, draw, { a, b, amount = 1, offset = 3, angle = -0.35, alpha = 0.4, mode = 'lighten' }) {
  if (amount > 0.02) {
    const dx = Math.cos(angle) * offset * amount, dy = Math.sin(angle) * offset * amount;
    // 'lighten' keeps the two inks from mixing into a third hue where they
    // overlap (m ∨ g → near-white), which is how light inks read on black.
    for (const [col, sgn] of [[a, 1], [b, -1]]) {
      g.save();
      g.globalAlpha = alpha;
      g.globalCompositeOperation = mode;
      g.translate(Math.round(dx * sgn * 2) / 2, Math.round(dy * sgn * 2) / 2);
      draw(col);
      g.restore();
    }
  }
  draw(null);
}

/**
 * Deterministic glyph scramble. Before `lockAt`, slot `slot` cycles through a
 * seeded Fisher–Yates permutation of `charset`, stepping every `step` seconds.
 * Returns the character to draw at time t.
 */
export function scrambleChar(seed, slot, target, t, lockAt, { charset, step = 1 / 30, startAt = -Infinity } = {}) {
  if (t >= lockAt || t < startAt) return target;
  const pool = charset || 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const perm = shuffle([...pool], mulberry32(hash(seed, 'scr', slot)));
  const n = Math.floor((t - (startAt === -Infinity ? 0 : startAt)) / step);
  let c = perm[((n % perm.length) + perm.length) % perm.length];
  if (c === target && perm.length > 1) c = perm[(n + 1) % perm.length];
  return c;
}

/** Number of characters typed by time t at `cps` chars/sec (+ optional per-char jitter). */
export function typed(text, t, t0, cps = 24, seed = 0) {
  if (t < t0) return 0;
  const chars = [...text];
  let acc = t0;
  for (let i = 0; i < chars.length; i++) {
    const j = seed ? 0.55 + 0.9 * (hash(seed, 'type', i) / 4294967296) : 1;
    acc += j / cps;
    if (t < acc) return i;
  }
  return chars.length;
}

/** Blinking terminal caret on a 1/2-beat clock: returns true when visible. */
export const caretOn = (t, period = 0.5) => Math.floor(t / (period / 2)) % 2 === 0;

let _grain = new Map();
/**
 * Film/print grain from a seeded tile, positioned by frame index so it is
 * stable per frame and changes between frames. Never Math.random.
 */
export function grain(g, w, h, { seed = 1, frame = 0, amount = 0.06, size = 256, mode = 'overlay' } = {}) {
  const key = seed + ':' + size;
  let tile = _grain.get(key);
  if (!tile) {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : document.createElement('canvas');
    c.width = c.height = size;
    const cg = c.getContext('2d', { willReadFrequently: true }); // CPU-backed: same raster path as the stage
    const img = cg.createImageData(size, size);
    const r = mulberry32(hash(seed, 'grain'));
    for (let i = 0; i < size * size; i++) {
      const v = (r() * 255) | 0;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    cg.putImageData(img, 0, 0);
    tile = c;
    _grain.set(key, tile);
  }
  const ox = hash(seed, 'gx', frame) % size, oy = hash(seed, 'gy', frame) % size;
  g.save();
  g.globalAlpha = amount;
  g.globalCompositeOperation = mode;
  for (let y = -oy; y < h; y += size) for (let x = -ox; x < w; x += size) g.drawImage(tile, x, y);
  g.restore();
}

/** Axis-aligned bar helper with pixel snapping for crisp edges. */
export function bar(g, x, y, w, h, fill) {
  if (w <= 0 || h <= 0) return;
  g.fillStyle = fill;
  g.fillRect(Math.round(x * 2) / 2, Math.round(y * 2) / 2, Math.round(w * 2) / 2, Math.round(h * 2) / 2);
}
