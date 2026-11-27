// Smoothness sources on Android (rehearse only): SurfaceFlinger's per-layer present timestamps and HWUI's
// gfxinfo counters. Pure parsers; the transport runs the dumpsys commands. The page's own rAF pacing (perform.js
// framePacing) is the fallback and the stand-in's only source.
import { framePacing } from './perform.js';

/** The layer that shows Chrome's web content: a SurfaceView/BLAST layer of the package, else its activity layer.
 * Android 15 prints `RequestedLayerState{<name> parentId=… z=…}` (rehearsal 4 picked the wrapped "Background for
 * SurfaceView[…]" line and --latency got no frames): unwrap to the bare name, never a Background/Bounds layer. */
export function pickChromeLayer(list, pkg = 'com.android.chrome') {
  return chromeLayerCandidates(list, pkg)[0] || null;
}

/** Ordered candidates: the BLAST child (where buffers land on Android 12+), the SurfaceView, the activity layer. */
export function chromeLayerCandidates(list, pkg = 'com.android.chrome') {
  const layers = String(list).split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => { const m = /^RequestedLayerState\{(.*?)(?:\s+parentId=.*)?\}?$/.exec(l); return (m ? m[1] : l).trim(); });
  const mine = [...new Set(layers.filter((l) => l.includes(pkg) || (pkg === 'com.android.chrome' && /org\.chromium/.test(l))))];
  const clean = mine.filter((l) => !/^(Background for|Bounds for)|\(Background\)/.test(l));
  const rank = (l) => (/SurfaceView/.test(l) && /BLAST/.test(l) ? 0 : /^SurfaceView\[/.test(l) ? 1 : /SurfaceView/.test(l) ? 2 : /Activity/.test(l) ? 3 : 4);
  return clean.sort((a, b) => rank(a) - rank(b));
}

/** `dumpsys SurfaceFlinger --latency LAYER`: line 1 = refresh period (ns); rows = desired, actual present, ready (ns). */
export function parseSfLatency(text) {
  const lines = String(text).trim().split('\n').map((l) => l.trim()).filter(Boolean);
  const period = Number(lines[0]);
  const actual = lines.slice(1).map((l) => l.split(/\s+/).map(Number)).filter((r) => r.length >= 3 && r[1] > 0 && r[1] < 9e18).map((r) => r[1] / 1e9);
  const p = framePacing(actual, { vsync: period > 0 ? period / 1e9 : 1 / 60 });
  return { refreshMs: period > 0 ? +(period / 1e6).toFixed(2) : null, ...p };
}

/** `dumpsys gfxinfo PKG`: totals, janky %, percentiles (HWUI-rendered frames — Chrome's toolbar/UI thread). */
export function parseGfxinfo(text) {
  const t = String(text);
  const num = (re) => { const m = re.exec(t); return m ? Number(m[1]) : null; };
  return {
    totalFrames: num(/Total frames rendered:\s*(\d+)/), jankyFrames: num(/Janky frames:\s*(\d+)/), jankyPct: num(/Janky frames:\s*\d+\s*\(([\d.]+)%\)/),
    p90Ms: num(/90th percentile:\s*(\d+)ms/), p95Ms: num(/95th percentile:\s*(\d+)ms/), p99Ms: num(/99th percentile:\s*(\d+)ms/),
  };
}

/**
 * `dumpsys SurfaceFlinger --timestats -dump` (Android 12+; `--latency` returns only the refresh-period header for most
 * layers there — rehearsal 5): per layer `layerName = …`, `totalFrames = N`, `averageFPS = X`, and a
 * `presentToPresent histogram` of `<ms>ms=<count>` tokens. Returns the block for the best-matching layer.
 */
export function parseTimeStats(text, pkg = 'com.android.chrome', preferred = null) {
  const blocks = String(text).split(/\n(?=\s*layerName\s*=)/).filter((b) => /layerName\s*=/.test(b));
  const parsed = blocks.map((b) => {
    const kv = (k) => { const m = new RegExp(`\\b${k}\\s*=\\s*([^\\n]+)`).exec(b); return m ? m[1].trim() : null; };
    const histIdx = b.search(/presentToPresent histogram is as below:/);
    const hist = {};
    if (histIdx >= 0) {
      const rest = b.slice(histIdx).split('\n').slice(1);
      for (const line of rest) { if (/histogram is as below|=\s*$/.test(line) && Object.keys(hist).length) break; for (const [, ms, n] of line.matchAll(/(\d+)ms=(\d+)/g)) hist[Number(ms)] = (hist[Number(ms)] || 0) + Number(n); if (/[a-zA-Z]+ histogram/.test(line)) break; }
    }
    return { layer: kv('layerName'), totalFrames: Number(kv('totalFrames')) || 0, droppedFrames: Number(kv('droppedFrames')) || 0, averageFPS: Number(kv('averageFPS')) || null, hist };
  }).filter((p) => p.layer && (p.layer.includes(pkg) || /org\.chromium/.test(p.layer)) && !/^(Background for|Bounds for)/.test(p.layer));
  if (!parsed.length) return { error: 'no Chrome layer in --timestats -dump' };
  const pick = parsed.find((p) => preferred && p.layer === preferred && p.totalFrames) || parsed.filter((p) => p.totalFrames).sort((a, b) => b.totalFrames - a.totalFrames)[0];
  if (!pick) return { error: 'TimeStats: Chrome layers have 0 frames' };
  const entries = Object.entries(pick.hist).map(([ms, n]) => [Number(ms), n]).sort((a, b) => a[0] - b[0]);
  const n = entries.reduce((a, [, c]) => a + c, 0);
  let p95 = null, acc = 0;
  for (const [ms, c] of entries) { acc += c; if (p95 === null && acc >= 0.95 * n) p95 = ms; }
  const janky = n ? entries.filter(([ms]) => ms > 25).reduce((a, [, c]) => a + c, 0) / n : null; // > 1.5 vsync at 60 Hz
  const meanMs = n ? entries.reduce((a, [ms, c]) => a + ms * c, 0) / n : null;
  return { layer: pick.layer, frames: pick.totalFrames, dropped: pick.droppedFrames, fps: pick.averageFPS ?? (meanMs ? +(1000 / meanMs).toFixed(1) : null), jankyPct: janky === null ? null : +(100 * janky).toFixed(1), p95Ms: p95, source: 'timestats' };
}
