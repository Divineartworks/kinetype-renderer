// Resolve spec.media: images are served as-is; videos are decoded once into a
// cached JPEG sequence (covering the output frame) so the runtime can fetch
// exact frames. Cache: ~/.cache/kinetype/media/<hash>/ with a DONE marker.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ROOT } from './server.js';

const CACHE = process.env.KINETYPE_CACHE || path.join(os.homedir(), '.cache', 'kinetype', 'media');
const IMG = /\.(png|jpe?g|webp|gif|bmp|svg)$/i;

// SVG size without ffprobe: width/height attributes, else the viewBox
function svgSize(file) {
  const head = fs.readFileSync(file, 'utf8').match(/<svg\b[^>]*>/i)?.[0] || '';
  const num = (n) => { const m = head.match(new RegExp('\\b' + n + '\\s*=\\s*["\']\\s*([0-9.]+)(?!%)', 'i')); return m ? parseFloat(m[1]) : 0; };
  let w = num('width'), h = num('height');
  const vb = head.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if ((!w || !h) && vb) { w = w || parseFloat(vb[1]); h = h || parseFloat(vb[2]); }
  if (!w || !h) throw new Error(`svg without width/height or viewBox: ${file}`);
  return { w, h };
}

function probe(file) {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,avg_frame_rate,r_frame_rate,duration,pix_fmt,color_range,color_space:format=duration', '-of', 'json', file], { cwd: ROOT }).toString());
  const st = j.streams?.[0] || {};
  const rate = (st.avg_frame_rate && st.avg_frame_rate !== '0/0' ? st.avg_frame_rate : st.r_frame_rate) || '30/1';
  const [a, b] = rate.split('/').map(Number);
  const full = st.color_range === 'pc' || /^yuvj/.test(st.pix_fmt || '');
  const cs = String(st.color_space || '');
  const matrix = cs === 'bt709' ? 'bt709' : cs.startsWith('bt2020') ? 'bt2020' : 'bt601'; // bt601 = ffmpeg's own default for untagged/SD-tagged video, as compose.js
  return { w: st.width, h: st.height, fps: b ? a / b : a, duration: Number(st.duration || j.format?.duration || 0), full, matrix };
}

/** The ffmpeg -vf chain that turns the source into the cached JPEG frames (exported for tests). */
export function decodeFilter({ exact, p, fr, lut, f, native, W, H }) {
  const pre = exact ? `scale=in_color_matrix=${p.matrix}:in_range=${p.full ? 'full' : 'limited'},format=rgb24,` : '';
  const post = exact ? ',scale=out_color_matrix=bt601:out_range=full,format=yuvj420p' : '';
  return pre + (fr ? `crop=iw*${fr.w}:ih*${fr.h}:iw*${fr.x}:ih*${fr.y},` : '') + (lut ? `lut3d=file='${lut.replace(/'/g, "'\\''")}':interp=tetrahedral,` : '') + (native ? `fps=${f}` : `fps=${f},scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos`) + post;
}

/**
 * Keep the decoded-frame cache bounded (default 4 GB, KINETYPE_CACHE_MAX_GB):
 * services render through kinetype all day, and every render
 * leaves frames behind. Oldest first; never a dir touched in the last 2 h
 * (a render may be using it).
 */
export function pruneCache(maxBytes = (Number(process.env.KINETYPE_CACHE_MAX_GB) || 4) * 1e9) {
  if (!fs.existsSync(CACHE)) return { removed: 0 };
  const dirs = fs.readdirSync(CACHE).map((n) => path.join(CACHE, n)).filter((d) => fs.statSync(d).isDirectory()).map((d) => {
    let size = 0;
    for (const f of fs.readdirSync(d)) { try { size += fs.statSync(path.join(d, f)).size; } catch {} }
    return { d, size, mtime: fs.statSync(d).mtimeMs };
  }).sort((a, b) => a.mtime - b.mtime);
  let total = dirs.reduce((a, x) => a + x.size, 0), removed = 0;
  const fresh = Date.now() - 2 * 3600e3;
  for (const x of dirs) {
    if (total <= maxBytes) break;
    if (x.mtime > fresh) continue;
    fs.rmSync(x.d, { recursive: true, force: true });
    total -= x.size; removed++;
  }
  return { removed, total };
}

/**
 * @returns {Promise<Record<string, object>>} runtime media descriptors
 */
export async function resolveMedia(media, { specDir, roots, W, H, fps, duration }) {
  const out = {};
  try { pruneCache(); } catch { /* best effort: never fail a render over housekeeping */ }
  for (const [id, m] of Object.entries(media || {})) {
    if (m.capture) { out[id] = resolveCapture(id, path.resolve(specDir, m.capture), roots); continue; }
    const file = path.resolve(specDir, m.src);
    if (!fs.existsSync(file)) throw new Error(`media.${id}: file not found: ${file}`);
    const rootId = 'm' + crypto.createHash('sha1').update(id + file).digest('hex').slice(0, 8);
    if (IMG.test(file)) {
      roots[rootId] = path.dirname(file);
      const p = /\.svg$/i.test(file) ? svgSize(file) : probe(file);
      out[id] = { kind: 'image', url: `/__root/${rootId}/${encodeURIComponent(path.basename(file))}`, w: p.w, h: p.h };
      continue;
    }
    const p = probe(file);
    const start = m.start ?? 0, speed = m.speed ?? 1;
    const f = Math.min(fps, Math.round(p.fps * 1000) / 1000 || fps);
    const need = Math.min(Math.max(0.1, p.duration - start), (m.duration ?? duration) * speed + 1);
    const st = fs.statSync(file);
    // size 'cover' (default): frames scaled to cover the output frame (full-bleed use);
    // 'native': source dimensions kept (panels, picture-in-picture, contain fits)
    const native = m.size === 'native';
    // lut: a .cube colour transform applied while decoding (compose uses it to
    // match the footage to the grade of the video it is spliced into)
    const lut = m.lut ? path.resolve(specDir, m.lut) : null;
    if (lut && !fs.existsSync(lut)) throw new Error(`media.${id}: lut not found: ${lut}`);
    const lutHash = lut ? crypto.createHash('sha256').update(fs.readFileSync(lut)).digest('hex').slice(0, 16) : null;
    // frame: a reframe {x, y, w, h} (fractions of the source) — compose uses it to
    // match a base video that crops/zooms the source
    const fr = m.frame || null;
    // exact colour: decode with the source's own matrix/range into RGB, and write the JPEGs as real JFIF
    // (bt601, full range). Without it ffmpeg's implicit conversions read a bt709 video with the wrong matrix:
    // field report 2026-10-15 the windows came out 7-8 darker on the face than the base they were cut
    // from, the person check refused every window and the video was re-sealed with plain captions.
    // KINETYPE_EXACT_COLOUR=0 restores the old decode.
    const exact = process.env.KINETYPE_EXACT_COLOUR !== '0';
    const keyParts = [file, st.size, st.mtimeMs, start, need, native ? 'native' : [W, H], f, lutHash, fr];
    if (exact) keyParts.push('exact-colour-1');
    const key = crypto.createHash('sha256').update(JSON.stringify(keyParts)).digest('hex').slice(0, 24);
    const dir = path.join(CACHE, key);
    if (!fs.existsSync(path.join(dir, 'DONE'))) {
      fs.mkdirSync(dir, { recursive: true });
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(start), '-t', String(need), '-i', file,
        '-vf', decodeFilter({ exact, p, fr, lut, f, native, W, H }), '-q:v', '2', path.join(dir, '%06d.jpg')], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] });
      fs.writeFileSync(path.join(dir, 'DONE'), new Date().toISOString());
    }
    const frames = fs.readdirSync(dir).filter((n) => n.endsWith('.jpg')).length;
    let matte = false;
    if (m.matte) {
      // person matte per frame (Apple Vision, first-party, offline) → mNNNNNN.png with alpha = person
      if (!fs.existsSync(path.join(dir, 'DONE_MATTE'))) {
        const bin = ensureMatteTool();
        execFileSync(bin, [dir, m.matteQuality || 'accurate'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'], maxBuffer: 64 << 20 });
        fs.writeFileSync(path.join(dir, 'DONE_MATTE'), new Date().toISOString());
      }
      matte = true;
    }
    if (!frames) throw new Error(`media.${id}: no frames decoded from ${file}`);
    const first = probe(path.join(dir, '000001.jpg'));
    roots[rootId] = dir;
    out[id] = { kind: 'video', url: `/__root/${rootId}`, w: first.w, h: first.h, fps: f, frames, start, speed, loop: !!m.loop, matte, source: file };
  }
  return out;
}

/**
 * A kinetype.capture.v1 (recorded product UI): served as an exact frame
 * sequence at full device resolution. Preferred source: the capture's own
 * JPEG frames (no decode step, no generation loss, frame i ↔ t = i/fps by
 * construction). Fallback: capture.video decoded ONCE, frame for frame
 * (-fps_mode passthrough, never resampled), into the media cache.
 */
export function resolveCapture(id, file, roots) {
  if (!fs.existsSync(file)) throw new Error(`media.${id}: capture not found: ${file}`);
  const cap = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (cap.schema !== 'kinetype.capture.v1') throw new Error(`media.${id}: ${file} is not a kinetype.capture.v1 (schema: ${cap.schema})`);
  for (const k of ['fps', 'duration', 'device', 'events']) if (cap[k] == null) throw new Error(`media.${id}: capture has no "${k}"`);
  const base = path.dirname(file);
  const fr = cap.frames || {};
  const pattern = fr.pattern || 'f%06d.jpg';
  const name = (i) => pattern.replace(/%0(\d+)d/, (_, n) => String(i).padStart(Number(n), '0'));
  const fdir = path.resolve(base, fr.dir || 'frames');
  let dir = null, count = 0, w = fr.width, h = fr.height, source = 'frames';
  // first index: 0 by contract (frame i shows t = i/fps); tolerate a 1-based dump
  const first = fs.existsSync(path.join(fdir, name(0))) ? 0 : fs.existsSync(path.join(fdir, name(1))) ? 1 : null;
  if (first != null && fr.count && fs.existsSync(path.join(fdir, name(first + fr.count - 1)))) {
    dir = fdir; count = fr.count;
    if (first) { // re-index through the cache so the runtime sees 0-based frames
      throw new Error(`media.${id}: frames start at 1; kinetype.capture.v1 frames are 0-based (frame i shows t = i/fps)`);
    }
  } else if (cap.video?.src && fs.existsSync(path.resolve(base, cap.video.src))) {
    const vfile = path.resolve(base, cap.video.src);
    const st = fs.statSync(vfile);
    const key = crypto.createHash('sha256').update(JSON.stringify(['capture-v1', vfile, st.size, st.mtimeMs, pattern])).digest('hex').slice(0, 24);
    dir = path.join(CACHE, key);
    if (!fs.existsSync(path.join(dir, 'DONE'))) {
      fs.mkdirSync(dir, { recursive: true });
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', vfile, '-fps_mode', 'passthrough', '-q:v', '1', '-start_number', '0', path.join(dir, pattern)], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] });
      fs.writeFileSync(path.join(dir, 'DONE'), new Date().toISOString());
    }
    count = fs.readdirSync(dir).filter((n) => /\.(jpe?g|png)$/i.test(n)).length;
    const p = probe(path.join(dir, name(0)));
    w = p.w; h = p.h; source = 'video';
  } else {
    throw new Error(`media.${id}: capture ${file} has neither its frames (${path.relative(base, fdir)}/${name(0)} … ${fr.count ?? '?'} frames) nor a video`);
  }
  if (!count) throw new Error(`media.${id}: capture has no frames`);
  const rootId = 'c' + crypto.createHash('sha1').update(id + dir).digest('hex').slice(0, 8);
  roots[rootId] = dir;
  const { events, marks = [], steps = [], device, fps, duration, flow, app } = cap;
  // C2 v2 (native recordings): the wall clock, video-px mapping, dead air and the session offset ride along
  const v2 = Object.fromEntries(['clock', 'mapping', 'idle', 'busy', 'busySource', 'sessionOffset', 'video'].filter((k) => cap[k] != null).map((k) => [k, cap[k]]));
  return {
    kind: 'capture', url: `/__root/${rootId}`, pattern, w, h, fps, frames: count, source, file,
    capture: { schema: cap.schema, flow, app, device, fps, duration, events, marks, steps, frames: { count, width: w, height: h }, ...v2 },
  };
}

/** Compile the Vision matte tool once (macOS). */
/** Compile a first-party native tool (scripts/native/<name>.swift) once (macOS). */
export function ensureNativeTool(name) {
  const bin = path.join(os.homedir(), '.cache', 'kinetype', 'bin', name);
  const src = path.join(ROOT, 'scripts', 'native', `${name}.swift`);
  const stale = !fs.existsSync(bin) || fs.statSync(bin).mtimeMs < fs.statSync(src).mtimeMs;
  if (stale) {
    if (process.platform !== 'darwin') throw new Error(`${name} needs macOS (Apple Vision)`);
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    execFileSync('swiftc', ['-O', src, '-o', bin], { stdio: ['ignore', 'ignore', 'pipe'] });
  }
  return bin;
}

export function ensureMatteTool() {
  const bin = path.join(os.homedir(), '.cache', 'kinetype', 'bin', 'person_matte');
  const src = path.join(ROOT, 'scripts', 'native', 'person_matte.swift');
  const stale = !fs.existsSync(bin) || fs.statSync(bin).mtimeMs < fs.statSync(src).mtimeMs;
  if (stale) {
    if (process.platform !== 'darwin') throw new Error('person mattes need macOS (Apple Vision)');
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    execFileSync('swiftc', ['-O', src, '-o', bin], { stdio: ['ignore', 'ignore', 'pipe'] });
  }
  return bin;
}
