#!/usr/bin/env node
// Throwaway generator for the ui-demo fixture captures (kinetype.capture.v1).
// The demo "app" (fixtures/demo-app/*.html) is a pure function of time
// (window.__seek(t)), so every frame is a deterministic screenshot and every
// event box is measured from the real DOM at the moment of the event.
//
//   set KINETYPE_CHROME (and fonts, if needed) for your host
//   node fixtures/make-fixtures.js [desktop|phone]
//   node fixtures/make-fixtures.js --tracks [desktop|phone]   # only (re)compute event tracks in capture.json
//
// Writes fixtures/captures/demo-app-<kind>/{capture.json, capture.mp4, receipt.json}
// and frames/f%06d.jpg. Only capture.json, capture.mp4 and receipt.json are
// committed: the JPEG frames are ~60 MB per fixture, the yuv444p CRF-10 video
// ~3 MB, and ui-demo decodes the video frame-for-frame when frames are absent.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { startServer, ROOT } from '../src/cli/server.js';
import { chromePath } from '../src/cli/browser.js';
import { probeTarget } from '../src/capture/driver.js';

const KINDS = {
  desktop: { page: 'desktop.html', flow: 'demo-app-desktop', device: { kind: 'desktop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 } },
  phone: { page: 'phone.html', flow: 'demo-app-phone', device: { kind: 'phone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
};
const FPS = 30, QUALITY = 88;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const r1 = (x) => Math.round(x * 10) / 10;

async function make(kind) {
  const K = KINDS[kind];
  const t0 = Date.now();
  const out = path.join(ROOT, 'fixtures', 'captures', K.flow);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'frames'), { recursive: true });
  const srv = await startServer();
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ['--force-color-profile=srgb', '--font-render-hinting=none'] });
  try {
    const v = K.device.viewport;
    const ctx = await browser.newContext({ viewport: v, deviceScaleFactor: K.device.deviceScaleFactor, isMobile: !!K.device.isMobile, hasTouch: !!K.device.hasTouch });
    const page = await ctx.newPage();
    await page.goto(`${srv.url}/fixtures/demo-app/${K.page}`);
    await page.evaluate(() => document.fonts.ready);
    const duration = await page.evaluate(() => window.__duration);
    const script = await page.evaluate(() => window.__script);
    const count = Math.round(duration * FPS);
    const hashes = {};
    for (let i = 0; i < count; i++) {
      await page.evaluate((t) => window.__seek(t), i / FPS);
      const buf = await page.screenshot({ type: 'jpeg', quality: QUALITY, scale: 'device' });
      const name = `f${String(i).padStart(6, '0')}.jpg`;
      fs.writeFileSync(path.join(out, 'frames', name), buf);
      hashes[name] = sha(buf);
    }
    // events: boxes measured at the event time from the live DOM
    const boxAt = async (sel, t) => page.evaluate(([s, tt]) => {
      window.__seek(tt);
      const r = document.querySelector(s).getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }, [sel, t]);
    const events = [], marks = [], steps = [];
    for (const s of script) {
      if (s.type === 'mark') { marks.push({ t: s.t, id: s.id }); continue; }
      if (s.type === 'click') {
        const b = await boxAt(s.target, s.t);
        events.push({ t: s.t, type: 'click', step: s.id, label: s.label, point: { x: r1(b.x + b.w / 2), y: r1(b.y + b.h / 2) }, box: { x: r1(b.x), y: r1(b.y), w: r1(b.w), h: r1(b.h) } });
        steps.push({ id: s.id, t0: s.t0, t1: s.t1 });
      } else if (s.type === 'type') {
        const b = await boxAt(s.target, s.t);
        const box = { x: r1(b.x), y: r1(b.y), w: r1(b.w), h: r1(b.h) };
        // the field is clicked (focus) first, a third of the way in, then typed
        events.push({ t: s.click, type: 'click', step: s.id, point: { x: r1(b.x + Math.min(b.w * 0.33, 120)), y: r1(b.y + b.h / 2) }, box });
        events.push({ t: s.t, type: 'type', step: s.id, box, text: s.text, t1: s.t1 });
        steps.push({ id: s.id, t0: s.t0, t1: r1(s.t1 + 0.2) });
      } else if (s.type === 'navigate') {
        events.push({ t: s.t, type: 'navigate', step: s.id, url: s.url });
        steps.push({ id: s.id, t0: s.t0, t1: s.t1 });
      } else if (s.type === 'scroll') {
        events.push({ t: s.t, type: 'scroll', step: s.id, from: s.from, to: s.to, t1: s.t1 });
        steps.push({ id: s.id, t0: s.t0, t1: s.t1s });
      }
    }
    events.sort((a, b) => a.t - b.t);
    const dims = { width: v.width * K.device.deviceScaleFactor, height: v.height * K.device.deviceScaleFactor };
    const capture = {
      schema: 'kinetype.capture.v1',
      flow: K.flow,
      app: { name: 'Fieldnote (synthetic demo app)', baseUrl: `fixture://demo-app/${K.page}`, commit: 'fixture' },
      device: K.device,
      fps: FPS,
      duration: count / FPS,
      frames: { dir: 'frames', pattern: 'f%06d.jpg', count, ...dims },
      events, marks, steps,
    };
    // the same frames as a constant-fps video (4:4:4 keeps coloured UI text crisp)
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-threads', '4', '-framerate', String(FPS), '-start_number', '0', '-i', path.join(out, 'frames', 'f%06d.jpg'),
      '-c:v', 'libx264', '-threads', '4', '-preset', 'medium', '-crf', '10', '-pix_fmt', 'yuv444p', '-tune', 'stillimage', '-movflags', '+faststart', path.join(out, 'capture.mp4')]);
    capture.video = { src: 'capture.mp4', codec: 'h264', crf: 10, pix_fmt: 'yuv444p' };
    const cj = JSON.stringify(capture, null, 2) + '\n';
    fs.writeFileSync(path.join(out, 'capture.json'), cj);
    const receipt = {
      kind: 'kinetype.capture_receipt.v1',
      generator: 'fixtures/make-fixtures.js (synthetic, time-driven demo app)',
      flow_sha256: sha(fs.readFileSync(path.join(ROOT, 'fixtures', 'demo-app', K.page))),
      capture_sha256: sha(Buffer.from(cj)),
      video_sha256: sha(fs.readFileSync(path.join(out, 'capture.mp4'))),
      frames_sha256: hashes,
      tools: { playwright: (await import('playwright-core/package.json', { with: { type: 'json' } })).default.version, chrome: browser.version(), node: process.version },
      jpeg_quality: QUALITY,
      wall_sec: (Date.now() - t0) / 1000,
    };
    fs.writeFileSync(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    const bytes = fs.readdirSync(path.join(out, 'frames')).reduce((a, n) => a + fs.statSync(path.join(out, 'frames', n)).size, 0);
    const unique = new Set(Object.values(hashes)).size;
    console.error(`${K.flow}: ${count} frames (${unique} unique), ${(bytes / 1e6).toFixed(2)} MB, ${events.length} events → ${path.relative(ROOT, out)}`);
  } finally {
    await browser.close();
    await srv.close();
  }
}

/**
 * C2 target tracks for the fixture's targeted events, measured exactly like `kinetype capture`
 * does (probeTarget: box + topmost-at-9-points + in viewport) on every frame from the step's
 * start until its end + 3 s. The app is a pure function of time, so this needs no re-recording.
 */
async function tracks(kind) {
  const K = KINDS[kind];
  const out = path.join(ROOT, 'fixtures', 'captures', K.flow);
  const capFile = path.join(out, 'capture.json');
  const capture = JSON.parse(fs.readFileSync(capFile, 'utf8'));
  const srv = await startServer();
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ['--force-color-profile=srgb', '--font-render-hinting=none'] });
  try {
    const v = K.device.viewport;
    const ctx = await browser.newContext({ viewport: v, deviceScaleFactor: K.device.deviceScaleFactor, isMobile: !!K.device.isMobile, hasTouch: !!K.device.hasTouch });
    const page = await ctx.newPage();
    await page.goto(`${srv.url}/fixtures/demo-app/${K.page}`);
    await page.evaluate(() => document.fonts.ready);
    const script = await page.evaluate(() => window.__script);
    const r2 = (x) => Math.round(x * 100) / 100;
    for (const e of capture.events) {
      if (!e.box) continue;
      const s = script.find((x) => x.id === e.step && x.target);
      const st = capture.steps.find((x) => x.id === e.step);
      if (!s || !st) continue;
      const f0 = Math.round(st.t0 * FPS), f1 = Math.min(capture.frames.count, Math.round((st.t1 + 3) * FPS));
      const track = [];
      let last = null;
      for (let f = f0; f < f1; f++) {
        const r = await page.evaluate(([sel, tt, probe]) => {
          window.__seek(tt);
          return (0, eval)(`(${probe})`)(document.querySelector(sel));
        }, [s.target, f / FPS, probeTarget.toString()]);
        const box = r.box ? { x: r2(r.box.x), y: r2(r.box.y), w: r2(r.box.w), h: r2(r.box.h) } : null;
        const key = JSON.stringify([box, !!r.visible]);
        if (key !== last) { track.push({ t: +(f / FPS).toFixed(6), ...(box ? { box } : {}), visible: !!r.visible }); last = key; }
      }
      e.track = track;
      e.trackEnd = +(f1 / FPS).toFixed(6);
    }
    const cj = JSON.stringify(capture, null, 2) + '\n';
    fs.writeFileSync(capFile, cj);
    const recFile = path.join(out, 'receipt.json');
    const receipt = JSON.parse(fs.readFileSync(recFile, 'utf8'));
    receipt.capture_sha256 = sha(Buffer.from(cj));
    receipt.tracks = 'events[].track measured by fixtures/make-fixtures.js --tracks (probeTarget, every frame, step t0 → t1 + 3 s)';
    fs.writeFileSync(recFile, JSON.stringify(receipt, null, 2) + '\n');
    console.error(`${K.flow}: tracks for ${capture.events.filter((e) => e.track).length} events`);
  } finally {
    await browser.close();
    await srv.close();
  }
}

const args = process.argv.slice(2);
const onlyTracks = args[0] === '--tracks';
const which = onlyTracks ? args[1] : args[0];
for (const k of which ? [which] : Object.keys(KINDS)) { if (!onlyTracks) await make(k); await tracks(k); }
