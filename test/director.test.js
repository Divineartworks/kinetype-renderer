// The director + compose pipeline: measured silences, editorial scoring,
// time alignment, grade match and a real splice on synthetic media.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { prepareWords, sentencesOf, quotability } from '../templates/kinetic-captions/speech.js';
import { annotatePauses } from '../src/cli/pauses.js';
import { alignOffset, fitGrade } from '../src/cli/compose.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-director-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const ff = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]);

test('pauses: silences hidden inside edge-to-edge word timings are measured', () => {
  // three 1.0 s tone "words" separated by 0.6 s of silence; the transcript
  // claims the words touch (whisper/DTW style)
  const wav = path.join(tmp, 'bursts.wav');
  ff(['-f', 'lavfi', '-i', "aevalsrc='if(lt(mod(t,1.6),1),0.5*sin(2*PI*440*t),0)':s=16000:d=4.8", wav]);
  const words = prepareWords([{ text: 'one', start: 0, end: 1.6 }, { text: 'two', start: 1.6, end: 3.2 }, { text: 'three', start: 3.2, end: 4.8 }]);
  annotatePauses(wav, words);
  for (const [w, at] of [[words[0], 1.3], [words[1], 2.9]]) {
    assert.ok(Math.abs(w.pauseAfter - 0.6) < 0.06, `pause ${w.pauseAfter}`);
    assert.ok(Math.abs(w.quietAt - at) < 0.05, `centre ${w.quietAt}`);
  }
});

test('sentences: a short tail after a dramatic pause folds into its line', () => {
  const W = (text, start, end, pauseAfter = 0) => ({ text, start, end, pauseAfter });
  const words = prepareWords([W('rejection', 0, 0.6), W('breeds', 0.6, 1.0), W('obsession', 2.2, 3.0), W('no', 4.0, 4.2), W('wonder', 4.2, 4.6), W('why', 4.6, 4.8)]);
  words[1].pauseAfter = 1.2; words[2].pauseAfter = 1.0;
  const u = sentencesOf(words);
  assert.equal(u[0].text, 'rejection breeds obsession');
});

test('quotability: complete, landing lines beat fragments that run on', () => {
  const mk = (text, gapBefore, gapAfter) => {
    const ws = prepareWords(text.split(' ').map((t, i) => ({ text: t, start: i * 0.4, end: i * 0.4 + 0.35 })));
    return { words: ws, start: 0, end: ws.length * 0.4, text, gapBefore, gapAfter };
  };
  const good = quotability(mk('rejection breeds obsession', 0.6, 1.0));
  const runOn = quotability(mk('rejection breeds obsession', 0.6, 0.1));
  const cut = quotability(mk('wake the fuck', 0.6, 0.1));
  assert.ok(good.score > runOn.score);
  assert.ok(runOn.reasons.includes('runs on'));
  assert.ok(cut.reasons.includes('cut phrase'));
});

test('compose: alignment finds a 4-frame offset and the grade LUT removes a colour shift', () => {
  const src = path.join(tmp, 'src.mp4'), base = path.join(tmp, 'base.mp4');
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=270x480:rate=30:duration=12', '-pix_fmt', 'yuv420p', src]);
  // base: starts 4 frames later (black lead) and is graded
  ff(['-f', 'lavfi', '-i', 'color=black:size=270x480:rate=30:duration=0.1333', '-i', src, '-filter_complex', '[1:v]eq=brightness=0.06:saturation=1.4:gamma=1.2,colorbalance=rs=0.1:bs=-0.1[g];[0:v][g]concat=n=2:v=1[v]', '-map', '[v]', '-pix_fmt', 'yuv420p', base]);
  const al = alignOffset(src, base, 30, { span: 10 });
  assert.equal(al.frames, 4, JSON.stringify(al));
  const g = fitGrade(src, base, al.offset, { samples: 10, tailGuard: 1 });
  assert.ok(g.after < g.before * 0.35, `grade error ${g.before} → ${g.after}`);
});

test('quotability: a line ending on a comma loses to the same line ending the sentence', () => {
  const mk = (raw) => {
    const ws = prepareWords(raw.split(' ').map((t, i) => ({ text: t, start: i * 0.4, end: i * 0.4 + 0.35 })));
    return { words: ws, start: 0, end: ws.length * 0.4, text: raw, gapBefore: 0.6, gapAfter: 0.9 };
  };
  const comma = quotability(mk('your life, your legacy,')), stop = quotability(mk('your life, your legacy.'));
  assert.ok(stop.score > comma.score + 2, `${stop.score} vs ${comma.score}`);
  assert.ok(comma.reasons.includes('ends mid-clause'));
});

test('prepareWords: an all-caps transcript gets its natural case back', () => {
  const ws = prepareWords("WHY DO YOU CHASE, I'M TELLING YOU. I KNOW IT WILL DEVASTATE YOU".split(' ').map((t, i) => ({ text: t, start: i, end: i + 0.5 })));
  assert.deepEqual(ws.slice(0, 6).map((w) => w.raw), ['why', 'do', 'you', 'chase,', "I'm", 'telling']);
  assert.equal(ws[7].raw, 'I');
  const mixed = prepareWords([{ text: 'Hello', start: 0 }, { text: 'NASA', start: 1 }]);
  assert.equal(mixed[1].raw, 'NASA');
});

test('speakerFocus: a single face keeps the normal centred layout (no focus)', { skip: process.platform !== 'darwin' }, async () => {
  const { speakerFocus } = await import('../src/cli/direct.js');
  const v = path.join(tmp, 'one.mp4');
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=4', '-shortest', '-pix_fmt', 'yuv420p', v]);
  assert.equal(speakerFocus(v, 0.5, 3.5), null);
});

test('mine: shorts start at a strong sentence start and end on a finished sentence', async () => {
  const { pickClips } = await import('../src/cli/mine.js');
  const S = ['So um we were talking about.', 'Rejection breeds obsession in every single man.', 'You chase her approval and lose your own value.', 'That is the trap nobody warns you about.', 'And then, like, whatever.', 'Protect your self-respect before you lose everything.', 'Walk away when the respect is gone.'];
  const raw = []; let t = 0;
  for (let rep = 0; rep < 3; rep++) for (const s of S) { for (const w of s.split(' ')) { raw.push({ text: w, start: +t.toFixed(2), end: +(t + 0.3).toFixed(2) }); t += 0.36; } t += 0.9; }
  const words = prepareWords(raw);
  words.forEach((w, i) => { const nx = words[i + 1]; w.pauseAfter = nx ? +(nx.start - w.end).toFixed(2) : 1; });
  const { clips } = pickClips(words, { count: 3, min: 8, max: 30 });
  assert.ok(clips.length >= 1);
  for (const c of clips) {
    const first = words.find((w) => Math.abs(w.start - c.start) < 0.01), prev = words[first.i - 1];
    assert.ok(!prev || prev.stop, `starts mid-sentence: ${c.hook}`);
    assert.ok(/[.!?]$/.test(c.payoff), `ends mid-sentence: ${c.payoff}`);
    assert.ok(!/\b(um|like)\b/i.test(c.hook), `filler hook: ${c.hook}`);
  }
});

test('relight --only-dark: a face already at a healthy mid-tone is left untouched; dark faces still get light', async () => {
  const { planLight } = await import('../src/cli/relight.js');
  const bright = planLight({ face: true, faceShare: 1, faceLuma: 0.5, sceneLuma: 0.5 }, 0.8, { onlyDark: true });
  assert.equal(bright.neutral, true);
  assert.match(bright.reason, /already bright/);
  assert.equal(bright.darkness, 0);
  const dark = planLight({ face: true, faceShare: 1, faceLuma: 0.1, sceneLuma: 0.08 }, 0.8, { onlyDark: true });
  assert.equal(dark.neutral, false);
  assert.ok(dark.darkness > 0.9 && dark.keyEV > 0.3);
  // without the flag a bright face still gets the gentle key (unchanged behaviour)
  assert.equal(planLight({ face: true, faceShare: 1, faceLuma: 0.5, sceneLuma: 0.5 }, 0.8).neutral, false);
});
