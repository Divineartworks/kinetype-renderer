// Mixer: SFX bus + ducked music bed + voice -> broadcast-clean loudness (LUFS target, true-peak safe).
// Deterministic (no randomness); ffmpeg is used for decoding, loudness MEASUREMENT (ebur128) and WAV encoding only.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { hash } from '../../kit/rng.js';
import { SR, SOUNDS } from './synth.js';

const LICENCE = 'original procedural synthesis — no third-party samples (CC0-equivalent, owned)';
const lin = (db) => Math.pow(10, db / 20);
const db = (x) => 20 * Math.log10(Math.max(x, 1e-12));

function ff(args, input, maxBuffer = 1 << 30) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', ...args], { input, maxBuffer });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr?.toString().slice(-400)}`);
  return r;
}
/** Decode any media file to interleaved f32le @48k with ch channels -> [Float32Array per channel]. */
function decode(file, ch) {
  const r = ff(['-i', file, '-vn', '-f', 'f32le', '-ac', String(ch), '-ar', String(SR), 'pipe:1']);
  const b = r.stdout, all = new Float32Array(b.buffer, b.byteOffset, b.length >> 2);
  const n = Math.floor(all.length / ch), chans = Array.from({ length: ch }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) chans[c][i] = all[i * ch + c];
  return chans;
}
const interleave = (L, R) => { const o = new Float32Array(L.length * 2); for (let i = 0; i < L.length; i++) { o[2 * i] = L[i]; o[2 * i + 1] = R[i]; } return o; };

/** ebur128 measurement (I, LRA, true peak) of raw stereo f32 (Float32Array interleaved) or a file path. */
function measure(src) {
  const filt = ['-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'];
  const r = typeof src === 'string'
    ? ff(['-i', src, ...filt])
    : ff(['-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', 'pipe:0', ...filt], Buffer.from(src.buffer, src.byteOffset, src.byteLength));
  const t = r.stderr.toString(), s = t.slice(t.lastIndexOf('Summary:'));
  const num = (re) => { const m = s.match(re); return m ? (/inf/.test(m[1]) ? -Infinity : parseFloat(m[1])) : NaN; };
  return { I: num(/I:\s+(-?[\d.]+|-?inf)\s+LUFS/), LRA: num(/LRA:\s+(-?[\d.]+|-?inf)\s+LU/), TP: num(/Peak:\s+(-?[\d.]+|-?inf)\s+dBFS/) };
}

/** Render cues into a stereo bus (equal-power pan, centre = unity). */
function renderSfx(cues, N) {
  const L = new Float32Array(N), R = new Float32Array(N), used = {};
  const cache = new Map();
  for (const c of cues) {
    const def = SOUNDS[c.sound];
    if (!def) throw new Error(`unknown sound ${c.sound}`);
    const k = `${c.sound}|${c.seed}|${c.ch ?? ''}|${c.dur ?? ''}`;
    let buf = cache.get(k);
    if (!buf) { buf = def.gen(c.seed, { ch: c.ch, dur: c.dur }); cache.set(k, buf); }
    const th = (Math.max(-1, Math.min(1, c.pan ?? 0)) + 1) * Math.PI / 4, gl = Math.cos(th) * Math.SQRT2, gr = Math.sin(th) * Math.SQRT2;
    const g = def.gain * (c.gain ?? 1), i0 = Math.round(c.t * SR);
    for (let i = 0; i < buf.length; i++) { const j = i0 + i; if (j < 0 || j >= N) continue; L[j] += buf[i] * g * gl; R[j] += buf[i] * g * gr; }
    used[c.sound] = (used[c.sound] ?? 0) + 1;
  }
  return { L, R, used };
}

/** Place an input signal on the film timeline: offset = film time at which the file starts (negative trims its head). */
function place(chans, offset, N) {
  const sh = Math.round(offset * SR);
  return chans.map((x) => { const o = new Float32Array(N); for (let i = Math.max(0, sh); i < N && i - sh < x.length; i++) o[i] = x[i - sh]; return o; });
}
/** Loop (0.25 s equal-power crossfade at the seam) a stereo bed up to N samples, starting `skip` seconds into the file. */
function loopTo(chans, N, loop, skip = 0) {
  const s0 = Math.round(Math.max(0, skip) * SR), xf = Math.round(0.25 * SR);
  return chans.map((x) => {
    const src = x.subarray(Math.min(s0, x.length - 1)), o = new Float32Array(N), M = src.length;
    if (!loop || M >= N || M < xf * 4) { o.set(src.subarray(0, Math.min(M, N))); return o; }
    const step = M - xf; // each repeat overlaps the previous by xf
    for (let p = 0; p * step < N; p++) {
      const base = p * step;
      for (let i = 0; i < M && base + i < N; i++) {
        let g = 1; if (p > 0 && i < xf) g = Math.sin(Math.PI / 2 * i / xf); else if (base + step < N && i >= M - xf) g = Math.cos(Math.PI / 2 * (i - (M - xf)) / xf);
        o[base + i] += src[i] * g;
      }
    }
    return o;
  });
}

/** Sidechain gain envelope (1 = open, duckLin = ducked) from the voice. RMS 20 ms, hold, attack/release smoothing. */
function duckEnvelope(voice, N, duckDb, { attack = 0.06, release = 0.35, holdS = 0.15 } = {}) {
  const W = Math.round(0.02 * SR), F = Math.ceil(N / W), rms = new Float64Array(F);
  for (let f = 0; f < F; f++) { let s = 0, c = 0; for (let i = f * W; i < Math.min(N, (f + 1) * W); i++) { s += voice[i] * voice[i]; c++; } rms[f] = db(Math.sqrt(s / (c || 1))); }
  const sorted = Array.from(rms).sort((a, b) => a - b), p95 = sorted[Math.floor(0.95 * (F - 1))] ?? -100;
  const thr = Math.max(-55, p95 - 25); // speech = within 25 dB of the loud passages
  const holdF = Math.ceil(holdS / 0.02), tgt = new Float64Array(F).fill(1), duckLin = lin(duckDb);
  let since = 1e9;
  for (let f = 0; f < F; f++) { since = rms[f] > thr ? 0 : since + 1; if (since <= holdF) tgt[f] = duckLin; }
  const env = new Float32Array(N), aA = Math.exp(-1 / (attack / 2.3 * SR)), aR = Math.exp(-1 / (release / 2.3 * SR));
  let y = 1;
  for (let i = 0; i < N; i++) { const t = tgt[Math.min(F - 1, (i / W) | 0)], a = t < y ? aA : aR; y = t + (y - t) * a; env[i] = y; }
  return env;
}

/** Lookahead true-peak limiter: 4x-oversampled peak estimate -> min-filtered, box-smoothed gain (never exceeds required). */
function limit(L, R, ceilDb, look = 0.005) {
  const N = L.length, ceil = lin(ceilDb), Lk = Math.round(look * SR);
  // 4x polyphase windowed-sinc (16 taps per phase) inter-sample peak estimate
  const T = 8, ph = [0.25, 0.5, 0.75].map((p) => Array.from({ length: 2 * T }, (_, k) => { const d = k - T + 1 - p, w = 0.5 + 0.5 * Math.cos(Math.PI * d / T); return (d === 0 ? 1 : Math.sin(Math.PI * d) / (Math.PI * d)) * w; }));
  const need = new Float32Array(N).fill(1);
  const est = (x, i) => {
    let m = Math.abs(x[i]);
    if (m < ceil * 0.35) return m;
    for (const h of ph) { let s = 0; for (let k = 0; k < 2 * T; k++) { const j = i - T + 1 + k; if (j >= 0 && j < N) s += x[j] * h[k]; } m = Math.max(m, Math.abs(s)); }
    return m;
  };
  let any = false;
  for (let i = 0; i < N; i++) { const p = Math.max(est(L, i), est(R, i)); if (p > ceil) { need[i] = ceil / p; any = true; } }
  if (!any) return { L, R, maxReduction: 0 };
  // sliding-window min over [i, i+Lk] (monotone deque, scanning backwards)
  const mn = new Float32Array(N), dq = new Int32Array(N); let hd = 0, tl = 0;
  for (let i = N - 1; i >= 0; i--) {
    while (tl > hd && need[dq[tl - 1]] >= need[i]) tl--;
    dq[tl++] = i;
    while (dq[hd] > i + Lk) hd++;
    mn[i] = need[dq[hd]];
  }
  // box average over [i-Lk, i] (every term <= need[i], so result <= need[i])
  const oL = new Float32Array(N), oR = new Float32Array(N); let acc = 0, minG = 1;
  for (let i = 0; i < N; i++) {
    acc += mn[i]; if (i > Lk) acc -= mn[i - Lk - 1];
    const cnt = Math.min(i + 1, Lk + 1), g = acc / cnt; minG = Math.min(minG, g);
    oL[i] = L[i] * g; oR[i] = R[i] * g;
  }
  return { L: oL, R: oR, maxReduction: db(minG) };
}

const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const rmsDbOver = (L, R, mask) => { let s = 0, c = 0; for (let i = 0; i < L.length; i++) if (mask[i]) { s += L[i] * L[i] + R[i] * R[i]; c += 2; } return c ? db(Math.sqrt(s / c)) : null; };

/**
 * mix({duration, cues, voice?, music?, sfxLufs=-21, duckDb=-10, target=-16, truePeak=-1.5, out})
 * voice/music offset = film time at which the file starts (negative trims its head).
 * music: {file, offset=0, gainDb=0, loop=true, fadeIn=0.4, fadeOut=1.2, gapLufs=-23, licence}
 */
export async function mix({ duration, cues = [], voice, music, sfxLufs = -21, duckDb = -10, target = -16, truePeak = -1.5, out }) {
  if (!(duration > 0) || !out) throw new Error('mix: duration and out are required');
  const N = Math.round(duration * SR), warn = [];
  const Z = () => new Float32Array(N);

  // ---- voice (mono -> centre)
  let vL = Z(), vR = Z(), voiceMono = null;
  if (voice) {
    const [m] = place([decode(voice.file, 1)[0]], voice.offset ?? 0, N), g = lin(voice.gainDb ?? 0);
    voiceMono = m.map((v) => v * g); vL = voiceMono; vR = voiceMono;
  }
  // ---- music bed: raw level set so integrated loudness (no duck/fades) = gapLufs; then duck + fades
  let mL = Z(), mR = Z(), env = null, fadeEnv = null, musicRef = null;
  if (music) {
    const off = music.offset ?? 0, Nm = N - Math.round(Math.max(0, off) * SR);
    let [A, B] = loopTo(decode(music.file, 2), Nm, music.loop !== false, Math.max(0, -off));
    if (off > 0) [A, B] = place([A, B], off, N);
    else if (A.length < N) { const pad = (x) => { const o = Z(); o.set(x); return o; }; A = pad(A); B = pad(B); }
    musicRef = measure(interleave(A, B)).I;
    const g = lin((music.gapLufs ?? -23) + (music.gainDb ?? 0) - musicRef);
    env = voiceMono ? duckEnvelope(voiceMono, N, duckDb) : new Float32Array(N).fill(1);
    fadeEnv = Z();
    const fi = Math.round((music.fadeIn ?? 0.4) * SR), fo = Math.round((music.fadeOut ?? 1.2) * SR);
    for (let i = 0; i < N; i++) {
      const u = i < fi ? Math.sin(Math.PI / 2 * i / fi) : 1, v = N - 1 - i < fo ? Math.sin(Math.PI / 2 * (N - 1 - i) / fo) : 1;
      fadeEnv[i] = u * v;
    }
    mL = Z(); mR = Z();
    for (let i = 0; i < N; i++) { const k = g * env[i] * fadeEnv[i]; mL[i] = A[i] * k; mR[i] = B[i] * k; }
  }
  // ---- sfx bus levelled to sfxLufs (final gain)
  const sb = renderSfx(cues, N);
  let sL = sb.L, sR = sb.R;
  if (cues.length) {
    const I = measure(interleave(sL, sR)).I;
    if (isFinite(I)) { const g = lin(sfxLufs - I); sL = sL.map((v) => v * g); sR = sR.map((v) => v * g); }
    else warn.push('sfx bus silent');
  }
  if (sfxLufs < -24.5 || sfxLufs > -17.5) warn.push(`sfxLufs ${sfxLufs} outside the -18..-24 guidance`);

  // ---- master loop. With a voice, G scales the voice only (music/sfx are pinned to their final LUFS);
  // without one, G scales everything.
  const hasVoice = !!voice, vI = hasVoice ? measure(interleave(vL, vR)).I : 0;
  let G = hasVoice && isFinite(vI) ? target - vI : 0, ceilDb = truePeak - 0.15, res = null, m = null, iters = 0;
  const sumAt = (Gv) => {
    const gv = lin(Gv), gm = hasVoice ? 1 : gv, L = Z(), R = Z();
    for (let i = 0; i < N; i++) { L[i] = vL[i] * gv + (mL[i] + sL[i]) * gm; R[i] = vR[i] * gv + (mR[i] + sR[i]) * gm; }
    return [L, R];
  };
  let Gw = G, itersRun = 0;
  for (; iters < 5; iters++) {
    Gw = G; itersRun = iters + 1;
    const [L, R] = sumAt(G);
    res = limit(L, R, ceilDb);
    // 24-bit PCM WAV via ffmpeg (measure the written file: that is the deliverable)
    ff(['-y', '-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', 'pipe:0', '-c:a', 'pcm_s24le', out], Buffer.from(interleave(res.L, res.R).buffer));
    m = measure(out);
    const eI = target - m.I, eTP = m.TP - truePeak;
    if (Math.abs(eI) <= 0.3 && eTP <= 0) break;
    if (eTP > 0) ceilDb -= eTP + 0.1;
    if (Math.abs(eI) > 0.3) G += eI;
  }
  G = Gw; // report (and measure stems at) the gain of the file actually written
  if (Math.abs(target - m.I) > 0.5) warn.push(`integrated ${m.I} LUFS misses target ${target} by >0.5 LU`);
  if (m.TP > truePeak) warn.push(`true peak ${m.TP} dBFS exceeds ${truePeak}`);

  // ---- per-stem loudness at final gain
  const gv = lin(G), gm = hasVoice ? 1 : gv, stemI = (a, b, k) => (a ? measure(interleave(a.map((v) => v * k), b.map((v) => v * k))).I : null);
  const stems = {
    voice: hasVoice ? stemI(vL, vR, gv) : null,
    music: music ? stemI(mL, mR, gm) : null,
    sfx: cues.length ? stemI(sL, sR, gm) : null,
  };
  // ---- duck depth: music stem RMS in settled-speech frames vs settled-gap frames (excluding fades)
  let duck = null;
  if (music && voiceMono) {
    const dl = lin(duckDb), sp = new Uint8Array(N), gp = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (fadeEnv[i] > 0.999) { if (env[i] < dl * 1.1) sp[i] = 1; else if (env[i] > 0.95) gp[i] = 1; }
    // attenuation the duck really applies under speech: the ducked bed vs the SAME bed un-ducked, over the speech frames
    // (comparing speech frames with gap frames mixes in the music's own dynamics — kept as a second, informative number)
    const uL = new Float32Array(N), uR = new Float32Array(N);
    for (let i = 0; i < N; i++) { const k = env[i] > 1e-9 ? 1 / env[i] : 0; uL[i] = mL[i] * k; uR[i] = mR[i] * k; }
    const d = rmsDbOver(mL, mR, sp), u = rmsDbOver(uL, uR, sp);
    const a = rmsDbOver(mL, mR, sp), b = rmsDbOver(mL, mR, gp);
    duck = { depthDb: d !== null && u !== null ? +(d - u).toFixed(2) : null, speechVsGapDb: a !== null && b !== null ? +(a - b).toFixed(2) : null, requestedDb: duckDb, attackMs: 60, releaseMs: 350, holdMs: 150 };
  }
  const used = Object.entries(sb.used).map(([name, count]) => ({ name, generator: 'kinetype procedural synth', licence: LICENCE, paramsHash: hash(name, SOUNDS[name].gain, SOUNDS[name].description).toString(16).padStart(8, '0'), count }));
  const report = {
    out, duration, sampleRate: SR, format: 'wav pcm_s24le stereo',
    final: { I: m.I, TP: m.TP, LRA: m.LRA, target, truePeakLimit: truePeak, masterGainDb: +G.toFixed(2), limiterMaxReductionDb: +res.maxReduction.toFixed(2), iterations: itersRun },
    stems: { voiceLufs: stems.voice, musicLufs: stems.music, sfxLufs: stems.sfx, musicRawLufs: musicRef },
    duck, cueCount: cues.length, sounds: used,
    inputs: [voice && { role: 'voice', file: voice.file, sha256: sha(voice.file) }, music && { role: 'music', file: music.file, sha256: sha(music.file), licence: music.licence ?? null }].filter(Boolean),
    warnings: warn,
  };
  writeFileSync(`${out}.mix-report.json`, JSON.stringify(report, null, 2));
  return report;
}
