// Small ffmpeg helpers for the device lane: decode an image or a video frame to RGB24, probe a video,
// and read exact frames of a CFR video.
import { spawn, spawnSync } from 'node:child_process';

function run(args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-threads', '2', ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = []; let err = '';
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (c) => (c === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg: ${err.trim()}`))));
    p.stdin.on('error', () => {});
    if (input) p.stdin.end(input); else p.stdin.end();
  });
}

export function probeVideo(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=width,height,r_frame_rate,nb_read_packets,codec_name,pix_fmt:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffprobe ${file}: ${r.stderr}`);
  const j = JSON.parse(r.stdout); const s = j.streams[0];
  const [a, b] = s.r_frame_rate.split('/').map(Number);
  return { width: s.width, height: s.height, fps: a / b, frames: Number(s.nb_read_packets), codec: s.codec_name, pixFmt: s.pix_fmt, duration: Number(j.format.duration) };
}

/** PNG/JPEG buffer → {rgb, width, height} (optionally resampled to `size`). */
export async function decodeImage(buf, size = null) {
  let width, height;
  if (buf[0] === 0x89 && buf[1] === 0x50) { width = buf.readUInt32BE(16); height = buf.readUInt32BE(20); }
  if (size) ({ width, height } = size);
  const rgb = await run(['-i', 'pipe:0', ...(size ? ['-vf', `scale=${size.width}:${size.height}:flags=area`] : []), '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], buf);
  if (!width) {
    const { jpegSize } = await import('../capture/jpeg.js');
    ({ width, height } = jpegSize(buf));
  }
  if (rgb.length !== width * height * 3) throw new Error(`decodeImage: ${rgb.length} bytes for ${width}x${height}`);
  return { rgb, width, height };
}

/** Frames [first, first+count) of a CFR video → [{rgb, width, height, index}] (accurate seek: decodes from the
 * keyframe before `first`, output starts exactly at frame `first`). */
export async function videoFrames(file, first, count, info = probeVideo(file), { scale = 1 } = {}) {
  const t = Math.max(0, (first - 0.25) / info.fps);
  const w = Math.round(info.width * scale / 2) * 2, h = Math.round(info.height * scale / 2) * 2;
  const buf = await run(['-ss', t.toFixed(6), '-i', file, '-frames:v', String(count), '-fps_mode', 'passthrough', ...(scale !== 1 ? ['-vf', `scale=${w}:${h}:flags=area`] : []), '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
  const width = scale !== 1 ? w : info.width, height = scale !== 1 ? h : info.height;
  const fsz = width * height * 3;
  const out = [];
  for (let k = 0; k * fsz < buf.length; k++) out.push({ rgb: buf.subarray(k * fsz, (k + 1) * fsz), width, height, index: first + k });
  return out;
}

/** Frame `index` of a CFR video → {rgb, width, height}. */
export async function videoFrame(file, index, info = probeVideo(file)) {
  const [f] = await videoFrames(file, index, 1, info);
  if (!f || f.rgb.length !== info.width * info.height * 3) throw new Error(`videoFrame ${index}: no frame`);
  return f;
}

/** Write an RGB image as PNG, plus a copy with outlined boxes ({x,y,w,h,color}) — ffmpeg only, no fonts needed. */
export async function writeAnnotated(img, rawPng, annotatedPng, boxes = []) {
  const src = ['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${img.width}x${img.height}`, '-i', 'pipe:0'];
  await run(['-y', ...src, '-frames:v', '1', rawPng], img.rgb);
  const draw = boxes.slice(0, 60).map((b) => `drawbox=x=${Math.round(b.x)}:y=${Math.round(b.y)}:w=${Math.max(2, Math.round(b.w))}:h=${Math.max(2, Math.round(b.h))}:color=${b.color || 'red'}:t=3`).join(',');
  await run(['-y', ...src, ...(draw ? ['-vf', draw] : []), '-frames:v', '1', annotatedPng], img.rgb);
}

