import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildScene } from '../src/kit/engine.js';
import { FontBook } from '../src/kit/font.js';
import { MediaHub } from '../src/kit/media.js';
import brandCard from '../templates/brand-card/index.js';

// long-compound relay (real-world copy): a long Norwegian compound in a CTA
// headline overlapped the product tile. The text column is a hard constraint.
const buf = (f) => { const b = fs.readFileSync(new URL(`../fonts/files/${f}`, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const fonts = new FontBook();
fonts.addBuffer('display', buf('InterTight-700.ttf'));
fonts.addBuffer('text', buf('Inter-500.ttf'));
const cap = JSON.parse(fs.readFileSync(new URL('../fixtures/captures/demo-app-desktop/capture.json', import.meta.url)));
const phone = JSON.parse(fs.readFileSync(new URL('../fixtures/captures/demo-app-phone/capture.json', import.meta.url)));
const media = new MediaHub({
  cap: { kind: 'capture', url: '/x', pattern: 'f%06d.jpg', w: 2880, h: 1800, fps: 30, frames: cap.frames.count, capture: cap },
  phone: { kind: 'capture', url: '/y', pattern: 'f%06d.jpg', w: 1170, h: 2532, fps: 30, frames: phone.frames.count, capture: phone },
});

function build(format, content, W, H) {
  const qa = { texts: [], hits: [], keyframes: [], notes: [], warnings: [], checks: [], overlays: [] };
  buildScene(brandCard, { template: 'brand-card', format, fps: 30, content }, { W, H, fps: 30, fonts, qa, media });
  return qa;
}

const LONG = [
  'Bygget for en enklere håndverkerhverdag.',
  'Prosjektstyringsverktøyet for byggebransjen',
  'Arbeidsordrehåndteringssystem',
];

for (const [format, W, H, product] of [['landscape', 1920, 1080, 'cap'], ['vertical', 1080, 1920, 'phone'], ['square', 1080, 1080, 'cap'], ['landscape', 1920, 1080, null]]) {
  for (const headline of LONG) {
    test(`brand-card fit: "${headline}" stays in its column (${format}${product ? ', with product' : ''})`, () => {
      const content = { mode: 'cta', headline, cta: 'Se produktet', url: 'example.com', ...(product ? { product: { capture: product } } : {}) };
      const qa = build(format, content, W, H);
      const margin = Math.round(Math.min(W, H) * 0.035);
      for (const t of qa.texts) {
        assert.ok(t.box.x0 >= margin - 0.5 && t.box.x1 <= W - margin + 0.5, `${t.label} leaves the frame: ${JSON.stringify(t.box)}`);
        // landscape with a product: the type column ends before the tile (which starts at 52 % of W)
        if (product && format === 'landscape') assert.ok(t.box.x1 <= W * 0.52 + 0.5, `${t.label} runs into the product tile: x1 ${t.box.x1.toFixed(0)} > ${(W * 0.52).toFixed(0)}`);
      }
      assert.deepEqual(qa.warnings, []);
    });
  }
}

// Flaw found by film judges: with a footnote the product tile moves left to stay inside the frame,
// and the hook headline then ran under it. The type column is bounded by the tile's ACTUAL edge,
// and a qa check (type-clear-of-tile) fails the render if any text/button/logo box meets the tile.
const tileOf = (qa) => qa.checks.find((c) => c.id === 'type-clear-of-tile');
const FOOT = 'Produktskjerm fra Acme App · demodata';
const HOOK = 'Gjør plass til det virkelige arbeidet.';
for (const [format, W, H, product] of [['landscape', 1920, 1080, 'cap'], ['landscape', 1920, 1080, 'phone'], ['vertical', 1080, 1920, 'phone'], ['vertical', 1080, 1920, 'cap'], ['square', 1080, 1080, 'cap']]) {
  for (const [mode, content] of [
    ['hook', { mode: 'hook', headline: HOOK, kicker: 'Acme App' }],
    ['hook+footnote', { mode: 'hook', headline: HOOK, kicker: 'Acme App', footnote: FOOT }],
    ['cta+footnote', { mode: 'cta', headline: LONG[0], cta: 'Se produktet', url: 'example.com', footnote: FOOT }],
    ['stat+footnote', { mode: 'stat', value: '30', suffix: '%', label: 'mindre tid på papirarbeid', footnote: FOOT }],
    ['benefit+footnote', { mode: 'benefit', lines: ['Alt på ett sted', 'Mindre papirarbeid', 'Full oversikt'], footnote: FOOT }],
  ]) {
    test(`brand-card no-overlap: ${mode} never touches the product tile (${format}, ${product})`, () => {
      const qa = build(format, { ...content, product: { capture: product } }, W, H);
      const c = tileOf(qa);
      assert.ok(c, 'type-clear-of-tile check is registered');
      assert.equal(c.status, 'pass', c.detail);
      assert.deepEqual(qa.warnings, []);
    });
  }
}

// Independent geometry proof (does not trust the template's own check): every registered text box is
// outside the tile box that the scene reports, in landscape and vertical.
for (const [format, W, H, product] of [['landscape', 1920, 1080, 'cap'], ['vertical', 1080, 1920, 'phone']]) {
  test(`brand-card no-overlap: text boxes are disjoint from the reported tile box (${format})`, () => {
    const qa = { texts: [], hits: [], keyframes: [], notes: [], warnings: [], checks: [], overlays: [] };
    const { scene } = buildScene(brandCard, { template: 'brand-card', format, fps: 30, content: { mode: 'hook', headline: HOOK, kicker: 'Acme App', footnote: FOOT, product: { capture: product } } }, { W, H, fps: 30, fonts, qa, media });
    const tb = scene.elements.find((e) => e.id === 'product').box;
    assert.ok(tb && tb.w > 0);
    for (const t of qa.texts) {
      const b = t.box;
      const apart = b.x1 <= tb.x || b.x0 >= tb.x + tb.w || b.y1 <= tb.y || b.y0 >= tb.y + tb.h;
      assert.ok(apart, `${t.label} ${JSON.stringify(b)} meets tile ${JSON.stringify(tb)}`);
    }
  });
}
