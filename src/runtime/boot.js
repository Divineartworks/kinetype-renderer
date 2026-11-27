// Headless/preview runtime. The Node side drives this through window.KT.
import { createEngine } from '../kit/engine.js';
import { MediaHub } from '../kit/media.js';
import { FontBook, shape, useHarfBuzz } from '../kit/font.js';
import * as hb from 'harfbuzzjs';
useHarfBuzz(hb); // complex scripts (Arabic, Hebrew, Indic, Thai…) shape correctly
import { drawRun } from '../kit/type.js';

let eng = null;
const fnv = (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 2166136261; for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i], 16777619); return h >>> 0; };
let ui = null;

async function fetchBuf(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url} → ${r.status}`);
  return r.arrayBuffer();
}

async function post(path, body) {
  const r = await fetch(path, { method: 'POST', body });
  if (!r.ok) throw new Error(`POST ${path} → ${r.status}`);
}

window.KT = {
  ready: true,
  /** resolved = { spec, fontUrls:{role:url}, templateUrl?, scale?, uiFontUrl? } */
  async load(resolved) {
    const bufs = {};
    await Promise.all(Object.entries(resolved.fontUrls).map(async ([role, url]) => { bufs[role] = await fetchBuf(url); }));
    const template = (await import(resolved.templateUrl)).default;
    if (!template || typeof template.build !== 'function') throw new Error(`template module ${resolved.templateUrl} has no build()`);
    // nested templates (sequence shots)
    const templates = {};
    for (const [id, url] of Object.entries(resolved.templateUrls || {})) templates[id] = (await import(url)).default;
    const media = new MediaHub(resolved.media || {});
    await media.init();
    eng = createEngine({ canvas: document.getElementById('stage'), spec: resolved.spec, template, templates, media, fontBuffers: bufs, scale: resolved.scale ?? 1, readback: !resolved.gpu, accel: resolved.accel || null });
    // HyperFrames-compatible surface: any seek(t) renderer can drive us.
    await eng.init();
    window.__hf = { duration: eng.duration, seek: (t) => eng.seek(t) };
    if (resolved.uiFontUrl) {
      ui = new FontBook();
      ui.addBuffer('ui', await fetchBuf(resolved.uiFontUrl));
    }
    return eng.info();
  },
  info: () => eng.info(),
  stats: () => eng.stats(),
  async seek(t) { await eng.prepare(t); eng.seek(t); },
  /** Render frame i with motion blur and POST raw RGBA to the job sink. */
  async emit(job, i, samples, shutter) {
    await eng.prepare(i / eng.fps, samples, shutter, true); // fresh bitmaps: a frame must not depend on the page's history
    const px = eng.frame(i, samples, shutter);
    // palette-QA exempt regions (captured UI, logos) travel with the frame
    const ex = eng.exempt(i / eng.fps);
    // A Blob body uploads ~6x faster than a typed-array body in Chrome (measured: 24ms vs 150ms per 4.6MB frame).
    await post(`/__frame?job=${job}&i=${i}${ex ? '&ex=' + encodeURIComponent(JSON.stringify(ex)) : ''}`, new Blob([px]));
    return true;
  },
  async still(job, name, t, samples, shutter) {
    await eng.prepare(t, samples, shutter);
    eng.drawBlurred(t, samples, shutter);
    const blob = await new Promise((r) => eng.canvas.toBlob(r, 'image/png'));
    await post(`/__file?job=${job}&name=${encodeURIComponent(name)}`, blob);
  },
  /** Contact sheet: items [{t,label}] rendered into one labelled PNG. */
  async sheet(job, name, items, { cols = 4, cellW = 480, samples = 4, shutter = 1 } = {}) {
    const ar = eng.canvas.height / eng.canvas.width;
    const cellH = Math.round(cellW * ar), pad = 16, labelH = 34;
    const rows = Math.ceil(items.length / cols);
    const c = document.createElement('canvas');
    c.width = cols * cellW + (cols + 1) * pad;
    c.height = rows * (cellH + labelH) + (rows + 1) * pad;
    const g = c.getContext('2d');
    g.fillStyle = '#141414';
    g.fillRect(0, 0, c.width, c.height);
    for (let k = 0; k < items.length; k++) {
      const it = items[k];
      await eng.prepare(it.t, samples, shutter);
      eng.drawBlurred(it.t, samples, shutter);
      const x = pad + (k % cols) * (cellW + pad), y = pad + Math.floor(k / cols) * (cellH + labelH + pad);
      if (eng.transparent) {
        // alpha renders sit on a checkerboard so transparency is visible
        const sq = 12;
        for (let yy = 0; yy < cellH; yy += sq) for (let xx = 0; xx < cellW; xx += sq) {
          g.fillStyle = ((xx / sq + yy / sq) & 1) ? '#8a8a8a' : '#b4b4b4';
          g.fillRect(x + xx, y + yy, Math.min(sq, cellW - xx), Math.min(sq, cellH - yy));
        }
      }
      g.drawImage(eng.canvas, x, y, cellW, cellH);
      if (ui) {
        const run = shape(ui.get('ui'), `${String(k + 1).padStart(2, '0')}  ${it.t.toFixed(3)}s  ${it.label || ''}`.toUpperCase(), { size: 15, tracking: 20, kerning: 'metric' });
        drawRun(g, run, x, y + cellH + 24, { fill: '#9A9A9A' });
      }
    }
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    await post(`/__file?job=${job}&name=${encodeURIComponent(name)}`, blob);
  },
  /** FNV hash of the canvas after seek(t) (no blur) — for tests/tools. */
  async hashSeek(t) { await eng.prepare(t); eng.seek(t); return fnv(eng.canvas); },
  /** FNV hash of frame i rendered with motion blur — for tests/tools. */
  async hashFrame(i, samples = 4, shutter = 1) { await eng.prepare(i / eng.fps, samples, shutter); eng.frame(i, samples, shutter); return fnv(eng.canvas); },
  /**
   * Averaging exactness probe: render frame i with blur, then each sub-sample
   * alone; every channel identical across all sub-samples must be identical in
   * the average. Returns the number of violations (0 = exact).
   */
  async blurExactness(i, samples = 4, shutter = 1) {
    const t = i / eng.fps;
    await eng.prepare(t, samples, shutter);
    const g = eng.canvas.getContext('2d');
    const W = eng.canvas.width, H = eng.canvas.height;
    const times = eng.sampleTimes(t, samples, shutter);
    const subs = times.map((ts) => { eng.seek(ts); return g.getImageData(0, 0, W, H).data; });
    eng.frame(i, samples, shutter);
    const avg = g.getImageData(0, 0, W, H).data;
    let bad = 0, moving = 0;
    for (let k = 0; k < avg.length; k++) {
      const v = subs[0][k];
      let same = true;
      for (let j = 1; j < subs.length; j++) if (subs[j][k] !== v) { same = false; break; }
      if (!same) { moving++; continue; }
      if (avg[k] !== v) bad++;
    }
    return { bad, moving };
  },
  /** Timing probe: ms per sample at a given t. */
  bench(t, n = 10) {
    const s = performance.now();
    for (let i = 0; i < n; i++) eng.seek(t + i / 240);
    return (performance.now() - s) / n;
  },
};
