// Contact sheet for a native (wall-clock) capture: per step, the frame at the finger-down of each input (with the
// logged vbox drawn as an outline and the touch point as a dot — the mapping is checked by eye) and the settled
// frame at the end of the step. Frames come straight from capture.mp4 (no frames/ dir for native captures).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { chromePath } from '../cli/browser.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function deviceSheet(dir, { out, tileW = 200, cols = 8 } = {}) {
  dir = path.resolve(dir);
  const cap = JSON.parse(fs.readFileSync(path.join(dir, 'capture.json'), 'utf8'));
  const video = path.join(dir, cap.video.src);
  const { width: W, height: H } = cap.video;
  const tiles = [];
  for (const s of cap.steps) {
    if (s.t1 - s.t0 < 1e-6) continue;
    for (const ev of cap.events.filter((e) => e.step === s.id && (e.vbox || e.vpath) && e.type !== 'scroll')) tiles.push({ id: s.id, kind: ev.type, t: (ev.type === 'type' ? ev.t1 : ev.t) + 0.02, ev });
    tiles.push({ id: s.id, kind: 'settled', t: Math.max(s.t0, s.t1 - 0.05) });
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-dsheet-'));
  try {
    for (const [i, t] of tiles.entries()) {
      t.file = path.join(tmp, `t${i}.jpg`);
      const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(Math.max(0, Math.min(cap.duration - 0.02, t.t))), '-i', video, '-frames:v', '1', '-vf', `scale=${tileW * 2}:-2`, '-q:v', '3', t.file]);
      if (r.status !== 0) throw new Error(`frame extract failed at ${t.t}: ${r.stderr}`);
    }
    const k = tileW / W;
    const tileH = Math.round(H * k);
    const overlay = (ev) => {
      if (!ev) return '';
      let s = '';
      if (ev.vbox) s += `<div class=b style="left:${ev.vbox.x * k}px;top:${ev.vbox.y * k}px;width:${ev.vbox.w * k}px;height:${ev.vbox.h * k}px"></div>`;
      if (ev.vpoint) s += `<div class=p style="left:${ev.vpoint.x * k - 5}px;top:${ev.vpoint.y * k - 5}px"></div>`;
      if (ev.vpath) s += `<svg width=${tileW} height=${tileH}><polyline fill=none stroke="#ffb454" stroke-width=2 points="${ev.vpath.map((p) => `${p.x * k},${p.y * k}`).join(' ')}"/></svg>`;
      return s;
    };
    const markAt = (t) => cap.marks.filter((m) => Math.abs(m.t - t) < 0.08).map((m) => m.id);
    const html = `<!doctype html><meta charset=utf-8><style>
    body{margin:0;background:#15171c;font:12px Inter,system-ui,sans-serif;color:#e8eaf0;padding:14px;width:${cols * (tileW + 10) + 18}px}
    h1{font-size:14px;margin:0 0 4px;font-weight:600}.sub{opacity:.6;margin-bottom:12px}
    .g{display:grid;grid-template-columns:repeat(${cols},${tileW}px);gap:10px}.t{background:#1f222a;border-radius:6px;overflow:hidden}
    .f{position:relative;width:${tileW}px;height:${tileH}px}.f img{display:block;width:${tileW}px;height:${tileH}px}
    .b{position:absolute;outline:2px solid #ff4d6d;outline-offset:0}.p{position:absolute;width:10px;height:10px;border-radius:50%;background:#ff4d6d;box-shadow:0 0 0 2px #fff}
    svg{position:absolute;left:0;top:0}.l{padding:4px 6px;display:flex;justify-content:space-between;gap:4px}.l b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.k{opacity:.6}.m{color:#ffb454}
    </style><h1>${esc(cap.flow)} — ${esc(cap.app.name)} · ${esc(cap.device.transport)}</h1>
    <div class=sub>${cap.duration.toFixed(2)} s @ ${cap.fps} fps · ${W}×${H} · ${cap.events.length} events · idle ${cap.idle.length} · busy ${cap.busy.length} · red = logged vbox / touch point, amber = finger path</div>
    <div class=g>${tiles.map((t, i) => `<div class=t><div class=f><img src="file://${t.file}">${t.kind !== 'settled' ? overlay(t.ev) : ''}</div><div class=l><b>${i + 1}. ${esc(t.id)}${markAt(t.t).map((m) => ` <span class=m>◆</span>`).join('')}</b><span class=k>${esc(t.kind)} ${t.t.toFixed(2)}s</span></div></div>`).join('')}</div>`;
    const htmlFile = path.join(tmp, 'sheet.html');
    fs.writeFileSync(htmlFile, html);
    const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
    try {
      const page = await browser.newPage({ viewport: { width: cols * (tileW + 10) + 18, height: 600 }, deviceScaleFactor: 1 });
      await page.goto('file://' + htmlFile);
      await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 60000 });
      const file = out ? path.resolve(out) : path.join(dir, 'contact-sheet.png');
      await page.screenshot({ path: file, fullPage: true });
      return { file, tiles: tiles.length };
    } finally { await browser.close().catch(() => {}); }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
