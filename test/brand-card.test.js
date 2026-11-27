import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromePath } from '../src/cli/browser.js';
import { session } from '../src/cli/render.js';
import { loadSpec } from '../src/cli/spec.js';

// Lead review #1: "lay out the FINAL composition once; every element animates
// into its fixed final position". Proof on pixels: once every element has
// settled (scene.elements → the QA note), the frame must be identical to the
// last frame — nothing may still drift, re-centre or grow.
const examples = fs.readdirSync(new URL('../examples', import.meta.url)).filter((f) => f.startsWith('brand-card-') && f.endsWith('.json'));

for (const f of examples) {
  test(`brand-card settle: ${f} is still from the moment every element settled`, { skip: !chromePath() && 'no Chrome', timeout: 300000 }, async () => {
    const { spec, specDir } = loadSpec(new URL(`../examples/${f}`, import.meta.url).pathname);
    spec.params = { ...(spec.params || {}), grain: 0, drift: 0 }; // grain is per-frame texture, drift is deliberate slow motion: neither is layout
    const s = await session(spec, { specDir });
    try {
      const note = s.info.qa.notes.find((n) => n.startsWith('brand-card '));
      const settled = Number(note.match(/settled by ([\d.]+)s/)[1]);
      const D = s.info.duration, fps = s.info.fps;
      assert.ok(settled < D - 0.5, `settles at ${settled}s, needs a final hold before ${D}s`);
      const page = s.pages[0].page;
      const hash = (t) => page.evaluate((x) => window.KT.hashSeek(x), t);
      const last = await hash(D - 1 / fps);
      for (const t of [Math.ceil((settled + 0.01) * fps) / fps, (settled + D) / 2]) assert.equal(await hash(t), last, `frame at ${t.toFixed(3)}s differs from the last frame`);
      // and something really did move before (the check is not vacuous)
      assert.notEqual(await hash(0.4), last);
    } finally {
      await s.close();
    }
  });
}
