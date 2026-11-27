// kinetype-capability: readable/1  (plan.readable / win.readable are passed to the template as params.readable; the app's bridge probes the marker before it stamps plan.readable)
// compose: a caption PLAN (kinetype direct) → the finished video.
//
// kinetype renders ONLY its windows (hook, spike moments, full) and the cold
// open, from the clean source video; everything else stays exactly as the
// base video has it (e.g. the normal captions of another engine). On the way:
//   align  — the base's time offset against the source is measured, not assumed
//   grade  — the base's colour grade is fitted as a 3D LUT and applied to the
//            footage kinetype renders, so seams are invisible
//   splice — windows are overlaid frame-exactly with alpha crossfades inside
//            the speaker's own pauses; the cold open is prepended with a dip,
//            its audio cut from the BASE's final mix
//   verify — untouched frames are compared to the base, windows must differ,
//            seams must return to the base; a review sheet is written
import { cleanVerdictOfRender } from '../../templates/kinetic-captions/personclean.js';
import { READABLE_LOOKS } from '../../templates/kinetic-captions/looks/readable.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { ROOT } from './server.js';
import { loadWords, autoExposure } from './captions.js';

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

function probe(file) {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate,sample_rate,pix_fmt,color_range,color_space,color_transfer,color_primaries,bit_rate:format=duration,bit_rate', '-of', 'json', file], { cwd: ROOT }).toString());
  const v = j.streams.find((s) => s.codec_type === 'video');
  const [a, b] = (v?.r_frame_rate || '30/1').split('/').map(Number);
  const full = v?.color_range === 'pc' || /^yuvj/.test(v?.pix_fmt || '');
  const matrix = v?.color_space === 'bt709' ? 'bt709' : 'bt601'; // ffmpeg's own default for untagged/SD-tagged video
  return { w: v?.width, h: v?.height, fps: b ? a / b : a, duration: Number(j.format.duration), audio: j.streams.some((s) => s.codec_type === 'audio'), vbitrate: Number(v?.bit_rate || j.format.bit_rate || 0),
    color: { full, matrix, space: v?.color_space, transfer: v?.color_transfer, primaries: v?.color_primaries } };
}

/** Raw frames (rgb24 or gray) at times[] scaled to w×h, optional top crop fraction. */
/** ffmpeg crop expression for a framing transform {x, y, w, h} (fractions of the source). */
export const cropExpr = (fr) => (fr ? `crop=iw*${fr.w.toFixed(5)}:ih*${fr.h.toFixed(5)}:iw*${fr.x.toFixed(5)}:ih*${fr.y.toFixed(5)},` : '');
function grab(file, t, { w, h, crop = 1, pix = 'rgb24', frame = null }) {
  const vf = `${cropExpr(frame)}${crop < 1 ? `crop=iw:ih*${crop}:0:0,` : ''}scale=${w}:${h}:flags=area,format=${pix}`;
  return execFileSync('ffmpeg', ['-v', 'error', '-ss', t.toFixed(4), '-i', file, '-frames:v', '1', '-vf', vf, '-f', 'rawvideo', '-'], { cwd: ROOT, maxBuffer: 1 << 26 });
}
/** A run of consecutive frames (gray) from t0 for `sec` seconds at fps, top-cropped. */
function grabRun(file, t0, sec, fps, { w = 24, h = 24, crop = 0.55, frame = null } = {}) {
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t0), '-i', file, '-t', String(sec), '-vf', `fps=${fps},${cropExpr(frame)}crop=iw:ih*${crop}:0:0,scale=${w}:${h}:flags=area,format=gray`, '-f', 'rawvideo', '-'], { cwd: ROOT, maxBuffer: 1 << 28 });
  const n = w * h, out = [];
  for (let k = 0; k + n <= buf.length; k += n) {
    const f = new Float32Array(n);
    let m = 0;
    for (let i = 0; i < n; i++) { f[i] = buf[k + i]; m += f[i]; }
    m /= n;
    let s = 0;
    for (let i = 0; i < n; i++) { f[i] -= m; s += f[i] * f[i]; }
    s = Math.sqrt(s) || 1;
    for (let i = 0; i < n; i++) f[i] /= s;
    out.push(f);
  }
  return out;
}

/**
 * Time offset of `base` against `src` (base time = src time + offset), from
 * frame-structure correlation of the top of the picture (captions live low).
 * Grade changes don't matter: every frame is mean-removed and normalised.
 */
export function alignOffset(src, base, fps, { maxLag = 3, span = 30, frame = null } = {}) {
  const sec = Math.min(span, probe(src).duration - 1);
  const A = grabRun(src, 0, sec, fps, { frame }), B = grabRun(base, 0, sec + maxLag, fps);
  const L = Math.round(maxLag * fps);
  let best = { lag: 0, score: -1 }, second = -1;
  for (let lag = -L; lag <= L; lag++) {
    let acc = 0, n = 0;
    for (let i = 0; i < A.length; i++) {
      const j = i + lag;
      if (j < 0 || j >= B.length) continue;
      let d = 0;
      const a = A[i], b = B[j];
      for (let k = 0; k < a.length; k++) d += a[k] * b[k];
      acc += d; n++;
    }
    const s = n > A.length * 0.5 ? acc / n : -1;
    if (s > best.score) { second = best.score; best = { lag, score: s }; } else if (s > second) second = s;
  }
  return { offset: best.lag / fps, frames: best.lag, score: +best.score.toFixed(4), margin: +(best.score - second).toFixed(4) };
}

/**
 * Framing of the base against the source: the base may be a reframe (crop +
 * zoom) of the source. Search uniform zoom s∈[1, 1.45] and position on a few
 * frame pairs (top 60% of the picture: captions live low), coarse → fine.
 * Returns {x, y, w, h} as fractions of the source, or null for identity.
 */
export function alignFraming(src, base, { times = [0.2, 0.4, 0.6, 0.8], at = null, offset = 0 } = {}) {
  const sd = probe(src).duration, bd = probe(base).duration;
  const SW = 180, SH = 320, BW = 60, BH = 107, rows = Math.round(BH * 0.6);
  const pairs = (at || times).map((f) => {
    const t = at ? f : Math.max(0.5, Math.min(sd, bd - offset) * f);
    const a = grab(src, t, { w: SW, h: SH, pix: 'gray' }), b = grab(base, t + offset, { w: BW, h: BH, pix: 'gray' });
    const bv = Float32Array.from(b.subarray(0, BW * rows));
    const m = bv.reduce((x, y) => x + y, 0) / bv.length;
    let q = 0; for (let i = 0; i < bv.length; i++) { bv[i] -= m; q += bv[i] * bv[i]; }
    q = Math.sqrt(q) || 1; for (let i = 0; i < bv.length; i++) bv[i] /= q;
    return { a, bv };
  });
  const score = (s, x, y) => {
    const w = 1 / s, h = 1 / s;
    let tot = 0;
    const sv = new Float32Array(BW * rows);
    for (const { a, bv } of pairs) {
      let m = 0;
      for (let r = 0; r < rows; r++) for (let c = 0; c < BW; c++) {
        const u = (x + (c + 0.5) / BW * w) * SW - 0.5, v = (y + (r + 0.5) / BH * h) * SH - 0.5;
        const u0 = Math.max(0, Math.min(SW - 2, Math.floor(u))), v0 = Math.max(0, Math.min(SH - 2, Math.floor(v))), du = Math.min(1, Math.max(0, u - u0)), dv = Math.min(1, Math.max(0, v - v0));
        const val = a[v0 * SW + u0] * (1 - du) * (1 - dv) + a[v0 * SW + u0 + 1] * du * (1 - dv) + a[(v0 + 1) * SW + u0] * (1 - du) * dv + a[(v0 + 1) * SW + u0 + 1] * du * dv;
        sv[r * BW + c] = val; m += val;
      }
      m /= sv.length;
      let q = 0, d = 0;
      for (let i = 0; i < sv.length; i++) { const z = sv[i] - m; q += z * z; d += z * bv[i]; }
      tot += d / (Math.sqrt(q) || 1);
    }
    return tot / pairs.length;
  };
  let best = { s: 1, x: 0, y: 0, v: score(1, 0, 0) };
  const identity = best.v;
  for (let s = 1.0; s <= 1.451; s += 0.025) {
    const span = 1 - 1 / s;
    const steps = Math.max(1, Math.round(span / 0.01));
    for (let i = 0; i <= steps; i++) for (let j = 0; j <= steps; j++) {
      const x = span * i / steps, y = span * j / steps;
      const v = score(s, x, y);
      if (v > best.v) best = { s, x, y, v };
    }
  }
  // refine around the best
  for (let s = best.s - 0.02; s <= best.s + 0.0201; s += 0.005) {
    if (s < 1) continue;
    const span = 1 - 1 / s;
    for (let dx = -0.012; dx <= 0.0121; dx += 0.003) for (let dy = -0.012; dy <= 0.0121; dy += 0.003) {
      const x = Math.min(span, Math.max(0, best.x + dx)), y = Math.min(span, Math.max(0, best.y + dy));
      const v = score(s, x, y);
      if (v > best.v) best = { s, x, y, v };
    }
  }
  const frame = best.s > 1.004 ? { x: best.x, y: best.y, w: 1 / best.s, h: 1 / best.s } : null;
  return { frame, zoom: +best.s.toFixed(4), score: +best.v.toFixed(4), identity: +identity.toFixed(4) };
}

/**
 * Where one window of the source sits in the base: its own time offset and
 * framing. Bases can be re-edited (punch-ins, trimmed silences), so a single
 * global offset is not enough. Time is found by correlating MOTION (frame
 * differences), which peaks sharply even on a near-static talking head.
 */
export function alignWindow(src, base, t0, t1, fps, { guess = 0, maxLag = 4, frame = null } = {}) {
  const fr = alignFraming(src, base, { at: [t0 + (t1 - t0) * 0.25, (t0 + t1) / 2, t0 + (t1 - t0) * 0.75], offset: guess });
  const useFrame = fr.frame && fr.score > fr.identity + 0.04 ? fr.frame : frame;
  const dur = Math.max(0.5, t1 - t0);
  const A = grabRun(src, t0, dur, fps, { frame: useFrame, crop: 0.6, w: 32, h: 32 });
  const bs = Math.max(0, t0 + guess - maxLag);
  const B = grabRun(base, bs, dur + 2 * maxLag, fps, { crop: 0.6, w: 32, h: 32 });
  const diff = (F) => F.slice(1).map((f, i) => { const d = new Float32Array(f.length); let q = 0; for (let k = 0; k < f.length; k++) { d[k] = f[k] - F[i][k]; q += d[k] * d[k]; } q = Math.sqrt(q) || 1; for (let k = 0; k < f.length; k++) d[k] /= q; return d; });
  const dA = diff(A), dB = diff(B);
  let best = { L: 0, v: -Infinity };
  for (let L = 0; L + dA.length <= dB.length; L++) {
    let acc = 0, still = 0;
    for (let i = 0; i < dA.length; i++) {
      const a = dA[i], b = dB[i + L];
      let d = 0; for (let k = 0; k < a.length; k++) d += a[k] * b[k];
      acc += d;
      // plus the frames themselves (static structure) so a still shot still aligns
      let e = 0; const fa = A[i + 1], fb = B[i + 1 + L]; for (let k = 0; k < fa.length; k++) e += fa[k] * fb[k];
      still += e;
    }
    const v = (acc + still) / (2 * dA.length);
    if (v > best.v) best = { L, v };
  }
  const offset = bs + best.L / fps - t0;
  // framing again at the found time, then a structure score for the verdict
  let S = 0;
  for (let i = 0; i < A.length; i++) { const fa = A[i], fb = B[i + best.L]; if (!fb) continue; let e = 0; for (let k = 0; k < fa.length; k++) e += fa[k] * fb[k]; S += e; }
  return { offset: Math.round(offset * fps) / fps, score: +(S / A.length).toFixed(4), motion: +best.v.toFixed(4), frame: useFrame, zoom: fr.zoom };
}

/**
 * The grade of a compose that has no base and no plan.grade: kinetype's auto exposure (brightness fitted to the source, contrast 1.06,
 * saturation 0.96). A plan that asks for personClean (looks behind him) NEVER gets it: personClean re-draws him through this grade, so it
 * would relight and re-saturate his face (measured on the eval take 7edcca5c: skin L +17, the person check 23-31 against its limit of 6).
 * Identity there; the plan's own grade or a base's grade-match LUT still apply as before.
 */
export function fallbackGrade(plan, auto, windows = []) {
  if ((plan && plan.personClean === true) || (windows || []).some((w) => w && w.personClean === true)) return { exposure: 1, contrast: 1, saturation: 1 };
  return { exposure: auto(), contrast: 1.06, saturation: 0.96 };
}

// ── grade match: fit a 17³ LUT that maps the source's colours to the base's ──
const N3 = 17;
function affineFit(pairs) {
  // least squares out_c = [r g b 1]·β_c, via 4×4 normal equations
  const XtX = Array.from({ length: 4 }, () => new Float64Array(4)), XtY = Array.from({ length: 3 }, () => new Float64Array(4));
  for (const [r, g, b, R, G, B] of pairs) {
    const x = [r, g, b, 1], y = [R, G, B];
    for (let i = 0; i < 4; i++) { for (let j = 0; j < 4; j++) XtX[i][j] += x[i] * x[j]; for (let c = 0; c < 3; c++) XtY[c][i] += x[i] * y[c]; }
  }
  const solve = (M, v) => {
    const a = M.map((row, i) => [...row, v[i]]);
    for (let i = 0; i < 4; i++) {
      let p = i; for (let r = i + 1; r < 4; r++) if (Math.abs(a[r][i]) > Math.abs(a[p][i])) p = r;
      [a[i], a[p]] = [a[p], a[i]];
      const d = a[i][i] || 1e-9;
      for (let j = i; j < 5; j++) a[i][j] /= d;
      for (let r = 0; r < 4; r++) if (r !== i) { const f = a[r][i]; for (let j = i; j < 5; j++) a[r][j] -= f * a[i][j]; }
    }
    return a.map((row) => row[4]);
  };
  const beta = XtY.map((v) => solve(XtX, v));
  return (r, g, b) => beta.map((bb) => bb[0] * r + bb[1] * g + bb[2] * b + bb[3]);
}
function lutApply(lut, r, g, b) {
  // trilinear lookup (inputs 0..1)
  const f = (x) => Math.min(N3 - 1 - 1e-6, Math.max(0, x * (N3 - 1)));
  const R = f(r), G = f(g), B = f(b);
  const r0 = Math.floor(R), g0 = Math.floor(G), b0 = Math.floor(B), dr = R - r0, dg = G - g0, db = B - b0;
  const out = [0, 0, 0];
  for (let k = 0; k < 8; k++) {
    const ir = r0 + (k & 1), ig = g0 + ((k >> 1) & 1), ib = b0 + ((k >> 2) & 1);
    const w = (k & 1 ? dr : 1 - dr) * ((k >> 1) & 1 ? dg : 1 - dg) * ((k >> 2) & 1 ? db : 1 - db);
    const idx = (ib * N3 * N3 + ig * N3 + ir) * 3;
    out[0] += lut[idx] * w; out[1] += lut[idx + 1] * w; out[2] += lut[idx + 2] * w;
  }
  return out;
}
export function fitGrade(src, base, offset, { samples = 24, fps = 30, tailGuard = 6, frame = null, at = null } = {}) {
  const ds = probe(src).duration, db = probe(base).duration;
  const t1 = Math.min(ds, db - offset) - tailGuard; // the base may end on a brand card
  const W = 72, H = 72, crop = 0.55;
  const fitPairs = [], testPairs = [];
  // `at`: explicit aligned sample points [{ts, tb, frame}] (re-edited bases)
  const pts = at || Array.from({ length: samples }, (_, k) => { const t = 1 + (t1 - 1) * (k + 0.5) / samples; return { ts: t, tb: t + offset, frame }; });
  for (let k = 0; k < pts.length; k++) {
    const tb = Math.round(pts[k].tb * fps) / fps, ts = Math.round(pts[k].ts * fps) / fps;
    const a = grab(src, ts, { w: W, h: H, crop, frame: pts[k].frame }), b = grab(base, tb, { w: W, h: H, crop });
    const into = k % 2 ? testPairs : fitPairs;
    for (let i = 0; i + 2 < a.length; i += 3) into.push([a[i] / 255, a[i + 1] / 255, a[i + 2] / 255, b[i] / 255, b[i + 1] / 255, b[i + 2] / 255]);
  }
  // robust affine (drop the worst 6%: caption strokes, overlays), then per-bin residuals
  let aff = affineFit(fitPairs);
  const resid = (p) => { const q = aff(p[0], p[1], p[2]); return Math.abs(q[0] - p[3]) + Math.abs(q[1] - p[4]) + Math.abs(q[2] - p[5]); };
  const sorted = fitPairs.map((p) => resid(p)).sort((x, y) => x - y);
  const cut = sorted[Math.floor(sorted.length * 0.94)];
  const kept = fitPairs.filter((p) => resid(p) <= cut);
  aff = affineFit(kept);
  const sum = new Float64Array(N3 * N3 * N3 * 3), cnt = new Float64Array(N3 * N3 * N3);
  const bi = (x) => Math.min(N3 - 1, Math.max(0, Math.round(x * (N3 - 1))));
  for (const p of kept) {
    const q = aff(p[0], p[1], p[2]);
    const i = bi(p[2]) * N3 * N3 + bi(p[1]) * N3 + bi(p[0]);
    sum[i * 3] += p[3] - q[0]; sum[i * 3 + 1] += p[4] - q[1]; sum[i * 3 + 2] += p[5] - q[2]; cnt[i]++;
  }
  const lut = new Float32Array(N3 * N3 * N3 * 3);
  for (let b = 0; b < N3; b++) for (let g = 0; g < N3; g++) for (let r = 0; r < N3; r++) {
    const i = b * N3 * N3 + g * N3 + r;
    const q = aff(r / (N3 - 1), g / (N3 - 1), b / (N3 - 1));
    const w = cnt[i] / (cnt[i] + 12);
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = Math.min(1, Math.max(0, q[c] + (cnt[i] ? (sum[i * 3 + c] / cnt[i]) * w : 0)));
  }
  const mae = (fn) => { let e = 0; for (const p of testPairs) { const q = fn(p); e += Math.abs(q[0] - p[3]) + Math.abs(q[1] - p[4]) + Math.abs(q[2] - p[5]); } return +(e / testPairs.length / 3 * 255).toFixed(2); };
  return { lut, before: mae((p) => [p[0], p[1], p[2]]), after: mae((p) => lutApply(lut, p[0], p[1], p[2])), pairs: kept.length };
}
function writeCube(lut, file) {
  const lines = ['TITLE "kinetype grade match"', `LUT_3D_SIZE ${N3}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
  for (let i = 0; i < N3 * N3 * N3; i++) lines.push(`${lut[i * 3].toFixed(6)} ${lut[i * 3 + 1].toFixed(6)} ${lut[i * 3 + 2].toFixed(6)}`);
  fs.writeFileSync(file, lines.join('\n') + '\n');
}

/** Hash of everything that decides how a window looks (templates + engine). */
function codeHash() {
  const files = [];
  const walk = (d) => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p); else if (n.endsWith('.js')) files.push(p); } };
  walk(path.join(ROOT, 'templates', 'kinetic-captions'));
  walk(path.join(ROOT, 'src', 'kit'));
  return sha(files.sort().map((f) => fs.readFileSync(f)).join('\n')).slice(0, 16);
}

function run(cmd, args, { log } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; if (err.length > 20000) err = err.slice(-10000); });
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${err.slice(-1500)}`))));
  });
}

/** A kinetic-captions spec for one window of the plan. */
// Looks whose layout can be zoned on a letterboxed base (see kinetic-captions `params.zones`): the giant hero word in the top
// bar, the caption block in the bottom bar, the picture untouched. Every other look is rendered on the picture only.
// (poster is not one of them: its torn-paper wall is a full-frame collage of the words, which covers the picture.)
export const ZONE_LOOKS = new Set(['marker', 'cover']);
const ZONE_MARGIN_PX = 26, ZONE_BOTTOM = 0.86; // clearance to the picture at 1920 high; the platform UI covers the last ~12%
export const zonesFor = (pic, baseH) => {
  const m = ZONE_MARGIN_PX * baseH / 1920;
  const top = [0, +((pic.y0 - m) / baseH).toFixed(5)], bottom = [+((pic.y1 + m) / baseH).toFixed(5), ZONE_BOTTOM];
  return top[1] > 0.15 && bottom[1] - bottom[0] > 0.1 ? { top, bottom } : null;
};

// kinetype-capability: personClean/2  (probed by the app's bridge together with templates/kinetic-captions/personclean.js)
// What the receipt says about looks behind him for a window: personClean true ONLY when the template applied it (render note),
// else personCleanFellBack with the reason (no person matte, stage / split layout ...). A window that never asked says nothing.
export function cleanFields(w, plan) {
  const asked = w.personClean === true || plan.personClean === true;
  if (!asked || !w.clean) return asked && !w.clean && !['cover', 'poster', 'marker'].includes(w.look || plan.look) ? { personCleanFellBack: 'the template did not report personClean (kinetype without looks-behind support)' } : {};
  return w.clean.applied ? { personClean: true, ...(w.clean.readable ? { readable: true } : {}), ...(Number.isFinite(w.clean.frames) ? { personCleanFrames: w.clean.frames, personCleanMatteMissFrames: w.clean.matteMissFrames ?? 0 } : {}) } : { personCleanFellBack: w.clean.why || 'not applied' };
}

export function windowSpec(plan, win, words, { fps, format, lut, grade, frame = null, name, pic = null, baseH = 0, zones = null }) {
  const rs = win.from ?? win.start, re = win.to ?? win.end;
  const inWin = words.filter((w) => w.start >= rs - 0.01 && w.start < re - 0.05).map((w) => ({ text: w.text, start: +(w.start - rs).toFixed(3), end: +(Math.min(w.end ?? w.start + 0.3, re) - rs).toFixed(3) }));
  const heroes = (win.heroes || []).map((t) => +(t - rs).toFixed(3)).filter((t) => t >= 0 && t < re - rs);
  // explicit background plates, one per hero the caller names: [{t: plan clock, plate: id, dur?}] (absent = nothing changes)
  const plates = (Array.isArray(win.plates) && !zones ? win.plates : []).filter((e) => e && typeof e.t === 'number' && typeof e.plate === 'string' && e.t >= rs && e.t < re)
    .map((e) => ({ t: +(e.t - rs).toFixed(3), plate: e.plate, ...(typeof e.dur === 'number' ? { dur: e.dur } : {}) }));
  const params = { look: win.look || plan.look, energy: win.energy || 'signature', window: { in: win.in || 0, out: win.out || 0 }, ...(win.focusX != null ? { focusX: win.focusX } : {}) };
  // hooks, spikes and cold opens hit exactly the director's heroes; a full window picks its own
  if (win.role !== 'full') params.heroEvery = 60;
  if (plan.plates === 'auto' && !zones) params.plates = 'auto';
  if (zones) params.zones = zones; // letterboxed base, zoned layout: no plates (a world behind the person would repaint the bars)
  // per-window opt-ins the caller writes into the plan (absent = nothing changes): the cover look draws its giant
  // hero word once, and the caption block stays below the chin line (fraction of the height, measured by the caller)
  if (win.singleKey === true) params.singleKey = true;
  // plan.heroOnce (a caller's opt-in, absent = nothing changes): a hero word drawn giant behind the head is not drawn a
  // second time in the caption block of the same moment, in any look (a one-word moment shows the giant alone)
  if (win.heroOnce === true || plan.heroOnce === true) params.heroOnce = true;
  // looks behind him (a caller's opt-in, absent = nothing changes): a window in a look that grades or re-draws the whole frame
  // (noir, neon, terminal, riso, swiss, cinema) applies it to the background only and re-draws him ungraded over it. The
  // template ignores it for cover / poster / marker and warns when there is no person matte.
  if (win.personClean === true || plan.personClean === true) params.personClean = true;
  // readable looks (a caller's opt-in, absent = nothing changes): noir / neon / terminal windows drawn behind him keep the house caption and
  // put the hero word behind him as a big bold wall (kinetic-captions `params.readable`); a picture-strip render is sized to the strip width
  if ((win.readable === true || plan.readable === true) && params.personClean === true && READABLE_LOOKS.has(params.look)) {
    params.readable = true;
    if (pic) params.canvas = 'picture';
  }
  // letterboxed take (pic = the picture rows of the base): the window is rendered on the picture only, so a line
  // measured on the whole frame (the chin) is re-expressed against the picture
  if (typeof win.captionTop === 'number') params.captionTop = pic ? Math.max(0, Math.min(1, (win.captionTop * baseH - pic.y0) / pic.h)) : win.captionTop;
  // the hero hit's white flash covers the whole frame, the person included: a caller that must never relight him sets 0
  if (typeof win.flash === 'number') params.flash = Math.max(0, Math.min(0.5, win.flash));
  params.grade = lut ? { exposure: 1, contrast: 1, saturation: 1 } : grade || { exposure: 1, contrast: 1, saturation: 1 };
  return {
    template: 'kinetic-captions', name, format, fps, duration: +(re - rs).toFixed(4), seed: 7,
    media: { ep: { src: plan.video, start: +rs.toFixed(4), ...(process.platform === 'darwin' ? { matte: true } : {}), ...(lut ? { lut } : {}), ...(frame ? { frame } : {}) } },
    params,
    ...(plan.brand?.palette ? { palette: plan.brand.palette } : {}),
    ...(plan.brand?.fonts ? { fonts: plan.brand.fonts } : {}),
    content: { words: inWin, ...(heroes.length ? { heroes } : {}), ...(plates.length ? { plates } : {}) },
    rules: { beatCoverage: false, loopExact: false },
    render: { crf: 14, preset: 'medium' },
  };
}

/** Structural similarity of the top of two frames (grade-proof): 1 = same framing. */
function framingCorr(src, ts, base, tb, frame = null) {
  const f = (file, t, fr) => {
    const b = grab(file, t, { w: 32, h: 32, crop: 0.55, pix: 'gray', frame: fr });
    const a = Float32Array.from(b);
    const mu = a.reduce((x, y) => x + y, 0) / a.length;
    let q = 0;
    for (let i = 0; i < a.length; i++) { a[i] -= mu; q += a[i] * a[i]; }
    q = Math.sqrt(q) || 1;
    return a.map((x) => x / q);
  };
  const a = f(src, ts, frame), b = f(base, tb, null);
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d;
}

const mae = (a, b) => { let e = 0; for (let i = 0; i < a.length; i++) e += Math.abs(a[i] - b[i]); return e / a.length; };

/**
 * @param planPath plan.json from `kinetype direct`
 * @param o {base?, out?, prerender?, offset?, gradeMatch?, log?, onProgress?}
 */
export async function compose(planPath, o = {}) {
  const log = o.log || console.error;
  const planFile = path.resolve(planPath);
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  if (plan.schema !== 'kinetype-plan/v1') throw new Error(`${planFile}: not a kinetype plan (schema ${plan.schema})`);
  const dir = path.dirname(planFile);
  const cache = path.join(dir, '.kinetype-cache');
  fs.mkdirSync(cache, { recursive: true });
  const words = loadWords(path.resolve(dir, plan.wordsSrc || 'words.json'));
  const src = plan.video;
  const sp = probe(src);
  const t0 = Date.now();
  const receipt = { kind: 'kinetype.compose_receipt.v1', created: new Date().toISOString(), plan: planFile, source: src, base: o.base ? path.resolve(o.base) : null, checks: [] };
  const check = (id, ok, detail) => { receipt.checks.push({ id, status: ok ? 'pass' : 'fail', detail }); if (!ok) log(`  FAIL ${id}: ${detail}`); };

  // ── base: align + grade ────────────────────────────────────────────────
  let base = receipt.base, bp = null, offset = 0, lut = null, grade = plan.grade, frame = null, snapshot = null;
  if (base) {
    // the base can be re-published while we work (a live app re-sealing its
    // library): work from an instant snapshot (APFS clone; plain copy elsewhere)
    const st0 = fs.statSync(base);
    snapshot = path.join(cache, `base-snapshot${path.extname(base) || '.mp4'}`);
    fs.rmSync(snapshot, { force: true });
    fs.copyFileSync(base, snapshot, fs.constants.COPYFILE_FICLONE);
    const st1 = fs.statSync(base);
    if (st1.mtimeMs !== st0.mtimeMs || st1.size !== st0.size) throw new Error(`base ${base} changed while it was being snapshotted — retry`);
    receipt.baseSnapshot = { size: st1.size, mtime: new Date(st1.mtimeMs).toISOString(), sha256: sha(fs.readFileSync(snapshot)) };
    base = snapshot;
    bp = probe(base);
    // framing first: the base may crop/zoom the source (a reframe)
    const fa = alignFraming(src, base);
    receipt.framing = fa;
    if (fa.frame && fa.score > fa.identity + 0.04) {
      frame = fa.frame;
      log(`framing: base is a ${fa.zoom}× reframe of the source (match ${fa.identity} → ${fa.score})`);
    }
    if (o.offset != null) { offset = +o.offset; receipt.align = { offset, forced: true }; }
    else {
      const al = alignOffset(src, base, Math.round(bp.fps) || 30, { frame });
      receipt.align = al;
      offset = al.offset;
      log(`align: base = source ${offset >= 0 ? '+' : ''}${offset.toFixed(3)}s (score ${al.score}, margin ${al.margin})`);
      if (al.score < 0.5) log(`  global alignment is weak (${al.score}): the base is re-edited; every window is aligned on its own`);
    }
  } else if (!grade) grade = fallbackGrade(plan, () => +autoExposure(src, sp.duration).toFixed(2), [...(plan.windows || []), ...(plan.coldOpen ? [plan.coldOpen] : [])]);
  const fps = Math.round(bp?.fps || sp.fps) || 30;
  const format = (bp || sp).h > (bp || sp).w ? 'vertical' : (bp || sp).h === (bp || sp).w ? 'square' : 'landscape';

  // ── letterboxed base ────────────────────────────────────────────────────────
  // plan.picture = {top, bottom} (fractions of the frame height) is written by a caller whose base is a sideways take
  // fitted upright between flat black bars. Windows of a look that can be zoned (ZONE_LOOKS) keep the full frame: the giant
  // hero word goes in the top bar, the caption block in the bottom bar, nothing on the picture (kinetic-captions
  // `params.zones`). Every other look is designed for and rendered on the PICTURE only (its own landscape canvas, the
  // footage cropped to the picture) and overlaid at its rows. The cold open follows the same rule (a picture canvas is padded
  // back to the full frame with black bars). Absent, or a reframed base: the full-frame render, exactly as before.
  const pic = bp && plan.picture && Number.isFinite(plan.picture.top) && Number.isFinite(plan.picture.bottom)
    ? (() => {
        const y0 = 2 * Math.round(plan.picture.top * bp.h / 2), y1 = 2 * Math.round(plan.picture.bottom * bp.h / 2);
        return y1 - y0 >= 64 && y0 > 0 && y1 < bp.h ? { y0, y1, h: y1 - y0 } : null;
      })()
    : null;

  // ── render windows (+ cold open), cached by content ─────────────────────
  const code = codeHash();
  const jobs = [...plan.windows.map((w) => ({ ...w })), ...(plan.coldOpen ? [{ ...plan.coldOpen, in: 0, out: 0 }] : [])];
  for (const w of jobs) {
    w.off = offset; w.frame = frame;
    if (!receipt.base || o.offset != null) continue;
    const a0 = w.from ?? w.start, a1 = w.to ?? w.end;
    const la = alignWindow(src, base, a0, a1, fps, { guess: offset, frame });
    w.align = la;
    if (Math.abs(la.offset - offset) > 0.5 / fps || la.frame !== frame) log(`  ${w.id}: own alignment ${la.offset >= 0 ? '+' : ''}${la.offset.toFixed(3)}s${la.frame ? `, ${la.zoom}× reframe` : ''} (score ${la.score})`);
    w.off = la.offset; w.frame = la.frame;
    check(`align-${w.id}`, la.score >= 0.9, `window matches the base at ${la.offset.toFixed(3)}s with correlation ${la.score}${la.frame ? ` (reframe ${la.zoom}×)` : ''}`);
  }
  for (const w of jobs) {
    w.zones = pic && !w.frame && ZONE_LOOKS.has(w.look || plan.look) ? zonesFor(pic, bp.h) : null;
    w.pic = pic && !w.frame && !w.zones ? pic : null;
  }
  if (pic) receipt.picture = { ...pic, zoned: jobs.filter((w) => w.zones).map((w) => w.id), pictureOnly: jobs.filter((w) => w.pic).map((w) => w.id) };
  // grade: fitted where it matters — on each window's own aligned frames when
  // the base is re-edited, else evenly across the whole base
  if (receipt.base && o.gradeMatch !== false) {
    const reEdited = (receipt.align?.score ?? 1) < 0.9 || jobs.some((w) => Math.abs(w.off - offset) > 0.5 / fps || w.frame !== frame);
    const at = reEdited ? jobs.flatMap((w) => { const a0 = w.from ?? w.start, a1 = w.to ?? w.end; return [0.15, 0.4, 0.65, 0.9].map((f) => { const ts = a0 + (a1 - a0) * f; return { ts, tb: ts + w.off, frame: w.frame }; }); }) : null;
    const g = fitGrade(src, base, offset, { fps, frame, at });
    lut = path.join(cache, `grade-${sha(Buffer.from(g.lut.buffer)).slice(0, 12)}.cube`);
    writeCube(g.lut, lut);
    receipt.grade = { lut, maeBefore: g.before, maeAfter: g.after, pairs: g.pairs, sampled: reEdited ? 'windows' : 'whole base' };
    log(`grade match (${receipt.grade.sampled}): mean error ${g.before} → ${g.after} (0–255) over ${g.pairs} pixel pairs`);
    check('grade-match', g.after <= Math.max(6, g.before * 0.6), `held-out error ${g.before} → ${g.after}`);
  }
  const { render } = await import('./render.js');
  for (const w of jobs) {
    const spec = windowSpec(plan, w, words, {
      fps, lut, grade, name: `${w.id}`, pic: w.pic, baseH: bp?.h || 0, zones: w.zones,
      ...(w.pic ? { format: { width: bp.w, height: w.pic.h, fps }, frame: { x: 0, y: w.pic.y0 / bp.h, w: 1, h: w.pic.h / bp.h } } : { format, frame: w.frame }),
    });
    const key = sha(Buffer.from(JSON.stringify([spec, code, lut ? fs.readFileSync(lut, 'utf8').length + sha(fs.readFileSync(lut)) : null]))).slice(0, 16);
    const wdir = path.join(cache, `${w.id}-${key}`);
    const mp4 = path.join(wdir, `${w.id}.mp4`);
    const rc = path.join(wdir, 'receipt.json');
    if (fs.existsSync(mp4) && fs.existsSync(rc) && JSON.parse(fs.readFileSync(rc, 'utf8')).verdict?.status !== 'fail') {
      const cached = JSON.parse(fs.readFileSync(rc, 'utf8'));
      w.clip = mp4; w.verdict = cached.verdict.status; w.cached = true; w.clean = cleanVerdictOfRender(cached);
      log(`window ${w.id}: cached (${w.verdict})`);
      continue;
    }
    fs.mkdirSync(wdir, { recursive: true });
    const specPath = path.join(wdir, `${w.id}.json`);
    fs.writeFileSync(specPath, JSON.stringify(spec, null, 2));
    log(`window ${w.id} (${w.role}, ${spec.params.look}/${spec.params.energy}, ${spec.duration.toFixed(2)}s)…`);
    const r = await render(spec, { specPath, specDir: wdir, out: wdir, log: () => {}, onProgress: o.onProgress });
    w.clip = r.outputs.find((x) => x.format === 'mp4')?.file || r.outputs[0].file;
    w.verdict = r.verdict.status;
    w.fps = +r.timing.fps_rendered.toFixed(1);
    w.clean = cleanVerdictOfRender(r);
    check(`render-${w.id}`, r.verdict.status !== 'fail', `${r.verdict.status}${r.verdict.fails.length ? ': ' + r.verdict.fails.join('; ') : ''}`);
  }
  receipt.windows = jobs.map(({ id, role, clip, verdict, fps: f, cached, start, end, from, to }) => ({ id, role, clip, verdict, fps: f, cached: !!cached, srcStart: from ?? start, srcEnd: to ?? end }));
  if (o.prerender) {
    receipt.verdict = receipt.checks.every((c) => c.status === 'pass') ? 'pass' : 'fail';
    receipt.timing = { total_sec: (Date.now() - t0) / 1000 };
    if (snapshot) fs.rmSync(snapshot, { force: true });
    const rp = path.join(dir, 'prerender-receipt.json');
    fs.writeFileSync(rp, JSON.stringify(receipt, null, 2));
    return { verdict: receipt.verdict, receipt: rp, windows: receipt.windows, graded: !!lut };
  }

  // ── body: the base, or kinetype's own calm captions when there is none ──
  if (!base) {
    const body = { id: 'body', role: 'full', start: 0, end: sp.duration, in: 0, out: 0, look: plan.body?.look || plan.look, energy: plan.body?.energy || 'calm', heroes: [] };
    const spec = windowSpec(plan, body, words, { fps, format, lut: null, grade, name: 'body' });
    spec.audio = { src, start: 0 };
    const key = sha(Buffer.from(JSON.stringify([spec, code]))).slice(0, 16);
    const wdir = path.join(cache, `body-${key}`);
    const mp4 = path.join(wdir, 'body.mp4');
    if (!fs.existsSync(mp4)) {
      fs.mkdirSync(wdir, { recursive: true });
      const specPath = path.join(wdir, 'body.json');
      fs.writeFileSync(specPath, JSON.stringify(spec, null, 2));
      log(`body (${spec.params.look}/${spec.params.energy}, ${spec.duration.toFixed(1)}s)…`);
      const r = await render(spec, { specPath, specDir: wdir, out: wdir, log: () => {}, onProgress: o.onProgress });
      check('render-body', r.verdict.status !== 'fail', r.verdict.status);
    }
    base = mp4; bp = probe(base); offset = 0;
  }

  // ── splice ─────────────────────────────────────────────────────────────
  const outFile = path.resolve(o.out || path.join(dir, `${path.basename(dir)}-final.mp4`));
  const cold = jobs.find((w) => w.role === 'coldOpen');
  const wins = jobs.filter((w) => w.role !== 'coldOpen').sort((a, b) => a.start - b.start);
  const CL = cold ? Math.round((cold.to - cold.from) * fps) / fps : 0;
  const args = ['-v', 'error', '-y', '-i', base];
  wins.forEach((w) => args.push('-i', w.clip));
  if (cold) args.push('-i', cold.clip);
  const needSrcAudio = !bp.audio;
  if (needSrcAudio) args.push('-i', src);
  const fc = [];
  const BW = bp.w, BH = bp.h;
  // untouched frames keep the base's exact colour encoding (range + matrix);
  // only kinetype's clips (bt709, limited) are converted INTO the base's space
  const C = bp.color, range = C.full ? 'full' : 'limited';
  const toBase = `in_color_matrix=bt709:in_range=limited:out_color_matrix=${C.matrix}:out_range=${range}`;
  fc.push(`[0:v]setpts=PTS-STARTPTS,scale=in_range=${range}:out_range=${range},format=yuv420p[b0]`);
  wins.forEach((w, i) => {
    const T = Math.round((w.start + w.off) * fps) / fps;
    const L = Math.round((w.end - w.start) * fps) / fps;
    const fin = w.in > 0 ? `,fade=t=in:st=0:d=${w.in.toFixed(4)}:alpha=1` : '';
    const fout = w.out > 0 ? `,fade=t=out:st=${(L - w.out).toFixed(4)}:d=${w.out.toFixed(4)}:alpha=1` : '';
    fc.push(`[${i + 1}:v]scale=${BW}:${w.pic ? w.pic.h : BH}:flags=lanczos:${toBase},format=yuva420p${fin}${fout},setpts=PTS-STARTPTS+${T.toFixed(4)}/TB[w${i}]`);
    fc.push(`[b${i}][w${i}]overlay=${w.pic ? `x=0:y=${w.pic.y0}:` : ''}eof_action=pass:repeatlast=0:enable='between(t,${T.toFixed(4)},${(T + L - 0.5 / fps).toFixed(4)})'[b${i + 1}]`);
    w.outStart = +(T + CL).toFixed(4); w.outEnd = +(T + L + CL).toFixed(4);
  });
  const bodyV = `b${wins.length}`;
  const aIn = needSrcAudio ? `${wins.length + 1 + (cold ? 1 : 0)}:a` : '0:a';
  if (cold) {
    const ci = wins.length + 1;
    const dip = cold.dip ?? 0.2;
    fc.push(`[${ci}:v]scale=${BW}:${cold.pic ? cold.pic.h : BH}:flags=lanczos:${toBase},format=yuv420p${cold.pic ? `,pad=${BW}:${BH}:0:${cold.pic.y0}:color=black` : ''},trim=duration=${CL.toFixed(4)},fade=t=out:st=${(CL - dip).toFixed(4)}:d=${dip.toFixed(4)},setpts=PTS-STARTPTS[cv]`);
    // cold-open AUDIO comes from the base's own mix (studio voice, music bed), offset-corrected
    const a0 = cold.from + (needSrcAudio ? 0 : cold.off);
    fc.push(`[${aIn}]asplit=2[aa][ab]`);
    fc.push(`[aa]atrim=start=${a0.toFixed(4)}:duration=${CL.toFixed(4)},asetpts=PTS-STARTPTS,aresample=48000,afade=t=in:d=0.03,afade=t=out:st=${Math.max(0, CL - 0.18).toFixed(4)}:d=0.18[ca]`);
    fc.push(`[ab]asetpts=PTS-STARTPTS,aresample=48000${needSrcAudio && offset ? `,adelay=${Math.round(offset * 1000)}:all=1` : ''}[ba]`);
    fc.push(`[cv][ca][${bodyV}][ba]concat=n=2:v=1:a=1[v][a]`);
  } else {
    fc.push(`[${aIn}]asetpts=PTS-STARTPTS,aresample=48000[a]`);
    fc.push(`[${bodyV}]null[v]`);
  }
  args.push('-filter_complex', fc.join(';'), '-map', '[v]', '-map', '[a]', '-r', String(fps),
    // quality-first CRF, but capped near the base's own bitrate so the result
    // is a drop-in replacement (a phone pipeline should not grow 50%)
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '15',
    ...(bp.vbitrate > 0 ? ['-maxrate', String(Math.round(Math.max(bp.vbitrate * 1.05, 6e6))), '-bufsize', String(Math.round(Math.max(bp.vbitrate * 2.1, 12e6)))] : []),
    '-pix_fmt', 'yuv420p', '-color_range', C.full ? 'pc' : 'tv',
    ...(C.space && C.space !== 'unknown' ? ['-colorspace', C.space] : []), ...(C.primaries && C.primaries !== 'unknown' ? ['-color_primaries', C.primaries] : []), ...(C.transfer && C.transfer !== 'unknown' ? ['-color_trc', C.transfer] : []),
    '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', outFile);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  log(`splice: ${wins.length} window(s)${cold ? ' + cold open' : ''} into ${path.basename(base)} → ${outFile}`);
  await run('ffmpeg', args);

  // ── verify ─────────────────────────────────────────────────────────────
  const op = probe(outFile);
  const expected = bp.duration + CL;
  check('duration', Math.abs(op.duration - expected) <= 2 / fps + 0.03, `${op.duration.toFixed(3)}s vs expected ${expected.toFixed(3)}s`);
  const G = { w: 96, h: 170 };
  const busy = (t) => wins.some((w) => t >= w.start + w.off - 0.3 && t <= w.end + w.off + 0.3);
  const quiet = [];
  for (let k = 1; quiet.length < 4 && k < 40; k++) { const t = (bp.duration - 8) * k / 40 + 2; if (!busy(t)) quiet.push(Math.round(t * fps) / fps); }
  for (const t of quiet) {
    const e = mae(grab(outFile, t + CL + 0.5 / fps, G), grab(base, t + 0.5 / fps, G));
    check(`untouched@${t.toFixed(2)}`, e < 1.5, `mean abs diff vs base ${e.toFixed(2)}`);
  }
  // the base must show the same framing as the source at every splice, or the
  // crossfade would jump (a punch-in or reframe in the base) → fail = fallback
  // (only against an EXTERNAL base: kinetype's own body shares the source's framing by construction)
  for (const w of receipt.base ? [...wins, ...(cold ? [{ id: 'cold', start: cold.from, end: cold.to, off: cold.off, frame: cold.frame }] : [])] : []) {
    for (const [edge, ts] of [['in', w.start + 0.05], ['out', Math.max(w.start, w.end - 0.05)]]) {
      if (ts + w.off >= bp.duration - 0.2) continue;
      const c = framingCorr(src, ts, base, ts + w.off, w.frame);
      check(`framing-${w.id}-${edge}`, c >= 0.93, `source vs base framing correlation ${c.toFixed(3)} at ${ts.toFixed(2)}s`);
    }
  }
  for (const w of wins) {
    const hero = (w.heroes && w.heroes[0]) ?? (w.start + w.end) / 2;
    const th = Math.min(w.end - 0.2, hero + 0.4) + w.off;
    // a picture-only window changes only the picture's rows: scale the whole-frame mean back up to the picture
    const e = mae(grab(outFile, th + CL + 0.5 / fps, G), grab(base, th + 0.5 / fps, G)) * (w.pic ? BH / w.pic.h : 1);
    check(`window-${w.id}-present`, e > 4, `design vs base diff ${e.toFixed(2)} at ${th.toFixed(2)}s`);
    const after = Math.round((w.end + w.off) * fps) / fps + 1 / fps;
    if (after < bp.duration - 0.1) {
      const e2 = mae(grab(outFile, after + CL + 0.5 / fps, G), grab(base, after + 0.5 / fps, G));
      check(`window-${w.id}-returns`, e2 < 1.5, `first frame after the window vs base ${e2.toFixed(2)}`);
    }
  }
  if (cold) {
    const first = grab(outFile, 0.5 / fps, G), last = grab(outFile, CL - 1.5 / fps, G);
    const lum = (b) => b.reduce((a, x) => a + x, 0) / b.length;
    check('cold-open', lum(first) * (cold.pic ? BH / cold.pic.h : 1) > 8 && lum(last) < lum(first), `first frame luma ${lum(first).toFixed(1)}, last ${lum(last).toFixed(1)} (dip)`);
  }

  // ── review sheet: the moments an editor would check ────────────────────
  const shots = [];
  if (cold) { for (const h of (cold.heroes || []).slice(0, 1)) shots.push(['cold hero', h - cold.from + 0.35]); shots.push(['cold → start', CL + 0.15]); }
  for (const w of wins) {
    for (const h of (w.heroes || []).slice(0, 2)) shots.push([`${w.id} hero`, h + w.off + CL + 0.35]);
    if (!(w.heroes || []).length) shots.push([`${w.id}`, (w.start + w.end) / 2 + w.off + CL]);
    shots.push([`${w.id} → base`, w.end + w.off + CL + 0.25]);
  }
  const reviewDir = path.join(cache, 'review');
  fs.rmSync(reviewDir, { recursive: true, force: true });
  fs.mkdirSync(reviewDir, { recursive: true });
  const tiles = [];
  for (const [label, t] of shots.slice(0, 16)) {
    const f = path.join(reviewDir, `${String(tiles.length).padStart(2, '0')}.png`);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', Math.max(0, t).toFixed(3), '-i', outFile, '-frames:v', '1', '-vf', 'scale=270:-2', f], { cwd: ROOT });
    tiles.push({ f, label, t: +t.toFixed(2) });
  }
  const review = outFile.replace(/\.mp4$/, '') + '.review.png';
  if (tiles.length) {
    const cols = Math.min(4, tiles.length), rows = Math.ceil(tiles.length / cols);
    const inputs = tiles.flatMap((x) => ['-i', x.f]);
    const pads = [];
    for (let k = tiles.length; k < cols * rows; k++) pads.push(k);
    const layout = Array.from({ length: cols * rows }, (_, k) => { const c = k % cols, r = Math.floor(k / cols); return `${c ? Array.from({ length: c }, () => 'w0').join('+') : '0'}_${r ? Array.from({ length: r }, () => 'h0').join('+') : '0'}`; }).join('|');
    const pre = pads.map((k, j) => `color=c=black:s=270x${Math.round(270 * BH / BW / 2) * 2}:d=1[p${j}]`).join(';');
    const labels = [...tiles.map((_, k) => `[${k}:v]`), ...pads.map((_, j) => `[p${j}]`)].join('');
    execFileSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', `${pre ? pre + ';' : ''}${labels}xstack=inputs=${cols * rows}:layout=${layout}:fill=black`, '-frames:v', '1', review], { cwd: ROOT });
  }

  receipt.output = { file: outFile, bytes: fs.statSync(outFile).size, sha256: sha(fs.readFileSync(outFile)), duration: op.duration, frames: Math.round(op.duration * fps), width: op.w, height: op.h, fps };
  receipt.clockOffset = CL;
  receipt.timeline = [
    ...(cold ? [{ kind: 'coldOpen', id: 'cold', look: cold.look, energy: cold.energy, ...cleanFields(cold, plan), outStart: 0, outEnd: CL, srcFrom: cold.from, srcTo: cold.to, line: cold.line }] : []),
    { kind: 'base', outStart: CL, outEnd: +(CL + bp.duration).toFixed(4), baseOffset: offset },
    ...wins.map((w) => ({ kind: w.role, id: w.id, look: w.look, energy: w.energy, srcStart: w.start, srcEnd: w.end, baseOffset: w.off, ...(w.frame ? { reframe: w.frame } : {}), ...(w.pic ? { picture: w.pic } : {}), ...(w.zones ? { zones: w.zones } : {}), ...cleanFields(w, plan), outStart: w.outStart, outEnd: w.outEnd, line: w.line })),
  ];
  receipt.review = { file: review, tiles: tiles.map(({ label, t }) => ({ label, t })) };
  receipt.timing = { total_sec: +((Date.now() - t0) / 1000).toFixed(1) };
  receipt.verdict = receipt.checks.every((c) => c.status === 'pass') ? 'pass' : 'fail';
  const rp = outFile.replace(/\.mp4$/, '') + '.receipt.json';
  fs.writeFileSync(rp, JSON.stringify(receipt, null, 2));
  if (snapshot) fs.rmSync(snapshot, { force: true });
  log(`compose → ${outFile} (${receipt.verdict}, ${receipt.timing.total_sec}s)`);
  return { output: outFile, receipt: rp, review, verdict: receipt.verdict, clockOffset: CL, duration: op.duration, timeline: receipt.timeline, windows: wins.map((w) => ({ id: w.id, role: w.role, srcStart: w.start, srcEnd: w.end, outStart: w.outStart, outEnd: w.outEnd, verdict: w.verdict })), checks: receipt.checks };
}
