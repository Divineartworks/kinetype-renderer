#!/usr/bin/env node
// Full render of every example spec; writes out/_all/summary.json (the proof table).
import fs from 'node:fs';
import path from 'node:path';
import { render } from '../src/cli/render.js';
import { loadSpec } from '../src/cli/spec.js';
import { ROOT } from '../src/cli/server.js';

const only = process.argv[2];
const files = fs.readdirSync(path.join(ROOT, 'examples')).filter((f) => f.endsWith('.json') && (!only || f.startsWith(only))).sort();
const rows = [];
for (const f of files) {
  const { spec, specPath, specDir } = loadSpec(path.join(ROOT, 'examples', f));
  const t0 = Date.now();
  try {
    const r = await render(spec, { specPath, specDir, log: () => {} });
    rows.push({ example: f, template: spec.template, verdict: r.verdict.status, fails: r.verdict.fails, warns: r.verdict.warns, deterministic: r.determinism.every((d) => d.identical), loopSeam: r.qa.pixels.checks.find((c) => c.id === 'loop-seam')?.status ?? 'n/a', seconds: r.format.duration, frames: r.format.frames, size: `${r.format.width}x${r.format.height}`, wall: +(r.timing.total_sec).toFixed(1), fps: +r.timing.fps_rendered.toFixed(1), outputs: r.outputs.map((o) => path.relative(ROOT, o.file)) });
  } catch (e) {
    rows.push({ example: f, template: spec.template, verdict: 'error', error: String(e.message || e).slice(0, 300), wall: (Date.now() - t0) / 1000 });
  }
  const last = rows[rows.length - 1];
  console.error(`${last.verdict.padEnd(18)} ${f.padEnd(40)} ${last.wall}s ${last.fps ?? ''}fps ${last.loopSeam ?? ''}`);
}
fs.mkdirSync(path.join(ROOT, 'out/_all'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'out/_all', only ? `summary-${only}.json` : 'summary.json'), JSON.stringify({ created: new Date().toISOString(), rows }, null, 2));
