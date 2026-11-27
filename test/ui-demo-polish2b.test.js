import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as X from '../src/kit/x-ui.js';
import { buildScene } from '../src/kit/engine.js';
import { FontBook } from '../src/kit/font.js';
import brandCard from '../templates/brand-card/index.js';
import { resolveTransition, DIP_DEPTH, DIP_MAX } from '../templates/sequence/index.js';

// Polish-2 judge defects (continued): callout plates, dark dips, still stat cards.

test('callouts: placeBeside moves the plate to a side that covers no other recorded element', () => {
  const safe = { x: 0, y: 0, w: 1920, h: 1080 };
  const target = { x: 800, y: 500, w: 200, h: 50 };
  const neighbour = { x: 1040, y: 490, w: 240, h: 70 }; // the next button, right of the target
  const open = X.placeBeside(target, 260, 56, safe, { gap: 40, side: 'right', soft: [] });
  assert.equal(open.side, 'right');
  const pl = X.placeBeside(target, 260, 56, safe, { gap: 40, side: 'right', soft: [neighbour] });
  assert.notEqual(pl.side, 'right');
  assert.equal(X.overlaps({ x: pl.x, y: pl.y, w: 260, h: 56 }, neighbour, 0), false);
});

test('callouts: a callout equal to its target text is ring-only (sameText)', () => {
  assert.equal(X.sameText('0 kr', '0 kr'), true);
  assert.equal(X.sameText('Ingenting.', ' ingenting '), true);
  assert.equal(X.sameText('Registrer betaling', 'Betalt'), false);
  assert.equal(X.sameText('', ''), false);
});

test('sequence: dip is capped (35 % dark, 0.25 s) and ui-demo -> ui-demo defaults to crossfade', () => {
  const params = { transition: 'dip', transitionDuration: 1 };
  const dip = resolveTransition({ i: 1, prev: 'brand-card', tpl: 'ui-demo', params, fps: 30 });
  assert.deepEqual(dip, { type: 'dip', duration: DIP_MAX });
  assert.ok(DIP_DEPTH <= 0.35 && DIP_MAX <= 0.25);
  assert.equal(resolveTransition({ i: 1, prev: 'ui-demo', tpl: 'ui-demo', params, fps: 30 }).type, 'crossfade');
  assert.equal(resolveTransition({ i: 1, prev: 'ui-demo', tpl: 'ui-demo', type: 'smash', params, fps: 30 }).type, 'smash');
  assert.equal(resolveTransition({ i: 0, prev: undefined, tpl: 'ui-demo', params, fps: 30 }).duration, 0);
});

const buf = (f) => { const b = fs.readFileSync(new URL(`../fonts/files/${f}`, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const fonts = new FontBook();
fonts.addBuffer('display', buf('InterTight-700.ttf'));
fonts.addBuffer('text', buf('Inter-500.ttf'));
const statQa = (duration) => {
  const qa = { texts: [], hits: [], keyframes: [], notes: [], warnings: [], checks: [], overlays: [] };
  buildScene(brandCard, { template: 'brand-card', format: 'landscape', fps: 30, duration, content: { mode: 'stat', value: '73', suffix: '%', label: 'færre purringer' } }, { W: 1920, H: 1080, fps: 30, fonts, qa });
  return qa;
};

test('brand-card stat: number + caption are horizontally centred, and a long hold keeps moving', () => {
  const qa = statQa(9);
  const v = qa.texts.find((t) => t.label === 'value').box;
  assert.ok(Math.abs((v.x0 + v.x1) / 2 - 960) < 96, `value centred (${v.x0}..${v.x1})`);
  const l = qa.texts.find((t) => t.label === 'label 1').box;
  assert.ok(Math.abs((l.x0 + l.x1) / 2 - 960) < 96, `caption centred (${l.x0}..${l.x1})`);
  assert.equal(qa.checks.find((c) => c.id.endsWith('static-hold')).status, 'pass');
});
