// Preset registry. A preset module exports FRAG (GLSL body appended to glsl/common.js) and `meta`.
import crypto from 'node:crypto';
import { COMMON } from '../glsl/common.js';
import * as aurora from './aurora-veil.js';
import * as mandala from './breath-mandala.js';
import * as cosmos from './cosmos-drift.js';
import * as living from './living-still.js';

const MODULES = [aurora, mandala, cosmos, living];
const REGISTRY = new Map(MODULES.map((m) => [m.meta.id, m]));

export function ids() { return [...REGISTRY.keys()]; }

export function get(id) {
  const m = REGISTRY.get(id);
  if (!m) throw new Error(`unknown ambient preset "${id}"; available: ${ids().join(', ')}`);
  return m;
}

export const metaOf = (id) => get(id).meta;

/** Registry summary for `kinetype ambient list`. */
export function list() {
  return MODULES.map(({ meta }) => ({ ...meta, params: Object.fromEntries(Object.entries(meta.params).map(([k, v]) => [k, { ...v }])) }));
}

/** The exact source the page compiles (page.js: COMMON + '\n' + FRAG). */
export const compiledSource = (id) => COMMON + '\n' + get(id).FRAG;
export const fragSha256 = (id) => crypto.createHash('sha256').update(compiledSource(id)).digest('hex');

/** Named params (missing ones take meta defaults) -> the six vec4 uniforms u_p0..u_p5. Unknown names are an error. */
export function paramVectors(id, values = {}) {
  const { params } = metaOf(id);
  for (const k of Object.keys(values)) if (!(k in params)) throw new Error(`preset ${id} has no param "${k}" (has: ${Object.keys(params).join(', ') || 'none'})`);
  const p = Array.from({ length: 6 }, () => [0, 0, 0, 0]);
  for (const [name, def] of Object.entries(params)) {
    const m = /^u_p([0-5])\.([xyzw])$/.exec(def.uniform);
    if (!m) throw new Error(`preset ${id} param ${name}: bad uniform "${def.uniform}"`);
    p[+m[1]]['xyzw'.indexOf(m[2])] = values[name] ?? def.default;
  }
  return p;
}

/** Defaults for every named param. */
export const defaultParams = (id) => Object.fromEntries(Object.entries(metaOf(id).params).map(([k, v]) => [k, v.default]));
