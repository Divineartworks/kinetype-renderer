// Calm QA for ambient loops: numbers from a decoded clip plus a pass/fail gate.
// Port of the prototype's metrics.py (no numpy): the clip is decoded to 320x180 and measured in streaming
// fashion, so the length of the clip does not matter for memory.
import { spawn, execFileSync } from 'node:child_process';

const FFMPEG = process.env.KINETYPE_FFMPEG || 'ffmpeg';
const FFPROBE = process.env.KINETYPE_FFPROBE || 'ffprobe';
const W = 320, H = 180, TILES = 4;

/**
 * Gate limits. The loops are watched for sleep and meditation, so we are stricter than WCAG 2.3.1
 * (which allows up to 3 flashes per second): no flash pair at all, and nothing that moves quickly.
 */
export const LIMITS = {
  flashPairs: 0,            // opposing >= 10 % luminance swings within 1 s, per 4x4 tile
  redFlashPairs: 0,         // same idea on the saturated-red share
  lumRatePerS: 0.02,        // largest change of mean luminance over any 1 s window (0-1 units)
  motionMean: 2.0,          // mean absolute frame-to-frame difference (8-bit units), real-time clip
  seamFactor: 1.5,          // acrossSeam <= seamFactor * max(beforeSeam, afterSeam) + seamSlack
  seamSlack: 0.02,
  swing: 0.10,              // WCAG general flash: change of >= 10 % of the MAXIMUM relative luminance (which is 1.0), i.e. 0.10 absolute
  redSaturation: 0.8,       // R / (R + G + B) at or above this is "saturated red" (linear light)
  redSwing: 20 / 320,       // WCAG red flash: (R - G - B) * 320 changes by more than 20 units, i.e. 0.0625 in linear (R - G - B)
  minSeconds: 2,            // shorter clips are not judged
  lowerStateBelow: 0.80,    // WCAG: the darker state of a flash must be below this relative luminance
};

// 8-bit sRGB -> linear light (the WCAG relative-luminance definition uses the sRGB piecewise curve).
const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }

function probeFps(file) {
  const r = execFileSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', file], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  const [a, b] = r.split('/').map(Number);
  const fps = b ? a / b : a;
  if (!(fps > 0)) throw new Error(`cannot read frame rate of ${file}`);
  return fps;
}

/**
 * Zigzag over a series: swings of at least `th` between successive extremes. Returns the number of
 * flash pairs: two opposing swings that together fit in `win` frames (and whose darker state is
 * below `lowerBelow`, or any state when lowerBelow is null).
 */
export function flashPairs(series, th, win, lowerBelow = null) {
  const n = series.length;
  if (n < 2) return 0;
  const sw = [];                      // { start, end, a, b } extremes (indices and values)
  let dir = 0, lo = 0, hi = 0, start = 0, ext = 0;
  for (let i = 1; i < n; i++) {
    const v = series[i];
    if (dir === 0) {
      if (v < series[lo]) lo = i;
      if (v > series[hi]) hi = i;
      if (v - series[lo] >= th) { dir = 1; start = lo; ext = i; }
      else if (series[hi] - v >= th) { dir = -1; start = hi; ext = i; }
    } else if (dir === 1) {
      if (v > series[ext]) ext = i;
      else if (series[ext] - v >= th) { sw.push({ start, end: ext }); start = ext; dir = -1; ext = i; }
    } else {
      if (v < series[ext]) ext = i;
      else if (v - series[ext] >= th) { sw.push({ start, end: ext }); start = ext; dir = 1; ext = i; }
    }
  }
  if (dir !== 0) sw.push({ start, end: ext });
  let pairs = 0;
  for (let k = 0; k + 1 < sw.length; k++) {
    if (sw[k + 1].end - sw[k].start > win) continue;
    if (lowerBelow !== null && Math.min(series[sw[k].start], series[sw[k].end], series[sw[k + 1].end]) >= lowerBelow) continue;
    pairs++;
  }
  return pairs;
}

function percentile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

/** Decode `file` at 320x180 and measure it. */
export async function analyse(file, { fps } = {}) {
  const rate = fps || probeFps(file);
  const FRAME = W * H * 3;
  const tw = W / TILES, th = H / TILES;
  const apl = [], motion = [];
  const lumTiles = Array.from({ length: TILES * TILES }, () => []);
  const redTiles = Array.from({ length: TILES * TILES }, () => []);
  let prev = null, cur = new Uint8Array(W * H);
  const lumAcc = new Float64Array(TILES * TILES), redAcc = new Float64Array(TILES * TILES);

  const processFrame = (buf) => {
    lumAcc.fill(0); redAcc.fill(0);
    let sum = 0, diff = 0;
    for (let y = 0; y < H; y++) {
      const trow = Math.floor(y / th) * TILES;
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 3;
        const r = buf[o], g = buf[o + 1], b = buf[o + 2];
        const gray = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
        cur[y * W + x] = gray;
        const rl = LIN[r], gl = LIN[g], bl = LIN[b];
        const l = 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;   // relative luminance
        sum += l;
        const t = trow + Math.floor(x / tw);
        lumAcc[t] += l;
        const tot = rl + gl + bl;
        if (tot > 0 && rl / tot >= LIMITS.redSaturation) redAcc[t] += Math.max(0, rl - gl - bl);   // (R - G - B), scaled by 320 in the WCAG note; LIMITS.redSwing is the 20/320 threshold
        if (prev) diff += Math.abs(gray - prev[y * W + x]);
      }
    }
    apl.push(sum / (W * H));
    if (prev) motion.push(diff / (W * H));
    const area = tw * th;
    for (let t = 0; t < TILES * TILES; t++) { lumTiles[t].push(lumAcc[t] / area); redTiles[t].push(redAcc[t] / area); }
    const swap = prev || new Uint8Array(W * H);
    prev = cur; cur = swap;
  };

  const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', file, '-an', '-vf', `scale=${W}:${H}:flags=area,format=rgb24`, '-f', 'rawvideo', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  p.stderr.on('data', (c) => { err += c; });
  let pendingBuf = Buffer.alloc(0);
  p.stdout.on('data', (chunk) => {
    pendingBuf = pendingBuf.length ? Buffer.concat([pendingBuf, chunk]) : chunk;
    while (pendingBuf.length >= FRAME) { processFrame(pendingBuf.subarray(0, FRAME)); pendingBuf = pendingBuf.subarray(FRAME); }
  });
  await new Promise((res, rej) => p.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg decode failed (${c}): ${err.trim()}`)))));

  const n = apl.length;
  if (!n) throw new Error(`no frames decoded from ${file}`);
  const win = Math.max(1, Math.round(rate));
  let lumRate = null;   // largest change of mean luminance over any 1 s window; needs a clip longer than 1 s
  if (n > win) { lumRate = 0; for (let i = 0; i + win < n; i++) lumRate = Math.max(lumRate, Math.abs(apl[i + win] - apl[i])); }
  let flash = 0, redFlash = 0;
  for (let t = 0; t < TILES * TILES; t++) {
    flash = Math.max(flash, flashPairs(lumTiles[t], LIMITS.swing, win, LIMITS.lowerStateBelow));
    redFlash = Math.max(redFlash, flashPairs(redTiles[t], LIMITS.redSwing, win));
  }
  const sorted = [...motion].sort((a, b) => a - b);
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  return {
    clip: file.split('/').pop(), frames: n, fps: round(rate, 3),
    apl_mean: round(mean(apl), 4), apl_max: round(Math.max(...apl), 4),
    lum_rate_per_s: lumRate === null ? null : round(lumRate, 5),
    motion_mean: round(mean(motion), 4), motion_p99: round(percentile(sorted, 0.99), 4),
    flash_pairs: flash, red_flash_pairs: redFlash,
  };
}

/**
 * Pass/fail on the metrics of a real-time file and the loop's seam check ({ beforeSeam, acrossSeam, afterSeam,
 * frameNequalsFrame0 }). Fails closed: missing or non-finite metrics, a clip shorter than 2 s, a missing seam
 * (unless `requireSeam: false`, for the bare `qa` command) or a decoded frame count different from
 * `expectedFrames` are failures, never passes. Returns { status: 'pass' | 'fail', fails: [...] }.
 */
export function gate(metrics, seam, { requireSeam = true, expectedFrames } = {}) {
  const fails = [];
  const m = metrics || {};
  const num = (k) => { const v = m[k]; if (typeof v !== 'number' || !Number.isFinite(v)) { fails.push(`metric ${k} missing or not finite (${v})`); return null; } return v; };
  const flash = num('flash_pairs'), red = num('red_flash_pairs'), lum = num('lum_rate_per_s'), mot = num('motion_mean');
  const frames = num('frames'), fps = num('fps');
  if (frames !== null && fps !== null && frames < LIMITS.minSeconds * fps) fails.push(`clip too short: ${frames} frames < ${LIMITS.minSeconds * fps} (${LIMITS.minSeconds} s at ${fps} fps)`);
  if (expectedFrames !== undefined && frames !== expectedFrames) fails.push(`decoded ${frames} frames, expected ${expectedFrames}`);
  if (flash !== null && flash > LIMITS.flashPairs) fails.push(`flash_pairs ${flash} > ${LIMITS.flashPairs}`);
  if (red !== null && red > LIMITS.redFlashPairs) fails.push(`red_flash_pairs ${red} > ${LIMITS.redFlashPairs}`);
  if (lum !== null && lum > LIMITS.lumRatePerS) fails.push(`lum_rate_per_s ${lum} > ${LIMITS.lumRatePerS}`);
  if (mot !== null && mot > LIMITS.motionMean) fails.push(`motion_mean ${mot} > ${LIMITS.motionMean}`);
  if (!seam) {
    if (requireSeam) fails.push('seam check missing');
  } else {
    const ok = ['beforeSeam', 'acrossSeam', 'afterSeam'].every((k) => typeof seam[k] === 'number' && Number.isFinite(seam[k]));
    if (!ok) fails.push('seam metrics missing or not finite');
    if (seam.frameNequalsFrame0 !== true) fails.push(`seam: frame N is not frame 0${seam.frameNmaxDiff !== undefined ? ` (max diff ${seam.frameNmaxDiff})` : ''}`);
    if (ok) {
      const lim = LIMITS.seamFactor * Math.max(seam.beforeSeam, seam.afterSeam) + LIMITS.seamSlack;
      if (!(seam.acrossSeam <= lim)) fails.push(`seam: acrossSeam ${round(seam.acrossSeam, 4)} > ${round(lim, 4)}`);
    }
  }
  return { status: fails.length ? 'fail' : 'pass', fails };
}
