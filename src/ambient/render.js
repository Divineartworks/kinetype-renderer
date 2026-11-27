// Ambient render driver: src/ambient/page.html runs a GLSL preset on the GPU in headless Chrome
// (ANGLE Metal); every frame is read back and posted to a local sink that reorders frames by index
// and feeds ffmpeg. Frames are a pure function of (preset, seed, frame index, frame count), so any
// frame can be re-rendered on its own and frame N equals frame 0 by construction.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { chromePath, withTimeout } from '../cli/browser.js';
import * as presets from './presets/index.js';
import { sha256File } from './manifest.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FFMPEG = process.env.KINETYPE_FFMPEG || 'ffmpeg';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

export const RES = { 1080: [1920, 1080], 2160: [3840, 2160] };

/** Output size from `res` (1080 | 2160), or explicit width/height (tests use tiny sizes). */
export function sizeOf({ res = 1080, width, height } = {}) {
  if (width && height) return [Number(width), Number(height)];
  const s = RES[Number(res)];
  if (!s) throw new Error(`unsupported --res ${res} (use 1080 or 2160)`);
  return s;
}

let encoderCache;
/** Loop master encoder: hevc_videotoolbox (main10) when this ffmpeg has it, else libx265 10-bit. */
export function pickEncoder() {
  if (encoderCache) return encoderCache;
  let list = '';
  try { list = execFileSync(FFMPEG, ['-hide_banner', '-encoders'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch { throw new Error('ffmpeg not found (set KINETYPE_FFMPEG)'); }
  encoderCache = process.env.KINETYPE_AMBIENT_ENCODER !== 'libx265' && /hevc_videotoolbox/.test(list) ? 'hevc_videotoolbox' : 'libx265';
  return encoderCache;
}

/** Output colour: RGB -> YUV with the BT.709 matrix, limited (tv) range, and the stream tagged to match. */
export const COLOUR = { matrix: 'bt709', primaries: 'bt709', trc: 'bt709', range: 'tv' };
export const colourVf = (fmt) => `vflip,scale=out_color_matrix=bt709:out_range=tv,format=${fmt},setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv`;   // setparams: the encoders take primaries/trc from the frames
export const colourTags = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];

export function masterArgs(fps, height) {
  const enc = pickEncoder();
  if (enc === 'hevc_videotoolbox') {
    return { codec: 'hevc_videotoolbox', pixFmt: 'yuv420p10le', args: ['-vf', colourVf('p010le'), ...colourTags, '-c:v', 'hevc_videotoolbox', '-profile:v', 'main10', '-b:v', height >= 2160 ? '45M' : '16M', '-g', String(fps * 10), '-tag:v', 'hvc1', '-an', '-movflags', '+faststart'] };
  }
  return { codec: 'libx265', pixFmt: 'yuv420p10le', args: ['-vf', colourVf('yuv420p10le'), ...colourTags, '-c:v', 'libx265', '-preset', 'medium', '-crf', '16', '-x265-params', `keyint=${fps * 10}:min-keyint=${fps * 10}:log-level=error`, '-tag:v', 'hvc1', '-an', '-movflags', '+faststart'] };
}

export const partialPath = (final) => final.replace(/\.mp4$/, '') + '.partial.mp4';

export function ffmpegVersion() {
  try { return execFileSync(FFMPEG, ['-version'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n')[0].trim(); } catch { return 'unknown'; }
}

/**
 * One server + browser + page with the preset compiled. `fn(ctx)` gets { run, benchGpu, renderer, info };
 * everything is torn down afterwards. Any page error fails loudly.
 */
async function withPage(opts, fn) {
  const { preset, seed = 1, fps = 30, loopSeconds, images = [], p, qa = false, frag } = opts;
  const meta = presets.metaOf(preset);
  const loop = loopSeconds ?? meta.loopSeconds;
  const [w, h] = sizeOf(opts);
  const frames = Math.round(loop * fps);
  if (!(frames >= 2)) throw new Error(`loop of ${loop}s at ${fps} fps has ${frames} frames`);
  if (images.length < meta.images) throw new Error(`preset ${preset} needs ${meta.images} images (--images still.png,depth.png)`);
  for (const f of images) if (!fs.existsSync(f)) throw new Error(`image not found: ${f}`);
  const exe = chromePath();
  if (!exe) throw new Error('no Chrome found; set KINETYPE_CHROME to a Chrome/Chromium binary');

  let sink = null;
  let nextIdx = 0;
  const pending = new Map();
  let chain = Promise.resolve();
  function ordered(idx, buf) {
    if (idx < 0) return sink(buf);
    return new Promise((resolve, reject) => {
      pending.set(idx, { buf, resolve, reject });
      chain = chain.then(async () => {
        while (pending.has(nextIdx)) {
          const f = pending.get(nextIdx);
          pending.delete(nextIdx);
          nextIdx++;
          try { await sink(f.buf); f.resolve(); } catch (e) { f.reject(e); }
        }
      });
    });
  }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/sink') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
        try { await ordered(+(url.searchParams.get('i') ?? -1), Buffer.concat(chunks)); res.end('ok'); } catch (e) { res.statusCode = 500; res.end(String(e)); }
      });
      return;
    }
    if (url.pathname === '/favicon.ico') { res.statusCode = 204; return res.end(); }
    const img = /^\/img\/(\d+)$/.exec(url.pathname);
    let f;
    if (img) f = images[+img[1]] && path.resolve(images[+img[1]]);
    else {
      f = path.resolve(ROOT, '.' + decodeURIComponent(url.pathname));
      if (!f.startsWith(ROOT + path.sep)) f = null;
    }
    if (!f || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream');
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  let browser;
  try {
    browser = await chromium.launch({
      executablePath: exe, headless: true, timeout: 60000,
      args: ['--disable-features=MacAppCodeSignClone', '--force-color-profile=srgb', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
        '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--js-flags=--expose-gc',
        ...(process.env.KINETYPE_GL !== '0' ? ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] : [])],
    });
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    const fail = (what, e) => new Error(`ambient ${what}: ${e ? e.message : ''}${errors.length ? ' | ' + errors.join(' | ') : ''}`);
    await page.goto(`${base}/page.html`);
    await page.waitForFunction(() => window.ready, null, { timeout: 30000 }).catch((e) => { throw fail('page failed to boot', e); });
    const vectors = p || presets.paramVectors(preset, opts.params);
    let info;
    try {
      info = await withTimeout(page.evaluate((a) => window.setup(a), {
        preset, seed, w, h, frames, images: images.map((_, k) => `/img/${k}`), qa, frag,
        params: { loopSeconds: loop, p0: vectors[0], p1: vectors[1], p2: vectors[2], p3: vectors[3], p4: vectors[4], p5: vectors[5] },
      }), 120000, 'shader setup');
    } catch (e) { throw fail('setup failed', e); }

    const run = async ({ from, to, step = 1, seeds, onFrame, unwrap = false }) => {
      sink = onFrame;
      nextIdx = 0; pending.clear();
      let r;
      try {
        r = await withTimeout(page.evaluate((x) => window.run(x), { sink: '/sink', from, to, step, seeds, unwrap }), 120000 + Math.ceil((to - from) / step) * 300, 'frame render');
      } catch (e) { throw fail('render failed', e); }
      if (errors.length) throw fail('page error');
      return r;
    };
    const benchGpu = (n = 90) => page.evaluate((x) => window.bench(x), n);
    const chrome = browser.version();
    return await fn({ run, benchGpu, renderer: info.renderer, chrome, frames, width: w, height: h, loop, fps, seed, preset });
  } finally {
    if (browser) await browser.close().catch(() => {});
    await new Promise((r) => server.close(r));
  }
}

/** ffmpeg fed with raw RGBA frames; returns { sink, end }. */
export function encoder(w, h, fps, outArgs) {
  const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-r', String(fps), '-i', '-', ...outArgs], { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', (c) => { err += c; });
  let dead = null;
  p.stdin.on('error', (e) => { dead = e; });
  const done = new Promise((res, rej) => p.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}: ${err.trim()}`)))));
  done.catch(() => {});
  return {
    sink: (buf) => new Promise((res, rej) => {
      if (dead) return rej(new Error(`ffmpeg input closed: ${dead.message} ${err.trim()}`));
      p.stdin.write(buf, (e) => (e ? rej(e) : res()));
    }),
    end: () => { p.stdin.end(); return done; },
  };
}

const ms = (t0) => Date.now() - t0;

function mkdirFor(file) { fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true }); }

/** The loop master: the whole loop, 10-bit HEVC, IDR at frame 0. */
export async function renderLoop(opts) {
  const { out } = opts;
  mkdirFor(out);
  return withPage(opts, async (ctx) => {
    const t0 = Date.now();
    const enc = masterArgs(ctx.fps, ctx.height);
    const e = encoder(ctx.width, ctx.height, ctx.fps, [...enc.args, out]);
    try {
      await ctx.run({ from: 0, to: ctx.frames, onFrame: e.sink });
    } catch (err) { await e.end().catch(() => {}); throw err; }
    await e.end();
    return { file: out, frames: ctx.frames, ms: ms(t0), fps: ctx.fps, width: ctx.width, height: ctx.height, loopSeconds: ctx.loop, codec: enc.codec, pixFmt: enc.pixFmt, colour: COLOUR, renderer: ctx.renderer, chrome: ctx.chrome };
  });
}

/** A review clip (libx264 crf 14). start/seconds in loop seconds; step > 1 renders a time-lapse. */
export async function renderClip(opts) {
  const { out, seconds = 20, start = 0, step = 1 } = opts;
  mkdirFor(out);
  return withPage(opts, async (ctx) => {
    const t0 = Date.now();
    const from = Math.round(start * ctx.fps);
    const e = encoder(ctx.width, ctx.height, ctx.fps, ['-vf', colourVf('yuv420p'), ...colourTags, '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-an', '-movflags', '+faststart', out]);
    try {
      await ctx.run({ from, to: from + Math.round(seconds * ctx.fps) * step, step, onFrame: e.sink });
    } catch (err) { await e.end().catch(() => {}); throw err; }
    await e.end();
    return { file: out, frames: Math.round(seconds * ctx.fps), ms: ms(t0), fps: ctx.fps, width: ctx.width, height: ctx.height, renderer: ctx.renderer };
  });
}

/** Contact sheet of `seeds` ([a..b]) at one loop phase: one PNG, 5 columns. */
export async function renderSheet(opts) {
  const { out, seeds, phase = 0.37 } = opts;
  if (!seeds?.length) throw new Error('renderSheet needs seeds');
  mkdirFor(out);
  return withPage({ ...opts, seed: seeds[0] }, async (ctx) => {
    const cols = 5, rows = Math.ceil(seeds.length / cols);
    const e = encoder(ctx.width, ctx.height, ctx.fps, ['-vf', `vflip,scale=${Math.round(ctx.width / 4)}:-2:flags=area,tile=${cols}x${rows}:padding=6:color=0x202020`, '-frames:v', '1', out]);
    const at = Math.round(phase * ctx.frames) % ctx.frames;
    try { await ctx.run({ from: at, to: at + seeds.length, seeds, onFrame: e.sink }); } catch (err) { await e.end().catch(() => {}); throw err; }
    await e.end();
    return { file: out, seeds, renderer: ctx.renderer };
  });
}

/** 10 evenly spaced phases of one loop in one PNG. */
export async function renderStrip(opts) {
  const { out } = opts;
  mkdirFor(out);
  return withPage(opts, async (ctx) => {
    const e = encoder(ctx.width, ctx.height, ctx.fps, ['-vf', `vflip,scale=${Math.round(ctx.width / 4)}:-2:flags=area,tile=5x2:padding=6:color=0x202020`, '-frames:v', '1', out]);
    const stepF = Math.max(1, Math.floor(ctx.frames / 10));
    try { await ctx.run({ from: 0, to: stepF * 10, step: stepF, onFrame: e.sink }); } catch (err) { await e.end().catch(() => {}); throw err; }
    await e.end();
    return { file: out, renderer: ctx.renderer };
  });
}

function mad(x, y) {
  let s = 0;
  for (let i = 0; i < x.length; i += 4) s += Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]);
  return s / (x.length * 0.75);
}
function maxAbsDiff(x, y) {
  let m = 0;
  for (let i = 0; i < x.length; i += 4) m = Math.max(m, Math.abs(x[i] - y[i]), Math.abs(x[i + 1] - y[i + 1]), Math.abs(x[i + 2] - y[i + 2]));
  return m;
}

/**
 * Seam check, rendered with u_qa = 1 (no per-frame grain/dither) so only motion is measured.
 * (1) Periodicity: frame N is rendered UNWRAPPED (u_phase = N/N = 1.0, u_frame = N) and compared with frame 0;
 *     frameNequalsFrame0 = max abs byte diff <= 1 (float noise); the diff is reported as frameNmaxDiff.
 * (2) Motion across the real seam (wrapped frames N-2, N-1, 0, 1): mean |diff| before / across / after, 8-bit units.
 */
export async function seamCheck(opts) {
  return withPage({ ...opts, qa: true }, async (ctx) => {
    const grab = async (x) => { const got = []; await ctx.run({ ...x, onFrame: async (b) => { got.push(Buffer.from(b)); } }); return got; };
    const [f0] = await grab({ from: 0, to: 1 });
    const [fN] = await grab({ from: ctx.frames, to: ctx.frames + 1, unwrap: true });
    const w = await grab({ from: ctx.frames - 2, to: ctx.frames + 2 });
    const diff = maxAbsDiff(fN, f0);
    return {
      beforeSeam: mad(w[0], w[1]), acrossSeam: mad(w[1], w[2]), afterSeam: mad(w[2], w[3]),
      frameNmaxDiff: diff, frameNequalsFrame0: diff <= 1,
      renderer: ctx.renderer,
    };
  });
}

/** sha256 of the raw RGBA bytes of the given frame indices (determinism checks). */
export async function frameHashes(opts) {
  const { frames: idx } = opts;
  return withPage(opts, async (ctx) => {
    const out = [];
    for (const i of idx) await ctx.run({ from: i, to: i + 1, onFrame: async (b) => { out.push(crypto.createHash('sha256').update(b).digest('hex')); } });
    return out;
  });
}

/** Raw RGBA frames (bottom-up rows) for the given frame indices, as Buffers. */
export async function framePixels(opts) {
  const { frames: idx } = opts;
  return withPage(opts, async (ctx) => {
    const out = [];
    for (const i of idx) await ctx.run({ from: i, to: i + 1, onFrame: async (b) => { out.push(Buffer.from(b)); } });
    return out;
  });
}

/** GPU time per frame (no readback of the full frame) and readback+transfer throughput without an encoder. */
export async function bench(opts) {
  return withPage(opts, async (ctx) => {
    const msPerFrameGpu = await ctx.benchGpu(90);
    const r = await ctx.run({ from: 0, to: 120, onFrame: async () => {} });
    return { preset: ctx.preset, width: ctx.width, height: ctx.height, msPerFrameGpu, fpsReadbackTransfer: 120 / (r.ms / 1000), renderer: ctx.renderer };
  });
}

export { sha256File };
