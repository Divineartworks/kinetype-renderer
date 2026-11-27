import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLrc, parseSrt, distribute, align } from '../src/cli/lyrics.js';
import { layoutQA } from '../src/cli/qa.js';

test('parseLrc: line and enhanced word timestamps', () => {
  const lines = parseLrc('[00:12.40]Hold the line\n[00:15.10]<00:15.10>Every <00:15.60>light\n[00:18.00]');
  assert.equal(lines.length, 2);
  assert.equal(lines[0].start, 12.4);
  assert.equal(lines[0].end, 15.1);
  assert.deepEqual(lines[1].words.map((w) => w.start), [15.1, 15.6]);
});

test('distribute: untimed words fill their line in order, inside the window', () => {
  const [l] = distribute(parseSrt('1\n00:00:01,000 --> 00:00:04,000\nnever meant to bend\n'));
  let prev = 0;
  for (const w of l.words) { assert.ok(w.start >= prev && w.start >= 1 && w.end <= 4.0001); prev = w.start; }
});

test('align: known lyrics map onto a noisy transcript', () => {
  const lyr = 'hold the line when the city sleeps'.split(' ').map((text) => ({ text }));
  const heard = 'uh hold da line when city sleeps'.split(' ').map((text) => ({ text }));
  const map = align(lyr, heard);
  assert.equal(map[0], 1); // hold
  assert.equal(map[2], 3); // line
  assert.equal(map[6], 6); // sleeps
  assert.equal(map[4], -1); // "the" was not heard
});

test('layoutQA: safe area, contrast and beat coverage fail when they should', () => {
  const info = { width: 1080, height: 1080, fps: 60, duration: 4, qa: {
    texts: [{ label: 'edge', box: { x0: 5, y0: 100, x1: 300, y1: 200 }, size: 80, fg: '#333333', bg: '#0A0A0A' }],
    hits: [{ t: 0 }, { t: 0.5 }], keyframes: [], notes: [], warnings: [] } };
  const r = layoutQA(info, { bpm: 120, rules: { beatCoverage: { dense: 4 } } });
  const by = Object.fromEntries(r.checks.map((c) => [c.id, c.status]));
  assert.equal(by['safe-area'], 'fail');
  assert.equal(by.contrast, 'fail');
  assert.equal(by['beat-coverage'], 'fail');
});

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const { python } = await import('../src/cli/audio.js');
const hasLibrosa = (() => { try { python(); return true; } catch { return false; } })();

test('audio analysis on a generated click track: 100 BPM grid, beats within 10 ms, correct downbeat phase', { timeout: 300000, skip: hasLibrosa ? false : 'no Python with librosa (set KINETYPE_PYTHON)' }, async () => {
  const { analyzeAudio } = await import('../src/cli/audio.js');
  const out = new URL('../fixtures/.test-click.analysis.json', import.meta.url).pathname;
  const a = await analyzeAudio(new URL('../fixtures/click-100bpm.wav', import.meta.url).pathname, { out });
  assert.ok(a.grid && Math.abs(a.grid.bpm - 100) < 0.2, JSON.stringify(a.grid));
  for (const b of a.beats) assert.ok(Math.abs(b - (0.3 + 0.6 * Math.round((b - 0.3) / 0.6))) < 0.01, `beat ${b}`);
  assert.ok(Math.abs(a.downbeats[0] - 0.3) < 0.01 || Math.abs(a.downbeats[0] - 2.7) < 0.01, `downbeat ${a.downbeats[0]}`);
  fs.rmSync(out, { force: true });
});
