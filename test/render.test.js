import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromePath } from '../src/cli/browser.js';
import { session } from '../src/cli/render.js';
import { loadSpec } from '../src/cli/spec.js';

// Regression: averaging N identical sub-samples must return that sample exactly.
// (Adding +0.5 before a Uint8ClampedArray store double-rounded and brightened
// every odd channel value by one.)
test('motion-blur average of a static frame equals the frame itself', { skip: !chromePath() && 'no Chrome', timeout: 180000 }, async () => {
  const { spec, specDir } = loadSpec(new URL('../examples/techhalla-bumper.json', import.meta.url).pathname);
  const s = await session(spec, { specDir });
  try {
    const page = s.pages[0].page;
    const fps = s.info.fps;
    const i = Math.round(19.9 * fps); // the lockup hold: nothing moves
    const plain = await page.evaluate((t) => window.KT.hashSeek(t), i / fps);
    const blurred = await page.evaluate(([k]) => window.KT.hashFrame(k, 4, 1), [i]);
    assert.equal(blurred, plain);
    // and a moving frame must NOT equal its single sample (blur really happens)
    const j = Math.round(0.3 * fps);
    assert.notEqual(await page.evaluate(([k]) => window.KT.hashFrame(k, 4, 1), [j]), await page.evaluate((t) => window.KT.hashSeek(t), j / fps));
  } finally {
    await s.close();
  }
});

test('motion-blur averaging is exact wherever sub-samples agree (moving frame)', { skip: !chromePath() && 'no Chrome', timeout: 180000 }, async () => {
  const { spec, specDir } = loadSpec(new URL('../examples/techhalla-bumper.json', import.meta.url).pathname);
  const s = await session(spec, { specDir });
  try {
    const j = Math.round(0.3 * s.info.fps); // the slam: glyphs moving
    const r = await s.pages[0].page.evaluate(([k]) => window.KT.blurExactness(k, 4, 1), [j]);
    assert.ok(r.moving > 1000, 'frame must actually contain motion');
    assert.equal(r.bad, 0);
  } finally {
    await s.close();
  }
});
