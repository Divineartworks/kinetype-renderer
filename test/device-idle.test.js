import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { frameDiffs, idleRanges, busyRanges, detectIdleBusy, caretMasks, statusBarMask } from '../src/device/idle.js';
import { synthVideo, fillRect } from './helpers/synth-video.js';

const have = spawnSync('ffmpeg', ['-version']).status === 0;
const near = (r, a, b, tol = 2 / 30 + 1e-6) => Math.abs(r[0] - a) <= tol && Math.abs(r[1] - b) <= tol;
const W = 360, H = 800, FPS = 30;
const FIELD = { x: 40, y: 300, w: 280, h: 40 };

// 0-1 scroll band | 1-2.5 static + caret + clock change@1.8 | 2.5-4 spinner | 4-5 static | 5-5.5 big change | 5.5-6 static
const draw = (i, t, b) => {
  fillRect(b, W, 0, 0, W, H, 60);
  fillRect(b, W, FIELD.x, FIELD.y, FIELD.w, FIELD.h, 120);
  fillRect(b, W, 300, 8, 40, 16, t >= 1.8 ? 230 : 90); // clock digits
  fillRect(b, W, 0, 100 + Math.min(i, 29) * 15, W, 60, 200); // full-width band, parked from 1 s
  if (t >= 1 && t < 2.5 && Math.floor(t / 0.5) % 2 === 0) fillRect(b, W, 50, 308, 2, 20, 255); // caret
  if (t >= 2.5 && t < 4) fillRect(b, W, 150, 500, 30, 30, (i * 53) % 200 + 40); // spinner
  if (t >= 5 && t < 5.5) fillRect(b, W, 0, 0, W, H, 200);
};

test('synthetic video: idle, busy, masks, events, dom', { skip: !have && 'ffmpeg not on PATH' }, async (t) => {
  fs.mkdirSync('/tmp/device-idle', { recursive: true });
  const file = `/tmp/device-idle/synth-${process.pid}.mp4`;
  t.after(() => fs.rmSync(file, { force: true }));
  await synthVideo(file, { width: W, height: H, fps: FPS, seconds: 6, draw });
  const events = [{ t: 0.9, type: 'type', vbox: FIELD }];
  const masks = [...caretMasks(events), statusBarMask({ width: W, statusBarPx: 40 })];
  const opts = { scaleWidth: 180 };

  const diffs = await frameDiffs(file, { ...opts, masks });
  assert.equal(diffs.fps, FPS); assert.equal(diffs.width, W); assert.equal(diffs.frames.length, 179);

  const r = await detectIdleBusy(file, { ...opts, masks });
  assert.ok(r.idle.some((x) => near(x, 1.0, 2.5)), JSON.stringify(r.idle));
  assert.ok(r.idle.some((x) => near(x, 4.0, 5.0)), JSON.stringify(r.idle));
  assert.equal(r.busy.length, 1, JSON.stringify(r.busy));
  assert.ok(near([r.busy[0].t0, r.busy[0].t1], 2.5, 4.0), JSON.stringify(r.busy));
  assert.equal(r.busy[0].source, 'pixels');
  assert.ok(r.stats.frames === 180 && r.stats.p95Changed >= r.stats.medianChanged);

  const raw = await detectIdleBusy(file, opts); // no masks: the clock change breaks the static stretch
  assert.ok(!raw.idle.some((x) => x[0] <= 1.1 && x[1] >= 2.4), JSON.stringify(raw.idle));
  const rawD = await frameDiffs(file, opts);
  assert.ok(rawD.frames.some((f) => f.t > 1.7 && f.t < 1.9 && f.changed >= 0.0005));

  assert.deepEqual(busyRanges(diffs, { events: [{ t: 2.4, t1: 4.1 }] }), []);
  assert.equal(busyRanges(diffs, { events: [{ t: 0.2 }] }).length, 1); // unrelated tap
  const m = busyRanges(diffs, { dom: [[3.5, 4.5]] });
  assert.equal(m.length, 1); assert.equal(m[0].source, 'both'); assert.equal(m[0].t1, 4.5);
  assert.deepEqual(busyRanges(diffs, { dom: [[5.2, 5.9]] }).map((x) => x.source), ['pixels', 'dom']);
});

// ---- pure helpers ----
const mk = (ch, bbox = { x: 10, y: 10, w: 20, h: 20 }) => ({ fps: 10, width: 100, height: 100, frames: ch.map((c, k) => ({ i: k + 1, t: (k + 1) / 10, changed: c, area: c ? 5 : 0, bbox: c ? bbox : null })) });

test('idleRanges: empty, all static, runs, minIdle', () => {
  assert.deepEqual(idleRanges(mk([])), []);
  assert.deepEqual(idleRanges(mk(Array(10).fill(0))), [[0, 1]]);
  assert.deepEqual(idleRanges(mk([0.5, 0, 0, 0, 0.5, 0, 0])), [[0.1, 0.4]]);
  assert.deepEqual(idleRanges(mk([0.5, 0, 0, 0, 0.5, 0, 0]), { minIdle: 0.2 }), [[0.1, 0.4], [0.5, 0.7]]);
  assert.deepEqual(idleRanges(mk(Array(10).fill(0.001))), []);
});

test('busyRanges: empty, localized, gap tolerance, large change, events, dom only', () => {
  assert.deepEqual(busyRanges(mk([])), []);
  assert.deepEqual(busyRanges(mk(Array(10).fill(0))), []);
  const on = Array(5).fill(0.01);
  assert.deepEqual(busyRanges(mk([0, ...on, 0, 0, 0])).map((r) => [r.t0, r.t1, r.source]), [[0.1, 0.6, 'pixels']]);
  assert.equal(busyRanges(mk([...on, 0, 0, ...on])).length, 1); // 2-frame gap tolerated
  assert.equal(busyRanges(mk([0.01, 0.01, 0, 0, 0, 0.01, 0.01])).length, 0); // 3-frame gap splits, each too short
  assert.equal(busyRanges(mk(on, { x: 0, y: 0, w: 100, h: 100 })).length, 0); // not localized
  assert.equal(busyRanges(mk(on), { events: [{ t: 0.2 }] }).length, 0); // tap covers [0.2,0.7]
  assert.deepEqual(busyRanges(mk([0, 0]), { dom: [[0.5, 1], [0.8, 1.2]] }).map((r) => [r.t0, r.t1, r.source]), [[0.5, 1.2, 'dom']]);
});

test('caretMasks + statusBarMask', () => {
  const vbox = { x: 40, y: 300, w: 280, h: 40 };
  const ms = caretMasks([{ t: 1, type: 'type', vbox }, { t: 2, type: 'fill', vbox }, { t: 3, type: 'click' }, { t: 4, type: 'click', editable: true, vbox }, { t: 5, type: 'scroll', vbox }]);
  assert.deepEqual(ms[0], { x: 36, y: 296, w: 288, h: 48, t0: 1, t1: 3 });
  assert.equal(ms[1].t1, 3); assert.equal(ms.length, 3);
  assert.ok(!('t1' in ms[2]));
  assert.deepEqual(statusBarMask({ width: 1080, statusBarPx: 90 }), { x: 0, y: 0, w: 1080, h: 90 });
});
