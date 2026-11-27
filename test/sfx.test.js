import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SOUNDS, SR, key } from '../src/audio/sfx/synth.js';
import { analyze } from '../src/audio/sfx/analyze.js';
import { placeSfx } from '../src/audio/sfx/place.js';
import { mix } from '../src/audio/sfx/mix.js';

const sha = (f32) => createHash('sha256').update(Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength)).digest('hex');
const TMP = '/tmp/claude-1001/edit-sfx/test';
mkdirSync(TMP, { recursive: true });

function wav(file, chans, sr = SR) { // 16-bit PCM WAV writer
  const n = chans[0].length, nc = chans.length, b = Buffer.alloc(44 + n * nc * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * nc * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(nc, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * nc * 2, 28);
  b.writeUInt16LE(nc * 2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * nc * 2, 40);
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, chans[c][i])) * 32767), 44 + (i * nc + c) * 2);
  writeFileSync(file, b);
}

test('every sound is deterministic, clean (no clip/DC) and sane in length', () => {
  for (const [name, def] of Object.entries(SOUNDS)) {
    const a = def.gen(7, { ch: 'a', dur: 0.3 }), b = def.gen(7, { ch: 'a', dur: 0.3 }), c = def.gen(8, { ch: 'a', dur: 0.3 });
    assert.equal(sha(a), sha(b), `${name} not bit-identical`);
    assert.notEqual(sha(a), sha(c), `${name} ignores seed`);
    const s = analyze(a);
    assert.ok(s.peakDb <= -0.5 && s.peakDb > -6, `${name} peak ${s.peakDb}`);
    assert.ok(Math.abs(s.dc) < 0.005 * Math.pow(10, s.peakDb / 20), `${name} DC ${s.dc}`);
    assert.ok(a.every(Number.isFinite));
    assert.equal(a[0], 0); // faded in
  }
  assert.ok(analyze(SOUNDS.tap.gen(1)).dur <= 0.05);
  assert.ok(analyze(SOUNDS.success.gen(1)).dur <= 0.7);
});

test('key variation: chars differ, same char+seed identical, variants distinct', () => {
  assert.equal(sha(key(3, 'a')), sha(key(3, 'a')));
  assert.notEqual(sha(key(3, 'a')), sha(key(3, 'b')));
  const c = (ch) => analyze(key(3, ch)).centroid;
  assert.ok(c(' ') < c('a'), 'space should be darker than a letter');
  assert.ok(analyze(key(3, 'a')).dur >= 0.015 && analyze(key(3, '\n')).dur <= 0.036);
});

test('placement: counts, key timing, exclusion, dedupe, purity', () => {
  const ev = [
    { t: 1, type: 'tap' },
    { t: 1.01, type: 'tap' },                                  // deduped (<30 ms)
    { t: 2, type: 'type', t1: 2.5, text: 'hello' },
    { t: 3, type: 'type', keys: [{ t: 3, ch: 'a' }, { t: 3.01, ch: 'b' }, { t: 3.2, ch: 'c' }] }, // 'b' too dense
    { t: 4, type: 'swipe', t1: 4.9 },
    { t: 5, type: 'mark', kind: 'notify' },
    { t: 6, type: 'mark', kind: 'success' },
    { t: 7, type: 'mark', kind: 'counter', t1: 8, count: 10 },
    { t: 9, type: 'cut' },
  ];
  const frozen = JSON.stringify(ev), cues = placeSfx(ev);
  assert.equal(JSON.stringify(ev), frozen);
  assert.deepEqual(cues, placeSfx(ev));
  const by = (s) => cues.filter((c) => c.sound === s);
  assert.equal(by('tap').length, 1);
  assert.equal(by('key').filter((c) => c.t >= 2 && c.t <= 2.52).length, 5);
  assert.deepEqual(by('key').filter((c) => c.t >= 3 && c.t < 3.3).map((c) => c.ch), ['a', 'c']);
  for (const c of by('key').filter((c) => c.t < 2.6)) assert.ok(c.t >= 2 - 1e-9 && c.t <= 2.5 + 0.0121);
  assert.equal(by('swipe')[0].dur, 0.5);
  assert.equal(by('notify').length, 1);
  assert.equal(by('success').length, 1);
  assert.equal(by('tick').length, 10);
  assert.equal(by('whoosh-cut').length, 0);
  assert.equal(placeSfx(ev, { cutSounds: true }).filter((c) => c.sound === 'whoosh-cut').length, 1);
  assert.ok(cues.every((c, i) => i === 0 || c.t >= cues[i - 1].t));
  const keys = by('key');
  for (let i = 1; i < keys.length; i++) assert.ok(keys[i].t - keys[i - 1].t >= 0.028 - 1e-9);
  const ex = placeSfx(ev, { exclude: [[1.9, 3.5]] });
  assert.ok(ex.every((c) => c.t < 1.9 || c.t > 3.5));
  assert.ok(ex.length < cues.length);
});

// speech-like: AM harmonic tone bursts with silent gaps
function synthVoice(sec) {
  const n = Math.round(sec * SR), x = new Float32Array(n);
  const bursts = [[1.0, 2.2], [3.0, 4.2], [5.0, 6.2]];
  for (let i = 0; i < n; i++) {
    const t = i / SR, b = bursts.find(([a, e]) => t >= a && t < e);
    if (!b) continue;
    const env = Math.min(1, (t - b[0]) / 0.03, (b[1] - t) / 0.05) * (0.65 + 0.35 * Math.sin(2 * Math.PI * 3.5 * t));
    let v = 0; for (let h = 1; h <= 8; h++) v += Math.sin(2 * Math.PI * 140 * h * t) / h;
    x[i] = 0.25 * env * v;
  }
  return x;
}
function synthMusic(sec) {
  const n = Math.round(sec * SR), L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR; let l = 0, r = 0;
    [220, 277.18, 329.63, 440].forEach((f, k) => { l += Math.sin(2 * Math.PI * f * t + k); r += Math.sin(2 * Math.PI * f * 1.002 * t + k * 2); });
    L[i] = 0.2 * l; R[i] = 0.2 * r;
  }
  return [L, R];
}

test('mix: voice + music + sfx lands on -16 LUFS, TP safe, sfx stem in range, duck depth ~-10 dB', async () => {
  const D = 7.5;
  wav(`${TMP}/voice.wav`, [synthVoice(D)]);
  wav(`${TMP}/music.wav`, synthMusic(4)); // shorter than D -> exercises looping
  const cues = placeSfx([
    { t: 0.5, type: 'tap' }, { t: 1.2, type: 'type', t1: 1.9, text: 'hello' }, { t: 3.2, type: 'swipe', t1: 3.6 },
    { t: 4.5, type: 'mark', kind: 'notify' }, { t: 5.2, type: 'mark', kind: 'counter', t1: 6, count: 8 }, { t: 6.5, type: 'mark', kind: 'success' },
  ]);
  const out = `${TMP}/mix.wav`;
  const rep = await mix({ duration: D, cues, voice: { file: `${TMP}/voice.wav` }, music: { file: `${TMP}/music.wav`, licence: 'synthetic test' }, out });
  assert.ok(Math.abs(rep.final.I - -16) <= 0.5, `I=${rep.final.I}`);
  assert.ok(rep.final.TP <= -1.5, `TP=${rep.final.TP}`);
  assert.ok(rep.stems.sfxLufs >= -24 && rep.stems.sfxLufs <= -18, `sfx=${rep.stems.sfxLufs}`);
  assert.ok(rep.duck.depthDb <= -8 && rep.duck.depthDb >= -12, `duck=${rep.duck.depthDb}`);
  assert.equal(rep.cueCount, cues.length);
  assert.ok(rep.sounds.every((s) => /no third-party samples/.test(s.licence)));
  assert.equal(rep.inputs.length, 2);
  assert.equal(JSON.parse(readFileSync(`${out}.mix-report.json`)).final.I, rep.final.I);
  // deterministic output
  const out2 = `${TMP}/mix2.wav`;
  await mix({ duration: D, cues, voice: { file: `${TMP}/voice.wav` }, music: { file: `${TMP}/music.wav` }, out: out2 });
  assert.equal(sha(new Float32Array(readFileSync(out).buffer.slice(0, 4 * Math.floor(readFileSync(out).length / 4)))), sha(new Float32Array(readFileSync(out2).buffer.slice(0, 4 * Math.floor(readFileSync(out2).length / 4)))));
});

test('mix: works with sfx only and with music only', async () => {
  const cues = placeSfx([{ t: 0.3, type: 'tap' }, { t: 0.8, type: 'mark', kind: 'notify' }, { t: 1.6, type: 'mark', kind: 'success' }]);
  const a = await mix({ duration: 3, cues, out: `${TMP}/sfx-only.wav` });
  assert.ok(Math.abs(a.final.I - -16) <= 0.5 && a.final.TP <= -1.5, JSON.stringify(a.final));
  const b = await mix({ duration: 3, cues: [], music: { file: `${TMP}/music.wav` }, out: `${TMP}/music-only.wav` });
  assert.ok(Math.abs(b.final.I - -16) <= 0.5 && b.final.TP <= -1.5, JSON.stringify(b.final));
});
