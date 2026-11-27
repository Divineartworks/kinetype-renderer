import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flowProblems, resolveFlow, assertSameOrigin } from '../src/capture/flow.js';
import { rng, typingSchedule, scrollSteps, pointerPath, resample, fillFrames, frameOf, stats } from '../src/capture/timeline.js';
import { Recorder, buildCapture } from '../src/capture/events.js';
import { validateCaptureDoc } from '../src/capture/validate.js';
import { jpegSize } from '../src/capture/jpeg.js';

const flow = () => ({
  schema: 'kinetype.flow.v1', name: 'demo-flow', app: { name: 'Demo', baseUrl: 'http://127.0.0.1:1234' }, device: { kind: 'desktop' },
  setup: [{ action: 'request', method: 'POST', url: '/api/auth/demo', body: { role: 'owner' } }],
  steps: [
    { id: 'open', action: 'goto', url: '/' },
    { id: 'go', action: 'click', target: { role: 'button', name: 'Go' }, label: 'Go' },
    { id: 'name', action: 'type', target: { selector: 'input[name=a]' }, value: 'Hei', cps: 12 },
    { id: 'beat', action: 'mark' },
  ],
});

test('flow: a valid flow passes and resolves device defaults', () => {
  assert.deepEqual(flowProblems(flow()), []);
  const r = resolveFlow(flow());
  assert.equal(r.fps, 30);
  assert.deepEqual(r.device.viewport, { width: 1440, height: 900 });
  assert.equal(r.device.deviceScaleFactor, 2);
  const ph = flow(); ph.device = { kind: 'phone' };
  const p = resolveFlow(ph);
  assert.deepEqual([p.device.viewport.width, p.device.viewport.height, p.device.deviceScaleFactor, p.device.hasTouch], [390, 844, 3, true]);
});

test('flow: clear errors for the usual mistakes', () => {
  const f = flow(); f.steps[1].target = undefined;
  assert.match(flowProblems(f).join('\n'), /target/);
  const g = flow(); g.steps.push({ id: 'open', action: 'wait', seconds: 1 });
  assert.match(flowProblems(g).join('\n'), /duplicate step id "open"/);
  const h = flow(); h.steps[0].action = 'teleport';
  assert.ok(flowProblems(h).length > 0);
  const i = flow(); i.schema = 'nope';
  assert.ok(flowProblems(i).length > 0);
  const j = flow(); j.steps[2].cps = 1000;
  assert.ok(flowProblems(j).length > 0);
});

test('flow: request setup may only target the flow origin', () => {
  const f = flow(); f.setup[0].url = 'https://evil.example/steal';
  assert.match(flowProblems(f).join('\n'), /leaves the flow's baseUrl origin/);
  assert.throws(() => assertSameOrigin('http://127.0.0.1:1234', 'http://127.0.0.1:9999/x'));
  assert.equal(assertSameOrigin('http://127.0.0.1:1234', '/api/x'), 'http://127.0.0.1:1234/api/x');
});

test('timeline: rng is seeded and reproducible', () => {
  const a = rng(7), b = rng(7), c = rng(8);
  const xs = [a(), a(), a()]; const ys = [b(), b(), b()];
  assert.deepEqual(xs, ys);
  assert.notEqual(c(), xs[0]);
  assert.ok(xs.every((x) => x >= 0 && x < 1));
});

test('timeline: typing schedule is deterministic, strictly increasing, near the requested cps', () => {
  const s1 = typingSchedule('Hansen VVS AS', { cps: 14, fps: 30, seed: 3 });
  const s2 = typingSchedule('Hansen VVS AS', { cps: 14, fps: 30, seed: 3 });
  assert.deepEqual(s1, s2);
  for (let i = 1; i < s1.length; i++) assert.ok(s1[i].frame > s1[i - 1].frame);
  assert.equal(s1.map((x) => x.ch).join(''), 'Hansen VVS AS');
  const secs = s1.at(-1).frame / 30;
  const cps = s1.length / secs;
  assert.ok(cps > 9 && cps < 16, `cps ${cps}`);
  assert.notDeepEqual(typingSchedule('Hansen VVS AS', { cps: 14, fps: 30, seed: 4 }), s1);
});

test('timeline: scroll steps sum exactly to the distance and ease in/out', () => {
  for (const total of [640, -333, 7]) {
    const st = scrollSteps(total, 30);
    assert.equal(st.reduce((a, b) => a + b, 0), total);
    assert.equal(st.length, 30);
  }
  const st = scrollSteps(900, 30);
  assert.ok(Math.abs(st[0]) < Math.abs(st[15]) && Math.abs(st[29]) < Math.abs(st[15]));
});

test('timeline: pointer path ends exactly on target, one point per frame', () => {
  const p = pointerPath({ x: 0, y: 0 }, { x: 100, y: 50 }, 10);
  assert.equal(p.length, 10);
  assert.deepEqual(p.at(-1), { x: 100, y: 50 });
  assert.ok(p[0].x < 20);
});

test('resampler: irregular shots become constant-fps frames, holes counted', () => {
  const shots = [{ t: 0, id: 'a' }, { t: 0.05, id: 'b' }, { t: 0.5, id: 'c' }];
  const r = resample(shots, 10, 1);
  assert.equal(r.count, 10);
  assert.deepEqual(r.frames.slice(0, 7), ['a', 'b', 'b', 'b', 'b', 'c', 'c']);
  assert.equal(r.frames.length, 10);
  assert.ok(r.holes >= 5);
  // regular shots: no holes
  const reg = resample(Array.from({ length: 5 }, (_, i) => ({ t: i / 10, id: i })), 10, 0.5);
  assert.equal(reg.holes, 0);
  assert.deepEqual(reg.frames, [0, 1, 2, 3, 4]);
});

test('resampler: frames with no fresh pixels repeat the previous one and are counted as unchanged', () => {
  const r = fillFrames([null, 'a', null, null, 'b']);
  assert.deepEqual(r.frames, [null, 'a', 'a', 'a', 'b']);
  assert.equal(r.unchanged, 2);
  assert.equal(r.leading, 1);
});

test('stats: median/p95/max', () => {
  const s = stats([5, 1, 3, 100, 2]);
  assert.equal(s.max, 100); assert.equal(s.median, 3);
});

test('event builder: times on the capture clock, steps/marks/events consistent, C2 valid', () => {
  const f = resolveFlow(flow());
  const rec = new Recorder({ fps: 30 });
  rec.beginStep('open', 0); rec.event('navigate', 0, { url: '/' }); rec.endStep(24);
  rec.beginStep('go', 24);
  rec.event('move', 24, { from: { x: 1, y: 1 }, to: { x: 100, y: 100 }, t1: 33 / 30 });
  rec.event('click', 33, { label: 'Go', point: { x: 100, y: 100 }, box: { x: 90, y: 90, w: 20, h: 20 } });
  rec.endStep(60);
  rec.beginStep('name', 60);
  const ev = rec.event('type', 62, { box: { x: 0, y: 0, w: 10, h: 10 }, text: 'Hei', t1: 62 / 30 }); ev.t1 = 75 / 30;
  rec.endStep(90);
  rec.beginStep('beat', 90); rec.mark('beat', 90); rec.endStep(90);
  const doc = buildCapture({ flow: f, rec, frameCount: 90, frameSize: { width: 2880, height: 1800 }, video: { src: 'capture.mp4', codec: 'h264', crf: 10 } });
  assert.equal(doc.schema, 'kinetype.capture.v1');
  assert.equal(doc.duration, 3);
  assert.deepEqual(doc.steps.map((s) => [s.id, s.t0, s.t1]), [['open', 0, 0.8], ['go', 0.8, 2], ['name', 2, 3], ['beat', 3, 3]]);
  assert.deepEqual(doc.marks, [{ t: 3, id: 'beat' }]);
  assert.equal(doc.events.find((e) => e.type === 'click').t, 1.1);
  assert.equal(doc.events.find((e) => e.type === 'type').t1, 2.5);
  assert.deepEqual(validateCaptureDoc(doc), []);
});

test('validator: rejects broken captures with a reason', () => {
  const f = resolveFlow(flow());
  const rec = new Recorder({ fps: 30 });
  rec.beginStep('open', 0); rec.endStep(30);
  const good = buildCapture({ flow: f, rec, frameCount: 30, frameSize: { width: 2880, height: 1800 }, video: { src: 'capture.mp4', codec: 'h264', crf: 10 } });
  assert.deepEqual(validateCaptureDoc(good), []);
  const bad1 = structuredClone(good); bad1.frames.width = 1440;
  assert.match(validateCaptureDoc(bad1).join('|'), /viewport \* deviceScaleFactor/);
  const bad2 = structuredClone(good); bad2.events.push({ t: 0.5, type: 'click', step: 'open', point: { x: 5000, y: 5 }, box: { x: 0, y: 0, w: 1, h: 1 } });
  assert.match(validateCaptureDoc(bad2).join('|'), /outside the viewport/);
  const bad3 = structuredClone(good); bad3.marks.push({ t: 0.5, id: 'ghost' });
  assert.match(validateCaptureDoc(bad3).join('|'), /no matching step/);
  const bad4 = structuredClone(good); bad4.duration = 5;
  assert.match(validateCaptureDoc(bad4).join('|'), /duration/);
  assert.match(validateCaptureDoc({ schema: 'x' }).join('|'), /schema/);
});

test('validator: target tracks (events[].track) are checked; flow accepts observe + trackTail', () => {
  const f = resolveFlow(flow());
  const rec = new Recorder({ fps: 30 });
  rec.beginStep('open', 0);
  rec.event('click', 10, { point: { x: 5, y: 5 }, box: { x: 0, y: 0, w: 10, h: 10 } });
  rec.event('observe', 12, { box: { x: 20, y: 20, w: 10, h: 10 } });
  rec.endStep(30);
  const doc = buildCapture({ flow: f, rec, frameCount: 30, frameSize: { width: 2880, height: 1800 }, video: { src: 'capture.mp4', codec: 'h264', crf: 10 } });
  doc.events[0].track = [{ t: 0.2, box: { x: 0, y: 0, w: 10, h: 10 }, visible: true }, { t: 0.5, box: { x: 0, y: 0, w: 10, h: 10 }, visible: false }, { t: 0.6, visible: false }];
  doc.events[0].trackEnd = 1;
  assert.deepEqual(validateCaptureDoc(doc), []);
  const b1 = structuredClone(doc); b1.events[0].track[0].visible = 'yes';
  assert.match(validateCaptureDoc(b1).join('|'), /visible must be boolean/);
  const b2 = structuredClone(doc); delete b2.events[0].track[0].box;
  assert.match(validateCaptureDoc(b2).join('|'), /visible entry needs its box/);
  const b3 = structuredClone(doc); b3.events[0].track[2].t = 0.1;
  assert.match(validateCaptureDoc(b3).join('|'), /out of order/);
  const b4 = structuredClone(doc); delete b4.events[0].trackEnd;
  assert.match(validateCaptureDoc(b4).join('|'), /trackEnd/);
  const fl = flow(); fl.trackTail = 4; fl.steps.push({ id: 'sheet', action: 'observe', target: { role: 'dialog' } });
  assert.deepEqual(flowProblems(fl), []);
  assert.equal(resolveFlow(fl).steps.at(-1).hold, 0);
  assert.equal(resolveFlow(flow()).trackTail, 3);
  const g = flow(); g.trackTail = 1; assert.ok(flowProblems(g).length, 'tail under 3 s rejected');
  const h = flow(); h.steps.push({ id: 'x', action: 'observe' }); assert.match(flowProblems(h).join('|'), /target/);
});

test('jpegSize reads dimensions from the SOF marker', () => {
  const buf = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0x07, 0x08, 0x0b, 0x40, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
  assert.deepEqual(jpegSize(buf), { width: 2880, height: 1800 });
  assert.throws(() => jpegSize(Buffer.from('nope')));
});

test('frameOf rounds seconds to frames', () => { assert.equal(frameOf(0.5, 30), 15); assert.equal(frameOf(1 / 30, 30), 1); });

// Real browser: a phone flow must actually scroll a tall page (touch scroll used to be a silent no-op).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureFlow } from '../src/capture/index.js';
import { chromePath } from '../src/cli/browser.js';

test('capture: phone scroll really moves a tall page and records true from/to', { skip: !chromePath() && 'no Chrome', timeout: 300000 }, async () => {
  const html = `<!doctype html><meta name=viewport content="width=device-width"><body style="margin:0"><div style="height:3000px;background:linear-gradient(#fff,#06c)"><h1 id=top>Top</h1></div>`;
  const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(html); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-scroll-'));
  try {
    const flowFile = path.join(dir, 'flow.json');
    fs.writeFileSync(flowFile, JSON.stringify({
      schema: 'kinetype.flow.v1', name: 'scroll-phone', app: { name: 'T', baseUrl: `http://127.0.0.1:${srv.address().port}` },
      device: { kind: 'phone', deviceScaleFactor: 1 }, fps: 15,
      steps: [{ id: 'open', action: 'goto', url: '/', hold: 0.2 }, { id: 'down', action: 'scroll', by: 900, duration: 0.8, hold: 0.2 }],
    }));
    const r = await captureFlow(flowFile, { out: path.join(dir, 'out') });
    const cap = JSON.parse(fs.readFileSync(r.capture, 'utf8'));
    const sc = cap.events.find((e) => e.type === 'scroll');
    assert.equal(sc.from, 0);
    assert.ok(Math.abs(sc.to - 900) <= 2, `scrolled to ${sc.to}`);
  } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

// Real browser: a click that opens a native file chooser is answered with the flow's `files` (paths relative to the
// flow file); the page really receives the file and the receipt records its hash.
test('capture: click with files answers the file chooser (upload), receipt hashes the file', { skip: !chromePath() && 'no Chrome', timeout: 300000 }, async () => {
  const html = `<!doctype html><meta name=viewport content="width=device-width"><body>
<input id=f type=file accept="image/*" capture=environment style="position:absolute;left:-9999px" aria-hidden=true>
<button id=b onclick="document.getElementById('f').click()" style="font-size:24px;margin:40px">Ta bilde</button><p id=o>ingen</p>
<script>document.getElementById('f').onchange=e=>{const x=e.target.files[0];document.getElementById('o').textContent=x.name+':'+x.size;location.hash='got-'+x.name+'-'+x.size}</script>`;
  const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(html); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-upload-'));
  try {
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'assets', 'demo.jpg'), Buffer.alloc(1234, 7));
    const flowFile = path.join(dir, 'flow.json');
    fs.writeFileSync(flowFile, JSON.stringify({
      schema: 'kinetype.flow.v1', name: 'upload-phone', app: { name: 'T', baseUrl: `http://127.0.0.1:${srv.address().port}` },
      device: { kind: 'phone', deviceScaleFactor: 1 }, fps: 15,
      steps: [{ id: 'open', action: 'goto', url: '/', hold: 0.2 },
        { id: 'pick', action: 'click', target: { selector: '#b' }, files: ['assets/demo.jpg'], hold: 0.3 }],
    }));
    const r = await captureFlow(flowFile, { out: path.join(dir, 'out') });
    const cap = JSON.parse(fs.readFileSync(r.capture, 'utf8'));
    assert.ok(cap.events.some((e) => e.type === 'navigate' && e.url.endsWith('#got-demo.jpg-1234')), JSON.stringify(cap.events.map((e) => e.type + ' ' + (e.url || ''))));
    const rec = JSON.parse(fs.readFileSync(r.receipt, 'utf8'));
    assert.deepEqual(rec.uploads.map((u) => [u.step, u.file]), [['pick', 'demo.jpg']]);
    assert.match(rec.uploads[0].sha256, /^[0-9a-f]{64}$/);
  } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('flow: files are click-only, resolved relative to the flow file and must exist', async () => {
  const { flowProblems, resolveStepFiles } = await import('../src/capture/flow.js');
  const base = { schema: 'kinetype.flow.v1', name: 'x', app: { name: 'T', baseUrl: 'http://127.0.0.1:1' }, device: { kind: 'phone' } };
  assert.ok(flowProblems({ ...base, steps: [{ id: 'a', action: 'hover', target: { selector: 'b' }, files: ['x.jpg'] }] }).length > 0);
  assert.deepEqual(flowProblems({ ...base, steps: [{ id: 'a', action: 'click', target: { selector: 'b' }, files: ['x.jpg'] }] }), []);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-files-'));
  try {
    fs.writeFileSync(path.join(dir, 'x.jpg'), 'x');
    const f = resolveStepFiles({ steps: [{ id: 'a', action: 'click', files: ['x.jpg'] }] }, dir);
    assert.equal(f.steps[0].files[0], path.join(dir, 'x.jpg'));
    assert.throws(() => resolveStepFiles({ steps: [{ id: 'a', action: 'click', files: ['missing.jpg'] }] }, dir), /upload file not found/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
