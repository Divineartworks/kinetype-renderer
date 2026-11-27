// plan.heroOnce / plan.picture are caller opt-ins: absent, a window's spec is exactly what it always was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windowSpec } from '../src/cli/compose.js';

const plan = { video: 'v.mp4', look: 'marker' };
const win = { id: 'hook', role: 'hook', start: 0, end: 4, in: 0, out: 0, look: 'marker', energy: 'wild', heroes: [1.2] };
const words = [{ text: 'accessible', start: 0.5, end: 1 }, { text: 'twenty-four', start: 1.2, end: 1.9 }];
const spec = (p, w = win, extra = {}) => windowSpec(p, w, words, { fps: 30, format: { width: 1080, height: 1920, fps: 30 }, name: 'hook', ...extra });

test('heroOnce is off unless the plan (or the window) asks for it', () => {
  assert.equal(spec(plan).params.heroOnce, undefined);
  assert.equal(spec({ ...plan, heroOnce: true }).params.heroOnce, true);
  assert.equal(spec(plan, { ...win, heroOnce: true }).params.heroOnce, true);
  assert.deepEqual(spec(plan), spec({ ...plan, heroOnce: false }), 'a false flag changes nothing');
});

test('a cold open window renders on the picture when compose hands it one', () => {
  const cold = { ...win, id: 'cold', role: 'coldOpen', from: 30, to: 34, in: 0, out: 0 };
  const pic = { y0: 656, h: 608 };
  const s = spec(plan, cold, { pic, baseH: 1920, format: { width: 1080, height: pic.h, fps: 30 }, frame: { x: 0, y: 656 / 1920, w: 1, h: 608 / 1920 } });
  assert.equal(s.format.height, 608);
  assert.equal(s.media.ep.frame.h, 608 / 1920);
});

import { zonesFor, ZONE_LOOKS } from '../src/cli/compose.js';

test('letterboxed zones: top bar above the picture and bottom bar below it, both with the 24 px clearance at 1920 high', () => {
  const z = zonesFor({ y0: 656, y1: 1264, h: 608 }, 1920);
  assert.ok(z.top[1] * 1920 <= 656 - 24 && z.bottom[0] * 1920 >= 1264 + 24, JSON.stringify(z));
  assert.ok(z.bottom[1] <= 0.88, 'above the platform UI strip');
  assert.equal(zonesFor({ y0: 100, y1: 1800, h: 1700 }, 1920), null, 'no real bars: no zones (picture-only fallback)');
  assert.ok(ZONE_LOOKS.has('marker') && ZONE_LOOKS.has('cover') && !ZONE_LOOKS.has('poster'));
});

test('a zoned window passes the zones to the template and drops its plates; without zones nothing changes', () => {
  const zones = { top: [0, 0.3], bottom: [0.67, 0.86] };
  const w = { ...win, plates: [{ t: 1.2, plate: 'fire' }] };
  const z = spec({ ...plan, plates: 'auto' }, w, { zones });
  assert.deepEqual(z.params.zones, zones);
  assert.equal(z.params.plates, undefined);
  assert.equal(z.content.plates, undefined);
  assert.equal(spec(plan).params.zones, undefined);
});
