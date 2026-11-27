// Synthetic gray test videos: draw(i, t, buf) paints each frame into a width*height Uint8Array, piped to ffmpeg/x264.
import { spawn } from 'node:child_process';

export const fillRect = (buf, width, x, y, w, h, v) => {
  const height = buf.length / width;
  for (let yy = Math.max(0, y); yy < Math.min(height, y + h); yy++) buf.fill(v, yy * width + Math.max(0, x), yy * width + Math.min(width, x + w));
};

export async function synthVideo(file, { width = 360, height = 800, fps = 30, seconds, draw }) {
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${width}x${height}`, '-r', String(fps),
    '-i', 'pipe:0', '-threads', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12', '-pix_fmt', 'yuv420p', file], { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = ''; ff.stderr.on('data', (d) => { err += d; });
  const done = new Promise((res, rej) => { ff.on('error', rej); ff.on('close', (c) => (c ? rej(new Error(`ffmpeg exit ${c}: ${err}`)) : res())); });
  ff.stdin.on('error', () => {});
  const n = Math.round(seconds * fps);
  for (let i = 0; i < n; i++) {
    const buf = new Uint8Array(width * height);
    draw(i, i / fps, buf);
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await done;
}
