#!/usr/bin/env node
// real-fixture: post-process a kinetype.capture.v1 PHONE capture into "C2 v2" — a 1080x2400, 60 fps video that
// looks like a native Android phone recording (generic status bar + browser toolbar + gesture-nav bar around the
// page), plus the v2 capture.json (video-px boxes, key times, idle/busy ranges, session offset) and a receipt.
//
//   node scripts/real-fixture.js <capture-dir> --out <dir> [--session-offset S] [--payoff m1,m2] [--notify m]
//        [--counter m] [--busy fromMark:toMark] [--clock-secs 41] [--crf 18] [--font-dir fonts/files]
//
// Needs Chrome (KINETYPE_CHROME, see src/cli/browser.js) only to draw the static chrome PNGs, and ffmpeg.
// Deterministic: same inputs -> same capture.json (no wall-clock or random values anywhere).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { chromePath } from '../src/cli/browser.js';
import { fontEnv } from '../src/capture/driver.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TOOL_VERSION = '1';

// ---- native frame geometry (video px) ----
const W = 1080, H = 2400;
const CHROME = { statusBar: { y: 0, h: 72 }, toolbar: { y: 72, h: 168 }, page: { y: 240, h: 2016 }, nav: { y: 2256, h: 144 } };
const IDLE_MIN_S = 0.3, IDLE_PX_DELTA = 12, IDLE_FRACTION = 0.0002; // < 0.02 % of the page area changed = still
const KEY_MIN_PX = 30, KEY_MIN_EXTENT = 7; // keystroke vs caret blink (a blink toggles a ~3 px wide column)

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const r3 = (n) => Math.round(n * 1000) / 1000;
const r6 = (n) => Math.round(n * 1e6) / 1e6;

function parseArgs(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) flags[k] = argv[++i]; else flags[k] = true; } else pos.push(a);
  }
  return { pos, flags };
}

// ---------------------------------------------------------------- chrome PNGs
const STATUS_FG = '#1B242C';
function chromeHtml(timeText) {
  const bg = '#F6F8FA';
  const bars = [5, 8, 11, 14].map((h, i) => `<rect x="${i * 5}" y="${14 - h}" width="3.4" height="${h}" rx="1" fill="${STATUS_FG}"${i === 3 ? ' opacity=".35"' : ''}/>`).join('');
  return `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}body{width:360px;background:${bg};font-family:Inter,system-ui,sans-serif;color:${STATUS_FG}}
.sb{height:24px;display:flex;align-items:center;padding:0 18px 0 22px;position:relative}
.sb .t{font-size:13.5px;font-weight:600;letter-spacing:.01em}
.sb .hole{position:absolute;left:50%;top:6px;width:11px;height:11px;margin-left:-5.5px;border-radius:50%;background:#0b0f13}
.sb .r{margin-left:auto;display:flex;align-items:center;gap:7px}
.tb{height:56px;display:flex;align-items:center;gap:8px;padding:0 8px 0 10px;border-bottom:1px solid #DDE2E7}
.pill{flex:1;height:40px;border-radius:20px;background:#E6EAEE;display:flex;align-items:center;gap:9px;padding:0 14px 0 8px}
.pill .i{width:26px;height:26px;border-radius:50%;background:#fff;display:grid;place-items:center}
.pill span{font-size:15px;font-weight:500;color:#2a343d}
.tabs{width:26px;height:26px;border:2.2px solid #4a5560;border-radius:7px;display:grid;place-items:center;font-size:12px;font-weight:700;color:#4a5560}
.dots{width:28px;height:40px;display:grid;place-items:center}
.nv{height:48px;background:#F3F5F7;position:relative}.nv i{position:absolute;left:50%;bottom:9px;width:108px;height:4px;margin-left:-54px;border-radius:3px;background:#1B242C;opacity:.85}
</style>
<div id="top"><div class="sb"><span class="t">${timeText}</span><i class="hole"></i>
<div class="r">
<svg width="18" height="14" viewBox="0 0 18 14">${bars}</svg>
<svg width="17" height="14" viewBox="0 0 17 14" fill="none" stroke="${STATUS_FG}" stroke-width="1.9" stroke-linecap="round"><path d="M1.2 5.2a10.4 10.4 0 0 1 14.6 0"/><path d="M3.8 8.1a6.6 6.6 0 0 1 9.4 0"/><circle cx="8.5" cy="11.4" r="1.2" fill="${STATUS_FG}" stroke="none"/></svg>
<svg width="26" height="14" viewBox="0 0 26 14"><rect x=".8" y="1.8" width="21" height="10.4" rx="2.6" fill="none" stroke="${STATUS_FG}" stroke-width="1.5"/><rect x="2.6" y="3.6" width="14.4" height="6.8" rx="1.2" fill="${STATUS_FG}"/><rect x="22.8" y="5" width="1.8" height="4" rx=".8" fill="${STATUS_FG}"/></svg>
</div></div>
<div class="tb"><div class="pill"><div class="i"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2a343d" stroke-width="2.4" stroke-linecap="round"><path d="M4 8h9M17 8h3M4 16h3M11 16h9"/><circle cx="15" cy="8" r="2.2"/><circle cx="9" cy="16" r="2.2"/></svg></div><span>kvikk.app</span></div>
<div class="tabs">1</div><div class="dots"><svg width="20" height="20" viewBox="0 0 24 24" fill="#4a5560"><circle cx="12" cy="5" r="2.1"/><circle cx="12" cy="12" r="2.1"/><circle cx="12" cy="19" r="2.1"/></svg></div></div></div>
<div class="nv" id="nav"><i></i></div>`;
}

async function renderChrome(times, tmp, fontDirs) {
  const exe = chromePath();
  if (!exe) throw new Error('no Chrome found; set KINETYPE_CHROME to a chrome-headless-shell binary');
  const env = { ...process.env, ...fontEnv(fontDirs, tmp) };
  const browser = await chromium.launch({ executablePath: exe, headless: true, timeout: 60000, args: ['--no-sandbox', '--force-color-profile=srgb', '--font-render-hinting=none'], env });
  try {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 128 }, deviceScaleFactor: 3 });
    const page = await ctx.newPage();
    const tops = {};
    let nav = null;
    for (const t of times) {
      await page.setContent(chromeHtml(t));
      await page.evaluate(() => document.fonts.ready);
      const f = path.join(tmp, `top-${t.replace(':', '')}.png`);
      await page.locator('#top').screenshot({ path: f });
      tops[t] = f;
      if (!nav) { nav = path.join(tmp, 'nav.png'); await page.locator('#nav').screenshot({ path: nav }); }
    }
    return { tops, nav, chromeVersion: browser.version() };
  } finally { await browser.close().catch(() => {}); }
}

// ---------------------------------------------------------------- analysis (one decode pass over the source video)
function windowsForTypes(events, fps, s, srcW, srcH, frameCount) {
  return events.map((e, idx) => ({ e, idx })).filter(({ e }) => e.type === 'type' && e.box).map(({ e, idx }) => {
    const x0 = Math.max(0, Math.floor(e.box.x * s)), y0 = Math.max(0, Math.floor(e.box.y * s));
    const x1 = Math.min(srcW, Math.ceil((e.box.x + e.box.w) * s)), y1 = Math.min(srcH, Math.ceil((e.box.y + e.box.h) * s));
    return { idx, x0, y0, x1, y1, f0: Math.max(1, Math.floor(e.t * fps) - 1), f1: Math.min(frameCount - 1, Math.ceil(e.t1 * fps) + 8), hits: [] };
  });
}

async function analyse(src, { fps, srcW, srcH, frameCount, wins }) {
  const fsz = srcW * srcH;
  const changed = new Int32Array(frameCount); // page-wide changed px per frame (vs previous)
  const ff = spawn('nice', ['-n', '10', 'ffmpeg', '-v', 'error', '-i', src, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { stdio: ['ignore', 'pipe', 'inherit'] });
  let prev = null, cur = Buffer.allocUnsafe(fsz), fill = 0, idx = 0;
  const onFrame = () => {
    if (prev) {
      let n = 0;
      for (let i = 0; i < fsz; i++) { const d = cur[i] - prev[i]; if (d > IDLE_PX_DELTA || d < -IDLE_PX_DELTA) n++; }
      changed[idx] = n;
      for (const w of wins) {
        if (idx < w.f0 || idx > w.f1) continue;
        let cnt = 0, mn = 1e9, mx = -1;
        for (let y = w.y0; y < w.y1; y++) {
          const row = y * srcW;
          for (let x = w.x0; x < w.x1; x++) {
            const d = cur[row + x] - prev[row + x];
            if (d > IDLE_PX_DELTA || d < -IDLE_PX_DELTA) { cnt++; if (x < mn) mn = x; if (x > mx) mx = x; }
          }
        }
        w.hits.push({ f: idx, cnt, extent: mx < 0 ? 0 : mx - mn + 1 });
      }
    }
    [prev, cur] = [cur, prev || Buffer.allocUnsafe(fsz)];
    idx++;
  };
  await new Promise((resolve, reject) => {
    ff.stdout.on('data', (chunk) => {
      let o = 0;
      while (o < chunk.length) {
        const n = Math.min(fsz - fill, chunk.length - o);
        chunk.copy(cur, fill, o, o + n); fill += n; o += n;
        if (fill === fsz) { onFrame(); fill = 0; }
      }
    });
    ff.on('error', reject);
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg decode exited ${code}`))));
  });
  if (idx !== frameCount) throw new Error(`decoded ${idx} frames, expected ${frameCount}`);
  return changed;
}

function idleRanges(changed, fps, area) {
  const thr = area * IDLE_FRACTION, out = [];
  let a = -1;
  const close = (b) => { // frames a-1..b identical
    const t0 = (a - 1) / fps, t1 = b / fps;
    if (t1 - t0 >= IDLE_MIN_S - 1e-9) out.push([r6(t0), r6(t1)]);
  };
  for (let i = 1; i < changed.length; i++) {
    if (changed[i] < thr) { if (a < 0) a = i; } else if (a >= 0) { close(i - 1); a = -1; }
  }
  if (a >= 0) close(changed.length - 1);
  return out;
}

function keysFor(e, w, fps) {
  const text = String(e.text || '');
  const n = text.length;
  const cand = (w ? w.hits : []).filter((h) => h.cnt >= KEY_MIN_PX && h.extent > KEY_MIN_EXTENT);
  const clamp = (t) => Math.min(e.t1, Math.max(e.t, t));
  if (n > 0 && cand.length === n) {
    return { source: 'framediff', keys: [...text].map((ch, i) => ({ t: r6(clamp(cand[i].f / fps)), ch })) };
  }
  const span = e.t1 - e.t;
  return { source: 'even', candidates: cand.length, keys: [...text].map((ch, i) => ({ t: r6(e.t + (n > 1 ? (i * span) / (n - 1) : 0)), ch })) };
}

// ---------------------------------------------------------------- main
async function main() {
  const { pos, flags } = parseArgs(process.argv.slice(2));
  if (!pos[0] || !flags.out) throw new Error('usage: node scripts/real-fixture.js <capture-dir> --out <dir> [--session-offset S] [--payoff m1,m2] [--notify m] [--counter m] [--busy fromMark:toMark] [--clock-secs 41] [--crf 18]');
  const srcDir = path.resolve(pos[0]);
  const outDir = path.resolve(flags.out);
  const sessionOffset = Number(flags['session-offset'] ?? 0);
  const payoff = String(flags.payoff || '').split(',').filter(Boolean);
  const notify = flags.notify && flags.notify !== true ? String(flags.notify) : null;
  const counter = flags.counter && flags.counter !== true ? String(flags.counter) : null;
  const clockSecs = Number(flags['clock-secs'] ?? 41);
  const crf = Number(flags.crf ?? 18);
  const fontDirs = String(flags['font-dir'] || path.join(ROOT, 'fonts/files')).split(',').filter(Boolean);

  const srcJsonPath = path.join(srcDir, 'capture.json');
  const srcJson = fs.readFileSync(srcJsonPath);
  const v1 = JSON.parse(srcJson);
  if (v1.schema !== 'kinetype.capture.v1') throw new Error(`${srcJsonPath}: not a kinetype.capture.v1 document`);
  if (v1.device.kind !== 'phone') throw new Error('real-fixture needs a phone capture');
  const srcMp4 = path.join(srcDir, v1.video?.src || 'capture.mp4');
  const fps = v1.fps, s = v1.device.deviceScaleFactor;
  const frameCount = v1.frames.count, srcW = v1.frames.width, srcH = v1.frames.height;
  if (srcW !== W || srcH !== CHROME.page.h) throw new Error(`source frames are ${srcW}x${srcH}, need ${W}x${CHROME.page.h} (360x672 @3)`);
  const mapping = { s, ox: 0, oy: CHROME.page.y };
  fs.mkdirSync(outDir, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-realfx-'));

  try {
    // 1) analysis pass
    const wins = windowsForTypes(v1.events, fps, s, srcW, srcH, frameCount);
    const changed = await analyse(srcMp4, { fps, srcW, srcH, frameCount, wins });
    const stillRanges = idleRanges(changed, fps, srcW * srcH);

    // 2) status-bar clock: 14:02:<clockSecs> at session 0, ticks over on the session clock
    const minuteAt = (t) => Math.floor((clockSecs + sessionOffset + t) / 60);
    const label = (m) => { const tot = 14 * 60 + 2 + m; return `${String(Math.floor(tot / 60) % 24).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`; };
    const m0 = minuteAt(0), mEnd = minuteAt((frameCount - 1) / fps);
    const segs = []; // {label, t0, t1}
    for (let m = m0; m <= mEnd; m++) {
      const tStart = m === m0 ? 0 : Math.ceil(((m * 60) - clockSecs - sessionOffset) * fps) / fps;
      const tEnd = m === mEnd ? frameCount / fps + 1 : Math.ceil((((m + 1) * 60) - clockSecs - sessionOffset) * fps) / fps;
      segs.push({ label: label(m), t0: tStart, t1: tEnd });
    }
    const chromeImgs = await renderChrome([...new Set(segs.map((x) => x.label))], tmp, fontDirs);

    // 3) compose + encode
    const dur = frameCount / fps;
    const inputs = ['-i', srcMp4];
    segs.forEach((sg) => inputs.push('-loop', '1', '-framerate', String(fps), '-t', String(dur + 1), '-i', chromeImgs.tops[sg.label]));
    inputs.push('-loop', '1', '-framerate', String(fps), '-t', String(dur + 1), '-i', chromeImgs.nav);
    const nIn = segs.length + 2;
    let fc = `[0:v]scale=in_range=tv:in_color_matrix=bt709,format=gbrp,pad=${W}:${H}:0:${CHROME.page.y}:color=0xF3F5F7[b0]`;
    let last = 'b0';
    segs.forEach((sg, i) => {
      fc += `;[${last}][${i + 1}:v]overlay=0:0:format=gbrp:eof_action=pass:enable='between(t,${sg.t0},${sg.t1 - 1e-6})'[b${i + 1}]`;
      last = `b${i + 1}`;
    });
    fc += `;[${last}][${nIn - 1}:v]overlay=0:${CHROME.nav.y}:format=gbrp:eof_action=pass,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[v]`;
    const mp4 = path.join(outDir, 'capture.mp4');
    const enc = spawnSync('nice', ['-n', '10', 'ffmpeg', '-v', 'error', '-y', ...inputs, '-filter_complex', fc, '-map', '[v]', '-frames:v', String(frameCount),
      '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-r', String(fps), '-fps_mode', 'cfr', '-threads', '4', '-g', '120',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-movflags', '+faststart', mp4], { encoding: 'utf8', maxBuffer: 1 << 24 });
    if (enc.status !== 0) throw new Error(`ffmpeg compose failed: ${enc.stderr || enc.error}`);
    fs.rmSync(path.join(outDir, 'frames'), { recursive: true, force: true });
    const pr = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames,width,height,r_frame_rate,pix_fmt,codec_name', '-of', 'json', mp4], { encoding: 'utf8' }).stdout).streams[0];
    if (Number(pr.nb_read_frames) !== frameCount || pr.width !== W || pr.height !== H) throw new Error(`composed mp4 is ${pr.width}x${pr.height} with ${pr.nb_read_frames} frames`);

    // 4) the v2 document
    const mapBox = (b) => ({ x: r3(b.x * s + mapping.ox), y: r3(b.y * s + mapping.oy), w: r3(b.w * s), h: r3(b.h * s) });
    const mapPt = (p) => ({ x: r3(p.x * s + mapping.ox), y: r3(p.y * s + mapping.oy) });
    const keyReport = [];
    const events = v1.events.map((e, idx) => {
      const o = { ...e };
      if (e.box) o.vbox = mapBox(e.box);
      if (e.point) o.vpoint = mapPt(e.point);
      if (e.track) o.track = e.track.map((tr) => (tr.box ? { ...tr, vbox: mapBox(tr.box) } : tr));
      if (e.type === 'type') {
        const w = wins.find((x) => x.idx === idx);
        const k = keysFor(e, w, fps);
        o.keys = k.keys;
        o.keysSource = k.source;
        keyReport.push({ step: e.step, source: k.source, chars: k.keys.length, ...(k.candidates !== undefined ? { candidates: k.candidates } : {}) });
      }
      if (e.box || e.point) o.mapping = { ...mapping };
      return o;
    });
    const marks = v1.marks.map((m) => {
      const o = { ...m };
      if (payoff.includes(m.id)) o.payoff = true;
      if (m.id === notify) o.kind = 'notify';
      else if (m.id === counter) o.kind = 'counter';
      else if (payoff.includes(m.id)) o.kind = 'payoff';
      return o;
    });
    for (const id of [...payoff, notify, counter].filter(Boolean)) if (!v1.marks.some((m) => m.id === id)) throw new Error(`mark "${id}" not found in the source capture`);

    let busy = [], busySource = 'none';
    if (flags.busy && flags.busy !== true) {
      const [a, b] = String(flags.busy).split(':');
      const at = (id) => { const m = v1.marks.find((x) => x.id === id); if (m) return m.t; const st = v1.steps.find((x) => x.id === id); if (st) return st.t0; throw new Error(`--busy: no mark/step "${id}"`); };
      busy = [[r6(at(a)), r6(at(b))]];
      busySource = `declared:${a}:${b}`;
    }

    // a spinner/skeleton is activity: busy ranges win over "still" (a slowly rotating ring changes < 0.02 % of the page per frame)
    const idle = [];
    for (const [a, b] of stillRanges) {
      let pieces = [[a, b]];
      for (const [ba, bb] of busy) pieces = pieces.flatMap(([x, y]) => (bb <= x || ba >= y ? [[x, y]] : [[x, Math.min(y, ba)], [Math.max(x, bb), y]].filter(([p, q]) => q > p)));
      for (const [x, y] of pieces) if (y - x >= IDLE_MIN_S - 1e-9) idle.push([r6(x), r6(y)]);
    }

    const doc = {
      schema: 'kinetype.capture.v1',
      version: 2,
      flow: v1.flow,
      app: v1.app,
      clock: 'wall',
      device: {
        kind: 'phone', viewport: v1.device.viewport, deviceScaleFactor: s,
        ...(v1.device.isMobile !== undefined ? { isMobile: v1.device.isMobile } : {}), ...(v1.device.hasTouch !== undefined ? { hasTouch: v1.device.hasTouch } : {}),
        video: { width: W, height: H },
        chrome: structuredClone(CHROME),
      },
      fps,
      duration: v1.duration,
      mapping,
      video: { src: 'capture.mp4', codec: 'h264', fps, width: W, height: H },
      sessionOffset,
      statusBar: { clock: segs.map((x) => ({ t: r6(Math.min(x.t0, dur)), text: x.label })), startSecs: clockSecs },
      idle,
      busy,
      busySource,
      events,
      marks,
      steps: v1.steps,
    };
    const jsonText = JSON.stringify(doc, null, 2) + '\n';
    fs.writeFileSync(path.join(outDir, 'capture.json'), jsonText);

    const ffv = (spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).stdout || '').split('\n')[0];
    const receipt = {
      schema: 'kinetype.capture.receipt.v2',
      tool: { name: 'scripts/real-fixture.js', version: TOOL_VERSION },
      source: { captureSha256: sha256(srcJson), mp4Sha256: sha256(fs.readFileSync(srcMp4)), flow: v1.flow },
      captureSha256: sha256(Buffer.from(jsonText)),
      mp4Sha256: sha256(fs.readFileSync(mp4)),
      mp4: { codec: pr.codec_name, pixFmt: pr.pix_fmt, width: pr.width, height: pr.height, frames: Number(pr.nb_read_frames), fps, crf, bytes: fs.statSync(mp4).size },
      versions: { node: process.version, playwrightCore: JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/playwright-core/package.json'), 'utf8')).version, chrome: chromeImgs.chromeVersion, ffmpeg: ffv },
      params: { sessionOffset, clockSecs, payoff, notify, counter, busy: flags.busy || null },
      analysis: {
        idle: { thresholdPxDelta: IDLE_PX_DELTA, thresholdFraction: IDLE_FRACTION, minSeconds: IDLE_MIN_S, ranges: idle.length, source: 'frame-diff of the page region (status-bar clock excluded by construction)' },
        busy: { source: busySource },
        keys: keyReport,
      },
    };
    fs.writeFileSync(path.join(outDir, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    console.log(JSON.stringify({ out: outDir, duration: doc.duration, frames: frameCount, mp4Bytes: receipt.mp4.bytes, idle, busy, busySource, keys: keyReport, clock: doc.statusBar.clock }, null, 1));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

main().catch((e) => { console.error(e.stack || String(e)); process.exit(1); });
