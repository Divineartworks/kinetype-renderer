// Pixel QA of a native capture against its own event log:
//  - mapping: on a calibration fixture, every `observe` event's tracked vbox must sit on the magenta marker the
//    video actually shows at that time (≤ 1 px, centroid vs box centre) — through scrolls, i.e. it tests the
//    whole chain DOM metrics → mapping → recording clock, not just the one-frame calibration.
//  - latency: input → photon. The calibration fixture paints a pure-green band (CSS y 52–92, below the fixed markers) the moment a touch lands; the first
//    frame that shows it, minus the logged finger-down time, is the end-to-end latency of transport + recording.
import { findBlobs } from './mapping.js';
import { probeVideo, videoFrame, videoFrames } from './media.js';
import { stats } from '../capture/timeline.js';

const r2 = (n) => Math.round(n * 100) / 100;

export async function verifyMarkers(capture, videoFile, { samplesPerEvent = 3, maxErr = 1, minHold = 0.4 } = {}) {
  const info = probeVideo(videoFile);
  const checks = [];
  const obs = capture.events.filter((e) => e.type === 'observe' && e.vbox);
  for (const ev of obs) {
    // spatial accuracy only: sample track states that held still ≥ minHold s (the tracker logs on change, so a long
    // entry = the element did not move); the clock is measured separately (measureTouchLatency)
    const end = Math.min(ev.trackEnd ?? ev.t + 1, capture.duration - 1 / capture.fps);
    const track = ev.track || [{ t: ev.t, vbox: ev.vbox, visible: ev.visible !== false }];
    // a span counts as still only where probes PROVED it (entry.t … entry.seen, re-confirmed at ≤ 0.2 s spacing);
    // between probes the observer may have been starved and the element may have moved unseen
    const still = track.map((e) => ({ e, from: e.t, to: e.seen ?? e.t, probes: e.probes ?? 1 }))
      .filter((x) => x.e.visible && x.e.vbox && x.to - x.from >= minHold && (x.to - x.from) / Math.max(1, x.probes - 1) <= 0.2)
      .sort((a, b) => (b.to - b.from) - (a.to - a.from)).slice(0, samplesPerEvent);
    for (const { e: st, from, to } of still) {
      // as late as the probes prove it still (a damage-driven recorder may deliver the settled frame > 0.3 s late)
      const t = Math.max(from + 0.3, to - 0.05);
      const f = Math.round(t * info.fps);
      const img = await videoFrame(videoFile, f, info);
      const blobs = findBlobs(img.rgb, img.width, img.height);
      const cx = st.vbox.x + st.vbox.w / 2, cy = st.vbox.y + st.vbox.h / 2;
      let best = null;
      for (const b of blobs) { const d = Math.hypot(b.cx - cx, b.cy - cy); if (!best || d < best.d) best = { d, b }; }
      checks.push({ step: ev.step, label: ev.label, t: r2(t), frame: f, expected: { x: r2(cx), y: r2(cy) }, found: best ? { x: best.b.cx, y: best.b.cy } : null, err: best ? r2(best.d) : null });
    }
  }
  const errs = checks.filter((c) => c.err !== null).map((c) => c.err);
  return { checks, n: errs.length, missing: checks.filter((c) => c.err === null).length, maxErr: errs.length ? Math.max(...errs) : null, pass: errs.length > 0 && checks.every((c) => c.err !== null && c.err <= maxErr) };
}

/** First frame at/after each tap whose top band turns pure green → input→photon latency (ms). */
export async function measureTouchLatency(capture, videoFile, { band = [52, 92], within = 0.6 } = {}) {
  const info = probeVideo(videoFile);
  const taps = capture.events.filter((e) => (e.type === 'click' || e.type === 'swipe' || e.type === 'fling') && e.mapping);
  const out = [];
  for (const ev of taps) {
    const y0 = Math.round(ev.mapping.oy + ev.mapping.s * band[0] + 4), y1 = Math.round(ev.mapping.oy + ev.mapping.s * band[1] - 4);
    let found = null;
    const f0 = Math.max(0, Math.floor(ev.t * info.fps) - 1);
    const imgs = await videoFrames(videoFile, f0, Math.min(info.frames - f0, Math.ceil(within * info.fps)), info);
    for (const img of imgs) {
      const f = img.index;
      let g = 0, n = 0;
      for (let y = y0; y < y1; y += 4) for (let x = 8; x < img.width - 8; x += 16) { const p = (y * img.width + x) * 3; n++; if (img.rgb[p] < 60 && img.rgb[p + 1] > 200 && img.rgb[p + 2] < 60) g++; }
      if (n && g / n > 0.8) { found = f; break; }
    }
    out.push({ step: ev.step, t: ev.t, frame: found, latencyMs: found === null ? null : Math.round((found / info.fps - ev.t) * 1000) });
  }
  const lat = out.filter((o) => o.latencyMs !== null).map((o) => o.latencyMs);
  return { taps: out, latencyMs: stats(lat), frameMs: r2(1000 / info.fps) };
}

/**
 * Clock alignment on the VIDEO, during motion: the marker's y as detected in the recorded frames vs its logged track
 * (piecewise linear between probes), searched over a time shift τ. τ ≈ 0 means a logged event time is the frame
 * that shows it; |τ| is what the editor must not exceed (≤ 2 frames). Frames are analysed at 1/4 size.
 */
export async function measureClockLag(capture, videoFile, { scale = 0.25, maxShift = 0.6, step = 0.005 } = {}) {
  const info = probeVideo(videoFile);
  const series = [];
  // markers that never move (fixed corners) are not the moving one: drop blobs at their positions
  const fixed = capture.events.filter((e) => e.type === 'observe' && e.vbox && (!e.track || e.track.every((x) => !x.vbox || Math.abs(x.vbox.y - e.vbox.y) < 2)))
    .map((e) => ({ x: e.vbox.x + e.vbox.w / 2, y: e.vbox.y + e.vbox.h / 2 }));
  for (const ev of capture.events.filter((e) => e.type === 'observe' && e.track && e.track.length >= 4)) {
    const tr = ev.track.filter((x) => x.vbox && x.visible);
    const moving = tr.filter((x, i) => i > 0 && Math.abs(x.vbox.y - tr[i - 1].vbox.y) > 2);
    if (moving.length < 3) continue;
    const t0 = Math.max(0, moving[0].t - 0.15), t1 = Math.min(capture.duration, moving[moving.length - 1].t + 0.15);
    const f0 = Math.floor(t0 * info.fps), n = Math.ceil((t1 - t0) * info.fps);
    const frames = await videoFrames(videoFile, f0, n, info, { scale });
    const per = frames.map((fr) => findBlobs(fr.rgb, fr.width, fr.height, { minPixels: 6 }).map((b) => ({ x: b.cx / scale, y: b.cy / scale })));
    // anything that sits still through most of the window is a fixed marker, not the moving one
    const still = (b) => per.filter((bs) => bs.some((o) => Math.hypot(o.x - b.x, o.y - b.y) < 4)).length > per.length * 0.6;
    let lastY = null;
    frames.forEach((fr, k) => {
      const t = fr.index / info.fps;
      const pred = yAt(tr, t);
      if (pred === null) return;
      let best = null;
      for (const b of per[k]) {
        if (fixed.some((f) => Math.hypot(b.x - f.x, b.y - f.y) < 40) || still(b)) continue;
        const d = Math.abs(b.y - (lastY ?? pred));
        if (!best || d < best.d) best = { d, y: b.y };
      }
      if (best && best.d < 300) { series.push({ t, y: best.y, track: tr }); lastY = best.y; } else lastY = null;
    });
  }
  if (series.length < 10) return { n: series.length, lagMs: null, note: 'not enough moving-marker frames' };
  let bestTau = 0, bestErr = Infinity;
  for (let tau = -maxShift; tau <= maxShift + 1e-9; tau += step) {
    const errs = series.map((p) => { const y = yAt(p.track, p.t - tau); return y === null ? null : Math.abs(y - p.y); }).filter((e) => e !== null).sort((a, b) => a - b);
    const med = errs[Math.floor(errs.length / 2)];
    if (med < bestErr) { bestErr = med; bestTau = tau; }
  }
  const at0 = series.map((p) => Math.abs(yAt(p.track, p.t) - p.y)).sort((a, b) => a - b);
  return { n: series.length, lagMs: Math.round(bestTau * 1000), atSearchBound: Math.abs(bestTau) >= maxShift - step, medianErrPxAtLag: r2(bestErr), medianErrPxAtZero: r2(at0[Math.floor(at0.length / 2)]), frameMs: r2(1000 / info.fps), note: 'lag > 0: the video shows a position later than the log says (the log is early)' };
}

function yAt(track, t) {
  if (t < track[0].t || t > track[track.length - 1].t + 0.5) return null;
  let i = 0; while (i + 1 < track.length && track[i + 1].t <= t) i++;
  const a = track[i], b = track[i + 1];
  const ca = a.vbox.y + a.vbox.h / 2;
  if (!b) return ca;
  const cb = b.vbox.y + b.vbox.h / 2;
  return ca + (cb - ca) * ((t - a.t) / (b.t - a.t));
}


/**
 * Real targets (no markers): for each tap, the frame just before the finger lands; the solid-colour region the logged
 * vbox centre sits in (a button, a card) is flood-filled within the vbox ± pad; its bounding box vs the vbox = the
 * mapping error on the app's own controls. Text inside is a hole (does not move the extremes); rounded corners keep
 * the edge midpoints. Reports per tap: dominant colour and edge errors (px).
 */
export async function verifyTargetBoxes(capture, videoFile, { pad = 24, tol = 18 } = {}) {
  const info = probeVideo(videoFile);
  const out = [];
  for (const ev of capture.events.filter((e) => e.type === 'click' && e.vbox && e.box)) {
    const t = Math.max(0, ev.t - Math.min(0.12, (ev.approach || 0.3) / 2));
    const fr = await videoFrame(videoFile, Math.round(t * info.fps), info);
    const { rgb, width: W, height: H } = fr;
    const v = ev.vbox;
    const x0 = Math.max(0, Math.floor(v.x - pad)), y0 = Math.max(0, Math.floor(v.y - pad)), x1 = Math.min(W - 1, Math.ceil(v.x + v.w + pad)), y1 = Math.min(H - 1, Math.ceil(v.y + v.h + pad));
    const px = (x, y) => { const p = (y * W + x) * 3; return [rgb[p], rgb[p + 1], rgb[p + 2]]; };
    // dominant colour: the median of a ring just inside the box edge (avoids the label in the middle)
    const ring = [];
    for (let k = 0; k < 40; k++) {
      const u = (k + 0.5) / 40;
      ring.push(px(Math.round(v.x + v.w * u), Math.round(v.y + 4)), px(Math.round(v.x + v.w * u), Math.round(v.y + v.h - 5)));
    }
    const med = [0, 1, 2].map((c) => ring.map((p) => p[c]).sort((a, b) => a - b)[ring.length >> 1]);
    const near = (x, y) => { const p = px(x, y); return Math.abs(p[0] - med[0]) + Math.abs(p[1] - med[1]) + Math.abs(p[2] - med[2]) < tol; };
    let bx0 = Infinity, by0 = Infinity, bx1 = -1, by1 = -1;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (near(x, y)) {
      // count only rows/columns where the colour is the region (≥ 30 % of the box's span), not stray pixels outside
      if (x < bx0 || x > bx1 || y < by0 || y > by1) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
    }
    const rowFrac = (y) => { let n = 0; for (let x = x0; x <= x1; x++) if (near(x, y)) n++; return n / v.w; };
    const colFrac = (x) => { let n = 0; for (let y = y0; y <= y1; y++) if (near(x, y)) n++; return n / v.h; };
    while (by0 < by1 && rowFrac(by0) < 0.3) by0++; while (by1 > by0 && rowFrac(by1) < 0.3) by1--;
    while (bx0 < bx1 && colFrac(bx0) < 0.3) bx0++; while (bx1 > bx0 && colFrac(bx1) < 0.3) bx1--;
    const e = { left: r2(bx0 - v.x), top: r2(by0 - v.y), right: r2(bx1 + 1 - (v.x + v.w)), bottom: r2(by1 + 1 - (v.y + v.h)) };
    // a region that fills the whole search window is the page background, not the control: no verdict
    const bleed = bx0 <= x0 || by0 <= y0 || bx1 >= x1 || by1 >= y1;
    out.push({ step: ev.step, label: ev.label, t: r2(t), colour: med, edges: e, maxErr: bleed ? null : Math.max(...Object.values(e).map(Math.abs)) });
  }
  const errs = out.filter((o) => o.maxErr !== null).map((o) => o.maxErr);
  return { taps: out, n: errs.length, maxErr: errs.length ? Math.max(...errs) : null, medianErr: errs.length ? [...errs].sort((a, b) => a - b)[errs.length >> 1] : null };
}
