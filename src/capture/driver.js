// `kinetype capture`: run a flow against a live app and record it frame-exactly (see clock.js).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { chromePath } from '../cli/browser.js';
import { resolveFlow, assertSameOrigin, sha256 } from './flow.js';
import { FrameClock } from './clock.js';
import { Recorder, buildCapture, boxOf, centerOf } from './events.js';
import { typingSchedule, scrollSteps, pointerPath, travelSeconds, rng, frameOf, stats } from './timeline.js';
import { jpegSize } from './jpeg.js';

const LAUNCH_ARGS = [
  '--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars', '--font-render-hinting=none',
  '--enable-begin-frame-control', '--run-all-compositor-stages-before-draw', '--disable-new-content-rendering-timeout',
  '--disable-threaded-animation', '--disable-threaded-scrolling', '--disable-checker-imaging', '--disable-image-animation-resync',
  '--disable-features=MacAppCodeSignClone', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
];

/** fontconfig that adds `dirs` on top of whatever FONTCONFIG_FILE the environment already uses. */
export function fontEnv(dirs, tmp) {
  if (!dirs.length) return {};
  const conf = path.join(tmp, 'fonts.conf');
  const base = process.env.FONTCONFIG_FILE && fs.existsSync(process.env.FONTCONFIG_FILE) ? `<include ignore_missing="yes">${process.env.FONTCONFIG_FILE}</include>` : '';
  fs.writeFileSync(conf, `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">\n<fontconfig>${base}${dirs.map((d) => `<dir>${path.resolve(d)}</dir>`).join('')}<cachedir>${path.join(tmp, 'fc-cache')}</cachedir></fontconfig>\n`);
  return { FONTCONFIG_FILE: conf };
}

/** Runs in the page: scroll the nearest scrollable ancestor of the point (else the document) by d css px. */
export function scrollScrollerBy({ at, d }) {
  let el = document.elementFromPoint(Math.min(Math.max(at.x, 0), innerWidth - 1), Math.min(Math.max(at.y, 0), innerHeight - 1));
  while (el && el !== document.documentElement && el !== document.body) {
    const cs = getComputedStyle(el);
    if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) { el.scrollTo({ top: el.scrollTop + d, behavior: 'instant' }); return; }
    el = el.parentElement;
  }
  window.scrollTo({ top: document.scrollingElement.scrollTop + d, behavior: 'instant' });
}

/**
 * Runs in the page on every captured frame for each tracked target: its box (CSS px of the
 * viewport) and whether it is REALLY visible — connected, rendered, fully inside the viewport,
 * and the topmost element at 9 interior points (3×3 at 20/50/80 %; so a modal, backdrop, sheet, toast or a
 * scroll container's clip over any part of it means "not visible"). Fail-closed.
 */
export function probeTarget(el) {
  if (!el || !el.isConnected) return { gone: true };
  const r = el.getBoundingClientRect();
  const box = { x: r.x, y: r.y, w: r.width, h: r.height };
  if (r.width < 2 || r.height < 2) return { box, visible: false };
  if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) return { box, visible: false };
  if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return { box, visible: false };
  const root = el.getRootNode();
  const hitAt = (x, y) => (root.elementFromPoint ? root : document).elementFromPoint(x, y);
  const owns = (n) => { for (; n; n = n.parentNode || n.host) if (n === el) return true; return false; };
  // 3×3 points at 20/50/80 % of the box: inside any shape with border-radius ≤ 50 % (a circle's
  // corner-ward point at 20 % is 0.42 r from its centre), so rounded controls are not misread as covered
  for (const fx of [0.2, 0.5, 0.8]) {
    for (const fy of [0.2, 0.5, 0.8]) if (!owns(hitAt(r.left + fx * r.width, r.top + fy * r.height))) return { box, visible: false };
  }
  return { box, visible: true };
}

function locate(page, t) {
  let loc;
  if (t.selector) loc = page.locator(t.selector);
  else if (t.role) loc = page.getByRole(t.role, { ...(t.name !== undefined ? { name: t.name } : {}), exact: t.exact ?? false });
  else loc = page.getByText(t.text, { exact: t.exact ?? false });
  return t.nth !== undefined ? loc.nth(t.nth) : loc;
}
const describe = (t) => JSON.stringify(t);

export async function capture(flowIn, { out, baseUrl, fontDirs = [], quality = 94, headed = false, log = () => {}, crf = 10, flowHash = null, keepWarm = false } = {}) {
  if (headed) throw new Error('--headed: frame-exact capture needs the headless shell (HeadlessExperimental.beginFrame has no headed mode). Run headless and read the contact sheet (`kinetype capture --sheet DIR`) instead.');
  const flow = resolveFlow(flowIn, { baseUrl });
  const exe = chromePath();
  if (!exe) throw new Error('no Chrome found; set KINETYPE_CHROME to a chrome-headless-shell binary');
  const wall0 = Date.now();
  out = path.resolve(out);
  const framesDir = path.join(out, 'frames');
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-capture-'));
  const env = { ...process.env, ...fontEnv([...fontDirs, ...(process.env.KINETYPE_CAPTURE_FONTS ? process.env.KINETYPE_CAPTURE_FONTS.split(':') : [])], tmp) };
  const fps = flow.fps;
  const rec = new Recorder({ fps });
  const vp = flow.device.viewport;
  const qa = { warnings: [], pageErrors: [], consoleErrors: [], httpErrors: [], settle: [] };
  const frameHashes = [];
  const uploads = [];
  const pending = new Set();
  const writes = [];
  let frameSize = null;

  const browser = await chromium.launch({ executablePath: exe, headless: true, timeout: 60000, args: [...LAUNCH_ARGS, `--force-device-scale-factor=${flow.device.deviceScaleFactor}`], env });
  try {
    const ctx = await browser.newContext({
      viewport: vp, deviceScaleFactor: flow.device.deviceScaleFactor, isMobile: flow.device.isMobile, hasTouch: flow.device.hasTouch,
      locale: flow.device.locale, timezoneId: flow.device.timezone, colorScheme: flow.device.colorScheme, serviceWorkers: 'block', acceptDownloads: false,
    });
    // setup: HTTP only against the flow's own origin (cookie jar is shared with the page)
    for (const [i, r] of flow.setup.entries()) {
      const url = assertSameOrigin(flow.app.baseUrl, r.url);
      const res = await ctx.request.fetch(url, { method: r.method, data: r.body, headers: r.headers, failOnStatusCode: false, timeout: 30000 });
      if (!res.ok()) throw new Error(`setup[${i}] ${r.method} ${new URL(url).pathname} -> HTTP ${res.status()}`);
    }
    const page = await ctx.newPage();
    page.setDefaultTimeout(20000);
    const cdp = await ctx.newCDPSession(page);
    const clock = new FrameClock(cdp, {
      fps, quality, log,
      onFrame: (i, buf, hash) => {
        if (i === 0) frameSize = jpegSize(buf);
        frameHashes[i] = hash;
        const p = fs.promises.writeFile(path.join(framesDir, `f${String(i).padStart(6, '0')}.jpg`), buf).then(() => pending.delete(p));
        pending.add(p); writes.push(p);
      },
    });
    clock.onStall = () => log(`virtual time held by ${inflight.size} pending request(s): ${[...inflight].slice(0, 3).map((r) => r.method() + ' ' + new URL(r.url()).pathname).join(', ')}`);
    await clock.init();

    // ---- observation: network + page health ----
    const inflight = new Set();
    const live = (r) => !['websocket', 'eventsource'].includes(r.resourceType());
    page.on('request', (r) => { if (live(r)) inflight.add(r); });
    for (const ev of ['requestfinished', 'requestfailed']) page.on(ev, (r) => inflight.delete(r));
    page.on('response', (r) => { if (r.status() >= 400) qa.httpErrors.push({ status: r.status(), path: new URL(r.url()).pathname }); });
    page.on('pageerror', (e) => qa.pageErrors.push(String(e.message || e).slice(0, 200)));
    page.on('console', (m) => { if (m.type() === 'error') qa.consoleErrors.push(m.text().slice(0, 200)); });
    let lastNav = null;
    page.on('framenavigated', (f) => {
      if (f !== page.mainFrame()) return;
      const u = new URL(f.url());
      if (u.origin !== new URL(flow.app.baseUrl).origin) return;
      const rel = u.pathname + u.search + u.hash;
      if (rel === lastNav) return;
      lastNav = rel;
      rec.event('navigate', clock.now(), { url: rel });
    });

    // ---- target tracks: box + visibility of every targeted element on every frame ----
    // from the moment it is resolved until its step ends + flow.trackTail (C2 events[].track)
    const trackers = [];
    const tailFrames = frameOf(flow.trackTail, fps);
    clock.afterFrame = async (idx) => {
      for (const tr of trackers) {
        if (tr.done || idx < tr.from) continue;
        if (idx >= tr.until) { tr.done = true; tr.end = tr.until; tr.handle.dispose().catch(() => {}); continue; }
        await sample(tr, idx);
      }
    };
    async function sample(tr, idx) {
      let r, timer;
      try {
        r = await Promise.race([tr.handle.evaluate(probeTarget), new Promise((res) => { timer = setTimeout(() => res({ gone: true, timeout: true }), 5000); })]);
      } catch { r = { gone: true }; } finally { clearTimeout(timer); }
      const box = r.box ? boxOf(r.box) : null;
      const key = JSON.stringify([box, !!r.visible]);
      if (key !== tr.lastKey) { tr.entries.push({ t: rec.t(idx), ...(box ? { box } : {}), visible: !!r.visible }); tr.lastKey = key; }
      if (r.gone) { tr.done = true; tr.end = idx + 1; tr.handle.dispose().catch(() => {}); }
    }
    async function track(loc, step) {
      const handle = await loc.elementHandle();
      const tr = { handle, step: step.id, from: clock.now(), until: Infinity, entries: [], lastKey: null, done: false, end: null };
      // the page has not changed since the last frame was taken (virtual time is paused between
      // ticks): that frame's state is this element's state now — so a track is never empty
      if (tr.from > 0) await sample(tr, tr.from - 1);
      trackers.push(tr);
      return tr;
    }
    const withTrack = (ev, tr) => { if (tr) Object.defineProperty(ev, '_track', { value: tr, enumerable: false }); return ev; };

    // ---- helpers ----
    let ptr = { x: Math.round(vp.width * 0.5), y: Math.round(vp.height * 0.58) };
    const touch = flow.device.hasTouch;
    const wait = (s) => clock.frames(frameOf(s, fps));
    const rand = rng(flow.seed);

    async function settle(stepId, { minStable = 5, max = 90 } = {}) {
      let n = 0;
      while (n < max && !(inflight.size === 0 && clock.stable(minStable))) { await clock.tick(); n++; }
      qa.settle.push({ step: stepId, frames: n, capped: n >= max });
      if (n >= max) qa.warnings.push(`step ${stepId}: screen/network still moving after ${(max / fps).toFixed(1)} s (continuing)`);
    }

    async function resolve(step, { required = true } = {}) {
      const loc = locate(page, step.target);
      const timeout = (step.timeout ?? 8) * fps;
      for (let i = 0; i <= timeout; i++) {
        const n = await loc.count();
        if (n > 1) throw new Error(`step ${step.id}: target ${describe(step.target)} is ambiguous (${n} matches) — add "exact": true, a stricter name, or "nth"`);
        if (n === 1 && await loc.isVisible()) return loc;
        await clock.tick();
      }
      if (!required) return null;
      throw new Error(`step ${step.id}: target ${describe(step.target)} not found/visible after ${step.timeout ?? 8} s`);
    }

    const inViewport = (b) => b.y >= 8 && b.y + b.height <= vp.height - 8 && b.x >= 0 && b.x + b.width <= vp.width + 1;

    async function scrollerAt(pt) {
      return page.evaluate((p) => {
        let el = document.elementFromPoint(Math.min(Math.max(p.x, 0), innerWidth - 1), Math.min(Math.max(p.y, 0), innerHeight - 1));
        while (el && el !== document.documentElement && el !== document.body) {
          const cs = getComputedStyle(el);
          if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) return { top: el.scrollTop, max: el.scrollHeight - el.clientHeight };
          el = el.parentElement;
        }
        const se = document.scrollingElement;
        return { top: se.scrollTop, max: se.scrollHeight - se.clientHeight };
      }, pt);
    }

    /** Smooth scroll by `dy` css px at point `at` over `seconds`; returns {from,to} of the scroller. */
    async function smoothScroll(at, dy, seconds) {
      const from = (await scrollerAt(at)).top;
      const steps = scrollSteps(dy, Math.max(2, frameOf(seconds, fps)));
      rec.event('scroll', clock.now(), { from, to: from, _open: true });
      const ev = rec.events[rec.events.length - 1];
      for (const d of steps) {
        // Touch devices: Input.synthesizeScrollGesture (and wheel) never move the page under a frame-driven
        // clock, so step the scroller itself by one eased delta per frame (instant behaviour, the ease is ours).
        if (touch) { await page.evaluate(scrollScrollerBy, { at, d }); await clock.tick(); }
        else await clock.input(() => page.mouse.wheel(0, d));
      }
      await settle(rec._open?.id, { minStable: 3, max: 45 });
      const to = (await scrollerAt(at)).top;
      delete ev._open; ev.to = to; ev.t1 = rec.t(clock.now());
      return { from, to };
    }

    async function ensureVisible(loc, step) {
      let b = await loc.boundingBox();
      for (let i = 0; i < 3 && b && !inViewport(b); i++) {
        const at = { x: Math.min(Math.max(b.x + b.width / 2, 20), vp.width - 20), y: vp.height / 2 };
        const dy = b.y + b.height / 2 - vp.height * 0.5;
        await smoothScroll(ptr.x > 0 && ptr.x < vp.width ? { x: ptr.x, y: ptr.y } : at, Math.round(dy), Math.min(1.2, Math.max(0.5, Math.abs(dy) / 1200)));
        b = await loc.boundingBox();
      }
      if (!b) throw new Error(`step ${step.id}: target has no box`);
      return b;
    }

    async function movePointer(to) {
      if (touch) { ptr = to; return; }
      const dist = Math.hypot(to.x - ptr.x, to.y - ptr.y);
      if (dist < 1) return;
      const frames = frameOf(travelSeconds(dist), fps);
      const from = ptr;
      rec.event('move', clock.now(), { from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, t1: rec.t(clock.now() + frames) });
      for (const p of pointerPath(from, to, frames)) await clock.input(() => page.mouse.move(p.x, p.y));
      ptr = to;
    }

    async function doClick(loc, step, { silent = false } = {}) {
      // tracked from the moment it is resolved (through any scroll into view and the pointer's travel):
      // a 'before' label names the control before the click, on touch devices too
      const tr = await track(loc, step);
      const box = await ensureVisible(loc, step);
      const point = centerOf(box);
      const label = step.label;
      await movePointer(point);
      if (!touch) await wait(0.08);
      withTrack(rec.event('click', clock.now(), { ...(label ? { label } : {}), point, box: boxOf(box) }), tr);
      if (touch) await clock.input(() => page.touchscreen.tap(point.x, point.y));
      else {
        await clock.input(() => page.mouse.down());
        await wait(0.06);
        await clock.input(() => page.mouse.up());
      }
      return { box, point, tr };
    }

    const maskedText = async (loc, text, step) => {
      if (step.secret) return '•'.repeat(text.length);
      const isPw = await loc.evaluate((el) => el.type === 'password').catch(() => false);
      return isPw ? '•'.repeat(text.length) : text;
    };

    // ---- run ----
    if (flow.steps[0].action !== 'goto') clock.startRecording();
    for (const step of flow.steps) {
      log(`step ${step.id} (${step.action})`);
      rec.beginStep(step.id, clock.now());
      switch (step.action) {
        case 'goto': {
          const u = assertSameOrigin(flow.app.baseUrl, step.url);
          await clock.during(page.goto(u, { waitUntil: 'load', timeout: 45000 }));
          await settle(step.id, { minStable: 8, max: 150 });
          if (!clock.recording) {
            // Entry animations/transitions run on *virtual* time, which stands still while requests are
            // pending (the frames keep coming). Before the film starts, let ~1.5 s of page time pass so
            // frame 0 is the settled page, not a half-faded one.
            const t0 = await page.evaluate(() => performance.now());
            for (let n = 0; n < 400; n++) {
              await clock.tick();
              if ((await page.evaluate(() => performance.now())) - t0 >= 1500 && inflight.size === 0) break;
            }
            await settle(step.id + ':warm', { minStable: 8, max: 90 });
            clock.startRecording();
          }
          break;
        }
        case 'click': {
          const loc = await resolve(step);
          if (step.files) {
            // the click opens a native file chooser (e.g. <input type=file capture>): answer it with the flow's files
            const chooser = page.waitForEvent('filechooser', { timeout: 20000 });
            await doClick(loc, step);
            const fc = await clock.during(chooser);
            await clock.input(() => fc.setFiles(step.files));
            uploads.push(...step.files.map((f) => ({ step: step.id, file: path.basename(f), sha256: sha256(fs.readFileSync(f)) })));
          } else await doClick(loc, step);
          await settle(step.id);
          break;
        }
        case 'hover': {
          const loc = await resolve(step);
          const tr = await track(loc, step);
          const box = await ensureVisible(loc, step);
          const point = centerOf(box);
          await movePointer(point);
          withTrack(rec.event('hover', clock.now(), { point, box: boxOf(box), ...(step.label ? { label: step.label } : {}) }), tr);
          await settle(step.id);
          break;
        }
        case 'type':
        case 'fill': {
          const loc = await resolve(step);
          const focused = await loc.evaluate((el) => document.activeElement === el).catch(() => false);
          let box, tr;
          if (!focused) ({ box, tr } = await doClick(loc, { ...step, label: undefined }));
          else { tr = await track(loc, step); box = await ensureVisible(loc, step); }
          await wait(0.15);
          const text = await maskedText(loc, step.value, step);
          if (step.action === 'fill') {
            withTrack(rec.event('fill', clock.now(), { box: boxOf(box), text, t1: rec.t(clock.now()) }), tr);
            await clock.input(() => loc.fill(step.value));
          } else {
            const sched = typingSchedule(step.value, { cps: step.cps ?? 14, fps, seed: Math.floor(rand() * 2 ** 31) });
            const start = clock.now();
            const ev = withTrack(rec.event('type', start, { box: boxOf(box), text, t1: rec.t(start) }), tr);
            for (const { ch, frame } of sched) {
              const gap = start + frame - 1 - clock.now();
              if (gap > 0) await clock.frames(gap);
              await clock.input(() => page.keyboard.type(ch));
            }
            ev.t1 = rec.t(clock.now());
          }
          await settle(step.id);
          break;
        }
        case 'press': {
          rec.event('press', clock.now(), { key: step.key });
          await clock.input(() => page.keyboard.press(step.key));
          await settle(step.id);
          break;
        }
        case 'scroll': {
          let dy = step.by;
          if (step.target) {
            const loc = await resolve(step);
            const b = await loc.boundingBox();
            dy = Math.round(b.y + b.height / 2 - vp.height * 0.45);
          }
          const at = touch ? { x: vp.width / 2, y: vp.height / 2 } : (ptr.x > 0 && ptr.y > 0 ? ptr : { x: vp.width / 2, y: vp.height / 2 });
          await smoothScroll(at, dy, step.duration ?? Math.min(1.6, Math.max(0.5, Math.abs(dy) / 900)));
          break;
        }
        case 'wait': await wait(step.seconds); break;
        case 'waitFor': {
          if (step.target) await resolve(step, { required: !step.optional });
          else { let n = 0; while (n < 300 && inflight.size) { await clock.tick(); n++; } }
          await settle(step.id);
          break;
        }
        case 'mark': rec.mark(step.id, clock.now()); break;
        case 'observe': {
          // no interaction: record where an element is (and when it is really visible), so a film
          // can name it explicitly as a callout target (e.g. the sheet a click opened)
          const loc = await resolve(step);
          const b = await loc.boundingBox();
          if (!b) throw new Error(`step ${step.id}: target has no box`);
          const tr = await track(loc, step);
          withTrack(rec.event('observe', clock.now(), { box: boxOf(b), ...(step.label ? { label: step.label } : {}) }), tr);
          break;
        }
        default: throw new Error(`unknown action ${step.action}`);
      }
      await wait(step.hold);
      rec.endStep(clock.now());
      for (const tr of trackers) if (tr.step === step.id && tr.until === Infinity) tr.until = clock.now() + tailFrames;
    }
    await Promise.all(writes);
    const frameCount = clock.now();
    clock.afterFrame = null;
    for (const tr of trackers) if (!tr.done) tr.handle.dispose().catch(() => {});
    for (const ev of rec.events) {
      const tr = ev._track;
      if (!tr || !tr.entries.length) continue;
      ev.track = tr.entries;
      ev.trackEnd = rec.t(Math.min(frameCount, tr.end ?? tr.until));
    }
    if (frameCount < 2) throw new Error('capture recorded fewer than 2 frames');
    if (!frameSize) throw new Error('no frame size');

    // ---- encode ----
    const mp4 = path.join(out, 'capture.mp4');
    const ff = spawnSync('nice', ['-n', '10', 'ffmpeg', '-v', 'error', '-y', '-framerate', String(fps), '-start_number', '0', '-i', path.join(framesDir, 'f%06d.jpg'),
      '-frames:v', String(frameCount), '-vf', 'scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-threads', '4', '-r', String(fps),
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-movflags', '+faststart', mp4], { encoding: 'utf8', maxBuffer: 1 << 24 });
    if (ff.status !== 0) throw new Error(`ffmpeg failed: ${ff.stderr || ff.error}`);
    const probe = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames,width,height,r_frame_rate,pix_fmt,codec_name', '-of', 'json', mp4], { encoding: 'utf8' });
    const pv = JSON.parse(probe.stdout).streams[0];
    if (Number(pv.nb_read_frames) !== frameCount) throw new Error(`mp4 has ${pv.nb_read_frames} frames, expected ${frameCount}`);

    // ---- documents ----
    const doc = buildCapture({ flow, rec, frameCount, frameSize, video: { src: 'capture.mp4', codec: 'h264', crf } });
    // setup bodies may hold credentials: they never reach capture.json or the receipt
    const cr = clock.report();
    const stage = stats(qa.settle.map((s) => s.frames));
    const receipt = {
      schema: 'kinetype.capture.receipt.v1',
      flow: flow.name,
      flowSha256: flowHash,
      captureSha256: sha256(Buffer.from(JSON.stringify(doc))),
      versions: { node: process.version, playwrightCore: JSON.parse(fs.readFileSync(new URL('../../node_modules/playwright-core/package.json', import.meta.url), 'utf8')).version, chrome: browser.version(), ffmpeg: (spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).stdout || '').split('\n')[0] },
      method: 'HeadlessExperimental.beginFrame + Emulation virtual time (frame-driven; independent of host load)',
      fontDirs: fontDirs.map((d) => path.basename(path.resolve(d))),
      ...(uploads.length ? { uploads } : {}),
      wallSeconds: +((Date.now() - wall0) / 1000).toFixed(1),
      frames: { count: frameCount, width: frameSize.width, height: frameSize.height, sha256: frameHashes.slice(0, frameCount), mp4Sha256: sha256(fs.readFileSync(mp4)), mp4: { codec: pv.codec_name, pixFmt: pv.pix_fmt, frames: Number(pv.nb_read_frames) } },
      qa: {
        droppedFrames: cr.beginFrameErrors,
        unchangedFrames: cr.unchangedFrames,
        budgetTimeouts: cr.budgetTimeouts,
        beginFrameErrors: cr.beginFrameErrors,
        tickMs: cr.tickMs,
        warmupFrames: cr.ticks - frameCount,
        realtimeFactor: +(((Date.now() - wall0) / 1000) / (frameCount / fps)).toFixed(2),
        settleFrames: stage,
        cappedSettles: qa.settle.filter((s) => s.capped).length,
        warnings: qa.warnings,
        pageErrors: [...new Set(qa.pageErrors)].slice(0, 10),
        consoleErrors: [...new Set(qa.consoleErrors)].slice(0, 10),
        httpErrors: qa.httpErrors.slice(0, 20),
      },
    };
    fs.writeFileSync(path.join(out, 'capture.json'), JSON.stringify(doc, null, 2) + '\n');
    fs.writeFileSync(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    return { doc, receipt, out };
  } finally {
    await browser.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
