// Deterministic variation: random draws and breeding of preset params, all through src/kit/rng.js.
import { rng, hash } from '../kit/rng.js';
import * as presets from './presets/index.js';

const r4 = (x) => Math.round(x * 1e4) / 1e4;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** Params drawn uniformly inside each param's [min, max]. */
function drawParams(meta, rand) {
  const out = {};
  for (const [name, def] of Object.entries(meta.params)) out[name] = r4(def.min + rand() * (def.max - def.min));
  return out;
}

/**
 * count entries of { preset, seed, params }. Same (count, seed, presets) -> same list.
 * Default pool: the generative presets (living-still needs images, name it to include it).
 */
export function randomize({ count = 5, seed = 1, presets: pool } = {}) {
  const ids = pool?.length ? pool : presets.list().filter((m) => m.family === 'generative').map((m) => m.id);
  for (const id of ids) presets.get(id);
  const out = [];
  for (let i = 0; i < count; i++) {
    const rand = rng(seed, 'randomize', i);
    const preset = ids[Math.floor(rand() * ids.length)];
    out.push({ preset, seed: 1 + Math.floor(rand() * 999999), params: drawParams(presets.metaOf(preset), rand) });
  }
  return out;
}

/** Child of two entries of the same preset: uniform crossover plus a small mutation, always inside the ranges. */
export function breed(a, b, seed = 1) {
  if (a.preset !== b.preset) throw new Error(`cannot breed different presets (${a.preset} x ${b.preset})`);
  const meta = presets.metaOf(a.preset);
  const rand = rng(seed, 'breed', a.preset, a.seed, b.seed);
  const params = {};
  for (const [name, def] of Object.entries(meta.params)) {
    const pa = a.params?.[name] ?? def.default, pb = b.params?.[name] ?? def.default;
    let v = rand() < 0.5 ? pa : pb;
    if (rand() < 0.3) v += (rand() - 0.5) * 0.1 * (def.max - def.min);
    params[name] = r4(clamp(v, def.min, def.max));
  }
  return { preset: a.preset, seed: 1 + (hash(seed, a.seed, b.seed) % 999999), params };
}
