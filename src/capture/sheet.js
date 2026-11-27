// Contact sheet: one labelled frame at the end of every step (the settled result of each action).
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { chromePath } from '../cli/browser.js';
import { fontEnv } from './driver.js';
import os from 'node:os';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function contactSheet(dir, { fontDirs = [], out } = {}) {
  dir = path.resolve(dir);
  const cap = JSON.parse(fs.readFileSync(path.join(dir, 'capture.json'), 'utf8'));
  const phone = cap.device.kind === 'phone';
  const tileW = phone ? 230 : 470;
  const cols = phone ? 6 : 3;
  const frameAt = (t) => Math.max(0, Math.min(cap.frames.count - 1, Math.round(t * cap.fps)));
  const markIds = new Set(cap.marks.map((m) => m.id));
  const tiles = cap.steps.filter((s) => !(markIds.has(s.id) && s.t1 === s.t0)).map((s) => {
    const f = frameAt(Math.max(s.t0, s.t1 - 1.5 / cap.fps));
    const after = cap.marks.filter((m) => m.t >= s.t1 - 1e-6 && m.t <= s.t1 + 1e-6 && m.id !== s.id).map((m) => m.id);
    return { id: s.id, after, t: s.t1, src: 'file://' + path.join(dir, cap.frames.dir, cap.frames.pattern.replace('%06d', String(f).padStart(6, '0'))) };
  });
  const html = `<!doctype html><meta charset=utf-8><style>
  body{margin:0;background:#15171c;font:12px Inter,system-ui,sans-serif;color:#e8eaf0;padding:14px;width:${cols * (tileW + 12) + 16}px}
  h1{font-size:14px;margin:0 0 4px;font-weight:600} .sub{opacity:.6;margin-bottom:12px}
  .g{display:grid;grid-template-columns:repeat(${cols},${tileW}px);gap:12px}
  .t{background:#1f222a;border-radius:6px;overflow:hidden} .t img{display:block;width:${tileW}px}
  .l{padding:5px 8px;display:flex;justify-content:space-between;gap:6px} .l b{font-weight:600} .m{color:#ffb454}
  </style><h1>${esc(cap.flow)} — ${esc(cap.app.name)}${cap.app.commit ? ' @ ' + esc(cap.app.commit) : ''}</h1>
  <div class=sub>${cap.frames.count} frames @ ${cap.fps} fps · ${cap.duration.toFixed(2)} s · ${cap.device.kind} ${cap.device.viewport.width}×${cap.device.viewport.height} @${cap.device.deviceScaleFactor}x</div>
  <div class=g>${tiles.map((t, i) => `<div class=t><img src="${t.src}"><div class=l><b>${i + 1}. ${esc(t.id)}${t.after.map((m) => ` <span class=m>◆ ${esc(m)}</span>`).join('')}</b><span>${t.t.toFixed(2)}s</span></div></div>`).join('')}</div>`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-sheet-'));
  const htmlFile = path.join(tmp, 'sheet.html');
  fs.writeFileSync(htmlFile, html);
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'], env: { ...process.env, ...fontEnv(fontDirs, tmp) } });
  try {
    const page = await browser.newPage({ viewport: { width: cols * (tileW + 12) + 16, height: 600 }, deviceScaleFactor: 1 });
    await page.goto('file://' + htmlFile);
    await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 60000 });
    const file = out ? path.resolve(out) : path.join(dir, 'contact-sheet.png');
    await page.screenshot({ path: file, fullPage: true });
    return { file, tiles: tiles.length };
  } finally {
    await browser.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
