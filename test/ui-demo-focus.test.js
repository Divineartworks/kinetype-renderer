import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildScene } from '../src/kit/engine.js';
import { FontBook } from '../src/kit/font.js';
import { MediaHub } from '../src/kit/media.js';
import uiDemo from '../templates/ui-demo/index.js';
import * as X from '../src/kit/x-ui.js';

// Polish 2 (K1, K2, K3, K4, K5): the narrated element is FOCUSED (camera + a ring that stays for the
// callout's whole duration), no static hold longer than 5 s, no sliced edges, plates off the neighbours,
// every overlay text at 4.5:1. Planner-level numbers + whole-scene builds on a synthetic capture (no Chrome).
const buf = (f) => { const b = fs.readFileSync(new URL(`../fonts/files/${f}`, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const fonts = new FontBook();
fonts.addBuffer('label', buf('InterTight-600.ttf'));
fonts.addBuffer('url', buf('Inter-500.ttf'));
const base = JSON.parse(fs.readFileSync(new URL('../fixtures/captures/demo-app-desktop/capture.json', import.meta.url)));
const W = 1920, H = 1080, FPS = 30;
const KPI = { x: 640, y: 210, w: 300, h: 130 };
const track = (box) => ({ track: [{ t: 0, box, visible: true }], trackEnd: base.duration });
/** A capture with only observe steps (the narrated KPI cards): a quiet dashboard, nothing is clicked. */
function dashCap(extra = []) {
  const ev = (step, t, box) => ({ type: 'observe', step, t, box, ...track(box) });
  const events = [ev('kpi', 1.5, KPI), ...extra];
  return { ...base, events, marks: [], steps: events.map((e) => ({ id: e.step, t0: e.t, t1: e.t + 0.4 })) };
}
function build(cap, { content = {}, params = {}, palette } = {}) {
  const media = new MediaHub({ cap: { kind: 'capture', url: '/x', pattern: 'f%06d.jpg', w: 2880, h: 1800, fps: 30, frames: cap.frames.count, capture: cap } });
  const qa = { texts: [], hits: [], keyframes: [], notes: [], warnings: [], checks: [], overlays: [] };
  buildScene(uiDemo, { template: 'ui-demo', format: 'landscape', fps: FPS, ...(palette ? { palette } : {}), params, content: { capture: 'cap', frame: 'browser', ...content } }, { W, H, fps: FPS, fonts, qa, media });
  return qa;
}
const check = (qa, id) => qa.checks.find((c) => c.id.endsWith(id));
const ringFrames = (qa) => qa.overlays.filter((o) => o.kind === 'highlight').map((o) => o.t);

test('K1: a callout\'s observe target is a focus event — the camera zooms in on it and the ring stays for the whole duration', () => {
  const qa = build(dashCap(), { content: { callouts: [{ at: 'kpi', text: 'Forfalt 14 800 kr', duration: 6 }] } });
  const shot = qa.notes.find((n) => /^camera .*shot 1: kpi/.test(n));
  assert.ok(shot, `no focus shot:\n${qa.notes.join('\n')}`);
  assert.ok(Number(shot.match(/zoom ([\d.]+)/)[1]) >= 1.18, shot);
  const ts = ringFrames(qa);
  assert.ok(ts.length / FPS >= 5.7, `ring drawn ${(ts.length / FPS).toFixed(2)}s of 6 s`);
  assert.ok(Math.max(...ts) - Math.min(...ts) >= 5.7 && ts.length >= (Math.max(...ts) - Math.min(...ts)) * FPS * 0.98, 'the ring is continuous, not flickering');
  assert.equal(check(qa, 'highlight-accuracy').status, 'pass');
  assert.equal(qa.warnings.filter((w) => /reading time|not visible/.test(w)).length, 0, qa.warnings.join('|'));
});

test('K1: without a callout an observe is not a focus event (camera stays wide)', () => {
  const qa = build(dashCap());
  assert.ok(!qa.notes.some((n) => /^camera /.test(n)), qa.notes.join('\n'));
});

test('K1: planCamera frames the whole observe target with padding and holds the shot to holdUntil', () => {
  const content = { x: 0, y: -40, w: 1440, h: 940 };
  const view = X.makeView({ content, viewW: 1655, viewH: 931, zMax: 2.4, fill: 0.6, padding: 44 });
  const ev = { type: 'observe', step: 'kpi', t: 1.5, ct: 1.5, box: KPI, focus: true, holdUntil: 7.7 };
  const keys = X.planCamera([ev], view, { duration: 12 });
  assert.equal(keys[0].why.slice(0, 7), 'shot 1:');
  assert.ok(view.shows(keys[0], KPI, 44 * 0.5), 'whole box with half its padding inside the view');
  const back = keys.find((k) => /wide/.test(k.why));
  assert.ok(back.t >= 7.7, `returns wide at ${back.t}, after the callout ends (7.7)`);
  assert.deepEqual(keys[0].focus, { x: KPI.x + KPI.w / 2, y: KPI.y + KPI.h / 2 });
});

test('K1: the shot is not held into the next action (holdUntil is capped by its lead-in)', () => {
  const content = { x: 0, y: 0, w: 1440, h: 900 };
  const view = X.makeView({ content, viewW: 1655, viewH: 931, zMax: 2.4, fill: 0.6, padding: 44 });
  const a = { type: 'observe', t: 1, ct: 1, box: KPI, focus: true, holdUntil: 9 };
  const b = { type: 'click', t: 4, ct: 4, box: { x: 100, y: 700, w: 120, h: 40 } };
  const keys = X.planCamera([a, b], view, { duration: 12, lead: 0.42 });
  assert.ok(!keys.some((k) => /wide/.test(k.why) && k.t < 4.5), 'no return-wide between the narrated element and the click');
  assert.ok(keys.some((k) => /click|shot 2/.test(k.why)), 'the click gets its own shot');
});

test('K2: drift keeps a long hold alive (<= drift, about the focus, never past zMax) and is seek-order independent', () => {
  const content = { x: 0, y: 0, w: 1440, h: 900 };
  const view = X.makeView({ content, viewW: 1655, viewH: 931, zMax: 2.4, fill: 0.6, padding: 44 });
  const box = { x: 640, y: 380, w: 300, h: 130 };
  const f = { x: 790, y: 445 };
  const cam0 = view.frame(box);
  const keys = [{ t: 0.5, ...cam0, why: 'shot', focus: f }];
  const trk = X.cameraTrack(keys, view, undefined, { drift: 0.05, duration: 12 });
  const ts = [1.0, 2.2, 3.0, 5.0, 8.0, 11.9];
  const fwd = ts.map((t) => trk.at(t)), rev = [...ts].reverse().map((t) => trk.at(t)).reverse();
  assert.deepEqual(fwd, rev, 'pure function of t');
  const z0 = trk.at(1.6).z, z1 = trk.at(11.9).z;
  assert.ok(z1 > z0 * 1.03 && z1 <= cam0.z * 1.0501 && z1 <= view.zMax + 1e-9, `z ${z0} → ${z1}`);
  const sx = (c) => (f.x - c.cx) * c.z, sy = (c) => (f.y - c.cy) * c.z; // focus offset from the screen centre
  assert.ok(Math.abs(sx(trk.at(11.9)) - sx(trk.at(1.6))) < 1.5 && Math.abs(sy(trk.at(11.9)) - sy(trk.at(1.6))) < 1.5, 'the focus stays put on screen');
  // drift 0 never moves a held camera
  const still = X.cameraTrack(keys, view, undefined, { drift: 0, duration: 12 });
  assert.deepEqual(still.at(5), still.at(11.9));
  // a shot shorter than 2.5 s does not drift
  const short = [{ t: 0.5, ...cam0 }, { t: 2.5, ...view.wide }];
  assert.deepEqual(X.cameraTrack(short, view, undefined, { drift: 0.05, duration: 2.9 }).at(2.2), X.cameraTrack(short, view, undefined, { drift: 0, duration: 2.9 }).at(2.2));
});

test('K2: at the zoom ceiling the hold pans instead of zooming (zMax is never exceeded)', () => {
  const content = { x: 0, y: 0, w: 1440, h: 900 };
  const view = X.makeView({ content, viewW: 1655, viewH: 931, zMax: 1.5, fill: 0.6, padding: 44 });
  const keys = [{ t: 0.5, cx: 620, cy: 400, z: 1.5, why: 'shot' }];
  const trk = X.cameraTrack(keys, view, undefined, { drift: 0.05, duration: 12 });
  for (const t of [1.6, 6, 11.9]) assert.ok(trk.at(t).z <= 1.5 + 1e-9);
  assert.ok(Math.abs(trk.at(11.9).cx - trk.at(1.6).cx) * 1.5 > 5, 'pans a few px');
});

test('K2: ui-demo default drift leaves no 5 s static hold; drift 0 on a frozen capture fails static-hold', () => {
  const cap = dashCap();
  const hold = [{ at: 2, hold: 8 }]; // the picture is frozen for 8 s (a reading hold / still): only the camera can move
  const on = build(cap, { content: { camera: 'wide', retime: hold } });
  assert.equal(check(on, 'static-hold').status, 'pass', check(on, 'static-hold').detail);
  const off = build(cap, { content: { camera: 'wide', retime: hold }, params: { drift: 0 } });
  assert.equal(check(off, 'static-hold').status, 'fail');
  assert.match(check(off, 'static-hold').detail, /longer than 5 s/);
});

test('K3: a zoomed edge within 12 % of the capture edge snaps to it when the target still fits', () => {
  const content = { x: 0, y: 0, w: 1440, h: 900 };
  const hw = 1655 / (2 * 1.5), hh = 931 / (2 * 1.5);
  const c = { cx: hw + 90, cy: hh + 40, z: 1.5 }; // left edge 90 px, top edge 40 px from the capture edge (limits 172.8 / 108)
  const out = X.snapView(c, { x: 300, y: 150, w: 300, h: 130 }, content, 1655, 931, { keep: 22 });
  assert.ok(Math.abs(out.cx - hw) < 1e-9 && Math.abs(out.cy - hh) < 1e-9, JSON.stringify(out));
  // ...but not when the target would then fall out of the view
  const far = X.snapView({ ...c, cx: hw + 150, cy: 450 }, { x: 800, y: 300, w: 300, h: 130 }, content, 1655, 931, { keep: 22 });
  assert.ok(far.cx - hw > 100 || Math.abs(far.cx - hw) < 1e-9 && 800 - 22 >= 0, 'only snaps when it fits');
  const miss = X.snapView({ cx: hw + 150, cy: 450, z: 1.5 }, { x: 1000, y: 300, w: 300, h: 130 }, content, 1655, 931, { keep: 22 });
  assert.ok(miss.cx - hw > 100, 'a target out of reach of the left edge keeps its framing');
  // the far edge snaps too (a card cut at the right)
  const r = X.snapView({ cx: 1440 - hw - 80, cy: 450, z: 1.5 }, { x: 1000, y: 300, w: 300, h: 130 }, content, 1655, 931, { keep: 22 });
  assert.ok(Math.abs(r.cx + hw - 1440) < 1e-9);
});

test('K3: view.frame prefers framings whose edges do not slice a context card (the third KPI cut at the right)', () => {
  const content = { x: 0, y: -40, w: 1440, h: 940 };
  const cards = [60, 330, 600, 870].map((x) => ({ x, y: 200, w: 250, h: 130 }));
  const sliced = (cam) => { const hw = 1655 / (2 * cam.z); return cards.filter((b) => [cam.cx - hw, cam.cx + hw].some((e) => b.x + 3 < e && e < b.x + b.w - 3)).length; };
  const plain = X.makeView({ content, viewW: 1655, viewH: 931, zMax: 2.4, fill: 0.6, padding: 44 });
  const smart = X.makeView({ content, viewW: 1655, viewH: 931, zMax: 2.4, fill: 0.6, padding: 44, context: cards });
  let better = 0;
  for (const c of cards) {
    const a = plain.frame(c), b = smart.frame(c);
    assert.ok(sliced(b) <= sliced(a));
    assert.ok(smart.shows(b, c, 0), 'target fully inside');
    better += sliced(a) - sliced(b);
  }
  assert.ok(better >= 1, `the context rule removed ${better} slices`);
});

test('K4: placeCallout prefers a plate that touches no other element and lies on the ground over the window', () => {
  const safe = { x: 40, y: 40, w: 1840, h: 1000 };
  const target = { x: 800, y: 300, w: 300, h: 130 };
  const win = { x: 100, y: 100, w: 1500, h: 900 };
  const winTop = { x: 100, y: 300, w: 1500, h: 700 };
  const neighbour = { x: 1150, y: 280, w: 260, h: 60 }; // a label right of the target
  const plain = X.placeCallout(target, 330, 64, safe, { gap: 40 });
  assert.equal(plain.side, 'right', 'default order picks right (and would sit on the neighbour)');
  const smart = X.placeCallout(target, 330, 64, safe, { gap: 40, soft: [neighbour], ui: win });
  assert.notEqual(smart.side, 'right');
  assert.equal(smart.softHits, 0);
  // all sides clear of neighbours: a plate on the ground (outside the window) beats one over it
  const tt = { x: 800, y: 260, w: 250, h: 100 }, sf = { x: 40, y: 20, w: 1840, h: 1040 };
  assert.equal(X.placeCallout(tt, 330, 64, sf, { gap: 40 }).side, 'right');
  const ground = X.placeCallout(tt, 330, 64, sf, { gap: 40, ui: winTop });
  assert.equal(ground.side, 'above');
  assert.ok(ground.uiFrac <= 0.05, `uiFrac ${ground.uiFrac}`);
});

test('K4: the scene warns when a callout plate has to cover another element of the captured UI', () => {
  // neighbour boxes all around the target: any plate position covers one
  const around = [{ x: 700, y: 20, w: 560, h: 160 }, { x: 80, y: 180, w: 520, h: 300 }, { x: 1000, y: 180, w: 420, h: 300 }, { x: 600, y: 360, w: 400, h: 520 }, { x: 80, y: 500, w: 500, h: 380 }, { x: 1020, y: 500, w: 400, h: 380 }]
    .map((b, i) => ({ type: 'observe', step: `n${i}`, t: 1.6 + i * 0.01, box: b, ...track(b) }));
  const co = { callouts: [{ at: 'kpi', text: 'Forfalt 14 800 kr', duration: 3 }] };
  const qa = build(dashCap(around), { content: co });
  const clean = build(dashCap(), { content: co });
  assert.ok(!clean.warnings.some((w) => /plate covers/.test(w)), clean.warnings.join('|'));
  assert.ok(qa.warnings.some((w) => /plate covers|could not avoid/.test(w)), qa.warnings.join('|'));
});

test('K5: every overlay text role (callout plate, footnote chip, URL label) is checked at 4.5:1 and a bad palette fails', () => {
  const content = { footnote: 'Demodata', urlLabel: 'app.example.com', callouts: [{ at: 'kpi', text: 'Forfalt 14 800 kr' }] };
  const ok = build(dashCap(), { content });
  const c = check(ok, 'overlay-contrast');
  assert.equal(c.status, 'pass', c.detail);
  for (const role of ['callout 1', 'footnote', 'url label']) assert.ok(c.detail.includes(role), `${role} in: ${c.detail}`);
  // band mode: the chip sits on the ground with the label plate roles
  const band = build(dashCap(), { content, params: { bandBottom: 0.12, footnoteBand: true } });
  assert.equal(check(band, 'overlay-contrast').status, 'pass');
  // a washed-out chromeInk on the title bar is caught (the URL label is ours)
  const bad = build(dashCap(), { content, palette: { chromeInk: '#C9C8C4' } });
  assert.equal(check(bad, 'overlay-contrast').status, 'fail');
  assert.match(check(bad, 'overlay-contrast').detail, /url label/);
});
