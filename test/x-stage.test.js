// ui-stage kit: composed map (stage × panel camera), panel clocks, layout
// interpolation, story clock + digit roll, connector geometry — all pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/kit/x-stage.js';
import { frameRect } from '../src/kit/x-ui.js';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test('composeMap equals the independent matrix product, for any stage × camera', () => {
  const geo = { sw: 390, sh: 844, zMin: 1.12 };
  for (const T of [{ x: 0, y: 0, k: 1 }, { x: 224.5, y: 142.25, k: 0.967 }, { x: -40, y: 900, k: 0.31 }]) {
    for (const cam of [{ cx: 195, cy: 422, z: 1 }, { cx: 120, cy: 600, z: 1.9 }, { cx: 300.7, cy: 80.1, z: 2.4 }]) {
      const mp = S.composeMap(T, cam, geo), m = S.composeMatrix(T, cam, geo);
      for (const [x, y] of [[0, 0], [390, 844], [17.3, 611.9]]) {
        const a = mp.pt(x, y), b = S.applyMatrix(m, x, y);
        assert.ok(close(a.x, b.x, 1e-9) && close(a.y, b.y, 1e-9), `${JSON.stringify({ T, cam, x, y, a, b })}`);
      }
      const bx = { x: 40, y: 500, w: 310, h: 52 }, r1 = mp.box(bx), r2 = S.matrixBox(m, bx);
      for (const k of ['x', 'y', 'w', 'h']) assert.ok(close(r1[k], r2[k], 1e-9));
      assert.ok(close(mp.K, T.k * geo.zMin * cam.z, 1e-12));
    }
  }
});

test('composeMap: the camera centre lands on the screen centre; src is exactly the visible region', () => {
  const T = { x: 100, y: 50, k: 0.8 }, geo = { sw: 1440, sh: 900, zMin: 1.25 }, cam = { cx: 500, cy: 300, z: 1.6 };
  const mp = S.composeMap(T, cam, geo);
  const c = mp.pt(cam.cx, cam.cy);
  assert.ok(close(c.x, T.x + T.k * geo.sw / 2) && close(c.y, T.y + T.k * geo.sh / 2));
  // the visible capture region maps onto the screen rect exactly
  const r = mp.box(mp.src);
  for (const k of ['x', 'y', 'w', 'h']) assert.ok(close(r[k], mp.screen[k], 1e-9), k);
  // identity: unit stage, no zoom, centred camera → capture px = screen px offset by T
  const id = S.composeMap({ x: 10, y: 20, k: 1 }, { cx: 195, cy: 422, z: 1 }, { sw: 390, sh: 844, zMin: 1 });
  assert.deepEqual(id.pt(0, 0), { x: 10, y: 20 });
});

test('panelClock: holds the first frame before start and the last after its end', () => {
  const c = S.panelClock({ start: 1.6, duration: 4 });
  assert.equal(c.localT(0), 0);
  assert.equal(c.localT(1.6), 0);
  assert.ok(close(c.localT(2.1), 0.5));
  assert.equal(c.localT(99), 4);
  assert.equal(c.end, 5.6);
  assert.equal(c.running(1.5), false);
  assert.equal(c.running(3), true);
});

test('filmRef: seconds, panel:mark and panel:mark+offset', () => {
  const resolve = (p, r) => { if (p === 'owner' && r === 'beat-dagen') return 3.25; throw new Error('nope'); };
  assert.equal(S.filmRef(2, resolve), 2);
  assert.equal(S.filmRef('owner:beat-dagen', resolve), 3.25);
  assert.ok(close(S.filmRef('owner:beat-dagen+0.4', resolve), 3.65));
  assert.ok(close(S.filmRef('owner:beat-dagen-0.25', resolve), 3.0));
  assert.throws(() => S.filmRef('justtext', resolve), /panel:mark/);
});

const PHONE = frameRect('phone', 390, 844), DESK = frameRect('browser', 1440, 900);
const AREA = { x: 48, y: 48, w: 1824, h: 984 };

test('arrange dual: focus device full height, the other scaled by rho, both inside, apart, centred', () => {
  const items = [{ id: 'fit', frame: PHONE, labelH: 40 }, { id: 'own', frame: DESK, labelH: 40 }];
  const pl = S.arrange('dual', items, 'fit', AREA, { gap: 64, rho: 0.78 });
  const a = S.frameOut(pl.get('fit'), PHONE), b = S.frameOut(pl.get('own'), DESK);
  assert.ok(close(a.h, AREA.h - 40, 1e-6), `phone fills the height minus its label: ${a.h}`);
  const kFitDesk = Math.min((AREA.h - 40) / DESK.h, AREA.w / DESK.w);
  assert.ok(close(pl.get('own').k, kFitDesk * 0.78, 1e-9));
  assert.ok(a.x + a.w + 64 <= b.x + 1e-6, 'gap kept');
  assert.ok(close((a.x + (b.x + b.w)) / 2, AREA.x + AREA.w / 2, 1e-6), 'row centred');
  assert.ok(a.x >= AREA.x && b.x + b.w <= AREA.x + AREA.w + 1e-6);
  // desktop focus: the row is width-bound → everything shrinks together (λ < 1) and still fits
  const p2 = S.arrange('dual', items, 'own', AREA, { gap: 64, rho: 0.78 });
  const a2 = S.frameOut(p2.get('fit'), PHONE), b2 = S.frameOut(p2.get('own'), DESK);
  assert.ok(close(a2.w + b2.w + 64, AREA.w, 1e-6) || a2.w + b2.w + 64 < AREA.w, 'fits the width');
  assert.ok(b2.w > a2.w * 2, 'desktop dominates when focused');
  assert.ok(p2.get('own').k > pl.get('own').k, 'focused desktop is larger than unfocused');
});

test('arrange: triad and stack3 fit; wrong counts and names throw', () => {
  const tri = S.arrange('triad', [{ id: 'a', frame: PHONE }, { id: 'b', frame: DESK }, { id: 'c', frame: PHONE }], 'b', AREA, { gap: 48 });
  const rs = ['a', 'b', 'c'].map((id) => S.frameOut(tri.get(id), id === 'b' ? DESK : PHONE));
  assert.ok(rs[0].x + rs[0].w <= rs[1].x && rs[1].x + rs[1].w <= rs[2].x, 'left to right, no overlap');
  for (const r of rs) assert.ok(S.rectInside(r, AREA, 1e-6), JSON.stringify(r));
  const V = { x: 48, y: 106, w: 984, h: 1500 };
  const st = S.arrange('stack3', [{ id: 'a', frame: PHONE, labelH: 30 }, { id: 'b', frame: { x: 0, y: -40, w: 720, h: 520 }, labelH: 30 }, { id: 'c', frame: PHONE, labelH: 30 }], 'b', V, { gap: 30 });
  const vs = ['a', 'b', 'c'].map((id) => S.frameOut(st.get(id), id === 'b' ? { x: 0, y: -40, w: 720, h: 520 } : PHONE));
  assert.ok(vs[0].y + vs[0].h + 30 <= vs[1].y + 1e-6 && vs[1].y + vs[1].h + 30 <= vs[2].y + 1e-6, 'top to bottom with labels');
  for (const r of vs) assert.ok(S.rectInside(r, V, 1e-6), JSON.stringify(r));
  assert.throws(() => S.arrange('dual', [{ id: 'a', frame: PHONE }], 'a', AREA), /shows 2/);
  assert.throws(() => S.arrange('quad', [], 'a', AREA), /unknown arrangement/);
});

test('layoutTrack: settled states exact, transitions eased, interrupted transitions continuous, enter/exit fade about the centre', () => {
  const frames = { a: PHONE, b: DESK };
  const place = (k) => S.arrange(k.arrangement, k.panels.map((id) => ({ id, frame: frames[id] })), k.focus, AREA, { gap: 64 });
  const keys = [
    { t: 0, arrangement: 'solo', focus: 'a', panels: ['a'], dur: 0 },
    { t: 2, arrangement: 'dual', focus: 'a', panels: ['a', 'b'], dur: 0.6 },
    { t: 4, arrangement: 'dual', focus: 'b', panels: ['a', 'b'], dur: 0.6 },
    { t: 4.3, arrangement: 'dual', focus: 'a', panels: ['a', 'b'], dur: 0.6 }, // interrupts the previous one
  ];
  const L = S.layoutTrack(keys, ['a', 'b'], place, frames);
  assert.deepEqual(L.state(1), L.settled[0]);
  assert.equal(L.state(1).b.alpha, 0);
  assert.deepEqual(L.state(3), L.settled[1]);
  // b enters at its destination, growing about its centre
  const mid = L.state(2.3).b, dst = L.settled[1].b;
  const c = (s, fr) => ({ x: s.x + s.k * (fr.x + fr.w / 2), y: s.y + s.k * (fr.y + fr.h / 2) });
  assert.ok(mid.alpha > 0 && mid.alpha < 1);
  assert.ok(close(c(mid, DESK).x, c(dst, DESK).x, 1e-6) && close(c(mid, DESK).y, c(dst, DESK).y, 1e-6), 'centre fixed while it grows in');
  // continuity at every key time (no jumps), including the interrupted one
  for (const tk of [2, 4, 4.3]) {
    const a = L.state(tk - 1e-9), b = L.state(tk + 1e-9);
    for (const id of ['a', 'b']) for (const k of ['x', 'y', 'k', 'alpha', 'focus']) assert.ok(Math.abs(a[id][k] - b[id][k]) < 1e-3, `${id}.${k} jumps at ${tk}: ${a[id][k]} → ${b[id][k]}`);
  }
  assert.equal(L.moving(4.1), true);
  assert.equal(L.moving(5.5), false);
  assert.throws(() => S.layoutTrack([keys[0], { ...keys[1], t: 0 }], ['a', 'b'], place, frames), /strictly increasing/);
});

test('clockTrack: monotonic keys, deterministic roll; a clock running backwards throws', () => {
  const C = S.clockTrack([{ t: 0, time: '10:13' }, { t: 2, time: '10:15', roll: true }, { t: 5, time: '15:30', roll: false }], { rollDur: 0.6 });
  assert.deepEqual(C.at(1), { from: '10:13', to: '10:13', u: 1 });
  const r = C.at(2.3);
  assert.equal(r.from, '10:13'); assert.equal(r.to, '10:15'); assert.ok(close(r.u, 0.5, 1e-9));
  assert.deepEqual(C.at(2.3), C.at(2.3), 'pure');
  assert.deepEqual(C.at(3), { from: '10:15', to: '10:15', u: 1 });
  assert.deepEqual(C.at(5), { from: '15:30', to: '15:30', u: 1 }, 'an unrolled key cuts');
  assert.throws(() => S.clockTrack([{ t: 0, time: '10:15' }, { t: 1, time: '10:13' }]), /backwards/);
  assert.throws(() => S.clockTrack([{ t: 1, time: '10:15' }, { t: 1, time: '10:16' }]), /strictly increasing/);
  assert.throws(() => S.parseClock('24:00'), /HH:MM/);
});

test('rollDigits: only changed characters move, minutes lead, all settle at u=1', () => {
  const a = S.rollDigits('11:54', '15:30', 0.3);
  assert.equal(a[0].u, 1); assert.equal(a[2].u, 1); // '1' and ':' unchanged
  assert.ok(a[4].u > a[3].u && a[3].u > a[1].u, 'right to left');
  for (const c of S.rollDigits('11:54', '15:30', 1)) assert.equal(c.u, 1);
  for (const c of S.rollDigits('11:54', '15:30', 0)) assert.ok(c.u === 1 || c.u === 0);
});

test('connector geometry: anchors face each other across a row; the arc starts/ends exactly on them', () => {
  const A = { x: 300, y: 600, w: 300, h: 50 }, B = { x: 900, y: 400, w: 400, h: 44 };
  const a = S.anchorToward(A, { x: B.x + B.w / 2, y: B.y + B.h / 2 }), b = S.anchorToward(B, { x: A.x + A.w / 2, y: A.y + A.h / 2 });
  assert.deepEqual(a, { x: 600, y: 625, side: 'right' });
  assert.deepEqual(b, { x: 900, y: 422, side: 'left' });
  const arc = S.arcPath(a, b);
  assert.deepEqual(arc.at(0).x, a.x); assert.ok(close(arc.at(1).x, b.x, 1e-9) && close(arc.at(1).y, b.y, 1e-9));
  assert.ok(arc.len >= Math.hypot(b.x - a.x, b.y - a.y));
  // column: a point below → bottom side
  assert.equal(S.anchorToward({ x: 0, y: 0, w: 100, h: 20 }, { x: 50, y: 300 }).side, 'bottom');
});

test('textPx: body text size at a 1080-px short side', () => {
  assert.equal(S.textPx(1, 14, 1), 14);
  assert.ok(close(S.textPx(0.75, 14, 1), 10.5));
  assert.ok(close(S.textPx(2, 14, 2), 14), '4K: twice the px per CSS px reads the same');
});

test('filmRef: an id ending in -N is an id first, an offset only if no such id exists', () => {
  const resolve = (p, r) => { const t = { 'beat-2': 7, beat: 1 }[r]; if (t == null) throw new Error('no ' + r); return t; };
  assert.equal(S.filmRef('a:beat-2', resolve), 7);
  assert.equal(S.filmRef('a:beat+2', resolve), 3);
  assert.throws(() => S.filmRef('a:nothing-1', resolve), /no nothing/);
});

test('arrange split3 (9:16): two phones side by side over a desktop crop, all inside, focus largest of its kind', () => {
  const V = { x: 48, y: 106, w: 984, h: 1400 }, CROP = frameRect('bare', 780, 540);
  const items = [{ id: 'fit', frame: PHONE, labelH: 34 }, { id: 'cus', frame: PHONE, labelH: 34 }, { id: 'own', frame: CROP, labelH: 34 }];
  for (const focus of ['fit', 'own', 'cus']) {
    const pl = S.arrange('split3', items, focus, V, { gap: 40 });
    const r = Object.fromEntries(items.map((it) => [it.id, S.frameOut(pl.get(it.id), it.frame)]));
    for (const v of Object.values(r)) assert.ok(S.rectInside(v, V, 1e-6), JSON.stringify(v));
    assert.ok(r.fit.x + r.fit.w <= r.cus.x, 'phones side by side');
    assert.ok(Math.max(r.fit.y + r.fit.h, r.cus.y + r.cus.h) + 34 <= r.own.y + 1e-6, 'desktop below, labels clear');
    if (focus !== 'own') assert.ok(pl.get(focus).k > pl.get(focus === 'fit' ? 'cus' : 'fit').k, 'focus phone larger');
  }
});

test('exitToward: a connector leaves by the side nearest its device edge, never away from the target', () => {
  const fr = { x: 100, y: 100, w: 400, h: 860 };
  const ring = { x: 115, y: 300, w: 370, h: 60 }; // a full-width button near the top
  const below = S.exitToward(ring, fr, { x: 300, y: 1400 });
  assert.ok(below.side === 'left' || below.side === 'right', `exits sideways, not down through the UI: ${below.side}`);
  assert.equal(below.exit, 15);
  const right = S.exitToward({ x: 300, y: 500, w: 100, h: 40 }, fr, { x: 1500, y: 520 });
  assert.equal(right.side, 'right');
  const arc = S.arcPath({ ...below }, { x: 300, y: 1300, side: 'top', exit: 10 }, { margin: 30 });
  assert.ok(Math.abs(arc.p1.x - below.x) >= 45 - 1e-9, 'control point reaches past the device edge + margin');
});

test('labelSpot: a connector label avoids heavy obstacles (endpoints, focus device) and stays in bounds; routes can be pinned', () => {
  const a = { x: 400, y: 500, side: 'right', exit: 0 }, b = { x: 800, y: 500, side: 'left', exit: 0 };
  const arc = S.arcPath(a, b, { bow: 0.1 });
  const focusDev = { x: 600, y: 0, w: 1000, h: 1080, weight: 4 }, ring = { x: 380, y: 470, w: 40, h: 60, weight: 12 };
  const spot = S.labelSpot(arc, 160, 40, [focusDev, ring], { bounds: { x: 0, y: 0, w: 1920, h: 1080 } });
  const p = arc.at(spot.u), r = { x: p.x - 80, y: p.y + spot.dy - 20, w: 160, h: 40 };
  assert.ok(r.x + r.w <= 600 + 40, `label kept off the focus device: ${JSON.stringify(r)}`);
  assert.ok(!(r.x < ring.x + ring.w && ring.x < r.x + r.w && r.y < ring.y + ring.h && ring.y < r.y + r.h), 'label off the endpoint ring');
  // pinned sides: only that pair is considered
  const fr = { x: 0, y: 0, w: 2000, h: 2000 };
  const rt = S.routeConnector({ x: 100, y: 100, w: 50, h: 20 }, fr, { x: 600, y: 600, w: 50, h: 20 }, fr, [], { sides: { a: 'bottom', b: 'top' } });
  assert.equal(rt.a.side, 'bottom'); assert.equal(rt.b.side, 'top');
});
