// Cover frame selection + key word: pure logic on synthetic inputs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreFrame, rankFrames, coverWord } from '../src/cli/cover.js';
import { prepareWords } from '../templates/kinetic-captions/speech.js';

const face = (o = {}) => ({ x: 0.5, y: 0.4, w: 0.5, h: 0.35, q: 0.45, eyes: 0.3, mouth: 0.02, yaw: 0, pitch: 0, gaze: 0.03, ...o });
const stats = (o = {}) => ({ sharp: 100, luma: 0.4, ...o });

test('cover frames: eye contact, open eyes and a closed mouth beat looking up, blinking and mid-word', () => {
  const ref = { sharp: 100 };
  const good = scoreFrame(face(), stats(), ref).score;
  assert.ok(good > scoreFrame(face({ eyes: 0.08 }), stats(), ref).score, 'blink');
  assert.ok(good > scoreFrame(face({ pitch: -0.3, gaze: 0.08 }), stats(), ref).score, 'looking up');
  assert.ok(good > scoreFrame(face({ mouth: 0.1 }), stats(), ref).score, 'mid-word');
  assert.ok(good > scoreFrame(face({ x: 0.15 }), stats(), ref).score, 'off-centre');
  assert.ok(good > scoreFrame(face(), stats({ sharp: 30 }), ref).score, 'soft');
  assert.ok(good > scoreFrame(face(), stats({ luma: 0.08 }), ref).score, 'dark');
});

test('rankFrames: frames without a face are dropped; the best frame wins', () => {
  const r = rankFrames([
    { t: 1, face: null, stats: null },
    { t: 2, face: face({ eyes: 0.08 }), stats: stats() },
    { t: 3, face: face(), stats: stats() },
  ]);
  assert.equal(r.length, 2);
  assert.equal(r[0].t, 3);
});

test('coverWord: a title word wins; else a meaningful repeated word (never filler), with a real short line', () => {
  const mk = (s) => prepareWords(s.split(' ').map((t, i) => ({ text: t, start: i * 0.4, end: i * 0.4 + 0.35 })));
  const w = mk('blah blah blah blah blah you want the relationship. she wants the relationship too. blah blah');
  assert.equal(coverWord(w, { title: 'Her Approval' }).word, 'Approval');
  const c = coverWord(w, {});
  assert.equal(c.word.toLowerCase(), 'relationship');
  assert.ok(/relationship/i.test(c.line) && c.line.split(' ').length <= 8, c.line);
});
