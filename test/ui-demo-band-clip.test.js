import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildScene } from '../src/kit/engine.js';
import { FontBook } from '../src/kit/font.js';
import { MediaHub } from '../src/kit/media.js';
import uiDemo from '../templates/ui-demo/index.js';

// Film polish lane 3: a zoomed window spilled into the caption band (the footnote chip then sat on table rows).
// The stage is clipped to the area above the band, and that clip is released before the chip is drawn.
const buf = (f) => { const b = fs.readFileSync(new URL(`../fonts/files/${f}`, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const fonts = new FontBook();
fonts.addBuffer('label', buf('InterTight-600.ttf'));
fonts.addBuffer('url', buf('Inter-500.ttf'));
const cap = JSON.parse(fs.readFileSync(new URL('../fixtures/captures/demo-app-desktop/capture.json', import.meta.url)));
const media = new MediaHub({ cap: { kind: 'capture', url: '/x', pattern: 'f%06d.jpg', w: 2880, h: 1800, fps: 30, frames: cap.frames.count, capture: cap } });
const W = 1920, H = 1080;

test('ui-demo: the stage is clipped above the caption band', () => {
  const log = [];
  const mk = () => new Proxy(function () {}, {
    get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : (...a) => { log.push([k, a]); return mk(); }),
    set: () => true,
    apply: () => undefined,
  });
  const qa = { texts: [], hits: [], keyframes: [], notes: [], warnings: [], checks: [], overlays: [] };
  const spec = { template: 'ui-demo', format: 'landscape', fps: 30, params: { bandBottom: 0.12, footnoteBand: true }, content: { capture: 'cap', frame: 'browser', footnote: 'demodata' } };
  const { scene } = buildScene(uiDemo, spec, { W, H, fps: 30, fonts, qa, media });
  try { scene.draw(mk(), 2); } catch (e) { log.push(["ERR:" + e.message, []]); /* a stub canvas cannot draw pixels: the call order before it is what is checked */ }
  const stageH = H - Math.round(H * 0.12);
  const i = log.findIndex(([k], n) => k === 'clip' && n > 0 && log[n - 1][0] === 'rect');
  assert.ok(i > 0, "a rect clip is set: " + log.slice(0, 12).map((l) => l[0]).join(","));
  const r = log[i - 1][1];
  assert.deepEqual([r[0], r[1], r[2], r[3]], [0, 0, W, stageH]);
});
