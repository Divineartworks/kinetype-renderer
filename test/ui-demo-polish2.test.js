import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as X from '../src/kit/x-ui.js';

// Polish-2 judge defects: side-cropped text, plates over neighbours, dark dips, still stat cards.
const content = { x: 0, y: 0, w: 1440, h: 900 };
const mk = (context, extra = {}) => X.makeView({ content, viewW: 1440, viewH: 900, zMax: 2.4, context, ...extra });

test('camera: frame() never leaves a recorded element sliced at a side edge (relaxes the zoom)', () => {
  // a dense row of text cells: every candidate window edge lands inside some cell
  const context = [];
  for (let i = 0; i < 40; i++) context.push({ x: 20 + i * 35, y: 300, w: 33, h: 20 });
  const view = mk(context);
  const target = { x: 600, y: 300, w: 120, h: 40 };
  const cam = view.frame(target);
  assert.deepEqual(X.sidesSliced(cam, context, 1440, 900), []);
  assert.ok(view.shows(cam, target, 0));
  // an open page zooms as before
  const open = mk([]).frame(target);
  assert.ok(open.z > 1.3, `open page keeps its zoom (${open.z})`);
});

test('camera: a drift push-in is limited so it does not slice a box near the window edge', () => {
  const view = mk([{ x: 10, y: 400, w: 60, h: 30 }]); // 10 px from the edge: a 5 % push would cut it
  const keys = [{ t: 0, cx: 720, cy: 450, z: 1 }];
  const trk = X.cameraTrack(keys, view, undefined, { drift: 0.05, duration: 12 });
  for (const t of [0, 3, 6, 9, 11.9]) assert.deepEqual(X.sidesSliced(trk.at(t), view.context, 1440, 900), []);
  // with nothing near the edge the same hold still pushes in
  const free = X.cameraTrack(keys, mk([{ x: 200, y: 400, w: 60, h: 30 }]), undefined, { drift: 0.05, duration: 12 });
  assert.ok(free.at(11.9).z > 1.02);
});
