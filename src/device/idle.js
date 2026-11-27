// Idle / busy detection for a recorded phone-screen video (contract "C2 v2").
//   idle: [t0,t1] ranges with no meaningful pixel change (masked regions excluded: status-bar clock,
//         a blinking caret in a focused field).
//   busy: ranges where change is confined to a small region and keeps changing while the rest is
//         static (spinner / skeleton), not explained by an input event; unioned with DOM-reported
//         aria-busy / progressbar ranges.
// Pixels are compared on a downscaled gray stream (streamed from ffmpeg, never fully buffered).
// Frame i is compared with frame i-1 and sits at t = i/fps, so a static run i..j spans (i-1)/fps..j/fps.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const r3 = (x) => Math.round(x * 1000) / 1000;
const PIX = 12; // abs gray diff above which a pixel counts as changed

async function probe(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=width,height,r_frame_rate,avg_frame_rate', '-of', 'json', file]);
  const s = JSON.parse(stdout).streams?.[0];
  if (!s) throw new Error(`no video stream in ${file}`);
  const rate = (v) => { const [a, b] = String(v || '0/1').split('/').map(Number); return b ? a / b : 0; };
  return { width: s.width, height: s.height, fps: rate(s.avg_frame_rate) || rate(s.r_frame_rate) };
}

export async function frameDiffs(videoFile, { scaleWidth = 270, masks = [], fps } = {}) {
  const p = await probe(videoFile);
  fps = fps || p.fps;
  const { width, height } = p;
  const sw = Math.min(scaleWidth, width), scale = sw / width;
  const sh = 2 * Math.round(height * scale / 2); // ffmpeg scale=W:-2 rounds to even
  const fsz = sw * sh;
  const ms = masks.map((m) => ({
    x0: Math.max(0, Math.floor(m.x * scale)), x1: Math.min(sw, Math.ceil((m.x + m.w) * scale)),
    y0: Math.max(0, Math.floor(m.y * scale)), y1: Math.min(sh, Math.ceil((m.y + m.h) * scale)),
    t0: m.t0 ?? -Infinity, t1: m.t1 ?? Infinity,
  }));
  const frames = [];
  const ff = spawn('ffmpeg', ['-v', 'error', '-i', videoFile, '-vf', `scale=${sw}:-2:flags=area,format=gray`,
    '-f', 'rawvideo', '-threads', '2', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let err = ''; ff.stderr.on('data', (d) => { err += d; });
  const done = new Promise((res, rej) => { ff.on('error', rej); ff.on('close', (c) => (c ? rej(new Error(`ffmpeg exit ${c}: ${err}`)) : res())); });
  let prev = null, pend = Buffer.alloc(0), i = 0;
  const mask = new Uint8Array(fsz);
  const onFrame = (cur) => {
    if (prev) {
      const t = i / fps;
      mask.fill(0);
      let masked = 0;
      for (const m of ms) if (t >= m.t0 && t <= m.t1) {
        for (let y = m.y0; y < m.y1; y++) for (let x = m.x0; x < m.x1; x++) mask[y * sw + x] = 1;
      }
      for (let k = 0; k < fsz; k++) masked += mask[k];
      let area = 0, x0 = sw, y0 = sh, x1 = -1, y1 = -1;
      for (let y = 0, k = 0; y < sh; y++) for (let x = 0; x < sw; x++, k++) {
        if (!mask[k] && Math.abs(cur[k] - prev[k]) > PIX) { area++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      const bbox = area ? { x: Math.floor(x0 / scale), y: Math.floor(y0 / scale), w: Math.ceil((x1 - x0 + 1) / scale), h: Math.ceil((y1 - y0 + 1) / scale) } : null;
      frames.push({ i, t: r3(t), changed: area / Math.max(1, fsz - masked), area, bbox });
    }
    prev = cur; i++;
  };
  for await (const chunk of ff.stdout) {
    pend = pend.length ? Buffer.concat([pend, chunk]) : chunk;
    let o = 0;
    while (pend.length - o >= fsz) { onFrame(Uint8Array.from(pend.subarray(o, o + fsz))); o += fsz; }
    pend = pend.subarray(o);
  }
  await done;
  return { fps, width, height, scale, frames };
}

// Group sorted frame indices into runs, allowing up to `gap` missing frames between members.
const runsOf = (idx, gap) => {
  const out = [];
  for (const i of idx) { const l = out[out.length - 1]; if (l && i - l[1] <= gap + 1) l[1] = i; else out.push([i, i]); }
  return out;
};

export function idleRanges(diffs, { minIdle = 0.3, threshold = 0.0005 } = {}) {
  const { fps, frames } = diffs;
  return runsOf(frames.filter((f) => f.changed < threshold).map((f) => f.i), 0)
    .map(([a, b]) => [r3((a - 1) / fps), r3(b / fps)]).filter(([a, b]) => b - a >= minIdle - 1e-9);
}

const inWindow = (t, events) => events.some((e) => t >= e.t - 1e-9 && t <= (e.t1 ?? e.t + 0.5) + 1e-9);

const unionBox = (a, b) => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

export function busyRanges(diffs, { minBusy = 0.3, maxArea = 0.06, minChanged = 0.0005, events = [], dom = [] } = {}) {
  const { fps, width, height, frames } = diffs;
  const full = width * height;
  const loc = frames.filter((f) => f.bbox && f.changed >= minChanged && (f.bbox.w * f.bbox.h) / full <= maxArea && !inWindow(f.i / fps, events));
  const px = runsOf(loc.map((f) => f.i), 2).map(([a, b]) => {
    const bbox = loc.filter((f) => f.i >= a && f.i <= b).map((f) => f.bbox).reduce(unionBox);
    return { t0: r3((a - 1) / fps), t1: r3(b / fps), source: 'pixels', bbox };
  }).filter((r) => r.t1 - r.t0 >= minBusy - 1e-9);
  const all = [...px, ...dom.map(([t0, t1]) => ({ t0: r3(t0), t1: r3(t1), source: 'dom' }))].sort((a, b) => a.t0 - b.t0);
  const out = [];
  for (const r of all) {
    const l = out[out.length - 1];
    if (l && r.t0 <= l.t1) {
      l.t1 = Math.max(l.t1, r.t1);
      if (l.source !== r.source) l.source = 'both';
      if (r.bbox) l.bbox = l.bbox ? unionBox(l.bbox, r.bbox) : r.bbox;
    } else out.push({ ...r });
  }
  return out;
}

const quant = (xs, q) => (xs.length ? xs[Math.min(xs.length - 1, Math.floor(q * xs.length))] : 0);

export async function detectIdleBusy(videoFile, { masks = [], events = [], dom = [], scaleWidth, fps, ...opts } = {}) {
  const diffs = await frameDiffs(videoFile, { scaleWidth, masks, fps });
  const sorted = diffs.frames.map((f) => f.changed).sort((a, b) => a - b);
  return {
    idle: idleRanges(diffs, opts),
    busy: busyRanges(diffs, { ...opts, events, dom }),
    stats: { frames: diffs.frames.length + 1, fps: diffs.fps, medianChanged: quant(sorted, 0.5), p95Changed: quant(sorted, 0.95) },
  };
}

const EDIT = new Set(['type', 'fill']);
const RELEASE = new Set(['click', 'swipe', 'fling', 'navigate', 'back']);

// A focused field's caret blinks forever: mask the field from the edit event until focus moves on.
export function caretMasks(events = []) {
  const out = [];
  events.forEach((e, k) => {
    if (!e.vbox || !(EDIT.has(e.type) || (e.type === 'click' && e.editable === true))) return;
    const next = events.slice(k + 1).find((n) => RELEASE.has(n.type) && n.t > e.t);
    const { x, y, w, h } = e.vbox;
    const m = { x: x - 4, y: y - 4, w: w + 8, h: h + 8, t0: e.t };
    if (next) m.t1 = next.t;
    out.push(m);
  });
  return out;
}

export const statusBarMask = ({ width, statusBarPx }) => ({ x: 0, y: 0, w: width, h: statusBarPx });
