import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as X from '../src/kit/x-ui.js';

// A small synthetic capture (CSS px of a 1440×900 viewport).
const CAP = {
  schema: 'kinetype.capture.v1', flow: 't', fps: 30, duration: 10,
  marks: [{ id: 'open', t: 0.5 }, { id: 'sent', t: 8 }],
  steps: [{ id: 'new', t0: 1, t1: 2 }, { id: 'name', t0: 2.5, t1: 4.2 }, { id: 'save', t0: 5, t1: 5.6 }],
  events: [
    { t: 1.5, type: 'click', step: 'new', point: { x: 1300, y: 30 }, box: { x: 1240, y: 12, w: 130, h: 36 } },
    { t: 2.6, type: 'click', step: 'name', point: { x: 560, y: 320 }, box: { x: 460, y: 300, w: 520, h: 42 } },
    { t: 2.75, type: 'type', step: 'name', box: { x: 460, y: 300, w: 520, h: 42 }, text: 'Harbor renovation', t1: 4.0 },
    { t: 5.3, type: 'click', step: 'save', point: { x: 900, y: 600 }, box: { x: 840, y: 582, w: 140, h: 38 } },
    { t: 6.0, type: 'navigate', step: 'go', url: '/p/1' },
    { t: 9.0, type: 'click', step: 'late', point: { x: 200, y: 700 }, box: { x: 150, y: 680, w: 100, h: 40 } },
  ],
};

test('retime: identity without range/retime; range trims by mark ids', () => {
  const r = X.buildRetime(CAP);
  assert.equal(r.duration, 10);
  for (const t of [0, 1.234, 9.99]) assert.equal(r.toCapture(t), t);
  const r2 = X.buildRetime(CAP, { range: { from: 'open', to: 'sent' } });
  assert.ok(Math.abs(r2.duration - 7.5) < 1e-9);
  assert.equal(r2.toCapture(0), 0.5);
  assert.equal(r2.toCapture(7.5), 8);
});

test('retime: speed segments + holds are monotone, piecewise linear, and invert exactly', () => {
  const r = X.buildRetime(CAP, { retime: [{ from: 'new', to: 'name', speed: 2 }, { at: 'sent', hold: 1.2 }, { from: 'save', to: 9, speed: 0.5 }] });
  // 1..2.5 at 2x = 0.75 s; 5..9 at 0.5x = 8 s; hold 1.2 s; rest 1x (1 + 2.5 + 1)
  assert.ok(Math.abs(r.duration - (1 + 0.75 + 2.5 + 8 + 1.2 + 1)) < 1e-9, String(r.duration));
  let prev = -Infinity;
  for (let t = 0; t <= r.duration; t += 0.01) { const c = r.toCapture(t); assert.ok(c >= prev - 1e-12, `monotone at ${t}`); prev = c; }
  // the hold freezes capture time just before the mark; the mark plays after it
  const hf = r.toFilmFirst(8);
  assert.ok(Math.abs(r.toFilm(8) - (hf + 1.2)) < 1e-9);
  assert.ok(r.toCapture(hf + 0.6) < 8 && r.toCapture(hf + 0.6) > 8 - 1e-3);
  assert.ok(Math.abs(r.toCapture(hf + 1.2 + 0.5) - 8.25) < 1e-9);
  // round trip on linear pieces
  for (const c of [0.3, 1.2, 2.4, 3, 5.5, 8.9, 9.7]) assert.ok(Math.abs(r.toCapture(r.toFilm(c)) - c) < 1e-9, `round trip ${c}`);
});

test('retime_hold_before_event: a hold at X freezes the frame BEFORE X; the event at X plays after the hold; holds at one X add up', () => {
  const fps = 30;
  const r = X.buildRetime(CAP, { retime: [{ at: 'new', hold: 1.0 }, { at: 'new', hold: 0.5 }] }); // step "new" t0 = 1.0
  const X0 = 1.0;
  assert.ok(Math.abs(r.duration - (10 + 1.5)) < 1e-9);
  const hs = r.toFilmFirst(X0), he = r.toFilm(X0);
  assert.ok(Math.abs(hs - 1.0) < 1e-9 && Math.abs(he - 2.5) < 1e-9, `${hs} ${he}`);
  // every film time inside the freeze shows the frame just before X (frame 29 for X = 1.0 s at 30 fps)
  for (const t of [hs + 0.01, hs + 0.7, he - 0.01]) assert.equal(Math.floor(r.toCapture(t) * fps + 1e-6), 29, `t=${t}`);
  // the frame AT X (frame 30) first shows after the hold
  assert.equal(Math.floor(r.toCapture(he) * fps + 1e-6), 30);
  // an event exactly at X lands after the hold on the film clock
  const cap = { ...CAP, events: [{ t: 1.0, type: 'click', step: 'new', point: { x: 1, y: 1 }, box: { x: 0, y: 0, w: 2, h: 2 } }] };
  assert.ok(Math.abs(X.filmEvents(cap, r)[0].t - 2.5) < 1e-9);
});

test('retime: bad input fails loudly', () => {
  assert.throws(() => X.buildRetime(CAP, { range: { from: 'nope' } }), /not a mark or step/);
  assert.throws(() => X.buildRetime(CAP, { retime: [{ from: 1, to: 3, speed: 2 }, { from: 2, to: 4, speed: 1.5 }] }), /overlap/);
  assert.throws(() => X.buildRetime(CAP, { range: { from: 5, to: 2 } }), /must come after/);
});

const VIEW = () => X.makeView({ content: { x: 0, y: -40, w: 1440, h: 940 }, viewW: 1440 / 0.82, viewH: 940 / 0.82, zMax: 2.2 });

test('camera planner: anticipates events, frames targets without cropping, honours zoom limits', () => {
  const rt = X.buildRetime(CAP);
  const evs = X.filmEvents(CAP, rt);
  const view = VIEW();
  const keys = X.planCamera(evs, view, { duration: rt.duration });
  assert.ok(keys.length >= 3);
  const cam = X.cameraTrack(keys, view);
  for (const e of evs.filter((x) => x.box)) {
    const k = keys.filter((q) => q.t <= e.t).at(-1);
    assert.ok(k && k.t <= e.t - 0.3, `camera moves before the event at ${e.t}`);
    const c = cam.at(e.t + 0.6); // settled-ish
    assert.ok(c.z >= 1 - 1e-9 && c.z <= view.zMax + 1e-9, `zoom ${c.z}`);
    assert.ok(view.shows(c, e.box), `target of ${e.step} on screen at ${e.t + 0.6}: ${JSON.stringify(c)}`);
  }
  // return to wide around the navigation
  const nav = evs.find((e) => e.type === 'navigate');
  assert.ok(Math.abs(cam.at(nav.t + 0.9).z - 1) < 0.05, 'wide after navigation');
  // deterministic + seek-order independent
  const a = [0.1, 2, 4, 7].map((t) => cam.at(t)), b = [7, 4, 2, 0.1].map((t) => cam.at(t)).reverse();
  assert.deepEqual(a, b);
});

test('camera planner: critically damped (never overshoots the target zoom)', () => {
  const view = VIEW();
  const keys = [{ t: 1, cx: 700, cy: 300, z: 2 }];
  const cam = X.cameraTrack(keys, view);
  let peak = 0;
  for (let t = 1; t < 5; t += 0.005) peak = Math.max(peak, cam.at(t).z);
  assert.ok(peak <= 2 + 1e-9, `peak ${peak}`);
  assert.equal(cam.at(10).z, 2);
});

test('camera: frame() respects the source-resolution ceiling and fills ~60% of the width', () => {
  const view = X.makeView({ content: { x: 0, y: -40, w: 1440, h: 940 }, viewW: 1440 / 0.82, viewH: 940 / 0.82, zMax: 2.2, minTarget: 0 });
  const tiny = view.frame({ x: 600, y: 400, w: 40, h: 20 });
  assert.equal(tiny.z, 2.2);
  // with context (default): a lone button is framed with its neighbourhood, not punched into
  const ctxView = VIEW();
  const lone = ctxView.frame({ x: 600, y: 400, w: 40, h: 20 });
  assert.ok(lone.z > 1.4 && lone.z < 2.2, String(lone.z));
  const mid = view.frame({ x: 400, y: 300, w: 700, h: 200 });
  const shownW = (700 + 2 * view.padding) * mid.z / view.viewW;
  assert.ok(Math.abs(shownW - 0.6) < 0.01, String(shownW));
});

test('camera planner: far pans between zoomed shots arc out, then push in', () => {
  const view = VIEW();
  const evs = [
    { t: 1, type: 'click', step: 'a', point: { x: 1300, y: 30 }, box: { x: 1260, y: 14, w: 90, h: 32 } },
    { t: 2.2, type: 'click', step: 'b', point: { x: 200, y: 800 }, box: { x: 150, y: 780, w: 110, h: 40 } },
  ];
  const keys = X.planCamera(evs, view);
  const arc = keys.find((k) => k.why === 'arc out');
  assert.ok(arc, JSON.stringify(keys));
  const cam = X.cameraTrack(keys, view);
  let minZ = Infinity;
  for (let t = 1.2; t < 2.2; t += 0.01) minZ = Math.min(minZ, cam.at(t).z);
  const shots = keys.filter((k) => k.why.startsWith('shot'));
  assert.ok(minZ < Math.min(shots[0].z, shots[1].z) * 0.9, `pulled back mid-pan (min zoom ${minZ})`);
  assert.ok(view.shows(cam.at(2.6), evs[1].box), 'second target framed after the move');
});

test('callout plan: "before" lands in the quiet moment before the click and freezes for reading', () => {
  const rt = X.buildRetime(CAP);
  const [p] = X.calloutPlan(CAP, rt, [{ ct: 1.5, text: 'Start a project in one click', when: 'before' }]);
  assert.ok(p.at < 1.5 && p.at >= 1.5 - 0.35, JSON.stringify(p));
  const rt2 = X.buildRetime(CAP, { retime: X.planHolds([p]) });
  const shown = rt2.toFilm(1.5) + 0.35 - rt2.toFilmFirst(p.at);
  assert.ok(shown >= X.readTime('Start a project in one click') - 1e-6, String(shown));
  assert.ok(Math.abs(rt2.toCapture(rt2.toFilmFirst(p.at) + 0.5) - p.at) < 1e-3, 'capture frozen at the landing point');
});

test('callout plan: "after" freezes before the next action when it would come too soon', () => {
  const rt = X.buildRetime(CAP);
  const plan = X.calloutPlan(CAP, rt, [{ ct: 1.5, text: 'Start a project in one click', when: 'after' }]);
  const holds = X.planHolds(plan);
  assert.equal(holds.length, 1);
  assert.ok(holds[0].at > 1.5 && holds[0].at < 2.6, JSON.stringify(holds));
  const rt2 = X.buildRetime(CAP, { retime: holds });
  const avail = rt2.toFilm(2.6) - 0.42 - (rt2.toFilm(1.5) + 0.18);
  assert.ok(avail >= X.readTime('Start a project in one click') - 1e-6, String(avail));
});

test('cursor: arrives before each click, minimum-jerk (no velocity jump), hides while typing', () => {
  const rt = X.buildRetime(CAP);
  const evs = X.filmEvents(CAP, rt);
  const cur = X.planCursor(evs, { seed: 3 });
  for (const e of evs.filter((x) => x.type === 'click')) {
    const p = cur.at(e.t - 0.12 + 1e-6);
    assert.ok(Math.hypot(p.x - e.point.x, p.y - e.point.y) < 0.5, `on target 0.12s before click at ${e.t}`);
    assert.ok(cur.at(e.t).press > 0.9, 'pressed at the click');
  }
  // velocity is ~0 at both ends of every move (minimum jerk)
  for (const m of cur.moves) {
    const v0 = Math.hypot(cur.at(m.t0 + 0.004).x - cur.at(m.t0).x, cur.at(m.t0 + 0.004).y - cur.at(m.t0).y);
    const vMid = Math.hypot(cur.at((m.t0 + m.t1) / 2 + 0.002).x - cur.at((m.t0 + m.t1) / 2 - 0.002).x, cur.at((m.t0 + m.t1) / 2 + 0.002).y - cur.at((m.t0 + m.t1) / 2 - 0.002).y);
    assert.ok(v0 < vMid * 0.05, `smooth start (${v0} vs ${vMid})`);
  }
  // typing hides it
  const ty = evs.find((e) => e.type === 'type');
  assert.equal(cur.at((ty.t + ty.t1) / 2).alpha, 0);
  assert.equal(cur.at(0).alpha, 1);
  // pure
  assert.deepEqual([1, 2, 3].map(cur.at), [3, 2, 1].map(cur.at).reverse());
});

test('callout placement: never covers the target, stays inside the safe area', () => {
  const safe = { x: 60, y: 60, w: 1800, h: 960 };
  for (const target of [{ x: 1700, y: 100, w: 120, h: 40 }, { x: 80, y: 900, w: 300, h: 60 }, { x: 800, y: 500, w: 300, h: 50 }]) {
    const p = X.placeCallout(target, 360, 70, safe);
    const box = { x: p.x, y: p.y, w: 360, h: 70 };
    assert.ok(!X.overlaps(box, target), `covers target ${JSON.stringify(target)} → ${p.side}`);
    assert.ok(p.x >= safe.x && p.y >= safe.y && p.x + 360 <= safe.x + safe.w && p.y + 70 <= safe.y + safe.h);
  }
});

test('camera speed cap: no move exceeds ~0.8 frame widths/s; far zoomed targets cut instead of panning', () => {
  const view = VIEW();
  const evs = [
    { t: 1, type: 'click', step: 'a', point: { x: 1380, y: 20 }, box: { x: 1360, y: 8, w: 60, h: 28 } },
    { t: 2.6, type: 'click', step: 'b', point: { x: 60, y: 880 }, box: { x: 30, y: 860, w: 80, h: 30 } },
    { t: 4.2, type: 'click', step: 'c', point: { x: 700, y: 450 }, box: { x: 600, y: 430, w: 300, h: 40 } },
  ];
  const v2 = X.makeView({ content: { x: 0, y: -40, w: 1440, h: 940 }, viewW: 1440 / 0.82, viewH: 940 / 0.82, zMax: 2.2, minTarget: 0.1 });
  const keys = X.planCamera(evs, v2);
  assert.ok(keys.some((k) => k.cut), `far zoomed pan becomes a cut: ${JSON.stringify(keys.map((k) => [k.t.toFixed(2), k.z.toFixed(2), k.why]))}`);
  const cam = X.cameraTrack(keys, v2, undefined, { fps: 30 });
  let peak = 0;
  for (let t = 0; t < 8; t += 1 / 120) peak = Math.max(peak, cam.speed(t, 1 / 120) / v2.viewW);
  assert.ok(peak <= 1.05, `peak screen speed ${peak.toFixed(2)} frame widths/s`);
  // the cut lands just after a frame boundary: the frame before it is all old framing, the frame after all new
  const k = keys.find((q) => q.cut), tc = Math.ceil(k.t * 30 - 1e-9) / 30;
  assert.notDeepEqual(cam.at(tc), cam.at(tc + 1 / 30));
  const a1 = cam.at(tc + 1 / 30 - 0.5 / 30), a2 = cam.at(tc + 1 / 30);
  assert.ok(Math.hypot(a1.cx - a2.cx, a1.cy - a2.cy) * a2.z < 0.004 * v2.viewW, 'no visible drift right after the cut');
});

test('trackAt: per capture frame, on-change entries, fail-closed outside the track or for untracked events', () => {
  const ev = { t: 1, box: { x: 0, y: 0, w: 10, h: 10 }, track: [{ t: 0.9, box: { x: 0, y: 0, w: 10, h: 10 }, visible: true }, { t: 1.2, box: { x: 0, y: -50, w: 10, h: 10 }, visible: true }, { t: 1.5, box: { x: 0, y: -50, w: 10, h: 10 }, visible: false }, { t: 1.6, visible: false }], trackEnd: 2 };
  const fps = 30;
  assert.equal(X.trackAt(ev, 26, fps).visible, false, 'before the track');
  assert.deepEqual(X.trackAt(ev, 27, fps), { visible: true, box: { x: 0, y: 0, w: 10, h: 10 } });
  assert.deepEqual(X.trackAt(ev, 35, fps).box, { x: 0, y: 0, w: 10, h: 10 });
  assert.deepEqual(X.trackAt(ev, 36, fps).box, { x: 0, y: -50, w: 10, h: 10 }, 'follows the scroll on its frame');
  assert.equal(X.trackAt(ev, 45, fps).visible, false, 'covered');
  assert.equal(X.trackAt(ev, 48, fps).visible, false, 'gone');
  assert.equal(X.trackAt(ev, 60, fps).visible, false, 'after trackEnd');
  assert.equal(X.trackAt({ t: 1, box: ev.box }, 30, fps), null, 'untracked (legacy) → unknown');
});

test('stageMap: one map for frames and overlays — pt/box equal the canvas transform it applies', () => {
  const m = X.stageMap({ W: 1920, H: 1000, s: 1.2345 });
  const c = { cx: 611.3, cy: 402.7, z: 1.731 };
  // emulate g.translate/scale/translate as a matrix
  const M = { a: 1, d: 1, e: 0, f: 0 };
  const g = { translate: (x, y) => { M.e += M.a * x; M.f += M.d * y; }, scale: (sx, sy) => { M.a *= sx; M.d *= sy; } };
  m.apply(g, c);
  for (const [x, y] of [[0, 0], [1440, 900], [273.5, 407.13]]) {
    const p = m.pt(c, x, y);
    assert.ok(Math.abs(p.x - (M.a * x + M.e)) < 1e-9 && Math.abs(p.y - (M.d * y + M.f)) < 1e-9);
  }
  const b = m.box(c, { x: 10, y: 20, w: 30, h: 40 });
  assert.ok(Math.abs(b.w - 30 * 1.2345 * 1.731) < 1e-9 && Math.abs(b.x - m.pt(c, 10, 20).x) < 1e-12);
});

test('cursor: the tip is exactly on the click point at the click, even when clicks come fast', () => {
  const evs = [
    { t: 0.5, type: 'click', point: { x: 100, y: 100 } },
    { t: 0.62, type: 'click', point: { x: 900, y: 600 } },
    { t: 0.7, type: 'click', point: { x: 120, y: 700 } },
    { t: 3, type: 'click', point: { x: 1300, y: 40 } },
  ];
  const cur = X.planCursor(evs, { seed: 3, start: { x: 700, y: 450 } });
  for (const e of evs) { const p = cur.at(e.t); assert.ok(Math.hypot(p.x - e.point.x, p.y - e.point.y) < 1e-6, `at ${e.t}: ${p.x},${p.y}`); }
});

test('cursor: a hover just before a click never leaves the tip off the click point (moves never overlap)', () => {
  const evs = [
    { t: 0.85, type: 'click', point: { x: 100, y: 100 } },
    { t: 1.0, type: 'hover', point: { x: 1200, y: 800 } },
    { t: 1.1, type: 'click', point: { x: 300, y: 500 } },
  ];
  const cur = X.planCursor(evs, { seed: 5, start: { x: 700, y: 450 } });
  for (const e of evs.filter((x) => x.type === 'click')) { const p = cur.at(e.t); assert.ok(Math.hypot(p.x - e.point.x, p.y - e.point.y) < 1e-6, `at ${e.t}: ${p.x},${p.y}`); }
  for (let i = 1; i < cur.moves.length; i++) assert.ok(cur.moves[i].t0 >= cur.moves[i - 1].t1 - 1e-9, 'moves do not overlap');
});
