// Background plates: the world BEHIND the speaker transforms on a hero word
// (fire when he says "fire", shattering glass on "divorce"…) while the person
// matte keeps him in front — a green screen without the green. Procedural,
// deterministic, seek-pure. Also: any b-roll video as a plate ({media: id}).
import fire from './fire.js';
import storm from './storm.js';
import rain from './rain.js';
import shatter from './shatter.js';
import heartbeat from './heartbeat.js';
import money from './money.js';
import time from './time.js';
import voidPlate from './void.js';
import spotlight from './spotlight.js';
import bokeh from './bokeh.js';
import * as U from './util.js';

export const PLATES = Object.fromEntries([fire, storm, rain, shatter, heartbeat, money, time, voidPlate, spotlight, bokeh].map((p) => [p.id, p]));
export const PLATE_IDS = Object.keys(PLATES);
const CONCEPT = new Map();
for (const p of Object.values(PLATES)) for (const c of p.concepts) if (!CONCEPT.has(c)) CONCEPT.set(c, p.id);

/** The plate a spoken word calls for, or null. Pure: usable by the director. */
export function plateFor(word) {
  const w = String(word || '').toLowerCase().replace(/[^a-z'’-]/g, '').replace(/['’]s$/, '');
  if (!w) return null;
  if (CONCEPT.has(w)) return CONCEPT.get(w);
  for (const suf of ['ness', 'ing', 'ed', 'es', 's', 'ly', 'er']) {
    if (w.length > suf.length + 2 && w.endsWith(suf)) {
      const stem = w.slice(0, -suf.length);
      if (CONCEPT.has(stem)) return CONCEPT.get(stem);
      if (CONCEPT.has(stem + 'e')) return CONCEPT.get(stem + 'e');
    }
  }
  return null;
}

/** Draw plate `id` full-frame at time t, progress u (0..1) through the moment. */
export function drawPlate(g, id, t, u, env) {
  const p = PLATES[id];
  if (!p) return;
  g.save();
  p.draw(g, t, u, { ...env, K: env.K, U });
  g.restore();
  // every plate ends with a vignette so the speaker pops off it
  U.vignette(g, env.W, env.H, 0.32);
}
