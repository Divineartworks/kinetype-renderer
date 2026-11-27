// `kinetype ambient ...` dispatch. See docs/AMBIENT.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as presets from './presets/index.js';
import * as R from './render.js';
import * as QA from './calmqa.js';
import { writeLoopManifest, sha256File } from './manifest.js';
import { randomize, breed } from './variation.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const num = (v, d) => (v === undefined || v === true ? d : Number(v));
const str = (v) => (typeof v === 'string' ? v : undefined);

/** Bad flags: the CLI exits 2 before any rendering starts. */
export class UsageError extends Error { constructor(m) { super(m); this.exitCode = 2; } }

/** A seed is a non-negative integer (it feeds a 32-bit PRNG). */
export function parseSeed(v, d = 1) {
  if (v === undefined) return d;
  const n = typeof v === 'number' ? v : (typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : NaN);
  if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) throw new UsageError(`--seed must be a non-negative integer (0 to 4294967295), got "${v}"`);
  return n;
}

export const AMBIENT_HELP = `  kinetype ambient list                    presets, their params and image needs
  kinetype ambient render <preset> [--seed N] [--loop 600] [--fps 30] [--res 1080|2160] [--images still,depth]
                  [--p0 a,b,c,d .. --p5 ..] [--params file.json] [--out DIR]
                                           loop master (10-bit HEVC, bt709 tagged) + seam check + calm QA on the
                                           encoded master + visual_loop.json + receipt.json; exit 2 when calm QA
                                           fails or the flags are invalid (e.g. a bad --seed)
  kinetype ambient clip <preset> --seconds S [--start T] [--step K] [--seed N] [--loop 600] [--out DIR]
                                           review clip (K > 1 = time-lapse)
  kinetype ambient sheet <preset> [--seeds 1-20] [--phase 0.37]   contact sheet of seeds
  kinetype ambient strip <preset> [--seed N]                      10 phases of one loop
  kinetype ambient qa <file.mp4> [--fps 30]                       calm QA numbers + gate for a clip
  kinetype ambient bench <preset> [--res 1080|2160]               GPU ms/frame and readback throughput
  kinetype ambient randomize [--count 5] [--seed 1] [--presets a,b]   deterministic random entries
  kinetype ambient breed <a.json> <b.json> [--seed 1]             child of two entries of one preset`;

function vec(s) {
  if (s === undefined || s === true) return undefined;
  const v = String(s).split(',').map(Number);
  if (v.length !== 4 || v.some((x) => !Number.isFinite(x))) throw new Error(`--p0..--p5 take 4 comma-separated numbers, got "${s}"`);
  return v;
}

function readEntry(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const e = Array.isArray(j) ? j[0] : j;
  if (!e?.preset) throw new Error(`${file}: expected {preset, seed, params}`);
  return e;
}

/** Common render options from CLI flags (an --params entry fills seed and params unless overridden). */
function optsFrom(preset, flags) {
  const entry = str(flags.params) ? readEntry(flags.params) : null;
  if (entry && entry.preset !== preset) throw new Error(`--params file is for ${entry.preset}, not ${preset}`);
  const meta = presets.metaOf(preset);
  const named = { ...(entry?.params || {}) };
  const raw = [vec(flags.p0), vec(flags.p1), vec(flags.p2), vec(flags.p3), vec(flags.p4), vec(flags.p5)];
  const p = presets.paramVectors(preset, named);
  raw.forEach((v, k) => { if (v) p[k] = v; });
  const images = str(flags.images) ? flags.images.split(',').map((f) => path.resolve(f)) : [];
  const rawParams = Object.fromEntries(raw.map((v, k) => [`p${k}`, v]).filter(([, v]) => v));
  return {
    preset, seed: parseSeed(flags.seed, entry?.seed ?? 1), width: num(flags.width), height: num(flags.height), loopSeconds: num(flags.loop, meta.loopSeconds), fps: num(flags.fps, 30),
    res: num(flags.res, 1080), images, p,
    manifestParams: { ...presets.defaultParams(preset), ...named, ...rawParams },
  };
}

const outDir = (flags, preset) => path.resolve(str(flags.out) || path.join(REPO, 'out', 'ambient', preset));

/**
 * Loop master + seam + calm QA on the ENCODED MASTER itself (decoded whole, 320x180) + manifest. The master is
 * encoded to `<name>.partial.mp4` and renamed only once everything succeeded; any failure deletes the partial
 * and writes no manifest. The manifest is written last, with the gate's status.
 */
export async function ambientRender(preset, flags, log = () => {}) {
  const o = optsFrom(preset, flags);
  const dir = outDir(flags, preset);
  fs.mkdirSync(dir, { recursive: true });
  const [, h] = R.sizeOf(o);
  const stem = `${preset}-s${o.seed}-loop${o.loopSeconds}s-${h}p`;
  const file = path.join(dir, `${stem}.mp4`);
  const partial = R.partialPath(file);
  const t0 = Date.now();
  log(`render loop ${stem}`);
  const base = { preset, seed: o.seed, loopSeconds: o.loopSeconds, fps: o.fps, res: o.res, width: o.width, height: o.height, images: o.images, p: o.p };
  try {
    const loop = await R.renderLoop({ ...base, out: partial });
    const tLoop = Date.now();
    log(`seam check`);
    const seam = await R.seamCheck(base);
    log(`calm QA on the encoded master`);
    const metrics = { ...(await QA.analyse(partial, { fps: o.fps })), clip: path.basename(file) };
    const analysed = { file: path.basename(file), sha256: await sha256File(partial), frames: metrics.frames };
    const expectedFrames = Math.round(o.loopSeconds * o.fps);
    const verdict = QA.gate(metrics, seam, { expectedFrames });
    const qa = { ...verdict, metrics, seam, limits: QA.LIMITS, analysed };
    const tEnd = Date.now();
    fs.renameSync(partial, file);
    const written = await writeLoopManifest({
      file, preset, seed: o.seed, params: o.manifestParams, stillPath: o.images[0], depthPath: o.images[1], loop, qa,
      args: process.argv.slice(2), ffmpeg: R.ffmpegVersion(),
      timings: { loop_ms: loop.ms, loop_wall_s: (tLoop - t0) / 1000, qa_wall_s: (tEnd - tLoop) / 1000, total_wall_s: (tEnd - t0) / 1000 },
    });
    if (written.manifest.sha256 !== analysed.sha256) throw new Error('master changed between analysis and manifest (sha256 mismatch)');
    return { status: qa.status, fails: qa.fails, file, manifest: written.manifestFile, receipt: written.receiptFile, loop_ms: loop.ms, total_s: (tEnd - t0) / 1000, metrics, seam, analysed };
  } catch (e) {
    fs.rmSync(partial, { force: true });
    throw e;
  }
}

export async function ambientCommand(pos, flags, out, log = (m) => console.error(m)) {
  try { return await dispatch(pos, flags, out, log); } catch (e) { if (e?.exitCode) process.exitCode = e.exitCode; throw e; }
}

async function dispatch(pos, flags, out, log) {
  const sub = pos[0];
  const preset = pos[1];
  switch (sub) {
    case 'list':
      return out(presets.list());
    case 'render': {
      const r = await ambientRender(preset, flags, log);
      if (r.status !== 'pass') process.exitCode = 2;
      return out(r);
    }
    case 'clip': {
      const o = optsFrom(preset, flags);
      const dir = outDir(flags, preset);
      const seconds = num(flags.seconds, 20), start = num(flags.start, 0), step = num(flags.step, 1);
      const [, h] = R.sizeOf(o);
      const file = path.join(dir, `${preset}-s${o.seed}-clip${seconds}s${step > 1 ? `-x${step}` : ''}-${h}p.mp4`);
      const r = await R.renderClip({ ...o, out: file, seconds, start, step });
      return out({ file: r.file, frames: r.frames, ms: r.ms });
    }
    case 'sheet': {
      const o = optsFrom(preset, flags);
      const [a, b] = (str(flags.seeds) || '1-20').split('-').map(Number);
      const seeds = Array.from({ length: b - a + 1 }, (_, i) => a + i);
      const file = path.join(outDir(flags, preset), `${preset}-sheet.png`);
      const r = await R.renderSheet({ ...o, out: file, seeds, phase: num(flags.phase, 0.37) });
      return out({ file: r.file, seeds });
    }
    case 'strip': {
      const o = optsFrom(preset, flags);
      const file = path.join(outDir(flags, preset), `${preset}-s${o.seed}-strip.png`);
      const r = await R.renderStrip({ ...o, out: file });
      return out({ file: r.file });
    }
    case 'qa': {
      if (!preset) throw new Error('usage: kinetype ambient qa <file.mp4>');
      const metrics = await QA.analyse(path.resolve(preset), { fps: num(flags.fps) });
      const verdict = QA.gate(metrics, null, { requireSeam: false });
      if (verdict.status !== 'pass') process.exitCode = 2;
      return out({ ...verdict, metrics, limits: QA.LIMITS });
    }
    case 'bench': {
      const o = optsFrom(preset, flags);
      return out(await R.bench(o));
    }
    case 'randomize':
      return out(randomize({ count: num(flags.count, 5), seed: parseSeed(flags.seed, 1), presets: str(flags.presets)?.split(',') }));
    case 'breed': {
      if (!pos[1] || !pos[2]) throw new Error('usage: kinetype ambient breed <a.json> <b.json> [--seed N]');
      return out(breed(readEntry(pos[1]), readEntry(pos[2]), num(flags.seed, 1)));
    }
    default:
      out(AMBIENT_HELP);
      if (sub && sub !== 'help') process.exitCode = 1;
  }
}
