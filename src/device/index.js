// Public entry points of the device module, shared by the CLI and the MCP server:
//   rehearseFlow(flow.json)   → rehearsal.json (pass/fail, per-step timings, calibration, pace findings)
//   performFlow(flow.json)    → capture.json (kinetype.capture.v1, clock "wall", vbox/vpoint, idle/busy), capture.mp4
//                               (CFR 60 fps, native resolution), receipt.json, contact-sheet.png
//   performSession(session.json) → the same per device on one host clock + session.json (sessionOffset per device)
// A flow that fails rehearsal is never performed.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { loadFlow, flowProblems, sha256 } from '../capture/flow.js';
import { validateCaptureFile } from '../capture/validate.js';
import { runFlow, resolveDeviceFlow, deviceFlowProblems, transportOptions, buildDeviceCapture } from './perform.js';
import { createTransport, now } from './transport.js';
import { detectIdleBusy, caretMasks, statusBarMask } from './idle.js';
import { verifyMarkers, measureTouchLatency, measureClockLag, verifyTargetBoxes } from './qa.js';
import { deviceSheet } from './sheet.js';

const r3 = (n) => Math.round(n * 1000) / 1000;

function loadDeviceFlow(file, { baseUrl, transport, session = false } = {}) {
  const { flow, hash } = loadFlow(file);
  const p = flowProblems(flow);
  if (p.length) throw new Error(`invalid flow ${file}:\n  ${p.join('\n  ')}`);
  if (flow.device.kind !== 'android') throw new Error(`${file}: device.kind is "${flow.device.kind}" — rehearse/perform drive a device (kind "android"); use \`kinetype capture\` for desktop/phone emulation`);
  const f = resolveDeviceFlow(flow, { baseUrl, transport });
  const q = deviceFlowProblems(f, { session });
  if (q.length) throw new Error(`flow ${file} cannot run on a device:\n  ${q.join('\n  ')}`);
  return { flow: f, hash };
}

/** The app-state reset hook (`--reset CMD`, run by the host shell): a rehearsal really submits forms, so a stateful
 * app must be put back before the take, and again before every rehearsal. Its LAST stdout line may be JSON
 * `{"vars": {"NAME": "value"}}`: values the reset minted (a fresh portal link, an order id) that the flow references as
 * `{{NAME}}` in step `url`/`value` and setup `url`. Substitution happens AFTER hashing, so one rehearsal of the flow
 * bytes stays valid across resets. Non-zero exit = the take stops. */
export function runReset(cmd, { log = () => {}, timeoutMs = 180000 } = {}) {
  if (!cmd) return {};
  log(`reset: ${cmd}`);
  const r = spawnSync('/bin/sh', ['-c', cmd], { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 8 << 20 });
  if (r.error) throw new Error(`reset failed: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`reset exited ${r.status}: ${(r.stderr || '').trim().split('\n').slice(-3).join(' | ')}`);
  const last = (r.stdout || '').trim().split('\n').pop() || '';
  if (!last.startsWith('{')) return {};
  let doc; try { doc = JSON.parse(last); } catch { return {}; }
  const vars = {};
  for (const [k, v] of Object.entries(doc.vars || {})) if (/^[A-Z][A-Z0-9_]*$/.test(k) && typeof v === 'string') vars[k] = v;
  log(`reset vars: ${Object.keys(vars).join(', ') || '(none)'}`);
  return vars;
}

/** A copy of the flow with {{NAME}} replaced in step url/value and setup url. An unresolved {{NAME}} throws. */
export function applyVars(flow, vars = {}) {
  const sub = (v, where) => (typeof v !== 'string' ? v : v.replace(/\{\{([A-Z][A-Z0-9_]*)\}\}/g, (m, k) => {
    if (!(k in vars)) throw new Error(`${where}: {{${k}}} has no value (give it from the --reset hook's {"vars": {...}})`);
    return vars[k];
  }));
  const f = structuredClone(flow);
  f.steps = f.steps.map((st) => ({ ...st, ...(st.url !== undefined ? { url: sub(st.url, `step ${st.id}`) } : {}), ...(st.value !== undefined ? { value: sub(st.value, `step ${st.id}`) } : {}) }));
  if (Array.isArray(f.setup)) f.setup = f.setup.map((r, i) => ({ ...r, url: sub(r.url, `setup[${i}]`) }));
  return f;
}

/** Keep idle ranges out of input windows: a field being typed into is never "dead air". */
export function subtractWindows(ranges, windows) {
  let out = ranges.map((r) => [r[0], r[1]]);
  for (const [a, b] of windows) {
    out = out.flatMap(([x, y]) => (b <= x || a >= y ? [[x, y]] : [[x, a], [b, y]].filter(([p, q]) => q - p >= 0.3)));
  }
  return out.map(([a, b]) => [r3(a), r3(b)]);
}

function rehearsalDoc(flow, hash, run, info, error) {
  return {
    schema: 'kinetype.rehearsal.v1',
    flow: flow.name, flowSha256: hash, baseUrl: flow.app.baseUrl,
    transport: info?.kind, serial: info?.serial || null, screen: info?.screen || null,
    pass: !error, error: error ? String(error.message || error) : null, failedStep: error?.step || null,
    at: new Date().toISOString(),
    seconds: run ? r3(run.flowEnd - run.flowStart) : null,
    steps: run?.timings || [],
    calibration: run?.calibration || (error?.calibration ? {
      failed: true, fitErr: error.calibration.fit?.maxErr ?? error.calibration.fitErr ?? null, modelErr: error.calibration.modelErr ?? null,
      fit: error.calibration.fit?.mapping ?? error.calibration.fit ?? null, model: error.calibration.model ?? null, perAxis: error.calibration.perAxis ?? null,
      pairing: error.calibration.pairing?.method ?? error.calibration.pairing ?? null, suspects: error.calibration.suspects ?? [],
    } : null),
    calibrationDebug: error?.debugDir || run?.calibration?.debugDir || null,
    stage: stageSummary(run?.stage || error?.stage),
    qa: { smoothness: run?.smoothness || null },
    flingGain: run?.flingGain ?? null,
    input: run?.input || null,
    warnings: run?.warnings || [],
    pageErrors: run?.pageErrors || [],
  };
}

/** Rehearse on an open transport (no recording). Never throws for a flow failure: the doc says why. */
async function rehearseOn(flow, hash, tr, info, { log, session, dest } = {}) {
  let run = null, error = null;
  try { run = await runFlow(flow, tr, { mode: 'rehearse', log, session, debugDir: dest ? path.join(dest, 'calib-debug') : null }); } catch (e) { error = e; }
  return rehearsalDoc(flow, hash, run, info, error);
}

export async function rehearseFlow(file, { baseUrl, transport, serial, out, log = () => {}, reset } = {}) {
  const { flow: tpl, hash } = loadDeviceFlow(file, { baseUrl, transport });
  const flow = applyVars(tpl, runReset(reset, { log }));
  const dest = path.resolve(out || path.join('out', 'device', flow.name));
  fs.mkdirSync(dest, { recursive: true });
  const t = transportOptions(flow, { serial, log });
  const tr = await createTransport(t.kind, t.opts);
  try {
    const info = await tr.open();
    const doc = await rehearseOn(flow, hash, tr, info, { log, dest });
    fs.writeFileSync(path.join(dest, 'rehearsal.json'), JSON.stringify(doc, null, 2) + '\n');
    return { ...doc, file: path.join(dest, 'rehearsal.json') };
  } finally { await releaseStage(tr, log); await tr.close(); }
}

const stageSummary = (st) => (st ? { clean: st.clean, locale: st.locale || null, problems: st.problems, overlay: st.overlay, actions: st.actions } : null);

/** A rehearsal counts only for the same flow bytes, app URL, transport and device, and only for MAX_AGE_H hours. */
export const REHEARSAL_MAX_AGE_H = 12;
/** Undo what the stage changed on the device (demo mode, Chrome command line) — logged, never fatal. */
export async function releaseStage(tr, log = () => {}) {
  if (!tr?.stageUndo) return;
  const done = await tr.stageUndo().catch((e) => [{ name: 'stage undo', ok: false, error: e.message }]);
  tr.stageUndo = null;
  for (const d of done) log(`stage undo: ${d.name} ${d.ok ? 'ok' : 'FAILED ' + d.error}`);
}

export function priorRehearsal(file, { hash, kind, serial, baseUrl }) {
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    const fresh = Date.now() - Date.parse(d.at) < REHEARSAL_MAX_AGE_H * 3600e3;
    if (d.pass && fresh && d.flowSha256 === hash && (d.baseUrl ?? null) === (baseUrl ?? null) && d.transport === kind && (kind !== 'adb' || d.serial === serial)) return d;
  } catch {}
  return null;
}

/** Perform on an OPEN transport into dest: run, encode, QA, documents. */
async function performOn(flow, hash, tr, info, dest, { log, session, rehearsal }) {
  const wall0 = Date.now();
  const run = await runFlow(flow, tr, { mode: 'perform', out: dest, log, session, flingGain: rehearsal?.flingGain, debugDir: path.join(dest, 'calib-debug') });
  if (!run.video) throw new Error('perform: the flow never started recording (it must begin with a goto step)');
  const t0 = run.video.t0;
  const base = buildDeviceCapture(flow, run, { transportInfo: { ...info, viewport: tr.viewport || null } });
  // idle / busy from the real pixels (status bar + focused caret masked) and the DOM busy signal
  const sb = tr.kind === 'adb' ? Math.max(0, Math.round(tr.cal?.standalone ? tr.cal.top : ((await tr.adb.statusBarHeightPx(tr.serial)) || 0) * (tr.videoScale || 1))) : (tr.desktop ? 0 : tr.screen.statusBar);
  const masks = [...(sb ? [statusBarMask({ width: base.video.width, statusBarPx: sb })] : []), ...caretMasks(base.events)];
  const windows = base.events.filter((e) => ['click', 'type', 'fill', 'swipe', 'fling', 'press', 'back', 'refresh'].includes(e.type)).map((e) => [Math.max(0, e.t - (e.approach || 0)), (e.t1 ?? e.t) + 0.3]);
  const dom = run.busyDom.map(([a, b]) => [r3(Math.max(0, a - t0)), r3(Math.max(0, b - t0))]).filter(([a, b]) => b > a);
  const ib = await detectIdleBusy(path.join(dest, 'capture.mp4'), { masks, events: windows.map(([t, t1]) => ({ t, t1 })), dom });
  const doc = { ...base, idle: subtractWindows(ib.idle, windows), busy: ib.busy };
  fs.writeFileSync(path.join(dest, 'capture.json'), JSON.stringify(doc, null, 2) + '\n');
  // pixel QA against the log
  const qa = { warnings: run.warnings, pageErrors: run.pageErrors, input: run.input, recording: run.video.source, idleStats: ib.stats };
  // every flow: the logged vbox vs the real control's edges in the recorded frame (solid-colour controls; others: null)
  qa.targetBoxes = await verifyTargetBoxes(doc, path.join(dest, 'capture.mp4')).catch((e) => ({ error: e.message }));
  if (flow.calibrate === 'fixture') {
    qa.mappingVideo = await verifyMarkers(doc, path.join(dest, 'capture.mp4'));
    qa.latency = await measureTouchLatency(doc, path.join(dest, 'capture.mp4'));
    qa.clockLag = { ...(await measureClockLag(doc, path.join(dest, 'capture.mp4'))), compensatedMs: run.video.lagCompensationMs ?? 0 };
  }
  const mp4 = path.join(dest, 'capture.mp4');
  const receipt = {
    schema: 'kinetype.capture.receipt.v1',
    flow: flow.name, flowSha256: hash,
    captureSha256: sha256(Buffer.from(JSON.stringify(doc))),
    videoSha256: sha256(fs.readFileSync(mp4)),
    clock: 'wall',
    determinism: 'native wall-clock recording: the receipt hashes the video and the event log; the choreography is seeded (same flow + seed → same planned schedule)',
    transport: info, method: run.video.method,
    ...(run.video.clockOffset ? { clockOffset: run.video.clockOffset } : {}),
    ...(run.video.selfCalibration ? { recorderLag: { ...run.video.selfCalibration, compensatedMs: run.video.lagCompensationMs } } : {}),
    calibration: run.calibration,
    stage: stageSummary(run.stage),
    rehearsal: rehearsal ? { at: rehearsal.at, pass: rehearsal.pass, seconds: rehearsal.seconds } : null,
    versions: { node: process.version, ffmpeg: (spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).stdout || '').split('\n')[0] },
    wallSeconds: r3((Date.now() - wall0) / 1000),
    qa,
  };
  fs.writeFileSync(path.join(dest, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  const v = validateCaptureFile(path.join(dest, 'capture.json'));
  if (v.problems.length) throw new Error(`capture does not satisfy C2 v2:\n  ${v.problems.join('\n  ')}`);
  if (qa.mappingVideo && !qa.mappingVideo.pass) throw new Error(`mapping QA failed: max ${qa.mappingVideo.maxErr} px (> 1 px) over ${qa.mappingVideo.n} marker checks, ${qa.mappingVideo.missing} missing — see receipt.json qa.mappingVideo`);
  const sheet = await deviceSheet(dest).catch((e) => ({ error: e.message }));
  return { out: dest, capture: path.join(dest, 'capture.json'), receipt: path.join(dest, 'receipt.json'), sheet: sheet.file || sheet.error, duration: doc.duration, events: doc.events.length, idle: doc.idle.length, busy: doc.busy.length, warnings: run.warnings, qa: { mapping: qa.mappingVideo ? { maxErr: qa.mappingVideo.maxErr, n: qa.mappingVideo.n } : null, targetBoxes: qa.targetBoxes ? { n: qa.targetBoxes.n, maxErr: qa.targetBoxes.maxErr } : null, clockLagMs: qa.clockLag?.lagMs ?? null, latencyMs: qa.latency?.latencyMs || null, input: run.input, recording: run.video.source } };
}

export async function performFlow(file, { baseUrl, transport, serial, out, log = () => {}, rehearsalFile, reset } = {}) {
  const { flow: tpl, hash } = loadDeviceFlow(file, { baseUrl, transport });
  let flow = tpl;
  const dest = path.resolve(out || path.join('out', 'device', flow.name));
  fs.mkdirSync(dest, { recursive: true });
  const t = transportOptions(flow, { serial, log });
  const tr = await createTransport(t.kind, t.opts);
  try {
    const info = await tr.open();
    const want = { hash, kind: t.kind, serial: info.serial, baseUrl: flow.app.baseUrl };
    let reh = priorRehearsal(rehearsalFile ? path.resolve(rehearsalFile) : path.join(dest, 'rehearsal.json'), want);
    if (rehearsalFile && !reh) throw new Error(`--rehearsal ${rehearsalFile}: not a passing rehearsal of these flow bytes on this device/app URL within ${REHEARSAL_MAX_AGE_H} h — rehearse again`);
    if (!reh) {
      log('no passing rehearsal for these flow bytes on this device: rehearsing first');
      flow = applyVars(tpl, runReset(reset, { log }));
      reh = await rehearseOn(flow, hash, tr, info, { log, dest });
      fs.writeFileSync(path.join(dest, 'rehearsal.json'), JSON.stringify(reh, null, 2) + '\n');
      if (!reh.pass) throw new Error(`rehearsal failed — not performing: ${reh.error}`);
    }
    // the rehearsal changed the app (it really submits): put it back before the take
    flow = applyVars(tpl, runReset(reset, { log }));
    return await performOn(flow, hash, tr, info, dest, { log, rehearsal: reh });
  } finally { await releaseStage(tr, log); await tr.close(); }
}

// ---- multi-device sessions (kinetype.session.v1) ----
export class MarkRegistry {
  constructor() { this.seen = new Map(); this.waiters = []; }
  set(device, mark, T) { this.seen.set(`${device}\u0000${mark}`, T); for (const w of this.waiters.filter((x) => x.key === `${device}\u0000${mark}`)) w.resolve(T); }
  wait(device, mark, timeoutS) {
    const key = `${device}\u0000${mark}`;
    if (this.seen.has(key)) return Promise.resolve(this.seen.get(key));
    return new Promise((resolve) => {
      const w = { key, resolve: (v) => { clearTimeout(timer); resolve(v); } };
      const timer = setTimeout(() => resolve(null), timeoutS * 1000);
      this.waiters.push(w);
    });
  }
}

export function sessionProblems(s) {
  const p = [];
  if (s?.schema !== 'kinetype.session.v1') p.push('schema must be "kinetype.session.v1"');
  const ids = [...new Set((s?.devices || []).map((d) => d.id))];
  if (!Array.isArray(s?.devices) || !s.devices.length || ids.length > 3) p.push('devices: 1–3 distinct device ids [{id, flow}] (an id may repeat: its flows run in order on that device)');
  for (const [i, d] of (s?.devices || []).entries()) {
    if (!d.id || !/^[a-z0-9][a-z0-9_-]*$/.test(d.id)) p.push(`devices[${i}].id must be a short slug`);
    if (!d.flow) p.push(`devices[${i}].flow missing`);
  }
  for (const [i, x] of (s?.sync || []).entries()) {
    for (const k of ['wait', 'after']) if (typeof x?.[k] !== 'string' || !/^[a-z0-9][a-z0-9_-]*:[a-z0-9][a-z0-9._-]*$/.test(x[k])) p.push(`sync[${i}].${k} must be "device:mark"`);
    for (const k of ['wait', 'after']) if (typeof x?.[k] === 'string' && !ids.includes(x[k].split(':')[0])) p.push(`sync[${i}].${k} names unknown device "${x[k].split(':')[0]}"`);
  }
  return p;
}

/**
 * Session-level `sync: [{wait: "dev:mark", after: "dev:mark"}]` → a `sync` step in the waiting flow, at the start of
 * the beat that ends at the waited mark (just after the previous mark): the whole beat happens after the cause.
 */
export function compileSessionSync(entries, sync = []) {
  for (const x of sync) {
    const [wd, wm] = x.wait.split(':'); const [ad, am] = x.after.split(':');
    const e = entries.find((d) => d.id === wd && d.flow.steps.some((st) => st.action === 'mark' && st.id === wm));
    if (!e) throw new Error(`sync: no flow on device "${wd}" has mark "${wm}"`);
    if (!entries.some((d) => d.id === ad && d.flow.steps.some((st) => st.action === 'mark' && st.id === am))) throw new Error(`sync: no flow on device "${ad}" has mark "${am}"`);
    const steps = e.flow.steps;
    const k = steps.findIndex((st) => st.action === 'mark' && st.id === wm);
    let b = k; while (b > 0 && steps[b - 1].action !== 'mark') b--;
    let id = `sync-${wm}`; for (let n = 2; steps.some((st) => st.id === id); n++) id = `sync-${wm}-${n}`;
    steps.splice(b, 0, { id, action: 'sync', device: ad, mark: am, timeout: x.timeout ?? 60, hold: 0 });
  }
  return entries;
}

export async function performSession(file, { out, log = () => {}, baseUrl, transport, rehearseOnly = false, reset } = {}) {
  const dir = path.dirname(path.resolve(file));
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  const p = sessionProblems(s);
  if (p.length) throw new Error(`invalid session ${file}:\n  ${p.join('\n  ')}`);
  const dest = path.resolve(out || path.join('out', 'device', s.name || path.basename(file, '.json')));
  fs.mkdirSync(dest, { recursive: true });
  const entries = s.devices.map((d) => {
    const { flow, hash } = loadDeviceFlow(path.resolve(dir, d.flow), { baseUrl: d.baseUrl || baseUrl, transport: transport || d.transport, session: true });
    return { ...d, flow, hash };
  });
  compileSessionSync(entries, s.sync);
  for (const e of entries) {
    for (const st of e.flow.steps) if (st.action === 'sync' && !entries.some((x) => x.id === st.device)) throw new Error(`${e.id}: sync waits for unknown device "${st.device}"`);
    // the compiled flow is what runs: hash it, so a rehearsal of other bytes is never reused
    if (s.sync?.length) e.hash = sha256(Buffer.from(JSON.stringify(e.flow)));
  }
  // one chain per device: its flows in order, on one transport
  const chains = [...new Set(entries.map((e) => e.id))].map((id) => ({ id, entries: entries.filter((e) => e.id === id) }));
  for (const c of chains) for (const e of c.entries) e.dest = c.entries.length > 1 ? path.join(dest, c.id, e.flow.name) : path.join(dest, c.id);
  const lg = (id) => (m) => log(`[${id}] ${m}`);
  try {
    for (const c of chains) {
      const first = c.entries[0];
      const t = transportOptions(first.flow, { serial: first.serial, log: lg(c.id) });
      c.tr = await createTransport(t.kind, t.opts);
      c.info = await c.tr.open();
      for (const e of c.entries) fs.mkdirSync(e.dest, { recursive: true });
    }
    // reset once for the whole session (one app, several devices), then fill each flow's {{vars}}
    for (const e of entries) e.tpl = e.flow;
    const useVars = (vars) => { for (const e of entries) e.flow = applyVars(e.tpl, vars); };
    useVars(runReset(reset, { log }));
    // rehearse together (syncs need each other), on one clock
    const rehClock = now(); const rehMarks = new MarkRegistry();
    await Promise.all(chains.map(async (c) => {
      for (const e of c.entries) {
        e.reh = await rehearseOn(e.flow, e.hash, c.tr, c.info, { log: lg(c.id), session: { clock0: rehClock, marks: rehMarks, deviceId: c.id }, dest: e.dest });
        fs.writeFileSync(path.join(e.dest, 'rehearsal.json'), JSON.stringify(e.reh, null, 2) + '\n');
        if (!e.reh.pass) break;
      }
    }));
    const failed = entries.filter((e) => e.reh && !e.reh.pass).map((e) => `${e.id}/${e.flow.name}: ${e.reh.error}`);
    const notRun = entries.filter((e) => !e.reh).map((e) => `${e.id}/${e.flow.name}: not rehearsed (an earlier flow on the device failed)`);
    const summary = { schema: 'kinetype.session.result.v1', session: s.name || path.basename(file), rehearsal: entries.map((e) => ({ device: e.id, flow: e.flow.name, pass: !!e.reh?.pass, error: e.reh ? e.reh.error : 'not rehearsed (an earlier flow on the device failed)', seconds: e.reh?.seconds ?? null })) };
    if (failed.length || notRun.length || rehearseOnly) {
      fs.writeFileSync(path.join(dest, 'session.json'), JSON.stringify(summary, null, 2) + '\n');
      if (failed.length || notRun.length) throw new Error(`session rehearsal failed — not performing:\n  ${[...failed, ...notRun].join('\n  ')}`);
      return summary;
    }
    useVars(runReset(reset, { log })); // the rehearsal changed the app: put it back before the take
    const clock0 = now(); const marks = new MarkRegistry();
    const results = [];
    // allSettled: one device failing must not tear the shared transports down while another is still recording
    const settled = await Promise.allSettled(chains.map(async (c) => {
      for (const e of c.entries) {
        const r = await performOn(e.flow, e.hash, c.tr, c.info, e.dest, { log: lg(c.id), session: { clock0, marks, deviceId: c.id }, rehearsal: e.reh });
        results.push({ e, r });
      }
    }));
    const bad = settled.map((x, i) => (x.status === 'rejected' ? `${chains[i].id}: ${x.reason?.message || x.reason}` : null)).filter(Boolean);
    if (bad.length) throw new Error(`session perform failed:\n  ${bad.join('\n  ')}`);
    summary.devices = entries.map((e) => {
      const { r } = results.find((x) => x.e === e);
      const cap = JSON.parse(fs.readFileSync(r.capture, 'utf8'));
      return { id: e.id, flow: e.flow.name, capture: path.relative(dest, r.capture), sessionOffset: cap.sessionOffset, duration: cap.duration, marks: cap.marks.map((m) => ({ id: m.id, t: m.t, session: r3(m.t + cap.sessionOffset) })) };
    });
    summary.clock = 'host monotonic (performance.now) — one clock for every device; session t = video t + sessionOffset';
    fs.writeFileSync(path.join(dest, 'session.json'), JSON.stringify(summary, null, 2) + '\n');
    return { ...summary, out: dest, results: results.map((x) => x.r) };
  } finally { for (const c of chains) { if (c.tr) await releaseStage(c.tr, lg(c.id)); await c.tr?.close(); } }
}

export { runFlow, createTransport, os };
