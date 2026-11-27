// Integration: the whole native-capture pipeline on the headless stand-in (cdp-touch) against the fixture app —
// rehearse → perform → CFR video + C2 v2 capture → pixel QA of the mapping on the recorded video → contact sheet,
// and a two-device session on one clock. No emulator needed (the lead runs the same flows on the mini via adb).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromePath } from '../src/cli/browser.js';
import { startFixtureServer } from '../fixtures/device/server.js';
import { performFlow, rehearseFlow, performSession } from '../src/device/index.js';
import { validateCaptureFile } from '../src/capture/validate.js';
import { probeVideo } from '../src/device/media.js';

const skip = !chromePath() && 'no Chrome';
const FIX = path.resolve('fixtures/device');

test('stand-in: calibration flow — vbox on the recorded markers (≤ 1 px), latency measured, C2 v2 valid', { skip, timeout: 600000 }, async () => {
  const srv = await startFixtureServer({});
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-dev-cal-'));
  try {
    const r = await performFlow(path.join(FIX, 'calibration.flow.json'), { baseUrl: srv.url, transport: 'cdp-touch', out });
    const reh = JSON.parse(fs.readFileSync(path.join(out, 'rehearsal.json'), 'utf8'));
    assert.equal(reh.pass, true, 'performed only after a passing rehearsal');
    assert.ok(reh.calibration.modelErr <= 1, `one-frame calibration ${reh.calibration.modelErr} px`);
    assert.ok(reh.qa.smoothness && reh.qa.smoothness.gestures.length >= 2 && reh.qa.smoothness.gestures.every((g) => g.page.frames >= 3), `page frame pacing per gesture: ${JSON.stringify(reh.qa.smoothness?.worst)}`);
    const rc = JSON.parse(fs.readFileSync(r.receipt, 'utf8'));
    assert.equal(rc.qa.mappingVideo.pass, true);
    assert.ok(rc.qa.mappingVideo.n >= 3 && rc.qa.mappingVideo.maxErr <= 1, JSON.stringify(rc.qa.mappingVideo.checks));
    assert.ok(rc.qa.latency.latencyMs.n >= 2, 'input→photon measured from the green flash');
    assert.ok(Number.isFinite(rc.qa.clockLag.lagMs) && rc.qa.clockLag.n >= 10, `clock lag measured on the moving marker: ${JSON.stringify(rc.qa.clockLag)}`);
    // the stand-in recorder's lag swings with host load (damage-driven screencast): measured and reported, not gated
    // here — the device bound (|lag| ≤ 2 frames) is in the runbook pass table
    if (Math.abs(rc.qa.clockLag.lagMs) > 100) console.log(`# note: stand-in video vs log lag ${rc.qa.clockLag.lagMs} ms (recorder lag compensated ${rc.recorderLag?.compensatedMs} ms)`);
    const v = validateCaptureFile(r.capture);
    assert.deepEqual(v.problems, []);
    const cap = v.doc;
    assert.equal(cap.clock, 'wall');
    const pv = probeVideo(path.join(out, 'capture.mp4'));
    assert.deepEqual([pv.width, pv.height, Math.round(pv.fps)], [1080, 2400, 60], 'CFR 60 fps at native resolution');
    const taps = cap.events.filter((e) => e.type === 'click');
    assert.equal(taps.length, 2);
    for (const e of taps) assert.ok(e.vpoint.x >= e.vbox.x && e.vpoint.x <= e.vbox.x + e.vbox.w && e.vpoint.y >= e.vbox.y && e.vpoint.y <= e.vbox.y + e.vbox.h, 'the finger lands inside the logged box');
    const fl = cap.events.find((e) => e.type === 'fling');
    assert.ok(fl.scroll.to > fl.scroll.from + 100, `fling scrolled ${fl.scroll.from} → ${fl.scroll.to}`);
    assert.ok(fs.existsSync(path.join(out, 'contact-sheet.png')));
  } finally { await srv.close(); fs.rmSync(out, { recursive: true, force: true }); }
});

test('stand-in: a failing rehearsal is never performed', { skip, timeout: 300000 }, async () => {
  const srv = await startFixtureServer({});
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-dev-bad-'));
  const flow = JSON.parse(fs.readFileSync(path.join(FIX, 'demo.flow.json'), 'utf8'));
  flow.steps = [flow.steps[0], { id: 'missing', action: 'tap', target: { role: 'button', name: 'Finnes ikke' }, timeout: 1 }];
  flow.calibrate = 'off';
  const f = path.join(out, 'bad.flow.json');
  fs.writeFileSync(f, JSON.stringify(flow));
  try {
    const reh = await rehearseFlow(f, { baseUrl: srv.url, transport: 'cdp-touch', out });
    assert.equal(reh.pass, false);
    assert.equal(reh.failedStep, 'missing');
    await assert.rejects(performFlow(f, { baseUrl: srv.url, transport: 'cdp-touch', out: path.join(out, 'p') }), /rehearsal failed — not performing/);
    assert.ok(!fs.existsSync(path.join(out, 'p', 'capture.mp4')));
  } finally { await srv.close(); fs.rmSync(out, { recursive: true, force: true }); }
});

test('stand-in: two-device session on one clock — the office refreshes after the phone sends', { skip, timeout: 900000 }, async () => {
  const srv = await startFixtureServer({ latencyMs: 600 });
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-dev-sess-'));
  try {
    const r = await performSession(path.join(FIX, 'demo.session.json'), { baseUrl: srv.url, transport: 'cdp-touch', out });
    assert.ok(r.rehearsal.every((x) => x.pass));
    const phone = JSON.parse(fs.readFileSync(path.join(out, 'phone', 'capture.json'), 'utf8'));
    const office = JSON.parse(fs.readFileSync(path.join(out, 'office', 'capture.json'), 'utf8'));
    for (const c of [phone, office]) assert.deepEqual(validateCaptureFile(path.join(out, c === phone ? 'phone' : 'office', 'capture.json')).problems, []);
    const sent = phone.marks.find((m) => m.id === 'sent').t + phone.sessionOffset;
    const refresh = office.events.find((e) => e.type === 'refresh');
    assert.equal(refresh.step, 'refresh-tab');
    assert.ok(refresh.t + office.sessionOffset >= sent - 0.05, `office refresh at ${refresh.t + office.sessionOffset} s, phone sent at ${sent} s (session clock)`);
    const seen = office.events.find((e) => e.type === 'observe');
    assert.ok(seen.vbox && seen.visible, 'the new pending item is on the office screen');
    // the phone typed real text, flung to the far job, and the spinner shows up as busy
    assert.ok(phone.events.some((e) => e.type === 'type' && e.text === 'Ny nedløpsrenne, 3 m' && e.t1 - e.t <= 1.05));
    assert.ok(phone.events.some((e) => e.type === 'fling'));
    assert.ok(phone.busy.some((b) => b.source !== 'pixels' || b.t1 - b.t0 > 0.3), JSON.stringify(phone.busy));
    assert.ok(office.idle.some(([a, b]) => b - a > 3), 'the office waiting for the phone is dead air the editor can cut');
    const prc = JSON.parse(fs.readFileSync(path.join(out, 'phone', 'receipt.json'), 'utf8'));
    assert.ok(prc.qa.targetBoxes.n >= 2 && prc.qa.targetBoxes.maxErr <= 2, `real controls vs logged vbox: ${JSON.stringify(prc.qa.targetBoxes.taps.map((t) => [t.step, t.maxErr]))}`);
  } finally { await srv.close(); fs.rmSync(out, { recursive: true, force: true }); }
});

test('stand-in: CLEAN STAGE — a native bubble over the page blocks the rehearsal and is saved annotated', { skip, timeout: 300000 }, async () => {
  const srv = await startFixtureServer({});
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-dev-stage-'));
  const prev = process.env.KINETYPE_TEST_FAKE_OVERLAY;
  try {
    const ok = await rehearseFlow(path.join(FIX, 'calibration.flow.json'), { baseUrl: srv.url, transport: 'cdp-touch', out: path.join(out, 'ok') });
    assert.equal(ok.pass, true, ok.error);
    assert.equal(ok.stage.clean, true);
    assert.deepEqual(ok.stage.overlay.regions, []);
    process.env.KINETYPE_TEST_FAKE_OVERLAY = '40,300,1000,190'; // where Chrome put "Translate page?" on the real phone
    const bad = await rehearseFlow(path.join(FIX, 'calibration.flow.json'), { baseUrl: srv.url, transport: 'cdp-touch', out: path.join(out, 'bad') });
    assert.equal(bad.pass, false);
    assert.match(bad.error, /stage not clean — something that is not the page covers the viewport/);
    assert.ok(bad.stage.overlay.regions.length >= 1);
    assert.ok(fs.existsSync(path.join(out, 'bad', 'calib-debug', 'stage-overlay.png')));
  } finally {
    if (prev === undefined) delete process.env.KINETYPE_TEST_FAKE_OVERLAY; else process.env.KINETYPE_TEST_FAKE_OVERLAY = prev;
    await srv.close(); fs.rmSync(out, { recursive: true, force: true });
  }
});
