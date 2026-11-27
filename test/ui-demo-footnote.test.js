import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildScene } from '../src/kit/engine.js';
import { FontBook } from '../src/kit/font.js';
import { MediaHub } from '../src/kit/media.js';
import uiDemo from '../templates/ui-demo/index.js';

// Film judges: the footnote chip sat bottom-left over the captured UI and covered body text.
// params.footnoteBand puts it in the free band below the stage (needs params.bandBottom > 0).
const buf = (f) => { const b = fs.readFileSync(new URL(`../fonts/files/${f}`, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const fonts = new FontBook();
fonts.addBuffer('label', buf('InterTight-600.ttf'));
fonts.addBuffer('url', buf('Inter-500.ttf'));
const cap = JSON.parse(fs.readFileSync(new URL('../fixtures/captures/demo-app-desktop/capture.json', import.meta.url)));
const media = new MediaHub({ cap: { kind: 'capture', url: '/x', pattern: 'f%06d.jpg', w: 2880, h: 1800, fps: 30, frames: cap.frames.count, capture: cap } });
const W = 1920, H = 1080, NOTE = 'Produktskjerm fra Acme App · demodata';

function build(params, palette) {
  const qa = { texts: [], hits: [], keyframes: [], notes: [], warnings: [], checks: [], overlays: [] };
  buildScene(uiDemo, { template: 'ui-demo', format: 'landscape', fps: 30, ...(palette ? { palette } : {}), params, content: { capture: 'cap', frame: 'browser', footnote: NOTE } }, { W, H, fps: 30, fonts, qa, media });
  return { qa, foot: qa.texts.find((t) => t.label === 'footnote') };
}

test('ui-demo footnoteBand: chip is centred inside the free band below the stage', () => {
  const { qa, foot } = build({ bandBottom: 0.12, footnoteBand: true });
  const stageH = H - Math.round(H * 0.12);
  assert.ok(foot.box.y0 >= stageH, `chip text starts at ${foot.box.y0}, band at ${stageH}`);
  assert.ok(foot.box.y1 <= H);
  const mid = (foot.box.y0 + foot.box.y1) / 2;
  assert.ok(Math.abs(mid - (stageH + H) / 2) <= 1.5, `vertically centred in the band: ${mid}`);
  assert.deepEqual(qa.warnings, []);
});

test('ui-demo footnoteBand: explicit false keeps the chip bottom-left over the stage', () => {
  const a = build({ bandBottom: 0.12, footnoteBand: false }).foot.box;
  const b = build({ bandBottom: 0.12, footnoteBand: false }).foot.box;
  assert.deepEqual(a, b);
  const m = Math.round(Math.min(W, H) * 0.045);
  assert.ok(a.y1 < H - m, 'overlay chip keeps its bottom margin, as before');
});

test('ui-demo footnoteBand: without a band it falls back to the overlay and warns', () => {
  const base = build({ footnoteBand: false }).foot.box;
  const { qa, foot } = build({ bandBottom: 0, footnoteBand: true });
  assert.deepEqual(foot.box, base);
  assert.ok(qa.warnings.some((w) => /footnoteBand/.test(w)), qa.warnings.join('|'));
});

test('ui-demo footnoteBand: band chip text keeps readable contrast on the ground (dark and light)', () => {
  for (const night of [true, false]) {
    const pal = night ? { night: '#0b1a38', ink: '#ff6b0a', paper: '#ffffff' } : { night: '#d9d6cf', ink: '#15161a', paper: '#fbfaf8' };
    const { foot } = build({ bandBottom: 0.12, footnoteBand: true, ground: night ? 'night' : 'light' }, pal);
    assert.notEqual(foot.fg, foot.bg);
    // plate roles: paper plate on night (ink text), ink plate on light (paper text)
    assert.equal(foot.bg, night ? pal.paper : pal.ink);
    assert.equal(foot.fg, night ? pal.ink : pal.paper);
  }
});

test('ui-demo footnote: by default the chip gets its own solid band under the stage (never over captured content)', () => {
  const { qa, foot } = build({});
  assert.ok(foot.box.y0 > H * 0.9, `chip text at ${foot.box.y0}`);
  assert.ok(foot.box.y1 <= H);
  assert.notEqual(foot.bg, undefined);
  assert.deepEqual(qa.warnings, []);
});
