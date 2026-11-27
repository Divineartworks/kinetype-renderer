// Voice Stage: a voice recording → a caption video where the type is the
// picture. Loudness, energy, look rotation, and a real (short) stage render.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loudnessOf, energyFor, stage } from '../src/cli/stage.js';
import { pickLook } from '../src/cli/direct.js';
import { prepareWords } from '../templates/kinetic-captions/speech.js';
import { chromePath } from '../src/cli/browser.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-stage-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const ff = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]);

test('loudness: the envelope follows the voice (quiet → 0, loud → 1) at 10 Hz', async () => {
  // 2 s quiet tone, then 2 s loud tone
  const wav = path.join(tmp, 'ramp.wav');
  ff(['-f', 'lavfi', '-i', "aevalsrc='if(lt(t,2),0.02,0.6)*sin(2*PI*220*t)':s=16000:d=4", wav]);
  const L = await loudnessOf(wav);
  assert.equal(L.hop, 0.1);
  assert.ok(Math.abs(L.values.length - 40) <= 1, `frames ${L.values.length}`);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(mean(L.values.slice(2, 18)) < 0.2, 'quiet half reads quiet');
  assert.ok(mean(L.values.slice(22, 38)) > 0.8, 'loud half reads loud');
});

test('energy: a rant goes wild, a calm talk stays signature', () => {
  const calm = prepareWords('the things that will surprise you are already on their way to you now'.split(' ').map((t, i) => ({ text: t, start: i * 0.4, end: i * 0.4 + 0.35 })));
  const rant = prepareWords('fuck all that shit it is fucking amazing what is coming now'.split(' ').map((t, i) => ({ text: t, start: i * 0.4, end: i * 0.4 + 0.35 })));
  const quiet = { values: Array(100).fill(0.4) };
  assert.equal(energyFor(calm, quiet).energy, 'signature');
  assert.equal(energyFor(rant, quiet).energy, 'wild');
  assert.equal(energyFor(calm, { values: Array(100).fill(0.9) }).energy, 'wild', 'shouting the whole way is wild too');
});

test('look rotation: avoid skips recently used looks, and says so', () => {
  const words = prepareWords('my heart broke when she left me alone at night and the breakup made me lonely love is strange'.split(' ').map((t, i) => ({ text: t, start: i * 0.4, end: i * 0.4 + 0.35 })));
  assert.equal(pickLook(words).look, 'neon');
  const r = pickLook(words, { avoid: ['neon'] });
  assert.notEqual(r.look, 'neon');
  assert.ok(r.reasons[0].startsWith('rotating away'), r.reasons.join('; '));
  // no tone signal: the general-purpose fallback also rotates
  const plain = prepareWords('so we went there and it was fine'.split(' ').map((t, i) => ({ text: t, start: i * 0.4, end: i * 0.4 + 0.35 })));
  assert.equal(pickLook(plain).look, 'cover');
  assert.notEqual(pickLook(plain, { avoid: ['cover'] }).look, 'cover');
});

test('stage: a short voice clip renders to a finished caption video with a receipt', { skip: !chromePath() && 'no Chrome', timeout: 240000 }, async () => {
  const wav = path.join(tmp, 'voice.wav');
  ff(['-f', 'lavfi', '-i', "aevalsrc='(0.2+0.4*abs(sin(2*PI*1.3*t)))*sin(2*PI*180*t)':s=48000:d=3.2", wav]);
  const words = [['Welcome', 0.2, 0.7], ['the', 0.7, 0.85], ['new', 0.85, 1.1], ['chapter.', 1.1, 1.8], ['Open', 2.0, 2.3], ['arms.', 2.3, 2.9]].map(([text, start, end]) => ({ text, start, end }));
  const wordsPath = path.join(tmp, 'voice.words.json');
  fs.writeFileSync(wordsPath, JSON.stringify(words));
  const out = path.join(tmp, 'voice-stage.mp4');
  const r = await stage(wav, { words: wordsPath, look: 'poster', energy: 'signature', out, log: () => {} });
  assert.equal(r.kind, 'kinetype.stage_receipt.v1');
  assert.equal(r.look, 'poster');
  assert.equal(r.coldOpen, null, 'no cold open under a minute');
  assert.equal(r.verdict, 'pass', JSON.stringify(r.bodyVerdict));
  const pr = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', out]).toString());
  const v = pr.streams.find((s) => s.codec_type === 'video');
  assert.deepEqual([v.width, v.height], [1080, 1920]);
  assert.ok(pr.streams.some((s) => s.codec_type === 'audio'), 'voice is in the video');
  assert.ok(Math.abs(Number(pr.format.duration) - 3.2) < 0.15, `duration ${pr.format.duration}`);
  assert.ok(fs.existsSync(out.replace(/\.mp4$/, '.receipt.json')));
});
