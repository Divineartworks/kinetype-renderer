import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mappingFrom, keyboardInset, mapBox, mapPoint, unmapPoint, fitMapping, findBlobs, pairMarkers, mappingError } from '../src/device/mapping.js';
import { TEMPO, tempoFor, stepRng, tapPlan, typingPlan, dragPath, reachPlan, holdFor } from '../src/device/choreo.js';
import { MarkRegistry, sessionProblems, subtractWindows, runReset, applyVars } from '../src/device/index.js';
import { sleepUntil, now } from '../src/device/transport.js';
import { validateCaptureDoc } from '../src/capture/validate.js';
import { flowProblems } from '../src/capture/flow.js';
import { resolveDeviceFlow, deviceFlowProblems } from '../src/device/perform.js';

const M = (o = {}) => ({ dpr: 2.625, innerWidth: 412, innerHeight: 800, vv: { offsetLeft: 0, offsetTop: 0, width: 412, height: 800, scale: 1 }, editableFocused: false, ...o });

test('mapping: DPR, status bar/URL bar offset and pinch zoom', () => {
  const cal = { left: 0, top: 216, innerHeight: 800, standalone: false };
  const m = mappingFrom(M(), cal);
  assert.deepEqual(m, { s: 2.625, ox: 0, oy: 216 });
  assert.deepEqual(mapBox(m, { x: 10, y: 20, w: 100, h: 40 }), { x: 26.25, y: 268.5, w: 262.5, h: 105 });
  assert.deepEqual(unmapPoint(m, mapPoint(m, { x: 33.3, y: 400.1 })), { x: 33.3, y: 400.1 });
  // URL bar collapses: innerHeight grows by 56 css → the page starts 56·dpr px higher
  assert.equal(mappingFrom(M({ innerHeight: 856 }), cal).oy, 216 - 56 * 2.625);
  // a standalone PWA has no URL bar: innerHeight changes never move the top
  assert.equal(mappingFrom(M({ innerHeight: 856 }), { ...cal, standalone: true }).oy, 216);
  // pinch zoom ×2 scrolled into the visual viewport by (30, 100) css
  const z = mappingFrom(M({ vv: { offsetLeft: 30, offsetTop: 100, width: 206, height: 400, scale: 2 } }), cal);
  assert.deepEqual(z, { s: 5.25, ox: -157.5, oy: 216 - 525 });
});

test('mapping: the keyboard shrinks the visual viewport but never moves the top', () => {
  const cal = { left: 0, top: 216, innerHeight: 800, standalone: false };
  const kb = M({ editableFocused: true, vv: { offsetLeft: 0, offsetTop: 0, width: 412, height: 480, scale: 1 } });
  assert.equal(keyboardInset(kb), 320);
  assert.equal(keyboardInset({ ...kb, editableFocused: false }), 0);
  assert.equal(mappingFrom(kb, cal).oy, 216);
  // keyboard up while innerHeight also differs: no URL-bar term
  assert.equal(mappingFrom({ ...kb, innerHeight: 760 }, cal).oy, 216);
});

test('mapping: least-squares fit from markers and sub-pixel blob centroids', () => {
  const truth = { s: 2.5, ox: 0, oy: 60 };
  const exp = { tl: { x: 16, y: 16, w: 24, h: 24 }, tr: { x: 392, y: 16, w: 24, h: 24 }, bl: { x: 16, y: 872, w: 24, h: 24 }, br: { x: 392, y: 872, w: 24, h: 24 } };
  const W = 1080, H = 2400;
  const rgb = Buffer.alloc(W * H * 3, 255);
  for (const b of Object.values(exp)) {
    const v = mapBox(truth, b);
    for (let y = v.y; y < v.y + v.h; y++) for (let x = v.x; x < v.x + v.w; x++) { const p = (y * W + x) * 3; rgb[p] = 255; rgb[p + 1] = 0; rgb[p + 2] = 255; }
  }
  const blobs = findBlobs(rgb, W, H);
  assert.equal(blobs.length, 4);
  const pairs = pairMarkers(exp, blobs, { s: 2.5, ox: 5, oy: 40 });
  assert.equal(pairs.length, 4);
  const fit = fitMapping(pairs);
  assert.deepEqual(fit.mapping, truth);
  assert.equal(fit.maxErr, 0);
  assert.ok(mappingError({ s: 2.5, ox: 0, oy: 62 }, pairs).maxErr === 2, 'a 2 px model error is reported as 2 px');
  assert.throws(() => fitMapping(pairs.slice(0, 1)), /at least 2/);
});

test('choreo: demo-artist tempo matches the LIVE pace standards', () => {
  const t = TEMPO['demo-artist'];
  assert.deepEqual(t.approach, [0.35, 0.45]);
  assert.ok(t.press[0] >= 0.06 && t.press[1] <= 0.09);
  assert.ok(t.typing[0] >= 0.04 && t.typing[1] <= 0.08);
  assert.equal(t.typingCap, 1.0);
  assert.equal(tempoFor({ preset: 'demo-artist' }, { press: [0.07, 0.07] }).press[0], 0.07);
  assert.throws(() => tempoFor({ preset: 'nope' }), /unknown tempo preset/);
});

test('choreo: schedules are seeded per step and human-shaped', () => {
  const t = tempoFor();
  const box = { x: 100, y: 1000, w: 300, h: 120 };
  const a = tapPlan(box, t, stepRng(21, 'open-job')), b = tapPlan(box, t, stepRng(21, 'open-job')), c = tapPlan(box, t, stepRng(21, 'send'));
  assert.deepEqual(a, b, 'same flow + seed + step → same performance');
  assert.notDeepEqual(a, c);
  for (let i = 0; i < 50; i++) {
    const p = tapPlan(box, t, stepRng(i, 'x'));
    assert.ok(p.approach >= 0.35 && p.approach <= 0.45 && p.press >= 0.06 && p.press <= 0.09);
    // the finger lands in the inner 60 % of the box, never on an edge
    assert.ok(p.point.x >= box.x + box.w * 0.2 - 1 && p.point.x <= box.x + box.w * 0.8 + 1 && p.point.y >= box.y + box.h * 0.2 - 1 && p.point.y <= box.y + box.h * 0.8 + 1);
  }
  const short = typingPlan('2450', t, stepRng(1, 'a'));
  assert.equal(short.keys.length, 4);
  assert.ok(short.keys.every((k, i) => i === 0 || (k.at - short.keys[i - 1].at >= 0.04 - 1e-9 && k.at - short.keys[i - 1].at <= 0.08 * 1.2 + 1e-9)));
  const long = typingPlan('Ny nedløpsrenne, 3 meter langs takfoten', t, stepRng(1, 'b'));
  assert.ok(long.duration <= 1.0 + 1e-9 || long.overCap, 'a field fits 1.0 s or is flagged');
  assert.ok(long.compressed && long.compressed < 1);
  const huge = typingPlan('x'.repeat(80), t, stepRng(1, 'c'));
  assert.equal(huge.overCap, true, 'beyond the floor rate it is flagged for a speed-ramp, never typed robotically fast');
  assert.equal(holdFor({ action: 'mark' }, t, stepRng(1, 'm')) >= 0.6, true);
  assert.equal(holdFor({ action: 'tap', hold: 0.2 }, t, stepRng(1, 'm')), 0.2);
});

test('choreo: a fling releases at speed, a swipe rests before lifting', () => {
  const t = tempoFor();
  const f = dragPath({ x: 540, y: 1600 }, { x: 540, y: 900 }, { kind: 'fling', tempo: t, r: stepRng(1, 'f'), velocity: 6000 });
  assert.ok(Math.abs(f.releaseVelocity - 6000) < 1, `release ${f.releaseVelocity}`);
  const n = f.points.length;
  const vEnd = Math.abs(f.points[n - 1].y - f.points[n - 2].y) / (f.points[n - 1].t - f.points[n - 2].t);
  const vStart = Math.abs(f.points[1].y - f.points[0].y) / (f.points[1].t - f.points[0].t);
  assert.ok(vEnd > 4 * vStart, 'accelerates into the release');
  assert.ok((n - 1) / f.duration >= 100, 'sampled at ≥ 100 Hz');
  const s = dragPath({ x: 540, y: 1600 }, { x: 540, y: 1000 }, { kind: 'swipe', tempo: t, r: stepRng(1, 's') });
  const [p1, p2] = s.points.slice(-2);
  assert.deepEqual([p1.x, p1.y], [p2.x, p2.y], 'finger rests (no momentum) before lifting');
  assert.ok(p2.t - p1.t >= 0.05);
  assert.deepEqual([s.points.at(-1).x, s.points.at(-1).y], [540, 1000]);
});

test('choreo: reach plan — nothing when in reach, a swipe when near, one fling when far', () => {
  const t = tempoFor();
  assert.deepEqual(reachPlan({ y: 300, h: 60 }, 900, t), []);
  const near = reachPlan({ y: 950, h: 60 }, 900, t);
  assert.deepEqual(near.map((g) => g.kind), ['swipe']);
  const far = reachPlan({ y: 4000, h: 60 }, 900, t, { calibrated: true });
  assert.deepEqual(far.map((g) => g.kind), ['fling']);
  const farU = reachPlan({ y: 4000, h: 60 }, 900, t);
  assert.deepEqual(farU.map((g) => g.kind), ['fling', 'swipe']);
  assert.ok(Math.abs(far[0].dyCss - (4030 - 0.435 * 900)) < 1);
  assert.ok(reachPlan({ y: 4000, h: 60 }, 900, t, { scrollMax: 200 })[0].dyCss <= 200, 'never plans past the end of the scroller');
});

test('session: mark registry resolves waiters and times out with null', async () => {
  const r = new MarkRegistry();
  const w = r.wait('phone', 'sent', 2);
  r.set('phone', 'other', 1);
  r.set('phone', 'sent', 12.5);
  assert.equal(await w, 12.5);
  assert.equal(await r.wait('phone', 'sent', 0.01), 12.5, 'already reached');
  assert.equal(await r.wait('office', 'never', 0.05), null);
  assert.deepEqual(sessionProblems({ schema: 'kinetype.session.v1', devices: [{ id: 'phone', flow: 'a.json' }, { id: 'office', flow: 'b.json' }] }), []);
  assert.deepEqual(sessionProblems({ schema: 'kinetype.session.v1', devices: [{ id: 'a', flow: 'x' }, { id: 'a', flow: 'y' }] }), [], 'a repeated id = flows in order on that device');
  assert.match(sessionProblems({ schema: 'x', devices: [] }).join(), /schema/);
});

test('idle ranges never cover an input window', () => {
  assert.deepEqual(subtractWindows([[0, 5], [6, 9]], [[1, 2], [8.9, 10]]), [[0, 1], [2, 5], [6, 8.9]]);
  assert.deepEqual(subtractWindows([[0, 1]], [[0.1, 0.95]]), [], 'leftovers shorter than 0.3 s are dropped');
});

test('host clock: sleepUntil is late by milliseconds, not tens', async () => {
  const late = [];
  for (let i = 0; i < 20; i++) { const t = now() + 0.012; await sleepUntil(t); late.push((now() - t) * 1000); }
  late.sort((a, b) => a - b);
  assert.ok(late[10] < 12, `median lateness ${late[10].toFixed(2)} ms`);
});

const flow = (o = {}) => ({ schema: 'kinetype.flow.v1', name: 'd', app: { name: 'A', baseUrl: 'http://10.0.2.2:8787' }, device: { kind: 'android', target: { transport: 'adb', browser: 'pwa' } }, steps: [{ id: 'g', action: 'goto', url: '/' }, { id: 't', action: 'tap', target: { testId: 'x' } }, { id: 'f', action: 'fling', direction: 'up' }, { id: 'b', action: 'back' }], ...o });

test('flow C1 v2: android targets, device-only actions and their guards', () => {
  assert.deepEqual(flowProblems(flow()), []);
  const ph = flow({ device: { kind: 'phone' } });
  assert.match(flowProblems(ph).join('\n'), /needs device.kind "android"/);
  assert.ok(flowProblems(flow({ steps: [{ id: 's', action: 'sync' }] })).length > 0, 'sync needs device + mark');
  assert.ok(flowProblems(flow({ steps: [{ id: 's', action: 'swipe' }] })).length > 0, 'swipe needs a direction, from/to or a target');
  const r = resolveDeviceFlow(flow(), { transport: 'cdp-touch' });
  assert.equal(r.device.target.transport, 'cdp-touch');
  assert.equal(r.device.target.browser, 'pwa');
  assert.equal(r.fps, 60);
  assert.deepEqual(deviceFlowProblems(resolveDeviceFlow(flow({ steps: [{ id: 's', action: 'sync', device: 'x', mark: 'm' }] }))).length, 1, 'sync outside a session');
  assert.match(deviceFlowProblems(resolveDeviceFlow(flow({ steps: [{ id: 'h', action: 'hover', target: { text: 'a' } }] }))).join(), /touch screen/);
});

const wallCap = () => ({
  schema: 'kinetype.capture.v1', clock: 'wall', flow: 'd', app: { name: 'A', baseUrl: 'http://x' },
  device: { kind: 'android', transport: 'adb', screen: { width: 1080, height: 2400 }, deviceScaleFactor: 2.625 },
  fps: 60, duration: 5, sessionOffset: 1.25, video: { src: 'capture.mp4', codec: 'h264', fps: 60, width: 1080, height: 2400 },
  events: [
    { t: 1, t1: 1.08, type: 'click', step: 't', point: { x: 100, y: 200 }, box: { x: 80, y: 180, w: 40, h: 40 }, vpoint: { x: 262.5, y: 741 }, vbox: { x: 210, y: 688.5, w: 105, h: 105 }, mapping: { s: 2.625, ox: 0, oy: 216 }, track: [{ t: 1, box: { x: 80, y: 180, w: 40, h: 40 }, vbox: { x: 210, y: 688.5, w: 105, h: 105 }, visible: true }], trackEnd: 4 },
    { t: 2, t1: 2.2, type: 'fling', step: 'f', vpath: [{ x: 540, y: 1600, t: 0 }, { x: 540, y: 900, t: 0.12 }], scroll: { from: 0, to: 900 }, mapping: { s: 2.625, ox: 0, oy: 216 } },
    { t: 2, type: 'scroll', step: 'f', from: 0, to: 900 },
  ],
  marks: [{ t: 3, id: 'm' }], steps: [{ id: 't', t0: 0.5, t1: 1.5 }, { id: 'f', t0: 1.5, t1: 3 }, { id: 'm', t0: 3, t1: 3 }],
  idle: [[3.2, 4.5]], busy: [{ t0: 1.6, t1: 1.9, source: 'dom' }],
});

test('capture C2 v2: a native wall-clock capture validates; broken ones say why', () => {
  assert.deepEqual(validateCaptureDoc(wallCap()), []);
  const a = wallCap(); delete a.events[0].vbox;
  assert.match(validateCaptureDoc(a).join(), /vbox/);
  const b = wallCap(); b.video.width = 720;
  assert.match(validateCaptureDoc(b).join(), /native resolution/);
  const c = wallCap(); delete c.sessionOffset;
  assert.match(validateCaptureDoc(c).join(), /sessionOffset/);
  const d = wallCap(); d.events[1].scroll = undefined;
  assert.match(validateCaptureDoc(d).join(), /vpath and scroll/);
  const e = wallCap(); e.events[0].track[0].vbox = { x: 0, y: 2500, w: 10, h: 10 };
  assert.match(validateCaptureDoc(e).join(), /track\[0\]/);
  const e2 = wallCap(); e2.events[0].track[0].vbox = { x: 52, y: -110, w: 977, h: 251 }; // scrolling off the top, still on screen
  assert.doesNotMatch(validateCaptureDoc(e2).join(), /track\[0\]/);
  const f = wallCap(); f.idle = [[2, 1]];
  assert.match(validateCaptureDoc(f).join(), /idle\/busy/);
});

import { parseUiDump, matchOs } from '../src/device/uia.js';
const UI = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">
<node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.google.android.apps.messaging" content-desc="" clickable="false" bounds="[0,0][1080,2400]">
<node index="0" text="" resource-id="com.google.android.apps.messaging:id/conversation_row" class="android.view.ViewGroup" package="com.google.android.apps.messaging" content-desc="" clickable="true" bounds="[0,400][1080,620]">
<node index="0" text="Martin Hansen" resource-id="com.google.android.apps.messaging:id/conversation_name" class="android.widget.TextView" package="com.google.android.apps.messaging" content-desc="" clickable="false" bounds="[200,430][700,490]" />
<node index="1" text="Ok, ta det med &quot;sluk&quot; &amp; rør" resource-id="com.google.android.apps.messaging:id/conversation_snippet" class="android.widget.TextView" package="com.google.android.apps.messaging" content-desc="" clickable="false" bounds="[200,500][1000,560]" />
</node>
<node index="1" text="" resource-id="com.google.android.apps.messaging:id/compose_message_text" class="android.widget.EditText" package="com.google.android.apps.messaging" content-desc="" clickable="true" focused="true" bounds="[40,2200][900,2320]" />
<node index="2" text="" resource-id="com.google.android.apps.messaging:id/send_message_button_icon" class="android.widget.ImageView" package="com.google.android.apps.messaging" content-desc="Send SMS" clickable="true" bounds="[920,2200][1040,2320]" />
<node index="3" text="Martin" resource-id="" class="android.widget.TextView" package="com.android.systemui" content-desc="" clickable="false" bounds="[0,0][300,60]" />
</node></hierarchy>`;

test('native targets: uiautomator dump → package/text/resourceId/desc matches, smallest match, ambiguity visible', () => {
  const nodes = parseUiDump(UI);
  assert.equal(nodes.length, 7);
  assert.equal(nodes[3].text, 'Ok, ta det med "sluk" & rør');
  const pkg = 'com.google.android.apps.messaging';
  const m1 = matchOs(nodes, { package: pkg, text: 'Martin' });
  assert.equal(m1.length, 1, 'the system-UI "Martin" is another package');
  assert.deepEqual(m1[0].bounds, { x: 200, y: 430, w: 500, h: 60 });
  assert.equal(matchOs(nodes, { text: 'Martin' }).length, 2, 'without package: ambiguous (caller fails)');
  const f = matchOs(nodes, { package: pkg, resourceId: 'compose_message_text' });
  assert.equal(f.length, 1); assert.equal(f[0].editable, true); assert.equal(f[0].focused, true);
  assert.equal(matchOs(nodes, { resourceId: `${pkg}:id/compose_message_text` }).length, 1);
  assert.equal(matchOs(nodes, { package: pkg, desc: 'send sms' }).length, 1);
  assert.equal(matchOs(nodes, { package: pkg, text: 'Martin', exact: true }).length, 0);
  assert.equal(matchOs(nodes, { package: pkg, desc: 'Send' }, { width: 1080, height: 2400 })[0].onScreen, true);
});

import { compileSessionSync } from '../src/device/index.js';
test('session: repeated device ids chain flows; declarative sync gates the whole beat that ends at the mark', () => {
  const S = { schema: 'kinetype.session.v1', devices: [{ id: 'erik', flow: 'a' }, { id: 'martin', flow: 'b' }, { id: 'erik', flow: 'c' }], sync: [{ wait: 'martin:extra-item', after: 'erik:extra-sent' }] };
  assert.deepEqual(sessionProblems(S), []);
  assert.match(sessionProblems({ ...S, sync: [{ wait: 'nobody:x', after: 'erik:y' }] }).join(), /unknown device/);
  assert.match(sessionProblems({ ...S, devices: [...S.devices, { id: 'a', flow: 'x' }, { id: 'b', flow: 'y' }] }).join(), /1–3 distinct/);
  const entries = [
    { id: 'erik', flow: { steps: [{ id: 'send', action: 'tap' }, { id: 'extra-sent', action: 'mark' }] } },
    { id: 'martin', flow: { steps: [{ id: 'home', action: 'tap' }, { id: 'opened', action: 'mark' }, { id: 'refresh', action: 'refresh' }, { id: 'inbox', action: 'observe' }, { id: 'extra-item', action: 'mark' }] } },
  ];
  compileSessionSync(entries, S.sync);
  assert.deepEqual(entries[1].flow.steps.map((s) => s.id), ['home', 'opened', 'sync-extra-item', 'refresh', 'inbox', 'extra-item']);
  assert.deepEqual(entries[1].flow.steps[2], { id: 'sync-extra-item', action: 'sync', device: 'erik', mark: 'extra-sent', timeout: 60, hold: 0 });
  assert.throws(() => compileSessionSync(entries, [{ wait: 'martin:nope', after: 'erik:extra-sent' }]), /has mark "nope"/);
});

import { priorRehearsal } from '../src/device/index.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
test('rehearsal gate: same flow bytes + app URL + transport + device, and fresh', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-reh-'));
  const f = path.join(dir, 'rehearsal.json');
  const doc = { pass: true, at: new Date().toISOString(), flowSha256: 'abc', baseUrl: 'http://localhost:8787', transport: 'adb', serial: 'emulator-5554' };
  const want = { hash: 'abc', kind: 'adb', serial: 'emulator-5554', baseUrl: 'http://localhost:8787' };
  fs.writeFileSync(f, JSON.stringify(doc));
  assert.ok(priorRehearsal(f, want));
  for (const [k, v] of [['hash', 'other'], ['serial', 'emulator-5556'], ['baseUrl', 'http://evil:1'], ['kind', 'cdp-touch']]) assert.equal(priorRehearsal(f, { ...want, [k]: v }), null, k);
  fs.writeFileSync(f, JSON.stringify({ ...doc, pass: false })); assert.equal(priorRehearsal(f, want), null);
  fs.writeFileSync(f, JSON.stringify({ ...doc, at: new Date(Date.now() - 13 * 3600e3).toISOString() })); assert.equal(priorRehearsal(f, want), null, 'stale');
  fs.rmSync(dir, { recursive: true, force: true });
});

import { runFlow } from '../src/device/perform.js';
test('a failing step stops the observer and aborts the recording (no hang, no leaked loop)', async () => {
  let calls = 0, aborted = 0;
  const tr = {
    cdp: {}, inflight: { size: 0 }, pageErrors: [],
    evaluate: async () => { calls++; return null; },
    lib: async () => null,
    locate: async () => ({ count: 0 }),
    mappingOf: () => ({ s: 1, ox: 0, oy: 0 }),
    recordStart: async () => ({ t0: now() }),
    recordAbort: async () => { aborted++; },
    inputStats: () => ({}),
  };
  const flow = resolveDeviceFlow({ schema: 'kinetype.flow.v1', name: 'x', app: { name: 'A', baseUrl: 'http://127.0.0.1:9' }, device: { kind: 'android' }, calibrate: 'off', stage: false, steps: [{ id: 'missing', action: 'tap', target: { text: 'nope' }, timeout: 0.2 }] });
  await assert.rejects(runFlow(flow, tr, { mode: 'perform', out: os.tmpdir() }), /not found/);
  assert.equal(aborted, 1, 'the running recording is aborted');
  const c0 = calls;
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(calls, c0, 'the observer stopped polling');
});

import { makePageClock } from '../src/device/perform.js';
test('page clock: a probe is stamped with WHEN the page read it (min-RTT offset), not when the host asked', () => {
  const c = makePageClock();
  // page clock = host + 1000 s; the renderer runs the probe 0.25 s after the host asked (loaded host), reply instant
  assert.ok(Math.abs(c.toHost(1000 + 10.02, 10.0, 10.04) - 10.02) < 1e-9, 'a fast probe fixes the offset');
  const T = c.toHost(1000 + 15.25, 15.0, 15.26);
  assert.ok(Math.abs(T - 15.25) < 1e-9, `stamped ${T}, the host asked at 15.0`);
  assert.equal(c.toHost(1000 + 19, 18.0, 18.5), 18.5, 'clamped into the read window');
});

import { pairMarkersGeometric, leaveOneOut, fitPerAxis, calibrationSuspects } from '../src/device/mapping.js';
import { writeCalibrationDebug } from '../src/device/transport.js';
test('calibration diagnostics: geometric pairing, the inconsistent marker is named, bottom displacement suspected, calib-debug written', async () => {
  const W = 1080, H = 2400, dpr = 2.625, truth = { s: dpr, ox: 0, oy: 210 };
  const css = { tl: { x: 49, y: 160, w: 24, h: 24 }, tr: { x: 339, y: 160, w: 24, h: 24 }, bl: { x: 49, y: 616, w: 24, h: 24 }, br: { x: 339, y: 616, w: 24, h: 24 } };
  const draw = (shift) => {
    const rgb = Buffer.alloc(W * H * 3, 255);
    for (const [k, b] of Object.entries(css)) {
      const v = mapBox(truth, b); const dy = shift[k] || 0;
      for (let y = Math.round(v.y + dy); y < Math.round(v.y + v.h + dy); y++) for (let x = Math.round(v.x); x < Math.round(v.x + v.w); x++) { const p = (y * W + x) * 3; rgb[p] = 255; rgb[p + 1] = 0; rgb[p + 2] = 255; }
    }
    // a magenta-ish UI element of the wrong size must not be taken for a marker
    for (let y = 20; y < 40; y++) for (let x = 500; x < 900; x++) { const p = (y * W + x) * 3; rgb[p] = 250; rgb[p + 1] = 5; rgb[p + 2] = 250; }
    return { rgb, width: W, height: H };
  };
  const wrongGuess = { s: dpr, ox: 0, oy: 60 }; // 150 px off (URL bar unknown)
  const one = draw({ br: 40 });
  const gp = pairMarkersGeometric(css, findBlobs(one.rgb, W, H), { dpr, rough: wrongGuess });
  assert.equal(gp.method, 'geometric'); assert.equal(gp.pairs.length, 4);
  const loo = leaveOneOut(gp.pairs);
  assert.equal(loo.worst.without, 'br');
  const fit = fitMapping(gp.pairs);
  const sus = calibrationSuspects({ metrics: { dpr, innerWidth: 411.43, vv: { scale: 1 } }, expected: css, blobs: findBlobs(one.rgb, W, H), pairs: gp.pairs, fit, perAxis: fitPerAxis(gp.pairs), loo, screen: { width: W, height: H } });
  assert.ok(sus.some((x) => /marker "br" is inconsistent/.test(x)), sus.join('\n'));
  const two = draw({ bl: 30, br: 30 });
  const gp2 = pairMarkersGeometric(css, findBlobs(two.rgb, W, H), { dpr });
  const fit2 = fitMapping(gp2.pairs);
  const sus2 = calibrationSuspects({ metrics: { dpr, innerWidth: 411.43, vv: { scale: 1 } }, expected: css, blobs: findBlobs(two.rgb, W, H), pairs: gp2.pairs, fit: fit2, perAxis: fitPerAxis(gp2.pairs), loo: leaveOneOut(gp2.pairs), screen: { width: W, height: H } });
  assert.ok(sus2.some((x) => /both BOTTOM markers sit/.test(x)), sus2.join('\n'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-caldbg-'));
  await writeCalibrationDebug(dir, { expected: css, blobs: findBlobs(one.rgb, W, H), model: wrongGuess, fit, suspects: sus }, one, { pass: false, error: 'test' });
  for (const f of ['screencap.png', 'annotated.png', 'calibration-debug.json']) assert.ok(fs.statSync(path.join(dir, f)).size > 100, f);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'calibration-debug.json'))).pass, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

import { overlayDiff, demoCommands, pwaLauncherIcon, pwaShortcutIntent } from '../src/device/stage.js';
test('overlay check: page rendering vs screencap — identical → clean; a bubble with text → one region; the focused field ignored', () => {
  const W = 400, H = 800, top = 100;
  const page = { width: W, height: H - top, rgb: Buffer.alloc(W * (H - top) * 3, 255), pxPerVideoPx: 1 };
  for (let y = 200; y < 230; y++) for (let x = 40; x < 300; x++) { const p = (y * W + x) * 3; page.rgb[p] = page.rgb[p + 1] = page.rgb[p + 2] = 30; } // page text
  const phone = { width: W, height: H, rgb: Buffer.alloc(W * H * 3, 16) };
  for (let y = 0; y < H - top; y++) page.rgb.copy(phone.rgb, ((y + top) * W) * 3, y * W * 3, (y + 1) * W * 3);
  const m = { s: 1, ox: 0, oy: top };
  assert.deepEqual(overlayDiff(page, phone, m).regions, []);
  for (let y = 120; y < 210; y++) for (let x = 20; x < 380; x++) { const p = (y * W + x) * 3; const t = (y % 30) > 15 && (x % 20) < 12; phone.rgb[p] = phone.rgb[p + 1] = t ? 40 : 244; phone.rgb[p + 2] = t ? 50 : 250; }
  const d = overlayDiff(page, phone, m);
  assert.equal(d.regions.length, 1);
  const r = d.regions[0];
  assert.ok(r.x <= 36 && r.y <= 136 && r.x + r.w >= 364 && r.y + r.h >= 196, JSON.stringify(r)); // 16 px block resolution
  assert.deepEqual(overlayDiff(page, phone, m, { ignore: [{ x: 0, y: 100, w: 400, h: 140 }] }).regions, [], 'a region inside an ignored box (the focused field) does not count');
  assert.deepEqual(demoCommands('0941')[1].slice(-4), ['clock', '-e', 'hhmm', '0941']);
});

import { framePacing, summarizeSmoothness } from '../src/device/perform.js';
import { pickChromeLayer, parseSfLatency, parseGfxinfo } from '../src/device/smooth.js';
test('smoothness: frame pacing, SurfaceFlinger latency + gfxinfo parsers, verdict thresholds', () => {
  const smooth = Array.from({ length: 61 }, (_, i) => i / 60);
  const p = framePacing(smooth);
  assert.equal(p.fps, 60); assert.equal(p.jankyPct, 0);
  const jank = [0]; for (let i = 1; i < 60; i++) jank.push(jank[i - 1] + (i % 3 === 0 ? 2 : 1) / 60); // every 3rd frame misses a vsync
  const pj = framePacing(jank);
  assert.ok(pj.fps < 55 && pj.jankyPct > 5, JSON.stringify(pj));
  const list = 'Display 0\nStatusBar#45\ncom.android.chrome/org.chromium.chrome.browser.ChromeTabbedActivity#120\nSurfaceView[com.android.chrome/org.chromium.chrome.browser.ChromeTabbedActivity]#131(BLAST)\nSurfaceView[com.android.chrome/org.chromium.chrome.browser.ChromeTabbedActivity](Background)#132\n';
  assert.equal(pickChromeLayer(list), 'SurfaceView[com.android.chrome/org.chromium.chrome.browser.ChromeTabbedActivity]#131(BLAST)');
  const sf = '16666666\n' + Array.from({ length: 40 }, (_, i) => `${1e9 + i * 16666666} ${1e9 + i * 16666666 + 1000} ${1e9 + i * 16666666 - 5000}`).join('\n') + '\n0 0 0\n';
  const r = parseSfLatency(sf);
  assert.equal(r.refreshMs, 16.67); assert.ok(Math.abs(r.fps - 60) < 0.5); assert.equal(r.jankyPct, 0);
  const g = parseGfxinfo('Total frames rendered: 210\nJanky frames: 21 (10.00%)\n90th percentile: 19ms\n95th percentile: 25ms\n99th percentile: 40ms\n');
  assert.deepEqual([g.totalFrames, g.jankyFrames, g.jankyPct, g.p95Ms], [210, 21, 10, 25]);
  assert.equal(summarizeSmoothness([{ step: 'a', kind: 'fling', page: p, display: null }]).verdict, 'ok');
  const w = summarizeSmoothness([{ step: 'a', kind: 'fling', page: p, display: { fps: 41, jankyPct: 22, p95Ms: 48 } }]);
  assert.equal(w.verdict, 'warn'); assert.equal(w.worst.source, 'display');
});

import { setDeviceLocale, classify } from '../src/device/locale.js';
import { fakeSettings } from './helpers/fake-settings.js';
test('device-locale: drives Android 15 Settings to nb-NO first — English UI, Norwegian UI, nb added but second; idempotent; unknown screen refused', async () => {
  const quick = { settleMs: 0 };
  const en = fakeSettings({ locales: ['en-US'] });
  const r = await setDeviceLocale(en, quick);
  assert.equal(r.ok, true, r.error); assert.equal(r.changed, true);
  assert.deepEqual(en.state.locales, ['nb-NO', 'en-US']);
  assert.deepEqual(r.steps.map((x) => x.screen), ['languages', 'system-languages', 'language-picker', 'language-picker', 'language-picker', 'region', 'confirm-change']);
  assert.ok(en.state.log.includes('input text norsk'));
  const again = await setDeviceLocale(en, quick);
  assert.equal(again.changed, false); assert.equal(again.steps.length, 0, 'already nb-NO: nothing touched');
  const second = fakeSettings({ locales: ['en-US', 'nb-NO'], ui: 'nb' });
  const r2 = await setDeviceLocale(second, quick);
  assert.equal(r2.ok, true, r2.error); assert.deepEqual(second.state.locales.slice(0, 1), ['nb-NO']);
  assert.ok(r2.steps.some((x) => /drag/.test(x.action)));
  const nbUi = fakeSettings({ locales: ['en-US'], ui: 'nb' });
  const r3 = await setDeviceLocale(nbUi, quick);
  assert.equal(r3.ok, true, r3.error);
  const lost = { sh: async (a) => (a[0] === 'settings' ? 'en-US' : ''), dump: async () => '<hierarchy><node text="Something else" resource-id="" class="x" package="p" content-desc="" bounds="[0,0][10,10]" /></hierarchy>' };
  const r4 = await setDeviceLocale(lost, quick);
  assert.equal(r4.ok, false); assert.match(r4.error, /still "en-US"/);
  assert.equal(classify([]).screen, 'unknown');
});

import { decodeImage } from '../src/device/media.js';
test('overlay check regression (MINI REHEARSAL 3, real film1 screencap): text never reads as overlay; misregistration recovered; a translate bubble is still caught', async () => {
  const phone = await decodeImage(fs.readFileSync('fixtures/device/regression/mini3-stage-screencap.png'));
  assert.deepEqual([phone.width, phone.height], [1080, 2400]);
  const top = 283, h = 2050; // the viewport on the real phone (y offset 282.9 px, innerHeight 783 css × 2.625)
  // Chrome's own rendering of the same viewport, with raster differences: a 3-px horizontal blur + a brightness shift
  const rgb = Buffer.alloc(1080 * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < 1080; x++) for (let c = 0; c < 3; c++) {
    const at = (xx) => phone.rgb[((y + top) * 1080 + Math.min(1079, Math.max(0, xx))) * 3 + c];
    rgb[(y * 1080 + x) * 3 + c] = Math.min(255, Math.round((at(x - 1) + at(x) + at(x + 1)) / 3) + 3);
  }
  const page = { rgb, width: 1080, height: h, pxPerVideoPx: 1 };
  const guess = { s: 2.625, ox: 0, oy: top + 50 }; // 50 px off, as in rehearsal 3
  const d = overlayDiff(page, phone, guess);
  assert.deepEqual(d.regions, [], JSON.stringify(d.regions.slice(0, 3)));
  assert.ok(Math.abs(d.registration.shift.dy + 50) <= 2 && Math.abs(d.registration.shift.dx) <= 2, JSON.stringify(d.registration));
  // the real bubble: light fill, a line of dark title text, a smaller subtitle, an icon — over the page's top
  const withBubble = { ...phone, rgb: Buffer.from(phone.rgb) };
  const paint = (x0, y0, x1, y1, c) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const p = (y * 1080 + x) * 3; withBubble.rgb[p] = c[0]; withBubble.rgb[p + 1] = c[1]; withBubble.rgb[p + 2] = c[2]; } };
  paint(40, 300, 1040, 500, [246, 247, 252]);
  for (let x = 170; x < 600; x += 26) paint(x, 330, x + 18, 370, [32, 33, 36]);
  for (let x = 170; x < 560; x += 20) paint(x, 395, x + 13, 420, [95, 99, 104]);
  paint(75, 330, 135, 390, [66, 133, 244]); paint(850, 335, 990, 375, [26, 115, 232]);
  const b = overlayDiff(page, withBubble, guess);
  assert.equal(b.regions.length, 1, JSON.stringify(b.regions));
  assert.ok(b.regions[0].y < 360 && b.regions[0].y + b.regions[0].h > 420, JSON.stringify(b.regions[0]));
});

import { waitForDeviceReady } from '../src/device/adb.js';
test('device readiness: boot_completed is not enough — a missing window service times out with a clear error', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-fakeadb-ready-'));
  const bin = path.join(dir, 'adb');
  fs.writeFileSync(bin, `#!/usr/bin/env node
const a = process.argv.slice(2).filter((x, i, all) => !(x === '-s' || all[i - 1] === '-s'));
const s = a.slice(1).join(' ');
const out = { 'getprop sys.boot_completed': '1', 'getprop init.svc.bootanim': 'stopped', 'service check window': 'Service window: not found', 'service check activity': 'Service activity: found', 'service check package': 'Service package: found', 'pm path android': 'package:/system/framework/framework-res.apk' }[s] ?? '';
process.stdout.write(out + '\\n');
`);
  fs.chmodSync(bin, 0o755);
  const prev = process.env.KINETYPE_ADB; process.env.KINETYPE_ADB = bin;
  try {
    await assert.rejects(waitForDeviceReady('emulator-5556', { timeoutMs: 1500, pollMs: 200 }), /not ready after 2 s — .*window="Service window: not found"/);
  } finally { if (prev === undefined) delete process.env.KINETYPE_ADB; else process.env.KINETYPE_ADB = prev; fs.rmSync(dir, { recursive: true, force: true }); }
});

test('overlay check regression (MINI REHEARSAL 4, real film1 calibration page): a sparse page still registers (+63 px) and stays clean; a bubble over its text is caught', async () => {
  const page = await decodeImage(fs.readFileSync('fixtures/device/regression/mini4-cal-page.png'));
  const phone = await decodeImage(fs.readFileSync('fixtures/device/regression/mini4-cal-screencap.png'));
  page.pxPerVideoPx = 1080 / (412 * 2.625); // CDP capture px per video px (innerWidth 412 css, DPR 2.625)
  const guess = { s: 2.625, ox: 0, oy: 218.63 }; // the first guess the real run used (65 px high)
  const opts = { visibleHeight: 783 * 2.625 }; // innerHeight 783 css (Chrome's capture is 2201 px: URL bar hidden)
  const d = overlayDiff(page, phone, guess, opts);
  assert.deepEqual(d.regions, [], JSON.stringify(d.regions));
  assert.ok(Math.abs(d.registration.oy - 282) <= 3 && Math.abs(d.registration.ox) <= 2, JSON.stringify(d.registration));
  // Chrome's "Translate page?" bubble where it really appeared (rehearsal 2), over the heading + paragraph
  const withBubble = { ...phone, rgb: Buffer.from(phone.rgb) };
  const paint = (x0, y0, x1, y1, c) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const p = (y * 1080 + x) * 3; withBubble.rgb[p] = c[0]; withBubble.rgb[p + 1] = c[1]; withBubble.rgb[p + 2] = c[2]; } };
  paint(40, 265, 1040, 450, [246, 247, 252]);
  for (let x = 170; x < 470; x += 24) paint(x, 315, x + 16, 352, [32, 33, 36]);
  for (let x = 170; x < 470; x += 18) paint(x, 372, x + 12, 395, [95, 99, 104]);
  paint(75, 330, 135, 390, [66, 133, 244]); paint(840, 330, 1000, 380, [26, 115, 232]);
  const b = overlayDiff(page, withBubble, guess, opts);
  assert.equal(b.regions.length, 1, JSON.stringify(b.regions));
  // and with every faint level the clean page shows, still nothing: sweep the strong threshold
  for (const tol of [8, 10, 14, 20]) assert.deepEqual(overlayDiff(page, phone, guess, { ...opts, tol }).regions, [], `tol ${tol}`);
});

test('smoothness: Android 15 SurfaceFlinger --list format (RequestedLayerState{…}) → the real SurfaceView layer, never Background', () => {
  const list = [
    'RequestedLayerState{com.android.chrome/org.chromium.chrome.browser.ChromeTabbedActivity#335 parentId=330 relativeParentId=none z=0}',
    'RequestedLayerState{Background for SurfaceView[com.android.chrome/org.chromium.chrome.browser.ChromeTabbedActivity]#344 parentId=342 relativeParentId=335 z=-2147483648}',
    'RequestedLayerState{SurfaceView[com.android.chrome/org.chromium.chrome.browser.ChromeTabbedActivity]#342 parentId=335 relativeParentId=none z=-2}',
    'RequestedLayerState{SurfaceView[com.android.chrome/org.chromium.chrome.browser.ChromeTabbedActivity](BLAST)#343 parentId=342 relativeParentId=none z=0}',
  ].join('\n');
  assert.equal(pickChromeLayer(list), 'SurfaceView[com.android.chrome/org.chromium.chrome.browser.ChromeTabbedActivity](BLAST)#343', 'buffers land on the BLAST child');
});

import { parseTimeStats } from '../src/device/smooth.js';
test('smoothness: SurfaceFlinger TimeStats (Android 12+ fallback when --latency is header-only) → fps, janky %, p95', () => {
  const dump = `SurfaceFlinger TimeStats:
statsStart = 1700000000
totalFrames = 400
layerName = StatusBar#45
packageName =
totalFrames = 3
averageFPS = 1.0
presentToPresent histogram is as below:
1000ms=3
layerName = SurfaceView[com.android.chrome/org.chromium.chrome.browser.ChromeTabbedActivity](BLAST)#182
packageName = com.android.chrome
totalFrames = 100
droppedFrames = 0
averageFPS = 59.9
presentToPresent histogram is as below:
16ms=88 17ms=8 33ms=3 50ms=1
acquireToPresent histogram is as below:
8ms=100
`;
  const r = parseTimeStats(dump);
  assert.equal(r.layer, 'SurfaceView[com.android.chrome/org.chromium.chrome.browser.ChromeTabbedActivity](BLAST)#182');
  assert.equal(r.fps, 59.9); assert.equal(r.frames, 100); assert.equal(r.jankyPct, 4); assert.equal(r.p95Ms, 17);
  assert.match(parseTimeStats('layerName = StatusBar#1\ntotalFrames = 2\n').error, /no Chrome layer/);
});

test('pwaLauncherIcon: exact clickable launcher label, ambiguity is none', () => {
  const mk = (o) => ({ text: '', desc: '', package: 'com.google.android.apps.nexuslauncher', clickable: true, visibleToUser: true, bounds: { x: 67, y: 231, w: 205, h: 273 }, ...o });
  assert.equal(pwaLauncherIcon([mk({ text: 'AcmeApp', desc: 'AcmeApp' }), mk({ text: 'Chrome' })], 'AcmeApp').text, 'AcmeApp');
  assert.equal(pwaLauncherIcon([mk({ text: 'AcmeApp-modulen' })], 'AcmeApp'), null);
  assert.equal(pwaLauncherIcon([mk({ text: 'AcmeApp' }), mk({ text: 'AcmeApp', bounds: { x: 300, y: 231, w: 205, h: 273 } })], 'AcmeApp'), null);
  assert.equal(pwaLauncherIcon([mk({ text: 'AcmeApp', package: 'com.android.chrome' })], 'AcmeApp'), null);
});

test('pwaShortcutIntent: replays the newest signed Chrome web-app pin for the name', () => {
  const blk = (id, name, mac = 'bWFj') => `ShortcutInfo {id=${id}, flags=0x28a\n packageName=com.android.chrome\n activity=ComponentInfo{com.android.chrome/com.google.android.apps.chrome.Main}\n intents=[Intent { act=com.google.android.apps.chrome.webapps.WebappManager.ACTION_START_WEBAPP pkg=com.android.chrome }/PersistableBundle[{org.chromium.chrome.browser.webapp_short_name=${name}, org.chromium.chrome.browser.webapp_id=${id}, org.chromium.chrome.browser.webapp_display_mode=3, org.chromium.chrome.browser.webapp_name=${name}, org.chromium.chrome.browser.webapp_mac=${mac}, org.chromium.chrome.browser.webapp_url=http://localhost:18901/}]]\n`;
  const dump = 'Package: com.android.chrome\n' + blk('a1', 'Other') + blk('b2', 'AcmeApp') + blk('c3', 'AcmeApp');
  const argv = pwaShortcutIntent(dump, 'AcmeApp');
  assert.deepEqual(argv.slice(0, 6), ['am', 'start', '-a', 'com.google.android.apps.chrome.webapps.WebappManager.ACTION_START_WEBAPP', '-p', 'com.android.chrome']);
  assert.ok(argv.includes('c3') && !argv.includes('b2'));
  assert.ok(argv.includes('http://localhost:18901/') && argv.includes('bWFj'));
  assert.equal(argv[argv.indexOf('org.chromium.chrome.browser.webapp_display_mode') - 1], '--ei');
  assert.equal(pwaShortcutIntent(dump, 'Nope'), null);
  assert.equal(pwaShortcutIntent('Package: com.android.chrome\n' + blk('d4', 'AcmeApp', ''), 'AcmeApp'), null);
});

test('reset hook: runs the command, reads {"vars"} from its last line, fills {{NAME}} after hashing', () => {
  assert.deepEqual(runReset(''), {});
  assert.deepEqual(runReset(`echo seeding; echo '{"vars":{"PORTAL":"/customer#abc","bad key":"x","N":3}}'`), { PORTAL: '/customer#abc' });
  assert.deepEqual(runReset('echo done'), {});
  assert.throws(() => runReset('echo boom >&2; exit 3'), /reset exited 3: boom/);
  const flow = { steps: [{ id: 'open', action: 'goto', url: '{{PORTAL}}' }, { id: 'name', action: 'type', value: 'Hei {{WHO}}' }, { id: 'x', action: 'tap' }], setup: [{ method: 'POST', url: '/api/{{WHO}}' }] };
  const f = applyVars(flow, { PORTAL: '/customer#abc', WHO: 'Ingrid' });
  assert.equal(f.steps[0].url, '/customer#abc'); assert.equal(f.steps[1].value, 'Hei Ingrid'); assert.equal(f.setup[0].url, '/api/Ingrid');
  assert.equal(flow.steps[0].url, '{{PORTAL}}'); // the template is untouched
  assert.throws(() => applyVars(flow, { WHO: 'x' }), /step open: \{\{PORTAL\}\} has no value/);
});
