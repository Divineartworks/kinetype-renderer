import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromePath } from '../src/cli/browser.js';
import { render } from '../src/cli/render.js';
import { loadSpec } from '../src/cli/spec.js';

// `render --draft` is an iteration render — half size, one blur sample, own folder, honest receipt.
test('draft render: half size, draft/ folder, receipt marks draft, normal output untouched', { skip: !chromePath() && 'no Chrome', timeout: 240000 }, async () => {
  const { spec, specPath, specDir } = loadSpec(new URL('../examples/brand-card-stat.json', import.meta.url).pathname);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-draft-'));
  try {
    const before = JSON.stringify(spec);
    const r = await render(spec, { specPath, specDir, out, workers: 2, frames: [0, 11], draft: true, log: () => {} });
    assert.equal(JSON.stringify(spec), before, 'the caller\'s spec is not mutated');
    assert.equal(r.draft, true);
    assert.equal(r.motion_blur.samples, 1);
    assert.equal(path.dirname(r.outputs[0].file), path.join(out, 'draft'));
    assert.equal(r.format.renderWidth, Math.round(r.format.width / 2));
    assert.equal(r.format.renderHeight, Math.round(r.format.height / 2));
    assert.ok(r.outputs[0].probe.streams.some((s) => s.width === r.format.renderWidth));
    assert.ok(r.qa.layout.checks.length > 0, 'layout QA still runs');
    assert.equal(r.qa.pixels.framesSampled, 0);
    assert.ok(r.determinism.every((d) => d.identical));
    assert.ok(!fs.existsSync(path.join(out, 'brand-card-stat.mp4')), 'nothing written beside the full render');
    // determinism: a second draft is byte-identical
    const h1 = fs.readFileSync(path.join(out, 'draft', 'frames.sha256'), 'utf8');
    await render(spec, { specPath, specDir, out, workers: 1, frames: [0, 11], draft: true, log: () => {} });
    assert.equal(fs.readFileSync(path.join(out, 'draft', 'frames.sha256'), 'utf8'), h1);
    // a normal render of the same frames is not a draft
    const full = await render(spec, { specPath, specDir, out, workers: 2, frames: [0, 3], log: () => {} });
    assert.equal(full.draft, false);
    assert.equal(full.format.renderWidth, full.format.width);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
