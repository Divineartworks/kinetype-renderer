// real-video edit planners (src/kit/x-real.js): pure, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/kit/x-real.js';

// a synthetic C2 v2 phone recording (60 fps, 1080×2400, page at y 240, CSS ×3)
function cap(over = {}) {
  return R.normalizeReal({
    schema: 'kinetype.capture.v1', flow: 'syn', clock: 'wall', fps: 60, duration: 14,
    device: { kind: 'phone', viewport: { width: 360, height: 672 }, deviceScaleFactor: 3, video: { width: 1080, height: 2400 } },
    mapping: { s: 3, ox: 0, oy: 240 },
    events: [
      { t: 2.0, type: 'click', step: 'new', box: { x: 20, y: 500, w: 320, h: 48 }, point: { x: 180, y: 524 } },
      { t: 2.3, type: 'type', step: 'desc', t1: 4.1, text: 'Ekstra stikkontakt kjøkken', box: { x: 20, y: 200, w: 320, h: 44 }, keys: Array.from({ length: 26 }, (_, i) => ({ t: 2.3 + i * 0.07, ch: 'x' })) },
      { t: 5.0, type: 'click', step: 'send', box: { x: 20, y: 600, w: 320, h: 52 }, point: { x: 180, y: 626 } },
      { t: 9.6, type: 'click', step: 'next', box: { x: 20, y: 300, w: 320, h: 52 }, point: { x: 180, y: 326 } },
    ],
    marks: [{ t: 0.2, id: 'open' }, { t: 6.9, id: 'sent', payoff: true }, { t: 13.5, id: 'end' }],
    steps: [{ id: 'new', t0: 1.9, t1: 2.2 }, { id: 'desc', t0: 2.25, t1: 4.15 }, { id: 'send', t0: 4.95, t1: 5.2 }, { id: 'next', t0: 9.55, t1: 9.8 }],
    idle: [[0.3, 1.95], [4.2, 4.95], [7.2, 9.55]],
    busy: [[5.1, 6.8]],
    ...over,
  });
}

test('normalizeReal maps boxes and points to video px (box·s + offset)', () => {
  const c = cap();
  assert.equal(c.device.viewport.width, 1080);
  assert.deepEqual(c.events[0].box, { x: 60, y: 1740, w: 960, h: 144 });
  assert.deepEqual(c.events[0].point, { x: 540, y: 1812 });
  assert.equal(c.device.cssScale, 3);
  assert.ok(R.isReal(c));
});

test('auto pace: monotone map, dead stretches compressed or cut, typing within budget, payoff held', () => {
  const c = cap();
  const { map } = R.pacePlan(c, { c0: 0, c1: 14 });
  // monotone (main edit)
  let prev = -1;
  for (let t = 0; t <= map.duration; t += 1 / 60) { const x = map.toCapture(t); assert.ok(x >= prev - 1e-9, `non-monotone at ${t}`); prev = x; }
  // the idle before the first tap (after the 0.8 s first-screen read) is cut, keeping 0.12 + 0.1 s
  assert.ok(map.cuts.some((k) => Math.abs(k.from - 0.92) < 1e-6 && Math.abs(k.to - 1.85) < 1e-6), JSON.stringify(map.cuts));
  // the 1.7 s spinner is cut: on screen ≤ 0.3 s
  const r = R.paceReport({ duration: map.duration, events: R.filmEventsOf(c, map), segments: [{ f0: 0, map, cap: c }], changes: map.cuts.map((k) => k.t) });
  const get = (id) => r.checks.find((x) => x.id === id);
  assert.equal(get('spinner').status, 'pass', get('spinner').detail);
  assert.ok(r.metrics.longestSpinner <= 0.3);
  // typing 1.8 s → ≤ 1.0 s on screen
  assert.equal(get('typing').status, 'pass', get('typing').detail);
  // the 0.75 s idle (≤ cutOver) is sped to deadMax
  const comp = map.pieces.find((p) => p.compressed);
  assert.ok(comp && Math.abs((comp.c1 - comp.c0) / comp.speed - R.PACE.deadMax) < 1e-9);
  // payoff: held 0.6–1.2 s before the next change
  assert.equal(get('payoff-hold').status, 'pass', get('payoff-hold').detail);
  assert.equal(get('feedback-wait').status, 'pass', get('feedback-wait').detail);
  // events inside a cut are dropped; keys mapped and monotone
  const fe = R.filmEventsOf(c, map).filter((e) => e.type === 'type')[0];
  assert.ok(fe.keys.every((k, i) => i === 0 || k.t > fe.keys[i - 1].t));
  assert.ok(fe.t1 - fe.t <= R.PACE.typeMax + 1e-9);
});

test('first payoff late → fail; a cold open fixes it', () => {
  const c = cap({ marks: [{ t: 0.2, id: 'open' }, { t: 13.0, id: 'done', payoff: true }] });
  const plain = R.pacePlan(c, { c0: 0, c1: 14 });
  const rp = R.paceReport({ duration: plain.map.duration, events: R.filmEventsOf(c, plain.map), segments: [{ f0: 0, map: plain.map, cap: c }] });
  assert.equal(rp.checks.find((x) => x.id === 'first-payoff').status, 'fail');
  const op = R.pacePlan(c, { c0: 0, c1: 14, open: { at: 'done', dur: 1.0 } });
  const ro = R.paceReport({ duration: op.map.duration, events: R.filmEventsOf(c, op.map), segments: [{ f0: 0, map: op.map, cap: c }] });
  assert.equal(ro.checks.find((x) => x.id === 'first-payoff').status, 'pass');
  // the open is out of capture order: toFilm never answers inside it
  assert.ok(op.map.toFilm(13.2) > 1.0);
});

test('beats: a mark lands on its narration beat (hold on a static stretch, or speed-up)', () => {
  const c = cap();
  const base = R.pacePlan(c, { c0: 0, c1: 14 }).map;
  const tSend = base.toFilmFirst(4.95); // step 'send' t0
  const later = R.pacePlan(c, { c0: 0, c1: 14, beats: [{ at: 'send', t: tSend + 0.6 }] }).map;
  assert.ok(Math.abs(later.toFilmFirst(4.95) - (tSend + 0.6)) < 0.02, `${later.toFilmFirst(4.95)} vs ${tSend + 0.6}`);
  const hold = later.pieces.find((p) => p.kind === 'hold');
  assert.match(hold.why, /static/);
  const earlier = R.pacePlan(c, { c0: 0, c1: 14, beats: [{ at: 'next', t: base.toFilmFirst(9.6) - 0.3 }] }).map;
  assert.ok(earlier.toFilmFirst(9.6) < base.toFilmFirst(9.6) - 0.1);
});

test('explicit overrides still win', () => {
  const c = cap();
  const { map } = R.pacePlan(c, { c0: 0, c1: 14, overrides: [{ from: 'send', to: 'next', speed: 1 }] });
  assert.ok(map.pieces.some((p) => p.kind === 'override'));
  assert.ok(!map.pieces.some((p) => p.c0 >= 5 && p.c1 <= 9.6 && p.kind === 'busy'));
});

test('2-frame match dissolve at a cut', () => {
  const m = R.timeMap([{ c0: 0, c1: 1, speed: 1 }, { c0: 3, c1: 4, speed: 1 }]);
  assert.equal(m.cuts.length, 1);
  const fps = 30, k = m.cuts[0].t; // 1.0
  const before = m.mixAt(k - 1 / fps, fps), at = m.mixAt(k, fps), after = m.mixAt(k + 1 / fps, fps), far = m.mixAt(k - 2 / fps, fps);
  assert.equal(before.length, 2); assert.equal(at.length, 2); assert.equal(after.length, 1); assert.equal(far.length, 1);
  assert.ok(Math.abs(before[1].a - 0.25) < 1e-9 && Math.abs(at[1].a - 0.75) < 1e-9);
  assert.ok(before[0].c < 1 && at[1].c >= 3);
  assert.ok(m.skipped(2) && !m.skipped(0.5));
});

test('legibility zoom and camera never crop the tapped element', () => {
  assert.equal(R.legibilityZoom(48, 1), 1);
  assert.ok(Math.abs(R.legibilityZoom(36, 0.4) - 1.25) < 1e-9);
  const c = cap();
  const view = R.screenView({ vw: 1080, vh: 2400, viewW: 1080, viewH: 1920, zMax: 1.15, wideTop: true });
  const evs = R.filmEventsOf(c, R.pacePlan(c, { c0: 0, c1: 14 }).map);
  const keys = R.planRealCamera(evs, view, { zText: 1, zPush: 1.1 });
  for (const k of keys) {
    const e = evs.find((x) => x.box && Math.abs(x.t - 0.35 - k.t) < 0.3);
    if (e) assert.ok(view.shows(k, e.box), `${k.why} crops its target`);
    assert.ok(k.z >= 1 && k.z <= 1.15);
  }
});

test('touch indicator is centred exactly on vpoint and lasts press + ripple', () => {
  const tap = { t: 2, point: { x: 540.25, y: 1812.5 } };
  assert.equal(R.touchAt(1.9, tap, 26), null);
  const a = R.touchAt(2.03, tap, 26);
  assert.equal(a.x, 540.25); assert.equal(a.y, 1812.5);
  assert.ok(a.disc.a > 0.3);
  const b = R.touchAt(2.2, tap, 26);
  assert.ok(b.ring && b.ring.r > 26);
  assert.equal(R.touchAt(2 + R.TOUCH.press + R.TOUCH.ripple + 0.05, tap, 26), null);
  assert.ok(R.TOUCH.press >= 0.06 && R.TOUCH.press <= 0.09);
});

test('session: split capture on the session clock, dead only where both are dead', () => {
  const a = cap({ flow: 'owner', sessionOffset: 0 });
  const b = cap({ flow: 'cust', sessionOffset: 3, idle: [[0, 2]], busy: [] });
  const s = R.sessionCapture({ owner: a, cust: b }, ['owner', 'cust']);
  assert.ok(s.marks.some((m) => m.id === 'cust:sent' && Math.abs(m.t - 9.9) < 1e-9));
  assert.deepEqual(s.idle, [[3, 4.95]].filter(() => false).concat(R.andRanges(R.normRanges(a.idle), [[3, 5]])));
  assert.equal(R.sessionTime({ owner: a, cust: b }, 'cust:sent+0.5'), 6.9 + 3 + 0.5);
});

test('planEdit: solo + split shots, report and changes', () => {
  const a = cap({ flow: 'owner' });
  const b = cap({ flow: 'cust', sessionOffset: 1.5 });
  const plan = R.planEdit({
    caps: { owner: a, cust: b }, W: 1080, H: 1920, fps: 30,
    content: { open: { at: 'sent', dur: 1.0 }, edit: [{ device: 'owner', from: 'open', to: 'sent' }, { split: ['cust', 'owner'], from: 'cust:send', to: 'owner:end' }] },
  });
  assert.equal(plan.shots.length, 2);
  assert.equal(plan.shots[1].kind, 'split');
  assert.equal(plan.shots[1].panels.length, 2);
  assert.ok(plan.changes.includes(plan.shots[1].f0));
  assert.ok(plan.report.checks.length >= 6);
  assert.equal(plan.frame, 'none');
  assert.ok(plan.shots[0].panels[0].rect.bleed);
});

test('review regressions: beats count the cold open; a hold inside a cut never lands at film start; boundary events belong to one shot', () => {
  const c = cap();
  // beat in a shot with a cold open: the mark plays at the beat's film time, open included
  const op = R.pacePlan(c, { c0: 0, c1: 14, open: { at: 'sent', dur: 1.0 }, beats: [{ at: 'send', t: 4.0 }] }).map;
  assert.ok(Math.abs(op.toFilm(4.95) - 4.0) < 0.02, `send at ${op.toFilm(4.95)}`);
  // a hold override inside a cut-away idle stretch → frozen where the edit lands next, map stays monotone
  const h = R.pacePlan(c, { c0: 0, c1: 14, overrides: [{ at: 8.0, hold: 0.5 }] }).map;
  const hold = h.pieces.find((p) => p.kind === 'hold' && p.why === 'override');
  assert.ok(hold && hold.f0 > 1, `hold at film ${hold?.f0}`);
  let prev = -1;
  for (let t = 0; t <= h.duration; t += 1 / 60) { const x = h.toCapture(t); assert.ok(x >= prev - 1e-9); prev = x; }
  // two shots meeting at a step: its event is in exactly one of them
  const a = R.timeMap([{ c0: 0, c1: 5, speed: 1 }]), b = R.timeMap([{ c0: 5, c1: 9.6, speed: 1 }]);
  const n = [...R.filmEventsOf(c, a), ...R.filmEventsOf(c, b)].filter((e) => e.step === 'send' && e.type === 'click').length;
  assert.equal(n, 1);
});

test('interop: swipe/fling vpath gives the finger path; tap → click', () => {
  const c = R.normalizeReal({ flow: 'd21', clock: 'wall', fps: 60, duration: 3, device: { video: { width: 1080, height: 2400 } }, mapping: { s: 3, ox: 0, oy: 240 },
    events: [{ t: 1, t1: 1.4, type: 'fling', from: { x: 180, y: 500 }, to: { x: 180, y: 200 }, vpath: [{ x: 540, y: 1740, t: 1 }, { x: 541, y: 1200, t: 1.2 }, { x: 542, y: 840, t: 1.4 }] }, { t: 2, type: 'tap', box: { x: 0, y: 0, w: 10, h: 10 }, point: { x: 5, y: 5 } }], marks: [], steps: [] });
  assert.deepEqual(c.events[0].pfrom, { x: 540, y: 1740 });
  assert.deepEqual(c.events[0].pto, { x: 542, y: 840 });
  assert.equal(c.events[1].type, 'click');
});

test('navigating tap: the pre-contact frame is held so the press lands on the button', () => {
  const c = cap();
  c.events[2] = { ...c.events[2], track: [{ t: 4.9, box: c.events[2].box, visible: true }, { t: 5.0, box: c.events[2].box, visible: false }] };
  assert.ok(R.navigatingTap(c.events[2], 60));
  const { map } = R.pacePlan(c, { c0: 0, c1: 14 });
  const hold = map.pieces.find((p) => p.kind === 'hold' && /press send/.test(p.why));
  assert.ok(hold && Math.abs(hold.f1 - hold.f0 - R.PACE.pressHold) < 1e-9);
  const tap = R.filmEventsOf(c, map).find((e) => e.step === 'send' && e.type === 'click');
  assert.ok(tap.tDown < tap.t - 0.1);
  // during the hold the capture shows the frame before contact (the button), and the disc is down
  assert.ok(map.toCapture((tap.tDown + tap.t) / 2) < 5.0);
  const st = R.touchAt((tap.tDown + tap.t) / 2, tap, 26);
  assert.ok(st && st.disc.a > 0.4 && !st.ring);
});

test('planEdit: a solo shot never cold-opens on another device (separate takes share no moment)', () => {
  const a = cap({ flow: 'owner' });
  const b = cap({ flow: 'cust', sessionOffset: 1.5 });
  const base = { caps: { owner: a, cust: b }, W: 1080, H: 1920, fps: 30 };
  assert.throws(() => R.planEdit({ ...base, content: { open: { at: 'cust:sent', dur: 1.0 }, edit: [{ device: 'owner', from: 'open', to: 'sent' }] } }), /open at "cust:sent" is on device "cust" but shot 0 shows "owner"/);
  const ok = R.planEdit({ ...base, content: { open: { at: 'owner:sent', dur: 1.0 }, edit: [{ device: 'owner', from: 'open', to: 'sent' }] } });
  assert.ok(ok.shots[0].pieces?.some?.((p) => p.open) ?? true);
});

test('camera: two taps < minShot apart, the second near the bottom edge — the move is kept (never crop a tap)', () => {
  const view = R.screenView({ vw: 1080, vh: 2400, viewW: 1080, viewH: 1920, zMax: 1.15, wideTop: true });
  const evs = [
    { t: 0.4, type: 'click', box: { x: 40, y: 990, w: 60, h: 60 }, point: { x: 70, y: 1020 }, step: 'confirm' },
    { t: 1.0, type: 'click', box: { x: 30, y: 2190, w: 1020, h: 110 }, point: { x: 540, y: 2242 }, step: 'submit' },
  ];
  const keys = R.planRealCamera(evs, view, { zText: 1, zPush: 1.1 });
  const last = keys.filter((k) => k.t <= 1.0).pop();
  assert.ok(last && view.shows(last, evs[1].box), `submit cropped: ${JSON.stringify(keys)}`);
  assert.ok(last.cut || evs[1].t - last.t >= 0.6, `the reframe must land before the press: ${JSON.stringify(last)}`);
});

test('9:16 band + cropTop: the recording sits below the band and the camera never shows the chrome above cropTop', () => {
  const base = { caps: { a: cap() }, W: 1080, H: 1920, fps: 30 };
  const plan = R.planEdit({ ...base, content: { session: { devices: [{ id: 'a', capture: 'x', cropTop: 210 }] }, edit: [{ device: 'a', from: 'open', to: 'end' }] }, params: { bandTop: 0.15 } });
  const p = plan.shots[0].panels[0];
  assert.equal(p.rect.y, 288);
  assert.equal(p.centre.y, 288 + (1920 - 288) / 2);
  assert.equal(p.view.viewH, 1920 - 288);
  for (const k of p.keys) assert.ok(k.cy - p.view.viewH / (2 * k.z) >= 210 - 1e-6, `key ${k.why} shows the chrome: top ${k.cy - p.view.viewH / (2 * k.z)}`);
  // no band, no crop: unchanged full frame
  const p0 = R.planEdit({ ...base, content: { edit: [{ device: 'a', from: 'open', to: 'end' }] } }).shots[0].panels[0];
  assert.equal(p0.rect.y, 0); assert.equal(p0.view.viewH, 1920);
});

test('content.payoffs stamps recorder marks as payoffs (held by auto pace, measured by the report)', () => {
  const plain = cap({ marks: [{ t: 0.2, id: 'open' }, { t: 6.9, id: 'sent' }, { t: 13.5, id: 'end' }] });
  const run = (payoffs) => R.planEdit({ caps: { a: cap({ marks: plain.marks.map((m) => ({ ...m })) }) }, W: 1080, H: 1920, fps: 30, content: { payoffs, edit: [{ device: 'a', from: 'open', to: 'end' }] } });
  const none = run(undefined), withP = run(['a:sent']);
  assert.equal(none.report.metrics.payoffHolds.length, 0);
  assert.ok(withP.report.metrics.payoffHolds.some((h) => h.mark === 'sent'), JSON.stringify(withP.report.metrics.payoffHolds));
  assert.throws(() => run(['zz:sent']), /unknown device "zz"/);
});

test('end card: a picture change, and the held CTA after it is not counted as a static UI stretch', () => {
  const c = cap();
  const base = { caps: { a: c }, W: 1080, H: 1920, fps: 30 };
  const edit = [{ device: 'a', from: 'open', to: 'end' }];
  const without = R.planEdit({ ...base, content: { edit } });
  const at = without.duration - 2.5;
  const withCard = R.planEdit({ ...base, content: { edit, endCard: { at, title: 'X' } } });
  assert.ok(withCard.changes.includes(at));
  const st = withCard.report.checks.find((k) => k.id === 'longest-static');
  const m = /@ ([\d.]+) s/.exec(st.detail);
  if (m) assert.ok(+m[1] < at, st.detail);
});
