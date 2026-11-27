#!/usr/bin/env node
// Highlight proof: for EVERY highlight occurrence in a spec (ui-demo, ui-stage per panel, or a sequence of shots),
// render its first / middle / last frame, write a crop sheet (full frame | zoomed crop around the
// ring) and a JSON report with the analytic check (ring = tracked box + pad within 1 px, target
// visible) plus a pixel check (the accent stroke really is on the ring's perimeter in the frame).
// ui-stage connectors are occurrences too: both endpoint rings are pixel-checked once the arc has arrived.
//
//   set KINETYPE_CHROME (and fonts, if needed) for your host
//   node scripts/highlight-proof.mjs spec.json OUT_DIR
//
// Writes OUT_DIR/occ-NN-<label>.png and OUT_DIR/report.json; exits 1 if any check fails.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { session } from '../src/cli/render.js';
import { withTimeout } from '../src/cli/browser.js';
import { hexToRgb } from '../src/kit/color.js';

const [specPath, outDir] = process.argv.slice(2);
if (!specPath || !outDir) { console.error('usage: highlight-proof.mjs spec.json OUT_DIR'); process.exit(2); }
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const specDir = path.dirname(path.resolve(specPath));
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, 'frames'), { recursive: true });

function decode(file) {
  const s = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', file])).streams[0];
  return { w: s.width, h: s.height, px: execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 }) };
}
/** Fraction of the ring's perimeter (sampled every 4 px) where an accent-coloured pixel lies within ±2 px across the stroke. */
function perimeterHit(im, r, accent) {
  const near = (x, y) => {
    if (x < 0 || y < 0 || x >= im.w || y >= im.h) return false;
    const i = (y * im.w + x) * 3;
    return Math.abs(im.px[i] - accent[0]) < 60 && Math.abs(im.px[i + 1] - accent[1]) < 60 && Math.abs(im.px[i + 2] - accent[2]) < 60;
  };
  const rad = Math.min(14, r.h / 2) + 2; // skip the rounded corners
  let n = 0, hit = 0;
  const probe = (x, y, nx, ny) => { n++; for (let d = -2; d <= 2; d++) if (near(Math.round(x + nx * d), Math.round(y + ny * d))) { hit++; return; } };
  for (let x = r.x + rad; x <= r.x + r.w - rad; x += 4) { probe(x, r.y, 0, 1); probe(x, r.y + r.h, 0, 1); }
  for (let y = r.y + rad; y <= r.y + r.h - rad; y += 4) { probe(r.x, y, 1, 0); probe(r.x + r.w, y, 1, 0); }
  return n ? hit / n : 0;
}

const s = await session(spec, { specDir });
try {
  const info = s.info;
  const page = s.pages[0].page;
  const fps = info.fps;
  const job = 'proof';
  const files = {};
  s.sinks.set(job, { file: (n, buf) => { fs.writeFileSync(path.join(outDir, 'frames', n), buf); files[n] = true; } });
  const accent = (() => {
    // the accent of the shot that draws the highlights (ui-demo default if unset)
    const shots = spec.template === 'sequence' ? spec.content.shots.filter((x) => x.template === 'ui-demo' || x.template === 'ui-stage') : [spec];
    return hexToRgb(shots.find((x) => x.palette?.accent)?.palette.accent || spec.palette?.accent || '#2F55E4');
  })();
  // a connector is checked once its arc has arrived (both endpoint rings drawn): its ring = the cause end,
  // ring2 = the effect end; the crop shows both
  const con = info.qa.overlays.filter((o) => o.kind === 'connector' && o.u >= 1); // arrived: both rings drawn
  const conOcc = con.map((o) => ({ ...o, label: `connector ${o.index} · ${o.label}`, ring: o.from.ring, ring2: o.to.ring, panel: `${o.from.panel}→${o.to.panel}`, errPx: 0, alpha: o.alpha ?? 1, visible: true, box: o.from.box }));
  const hl = [...info.qa.overlays.filter((o) => o.kind === 'highlight'), ...conOcc].sort((a, b) => a.t - b.t || a.label.localeCompare(b.label));
  // occurrences: one callout's consecutive frames (per panel on a ui-stage)
  const occ = [];
  const key = (o) => `${o.panel ?? ''}|${o.label}`;
  for (const o of hl) {
    const cur = occ.findLast((x) => x.key === key(o));
    if (cur && o.t - cur.frames.at(-1).t <= 1.5 / fps) cur.frames.push(o); else occ.push({ key: key(o), label: o.panel && !o.ring2 ? `${o.panel} · ${o.label}` : o.label, frames: [o] });
  }
  const checks = info.qa.checks.filter((c) => /highlight-accuracy|connector-endpoints/.test(c.id));
  const report = { spec: path.resolve(specPath), fps, duration: info.duration, accent, analyticChecks: checks, warnings: info.qa.warnings.filter((w) => /callout/.test(w)), occurrences: [] };
  let failed = checks.some((c) => c.status === 'fail');
  for (const [k, oc] of occ.entries()) {
    const fr = oc.frames;
    const picks = [...new Set([fr[0], fr[Math.floor(fr.length / 2)], fr.at(-1)])];
    const rows = [];
    for (const o of picks) {
      const name = `occ${String(k + 1).padStart(2, '0')}_${o.t.toFixed(3)}.png`;
      await withTimeout(page.evaluate(([j, n, t]) => window.KT.still(j, n, t, 1, 1), [job, name, o.t]), 120000, name);
      const file = path.join(outDir, 'frames', name);
      const im = decode(file);
      const cover = o.ring2 ? Math.min(perimeterHit(im, o.ring, accent), perimeterHit(im, o.ring2, accent)) : perimeterHit(im, o.ring, accent);
      rows.push({ t: +o.t.toFixed(4), captureFrame: o.captureFrame, captureT: o.captureT, box: o.box, ring: o.ring, errPx: o.errPx, alpha: o.alpha, perimeterAccent: +cover.toFixed(3), file: path.relative(outDir, file) });
      // crop sheet row: full frame (fit 960×540) | crop around the ring (margin 90 px, fit 760×540)
      const R = o.ring2 ? (() => { const x = Math.min(o.ring.x, o.ring2.x), y = Math.min(o.ring.y, o.ring2.y); return { x, y, w: Math.max(o.ring.x + o.ring.w, o.ring2.x + o.ring2.w) - x, h: Math.max(o.ring.y + o.ring.h, o.ring2.y + o.ring2.h) - y }; })() : o.ring;
      const m = 90, cx = Math.max(0, Math.floor(R.x - m)), cy = Math.max(0, Math.floor(R.y - m));
      const cw = Math.min(im.w - cx, Math.ceil(R.w + 2 * m)), ch = Math.min(im.h - cy, Math.ceil(R.h + 2 * m));
      const rowFile = path.join(outDir, 'frames', `row_${name}`);
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-filter_complex',
        `[0]scale=w=960:h=540:force_original_aspect_ratio=decrease,pad=972:540:(960-iw)/2:(540-ih)/2:0x141414[a];` +
        `[0]crop=${cw}:${ch}:${cx}:${cy},scale=w=760:h=540:force_original_aspect_ratio=decrease:flags=lanczos,pad=760:540:(ow-iw)/2:(oh-ih)/2:0x141414[b];` +
        '[a][b]hstack=inputs=2,pad=iw:ih+12:0:0:0x141414', rowFile]);
      if (o.alpha > 0.97 && cover < 0.9) failed = true;
    }
    const sheet = path.join(outDir, `occ-${String(k + 1).padStart(2, '0')}-${oc.label.replace(/[^a-z0-9æøå]+/gi, '-').toLowerCase()}.png`);
    const inputs = rows.flatMap((r) => ['-i', path.join(outDir, 'frames', `row_${path.basename(r.file)}`)]);
    execFileSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', rows.length > 1 ? `${rows.map((_, i) => `[${i}]`).join('')}vstack=inputs=${rows.length}` : 'null', sheet]);
    report.occurrences.push({
      n: k + 1, label: oc.label, t0: +fr[0].t.toFixed(4), t1: +fr.at(-1).t.toFixed(4), frames: fr.length,
      captureFrames: [fr[0].captureFrame, fr.at(-1).captureFrame], maxErrPx: Math.max(...fr.map((o) => o.errPx)), allVisible: fr.every((o) => o.visible),
      boxes: [...new Set(fr.map((o) => JSON.stringify(o.box)))].length, sheet: path.relative(outDir, sheet), samples: rows,
    });
  }
  report.status = failed ? 'fail' : 'pass';
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.status}: ${occ.length} highlight occurrences, ${hl.length} highlight frames → ${outDir}`);
  for (const o of report.occurrences) console.log(`  ${o.n}. "${o.label}" ${o.t0}–${o.t1}s (${o.frames} frames, capture f${o.captureFrames[0]}–f${o.captureFrames[1]}, ${o.boxes} distinct boxes, max err ${o.maxErrPx}px, perimeter ${o.samples.map((x) => x.perimeterAccent).join('/')})`);
  for (const w of report.warnings) console.log(`  warn: ${w}`);
  process.exitCode = failed ? 1 : 0;
} finally {
  await s.close();
}
