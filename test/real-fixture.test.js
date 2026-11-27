// Checks the generated "C2 v2" native-phone fixtures in fixtures/real/ (no Chrome needed; ffprobe only).
// Regenerate: see scripts/real-fixture.js header and fixtures/real/README (commands in the lane report).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'real');
const load = (p) => JSON.parse(fs.readFileSync(path.join(DIR, p), 'utf8'));
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
const DEVICES = { owner: load('owner/capture.json'), customer: load('customer/capture.json') };
const step = (cap, id) => cap.steps.find((s) => s.id === id);
const event = (cap, stepId, type) => cap.events.find((e) => e.step === stepId && (!type || e.type === type));

function probe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=codec_name,pix_fmt,width,height,r_frame_rate,avg_frame_rate,nb_read_frames', '-of', 'json', file], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).streams[0];
}

for (const [id, cap] of Object.entries(DEVICES)) {
  test(`${id}: C2 v2 schema fields`, () => {
    assert.equal(cap.clock, 'wall');
    assert.equal(cap.frames, undefined, 'v1 frames block is removed');
    assert.equal(cap.fps, 60);
    assert.deepEqual(cap.video, { src: 'capture.mp4', codec: 'h264', fps: 60, width: 1080, height: 2400 });
    assert.equal(cap.device.kind, 'phone');
    assert.deepEqual(cap.device.video, { width: 1080, height: 2400 });
    assert.deepEqual(cap.device.chrome, { statusBar: { y: 0, h: 72 }, toolbar: { y: 72, h: 168 }, page: { y: 240, h: 2016 }, nav: { y: 2256, h: 144 } });
    assert.deepEqual(cap.mapping, { s: 3, ox: 0, oy: 240 });
    assert.equal(typeof cap.sessionOffset, 'number');
    assert.ok(Array.isArray(cap.idle) && Array.isArray(cap.busy) && typeof cap.busySource === 'string');
    assert.ok(fs.existsSync(path.join(DIR, id, 'receipt.json')));
    assert.ok(!fs.existsSync(path.join(DIR, id, 'frames')), 'no frames dir shipped');
  });

  test(`${id}: vbox/vpoint == css * s + offset`, () => {
    const { s, ox, oy } = cap.mapping;
    let n = 0;
    for (const e of cap.events) {
      if (e.box) {
        assert.deepEqual(e.mapping, cap.mapping);
        for (const [k, o] of [['x', ox], ['y', oy], ['w', 0], ['h', 0]]) assert.ok(near(e.vbox[k], e.box[k] * s + o), `${e.type}@${e.t} vbox.${k}`);
        n++;
      }
      if (e.point) for (const [k, o] of [['x', ox], ['y', oy]]) assert.ok(near(e.vpoint[k], e.point[k] * s + o), `${e.type}@${e.t} vpoint.${k}`);
      for (const tr of e.track || []) {
        if (!tr.box) continue;
        for (const [k, o] of [['x', ox], ['y', oy], ['w', 0], ['h', 0]]) assert.ok(near(tr.vbox[k], tr.box[k] * s + o), `track@${tr.t} vbox.${k}`);
      }
    }
    assert.ok(n >= 2);
  });

  test(`${id}: idle ranges sorted, disjoint, >= 0.3 s; busy sane`, () => {
    let prev = -1;
    for (const [a, b] of cap.idle) {
      assert.ok(a >= prev - 1e-9 && b - a >= 0.3 - 1e-6 && b <= cap.duration + 1e-6, `idle ${a}..${b}`);
      prev = b;
    }
    for (const [a, b] of cap.busy) assert.ok(a < b && b <= cap.duration + 1e-6);
  });

  test(`${id}: video is 1080x2400 @ 60 fps, frame count ~ duration*60`, () => {
    const p = probe(path.join(DIR, id, 'capture.mp4'));
    assert.equal(p.codec_name, 'h264');
    assert.equal(p.pix_fmt, 'yuv420p');
    assert.equal(p.width, 1080);
    assert.equal(p.height, 2400);
    assert.equal(p.r_frame_rate, '60/1');
    assert.ok(Math.abs(Number(p.nb_read_frames) - cap.duration * 60) <= 1, `${p.nb_read_frames} frames vs ${cap.duration * 60}`);
  });
}

test('type events: keys monotone, inside [t,t1], one per character', () => {
  for (const cap of Object.values(DEVICES)) {
    for (const e of cap.events.filter((x) => x.type === 'type')) {
      assert.equal(e.keys.length, [...e.text].length);
      assert.ok(['framediff', 'even'].includes(e.keysSource));
      let prev = -Infinity;
      e.keys.forEach((k, i) => {
        assert.equal(k.ch, [...e.text][i]);
        assert.ok(k.t >= prev && k.t >= e.t - 1e-6 && k.t <= e.t1 + 1e-6, `key ${i} @${k.t} outside ${e.t}..${e.t1}`);
        prev = k.t;
      });
    }
  }
  assert.ok(DEVICES.owner.events.filter((x) => x.type === 'type').length >= 2);
});

test('owner: marks carry payoff/notify/counter kinds', () => {
  const m = Object.fromEntries(DEVICES.owner.marks.map((x) => [x.id, x]));
  assert.equal(m.notify.kind, 'notify');
  assert.equal(m.notify.payoff, true);
  assert.equal(m.counter.kind, 'counter');
  assert.equal(m.counter.payoff, true);
  assert.ok(m.counter.t > m.notify.t);
});

test('owner: deliberate >= 1.8 s idle before the send tap is detected', () => {
  const cap = DEVICES.owner;
  const review = step(cap, 'review');
  const hit = cap.idle.find(([a, b]) => a <= review.t0 + 0.2 && b >= review.t0 + 1.8);
  assert.ok(hit, `no idle range covers review ${review.t0}..${review.t1}: ${JSON.stringify(cap.idle)}`);
  assert.ok(hit[1] - hit[0] >= 1.8);
});

test('owner: busy range covers the 1.6 s spinner', () => {
  const cap = DEVICES.owner;
  assert.equal(cap.busy.length, 1);
  const [a, b] = cap.busy[0];
  const tap = event(cap, 'send', 'click').t, sent = event(cap, 'sent', 'observe').t;
  assert.ok(a <= tap + 0.05 && b >= sent - 0.05, `busy ${a}..${b} vs spinner ${tap}..${sent}`);
  assert.ok(b - a >= 1.5 && b - a <= 1.9, `busy length ${b - a}`);
  assert.match(cap.busySource, /^declared:/);
});

test('session.json aligns customer approve with the owner payoff', () => {
  const s = load('session.json');
  assert.equal(s.schema, 'kinetype.session.v1');
  assert.deepEqual(s.devices, [{ id: 'owner', capture: 'owner/capture.json' }, { id: 'customer', capture: 'customer/capture.json' }]);
  assert.deepEqual(s.sync, [{ from: 'customer:approve', to: 'owner:approved' }]);
  const { owner, customer } = DEVICES;
  assert.equal(owner.sessionOffset, 0);
  const custTap = customer.sessionOffset + event(customer, 'approve', 'click').t;
  const notify = owner.sessionOffset + owner.marks.find((m) => m.id === 'notify').t;
  assert.ok(near(custTap, notify - 0.4, 0.06), `customer tap ${custTap} vs notify ${notify} - 0.4`);
  // the synced owner step starts at the payoff (within 0.15 s)
  assert.ok(Math.abs(step(owner, 'approved').t0 - owner.marks.find((m) => m.id === 'notify').t) < 0.15);
});

test('durations are in the expected range', () => {
  assert.ok(DEVICES.owner.duration >= 24 && DEVICES.owner.duration <= 34, `owner ${DEVICES.owner.duration}`);
  assert.ok(DEVICES.customer.duration >= 8 && DEVICES.customer.duration <= 12, `customer ${DEVICES.customer.duration}`);
});
