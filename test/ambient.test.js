import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { COMMON } from '../src/ambient/glsl/common.js';
import { chromePath } from '../src/cli/browser.js';
import * as QA from '../src/ambient/calmqa.js';
import * as presets from '../src/ambient/presets/index.js';
import { randomize, breed } from '../src/ambient/variation.js';
import { writeLoopManifest, sha256File } from '../src/ambient/manifest.js';
import { seamCheck, frameHashes, framePixels, encoder, masterArgs, colourVf, colourTags } from '../src/ambient/render.js';
import { ambientRender, parseSeed } from '../src/ambient/cli.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const calm = { frames: 60, fps: 30, flash_pairs: 0, red_flash_pairs: 0, lum_rate_per_s: 0.008, motion_mean: 0.34 };
const seamOk = { beforeSeam: 1.2, acrossSeam: 1.21, afterSeam: 1.22, frameNmaxDiff: 0, frameNequalsFrame0: true };

test('calm gate: passes a calm case, fails flashing, red flash, fast motion and a broken seam', () => {
  assert.deepEqual(QA.gate(calm, seamOk), { status: 'pass', fails: [] });
  const bad = (m, s) => QA.gate({ ...calm, ...m }, s ?? seamOk);
  assert.equal(bad({ flash_pairs: 1 }).status, 'fail');
  assert.equal(bad({ red_flash_pairs: 2 }).status, 'fail');
  assert.equal(bad({ motion_mean: 2.5 }).status, 'fail');
  assert.equal(bad({ lum_rate_per_s: 0.05 }).status, 'fail');
  assert.equal(bad({}, { ...seamOk, frameNequalsFrame0: false }).status, 'fail');
  assert.equal(bad({}, { ...seamOk, acrossSeam: 9 }).status, 'fail');
  // the seam may be as busy as the loop itself, plus slack
  assert.equal(bad({}, { beforeSeam: 1, acrossSeam: 1.51, afterSeam: 1, frameNequalsFrame0: true }).status, 'pass');
});

test('calm gate fails closed on missing or non-finite metrics, short clips, missing seam and frame mismatch', () => {
  const g = (m, s = seamOk, o) => QA.gate(m, s, o);
  assert.equal(g(calm, seamOk, { expectedFrames: 60 }).status, 'pass');
  for (const k of ['flash_pairs', 'red_flash_pairs', 'lum_rate_per_s', 'motion_mean', 'frames', 'fps']) {
    const gone = { ...calm }; delete gone[k];
    assert.equal(g(gone).status, 'fail', `missing ${k}`);
    assert.equal(g({ ...calm, [k]: NaN }).status, 'fail', `NaN ${k}`);
    assert.equal(g({ ...calm, [k]: Infinity }).status, 'fail', `Infinity ${k}`);
  }
  assert.equal(g({ ...calm, lum_rate_per_s: null }).status, 'fail');
  assert.equal(g(null).status, 'fail');
  assert.equal(g({ ...calm, frames: 59 }).status, 'fail', 'shorter than 2 s');
  assert.equal(g(calm, null).status, 'fail', 'seam missing');
  assert.equal(g(calm, null, { requireSeam: false }).status, 'pass');
  assert.equal(g(calm, { ...seamOk, acrossSeam: NaN }).status, 'fail');
  const mm = g(calm, seamOk, { expectedFrames: 61 });
  assert.equal(mm.status, 'fail');
  assert.match(mm.fails.join(), /expected 61/);
});

test('flashPairs: slow swings are not flashes, fast opposing swings are', () => {
  const slow = Array.from({ length: 300 }, (_, i) => 0.5 + 0.5 * Math.sin((i / 300) * Math.PI * 2));
  assert.equal(QA.flashPairs(slow, 0.1, 30), 0);
  const fast = Array.from({ length: 60 }, (_, i) => (Math.floor(i / 5) % 2 ? 1 : 0));
  assert.ok(QA.flashPairs(fast, 0.1, 30) > 0);
});

function lavfi(dir, name, src, rate = 30) {
  const f = path.join(dir, name);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', src, '-t', '2', '-r', String(rate), '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', f]);
  return f;
}

test('calm QA analyse on synthetic clips', { timeout: 120000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ambient-qa-'));
  try {
    // black/white every 5 frames; the `select` flips on frame number
    const flashing = lavfi(dir, 'flash.mp4', "color=c=black:s=320x180:r=30,geq=lum='if(lt(mod(floor(N/5),2),1),0,255)':cb=128:cr=128");
    const still = lavfi(dir, 'still.mp4', 'color=c=0x336699:s=320x180:r=30');
    const red = lavfi(dir, 'red.mp4', "color=c=black:s=320x180:r=30,geq=lum='if(lt(mod(floor(N/5),2),1),16,81)':cb='if(lt(mod(floor(N/5),2),1),128,90)':cr='if(lt(mod(floor(N/5),2),1),128,240)'");
    const f = await QA.analyse(flashing);
    assert.ok(f.flash_pairs > 0, JSON.stringify(f));
    assert.equal(QA.gate(f, null, { requireSeam: false }).status, 'fail');
    const s = await QA.analyse(still);
    assert.equal(s.flash_pairs, 0);
    assert.equal(s.red_flash_pairs, 0);
    assert.equal(QA.gate(s, null, { requireSeam: false }).status, 'pass', JSON.stringify(s));
    assert.equal(typeof s.lum_rate_per_s, 'number', 'lum_rate is computed for a 2 s clip');
    const r = await QA.analyse(red);
    assert.ok(r.red_flash_pairs > 0, JSON.stringify(r));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('paramVectors maps u_p4/u_p5 params to six vectors and rejects unknown names', () => {
  const v = presets.paramVectors('living-still', { breath: 0.5, breathX: 0.25, breathY: 0.75, breathRadius: 0.1, coolWarm: -0.5 });
  assert.equal(v.length, 6);
  assert.deepEqual(v[5], [0.5, 0.25, 0.75, 0.1]);
  assert.equal(v[4][3], -0.5);
  assert.equal(presets.paramVectors('breath-mandala', { pulse: 0.001 })[0][0], 0.001);
  assert.throws(() => presets.paramVectors('living-still', { nope: 1 }), /no param "nope"/);
  for (const m of presets.list()) for (const d of Object.values(m.params)) assert.match(d.uniform, /^u_p[0-5]\.[xyzw]$/);
});

test('variation: randomize and breed are deterministic and stay in range', () => {
  const a = randomize({ count: 8, seed: 3 });
  assert.deepEqual(a, randomize({ count: 8, seed: 3 }));
  assert.notDeepEqual(a, randomize({ count: 8, seed: 4 }));
  const inRange = (e) => {
    const meta = presets.metaOf(e.preset);
    for (const [k, v] of Object.entries(e.params)) assert.ok(v >= meta.params[k].min && v <= meta.params[k].max, `${e.preset}.${k}=${v}`);
    assert.deepEqual(Object.keys(e.params).sort(), Object.keys(meta.params).sort());
  };
  a.forEach(inRange);
  const l = randomize({ count: 6, seed: 9, presets: ['living-still'] });
  assert.ok(l.every((e) => e.preset === 'living-still'));
  l.forEach(inRange);
  const c1 = breed(l[0], l[1], 5);
  assert.deepEqual(c1, breed(l[0], l[1], 5));
  assert.equal(c1.preset, 'living-still');
  inRange(c1);
  for (let s = 0; s < 40; s++) inRange(breed(l[2], l[3], s));
  assert.throws(() => breed({ preset: 'aurora-veil', seed: 1, params: {} }, l[0], 1), /different presets/);
});

const gl = chromePath() && process.env.KINETYPE_GL !== '0';
const skipGl = !gl && 'no Chrome / KINETYPE_GL=0';
const ALL = presets.list();

/** Tiny still + depth PNGs from ffmpeg lavfi sources (no canvas). */
function makeImages(dir) {
  const still = path.join(dir, 'still.png'), depth = path.join(dir, 'depth.png');
  const ff = (...a) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a]);
  ff('-f', 'lavfi', '-i', 'testsrc=s=96x54:d=1', '-frames:v', '1', still);
  ff('-f', 'lavfi', '-i', "nullsrc=s=96x54,format=gray,geq=lum='X*255/96'", '-frames:v', '1', depth);
  return [still, depth];
}

for (const meta of ALL) {
  test(`GPU: ${meta.id} loops by construction (unwrapped frame N == frame 0) and is deterministic`, { skip: skipGl, timeout: meta.id === 'living-still' ? 600000 : 240000 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ambient-gpu-'));
    try {
      const images = meta.images ? makeImages(dir) : [];
      const o = { preset: meta.id, width: 160, height: 90, loopSeconds: 2, fps: 10, seed: 3, images };
      const seam = await seamCheck(o);
      assert.equal(seam.frameNequalsFrame0, true, JSON.stringify(seam));
      assert.ok(seam.frameNmaxDiff <= 1);
      assert.equal(QA.gate(calm, seam).status, 'pass', JSON.stringify(seam));
      const idx = [0, 7, 13];
      const a = await frameHashes({ ...o, frames: idx });
      const b = await frameHashes({ ...o, frames: idx });
      assert.deepEqual(a, b);
      assert.notEqual(a[0], a[1], 'time must move the picture');
      const other = await frameHashes({ ...o, seed: 4, frames: idx });
      assert.notDeepEqual(a, other);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('GPU: living-still breath param changes the breath region (and only that region)', { skip: skipGl, timeout: 600000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ambient-breath-'));
  try {
    const images = makeImages(dir);
    const W = 160, H = 90;
    const o = { preset: 'living-still', width: W, height: H, loopSeconds: 2, fps: 10, seed: 3, images, frames: [0, 5] };
    const off = await framePixels({ ...o, params: { breath: 0 } });
    const on = await framePixels({ ...o, params: { breath: 1, breathRadius: 0.05 } });
    const region = (x0, x1, y0, y1, a, b) => {
      let d = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) for (let c = 0; c < 3; c++) d += Math.abs(a[(y * W + x) * 4 + c] - b[(y * W + x) * 4 + c]);
      return d;
    };
    const centre = [0, 1].map((k) => region(60, 100, 35, 55, off[k], on[k]));
    const corner = [0, 1].map((k) => region(0, 20, 0, 15, off[k], on[k]));
    assert.ok(centre.some((d) => d > 200), `breath must change the centre: ${centre}`);
    assert.deepEqual(corner, [0, 0], 'breath must not touch the far corner');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('GPU: a preset whose time is not loop-closed FAILS the seam check', { skip: skipGl, timeout: 240000 }, async () => {
  // 1.37 turns per loop: not an integer, so frame N (phase 1.0) differs from frame 0 and the wrap pops.
  const frag = `void main(){ float t = u_phase * 1.37; float x = gl_FragCoord.x / u_res.x; o = vec4(finish(vec3(0.25 + 0.2 * sin(TAU * (t + 3.0 * x))), 0.0), 1.0); }`;
  const seam = await seamCheck({ preset: 'breath-mandala', frag, width: 160, height: 90, loopSeconds: 2, fps: 10, seed: 1 });
  assert.equal(seam.frameNequalsFrame0, false, JSON.stringify(seam));
  assert.ok(seam.frameNmaxDiff > 1);
  assert.ok(seam.acrossSeam > 1.5 * Math.max(seam.beforeSeam, seam.afterSeam) + QA.LIMITS.seamSlack, `a pop is detectable: ${JSON.stringify(seam)}`);
  const v = QA.gate(calm, seam);
  assert.equal(v.status, 'fail');
  assert.ok(v.fails.length >= 2, v.fails.join());
});

test('sha256File streams the file in chunks (no readFileSync)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ambient-sha-'));
  try {
    const f = path.join(dir, 'big.bin');
    const buf = Buffer.alloc(5 * 1024 * 1024 + 123, 7);
    fs.writeFileSync(f, buf);
    const want = crypto.createHash('sha256').update(buf).digest('hex');
    assert.equal(await sha256File(f, { highWaterMark: 4096 }), want);
    assert.equal(await sha256File(f), want);
    const src = sha256File.toString();
    assert.ok(!/readFileSync|readFile\b/.test(src), 'must not read the whole file');
    assert.match(src, /createReadStream/);
    await assert.rejects(sha256File(path.join(dir, 'missing')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('colour: master args convert with bt709 / tv range, tag the stream, and a decode round-trips solid colours', { timeout: 120000 }, async () => {
  assert.match(colourVf('p010le'), /out_color_matrix=bt709:out_range=tv/);
  assert.deepEqual(colourTags, ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv']);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ambient-col-'));
  try {
    const colours = [[200, 60, 40], [30, 120, 200], [20, 20, 20], [235, 235, 235], [90, 200, 90]];
    const W = 160, H = 90, fps = 10, per = 3;
    const out = path.join(dir, 'c.mp4');
    const enc = masterArgs(fps, H);
    const e = encoder(W, H, fps, [...enc.args, out]);
    for (const c of colours) for (let k = 0; k < per; k++) {
      const f = Buffer.alloc(W * H * 4);
      for (let i = 0; i < W * H; i++) { f[i * 4] = c[0]; f[i * 4 + 1] = c[1]; f[i * 4 + 2] = c[2]; f[i * 4 + 3] = 255; }
      await e.sink(f);
    }
    await e.end();
    const pr = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=color_space,color_primaries,color_transfer,color_range,pix_fmt', '-of', 'json', out]).toString()).streams[0];
    assert.equal(pr.color_space, 'bt709');
    assert.equal(pr.color_primaries, 'bt709');
    assert.equal(pr.color_transfer, 'bt709');
    assert.equal(pr.color_range, 'tv');
    assert.equal(pr.pix_fmt, 'yuv420p10le');
    // decode back explicitly as bt709 / tv range and compare
    const raw = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', out, '-vf', 'scale=in_color_matrix=bt709:in_range=tv:out_range=pc,format=rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 28 });
    assert.equal(raw.length, W * H * 3 * colours.length * per);
    colours.forEach((c, ci) => {
      const o = ((ci * per + 1) * W * H + (H / 2) * W + W / 2) * 3;
      for (let k = 0; k < 3; k++) assert.ok(Math.abs(raw[o + k] - c[k]) <= 4, `colour ${c} channel ${k}: got ${raw[o + k]}`);
    });
    // a bt601 decode must NOT match for a saturated colour: proves the matrix really is bt709
    const wrong = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', out, '-vf', 'scale=in_color_matrix=bt601:in_range=tv:out_range=pc,format=rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 28 });
    const o0 = (1 * W * H + (H / 2) * W + W / 2) * 3;
    assert.ok(Math.abs(wrong[o0] - colours[0][0]) + Math.abs(wrong[o0 + 1] - colours[0][1]) > 8);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('seed validation: non-integer or negative seeds are rejected (exit 2) before any rendering', () => {
  assert.equal(parseSeed(undefined, 1), 1);
  assert.equal(parseSeed('4'), 4);
  assert.equal(parseSeed(0), 0);
  for (const bad of ['1.5', '-1', 'abc', true, NaN, '', 1.5, -2, '1e3', 2 ** 40]) assert.throws(() => parseSeed(bad), /--seed/, String(bad));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ambient-seed-'));
  try {
    for (const seed of ['1.5', '-3', 'x']) {
      const r = spawnSync('node', [path.join(REPO, 'bin/kinetype.js'), 'ambient', 'render', 'breath-mandala', '--seed', seed, '--loop', '2', '--out', path.join(dir, 'o')], { encoding: 'utf8' });
      assert.equal(r.status, 2, `${seed}: ${r.stderr}`);
      assert.match(r.stderr, /--seed/);
      assert.ok(!fs.existsSync(path.join(dir, 'o')), 'no output directory created');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('render end to end: 2 s loop, manifest, ffprobe facts, QA ran on the master, no partial left', { skip: skipGl, timeout: 300000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ambient-e2e-'));
  try {
    const r = await ambientRender('breath-mandala', { seed: 4, loop: 2, fps: 10, width: 160, height: 90, out: dir });
    assert.ok(['pass', 'fail'].includes(r.status));
    const files = fs.readdirSync(dir);
    assert.ok(!files.some((f) => /partial/.test(f)), files.join());
    const m = JSON.parse(fs.readFileSync(r.manifest, 'utf8'));
    assert.equal(m.calm_qa.status, r.status);
    assert.equal(m.frames, 20);
    assert.equal(m.loop_s, 2);
    assert.ok(Math.abs(m.duration_s - 2) < 0.15, String(m.duration_s));
    assert.equal(m.codec, 'hevc');
    assert.equal(m.pix_fmt, 'yuv420p10le');
    assert.equal(m.color_space, 'bt709');
    assert.equal(m.color_primaries, 'bt709');
    assert.equal(m.color_transfer, 'bt709');
    assert.equal(m.color_range, 'tv');
    assert.equal(m.sha256, await sha256File(r.file));
    assert.equal(m.calm_qa.report.analysed.sha256, m.sha256, 'QA measured the delivered master');
    assert.equal(m.calm_qa.report.analysed.frames, 20);
    const rc = JSON.parse(fs.readFileSync(r.receipt, 'utf8'));
    assert.equal(rc.frag_sha256, presets.fragSha256('breath-mandala'));
    assert.ok(rc.chrome && rc.ffmpeg.startsWith('ffmpeg version'));
    assert.equal(typeof rc.kinetype_dirty, 'boolean');
    const pr = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_packets', '-show_entries', 'stream=codec_name,pix_fmt,color_space,color_range,nb_read_packets,codec_type', '-of', 'json', r.file]).toString());
    assert.equal(pr.streams.length, 1, 'no audio stream');
    assert.equal(pr.streams[0].codec_name, 'hevc');
    assert.equal(pr.streams[0].pix_fmt, 'yuv420p10le');
    assert.equal(pr.streams[0].color_space, 'bt709');
    assert.equal(Number(pr.streams[0].nb_read_packets), 20);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('render failure leaves no partial and no manifest', { skip: skipGl, timeout: 120000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ambient-fail-'));
  try {
    await assert.rejects(ambientRender('living-still', { seed: 1, loop: 2, fps: 10, width: 160, height: 90, images: path.join(dir, 'missing.png') + ',' + path.join(dir, 'missing2.png'), out: dir }));
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('manifest: schema fields, probed facts, input hashes and sha256 match the files', { timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ambient-man-'));
  try {
    const file = path.join(dir, 'x-loop.mp4');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x336699:s=64x64:r=10', '-t', '2', '-vf', colourVf('yuv420p'), ...colourTags, '-c:v', 'libx264', file]);
    const qa = { status: 'pass', fails: [], metrics: calm, seam: seamOk, limits: QA.LIMITS, analysed: { file: 'x-loop.mp4', sha256: 'x', frames: 20 } };
    const loop = { loopSeconds: 2, fps: 10, width: 64, height: 64, pixFmt: 'yuv420p10le', codec: 'hevc_videotoolbox', renderer: 'test', chrome: 'Chrome/1', ms: 1 };
    const w = await writeLoopManifest({ file, preset: 'breath-mandala', seed: 4, params: {}, loop, qa, args: ['ambient', 'render'], ffmpeg: 'ffmpeg version test' });
    const m = JSON.parse(fs.readFileSync(w.manifestFile, 'utf8'));
    for (const k of ['schema', 'preset', 'seed', 'mode', 'file', 'sha256', 'frames', 'duration_s', 'loop_s', 'width', 'height', 'fps', 'pix_fmt', 'codec', 'color_space', 'color_primaries', 'color_transfer', 'color_range', 'params', 'calm_qa', 'receipt']) assert.ok(k in m, k);
    assert.equal(m.schema, 'visual_loop/v1');
    assert.equal(m.mode, 'generative_loop');
    assert.equal(m.sha256, await sha256File(file));
    assert.equal(m.frames, 20);
    assert.equal(m.loop_s, 2);
    assert.equal(m.color_space, 'bt709');
    assert.ok(Math.abs(m.duration_s - 2) < 0.15);
    assert.equal(m.calm_qa.status, 'pass');
    assert.ok(!('still_sha256' in m));
    const r = JSON.parse(fs.readFileSync(path.join(dir, m.receipt), 'utf8'));
    assert.equal(r.frag_sha256, presets.fragSha256('breath-mandala'));
    assert.equal(r.frag_sha256, crypto.createHash('sha256').update(COMMON + '\n' + presets.get('breath-mandala').FRAG).digest('hex'), 'covers COMMON + FRAG');
    assert.ok(r.kinetype_git_sha);
    assert.ok('kinetype_dirty' in r);
    assert.equal(r.chrome, 'Chrome/1');
    assert.equal(r.ffmpeg, 'ffmpeg version test');
    // living stills record both input hashes
    const [still, depth] = makeImages(dir);
    const l = await writeLoopManifest({ file, preset: 'living-still', seed: 1, params: {}, stillPath: still, depthPath: depth, loop, qa });
    const lm = JSON.parse(fs.readFileSync(l.manifestFile, 'utf8'));
    assert.equal(lm.mode, 'living_still');
    assert.equal(lm.still_sha256, await sha256File(still));
    assert.equal(lm.depth_sha256, await sha256File(depth));
    assert.notEqual(lm.still_sha256, lm.depth_sha256);
    assert.equal(l.receipt.inputs.length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
