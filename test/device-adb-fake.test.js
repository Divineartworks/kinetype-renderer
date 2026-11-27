// The REAL AdbTransport end to end against a fake Android (test/helpers/fake-android.js): fake `adb` CLI, DevTools
// through a forwarded port, a fake scrcpy 5.0 server (downscaled synthetic H.264, device-clock PTS, touch → page).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromePath } from '../src/cli/browser.js';
import { startFixtureServer } from '../fixtures/device/server.js';
import { startFakeAndroid } from './helpers/fake-android.js';
import { performFlow } from '../src/device/index.js';
import { validateCaptureFile } from '../src/capture/validate.js';
import { probeVideo } from '../src/device/media.js';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const skip = (!chromePath() && 'no Chrome') || (!hasFfmpeg && 'no ffmpeg');

test('AdbTransport against a fake Android: rehearse → perform through fake adb + scrcpy', { skip, timeout: 900000 }, async () => {
  const t0 = Date.now();
  const srv = await startFixtureServer({ latencyMs: 300 });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-fakeadb-'));
  const rig = await startFakeAndroid({});
  const saved = {};
  const env = { ...rig.env, KINETYPE_SCRCPY_MAX_SIZE: '960' };
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; process.env[k] = env[k]; }
  try {
    await rig.page.goto(srv.url + '/#/');
    const flowPath = path.join(tmp, 'demo.flow.json');
    const flow = JSON.parse(fs.readFileSync('fixtures/device/demo.flow.json', 'utf8'));
    flow.app.baseUrl = srv.url;
    fs.writeFileSync(flowPath, JSON.stringify(flow));
    const out = path.join(tmp, 'out');
    const logs = [];
    const r = await performFlow(flowPath, { baseUrl: srv.url, out, serial: 'emulator-5554', log: (m) => logs.push(m) });
    const reh = JSON.parse(fs.readFileSync(path.join(out, 'rehearsal.json'), 'utf8'));
    assert.equal(reh.pass, true, reh.error);
    const rc = JSON.parse(fs.readFileSync(r.receipt, 'utf8'));
    assert.equal(rc.transport.kind, 'adb');
    assert.deepEqual(rc.transport.screen, { width: 432, height: 960 });
    assert.ok(rc.transport.sizeSource.startsWith('stream'), rc.transport.sizeSource);
    assert.ok(reh.calibration.modelErr <= 1, `calibration modelErr ${reh.calibration.modelErr}`);
    assert.ok(rc.clockOffset, 'clock offset estimated');
    const v = validateCaptureFile(r.capture);
    assert.deepEqual(v.problems, []);
    const cap = v.doc;
    assert.equal(cap.video.width, 432); assert.equal(cap.video.height, 960); assert.equal(cap.video.fps, 60);
    const clicks = cap.events.filter((e) => e.type === 'click');
    assert.ok(clicks.length >= 3);
    for (const e of clicks) {
      assert.ok(e.vbox.x >= 0 && e.vbox.y >= 0 && e.vbox.x + e.vbox.w <= 432 && e.vbox.y + e.vbox.h <= 960, `vbox ${JSON.stringify(e.vbox)}`);
      assert.ok(e.vpoint.x >= e.vbox.x && e.vpoint.x <= e.vbox.x + e.vbox.w && e.vpoint.y >= e.vbox.y && e.vpoint.y <= e.vbox.y + e.vbox.h, 'vpoint inside vbox');
    }
    assert.equal(rig.stats.ignoredTouches, 0);
    assert.ok(rig.stats.touches[0] >= 5, `touch downs ${rig.stats.touches[0]}`);
    const jobs = await (await fetch(srv.url + '/api/jobs')).json();
    assert.equal(jobs.jobs.find((j) => j.id === 17).status, 'pending-approval', 'the taps drove the app through the scrcpy control path');
    const pv = probeVideo(path.join(out, 'capture.mp4'));
    assert.deepEqual([pv.width, pv.height], [432, 960]);
    assert.ok(Math.abs(pv.frames - cap.duration * 60) <= 2, `${pv.frames} frames vs ${cap.duration * 60}`);
    assert.ok(rig.stats.serverKilled >= 1, 'scrcpy server shell was SIGTERMed on close');
    // smoothness (rehearse): the display's own present times win over the page's rAF pacing
    assert.equal(reh.qa.smoothness.verdict, 'ok', JSON.stringify(reh.qa.smoothness?.worst));
    assert.equal(reh.qa.smoothness.worst.source, 'display');
    assert.ok(reh.qa.smoothness.gestures[0].display.gfxinfo.totalFrames === 48 && rig.stats.sfClears >= 1);
    assert.equal(reh.qa.smoothness.gestures[0].display.sfSource, 'timestats', 'header-only --latency (Android 15) falls back to TimeStats');
    // CLEAN STAGE: demo-mode status bar (09:41, released on close), translate off, one tab, Chrome in nb-NO, no overlay
    assert.equal(rc.stage.clean, true, JSON.stringify(rc.stage.problems));
    assert.ok(rig.stats.demo.some((d) => /clock -e hhmm 0941/.test(d)) && rig.stats.demo.at(-1) === 'exit', JSON.stringify(rig.stats.demo));
    assert.ok(reh.stage.actions.find((a) => a.name === 'chrome: close every other tab').detail.closed >= 1, 'the rehearsal closed the stray tab (perform then finds one tab)');
    assert.equal(rig.stats.appLocales['com.android.chrome'], 'nb-NO');
    assert.deepEqual(rc.stage.overlay.detail?.regions ?? rc.stage.overlay.regions, []);
    assert.equal(rig.stats.files['/data/local/tmp/chrome-command-line'], undefined, 'the Chrome command line was restored (removed) on release');
    console.log(`# fake-adb: touches ${JSON.stringify(rig.stats.touches)} ignored ${rig.stats.ignoredTouches} keys ${rig.stats.keys.length} texts ${rig.stats.texts.length} clockOffset ${JSON.stringify(rc.clockOffset)} frames ${pv.frames} duration ${cap.duration} wall ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  } finally {
    for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    await rig.close(); await srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('AdbTransport: native (os) targets through uiautomator + typing æøå via scrcpy clipboard paste', { skip, timeout: 900000 }, async () => {
  const srv = await startFixtureServer({ latencyMs: 300 });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-fakeadb-os-'));
  const rig = await startFakeAndroid({});
  const saved = {};
  const env = { ...rig.env, KINETYPE_SCRCPY_MAX_SIZE: '960' };
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; process.env[k] = env[k]; }
  try {
    await rig.page.goto(srv.url + '/#/');
    const C = 'com.android.chrome';
    const flow = {
      schema: 'kinetype.flow.v1', name: 'native-targets', title: 'documentation fields are allowed', marks: ['sent'],
      app: { name: 'Verkstedlogg (fixture)', baseUrl: srv.url }, device: { kind: 'android', target: { browser: 'chrome', transport: 'adb' } },
      tempo: { preset: 'brisk' }, calibrate: 'off', setup: [{ action: 'request', method: 'POST', url: '/api/reset' }],
      steps: [
        { id: 'open', action: 'goto', url: '/#/job/3', hold: 0.2 },
        { id: 'add', action: 'tap', target: { os: { package: C, text: 'Legg til ekstraarbeid', exact: true } }, hold: 0.3 },
        { id: 'what', action: 'type', target: { os: { package: C, resourceId: 'extra-text' } }, value: 'Rør i kjøkken', note: 'æøå go through the clipboard' },
        { id: 'amount', action: 'type', target: { os: { package: C, resourceId: 'extra-amount' } }, value: '900' },
        { id: 'send', action: 'tap', target: { os: { package: C, text: 'Send til kunden', exact: true } } },
        { id: 'done', action: 'waitFor', target: { role: 'status', name: 'Sendt til kunden' }, timeout: 10 },
        { id: 'sent', action: 'mark' },
      ],
    };
    const flowPath = path.join(tmp, 'native.flow.json');
    fs.writeFileSync(flowPath, JSON.stringify(flow));
    const out = path.join(tmp, 'out');
    const r = await performFlow(flowPath, { baseUrl: srv.url, out, serial: 'emulator-5554' });
    const v = validateCaptureFile(r.capture);
    assert.deepEqual(v.problems, []);
    const osEv = v.doc.events.filter((e) => e.space === 'os');
    assert.ok(osEv.length >= 4, `native events ${osEv.length}`);
    assert.ok(osEv.every((e) => e.vbox && !e.box && e.os?.package === C));
    const jobs = await (await fetch(srv.url + '/api/jobs')).json();
    const j3 = jobs.jobs.find((j) => j.id === 3);
    assert.equal(j3.status, 'pending-approval');
    assert.equal(j3.extras.at(-1).text, 'Rør i kjøkken', 'ASCII as key events, ø via clipboard paste');
    assert.equal(j3.extras.at(-1).amount, 900);
    assert.ok((rig.stats.pastes || []).includes('ø'));
    assert.ok(rig.stats.texts.includes('R'));
  } finally {
    for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    await rig.close(); await srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('AdbTransport: CLEAN STAGE refuses a device whose system locale is not nb-NO (with the exact fix)', { skip, timeout: 600000 }, async () => {
  const srv = await startFixtureServer({});
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-fakeadb-loc-'));
  const rig = await startFakeAndroid({ locale: 'en-US' });
  const saved = {};
  const env = { ...rig.env, KINETYPE_SCRCPY_MAX_SIZE: '960' };
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; process.env[k] = env[k]; }
  try {
    await rig.page.goto(srv.url + '/calibration');
    const { rehearseFlow } = await import('../src/device/index.js');
    const r = await rehearseFlow(path.resolve('fixtures/device/calibration.flow.json'), { baseUrl: srv.url, out: tmp, serial: 'emulator-5554' });
    assert.equal(r.pass, false);
    assert.match(r.error, /system locale is "en-US", not nb-NO/);
    assert.match(r.error, /kinetype device-locale --serial emulator-5554 --locale nb-NO/);
    assert.equal(r.stage.locale.ok, false); assert.equal(r.stage.locale.system_locales, 'en-US');
    assert.equal(rig.stats.demo.at(-1), 'exit', 'the stage is released even when the rehearsal fails');
  } finally {
    for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    await rig.close(); await srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('device-locale through the fake adb: Settings automation sets nb-NO first (Android 15 dumps), idempotent', { skip, timeout: 300000 }, async () => {
  const { fakeSettings } = await import('./helpers/fake-settings.js');
  const { deviceLocale } = await import('../src/device/locale.js');
  const settings = fakeSettings({ locales: ['en-US'] });
  const rig = await startFakeAndroid({ settings });
  const saved = {};
  for (const k of Object.keys(rig.env)) { saved[k] = process.env[k]; process.env[k] = rig.env[k]; }
  try {
    const r = await deviceLocale({ serial: 'emulator-5554', locale: 'nb-NO' });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.after.first, 'nb-NO');
    assert.ok(rig.stats.commands.some((c) => c.includes('input text norsk')));
    const again = await deviceLocale({ serial: 'emulator-5554' });
    assert.equal(again.changed, false);
  } finally {
    for (const k of Object.keys(rig.env)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    await rig.close();
  }
});
