import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawFrameShadow, SHADOW_LAYERS } from '../src/kit/x-ui.js';

// Film polish lane 3: the shadow of a product tile lost its blur tail on the left (hard dark slab) when the shape was
// drawn 10000 px off-canvas with a 10000 px shadow offset. The shape now sits in an even-odd clip hole of its own size.
test('drawFrameShadow: no off-canvas offset trick; shape clipped out with an even-odd hole, one shadow per layer', () => {
  const log = [], sets = [];
  const g = new Proxy({}, {
    get: (_t, k) => (...a) => { log.push([k, a]); },
    set: (_t, k, v) => { sets.push([k, v]); return true; },
  });
  drawFrameShadow(g, { x: 100, y: 50, w: 400, h: 300 }, 12, 1, 1.8);
  assert.equal(log.filter(([k]) => k === 'clip' && log[0] && true).length, SHADOW_LAYERS.length);
  assert.ok(log.some(([k, a]) => k === 'clip' && a[0] === 'evenodd'));
  const xs = sets.filter(([k]) => k === 'shadowOffsetX').map(([, v]) => v);
  assert.ok(xs.length === SHADOW_LAYERS.length && xs.every((v) => v === 0), `shadowOffsetX ${xs}`);
  assert.equal(log.filter(([k]) => k === 'save').length, log.filter(([k]) => k === 'restore').length);
});
