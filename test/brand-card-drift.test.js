import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildScene } from '../src/kit/engine.js';
import { FontBook } from '../src/kit/font.js';
import { MediaHub } from '../src/kit/media.js';
import brandCard from '../templates/brand-card/index.js';
import { chromePath } from '../src/cli/browser.js';
import { session } from '../src/cli/render.js';
import { loadSpec } from '../src/cli/spec.js';

// Polish 2 / K2b: a brand-card must not hold an identical picture for more than 5 s. The product tile
// (and the night ground's light) drift very slowly over the shot; the type is never touched.
const buf = (f) => { const b = fs.readFileSync(new URL(`../fonts/files/${f}`, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const fonts = new FontBook();
fonts.addBuffer('display', buf('InterTight-700.ttf'));
fonts.addBuffer('text', buf('Inter-500.ttf'));
const cap = JSON.parse(fs.readFileSync(new URL('../fixtures/captures/demo-app-desktop/capture.json', import.meta.url)));
const media = new MediaHub({ cap: { kind: 'capture', url: '/x', pattern: 'f%06d.jpg', w: 2880, h: 1800, fps: 30, frames: cap.frames.count, capture: cap } });

function build(content, { params, duration } = {}) {
  const qa = { texts: [], hits: [], keyframes: [], notes: [], warnings: [], checks: [], overlays: [] };
  buildScene(brandCard, { template: 'brand-card', format: 'landscape', fps: 30, ...(duration ? { duration } : {}), ...(params ? { params } : {}), content }, { W: 1920, H: 1080, fps: 30, fonts, qa, media });
  return qa;
}
const sh = (qa) => qa.checks.find((c) => c.id.endsWith('static-hold'));

test('brand-card static-hold: a long shot with a product tile drifts and passes; drift 0 or no tile/night ground warns', () => {
  const withTile = { mode: 'cta', headline: 'Se produktet', cta: 'Prøv nå', product: { capture: 'cap' } };
  assert.equal(sh(build(withTile, { duration: 9 })).status, 'pass');
  assert.equal(sh(build(withTile, { duration: 9, params: { drift: 0 } })).status, 'warn');
  const bare = { mode: 'hook', headline: 'Alt på ett sted' };
  assert.equal(sh(build(bare, { duration: 9 })).status, 'warn', 'a light type-only card has nothing to drift');
  assert.equal(sh(build(bare, { duration: 9, params: { ground: 'night' } })).status, 'pass', 'the night ground\'s light drifts');
  assert.equal(sh(build(bare, { duration: 4 })).status, 'pass', 'short shots are fine');
});

test('brand-card drift: the tile growth never makes the type touch it (type-clear-of-tile still passes)', () => {
  const qa = build({ mode: 'cta', headline: 'Se produktet', cta: 'Prøv nå', url: 'example.com', product: { capture: 'cap' } }, { params: { drift: 0.04 } });
  assert.equal(qa.checks.find((c) => c.id.endsWith('type-clear-of-tile')).status, 'pass');
});

test('brand-card drift (real pixels): a product-less stat card pushes slowly by default and is fully still at drift 0', { skip: !chromePath() && 'no Chrome', timeout: 300000 }, async () => {
  const { spec, specDir } = loadSpec(new URL('../examples/brand-card-stat.json', import.meta.url).pathname);
  const frames = async (drift) => {
    const s = await session({ ...spec, params: { ...(spec.params || {}), grain: 0, drift } }, { specDir });
    try {
      const D = s.info.duration, fps = s.info.fps;
      const settled = Number(s.info.qa.notes.find((n) => n.startsWith('brand-card ')).match(/settled by ([\d.]+)s/)[1]);
      const hash = (t) => s.pages[0].page.evaluate((x) => window.KT.hashSeek(x), t);
      return { a: await hash(Math.ceil((settled + 0.05) * fps) / fps), b: await hash(D - 1 / fps) };
    } finally { await s.close(); }
  };
  const moving = await frames(0.012);
  assert.notEqual(moving.a, moving.b, 'the stat block keeps pushing after it settled');
  const off = await frames(0);
  assert.equal(off.a, off.b, 'drift 0 means a fully still settled frame');
});

test('brand-card drift (real pixels): with a product tile the settled frame keeps moving; drift 0 is still', { skip: !chromePath() && 'no Chrome', timeout: 300000 }, async () => {
  const { spec, specDir } = loadSpec(new URL('../examples/brand-card-cta.json', import.meta.url).pathname);
  const frames = async (drift) => {
    const sp = { ...spec, params: { ...(spec.params || {}), grain: 0, drift } };
    const s = await session(sp, { specDir });
    try {
      const D = s.info.duration, fps = s.info.fps;
      const settled = Number(s.info.qa.notes.find((n) => n.startsWith('brand-card ')).match(/settled by ([\d.]+)s/)[1]);
      const page = s.pages[0].page;
      const hash = (t) => page.evaluate((x) => window.KT.hashSeek(x), t);
      return { a: await hash(Math.ceil((settled + 0.05) * fps) / fps), b: await hash(D - 1 / fps) };
    } finally { await s.close(); }
  };
  const moving = await frames(0.012);
  assert.notEqual(moving.a, moving.b, 'the settled frame differs from the last one (tile drifts)');
  const off = await frames(0);
  assert.equal(off.a, off.b);
});

test('brand-card K5: the tile URL label is contrast-checked at 4.5:1', () => {
  const content = { mode: 'cta', headline: 'Se produktet', cta: 'Prøv nå', product: { capture: 'cap', urlLabel: 'app.example.com' } };
  const c = build(content).checks.find((x) => x.id.endsWith('overlay-contrast'));
  assert.equal(c.status, 'pass', c.detail);
});
