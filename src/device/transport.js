// Device transports: one interface, two implementations.
//
//   locate(target)          → {count, box (CSS px), vbox (VIDEO px), visible, mapping, …} via CDP + the in-page lib
//   tap(vpoint, {press})    → finger down/up at a video-px point, OS level
//   drag(points, {kind})    → multi-sample touch down/move…/up at the scheduled times (fling = release at speed)
//   typeText(keys, t0)      → characters at scheduled offsets;  key(name);  back();  hideKeyboard()
//   screencap()             → {rgb, width, height} in video px (calibration)
//   recordStart()/recordStop(dir) → CFR 60 fps mp4 at native resolution + where frame 0 sits on the host clock
//
// `adb`: Chrome (or the installed PWA) on a real Android emulator/phone. CDP over `adb forward
// localabstract:chrome_devtools_remote` for targets and page state; input through the scrcpy server's control
// socket (real MotionEvents: the OS does the fling physics, the keyboard is the real IME); recording from the same
// scrcpy session's video socket (device PTS → host clock, NTP-style). Text goes in through CDP Input.insertText
// (scrcpy text injection cannot type æøå; neither path animates IME key pops).
// `cdp-touch`: headless Chrome with phone emulation — the stand-in that lets the whole pipeline run and be tested
// on a host without an emulator: Input.dispatchTouchEvent (real touch-driven scrolling) + CDP screencast padded
// into a phone screen (status bar + nav bar), with an emulated momentum tail (headless Chrome never flings).
//
// Every time is host-monotonic seconds (performance.now()/1000): one clock for every device in a session.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { libCall } from './targets.js';
import { mappingFrom, mapBox, mapPoint, unmapPoint, findBlobs, fitMapping, mappingError, pairMarkersGeometric, fitPerAxis, leaveOneOut, calibrationSuspects } from './mapping.js';
import { decodeImage, writeAnnotated } from './media.js';
import { stats } from '../capture/timeline.js';

export const now = () => performance.now() / 1000;
/** Measured recorder latency to compensate (s): a frame stamped t shows the page as it was at t − lag. Measure it with
 * the calibration flow (receipt qa.clockLag.lagMs) and set KINETYPE_VIDEO_LAG_MS when |lag| > 2 frames. */
export const videoLag = () => (Number(process.env.KINETYPE_VIDEO_LAG_MS) || 0) / 1000;
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/** Sleep until host time t (s): coarse timer, then a short spin — sub-millisecond on an idle event loop. */
export async function sleepUntil(t) {
  for (;;) {
    const left = (t - now()) * 1000;
    if (left <= 0) return;
    if (left > 3) await sleepMs(left - 2);
    else await new Promise((r) => setImmediate(r));
  }
}

const KEY_NAMES = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, android: 66 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8, android: 67 },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9, android: 61 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27, android: 111 },
};

export class Transport {
  constructor({ log = () => {} } = {}) {
    this.log = log;
    this.cal = null;           // {left, top, innerHeight, standalone}: where the layout viewport sits on screen
    this.inputLog = [];        // {kind, planned, actual} for jitter budgets
  }

  async evaluate(expression) {
    const r = await this.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`page: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  }
  lib(method, ...args) { return this.evaluate(libCall(method, ...args)); }

  async metrics() { return this.lib('metrics'); }
  mappingOf(metrics) { return mappingFrom(metrics, this.cal); }

  async locate(target) {
    const r = await this.lib('locate', target);
    if (r.count !== 1) return r;
    const metrics = await this.metrics();
    const mapping = this.mappingOf(metrics);
    return { ...r, vbox: mapBox(mapping, r.box), mapping, metrics };
  }

  /** Page lifecycle + network observation (shared by both transports). */
  async attachPage() {
    await this.cdp.send('Page.enable');
    await this.cdp.send('Runtime.enable');
    await this.cdp.send('Network.enable');
    // in-flight requests of the CURRENT document; a request orphaned by a navigation (no loadingFailed ever comes)
    // or older than 15 s (a long poll) never holds a step open
    const reqs = new Map();
    this.cdp.on('Network.requestWillBeSent', (e) => { if (!['WebSocket', 'EventSource'].includes(e.type)) reqs.set(e.requestId, { t: now(), loader: e.loaderId, url: e.request.url, doc: e.type === 'Document' }); });
    // an app that never reads a response body gets no loadingFinished: headers + 0.5 s counts as done
    this.cdp.on('Network.responseReceived', (e) => { const r = reqs.get(e.requestId); if (r) r.resp = now(); });
    this.cdp.on('Network.loadingFinished', (e) => reqs.delete(e.requestId));
    this.cdp.on('Network.loadingFailed', (e) => reqs.delete(e.requestId));
    this.cdp.on('Network.requestServedFromCache', (e) => reqs.delete(e.requestId));
    this.cdp.on('Page.frameNavigated', (e) => { if (!e.frame.parentId) for (const [id, r] of reqs) if (r.loader !== e.frame.loaderId) reqs.delete(id); });
    this.inflight = { get size() { const t = now(); let n = 0; for (const r of reqs.values()) if (t - r.t < 15 && !(r.resp && t - r.resp > 0.5)) n++; return n; }, list: () => [...reqs.values()].map((r) => r.url) };
    this.pageErrors = [];
    this.cdp.on('Runtime.exceptionThrown', (e) => this.pageErrors.push(String(e.exceptionDetails?.exception?.description || e.exceptionDetails?.text).slice(0, 200)));
  }

  async navigate(url, { timeoutMs = 45000 } = {}) {
    const loaded = new Promise((resolve) => { const fn = () => { this.cdp.off?.('Page.loadEventFired', fn); resolve(); }; this.cdp.on('Page.loadEventFired', fn); });
    const r = await this.cdp.send('Page.navigate', { url });
    if (r.errorText) throw new Error(`navigate ${url}: ${r.errorText}`);
    // a goto is a fresh document: a same-document (hash-only) navigation would keep the SPA's in-memory state —
    // e.g. what the rehearsal left behind after the setup reset the server — so reload in that case
    if (!r.loaderId) await this.cdp.send('Page.reload', { ignoreCache: false });
    await Promise.race([loaded, sleepMs(timeoutMs).then(() => { throw new Error(`navigate ${url}: no load event after ${timeoutMs} ms`); })]);
    await this.lib('ready');
  }

  /**
   * One-frame calibration: four magenta markers at known CSS positions (the fixture's own, or a transient
   * overlay), a screencap, blob centroids, a least-squares {s, ox, oy}. Updates `cal` and returns the residuals
   * of BOTH the fit and the runtime model (the model is what every event uses).
   */
  async calibrate({ overlay = true, debugDir = null, always = false } = {}) {
    let expected;
    if (overlay) expected = await this.lib('overlay', true);
    else expected = await this.evaluate(`Object.fromEntries([...document.querySelectorAll('[data-cal]')].filter((e) => getComputedStyle(e).position === 'fixed').map((e) => { const r = e.getBoundingClientRect(); return [e.dataset.cal, { x: r.x, y: r.y, w: r.width, h: r.height }]; }))`);
    const dbg = { at: new Date().toISOString(), mode: overlay ? 'overlay' : 'fixture', expected };
    let img = null;
    try {
      await sleepMs(250);
      img = await this.screencap();
      const metrics = await this.metrics();
      dbg.dom = await this.lib('diag').catch((e) => ({ error: e.message }));
      dbg.transport = this.describe?.() ?? { kind: this.kind };
      dbg.screen = { width: img.width, height: img.height };
      const rough = this.cal ? this.mappingOf(metrics) : { s: metrics.dpr, ox: 0, oy: img.height - metrics.innerHeight * metrics.dpr };
      dbg.rough = rough;
      const blobs = findBlobs(img.rgb, img.width, img.height);
      dbg.blobs = blobs.slice(0, 24);
      // geometric pairing first (independent of the first guess); nearest-to-guess only for non-corner ids
      const gp = pairMarkersGeometric(expected, blobs, { dpr: metrics.dpr * (this.videoScale || 1), rough });
      const pairs = gp.pairs;
      dbg.pairing = { method: gp.method, sizeCandidates: gp.candidates, pairs };
      const fail = (msg) => { const e = new Error(msg); e.calibration = dbg; throw e; };
      if (pairs.length < 3) { dbg.suspects = calibrationSuspects({ metrics, expected, blobs, pairs, screen: dbg.screen }); fail(`calibration: found ${pairs.length} of ${Object.keys(expected).length} markers (blobs: ${blobs.length}, marker-sized: ${gp.candidates})`); }
      const fit = fitMapping(pairs);
      const perAxis = fitPerAxis(pairs);
      const loo = leaveOneOut(pairs);
      dbg.fit = fit; dbg.perAxis = perAxis; dbg.leaveOneOut = loo.runs;
      const vv = metrics.vv;
      const prevCal = this.cal;
      this.cal = { ...(this.cal || {}), left: fit.mapping.ox + fit.mapping.s * vv.offsetLeft, top: fit.mapping.oy + fit.mapping.s * vv.offsetTop, innerHeight: metrics.innerHeight, standalone: metrics.standalone || this.standaloneHint || false };
      const model = this.mappingOf(metrics);
      const err = mappingError(model, pairs);
      dbg.model = model; dbg.modelErr = err.maxErr; dbg.residuals = err.residuals; dbg.previousCal = prevCal; dbg.cal = this.cal;
      dbg.suspects = calibrationSuspects({ metrics: dbg.dom && !dbg.dom.error ? { ...metrics, ...dbg.dom, dpr: metrics.dpr } : metrics, expected, blobs, pairs, fit, perAxis, loo, model, modelErr: err.maxErr, screen: dbg.screen });
      const result = { fit: fit.mapping, fitErr: fit.maxErr, model, modelErr: err.maxErr, residuals: err.residuals, perAxis, scaleVsDpr: +(fit.mapping.s / metrics.dpr).toFixed(5), markers: pairs.length, pairing: gp.method, screen: dbg.screen, suspects: dbg.suspects };
      if (debugDir && (always || err.maxErr > 1)) result.debugDir = await writeCalibrationDebug(debugDir, dbg, img, { pass: err.maxErr <= 1, ...(err.maxErr > 1 ? { error: `mapping error ${err.maxErr} px > 1 px (fit ${fit.maxErr} px)` } : {}) });
      return result;
    } catch (e) {
      // ANY calibration failure leaves evidence behind (screencap, detected vs expected, model, DOM metrics)
      if (debugDir && img) { e.calibration ??= dbg; e.debugDir = await writeCalibrationDebug(debugDir, e.calibration, img, { pass: false, error: e.message }).catch(() => null); }
      throw e;
    } finally {
      if (overlay) await this.lib('overlay', false).catch(() => {});
    }
  }

  inputStats() {
    const lat = this.inputLog.map((e) => Math.round((e.actual - e.planned) * 1e4) / 10);
    return { samples: lat.length, lateMs: stats(lat) };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// cdp-touch — the headless stand-in
// ---------------------------------------------------------------------------------------------------------------
export const STAND_IN = { width: 1080, height: 2400, dpr: 2.5, statusBar: 60, navBar: 60 };

export class CdpTouchTransport extends Transport {
  constructor({ screen = STAND_IN, locale = 'nb-NO', timezone = 'Europe/Oslo', desktop = null, ...o } = {}) {
    super(o);
    this.kind = desktop ? 'cdp-desktop' : 'cdp-touch';
    this.screen = desktop ? { width: desktop.width * (desktop.dpr || 1), height: desktop.height * (desktop.dpr || 1), dpr: desktop.dpr || 1, statusBar: 0, navBar: 0 } : screen;
    this.desktop = desktop;
    this.locale = locale; this.timezone = timezone;
    this.standaloneHint = true;
    // test hook (env, stand-in only): paint a native-looking bubble into screencaps at "x,y,w,h" (video px)
    if (process.env.KINETYPE_TEST_FAKE_OVERLAY) { const [x, y, w, h] = process.env.KINETYPE_TEST_FAKE_OVERLAY.split(',').map(Number); this.fakeOverlay = { x, y, w, h }; }
  }
  get viewport() { const s = this.screen; return { width: Math.round(s.width / s.dpr), height: Math.round((s.height - s.statusBar - s.navBar) / s.dpr) }; }

  async open() {
    const { chromium } = await import('playwright-core');
    const { chromePath } = await import('../cli/browser.js');
    const exe = chromePath();
    if (!exe) throw new Error('no Chrome found; set KINETYPE_CHROME (and, on a bare Linux host, LD_LIBRARY_PATH and FONTCONFIG_FILE for the Chrome libraries and fonts)');
    this.browser = await chromium.launch({ executablePath: exe, headless: true, timeout: 60000, args: ['--no-sandbox', '--hide-scrollbars', `--force-device-scale-factor=${this.screen.dpr}`, '--force-color-profile=srgb', '--font-render-hinting=none', '--no-first-run', '--disable-extensions'] });
    const mobile = !this.desktop;
    this.ctx = await this.browser.newContext({ viewport: this.viewport, deviceScaleFactor: this.screen.dpr, isMobile: mobile, hasTouch: mobile, locale: this.locale, timezoneId: this.timezone, serviceWorkers: 'block' });
    this.page = await this.ctx.newPage();
    this.cdp = await this.ctx.newCDPSession(this.page);
    await this.attachPage();
    this.cal = { left: 0, top: this.screen.statusBar, innerHeight: this.viewport.height, standalone: true };
    return { kind: this.kind, screen: { width: this.screen.width, height: this.screen.height }, viewport: this.viewport, dpr: this.screen.dpr };
  }
  async close() { await this.browser?.close().catch(() => {}); }
  describe() { return { kind: this.kind, screen: this.screen, viewport: this.viewport }; }

  css(vp) { return unmapPoint(this.mappingOfCached || { s: this.screen.dpr, ox: 0, oy: this.screen.statusBar }, vp); }
  async refreshMapping() { this.mappingOfCached = this.mappingOf(await this.metrics()); return this.mappingOfCached; }

  // Dispatches are pipelined (not awaited one by one): CDP acks an input event only after the renderer handled it,
  // which on a loaded host would stretch a 0.12 s fling into seconds. Order is preserved by the protocol.
  pending = [];
  async flush() { const p = this.pending; this.pending = []; await Promise.all(p); }
  async touch(type, p, planned) {
    if (planned !== undefined) await sleepUntil(planned);
    const actual = now();
    if (this.desktop) {
      const map = { touchStart: 'mousePressed', touchMove: 'mouseMoved', touchEnd: 'mouseReleased' };
      this.pending.push(this.cdp.send('Input.dispatchMouseEvent', { type: map[type], x: p.x, y: p.y, button: 'left', buttons: type === 'touchEnd' ? 0 : 1, clickCount: 1 }));
    } else this.pending.push(this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: p.x, y: p.y, radiusX: 6, radiusY: 6, force: 1 }] }));
    if (planned !== undefined) this.inputLog.push({ kind: type, planned, actual });
    return actual;
  }

  async tap(vpoint, { press = 0.075, at = now() } = {}) {
    await this.refreshMapping();
    const p = this.css(vpoint);
    const down = await this.touch('touchStart', p, at);
    const up = await this.touch('touchEnd', p, at + press);
    await this.flush();
    return { down, up };
  }

  /** points: [{x,y,t}] video px, t relative to `at`. Fling → emulated momentum from the release velocity. */
  async drag(points, { kind = 'swipe', at = now(), tau = 0.33 } = {}) {
    const m = await this.refreshMapping();
    const css = points.map((p) => ({ ...this.css(p), t: p.t }));
    const down = await this.touch('touchStart', css[0], at + css[0].t);
    for (const p of css.slice(1)) await this.touch('touchMove', p, at + p.t);
    const up = await this.touch('touchEnd', css[css.length - 1], at + css[css.length - 1].t);
    await this.flush();
    let momentum = null;
    if (kind === 'fling' && css.length >= 3) {
      const a = css[css.length - 3], b = css[css.length - 1];
      const vy = (b.y - a.y) / Math.max(1e-3, b.t - a.t);   // finger velocity, CSS px/s
      momentum = { v: -vy, tau };
      if (!this.desktop) await this.lib('fling', { x: b.x, y: b.y }, -vy, tau);
    }
    return { down, up, momentum, mapping: m };
  }

  async typeText(keys, at = now()) {
    const out = [];
    for (const k of keys) {
      await sleepUntil(at + k.at);
      const actual = now();
      this.pending.push(this.cdp.send('Input.insertText', { text: k.ch }));
      this.inputLog.push({ kind: 'key', planned: at + k.at, actual });
      out.push(actual);
    }
    await this.flush();
    return out;
  }
  async key(name) {
    const k = KEY_NAMES[name] || { key: name, code: name, keyCode: 0 };
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k.key, code: k.code, windowsVirtualKeyCode: k.keyCode, ...(name === 'Enter' ? { text: '\r' } : {}) });
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k.key, code: k.code, windowsVirtualKeyCode: k.keyCode });
  }
  async back() { await this.evaluate('history.back()'); }
  async hideKeyboard() { await this.evaluate('document.activeElement && document.activeElement.blur()'); }

  /** Stand-in only: the damage-driven screencast may never send the frame of a scroll's last sub-pixel steps; an
   * invisible 1 px colour toggle damages the viewport so the recording always holds the SETTLED state. */
  async freshFrame() {
    if (!this.onFrame) return;
    await this.evaluate(`(() => { let d = document.getElementById('__kt_kick'); if (!d) { d = document.createElement('div'); d.id = '__kt_kick'; d.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;pointer-events:none;z-index:2147483647'; document.documentElement.appendChild(d); } d.style.background = d.style.background === 'rgba(0, 0, 0, 0.004)' ? 'rgba(0, 0, 0, 0.003)' : 'rgba(0, 0, 0, 0.004)'; })()`).catch(() => {});
  }

  /** The phone screen as the video shows it: viewport screenshot inside status/nav bars. */
  async screencap() {
    const r = await this.cdp.send('Page.captureScreenshot', { format: 'png' });
    const img = padInto(await decodeImage(Buffer.from(r.data, 'base64')), this.screen, this.desktop ? 0 : this.screen.statusBar);
    // test hook: a native overlay the page cannot see (what a translate bubble is on a phone)
    if (this.fakeOverlay) {
      const o = this.fakeOverlay;
      for (let y = o.y; y < o.y + o.h; y++) for (let x = o.x; x < o.x + o.w; x++) {
        const text = (y - o.y) % 60 > 30 && (y - o.y) % 60 < 48 && (x - o.x) % 40 < 28 && x > o.x + 80 && x < o.x + o.w * 0.7;
        const p = (y * img.width + x) * 3; const c = text ? 40 : 244; img.rgb[p] = c; img.rgb[p + 1] = c; img.rgb[p + 2] = text ? 50 : 250;
      }
    }
    return img;
  }

  async recordStart(dir) {
    this.recDir = dir;
    fs.mkdirSync(path.join(dir, 'screencast'), { recursive: true });
    this.shots = [];
    this.epochOffset = Date.now() / 1000 - now();
    const w = this.desktop ? this.screen.width : this.screen.width;
    const h = this.desktop ? this.screen.height : this.screen.height - this.screen.statusBar - this.screen.navBar;
    this.onFrame = async (f) => {
      const t = f.metadata.timestamp ? f.metadata.timestamp - this.epochOffset : now();
      const file = path.join(dir, 'screencast', `s${String(this.shots.length).padStart(6, '0')}.jpg`);
      this.shots.push({ t, file, recvT: now(), sy: f.metadata.scrollOffsetY });
      fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
      this.cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    };
    this.cdp.on('Page.screencastFrame', this.onFrame);
    this.recT0 = now();
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: w, maxHeight: h, everyNthFrame: 1 });
    // the first frame arrives on the next damage; nudge one so frame 0 exists
    for (let i = 0; i < 100 && !this.shots.length; i++) await sleepMs(20);
    return { t0: this.shots[0]?.t ?? this.recT0 };
  }

  async recordAbort() {
    await this.cdp.send('Page.stopScreencast').catch(() => {});
    this.cdp.off?.('Page.screencastFrame', this.onFrame);
    this.onFrame = null;
    fs.rmSync(path.join(this.recDir, 'screencast'), { recursive: true, force: true });
  }

  async recordStop({ out, fps = 60, crf = 14, scrollLog = [] } = {}) {
    const stopT = now();
    await this.cdp.send('Page.stopScreencast').catch(() => {});
    this.cdp.off?.('Page.screencastFrame', this.onFrame);
    this.onFrame = null;
    const shots = this.shots.filter((s, i, a) => i === 0 || s.t > a[i - 1].t);
    if (!shots.length) throw new Error('screencast delivered no frames');
    const t0 = shots[0].t;
    const list = path.join(this.recDir, 'screencast', 'list.ffconcat');
    let txt = 'ffconcat version 1.0\n';
    for (const [i, s] of shots.entries()) {
      const next = i + 1 < shots.length ? shots[i + 1].t : stopT;
      txt += `file '${s.file}'\nduration ${Math.max(0.001, next - s.t).toFixed(6)}\n`;
    }
    txt += `file '${shots[shots.length - 1].file}'\n`;
    fs.writeFileSync(list, txt);
    const S = this.screen;
    const pad = this.desktop ? `scale=${S.width}:${S.height}` : `scale=${S.width}:${S.height - S.statusBar - S.navBar},pad=${S.width}:${S.height}:0:${S.statusBar}:color=0x0f1115`;
    await ffmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-vf', `${pad},fps=${fps}:round=down,format=yuv420p`, '-fps_mode', 'cfr', '-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', out]);
    const span = shots[shots.length - 1].t - t0;
    // a damage-driven screencast sends NO frames while nothing changes (correct: those frames are identical), so
    // frames/span understates it; the rate that matters is during motion (gaps < 0.2 s)
    const gaps = shots.slice(1).map((s, i) => s.t - shots[i].t);
    const moving = gaps.filter((g) => g < 0.2);
    const source = {
      frames: shots.length, fps: span > 0 ? +((shots.length - 1) / span).toFixed(1) : 0,
      motionFps: moving.length ? +(moving.length / moving.reduce((a, b) => a + b, 0)).toFixed(1) : 0,
      motionGapP95Ms: moving.length ? Math.round([...moving].sort((a, b) => a - b)[Math.min(moving.length - 1, Math.floor(moving.length * 0.95))] * 1000) : null,
      maxGapMs: Math.round(Math.max(0, ...gaps) * 1000),
      note: 'stand-in: damage-driven CDP screencast, rate limited by host load; not a device number (fps = frames/span incl. static stretches, motionFps = during motion)',
    };
    fs.rmSync(path.join(this.recDir, 'screencast'), { recursive: true, force: true });
    // self-calibration (stand-in only): each screencast frame reports the page's scroll offset; the observer logged
    // the scroll offset at page-accurate times → when the page really showed that frame → the recorder's stamping lag
    const self = screencastLag(shots, scrollLog);
    const lag = process.env.KINETYPE_VIDEO_LAG_MS !== undefined ? videoLag() : (self.lag ?? 0);
    return { file: out, t0: t0 - lag, t1: stopT - lag, lagCompensationMs: Math.round(lag * 1000), selfCalibration: self, fps, width: S.width, height: S.height, source, method: 'CDP Page.startScreencast (damage-driven JPEG frames, host timestamps) → constant 60 fps, padded into the stand-in phone screen' };
  }
}

/** Low quantile of (frame stamp − time the page had that scroll offset) over frames shot while scrolling. Pure. */
export function screencastLag(shots, log) {
  const lags = [];
  for (const sh of shots) {
    if (sh.sy === undefined) continue;
    for (let i = 1; i < log.length; i++) {
      const a = log[i - 1], b = log[i];
      if (b.T - a.T > 0.05 || a.y === b.y) continue; // consecutive animation frames only (frame-accurate)
      const lo = Math.min(a.y, b.y), hi = Math.max(a.y, b.y);
      if (sh.sy <= lo || sh.sy >= hi) continue;
      const T = a.T + (b.T - a.T) * ((sh.sy - a.y) / (b.y - a.y));
      if (Math.abs(sh.t - T) < 1) { lags.push(sh.t - T); break; }
    }
  }
  if (lags.length < 30) return { lag: null, n: lags.length, reason: 'fewer than 30 frames shot while scrolling: not compensated' };
  lags.sort((x, y) => x - y);
  const q = (p) => lags[Math.min(lags.length - 1, Math.floor(lags.length * p))];
  // frames delivered late (screencast backlog under load) only ADD lag: the low quantile is the stamping offset
  const lag = q(0.25);
  if (lag < -0.05 || lag > 0.2) return { lag: null, n: lags.length, rawMs: Math.round(lag * 1000), reason: 'implausible recorder lag (outside −50…200 ms): not compensated' };
  return { lag: +lag.toFixed(4), n: lags.length, medianMs: Math.round(q(0.5) * 1000), p75Ms: Math.round(q(0.75) * 1000) };
}

/** calib-debug/: screencap.png (as the phone shows it), annotated.png (yellow = every magenta blob found, red = where
 * the runtime model puts each marker, green = where the least-squares fit puts it), calibration-debug.json. */
export async function writeCalibrationDebug(dir, dbg, img, { pass, error } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const boxes = [];
  for (const b of dbg.blobs || []) boxes.push({ ...b, color: 'yellow' });
  const place = (m, color) => { if (!m) return; for (const e of Object.values(dbg.expected || {})) boxes.push({ x: m.ox + m.s * e.x, y: m.oy + m.s * e.y, w: m.s * e.w, h: m.s * e.h, color }); };
  place(dbg.model, 'red'); place(dbg.fit?.mapping, 'green');
  await writeAnnotated(img, path.join(dir, 'screencap.png'), path.join(dir, 'annotated.png'), boxes);
  fs.writeFileSync(path.join(dir, 'calibration-debug.json'), JSON.stringify({ pass: !!pass, error: error || null, legend: 'annotated.png: yellow = detected magenta blobs, red = runtime model, green = least-squares fit', ...dbg }, null, 2) + '\n');
  return dir;
}

function padInto(img, screen, top) {
  if (img.width === screen.width && img.height === screen.height) return img;
  const rgb = Buffer.alloc(screen.width * screen.height * 3, 0x10);
  for (let y = 0; y < img.height && y + top < screen.height; y++) img.rgb.copy(rgb, ((y + top) * screen.width) * 3, y * img.width * 3, (y + 1) * img.width * 3);
  return { rgb, width: screen.width, height: screen.height };
}

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('nice', ['-n', '10', 'ffmpeg', '-v', 'error', '-threads', '4', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = ''; p.stderr.on('data', (d) => { err += d; });
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg: ${err.trim()}`))));
  });
}

// ---------------------------------------------------------------------------------------------------------------
// adb — Chrome / PWA on a real Android emulator or phone (scrcpy control + video, CDP for page state)
// ---------------------------------------------------------------------------------------------------------------
export class AdbTransport extends Transport {
  constructor({ serial, browser = 'chrome', baseUrl, scrcpyVersion = process.env.KINETYPE_SCRCPY_VERSION || '5.0', scrcpyJar = process.env.KINETYPE_SCRCPY_SERVER, textInput = 'cdp', bitRate = Number(process.env.KINETYPE_SCRCPY_BITRATE) || 16000000, maxSize = Number(process.env.KINETYPE_SCRCPY_MAX_SIZE) || 0, ...o } = {}) {
    super(o);
    this.kind = 'adb';
    this.serial = serial; this.browser = browser; this.baseUrl = baseUrl;
    this.scrcpyVersion = scrcpyVersion; this.scrcpyJar = scrcpyJar; this.textInput = textInput; this.bitRate = bitRate; this.maxSize = maxSize;
    this.standaloneHint = browser === 'pwa';
  }

  async open() {
    const adb = await import('./adb.js');
    const sc = await import('./scrcpy.js');
    const { connectCdp } = await import('./cdp.js');
    this.adb = adb; this.sc = sc;
    const devs = await adb.devices();
    if (!this.serial) this.serial = devs.find((d) => d.state === 'device')?.serial;
    if (!devs.some((d) => d.serial === this.serial && d.state === 'device')) throw new Error(`adb: device ${this.serial || '(none)'} not attached (have: ${devs.map((d) => `${d.serial}:${d.state}`).join(', ') || 'none'})`);
    // sys.boot_completed comes before the services (`cmd: Can't find service: window` on a cold -gpu host boot)
    this.ready = await adb.waitForDeviceReady(this.serial, { log: this.log });
    this.size = await adb.wmSize(this.serial);
    this.density = await adb.wmDensity(this.serial);
    this.connectCdp = connectCdp;
    // ---- scrcpy: one server session = control + the recording stream ----
    const jarRemote = '/data/local/tmp/scrcpy-server.jar';
    if (this.scrcpyJar) await adb.push(this.serial, this.scrcpyJar, jarRemote);
    this.scid = sc.randomScid();
    this.scPort = await adb.freePort();
    await adb.forward(this.serial, `tcp:${this.scPort}`, `localabstract:${sc.socketName(this.scid)}`);
    this.server = adb.spawnShell(this.serial, sc.serverCommand({ jarPath: jarRemote, version: this.scrcpyVersion, scid: this.scid, maxFps: 60, videoBitRate: this.bitRate, maxSize: this.maxSize }));
    this.serverLog = '';
    this.server.stdout?.on('data', (d) => { this.serverLog += d; });
    this.server.stderr?.on('data', (d) => { this.serverLog += d; });
    this.session = await sc.connectSession({ port: this.scPort });
    // the stream runs from open(); a recording starts at the last key frame before recordStart (so it decodes)
    // and never carries the rehearsal: the latest config + the current GOP are kept in memory
    this.recDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-adb-'));
    this.gop = []; this.lastConfig = null; this.recording = null;
    this.session.parser.on('packet', (p) => {
      if (p.config) this.lastConfig = p; else if (p.key) this.gop = [p]; else this.gop.push(p);
      this.recording?.add(p);
    });
    const meta = await Promise.race([this.session.parser.whenMeta(), sleepMs(15000).then(() => { throw new Error(`scrcpy: no video meta after 15 s. Server log:\n${this.serverLog.slice(-2000)}`); })]);
    // the VIDEO frame size is the coordinate space of everything (touches, vbox, calibration): the server ignores
    // touches whose size differs from it. Trust the stream's size only if it has the device's aspect; else compute it
    // the way the server scales (long side ≤ max_size, multiples of 8 — the phone node's measured 5.0 behaviour)
    const dev = { width: this.size.width, height: this.size.height };
    const aspectOk = meta.width > 0 && meta.height > 0 && meta.width <= 16384 && Math.abs(meta.width / meta.height - dev.width / dev.height) < 0.02;
    let vw = dev.width, vh = dev.height;
    if (this.maxSize && Math.max(vw, vh) > this.maxSize) { const k = this.maxSize / Math.max(vw, vh); vw = Math.floor(vw * k); vh = Math.floor(vh * k); }
    this.screen = aspectOk ? { width: meta.width, height: meta.height } : { width: vw & ~7, height: vh & ~7 };
    this.sizeSource = aspectOk ? `stream (${meta.layout})` : `computed from wm size (stream said ${meta.width}x${meta.height})`;
    this.videoScale = this.screen.width / dev.width;
    this.session.control.screen = { ...this.screen };
    this.session.videoSocket?.on('close', () => { this.streamClosed = now(); });
    this.session.parser.on('resize', (m) => { this.log(`scrcpy: video resized to ${m.width}x${m.height} (rotation?) — mapping is no longer valid`); this.resized = m; });
    // ---- CDP: the page on the phone (a native-only flow may have none; a hybrid flow attaches when it appears) ----
    // lazy: Chrome may not be running yet (a flow that starts in another app); the first page call attaches
    const page = await this.attachCdp().catch(() => null);
    return { kind: 'adb', serial: this.serial, screen: this.screen, sizeSource: this.sizeSource, wmSize: this.size, density: this.density, page, scrcpy: this.scrcpyVersion, codec: meta.codec, dpr: this.dpr ?? null };
  }

  /** Attach CDP to the app's page (by baseUrl origin, else the first page); first mapping guess until calibrate. */
  async attachCdp() {
    try { this.cdp?.close(); } catch {}
    this.cdp = null;
    if (!this.devtools) this.devtools = await this.adb.openDevtools(this.serial).catch((e) => { throw new Error(`adb: Chrome's DevTools socket is not available on ${this.serial} (${e.message}). Open ${this.browser === 'pwa' ? 'the installed app' : 'Chrome'} first (see the device-capture notes (not shipped))`); });
    const targets = await this.adb.devtoolsTargets(this.devtools.port);
    const origin = this.baseUrl ? new URL(this.baseUrl).origin : null;
    const pages = targets.filter((t) => t.type === 'page');
    // the tab ON SCREEN: prefer the app's origin, and among several candidates the visible one (never a background tab)
    let cands = pages.filter((t) => origin && t.url.startsWith(origin));
    if (!cands.length) cands = pages;
    if (!cands.length) throw new Error(`adb: no Chrome page on ${this.serial}. Open ${this.browser === 'pwa' ? 'the installed app' : 'Chrome'} on ${this.baseUrl || 'the app'} first (see the device-capture notes (not shipped))`);
    let tgt = null;
    for (const c of cands) {
      const cdp = await this.connectCdp(`ws://127.0.0.1:${this.devtools.port}/devtools/page/${c.id}`);
      const vis = cands.length === 1 ? 'visible' : await Promise.race([cdp.send('Runtime.evaluate', { expression: 'document.visibilityState', returnByValue: true }).then((x) => x.result.value).catch(() => 'unknown'), new Promise((r) => setTimeout(() => r('frozen'), 1500))]); // a background tab on Android is frozen and never answers
      if (vis === 'visible') { this.cdp = cdp; tgt = c; break; }
      cdp.close();
    }
    if (!tgt) throw new Error(`adb: none of ${cands.length} Chrome page(s) on ${this.serial} is visible — bring the app to the front`);
    this.pageTargetId = tgt.id;
    await this.attachPage();
    if (!this.cal) {
      const m = await this.metrics();
      this.dpr = m.dpr;
      // viewport bottom-aligned above a gesture-nav bar of 48 dp, in video px
      const nav = Math.round(48 * (this.density / 160));
      this.cal = { left: 0, top: (this.size.height - nav - m.innerHeight * m.dpr) * this.videoScale, innerHeight: m.innerHeight, standalone: this.browser === 'pwa' || m.standalone };
    }
    const u = new URL(tgt.url);
    this.pageUrl = u.origin + u.pathname; // never the query/hash (may carry tokens) — this goes into the receipt
    return this.pageUrl;
  }

  /** Page calls attach on demand (a hybrid flow reaches Chrome mid-way) and re-attach once if the socket died. */
  async evaluate(expression) {
    if (!this.cdp) await this.attachCdp();
    try { return await super.evaluate(expression); } catch (e) {
      if (!/socket closed|CDP socket/.test(e.message)) throw e;
      await this.attachCdp();
      return super.evaluate(expression);
    }
  }

  /** Smoothness (rehearse): clear SurfaceFlinger's latency ring for Chrome's layer and reset gfxinfo before a gesture… */
  async frameStatsBegin() {
    const { chromeLayerCandidates } = await import('./smooth.js');
    if (this.sfLayers === undefined) {
      const list = await this.adb.shell(this.serial, ['dumpsys', 'SurfaceFlinger', '--list'], { timeoutMs: 15000 }).then((r) => r.stdout).catch(() => '');
      this.sfLayers = chromeLayerCandidates(list, this.browser === 'pwa' ? 'org.chromium.webapk' : 'com.android.chrome').slice(0, 4);
      this.sfLayer = this.sfLayers[0] || null;
    }
    await this.adb.shell(this.serial, ['dumpsys', 'SurfaceFlinger', '--latency-clear'], { timeoutMs: 15000 }).catch(() => {});
    // Android 12+: TimeStats is the per-layer source when --latency returns only its header
    await this.adb.shell(this.serial, ['dumpsys', 'SurfaceFlinger', '--timestats', '-enable', '-clear'], { timeoutMs: 15000 }).catch(() => {});
    await this.adb.shell(this.serial, ['dumpsys', 'gfxinfo', 'com.android.chrome', 'reset'], { timeoutMs: 15000 }).catch(() => {});
  }
  /** …and read both after it settled: per-frame present times (SurfaceFlinger) + HWUI's jank counters (gfxinfo). */
  async frameStatsEnd() {
    const { parseSfLatency, parseGfxinfo, parseTimeStats } = await import('./smooth.js');
    // the layer that received buffers: the known-good one first, then the other candidates (naming differs by release)
    let sf = { error: 'no Chrome layer found in SurfaceFlinger --list' };
    for (const layer of [this.sfLayer, ...(this.sfLayers || []).filter((l) => l !== this.sfLayer)].filter(Boolean)) {
      sf = await this.adb.shell(this.serial, ['dumpsys', 'SurfaceFlinger', '--latency', layer], { timeoutMs: 15000 }).then((r) => parseSfLatency(r.stdout)).catch((e) => ({ error: e.message }));
      if (sf.fps) { this.sfLayer = layer; sf.source = 'latency'; break; }
    }
    let latencyNote = null;
    if (!sf.fps) {
      latencyNote = `--latency: ${sf.error || 'no frames (header only)'}`;
      const ts = await this.adb.shell(this.serial, ['dumpsys', 'SurfaceFlinger', '--timestats', '-dump', '-maxlayers', '50'], { timeoutMs: 15000 }).then((r) => parseTimeStats(r.stdout, this.browser === 'pwa' ? 'org.chromium.webapk' : 'com.android.chrome', this.sfLayer)).catch((e) => ({ error: e.message }));
      if (ts.fps) sf = { ...ts, refreshMs: null };
      else sf = { error: `${latencyNote}; timestats: ${ts.error || 'no frames'}` };
    }
    const gfx = await this.adb.shell(this.serial, ['dumpsys', 'gfxinfo', 'com.android.chrome'], { timeoutMs: 15000 }).then((r) => parseGfxinfo(r.stdout)).catch((e) => ({ error: e.message }));
    return { layer: sf.layer || this.sfLayer || null, ...(sf.fps ? { fps: sf.fps, jankyPct: sf.jankyPct, p95Ms: sf.p95Ms, maxMs: sf.maxMs ?? null, frames: sf.frames, refreshMs: sf.refreshMs ?? null, sfSource: sf.source, ...(latencyNote ? { latencyNote } : {}) } : { sfError: sf.error || 'no frames' }), gfxinfo: gfx };
  }

  /** Native UI target: uiautomator dump → package/text/resourceId/desc match → bounds in VIDEO px. */
  async locateOs(t) {
    const { parseUiDump, matchOs } = await import('./uia.js');
    const r = await this.adb.adb(['exec-out', 'uiautomator', 'dump', '/dev/tty'], { serial: this.serial, timeoutMs: 20000 });
    const xml = r.stdout.slice(0, r.stdout.lastIndexOf('</hierarchy>') + 12);
    const found = matchOs(parseUiDump(xml), t, this.size);
    if (found.length !== 1) return { count: found.length, os: true };
    const n = found[0], k = this.videoScale || 1, b = n.bounds;
    const vbox = { x: Math.round(b.x * k * 100) / 100, y: Math.round(b.y * k * 100) / 100, w: Math.round(b.w * k * 100) / 100, h: Math.round(b.h * k * 100) / 100 };
    return { count: 1, os: true, vbox, visible: n.onScreen, editable: n.editable, focused: n.focused, node: { package: n.package, ...(n.text ? { text: n.text } : {}), ...(n.resourceId ? { resourceId: n.resourceId } : {}), ...(n.desc ? { desc: n.desc } : {}) } };
  }

  /** Typing into a NATIVE field: ASCII as key events (scrcpy text), anything else (æøå) via clipboard paste. */
  async typeNative(keys, at = now()) {
    const out = [];
    for (const k of keys) {
      await sleepUntil(at + k.at);
      const actual = now();
      if (this.sc.asciiInjectable(k.ch)) this.session.control.text(k.ch); else this.session.control.paste(k.ch);
      this.inputLog.push({ kind: 'key', planned: at + k.at, actual });
      out.push(actual);
    }
    return out;
  }

  describe() {
    return { kind: 'adb', serial: this.serial, browser: this.browser, page: this.pageUrl || null, screen: this.screen, wmSize: this.size, density: this.density, videoScale: this.videoScale, sizeSource: this.sizeSource, scrcpy: this.scrcpyVersion };
  }

  async close() {
    try { this.cdp?.close(); } catch {}
    try { this.session?.close(); } catch {}
    if (this.server && this.server.exitCode === null) this.server.kill('SIGTERM');
    if (this.scPort) await this.adb.removeForward(this.serial, `tcp:${this.scPort}`).catch(() => {});
    await this.devtools?.close();
    if (this.recDir && !this.keepRaw) fs.rmSync(this.recDir, { recursive: true, force: true });
  }

  async inject(action, p, planned) {
    if (planned !== undefined) await sleepUntil(planned);
    const actual = now();
    this.session.control.touch(action, Math.round(p.x), Math.round(p.y));
    if (planned !== undefined) this.inputLog.push({ kind: action, planned, actual });
    return actual;
  }
  async tap(vpoint, { press = 0.075, at = now() } = {}) {
    const { MOTION } = this.sc;
    const down = await this.inject(MOTION.DOWN, vpoint, at);
    const up = await this.inject(MOTION.UP, vpoint, at + press);
    return { down, up };
  }
  async drag(points, { at = now() } = {}) {
    const { MOTION } = this.sc;
    const down = await this.inject(MOTION.DOWN, points[0], at + points[0].t);
    for (const p of points.slice(1, -1)) await this.inject(MOTION.MOVE, p, at + p.t);
    const last = points[points.length - 1];
    await this.inject(MOTION.MOVE, last, at + last.t);
    const up = await this.inject(MOTION.UP, last, at + last.t + 0.001);
    return { down, up, momentum: null };
  }
  async typeText(keys, at = now()) {
    const out = [];
    for (const k of keys) {
      await sleepUntil(at + k.at);
      const actual = now();
      if (this.textInput === 'scrcpy' && this.sc.asciiInjectable(k.ch)) this.session.control.text(k.ch);
      else await this.cdp.send('Input.insertText', { text: k.ch });
      this.inputLog.push({ kind: 'key', planned: at + k.at, actual });
      out.push(actual);
    }
    return out;
  }
  async key(name) {
    const { KEY } = this.sc;
    const code = KEY_NAMES[name]?.android;
    if (!code) throw new Error(`key ${name}: no Android keycode mapped`);
    this.session.control.key(KEY.DOWN, code);
    await sleepMs(40);
    this.session.control.key(KEY.UP, code);
  }
  async back() { await this.key('Back').catch(async () => { const { KEY, KEYCODE } = this.sc; this.session.control.key(KEY.DOWN, KEYCODE.BACK); await sleepMs(40); this.session.control.key(KEY.UP, KEYCODE.BACK); }); }
  async hideKeyboard() { await this.back(); }

  /** Native screencap, resampled into VIDEO px when the stream is downscaled (one coordinate space). */
  async screencap() { return decodeImage(await this.adb.screencap(this.serial), this.videoScale !== 1 ? this.screen : null); }
  mappingOf(metrics) {
    // dpr maps CSS → device px; the video may be downscaled: fold the factor into the model's scale
    return super.mappingOf(this.videoScale && this.videoScale !== 1 ? { ...metrics, dpr: metrics.dpr * this.videoScale } : metrics);
  }

  async recordStart() {
    this.recT0 = now();
    this.recording = new this.sc.Recording({ rawFile: path.join(this.recDir, `stream-${Date.now()}.h264`) });
    if (this.lastConfig) this.recording.add(this.lastConfig);
    for (const p of this.gop) this.recording.add(p);
    return { t0: this.recT0 };
  }
  async recordAbort() { const r = this.recording; this.recording = null; if (r) await r.finish().catch(() => {}); }

  async recordStop({ out, fps = 60, crf = 14 } = {}) {
    const stopT = now();
    await sleepMs(300); // let the last frames arrive
    // detach before finishing: a packet arriving during finish() must not write after end()
    const recording = this.recording; this.recording = null;
    const rec = await recording.finish();
    if (this.streamClosed && this.streamClosed < stopT) throw new Error(`scrcpy video stream closed ${(stopT - this.streamClosed).toFixed(1)} s before the end of the take (server died?) — the recording would be frozen; not writing it. Server log:\n${this.serverLog.slice(-1500)}`);
    const { offset, jitter } = this.sc.estimateClockOffset(rec.frames);
    const startUs = Math.round((this.recT0 - offset) * 1e6), endUs = Math.round((stopT - offset) * 1e6);
    const r = await this.sc.rawToCfr({ rawFile: rec.rawFile, ptsUs: rec.frames.map((f) => f.ptsUs), fps, out, crf, startUs, endUs, width: this.screen.width, height: this.screen.height });
    const inWin = rec.frames.filter((f) => f.ptsUs >= startUs && f.ptsUs <= endUs);
    const preRoll = rec.frames.filter((f) => f.ptsUs < startUs).length;
    const span = inWin.length > 1 ? (inWin[inWin.length - 1].ptsUs - inWin[0].ptsUs) / 1e6 : 0;
    const lag = videoLag();
    return { file: out, t0: this.recT0 - lag, t1: stopT - lag, lagCompensationMs: Math.round(lag * 1000), fps, width: r.width, height: r.height, clockOffset: { offset, jitterMs: Math.round(jitter * 1000) }, source: { frames: inWin.length, fps: span ? +((inWin.length - 1) / span).toFixed(1) : 0, duplicated: r.duplicated, dropped: Math.max(0, r.dropped - preRoll), preRoll }, method: `scrcpy ${this.scrcpyVersion} server video socket (device PTS → host clock, min-delay offset) → constant ${fps} fps` };
  }
}
KEY_NAMES.Back = { key: 'GoBack', code: 'BrowserBack', keyCode: 166, android: 4 };

export async function createTransport(kind, opts) {
  if (kind === 'cdp-touch') return new CdpTouchTransport(opts);
  if (kind === 'cdp-desktop') return new CdpTouchTransport({ ...opts, desktop: opts.desktop || { width: 1440, height: 900, dpr: 1 } });
  if (kind === 'adb') return new AdbTransport(opts);
  throw new Error(`unknown transport "${kind}" (adb | cdp-touch | cdp-desktop)`);
}

export { mapPoint, mapBox };
