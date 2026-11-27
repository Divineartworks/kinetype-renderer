// visual_loop/v1 manifest + render receipt next to a loop master.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as presets from './presets/index.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FFPROBE = process.env.KINETYPE_FFPROBE || 'ffprobe';

const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();

export function gitSha() {
  try { return git('rev-parse', 'HEAD').trim(); } catch { return 'unknown'; }
}

/** True when tracked files differ from HEAD (the render ran with local edits); null when git is unavailable. */
export function gitDirty() {
  try { return git('status', '--porcelain', '--untracked-files=no').trim().length > 0; } catch { return null; }
}

/** Streaming sha256 (masters can be gigabytes; never reads the whole file into memory). */
export function sha256File(f, { highWaterMark = 1 << 20 } = {}) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(f, { highWaterMark }).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

/** What the file really is, from ffprobe: frames, duration, pix_fmt, colour tags, audio stream count. */
export function probeFile(file) {
  const j = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-count_packets', '-show_entries',
    'stream=codec_type,codec_name,pix_fmt,width,height,r_frame_rate,nb_read_packets,color_space,color_primaries,color_transfer,color_range:format=duration',
    '-of', 'json', file], { stdio: ['ignore', 'pipe', 'pipe'] }).toString());
  const v = (j.streams || []).find((s) => s.codec_type === 'video');
  if (!v) throw new Error(`no video stream in ${file}`);
  return {
    codec_name: v.codec_name, pix_fmt: v.pix_fmt, width: v.width, height: v.height,
    frames: Number(v.nb_read_packets), duration_s: Number(j.format?.duration),
    audio_streams: (j.streams || []).filter((s) => s.codec_type === 'audio').length,
    color_space: v.color_space ?? null, color_primaries: v.color_primaries ?? null, color_transfer: v.color_transfer ?? null, color_range: v.color_range ?? null,
  };
}

/**
 * Writes `<out minus .mp4>.receipt.json` and then `.visual_loop.json` (the manifest is written last). `loop` is
 * renderLoop's result; `qa` is { status, fails, metrics, seam, limits, analysed: { file, sha256, frames } };
 * `stillPath` / `depthPath` are the living-still inputs (hashed).
 */
export async function writeLoopManifest({ file, preset, seed, params = {}, stillPath, depthPath, loop, qa, args = [], timings = {}, extraReceipt = {}, ffmpeg = 'unknown' }) {
  const meta = presets.metaOf(preset);
  const base = file.replace(/\.[^.]+$/, '');
  const manifestFile = `${base}.visual_loop.json`;
  const receiptFile = `${base}.receipt.json`;
  const mode = meta.family === 'living-still' ? 'living_still' : 'generative_loop';
  const probe = probeFile(file);
  const sha256 = await sha256File(file);
  const inputs = [];
  for (const [role, f] of [['still', stillPath], ['depth', depthPath]]) if (f) inputs.push({ role, file: path.basename(f), sha256: await sha256File(f) });
  const inputSha = (role) => inputs.find((i) => i.role === role)?.sha256 ?? null;
  const receipt = {
    schema: 'visual_loop_receipt/v1',
    kinetype_git_sha: gitSha(),
    kinetype_dirty: gitDirty(),
    preset,
    frag_sha256: presets.fragSha256(preset),   // COMMON + FRAG, the exact source that was compiled
    seed,
    args,
    timings,
    renderer: loop.renderer,
    chrome: loop.chrome ?? null,
    ffmpeg,
    encoder: loop.codec,
    inputs,
    probe,
    analysed: qa.analysed ?? null,
    metrics: qa.metrics,
    seam: qa.seam,
    calm_qa: { status: qa.status, fails: qa.fails },
    ...extraReceipt,
  };
  const manifest = {
    schema: 'visual_loop/v1',
    preset,
    seed,
    mode,
    ...(mode === 'living_still' ? { still_sha256: inputSha('still'), depth_sha256: inputSha('depth') } : {}),
    file: path.basename(file),
    sha256,
    frames: probe.frames,
    duration_s: probe.duration_s,
    loop_s: probe.frames / loop.fps,
    width: loop.width,
    height: loop.height,
    fps: loop.fps,
    pix_fmt: loop.pixFmt,
    codec: loop.codec === 'libx265' || loop.codec === 'hevc_videotoolbox' ? 'hevc' : loop.codec,
    color_space: probe.color_space,
    color_primaries: probe.color_primaries,
    color_transfer: probe.color_transfer,
    color_range: probe.color_range,
    params,
    calm_qa: { status: qa.status, report: { fails: qa.fails, metrics: qa.metrics, seam: qa.seam, limits: qa.limits, analysed: qa.analysed ?? null } },
    receipt: path.basename(receiptFile),
  };
  fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2) + '\n');
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  return { manifestFile, receiptFile, manifest, receipt };
}
