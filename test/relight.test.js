// Studio relight: the pipeline keeps audio, duration and frame count, never
// touches a video with no person on camera, and leaves person-free frames
// nearly unchanged even when forced through the full Core Image pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const darwin = process.platform === 'darwin';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-relight-test-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const ff = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]);
const audioMd5 = (f) => execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-map', '0:a', '-c', 'copy', '-f', 'md5', '-']).toString().trim();
const frameAt = (f, t) => execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', 'scale=96:170,format=rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 24 });

const src = path.join(tmp, 'noperson.mp4');
ff(['-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=3',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src]);

test('relight: no person on camera → an exact copy (never a re-encode)', { skip: !darwin }, async () => {
  const { relight } = await import('../src/cli/relight.js');
  const out = path.join(tmp, 'copy.mp4');
  const r = await relight(src, { out, log: () => {} });
  assert.equal(r.changed, false);
  assert.deepEqual(fs.readFileSync(out), fs.readFileSync(src));
});

test('relight: the full pass keeps audio bit-exact, frame count, and a person-free frame nearly unchanged', { skip: !darwin }, async () => {
  const { relight } = await import('../src/cli/relight.js');
  const out = path.join(tmp, 'forced.mp4');
  // force a strong look through the pipeline: with no person the matte is
  // empty, so presence gating must keep the picture as it was
  const r = await relight(src, { out, log: () => {}, params: { subjectEV: 1, keyEV: 0.4, bgEV: -0.4, bgSaturation: 0.8, clarity: 0.2, gainG: 1.05, gainB: 0.95 } });
  assert.equal(r.changed, true);
  assert.equal(r.frames, 90);
  assert.equal(audioMd5(out), audioMd5(src));
  const a = frameAt(src, 1.5), b = frameAt(out, 1.5);
  let e = 0; for (let i = 0; i < a.length; i++) e += Math.abs(a[i] - b[i]);
  assert.ok(e / a.length < 3, `mean abs diff ${(e / a.length).toFixed(2)}`);
});
