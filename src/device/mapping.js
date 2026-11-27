// CSS px → VIDEO px mapping for native device recordings (C2 v2 `vbox`/`vpoint`/`mapping`). Pure; unit-tested.
//
// A box from getBoundingClientRect is in CSS px of the LAYOUT viewport. On the phone's screen (= the video)
//   X = ox + s·x,  Y = oy + s·y,  s = devicePixelRatio · visualViewport.scale
//   ox = left − s·vv.offsetLeft,  oy = top − s·vv.offsetTop
// where (left, top) is where the layout viewport's origin sits on the screen: below the status bar, plus the
// browser's URL bar when it is showing (none in a standalone PWA). `top` is calibrated once (a one-frame screencap
// of magenta markers) and then followed at runtime: Chrome on Android grows window.innerHeight by exactly the
// height the URL bar gives up when it collapses, so top(t) = top₀ − dpr·(innerHeight(t) − innerHeight₀). The
// on-screen keyboard does NOT move the top (it shrinks the visual viewport from the bottom; reported as
// `keyboardInset` in CSS px) — so keyboard frames are excluded from the URL-bar term.
const r2 = (n) => Math.round(n * 100) / 100;

/** Affine mapping from page metrics + the calibrated screen position of the layout viewport. */
export function mappingFrom(metrics, cal) {
  const vv = metrics.vv || { offsetLeft: 0, offsetTop: 0, scale: 1, height: metrics.innerHeight };
  const scale = vv.scale || 1;
  const s = metrics.dpr * scale;
  let top = cal.top;
  // URL bar collapse/expand (browser mode only; a PWA has no URL bar). Not while the keyboard is up: Chrome
  // keeps innerHeight there, and a keyboard never changes where the page starts.
  if (!cal.standalone && cal.innerHeight && !keyboardUp(metrics)) top = cal.top - metrics.dpr * (metrics.innerHeight - cal.innerHeight);
  return { s: +s.toFixed(6), ox: r2(cal.left - s * vv.offsetLeft), oy: r2(top - s * vv.offsetTop) };
}

/** CSS px the keyboard covers at the bottom of the layout viewport (0 when it is hidden). */
export function keyboardInset(metrics) {
  const vv = metrics.vv;
  if (!vv || !metrics.editableFocused) return 0;
  const inset = metrics.innerHeight - vv.height * (vv.scale || 1);
  return inset > 80 ? r2(inset) : 0;
}
export const keyboardUp = (metrics) => keyboardInset(metrics) > 0;

export const mapPoint = (m, p) => ({ x: r2(m.ox + m.s * p.x), y: r2(m.oy + m.s * p.y) });
export const mapBox = (m, b) => ({ x: r2(m.ox + m.s * b.x), y: r2(m.oy + m.s * b.y), w: r2(m.s * b.w), h: r2(m.s * b.h) });
export const unmapPoint = (m, v) => ({ x: r2((v.x - m.ox) / m.s), y: r2((v.y - m.oy) / m.s) });

/**
 * Least-squares fit of {s, ox, oy} from marker pairs: expected CSS centres → detected video centroids.
 * Returns the fit plus the per-marker residual (video px) — the calibration QA number (must be ≤ 1 px).
 */
export function fitMapping(pairs) {
  if (pairs.length < 2) throw new Error('need at least 2 markers to calibrate');
  const n = pairs.length;
  const mx = pairs.reduce((a, p) => a + p.css.x, 0) / n, my = pairs.reduce((a, p) => a + p.css.y, 0) / n;
  const vx = pairs.reduce((a, p) => a + p.video.x, 0) / n, vy = pairs.reduce((a, p) => a + p.video.y, 0) / n;
  let num = 0, den = 0;
  for (const p of pairs) {
    num += (p.css.x - mx) * (p.video.x - vx) + (p.css.y - my) * (p.video.y - vy);
    den += (p.css.x - mx) ** 2 + (p.css.y - my) ** 2;
  }
  const s = num / den;
  const m = { s: +s.toFixed(6), ox: r2(vx - s * mx), oy: r2(vy - s * my) };
  const residuals = pairs.map((p) => { const q = mapPoint(m, p.css); return { id: p.id, dx: r2(q.x - p.video.x), dy: r2(q.y - p.video.y), err: r2(Math.hypot(q.x - p.video.x, q.y - p.video.y)) }; });
  return { mapping: m, residuals, maxErr: Math.max(...residuals.map((r) => r.err)) };
}

/** Error (video px) of a model mapping against detected marker centroids. */
export function mappingError(m, pairs) {
  const res = pairs.map((p) => { const q = mapPoint(m, p.css); return { id: p.id, err: r2(Math.hypot(q.x - p.video.x, q.y - p.video.y)) }; });
  return { residuals: res, maxErr: Math.max(...res.map((r) => r.err)) };
}

/**
 * Find solid colour blobs (default pure magenta) in an RGB24 image. Returns blobs {x,y,w,h,cx,cy,n} in image px,
 * largest first. Chroma subsampling blurs the edges of a marker; the centroid of the thresholded blob of a square
 * stays at its centre (symmetric blur), which is why markers are compared by centre, never by edge.
 */
export function findBlobs(rgb, width, height, { color = [255, 0, 255], tol = 90, minPixels = 20 } = {}) {
  const hit = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < hit.length; i++, p += 3) {
    const d = Math.abs(rgb[p] - color[0]) + Math.abs(rgb[p + 1] - color[1]) + Math.abs(rgb[p + 2] - color[2]);
    if (d < tol) hit[i] = 1;
  }
  const seen = new Uint8Array(width * height);
  const blobs = [];
  const stack = [];
  for (let i = 0; i < hit.length; i++) {
    if (!hit[i] || seen[i]) continue;
    let n = 0, sx = 0, sy = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    stack.push(i); seen[i] = 1;
    while (stack.length) {
      const j = stack.pop();
      const x = j % width, y = (j - x) / width;
      n++; sx += x; sy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const k of [j - 1, j + 1, j - width, j + width]) {
        if (k < 0 || k >= hit.length || seen[k] || !hit[k]) continue;
        if ((k === j - 1 || k === j + 1) && Math.floor(k / width) !== y) continue;
        seen[k] = 1; stack.push(k);
      }
    }
    // pixel centres: +0.5 so a blob covering px [10, 29] has its centre at 20.0
    if (n >= minPixels) blobs.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, cx: r2(sx / n + 0.5), cy: r2(sy / n + 0.5), n });
  }
  return blobs.sort((a, b) => b.n - a.n);
}

/** Pair expected marker boxes (CSS) with detected blobs by nearest predicted position under a rough mapping. */
export function pairMarkers(expected, blobs, rough) {
  const pairs = [];
  const used = new Set();
  for (const [id, b] of Object.entries(expected)) {
    const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const q = mapPoint(rough, c);
    let best = null, bd = Infinity;
    for (const [k, bl] of blobs.entries()) {
      if (used.has(k)) continue;
      const d = Math.hypot(bl.cx - q.x, bl.cy - q.y);
      if (d < bd) { bd = d; best = k; }
    }
    if (best === null || bd > rough.s * 60) continue;
    used.add(best);
    pairs.push({ id, css: c, video: { x: blobs[best].cx, y: blobs[best].cy } });
  }
  return pairs;
}

/**
 * Pair the four corner markers (tl/tr/bl/br) by GEOMETRY, independent of any first-guess mapping: keep blobs of the
 * expected marker size (CSS size × DPR, ±45 %, roughly square), then tl = min(x+y), br = max(x+y), tr = max(x−y),
 * bl = min(x−y). Falls back to nearest-to-guess pairing for other ids. A wrong first guess (unknown URL-bar height,
 * bottom toolbar) can then no longer pair a marker with the wrong blob.
 */
export function pairMarkersGeometric(expected, blobs, { dpr, rough = null } = {}) {
  const ids = Object.keys(expected);
  const size = (expected[ids[0]]?.w || 24) * dpr;
  const cand = blobs.filter((b) => b.w > size * 0.55 && b.w < size * 1.45 && b.h > size * 0.55 && b.h < size * 1.45 && Math.abs(b.w - b.h) < size * 0.35);
  const corners = ['tl', 'tr', 'bl', 'br'];
  if (!corners.every((k) => expected[k]) || cand.length < 3) return { pairs: rough ? pairMarkers(expected, cand.length >= 3 ? cand : blobs, rough) : [], candidates: cand.length, method: 'nearest' };
  const pick = { tl: (b) => -(b.cx + b.cy), br: (b) => b.cx + b.cy, tr: (b) => b.cx - b.cy, bl: (b) => -(b.cx - b.cy) };
  const used = new Set();
  const pairs = [];
  for (const k of corners) {
    let best = null;
    for (const b of cand) if (!used.has(b) && (!best || pick[k](b) > pick[k](best))) best = b;
    if (!best) continue;
    used.add(best);
    const e = expected[k];
    pairs.push({ id: k, css: { x: e.x + e.w / 2, y: e.y + e.h / 2 }, video: { x: best.cx, y: best.cy }, blob: { x: best.x, y: best.y, w: best.w, h: best.h } });
  }
  // with only 3 candidates one corner is missing: drop the pair that fits worst so a corner is never invented
  if (cand.length === 3 && pairs.length === 4) pairs.splice(pairs.indexOf(leaveOneOut(pairs).worst?.pair ?? pairs[3]), 1);
  return { pairs, candidates: cand.length, method: 'geometric' };
}

/** Separate least-squares scale+offset per axis (x and y): a uniform page maps with sx ≈ sy ≈ DPR. */
export function fitPerAxis(pairs) {
  const axis = (k) => {
    const n = pairs.length, mc = pairs.reduce((a, p) => a + p.css[k], 0) / n, mv = pairs.reduce((a, p) => a + p.video[k], 0) / n;
    let num = 0, den = 0;
    for (const p of pairs) { num += (p.css[k] - mc) * (p.video[k] - mv); den += (p.css[k] - mc) ** 2; }
    const s = den ? num / den : NaN;
    return { s: +s.toFixed(5), o: r2(mv - s * mc) };
  };
  return { x: axis('x'), y: axis('y') };
}

/** Fit without each marker in turn: one marker that is off (covered, misdetected) shows as a near-perfect rest fit. */
export function leaveOneOut(pairs) {
  if (pairs.length < 4) return { runs: [], worst: null };
  const runs = pairs.map((p) => { const rest = pairs.filter((q) => q !== p); const f = fitMapping(rest); return { without: p.id, fitErr: f.maxErr, mapping: f.mapping, pair: p }; });
  const best = runs.reduce((a, b) => (b.fitErr < a.fitErr ? b : a));
  const full = fitMapping(pairs).maxErr;
  const worst = best.fitErr <= 1.5 && full > 2 ? best : null;
  return { runs: runs.map(({ pair, ...r }) => r), worst };
}

/** Plain-language suspects from the numbers (what the lead checks first). */
export function calibrationSuspects({ metrics, expected, blobs, pairs, fit, perAxis, loo, model, modelErr, screen }) {
  const out = [];
  const dpr = metrics?.dpr;
  if ((blobs?.length || 0) < 4) out.push(`only ${blobs?.length || 0} magenta blob(s) detected: a marker is off screen/covered (Chrome toolbar, sign-in or translate bar, cookie banner) or the emulator's colours are off (see screencap.png)`);
  if (pairs && pairs.length < Object.keys(expected || {}).length) out.push(`paired ${pairs.length} of ${Object.keys(expected || {}).length} markers`);
  const res = Object.fromEntries((pairs || []).map((p) => [p.id, p]));
  if (perAxis && res.tl && res.tr && res.bl && res.br) {
    // anchor on the horizontal scale (vertical displacement cannot bias it) and the top row; where should the bottom
    // row be? (and the reverse) — a whole row shifted the same way = that edge of the page is covered or shifted
    const sx = perAxis.x.s;
    const row = (a, b) => { const o = (a.video.y - sx * a.css.y + b.video.y - sx * b.css.y) / 2; return o; };
    const dyOf = (p, o) => r2(p.video.y - (o + sx * p.css.y));
    const oTop = row(res.tl, res.tr), oBot = row(res.bl, res.br);
    const b1 = dyOf(res.bl, oTop), b2 = dyOf(res.br, oTop);
    if (Math.abs(b1) > 2 && Math.abs(b2) > 2 && Math.sign(b1) === Math.sign(b2) && Math.abs(b1 - b2) < Math.max(3, Math.abs(b1) * 0.5)) out.push(`both BOTTOM markers sit ${b1}/${b2} px off where the top row + horizontal scale put them (offset top row ${r2(oTop)} vs bottom row ${r2(oBot)} px): the bottom of the page is covered/shifted — content under an edge-to-edge navigation bar, a Chrome bottom toolbar, or innerHeight not matching what is visible`);
  }
  if (loo?.worst) out.push(`marker "${loo.worst.without}" is inconsistent with the other three (rest fit ${loo.worst.fitErr} px): it is covered or partly clipped — e.g. a bottom marker behind Chrome's bottom toolbar or the gesture bar`);
  if (fit && dpr && Math.abs(fit.mapping.s / dpr - 1) > 0.01) out.push(`fitted scale ${fit.mapping.s} ≠ DPR ${dpr} (×${(fit.mapping.s / dpr).toFixed(4)}): page zoom, visualViewport.scale ${metrics?.vv?.scale}, or the screencap is not at the video size`);
  if (perAxis && Math.abs(perAxis.x.s - perAxis.y.s) > 0.02 * Math.max(perAxis.x.s, perAxis.y.s)) out.push(`non-uniform scale sx ${perAxis.x.s} vs sy ${perAxis.y.s}: one axis is stretched — usually a mis-paired or clipped marker, else a resampled screencap`);
  if (fit && model && modelErr > 1 && fit.maxErr <= 1) out.push(`the markers fit (≤ 1 px) but the runtime model is off by ${modelErr} px: model {s ${model.s}, ox ${model.ox}, oy ${model.oy}} vs fit {s ${fit.mapping.s}, ox ${fit.mapping.ox}, oy ${fit.mapping.oy}} — the top offset (status bar + URL bar) or innerHeight tracking is wrong`);
  if (metrics && screen && Math.abs(metrics.innerWidth * dpr - screen.width) > 2) out.push(`innerWidth × DPR = ${(metrics.innerWidth * dpr).toFixed(1)} px ≠ screen width ${screen.width}: the page is not full-width (desktop-site mode or zoom)`);
  return out;
}
