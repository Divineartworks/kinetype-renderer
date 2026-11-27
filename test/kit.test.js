import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as K from '../src/kit/index.js';

const buf = (f) => { const b = fs.readFileSync(new URL(`../fonts/files/${f}`, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

test('springStep: starts at rest, settles EXACTLY to 1 (loop seams depend on it)', () => {
  for (const [f, z] of [[2.4, 0.55], [3.6, 1], [0.9, 1], [1.5, 1.6]]) {
    assert.equal(K.springStep(0, f, z), 0);
    assert.equal(K.springStep(-1, f, z), 0);
    assert.equal(K.springStep(K.springSettle(f, z) + 0.001, f, z), 1);
  }
});

test('springStep: underdamped overshoot matches theory', () => {
  const z = 0.55, f = 2.4;
  let peak = 0;
  for (let t = 0; t < 2; t += 1 / 2000) peak = Math.max(peak, K.springStep(t, f, z));
  const theory = 1 + Math.exp((-z * Math.PI) / Math.sqrt(1 - z * z));
  assert.ok(Math.abs(peak - theory) < 1e-3, `${peak} vs ${theory}`);
});

test('Track: stacked retargets are exact superposition and order-independent to seek', () => {
  const tr = new K.Track(10).spring(0, 20, 'slam').spring(0.3, -5, 'snap').ease(1, 0.5, 7, K.cubicOut).cut(2, 3);
  const ts = [0, 0.1, 0.31, 0.9, 1.25, 1.99, 2, 5];
  const a = ts.map((t) => tr.at(t));
  const b = [...ts].reverse().map((t) => tr.at(t)).reverse();
  assert.deepEqual(a, b);
  assert.equal(tr.at(-1), 10);
  assert.equal(tr.at(5), 3);
  const manual = 10 + 10 * K.springStep(0.9, 2.4, 0.55) - 25 * K.springStep(0.6, 4.2, 0.78);
  assert.ok(Math.abs(tr.at(0.9) - manual) < 1e-12);
});

test('BeatGrid: constant tempo and measured beats are consistent', () => {
  const g = new K.BeatGrid({ bpm: 120, offset: 0.1 });
  assert.equal(g.t(4), 2.1);
  assert.ok(Math.abs(g.b(2.1) - 4) < 1e-12);
  const m = new K.BeatGrid({ beats: [0.3, 0.9, 1.5, 2.1, 2.7] });
  assert.ok(Math.abs(m.bpm - 100) < 1e-9);
  assert.ok(Math.abs(m.t(2.5) - 1.8) < 1e-12);
  assert.ok(Math.abs(m.b(m.t(3.25)) - 3.25) < 1e-12);
  assert.ok(Math.abs(m.t(6) - 3.9) < 1e-12, 'extrapolates past the last beat');
});

test('rng: seeded, stable, and shuffle is a permutation', () => {
  const r1 = K.rng(7, 'x'), r2 = K.rng(7, 'x'), r3 = K.rng(8, 'x');
  const a = [r1(), r1(), r1()], b = [r2(), r2(), r2()];
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, [r3(), r3(), r3()]);
  const s = K.shuffle([...'ABCDEFG'], K.rng(1));
  assert.deepEqual([...s].sort(), [...'ABCDEFG']);
});

test('frameQuant: every motion-blur sub-sample of a frame maps to that frame', () => {
  const fps = 60;
  for (const i of [1, 17, 599]) for (let k = 0; k < 4; k++) assert.equal(K.frameQuant(i / fps - k / (fps * 4), fps), i / fps);
});

test('shape: optical kerning never lets inked neighbours collide, even at -80 tracking', () => {
  const fb = new K.FontBook();
  const f = fb.addBuffer('d', buf('ArchivoBlack-400.ttf'));
  for (const text of ['STOP SCROLLING', 'AVATAR', 'LTYPO', 'WAVY TOWN']) {
    const r = K.shape(f, text, { size: 200, tracking: -80 });
    const inked = r.items.filter((it) => it.g.hasInk);
    for (let i = 1; i < inked.length; i++) {
      if (inked[i].i !== inked[i - 1].i + 1) continue; // skip across spaces
      const a = inked[i - 1], b = inked[i];
      const clear = f.clearance(a.g, b.g, (b.x - a.x) / r.scale - a.g.adv);
      assert.ok(clear >= f.upm * 0.012 - 1e-6, `${text}: ${a.ch}${b.ch} clearance ${clear}`);
    }
  }
});

test('fitSize: fitted ink width equals the requested width', () => {
  const fb = new K.FontBook();
  const f = fb.addBuffer('d', buf('ArchivoBlack-400.ttf'));
  const size = K.fitSize(f, 'EXPENSIVE', 936, { tracking: -60 });
  const r = K.shape(f, 'EXPENSIVE', { size, tracking: -60 });
  assert.ok(Math.abs(r.inkWidth - 936) < 0.01, String(r.inkWidth));
});

test('capSymbols: @ is scaled so its ink spans baseline→cap', () => {
  const fb = new K.FontBook();
  const f = fb.addBuffer('d', buf('ArchivoBlack-400.ttf'));
  const r = K.shape(f, '@ X', { size: 100, capSymbols: true });
  const at = r.items[0];
  assert.ok(Math.abs(at.ink.y1) < 0.01, 'sits on the baseline');
  assert.ok(Math.abs(-at.ink.y0 - r.capPx) < 0.01, 'reaches cap height');
});

test('contrast: WCAG ratios', () => {
  assert.ok(Math.abs(K.contrast('#000000', '#FFFFFF') - 21) < 1e-9);
  assert.ok(K.contrast('#FF2BD6', '#0A0A0A') > 4.5);
});

test('balanceLines: a no-break space never breaks (a kr figure stays on one line)', () => {
  const fb = new K.FontBook();
  const f = fb.addBuffer('d', buf('InterTight-600.ttf'));
  const nb = ' ';
  const text = `Pris fra prislisten: +1${nb}893,75${nb}kr inkl.${nb}mva`;
  const w = K.shape(f, text, { size: 60 }).inkWidth;
  const lines = K.balanceLines(f, text, w * 0.6, { size: 60 });
  assert.ok(lines.length >= 2);
  assert.ok(lines.some((l) => l.includes(`+1${nb}893,75${nb}kr`)), JSON.stringify(lines));
});
