// Rehearse / perform a kinetype.flow.v1 flow on a device transport.
//
// One engine, two modes. `rehearse` runs the flow WITHOUT recording and asserts every target resolves to exactly
// one element that is visible and unobstructed, every step settles and every mark/sync is reached within its
// timeout; it prints per-step timings and the pace findings. `perform` refuses to start unless a passing rehearsal
// of the same flow bytes on the same transport exists (it runs one itself when none is given), then resets the
// app, pre-warms every route, and records natively while the choreographer drives the input.
//
// Times: every event is logged on the host monotonic clock and converted to video seconds at the end
// (t_video = t_host − frame0_host), so a multi-device session shares one clock (sessionOffset per device).
import fs from 'node:fs';
import path from 'node:path';
import { assertSameOrigin, sha256 } from '../capture/flow.js';
import { boxOf, centerOf } from '../capture/events.js';
import { stats } from '../capture/timeline.js';
import { tempoFor, stepRng, tapPlan, typingPlan, dragPath, reachPlan, holdFor } from './choreo.js';
import { mapBox, mapPoint, keyboardInset } from './mapping.js';
import { createTransport, now, sleepUntil, STAND_IN } from './transport.js';
import { describeTarget } from './targets.js';
import { prepareStage } from './stage.js';

const sleep = (s) => sleepUntil(now() + s);
const r3 = (n) => Math.round(n * 1000) / 1000;
export const DEVICE_ONLY = new Set(['tap', 'swipe', 'fling', 'back', 'keyboard', 'sync', 'refresh']);
const UNSUPPORTED_ON_TOUCH = new Set(['hover']);

/** Frame pacing from frame timestamps (s): fps, janky % (interval > 1.5 vsync), p95 frame time. Pure. */
export function framePacing(ts, { vsync = 1 / 60 } = {}) {
  const t = [...ts].sort((a, b) => a - b);
  if (t.length < 3) return { frames: t.length, fps: null, jankyPct: null, p95Ms: null };
  const iv = t.slice(1).map((x, i) => x - t[i]).filter((d) => d > 0.001 && d < 0.5);
  if (!iv.length) return { frames: t.length, fps: null, jankyPct: null, p95Ms: null };
  const sorted = [...iv].sort((a, b) => a - b);
  const span = iv.reduce((a, b) => a + b, 0);
  return { frames: iv.length + 1, fps: +(iv.length / span).toFixed(1), jankyPct: +(100 * iv.filter((d) => d > 1.5 * vsync).length / iv.length).toFixed(1), p95Ms: +(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] * 1000).toFixed(1), maxMs: +(sorted[sorted.length - 1] * 1000).toFixed(1) };
}

/** Aggregate per-gesture pacing; the DISPLAY measurement (SurfaceFlinger) wins over the page's when present. */
export function summarizeSmoothness(list, { minFps = 55, maxJanky = 5 } = {}) {
  const pick = (g) => (g.display && g.display.fps ? { src: 'display', ...g.display } : { src: 'page', ...g.page });
  const per = list.map((g) => ({ step: g.step, kind: g.kind, ...pick(g) })).filter((g) => g.fps);
  if (!per.length) return { gestures: list, verdict: 'unknown', reason: 'no frames measured' };
  const fps = Math.min(...per.map((g) => g.fps)), janky = Math.max(...per.map((g) => g.jankyPct ?? 0)), p95 = Math.max(...per.map((g) => g.p95Ms ?? 0));
  const bad = fps < minFps || janky > maxJanky;
  return { gestures: list, worst: { fps, jankyPct: janky, p95Ms: p95, source: per.find((g) => g.fps === fps)?.src }, thresholds: { minFps, maxJankyPct: maxJanky }, verdict: bad ? 'warn' : 'ok', reason: bad ? `worst gesture ${fps} fps, ${janky} % janky, p95 ${p95} ms (want ≥ ${minFps} fps, ≤ ${maxJanky} % janky)` : null };
}

/** Page clock → host clock: offset from the probe with the smallest round trip seen so far (refreshed when a probe
 * beats it, or when the best is > 10 s old — clocks drift a little). Exported for tests. */
export function makePageClock() {
  let best = null;
  return {
    toHost(pageT, h0, h1) {
      const rtt = h1 - h0, off = (h0 + h1) / 2 - pageT;
      if (!best || rtt <= best.rtt || h1 - best.at > 10) best = { rtt, off, at: h1 };
      // never outside the window the state was actually read in
      return Math.min(h1, Math.max(h0, pageT + best.off));
    },
    get rtt() { return best?.rtt ?? null; },
    get offset() { return best?.off ?? 0; },
  };
}

/** Where a located target lives: page (CSS box + video box + mapping) or native UI (video box + accessibility node). */
const spaceOf = (loc) => (loc.os ? { space: 'os', vbox: loc.vbox, os: loc.node } : { box: boxOf(loc.box), vbox: loc.vbox, mapping: loc.mapping });

export class RehearsalError extends Error {
  constructor(step, msg) { super(`step ${step.id} (${step.action}): ${msg}`); this.step = step.id; }
}

/** Defaults for an android flow (the headless `capture` driver keeps its own). */
export function resolveDeviceFlow(flow, { baseUrl, transport } = {}) {
  const f = structuredClone(flow);
  // a native-only flow (every target is OS UI) has no web app
  f.app = f.app ? { ...f.app } : { name: flow.name, baseUrl: null, native: true };
  if (baseUrl && !f.app.native) f.app.baseUrl = baseUrl;
  if (f.app.baseUrl) f.app.baseUrl = f.app.baseUrl.replace(/\/+$/, '');
  for (const s of f.steps) {
    for (const k of ['target', 'until']) if (s[k]?.testid !== undefined) { s[k] = { ...s[k], testId: s[k].testId ?? s[k].testid }; delete s[k].testid; }
    // refresh with no means given: a target → tap it; none → the app's own hashchange trigger
    if (s.action === 'refresh' && !s.via) s.via = s.target ? 'tap' : 'hashchange';
  }
  f.device.target = { browser: 'chrome', transport: 'adb', ...(f.device.target || {}), ...(transport ? { transport } : {}) };
  f.fps = 60;
  f.seed = f.seed ?? 1;
  f.setup = f.setup || [];
  f.tempo = f.tempo || { preset: 'demo-artist' };
  f.calibrate = f.calibrate || 'overlay';
  f.trackTail = f.trackTail ?? 3;
  return f;
}

export function deviceFlowProblems(flow, { session = false } = {}) {
  const out = [];
  for (const [i, s] of flow.steps.entries()) {
    if (UNSUPPORTED_ON_TOUCH.has(s.action) && !['cdp-desktop'].includes(flow.device.target?.transport)) out.push(`/steps/${i} "${s.action}" does not exist on a touch screen`);
    if (s.action === 'sync' && !session) out.push(`/steps/${i} sync needs a multi-device session (kinetype perform session.json)`);
    if (s.action === 'refresh' && s.via === 'tap' && !s.target) out.push(`/steps/${i} refresh via tap needs the target to tap (e.g. a tab)`);
    if ((s.target?.os || s.until?.os) && flow.device.target?.transport !== 'adb') out.push(`/steps/${i} native (os) targets need the adb transport (a real Android device)`);
    if (s.target?.os && ['scroll', 'swipe', 'fling', 'refresh'].includes(s.action)) out.push(`/steps/${i} "${s.action}" with a native (os) target is not supported (tap/type/observe/waitFor only)`);
  }
  return out;
}

/** Transport options from the flow + CLI overrides. */
export function transportOptions(flow, { serial, log } = {}) {
  const t = flow.device.target;
  const kind = t.transport;
  if (kind === 'adb') return { kind, opts: { serial: serial || t.serial, browser: t.browser, baseUrl: flow.app.baseUrl, textInput: t.textInput, log } };
  if (kind === 'cdp-desktop') return { kind, opts: { desktop: { width: flow.device.viewport?.width || 1440, height: flow.device.viewport?.height || 900, dpr: flow.device.deviceScaleFactor || 1 }, log } };
  return { kind, opts: { screen: { ...STAND_IN, ...(flow.device.screen || {}) }, log } };
}

/**
 * Run a resolved device flow on an OPEN transport.
 * mode: 'rehearse' | 'perform'.  session: {clock0, marks: Registry, deviceId} for multi-device runs.
 */
export async function runFlow(flow, tr, { mode = 'rehearse', out = null, session = null, log = () => {}, flingGain = null, reset = true, debugDir = null } = {}) {
  const recording = mode === 'perform';
  const clock0 = session?.clock0 ?? now();
  const events = [], marks = [], steps = [], timings = [], warnings = [], busyDom = [], navs = [];
  const tempo0 = tempoFor(flow.tempo);
  const pageClock = makePageClock();
  const scrollLog = [];
  const frameLog = []; // host times of the page's animation frames (Chrome frame pacing)
  const smooth = [];   // per gesture: page pacing + SurfaceFlinger/gfxinfo when the transport has them
  let video = null;
  const trackers = new Map();
  let gain = flingGain ?? tempo0.flingTau;
  const gainSamples = [];

  // ---- reset + pre-warm (never on camera) ----
  const web = !!flow.app.baseUrl;
  const origin = web ? new URL(flow.app.baseUrl).origin : null;
  const firstUrl = web ? assertSameOrigin(flow.app.baseUrl, flow.steps.find((s) => s.action === 'goto')?.url || '/') : null;
  const setup = async () => {
    if (!flow.setup.length || !web) return;
    const cur = await tr.evaluate('location.origin').catch(() => null);
    if (cur !== origin) await tr.navigate(firstUrl);
    for (const [i, r] of flow.setup.entries()) {
      const url = assertSameOrigin(flow.app.baseUrl, r.url);
      const st = await tr.evaluate(`fetch(${JSON.stringify(url)}, { method: ${JSON.stringify(r.method)}, credentials: 'include', headers: ${JSON.stringify({ 'content-type': 'application/json', ...(r.headers || {}) })}, ${r.body !== undefined ? `body: ${JSON.stringify(JSON.stringify(r.body))}` : ''} }).then(async (x) => { await x.text(); return x.status; })`);
      if (st >= 400) throw new Error(`setup[${i}] ${r.method} ${new URL(url).pathname} -> HTTP ${st}`);
    }
  };
  const prewarm = async () => {
    const urls = [...new Set(flow.steps.filter((s) => s.action === 'goto').map((s) => assertSameOrigin(flow.app.baseUrl, s.url)))];
    for (const u of urls) { await tr.navigate(u); await tr.lib('ready'); }
    await tr.evaluate('scrollTo(0, 0)');
  };
  if (reset) await setup();
  if (web && flow.steps.some((s) => s.action === 'goto')) await prewarm();
  if (reset) await setup();

  // ---- CLEAN STAGE (locale, demo-mode status bar, translate off, one tab, no overlay over the page) ----
  let stage = null;
  if (flow.stage !== false) {
    stage = await prepareStage(tr, flow.stage || {}, { debugDir, log, ready: async () => { if (web) { await tr.navigate(firstUrl); await settle({ id: 'stage' }, tempo0); } } });
    // the run's owner undoes the stage when the device is released (index.js); chained, because a rehearsal and a
    // perform on one connection each stage it and only the first one saw the device's original state
    const prevUndo = tr.stageUndo, mine = stage.undo;
    tr.stageUndo = async () => [...(await mine()), ...(prevUndo ? await prevUndo() : [])];
    log(`stage: ${stage.clean ? 'clean' : 'NOT clean'} (${stage.actions.length} actions)`);
    if (!stage.clean) { const e = new Error(`stage not clean — ${stage.problems.join(' | ')}`); e.stage = stage; throw e; }
  }

  // ---- calibration (rehearsal measures it; perform re-checks it before the camera rolls) ----
  let calibration = null;
  if (flow.calibrate !== 'off' && web) {
    if (flow.calibrate === 'fixture' || flow.calibrate === 'overlay') {
      await tr.navigate(firstUrl);
      // fail closed in both modes: a perform with a wrong mapping would write wrong vbox values that still validate
      try {
        calibration = await tr.calibrate({ overlay: flow.calibrate === 'overlay', debugDir });
      } catch (e) {
        // NO marker on screen at all = the page was swapped under the overlay (a reload/route change in flight, e.g.
        // right after a --reset hook logged in), not a mapping error: let it land and measure once more
        if (!/found 0 of \d+ markers/.test(e.message)) throw e;
        log(`calibration: no marker visible (page swapped under the overlay?) — retrying once`);
        await sleep(1.5); await tr.navigate(firstUrl); await settle({ id: 'calibration' }, tempo0);
        calibration = await tr.calibrate({ overlay: flow.calibrate === 'overlay', debugDir });
      }
      if (calibration.modelErr > 1) {
        const e = new Error(`calibration: mapping error ${calibration.modelErr} px > 1 px (fit ${calibration.fitErr} px)${calibration.suspects?.length ? ' — ' + calibration.suspects[0] : ''}`);
        e.calibration = calibration;
        e.debugDir = calibration.debugDir;
        throw e;
      }
    }
  }

  // ---- background observer: tracks, URL, DOM busy, keyboard (≈ 10 Hz) ----
  let observing = true;
  let lastUrl = null, busySince = null, kbUp = false;
  const snapshot = async () => {
    if (!tr.cdp) return null; // native UI only (so far): nothing to observe in a page
    const ids = [...trackers.values()].filter((x) => !x.done).map((x) => x.pid);
    const h0 = now();
    const s = await tr.evaluate(`(() => { const L = ${'window.__ktDevice'}; if (!L) return null; return { pt: performance.timeOrigin + performance.now(), sl: L.drainScroll(), m: L.metrics(), p: ${JSON.stringify(ids)}.map((id) => L.probe(id)), busy: L.busy() }; })()`).catch(() => null);
    const h1 = now();
    // WHEN the page was in this state: its own clock, mapped to the host clock by the minimum-round-trip offset
    // (NTP-style). Stamping the host time before the call would make the log early by the renderer's delay —
    // under load (or over adb) 100–300 ms; measured on video as qa.clockLag.
    if (s) s.T = pageClock.toHost(s.pt / 1000, h0, h1);
    return s && { ...s, ids };
  };
  const observer = (async () => {
    while (observing) {
      const t0 = now();
      const s = await snapshot();
      const t = s?.T ?? t0;
      if (s) {
        // the page's per-frame scroll timeline, mapped to host time by the same offset
        for (const [pt, y] of s.sl?.scroll || []) { const T = pt / 1000 + pageClock.offset; if (!scrollLog.length || T > scrollLog[scrollLog.length - 1].T) scrollLog.push({ T, y }); }
        for (const pt of s.sl?.frames || []) frameLog.push(pt / 1000 + pageClock.offset);
        if (s.m.url !== lastUrl) { if (lastUrl !== null) navs.push({ T: t, url: s.m.url }); lastUrl = s.m.url; }
        if (s.busy && busySince === null) busySince = t;
        if (!s.busy && busySince !== null) { busyDom.push([busySince, t]); busySince = null; }
        const up = keyboardInset(s.m) > 0;
        if (up !== kbUp) { events.push({ T: t, type: 'keyboard', show: up, inset: keyboardInset(s.m) }); kbUp = up; }
        const mapping = tr.mappingOf(s.m);
        for (const [k, id] of s.ids.entries()) {
          const x = trackers.get(id);
          if (!x || x.done) continue;
          const p = s.p[k];
          if (t > x.until) { x.done = true; x.end = x.until; continue; }
          const box = p.box ? boxOf(p.box) : null;
          const key = JSON.stringify([box, !!p.visible, mapping.oy]);
          // on change: a new entry; unchanged: the last entry is re-confirmed (U = last probe that saw it, n probes) — so
          // a consumer can tell a span PROVEN still by probes from one where the observer simply did not look
          if (key !== x.lastKey) { x.entries.push({ T: t, U: t, n: 1, ...(box ? { box, vbox: mapBox(mapping, box) } : {}), visible: !!p.visible }); x.lastKey = key; }
          else { const last = x.entries[x.entries.length - 1]; last.U = t; last.n = (last.n || 1) + 1; }
          if (p.gone) { x.done = true; x.end = t; }
        }
      }
      await sleep(Math.max(0.02, 0.1 - (now() - t0)));
    }
  })();
  const track = (loc, stepId) => {
    const x = { pid: loc.id, step: stepId, entries: [{ T: now(), box: boxOf(loc.box), vbox: loc.vbox, visible: !!loc.visible }], lastKey: null, done: false, until: Infinity, end: null };
    trackers.set(loc.id, x); // ids are unique per document AND across documents (targets.js)
    return x;
  };

  // ---- primitives ----
  async function settle(step, tempo) {
    const t0 = now();
    if (step.target?.os || !tr.cdp) { await sleep(tempo.settle.native ?? 0.5); return r3(now() - t0); }
    let quietSince = null, lastSig = null;
    while (now() - t0 < tempo.settle.max) {
      const sig = await tr.evaluate(`JSON.stringify([document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity).length, Math.round(scrollY), (window.__ktDevice ? window.__ktDevice.scrollerAt({ x: innerWidth / 2, y: innerHeight / 2 }).top : 0), location.hash])`).catch(() => 'x');
      let anim = 1; try { anim = JSON.parse(sig)[0]; } catch {}
      const quiet = tr.inflight.size === 0 && sig === lastSig && anim === 0;
      lastSig = sig;
      if (quiet) { quietSince ??= now(); if (now() - quietSince >= tempo.settle.quiet) { await tr.freshFrame?.(); return r3(now() - t0); } } else quietSince = null;
      await sleep(0.03);
    }
    warnings.push(`step ${step.id}: still moving after ${tempo.settle.max} s (pace: > 2.5 s without settling; ${tr.inflight.size} request(s) in flight ${JSON.stringify(tr.inflight.list?.() || []).slice(0, 200)}, last state ${lastSig})`);
    return r3(now() - t0);
  }

  async function resolveTarget(step, target = step.target, { needVisible = true } = {}) {
    const deadline = now() + (step.timeout ?? 8);
    let last;
    while (now() < deadline) {
      last = target.os ? await tr.locateOs(target.os) : await tr.locate(target);
      if (last.count > 1) throw new RehearsalError(step, `target ${describeTarget(target)} is ambiguous (${last.count} matches) — add "exact": true, a stricter name, "testId" or "nth"`);
      if (last.count === 1 && (!needVisible || (last.box || last.vbox).w > 1)) return last;
      await sleep(0.1);
    }
    throw new RehearsalError(step, `target ${describeTarget(target)} not found after ${step.timeout ?? 8} s`);
  }

  const vh = async () => (await tr.metrics()).innerHeight;

  /** Bring a target into reach with human gestures (fling far, swipe near), then require it unobstructed. */
  /** Re-locate until the target holds still (two reads 80 ms apart within 1 CSS px, at most ~1.6 s): the keyboard
   * sliding in/out, Chrome scrolling a focused field into view and late layout all move a box AFTER it was read, and a
   * tap aimed at the old box toggles the wrong control (measured: a consent checkbox missed, a submit not pressed). */
  async function steady(step, loc) {
    if (loc.os || !loc.box) return loc;
    let prev = loc;
    for (let k = 0, still = 0; k < 20 && still < 2; k++) {
      await sleep(0.08);
      const nx = await resolveTarget(step, step.target).catch(() => null);
      if (!nx?.box) return prev;
      still = Math.abs(nx.box.x - prev.box.x) < 1 && Math.abs(nx.box.y - prev.box.y) < 1 && Math.abs(nx.box.h - prev.box.h) < 1 ? still + 1 : 0;
      prev = nx;
    }
    return prev;
  }

  async function reach(step, loc, tempo, r, { comfort = false } = {}) {
    if (loc.os) { if (!loc.visible) throw new RehearsalError(step, `native target ${describeTarget(step.target)} is not on screen`); return loc; }
    for (let round = 0; round < 4; round++) {
      const m = await tr.metrics();
      const kb = keyboardInset(m);
      const height = m.innerHeight - kb;
      const inView = loc.box.y >= 8 && loc.box.y + loc.box.h <= height - 8;
      const c = loc.box.y + loc.box.h / 2;
      if (comfort ? c >= tempo.comfort[0] * height && c <= tempo.comfort[1] * height : inView && loc.visible) return loc;
      const sc = await tr.lib('scrollerAt', { x: m.innerWidth / 2, y: height / 2 });
      const plan = reachPlan(loc.box, height, tempo, { flingGain: gain, calibrated: flingGain !== null || gainSamples.length > 0, scrollMax: sc.max - sc.top });
      if (!plan.length) break;
      for (const g of plan) await gesture(step, g.kind, { dyCss: g.dyCss, tempo, r, m, height });
      loc = await resolveTarget(step, step.target);
    }
    if (comfort) return loc;
    if (!loc.visible) throw new RehearsalError(step, `target ${describeTarget(step.target)} is not visible/unobstructed (covered by another layer, clipped, or outside the viewport)`);
    return loc;
  }

  /** A swipe or fling that moves content by dyCss (> 0 = content up). Logged with its true scroll from/to. */
  async function gesture(step, kind, { dyCss, from, to, tempo, r, m, height, velocity }) {
    m ||= await tr.metrics();
    height ||= m.innerHeight - keyboardInset(m);
    const mapping = tr.mappingOf(m);
    const x = m.innerWidth * (0.55 + (r() - 0.5) * 0.1);
    let a = from, b = to;
    if (!a) {
      const travel = kind === 'fling' ? Math.min(height * 0.4, Math.max(height * 0.25, Math.abs(dyCss) * 0.3)) : Math.min(Math.abs(dyCss), height * 0.7);
      const mid = height * 0.55;
      const sgn = Math.sign(dyCss) || 1;
      a = { x, y: mid + (sgn * travel) / 2 }; b = { x: x + (r() - 0.5) * 12, y: mid - (sgn * travel) / 2 };
    }
    let vel = velocity;
    if (kind === 'fling' && !vel && dyCss) {
      // momentum distance ≈ gain · v_release (CSS px): pick the release speed that lands near the target
      const travelCss = Math.abs(b.y - a.y);
      vel = Math.max(800, ((Math.abs(dyCss) - travelCss) / gain) * mapping.s);
    }
    const path = dragPath(mapPoint(mapping, a), mapPoint(mapping, b), { kind, tempo, r, velocity: vel });
    const sc0 = await tr.lib('scrollerAt', { x: a.x, y: a.y });
    await sleep(tempo.approach[0] * 0.6);
    if (mode === 'rehearse') await tr.frameStatsBegin?.().catch(() => {});
    const at = now() + 0.02;
    const res = await tr.drag(path.points, { kind, at, tau: tempo.flingTau });
    const settleS = await settle(step, tempo);
    if (mode === 'rehearse') {
      const end = now();
      await sleep(0.15); // the observer drains the page's frame log every ~100 ms
      smooth.push({ step: step.id, kind, page: framePacing(frameLog.filter((t) => t >= res.down && t <= end)), display: await tr.frameStatsEnd?.(res.down, end).catch((e) => ({ error: e.message })) ?? null });
    }
    // momentum and smooth-scroll keep moving the content after settle(): a tap aimed at the box read now would land
    // where the field WAS (measured: a missed focus on a field revealed from under the keyboard). Wait until it rests.
    let sc1 = await tr.lib('scrollerAt', { x: a.x, y: a.y });
    for (let k = 0, still = 0; k < 20 && still < 2; k++) {
      await sleep(0.08);
      const nx = await tr.lib('scrollerAt', { x: a.x, y: a.y });
      still = Math.abs(nx.top - sc1.top) < 0.5 ? still + 1 : 0;
      sc1 = nx;
    }
    if (kind === 'fling' && path.releaseVelocity) {
      const moved = Math.abs(sc1.top - sc0.top) - Math.abs(b.y - a.y);
      if (moved > 20) gainSamples.push(moved / (path.releaseVelocity / mapping.s));
    }
    const ev = { T: res.down, T1: res.up, type: kind, from: { x: r3(a.x), y: r3(a.y) }, to: { x: r3(b.x), y: r3(b.y) }, vpath: path.points.filter((_, i) => i % 4 === 0 || i === path.points.length - 1).map((p) => ({ x: p.x, y: p.y, t: p.t })), releaseVelocity: path.releaseVelocity, scroll: { from: r3(sc0.top), to: r3(sc1.top) }, mapping, ...(res.momentum ? { flingEmulated: true } : {}) };
    events.push(ev);
    events.push({ T: res.down, type: 'scroll', from: r3(sc0.top), to: r3(sc1.top), T1: now() });
    return ev;
  }

  async function tap(step, loc, tempo, r, { label } = {}) {
    const plan = tapPlan(loc.vbox, tempo, r);
    // the approach is the beat between the last settle and the finger landing (the post-drawn finger travels)
    const at = now() + plan.approach;
    const x = loc.os ? null : track(loc, step.id);
    const res = await tr.tap(plan.point, { press: plan.press, at });
    if (loc.os) {
      const ev = { T: res.down, T1: res.up, type: 'click', input: 'touch', space: 'os', ...(label ? { label } : {}), vpoint: plan.point, vbox: loc.vbox, os: loc.node, approach: plan.approach, press: plan.press, ...(loc.editable ? { editable: true } : {}) };
      events.push(ev);
      return ev;
    }
    const css = { x: r3((plan.point.x - loc.mapping.ox) / loc.mapping.s), y: r3((plan.point.y - loc.mapping.oy) / loc.mapping.s) };
    const ev = { T: res.down, T1: res.up, type: 'click', input: 'touch', ...(label ? { label } : {}), point: css, box: boxOf(loc.box), vpoint: plan.point, vbox: loc.vbox, mapping: loc.mapping, approach: plan.approach, press: plan.press, ...(loc.editable ? { editable: true } : {}) };
    Object.defineProperty(ev, '_track', { value: x, enumerable: false });
    events.push(ev);
    return ev;
  }

  // ---- run ----
  const flowStart = now();
  // a flow that does not open with a goto (native apps, an app already on screen) films from its first step
  let finished = false;
  try {
  if (recording && flow.steps[0].action !== 'goto') { video = await tr.recordStart(out); log(`recording (frame 0 at host ${video.t0.toFixed(3)})`); }
  for (const step of flow.steps) {
    const tempo = tempoFor(flow.tempo, step.tempo);
    const r = stepRng(flow.seed, step.id);
    const T0 = now();
    const timing = { id: step.id, action: step.action };
    const firstEvent = events.length;
    log(`step ${step.id} (${step.action})`);
    switch (step.action) {
      case 'goto': {
        const u = assertSameOrigin(flow.app.baseUrl, step.url);
        await tr.navigate(u);
        timing.settle = await settle(step, tempo);
        if (recording && !video) {
          await tr.evaluate('scrollTo(0, 0)');
          await sleep(0.3);
          video = await tr.recordStart(out);
          log(`recording (frame 0 at host ${video.t0.toFixed(3)})`);
        }
        break;
      }
      case 'click':
      case 'tap': {
        let loc = await resolveTarget(step);
        timing.resolveMs = Math.round((now() - T0) * 1000);
        loc = await steady(step, await reach(step, loc, tempo, r));
        await tap(step, loc, tempo, r, { label: step.label });
        timing.settle = await settle(step, tempo);
        break;
      }
      case 'type':
      case 'fill': {
        let loc = await resolveTarget(step);
        timing.resolveMs = Math.round((now() - T0) * 1000);
        if (!loc.focused) {
          loc = await steady(step, await reach(step, loc, tempo, r));
          await tap(step, loc, tempo, r);
          await sleep(tempo.keyboardWait);
          loc = await resolveTarget(step);
          // never type blind: a tap that missed would put the text somewhere else
          if (!loc.focused) throw new RehearsalError(step, `the tap on ${describeTarget(step.target)} did not focus it (nothing typed)`);
        } else if (!loc.os) track(loc, step.id);
        const text = step.secret ? '•'.repeat([...step.value].length) : step.value;
        if (step.action === 'fill') {
          const T = now();
          await (loc.os ? tr.typeNative([{ ch: step.value, at: 0 }], T) : tr.typeText([{ ch: step.value, at: 0 }], T));
          events.push({ T, T1: now(), type: 'fill', text, ...spaceOf(loc) });
        } else {
          const plan = typingPlan(step.value, tempo, r);
          if (plan.overCap) warnings.push(`step ${step.id}: typing ${plan.duration} s > ${tempo.typingCap} s even at the floor rate (pace: shorten the text or speed-ramp in post)`);
          const at = now() + 0.05;
          const keys = plan.keys.length ? await (loc.os ? tr.typeNative(plan.keys, at) : tr.typeText(plan.keys, at)) : [at];
          events.push({ T: keys[0], T1: keys[keys.length - 1], type: 'type', text, ...spaceOf(loc), editable: true, ...(plan.compressed ? { compressed: plan.compressed } : {}) });
          timing.typing = plan.duration;
        }
        timing.settle = await settle(step, tempo);
        break;
      }
      case 'press': {
        const T = now();
        await tr.key(step.key);
        events.push({ T, type: 'press', key: step.key });
        timing.settle = await settle(step, tempo);
        break;
      }
      case 'scroll': {
        if (step.target) {
          const loc = await resolveTarget(step);
          await reach(step, loc, tempo, r, { comfort: true });
        } else await gesture(step, Math.abs(step.by) > (await vh()) * 0.9 ? 'fling' : 'swipe', { dyCss: step.by, tempo, r });
        break;
      }
      case 'swipe':
      case 'fling': {
        if (step.target) { const loc = await resolveTarget(step); await reach(step, loc, tempo, r, { comfort: true }); break; }
        let dy = 0;
        if (step.direction) dy = (step.direction === 'up' ? 1 : -1) * (step.distance ?? (await vh()) * 0.45);
        await gesture(step, step.action, { dyCss: dy, from: step.from, to: step.to, tempo, r, velocity: step.velocity });
        break;
      }
      case 'back': {
        await sleep(tempo.approach[0]);
        const T = now();
        await tr.back();
        events.push({ T, type: 'back' });
        timing.settle = await settle(step, tempo);
        break;
      }
      case 'keyboard': {
        const m = await tr.metrics();
        const up = keyboardInset(m) > 0 || m.editableFocused;
        if (step.show && !up) throw new RehearsalError(step, 'keyboard show: tap a field instead (a person opens the keyboard by tapping where they type)');
        if (!step.show && up) { const T = now(); await tr.hideKeyboard(); events.push({ T, type: 'keyboard', show: false, by: 'driver' }); }
        timing.settle = await settle(step, tempo);
        break;
      }
      case 'wait': await sleep(step.seconds); break;
      case 'waitFor': {
        if (step.target) {
          try { await resolveTarget(step); } catch (e) { if (!step.optional) throw e; }
        } else { const d = now() + (step.timeout ?? 15); while (tr.inflight?.size && now() < d) await sleep(0.05); }
        timing.settle = await settle(step, tempo);
        break;
      }
      case 'mark': marks.push({ T: now(), id: step.id }); session?.marks.set(session.deviceId, step.id, now()); break;
      case 'observe': {
        const loc = await resolveTarget(step);
        const ev = { T: now(), type: 'observe', ...spaceOf(loc), visible: !!loc.visible, ...(step.label ? { label: step.label } : {}) };
        if (!loc.os) Object.defineProperty(ev, '_track', { value: track(loc, step.id), enumerable: false });
        events.push(ev);
        // observe = "record a box for a highlight": a covered target would put a ring over a bubble/sheet — blocking
        // in both modes; `optional: true` marks a pure tracking observe (e.g. a marker that scrolls in later)
        if (!loc.visible && !step.optional) throw new RehearsalError(step, `highlight target ${describeTarget(step.target)} is not fully visible/unobstructed (covered by another layer, clipped, or off screen) — mark the step "optional": true if it only tracks`);
        if (mode === 'rehearse' && !loc.visible) warnings.push(`step ${step.id}: observed target is not fully visible/unobstructed (a highlight on it would not be drawn)`);
        break;
      }
      case 'sync': {
        if (!session) throw new RehearsalError(step, 'sync outside a session');
        const T = now();
        const at = await session.marks.wait(step.device, step.mark, step.timeout ?? 30);
        if (at === null) throw new RehearsalError(step, `device "${step.device}" never reached mark "${step.mark}" within ${step.timeout ?? 30} s`);
        events.push({ T, T1: now(), type: 'sync', device: step.device, mark: step.mark, waited: r3(now() - T) });
        break;
      }
      case 'refresh': {
        const T = now();
        if (step.via === 'tap') {
          let loc = await resolveTarget(step);
          loc = await reach(step, loc, tempo, r);
          await tap(step, loc, tempo, r, { label: step.label });
        } else if (step.via === 'hashchange') await tr.evaluate(`(() => { const h = location.hash; location.hash = h + (h.includes('?') ? '&' : '?') + 'r=1'; setTimeout(() => { location.hash = h; }, 50); })()`);
        else if (step.via === 'reload') await tr.navigate(await tr.evaluate('location.href'));
        if (step.until) {
          const d = now() + (step.timeout ?? 25);
          let ok = false;
          while (now() < d) { const l = await tr.locate(step.until); if (l.count > 1) throw new RehearsalError(step, `refresh: until ${describeTarget(step.until)} is ambiguous (${l.count} matches)`); if (l.count === 1 && l.visible) { ok = true; break; } await sleep(0.1); }
          if (!ok) throw new RehearsalError(step, `refresh: ${describeTarget(step.until)} did not appear within ${step.timeout ?? 25} s`);
        }
        events.push({ T, T1: now(), type: 'refresh', via: step.via, waited: r3(now() - T) });
        timing.settle = await settle(step, tempo);
        break;
      }
      default: throw new RehearsalError(step, `action not supported on a device: ${step.action}`);
    }
    const hold = holdFor(step, tempo, r);
    if (hold) await sleep(hold);
    const T1 = now();
    steps.push({ id: step.id, T0, T1 });
    for (let k = firstEvent; k < events.length; k++) if (events[k].type !== 'keyboard') events[k].step ??= step.id;
    for (const x of trackers.values()) if (x.step === step.id && x.until === Infinity) x.until = T1 + flow.trackTail;
    timing.seconds = r3(T1 - T0);
    timings.push(timing);
  }

  finished = true;
  } finally {
    // a failed step (a normal failed rehearsal) must not leave the observer polling or a recording running
    if (!finished) {
      observing = false;
      await observer.catch(() => {});
      if (video) await tr.recordAbort?.().catch(() => {});
    }
  }

  // ---- stop ----
  const flowEnd = now();
  let rec = null;
  if (recording) rec = await tr.recordStop({ out: path.join(out, 'capture.mp4'), scrollLog });
  observing = false;
  await observer;
  if (busySince !== null) busyDom.push([busySince, now()]);
  if (gainSamples.length) gain = gainSamples.reduce((a, b) => a + b, 0) / gainSamples.length;

  // smoothness (rehearse): Chrome's frame pacing during every fling/swipe/scroll
  let smoothness = null;
  if (smooth.length) {
    smoothness = summarizeSmoothness(smooth);
    if (smoothness.verdict === 'warn') warnings.push(`smoothness: ${smoothness.reason} (qa.smoothness) — try the film AVD with -gpu host, see the device-capture notes (not shipped)`);
  }
  return { events, marks, steps, timings, warnings, busyDom, navs, trackers, calibration, stage, smoothness, video: rec, flowStart, flowEnd, clock0, flingGain: r3(gain), input: tr.inputStats(), pageErrors: tr.pageErrors || [] };
}

/** Convert a run's host-clock log into a kinetype.capture.v1 (C2 v2) document. */
export function buildDeviceCapture(flow, run, { transportInfo, idle = [], busy = [] }) {
  const v = run.video;
  const t0 = v.t0;
  const dur = +((v.t1 - t0)).toFixed(6);
  const tv = (T) => Math.min(dur, r3(Math.max(0, T - t0)));
  const events = [];
  for (const e of run.events) {
    const { T, T1, _track, ...rest } = e;
    const ev = { t: tv(T), ...rest };
    if (T1 !== undefined) ev.t1 = tv(T1);
    const x = e._track;
    if (x && x.entries.length) {
      ev.track = x.entries.map(({ T: tt, U, n, ...q }) => ({ t: tv(tt), ...q, ...(U !== undefined ? { seen: tv(U), probes: n } : {}) })).filter((q, i, a) => i === 0 || q.t > a[i - 1].t - 1e-9);
      ev.trackEnd = tv(Math.min(v.t1, x.end ?? x.until));
    }
    events.push(ev);
  }
  for (const n of run.navs) events.push({ t: tv(n.T), type: 'navigate', url: n.url });
  events.sort((a, b) => a.t - b.t);
  return {
    schema: 'kinetype.capture.v1',
    clock: 'wall',
    flow: flow.name,
    app: { name: flow.app.name, baseUrl: flow.app.baseUrl, ...(flow.app.native ? { native: true } : {}), ...(flow.app.commit ? { commit: flow.app.commit } : {}) },
    device: { kind: 'android', transport: transportInfo.kind, ...(transportInfo.serial ? { serial: transportInfo.serial } : {}), browser: flow.device.target.browser, screen: { width: v.width, height: v.height }, viewport: transportInfo.viewport, deviceScaleFactor: transportInfo.dpr },
    fps: v.fps,
    duration: dur,
    sessionOffset: r3(t0 - run.clock0),
    video: { src: 'capture.mp4', codec: 'h264', fps: v.fps, width: v.width, height: v.height },
    events,
    marks: run.marks.map((m) => ({ t: tv(m.T), id: m.id })),
    steps: run.steps.map((s) => ({ id: s.id, t0: tv(s.T0), t1: tv(s.T1) })),
    idle,
    busy,
  };
}

export { createTransport };
export const flowSha = (raw) => sha256(raw);
export { centerOf, stats };
