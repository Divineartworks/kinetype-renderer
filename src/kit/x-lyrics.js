// Lyric helpers shared by the lyric templates (word-timed lyrics, see
// docs/LYRICS_FORMAT.md). Pure functions only.

/** Words that read as connective tissue; lyric layouts set them small. */
export const FUNCTION_WORDS = new Set(
  'a an the of to in on at by for from with and or but nor so yet as if than that this these those i me my we us our you your he him his she her it its they them their is am are was were be been being do does did has have had not no when then like just'.split(' '),
);

export const wordKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9'’]/g, '').replace(/’/g, "'");

/** Normalise lyrics: sort, trim, derive line start/end from words, drop empties. */
export function normalizeLyrics(lyr) {
  if (!lyr || !Array.isArray(lyr.lines)) throw new Error('content.lyrics must be {lines:[{start,end,words:[{text,start,end}]}]} (see docs/LYRICS_FORMAT.md)');
  const lines = [];
  for (const l of lyr.lines) {
    const words = (l.words || [])
      .map((w) => ({ text: String(w.text).trim(), start: +w.start, end: +(w.end ?? w.start + 0.25), emph: !!w.emph }))
      .filter((w) => w.text && Number.isFinite(w.start))
      .sort((a, b) => a.start - b.start);
    for (const w of words) if (!(w.end > w.start)) w.end = w.start + 0.2;
    if (!words.length) continue;
    lines.push({ start: Math.min(+(l.start ?? words[0].start), words[0].start), end: Math.max(+(l.end ?? 0), words[words.length - 1].end), words });
  }
  lines.sort((a, b) => a.start - b.start);
  return { lines };
}

/** Index of the line on screen at time t (a line holds until the next one starts). */
export function lineAt(lines, t) {
  let idx = -1;
  for (let i = 0; i < lines.length; i++) if (t >= lines[i].start) idx = i;
  return idx;
}

/** Audio energy 0..1 at time t (linear interpolation), or null without analysis. */
export function energyAt(audio, t) {
  const e = audio?.energy;
  if (!e?.values?.length) return null;
  const i = (t - (e.t0 ?? 0)) / e.hop;
  if (i <= 0) return e.values[0];
  if (i >= e.values.length - 1) return e.values[e.values.length - 1];
  const k = Math.floor(i), f = i - k;
  return e.values[k] * (1 - f) + e.values[k + 1] * f;
}

/** Display form of a sung word: typographic apostrophes, optional edge punctuation strip. */
export function displayWord(text, { upper = true, strip = true } = {}) {
  let s = text.replace(/'/g, '’');
  if (strip) s = s.replace(/^[,.;:!?"“”]+|[,.;:"“”]+$/g, '');
  return upper ? s.toUpperCase() : s;
}

/** Percussive envelope with a ~25ms attack so punches read as hits, not jumps. */
export function punchEnv(beat, t, every = 1, decay = 7) {
  const bp = beat.b(t) / every;
  if (bp < 0) return 0;
  const n = Math.floor(bp);
  const since = t - beat.t(n * every);
  return Math.exp(-decay * since) * (1 - Math.exp(-since / 0.025));
}

import { hash, mulberry32 } from './rng.js';
const _tiles = new Map();
/**
 * Deterministic film grain on a CPU-backed tile. (K.grain's OffscreenCanvas
 * tile rendered differently on its first use — a GPU upload path — which made
 * the first frame order-dependent; a willReadFrequently canvas is plain memory.)
 */
export function filmGrain(g, w, h, { seed = 1, frame = 0, amount = 0.06, size = 256, mode = 'overlay' } = {}) {
  const key = seed + ':' + size;
  let tile = _tiles.get(key);
  if (!tile) {
    tile = document.createElement('canvas');
    tile.width = tile.height = size;
    const tg = tile.getContext('2d', { willReadFrequently: true });
    const img = tg.createImageData(size, size);
    const r = mulberry32(hash(seed, 'filmgrain'));
    for (let i = 0; i < size * size; i++) {
      const v = (r() * 255) | 0;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    tg.putImageData(img, 0, 0);
    _tiles.set(key, tile);
  }
  const ox = hash(seed, 'gx', frame) % size, oy = hash(seed, 'gy', frame) % size;
  g.save();
  g.globalAlpha = amount;
  g.globalCompositeOperation = mode;
  for (let y = -oy; y < h; y += size) for (let x = -ox; x < w; x += size) g.drawImage(tile, x, y);
  g.restore();
}
