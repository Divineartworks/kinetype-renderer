// Studio relight: dark phone footage → a lit look with a clear subject.
//
// Method (native, first-party): a Core Image + Vision pass (scripts/native/
// relight.swift) streams every frame: a temporally stable person matte and a
// smoothed face box place a soft key light on the speaker, the room falls off
// a little and loses some colour, and a gentle cast correction brings skin back
// from purple. The look is ADAPTIVE but CONSTANT per video: sampled frames give
// the face and scene brightness and the skin cast; one parameter set is derived
// from them, so nothing pumps. Bright footage gets little or no lift; a video
// with no person is copied untouched. Audio is copied; colour range/matrix/tags
// are kept like the input; bitrate stays near the input's.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { ROOT } from './server.js';
import { ensureNativeTool } from './media.js';

function probe(file) {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate,nb_frames,pix_fmt,color_range,color_space,color_transfer,color_primaries,bit_rate:format=duration,bit_rate', '-of', 'json', file], { cwd: ROOT }).toString());
  const v = j.streams.find((s) => s.codec_type === 'video');
  if (!v) throw new Error(`${file}: no video stream`);
  const [a, b] = (v.r_frame_rate || '30/1').split('/').map(Number);
  const full = v.color_range === 'pc' || /^yuvj/.test(v.pix_fmt || '');
  return {
    w: v.width, h: v.height, fps: b ? a / b : a, rate: v.r_frame_rate || '30/1', frames: Number(v.nb_frames) || null, duration: Number(j.format.duration),
    audio: j.streams.some((s) => s.codec_type === 'audio'), vbitrate: Number(v.bit_rate || j.format.bit_rate || 0),
    color: { full, matrix: v.color_space === 'bt709' ? 'bt709' : 'bt601', space: v.color_space, transfer: v.color_transfer, primaries: v.color_primaries },
  };
}

const median = (xs) => { const s = [...xs].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : null; };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/** Measure the footage: scene luma, face luma, skin cast (sampled frames). */
export function analyzeLight(file, { samples = 16 } = {}) {
  const p = probe(file);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-relight-'));
  try {
    for (let k = 0; k < samples; k++) {
      const t = p.duration * (0.04 + 0.92 * (k + 0.5) / samples);
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1', '-vf', 'scale=540:-2', '-q:v', '3', path.join(tmp, `${String(k).padStart(3, '0')}.jpg`)], { cwd: ROOT });
    }
    const lines = execFileSync(ensureNativeTool('relight'), ['analyze', tmp], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const faces = lines.map((l) => l.face).filter(Boolean);
    return {
      samples: lines.length, faceShare: lines.length ? faces.length / lines.length : 0,
      sceneLuma: median(lines.map((l) => l.luma)), faceLuma: median(faces.map((f) => f.luma)),
      face: faces.length ? { r: median(faces.map((f) => f.r)), g: median(faces.map((f) => f.g)), b: median(faces.map((f) => f.b)) } : null,
    };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

/** One constant light plan for the whole video (strength 0..1). */
export function planLight(a, strength = 0.8, { onlyDark = false } = {}) {
  const s = clamp(strength, 0, 1);
  if (!a.face || a.faceShare < 0.3 || s === 0) return { neutral: true, reason: a.face ? 'strength 0' : 'no person on camera', darkness: 0, faceLuma: a.faceLuma ?? null };
  const f = a.faceLuma;
  // only-dark ("auto"): a face already at a healthy mid-tone is left alone —
  // an exact copy, no re-encode
  if (onlyDark && f >= 0.42) return { neutral: true, reason: `already bright (face luma ${f.toFixed(3)} ≥ 0.42)`, darkness: 0, faceLuma: +f.toFixed(3) };
  // how dark the face is: 0 at a healthy mid-tone (≥0.42 sRGB), 1 at 0.17
  const darkness = clamp((0.42 - f) / 0.25, 0, 1);
  // exposure in the linear working space: bring the face toward 0.38 (encoded)
  const subjectEV = +(clamp(2.2 * Math.log2(0.38 / f), 0, 1.5) * s).toFixed(3);
  const keyEV = +((0.12 + 0.43 * darkness) * s).toFixed(3);
  // the room rises less than the face (so he separates) but a very dark room still opens up a bit
  const bgEV = +(subjectEV * 0.4 - (0.2 + 0.15 * darkness) * s).toFixed(3);
  // skin cast: typical skin reads r:g:b ≈ 1 : 0.78 : 0.66 — pull a purple or
  // green cast most of the way back (±12% at most per channel)
  const { r, g, b } = a.face;
  const gainG = +(1 + (clamp((r * 0.78) / Math.max(1e-3, g), 0.88, 1.12) - 1) * 0.85 * s).toFixed(4);
  const gainB = +(1 + (clamp((r * 0.66) / Math.max(1e-3, b), 0.88, 1.12) - 1) * 0.85 * s).toFixed(4);
  return { neutral: false, subjectEV, keyEV, bgEV, bgSaturation: +(1 - 0.15 * s).toFixed(3), clarity: +(0.22 * s).toFixed(3), warmth: 0, gainR: 1, gainG, gainB, feather: 0.006, darkness: +darkness.toFixed(3), faceLuma: +f.toFixed(3) };
}

/**
 * @param input video file
 * @param o {out?, strength?, params? (override the plan), log?, onProgress?}
 */
export async function relight(input, o = {}) {
  const log = o.log || console.error;
  const abs = path.resolve(input);
  const p = probe(abs);
  const out = path.resolve(o.out || abs.replace(/\.[^.]+$/, '') + '.relit.mp4');
  const t0 = Date.now();
  const analysis = o.params ? null : analyzeLight(abs);
  const plan = o.params ? { neutral: false, ...o.params } : planLight(analysis, o.strength ?? 0.8, { onlyDark: !!o.onlyDark });
  if (analysis) log(`relight: face luma ${analysis.faceLuma ?? '—'} (faces in ${Math.round(analysis.faceShare * 100)}% of samples), scene ${analysis.sceneLuma}`);
  if (plan.neutral) {
    // nothing to light: an exact copy, never a re-encode
    fs.copyFileSync(abs, out);
    log(`relight: ${plan.reason} — copied unchanged`);
    return { output: out, changed: false, reason: plan.reason, analysis, plan, seconds: (Date.now() - t0) / 1000 };
  }
  log(`relight: subject +${plan.subjectEV} EV, key +${plan.keyEV} EV, room ${plan.bgEV >= 0 ? '+' : ''}${plan.bgEV} EV, skin gains g×${plan.gainG} b×${plan.gainB}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-relight-'));
  const paramsFile = path.join(tmp, 'params.json');
  fs.writeFileSync(paramsFile, JSON.stringify(plan));
  const C = p.color, range = C.full ? 'full' : 'limited';
  const W = p.w, H = p.h;
  try {
    const dec = spawn('ffmpeg', ['-v', 'error', '-i', abs, '-map', '0:v:0', '-vf', `scale=in_color_matrix=${C.matrix}:in_range=${range},format=bgra`, '-f', 'rawvideo', '-pix_fmt', 'bgra', '-'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    const tool = spawn(ensureNativeTool('relight'), ['run', String(W), String(H), paramsFile], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
    const enc = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${W}x${H}`, '-framerate', p.rate, '-i', '-', '-i', abs,
      '-map', '0:v', '-map', '1:a?', '-c:a', 'copy',
      '-vf', `scale=out_color_matrix=${C.matrix}:out_range=${range},format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '17',
      ...(p.vbitrate > 0 ? ['-maxrate', String(Math.round(Math.max(p.vbitrate * 1.05, 4e6))), '-bufsize', String(Math.round(Math.max(p.vbitrate * 2.1, 8e6)))] : []),
      '-color_range', C.full ? 'pc' : 'tv',
      ...(C.space && C.space !== 'unknown' ? ['-colorspace', C.space] : []), ...(C.primaries && C.primaries !== 'unknown' ? ['-color_primaries', C.primaries] : []), ...(C.transfer && C.transfer !== 'unknown' ? ['-color_trc', C.transfer] : []),
      '-movflags', '+faststart', out], { cwd: ROOT, stdio: ['pipe', 'ignore', 'pipe'] });
    dec.stdout.pipe(tool.stdin);
    tool.stdout.pipe(enc.stdin);
    const errs = { dec: '', tool: '', enc: '' };
    dec.stderr.on('data', (d) => (errs.dec += d));
    enc.stderr.on('data', (d) => (errs.enc += d));
    const total = p.frames || Math.round(p.duration * p.fps);
    tool.stderr.on('data', (d) => {
      const s = String(d);
      const m = s.match(/frame (\d+)/g);
      if (m && o.onProgress) o.onProgress(Number(m[m.length - 1].slice(6)), total);
      else if (!m) errs.tool += s;
    });
    const done = (proc, name) => new Promise((res, rej) => proc.on('close', (code) => (code === 0 ? res() : rej(new Error(`${name} exited ${code}: ${String(errs[name]).slice(-800)}`)))));
    tool.stdin.on('error', () => {}); enc.stdin.on('error', () => {});
    await Promise.all([done(dec, 'dec'), done(tool, 'tool'), done(enc, 'enc')]);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  const q = probe(out);
  // playable frames (container nb_frames can count edit-list lead-in frames that never show)
  const inFrames = Math.round(p.duration * p.fps);
  const outFrames = q.frames || Math.round(q.duration * q.fps);
  if (Math.abs(outFrames - inFrames) > 2) throw new Error(`relight: frame count ${outFrames} ≠ input ${inFrames}`);
  const seconds = (Date.now() - t0) / 1000;
  log(`relight → ${out} (${outFrames} frames in ${seconds.toFixed(1)}s, ${(outFrames / seconds).toFixed(1)} fps)`);
  return { output: out, changed: true, analysis, plan, frames: outFrames, duration: q.duration, audio: q.audio, seconds: +seconds.toFixed(1), fps: +(outFrames / seconds).toFixed(1) };
}
