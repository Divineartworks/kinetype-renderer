// Render orchestration: N headless pages render disjoint frames in parallel
// (safe because every frame is a pure function of time), a reorder buffer
// feeds ffmpeg in order, and every frame is hashed for the receipt.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { startServer, ROOT } from './server.js';
import { launch, openRuntime, withTimeout } from './browser.js';
import { resolve as resolveSpec, validate } from './spec.js';
import { layoutQA, pixelQAStream } from './qa.js';
import { sha256 } from './fonts.js';

const FFMPEG = process.env.KINETYPE_FFMPEG || 'ffmpeg';

function gitRev() {
  try { return execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'uncommitted'; }
}

export const FORMATS = ['mp4', 'prores', 'mov-alpha', 'webm'];
/** Output base name: spec.name, else spec_path basename, else template. Shared by render and `kinetype engine --fake`. */
export const nameFor = (spec, specPath) => spec.name || (specPath ? path.basename(specPath).replace(/\.json$/, '') : spec.template);
/** File name for one format; mov-alpha is <name>.alpha.mov. */
export const fileNameFor = (name, f) => `${name}${f === 'mov-alpha' ? '.alpha' : ''}.${f === 'prores' || f === 'mov-alpha' ? 'mov' : f}`;

export function outDirFor(spec, specPath, out) {
  const name = nameFor(spec, specPath);
  const dir = path.resolve(out || path.join(ROOT, 'out', name));
  fs.mkdirSync(dir, { recursive: true });
  return { name, dir };
}

/** Boot a server + browser + `workers` runtime pages for a spec. */
export async function session(spec, { specDir, workers = 1, offline = false } = {}) {
  const problems = await validate(spec, { specDir });
  if (problems.length) throw Object.assign(new Error('invalid spec:\n  - ' + problems.join('\n  - ')), { problems });
  const roots = {};
  const sinks = new Map();
  const srv = await startServer({
    extraRoots: roots,
    onFrame: (job, i, buf, ex) => sinks.get(job)?.frame(i, buf, ex),
    onFile: (job, name, buf) => sinks.get(job)?.file(name, buf),
  });
  // any failure after the server is up must release it (and the browser), or the
  // process never exits — an agent calling the CLI would hang on a font error
  let resolved, browser;
  const pages = [];
  try {
    resolved = await resolveSpec(spec, { specDir, roots, offline });
    browser = await launch();
    for (let w = 0; w < workers; w++) pages.push(await openRuntime(browser, srv.url, resolved));
  } catch (e) {
    if (browser) await browser.close().catch(() => {});
    await srv.close();
    throw e;
  }
  return {
    resolved, pages, info: pages[0].info, sinks,
    async close() {
      await browser.close().catch(() => {});
      await srv.close();
    },
  };
}

/** Render stills (pre-pass): keyframes declared by the template + contact sheet. */
export async function stills(spec, { specPath, specDir, out, at, samples, shutter, log = console.error } = {}) {
  const { name, dir } = outDirFor(spec, specPath, out);
  // targeted looks (--at) go to their own folder so they never replace the full pre-pass sheet
  const sdir = path.join(dir, at?.length ? 'stills-at' : 'stills');
  // a pre-pass is a fresh look: never mix stills from an earlier run
  fs.rmSync(sdir, { recursive: true, force: true });
  fs.mkdirSync(sdir, { recursive: true });
  const s = await session(spec, { specDir });
  try {
    const info = s.info;
    const job = 'stills';
    const written = [];
    s.sinks.set(job, { file: (n, buf) => { fs.writeFileSync(path.join(sdir, n), buf); written.push(n); } });
    let items = at?.length ? at.map((t) => ({ t, label: '' })) : [...info.qa.keyframes].sort((a, b) => a.t - b.t);
    if (!items.length) items = Array.from({ length: 8 }, (_, k) => ({ t: (info.duration * (k + 0.5)) / 8, label: '' }));
    const ns = samples ?? spec.render?.samples ?? 4, sh = shutter ?? spec.render?.shutter ?? 1;
    const page = s.pages[0].page;
    for (let k = 0; k < items.length; k++) {
      const it = items[k];
      const fname = `${String(k + 1).padStart(2, '0')}_${it.t.toFixed(3)}s${it.label ? '_' + it.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase() : ''}.png`;
      await withTimeout(page.evaluate(([j, n, t, a, b]) => window.KT.still(j, n, t, a, b), [job, fname, it.t, ns, sh]), 120000, `still ${fname}`);
    }
    await page.evaluate(([j, its, o]) => window.KT.sheet(j, 'contact-sheet.png', its, o), [job, items, { cols: items.length > 9 ? 4 : items.length > 4 ? 4 : items.length, cellW: 480, samples: ns, shutter: sh }]);
    const lq = layoutQA(info, spec);
    fs.writeFileSync(path.join(dir, 'layout-qa.json'), JSON.stringify(lq, null, 2));
    log(`stills → ${sdir} (${items.length} + contact-sheet.png)`);
    return { dir, sdir, sheet: path.join(sdir, 'contact-sheet.png'), items, layoutQA: lq, info, errors: s.pages[0].errors };
  } finally {
    await s.close();
  }
}

function ffmpegArgs({ W, H, fps, formats, crf, dir, name, audio, transparent, preset = 'slow' }) {
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(fps), '-i', 'pipe:0'];
  if (audio) {
    if (audio.start) args.push('-ss', String(audio.start));
    args.push('-i', audio.path);
  }
  const outputs = [];
  const tags = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'];
  const aud = audio ? ['-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '320k', '-shortest'] : [];
  for (const f of formats) {
    if (f === 'mp4') {
      const file = path.join(dir, fileNameFor(name, f));
      args.push(...aud, '-vf', 'scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p',
        '-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-profile:v', 'high', '-tune', 'animation',
        '-x264-params', 'aq-mode=3', ...tags, '-color_range', 'tv', '-movflags', '+faststart', file);
      outputs.push({ format: f, file });
    } else if (f === 'prores' || f === 'mov-alpha') {
      const file = path.join(dir, fileNameFor(name, f));
      args.push(...aud, '-vf', `scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=${transparent || f === 'mov-alpha' ? 'yuva444p10le' : 'yuv444p10le'}`,
        '-c:v', 'prores_ks', '-profile:v', '4', '-vendor', 'apl0', ...tags, file);
      outputs.push({ format: f, file });
    } else if (f === 'webm') {
      const file = path.join(dir, fileNameFor(name, f));
      args.push(...(audio ? ['-map', '0:v', '-map', '1:a', '-c:a', 'libopus', '-b:a', '192k', '-shortest'] : []),
        '-vf', `scale=out_color_matrix=bt709:out_range=tv,format=${transparent ? 'yuva420p' : 'yuv420p'}`,
        '-c:v', 'libvpx-vp9', '-crf', String(Math.max(crf + 12, 20)), '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', ...tags, file);
      outputs.push({ format: f, file });
    }
  }
  return { args, outputs };
}

/**
 * Full render. Returns the receipt object (also written to <dir>/receipt.json).
 */
export const DRAFT_SCALE = 0.5;

export async function render(spec, { specPath, specDir, out, samples, shutter, workers, formats, crf, frames: frameRange, draft = false, log = console.error, onProgress, frameTimeoutMs = 120000 } = {}) {
  const t0 = Date.now();
  // draft: half-size output, one motion-blur sample, fast x264, no pixel QA; the spec on disk is untouched
  if (draft) spec = { ...spec, render: { ...(spec.render || {}), scale: (spec.render?.scale ?? 1) * DRAFT_SCALE, preset: 'ultrafast' } };
  const od = outDirFor(spec, specPath, out);
  const name = od.name;
  const dir = draft ? path.join(od.dir, 'draft') : od.dir;
  fs.mkdirSync(dir, { recursive: true });
  const W0 = workers ?? spec.render?.workers ?? Math.max(1, Math.min(6, Math.floor(os.cpus().length / 2)));
  const ns = draft ? 1 : samples ?? spec.render?.samples ?? 4;
  const sh = shutter ?? spec.render?.shutter ?? 1;
  const fmts = draft ? ['mp4'] : formats ?? spec.render?.formats ?? ['mp4'];
  const q = draft ? (crf ?? 24) : crf ?? spec.render?.crf ?? 12;
  const s = await session(spec, { specDir, workers: W0 });
  const info = s.info;
  const W = info.renderWidth, H = info.renderHeight, fps = info.fps;
  const first = frameRange?.[0] ?? 0, last = frameRange?.[1] ?? info.frames - 1;
  const total = last - first + 1;
  let audio = null;
  if (spec.audio?.src) audio = { path: path.resolve(specDir, spec.audio.src), start: spec.audio.start ?? 0 };
  const { args, outputs } = ffmpegArgs({ W, H, fps, formats: fmts, crf: q, dir, name, audio, transparent: !!spec.render?.transparent, preset: spec.render?.preset });
  const ff = spawn(FFMPEG, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let ffErr = '';
  ff.stderr.on('data', (d) => { ffErr += d; });
  const ffDone = new Promise((res) => ff.on('close', res));
  let ffBroken = null;
  ff.stdin.on('error', (e) => { ffBroken = e; }); // EPIPE if ffmpeg dies; surfaced below with its stderr

  const hashes = new Array(total);
  // footage makes palette QA meaningless — unless the scene marks exactly which pixels are
  // third-party (info.paletteExempt: ui-demo's captured UI, brand-card's logo); then it stays strict elsewhere
  const pixq = draft ? { push() {}, finish: () => ({ checks: [{ id: 'pixel-qa', status: 'unknown', detail: 'skipped in draft (layout + analytic template checks only)' }], framesSampled: 0 }) } : pixelQAStream({ info, spec: spec.background || (spec.media && !info.paletteExempt) ? { ...spec, rules: { paletteStrict: false, ...(spec.rules || {}) } } : spec, first, last });
  const exempt = new Map();
  const buffer = new Map();
  let next = first;
  let waiters = [];
  const job = 'render';
  let writing = Promise.resolve();
  const drain = async () => {
    while (buffer.has(next)) {
      const buf = buffer.get(next);
      buffer.delete(next);
      hashes[next - first] = crypto.createHash('sha256').update(buf).digest('hex');
      pixq.push(next, buf, exempt.get(next));
      exempt.delete(next);
      if (ffBroken) throw new Error(`ffmpeg stopped accepting frames (${ffBroken.code}): ${ffErr.slice(-800)}`);
      if (!ff.stdin.write(buf)) await Promise.race([new Promise((r) => ff.stdin.once('drain', r)), ffDone]);
      next++;
      const w = waiters;
      waiters = [];
      w.forEach((r) => r());
      if ((next - first) % Math.max(1, Math.round(total / 20)) === 0) {
        log(`  ${Math.round(((next - first) / total) * 100)}%  frame ${next}/${last + 1}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        onProgress?.(next - first, total);
      }
    }
  };
  s.sinks.set(job, {
    frame: (i, buf, ex) => {
      buffer.set(i, buf);
      if (ex) exempt.set(i, ex);
      writing = writing.then(drain);
      return writing;
    },
  });
  const window_ = W0 * 3;
  let cursor = first;
  const tRender = Date.now();
  await Promise.all(s.pages.map(async ({ page }) => {
    for (;;) {
      const i = cursor++;
      if (i > last) return;
      while (i - next >= window_) await new Promise((r) => waiters.push(r));
      let timer;
      await Promise.race([
        page.evaluate(([j, k, a, b]) => window.KT.emit(j, k, a, b), [job, i, ns, sh]),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`frame ${i} did not render within ${frameTimeoutMs} ms`)), frameTimeoutMs); }),
      ]).finally(() => clearTimeout(timer));
    }
  })).catch(async (e) => {
    ff.kill('SIGKILL');
    await s.close();
    throw e;
  });
  await writing;
  ff.stdin.end();
  const code = await ffDone;
  const renderSec = (Date.now() - tRender) / 1000;
  if (code !== 0) {
    await s.close();
    throw new Error(`ffmpeg exited ${code}: ${ffErr.slice(-2000)}`);
  }

  // Template counters (frames drawn without a person matte), unioned over the workers: each frame was drawn by exactly one page.
  const cleanSeen = new Set(), cleanMiss = new Set();
  let cleanAsked = false;
  for (const { page } of s.pages) {
    const st = await page.evaluate(() => window.KT.stats()).catch(() => null);
    if (st && Array.isArray(st.cleanFrames)) { cleanAsked = true; st.cleanFrames.forEach((v) => cleanSeen.add(v)); (st.cleanMatteMiss || []).forEach((v) => cleanMiss.add(v)); }
  }

  // Determinism probe: re-render three frames on a different worker than first time.
  const probe = [first, Math.floor((first + last) / 2), last].filter((v, k, a) => a.indexOf(v) === k);
  const determinism = [];
  const reSink = new Map();
  s.sinks.set('probe', { frame: (i, buf) => reSink.set(i, buf) });
  for (const i of probe) {
    const w = s.pages[(i - first + 1) % s.pages.length].page;
    await w.evaluate(([j, k, a, b]) => window.KT.emit(j, k, a, b), ['probe', i, ns, sh]);
    const h = crypto.createHash('sha256').update(reSink.get(i)).digest('hex');
    determinism.push({ frame: i, identical: h === hashes[i - first] });
  }
  await s.close();

  const pix = pixq.finish();
  const lq = layoutQA(info, spec);
  const files = outputs.map((o) => ({ ...o, bytes: fs.statSync(o.file).size, sha256: sha256(fs.readFileSync(o.file)), probe: ffprobe(o.file) }));
  fs.writeFileSync(path.join(dir, 'frames.sha256'), hashes.map((h, k) => `${h}  frame_${String(first + k).padStart(5, '0')}`).join('\n') + '\n');
  const receipt = {
    kind: 'kinetype.render_receipt.v1',
    draft,
    ...(draft ? { draft_note: 'iteration render: scale 0.5, 1 motion-blur sample, ultrafast x264, pixel QA skipped; not a delivery file' } : {}),
    created: new Date().toISOString(),
    engine: { version: info.engine, git: gitRev() },
    template: info.template,
    spec_sha256: sha256(Buffer.from(JSON.stringify(spec))),
    spec_path: specPath || null,
    format: { width: info.width, height: info.height, renderWidth: W, renderHeight: H, fps, duration: info.duration, frames: info.frames, rendered: [first, last], loop: info.loop },
    motion_blur: { samples: ns, shutter: sh },
    fonts: Object.fromEntries(Object.entries(s.resolved.fontFiles).map(([k, v]) => [k, { family: v.family, weight: v.weight, style: v.style, sha256: v.sha256, file: path.relative(ROOT, v.path).startsWith('..') ? v.path : path.relative(ROOT, v.path) }])),
    audio: audio ? { file: audio.path, start: audio.start } : null,
    outputs: files,
    timing: { total_sec: (Date.now() - t0) / 1000, render_sec: renderSec, fps_rendered: total / renderSec, workers: W0 },
    determinism,
    qa: { layout: lq, pixels: pix },
    ...(cleanAsked ? { clean: { frames: cleanSeen.size, matteMissFrames: cleanMiss.size } } : {}),
    missing_glyphs: info.missingGlyphs,
    runtime_errors: s.pages.flatMap((p) => p.errors),
  };
  receipt.verdict = verdict(receipt);
  fs.writeFileSync(path.join(dir, 'receipt.json'), JSON.stringify(receipt, null, 2));
  log(`render → ${files.map((f) => f.file).join(', ')}  (${receipt.timing.total_sec.toFixed(1)}s, ${receipt.timing.fps_rendered.toFixed(1)} fps, verdict ${receipt.verdict.status})`);
  return receipt;
}

export function verdict(r) {
  const fails = [], warns = [];
  if (r.determinism.some((d) => !d.identical)) fails.push('non-deterministic frames');
  if (r.runtime_errors.length) fails.push(`${r.runtime_errors.length} runtime errors`);
  if (Object.keys(r.missing_glyphs || {}).length) fails.push('missing glyphs: ' + JSON.stringify(r.missing_glyphs));
  for (const c of [...(r.qa.layout.checks || []), ...(r.qa.pixels.checks || [])]) {
    if (c.status === 'fail') fails.push(`${c.id}: ${c.detail}`);
    else if (c.status === 'warn') warns.push(`${c.id}: ${c.detail}`);
  }
  return { status: fails.length ? 'fail' : warns.length ? 'pass-with-warnings' : 'pass', fails, warns };
}

export function ffprobe(file) {
  try {
    const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,pix_fmt,width,height,r_frame_rate,nb_frames,color_space,color_primaries,color_transfer:format=duration', '-of', 'json', file]).toString());
    return { duration: Number(j.format?.duration), streams: j.streams };
  } catch (e) {
    return { error: String(e.message || e).slice(0, 200) };
  }
}
