// UI-demo kit: pure planners that turn a kinetype.capture.v1 (a recorded
// product UI + its events) into a film: retime (film clock → capture clock),
// an automatic camera, a human cursor and callout placement. Everything here is
// a pure function of its inputs, so a frame is a pure function of t and the
// whole plan is unit-testable without a browser. Coordinates are CSS px of the
// captured viewport unless a name says "screen".
import { clamp, lerp } from './math.js';
import { Track, springStep } from './spring.js';
import { hash } from './rng.js';
import { expoOut } from './ease.js';

// ───────────────────────── time references ─────────────────────────

/**
 * Resolve a time reference on the CAPTURE clock: a number (seconds), a mark id,
 * or a step id (its t0; `edge: 't1'` for its end). Throws a clear error.
 */
export function captureTime(cap, at, edge = 't0') {
  if (typeof at === 'number') return at;
  const mk = (cap.marks || []).find((m) => m.id === at);
  if (mk) return mk.t;
  const st = (cap.steps || []).find((s) => s.id === at);
  if (st) return st[edge] ?? st.t0;
  const ids = [...(cap.marks || []).map((m) => m.id), ...(cap.steps || []).map((s) => s.id)];
  throw new Error(`"${at}" is not a mark or step of capture ${cap.flow || ''} (have: ${ids.join(', ') || 'none'})`);
}

/** The event a step refers to (for callouts / manual camera focus): its click first, then any event. */
export function stepEvent(cap, at) {
  const evs = (cap.events || []).filter((e) => e.step === at);
  return evs.find((e) => e.type === 'click' && e.box) || evs.find((e) => e.box) || evs[0] || null;
}

// ───────────────────────── retime ─────────────────────────

/** A hold shows the capture this long before its point (less than any frame interval). */
export const HOLD_EPS = 1e-4;

/**
 * Film clock → capture clock: `range` picks [from, to] of the capture; `retime`
 * holds speed segments {from, to, speed} and freezes {at, hold}. The map is a
 * monotone, piecewise-linear function plus flat holds. Contract C3: a hold at
 * X freezes the capture immediately BEFORE X for `hold` film seconds; whatever
 * happens at X (event, mark) plays after it. Holds at the same X add up.
 * Returns { duration, pieces, toCapture(f), toFilm(c) }.
 */
export function buildRetime(cap, { range, retime } = {}) {
  const c0 = range?.from != null ? captureTime(cap, range.from) : 0;
  const c1 = range?.to != null ? captureTime(cap, range.to, 't1') : cap.duration;
  if (!(c1 > c0)) throw new Error(`range: "to" (${c1}) must come after "from" (${c0})`);
  const speeds = [], holds = [];
  for (const r of retime || []) {
    if (r.hold != null) {
      const at = captureTime(cap, r.at);
      if (at >= c0 - 1e-9 && at <= c1 + 1e-9) holds.push({ at: clamp(at, c0, c1), hold: Math.max(0, r.hold) });
      continue;
    }
    const a = Math.max(c0, captureTime(cap, r.from)), b = Math.min(c1, captureTime(cap, r.to, r.toEdge || 't0'));
    if (!(r.speed > 0)) throw new Error('retime: speed must be > 0');
    if (b > a) speeds.push({ a, b, speed: r.speed });
  }
  speeds.sort((x, y) => x.a - y.a);
  for (let i = 1; i < speeds.length; i++) if (speeds[i].a < speeds[i - 1].b - 1e-9) throw new Error(`retime: speed segments overlap at ${speeds[i].a.toFixed(3)}s`);
  holds.sort((x, y) => x.at - y.at);
  // breakpoints on the capture clock
  const cuts = new Set([c0, c1, ...speeds.flatMap((s) => [s.a, s.b]), ...holds.map((h) => h.at)]);
  const xs = [...cuts].sort((a, b) => a - b);
  const speedAt = (c) => speeds.find((s) => c >= s.a - 1e-9 && c < s.b - 1e-9)?.speed ?? 1;
  const pieces = [];
  let f = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    for (const h of holds) if (Math.abs(h.at - x) < 1e-9 && h.hold > 0) { pieces.push({ f0: f, f1: f + h.hold, c0: x, c1: x, speed: 0 }); f += h.hold; }
    if (i + 1 < xs.length) {
      const y = xs[i + 1], sp = speedAt((x + y) / 2), d = (y - x) / sp;
      if (d > 0) { pieces.push({ f0: f, f1: f + d, c0: x, c1: y, speed: sp }); f += d; }
    }
  }
  // a linear piece that runs into a hold stops HOLD_EPS short of it (monotone into the freeze)
  pieces.forEach((p, i) => { p.cmax = p.speed && pieces[i + 1] && !pieces[i + 1].speed ? p.c1 - HOLD_EPS : p.c1; });
  const duration = f;
  function toCapture(t) {
    if (t <= 0) return pieces[0] && !pieces[0].speed ? c0 - HOLD_EPS : c0;
    if (t >= duration) return c1;
    let lo = 0, hi = pieces.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (pieces[m].f0 <= t) lo = m; else hi = m - 1; }
    const p = pieces[lo];
    // a hold freezes the capture JUST BEFORE its point: what happens at X plays after the hold
    return p.speed ? Math.min(p.cmax, p.c0 + (t - p.f0) * p.speed) : p.c0 - HOLD_EPS;
  }
  /** Film time at which capture time c plays — an event at a hold point plays AFTER the hold (contract C3). */
  function toFilm(c) {
    if (c <= c0) return 0 - (c0 - c);
    if (c >= c1) return duration + (c - c1);
    for (const p of pieces) if (p.speed && c >= p.c0 - 1e-9 && c < p.c1 - 1e-9) return p.f0 + (c - p.c0) / p.speed;
    return toFilmFirst(c);
  }
  /** The earliest film time showing capture time c (for a hold point: the start of its freeze). */
  function toFilmFirst(c) {
    if (c <= c0) return 0 - (c0 - c);
    if (c >= c1) return duration + (c - c1);
    for (const p of pieces) if (c >= p.c0 - 1e-9 && c <= p.c1 + 1e-9) return p.speed ? p.f0 + (c - p.c0) / p.speed : p.f0;
    return duration;
  }
  return { duration, pieces, c0, c1, toCapture, toFilm, toFilmFirst };
}

/** Capture events on the film clock (only those inside the film), sorted. */
export function filmEvents(cap, rt) {
  const out = [];
  for (const e of cap.events || []) {
    const t = rt.toFilm(e.t);
    if (t < -1e-6 || t > rt.duration + 1e-6) continue;
    const ev = { ...e, ct: e.t, t };
    if (e.t1 != null) ev.t1 = Math.min(rt.duration, rt.toFilm(e.t1));
    out.push(ev);
  }
  return out.sort((a, b) => a.t - b.t);
}

// ───────────────────────── target tracks ─────────────────────────

/**
 * Where an event's target is on capture frame `idx`, and whether it is really
 * visible there (C2 `events[].track`: entries {t, box?, visible} written on
 * change, from the moment the target was resolved until its step ended plus a
 * tail; `trackEnd` closes it). Fail-closed: before the first entry, at/after
 * `trackEnd`, or when the target was gone, `visible` is false. Events without
 * a track (captures made before tracks existed) return null — the caller must
 * not assume anything about them.
 */
export function trackAt(ev, idx, fps) {
  const tr = ev?.track;
  if (!Array.isArray(tr) || !tr.length) return null;
  if (ev.trackEnd != null && idx >= Math.round(ev.trackEnd * fps)) return { visible: false, box: null };
  let lo = 0, hi = tr.length - 1, k = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (Math.round(tr[m].t * fps) <= idx) { k = m; lo = m + 1; } else hi = m - 1; }
  if (k < 0) return { visible: false, box: null };
  const e = tr[k];
  return { visible: !!(e.visible && e.box), box: e.box || null };
}

/**
 * The ONE map from capture CSS px to output px, used for the captured frames
 * AND everything drawn over them (highlights, leaders, cursor, ripples).
 *   W, H: the stage (output px; the stage centre is the camera centre)
 *   s:    output px per CSS px at zoom 1 (window scale)
 * c = camera {cx, cy, z}. apply(g, c) sets the identical transform on a canvas.
 */
export function stageMap({ W, H, s }) {
  const ox = W / 2, oy = H / 2;
  return {
    s,
    k: (c) => s * c.z,
    pt: (c, x, y) => ({ x: ox + (x - c.cx) * s * c.z, y: oy + (y - c.cy) * s * c.z }),
    box: (c, b) => ({ x: ox + (b.x - c.cx) * s * c.z, y: oy + (b.y - c.cy) * s * c.z, w: b.w * s * c.z, h: b.h * s * c.z }),
    apply: (g, c) => { g.translate(ox, oy); g.scale(s * c.z, s * c.z); g.translate(-c.cx, -c.cy); },
  };
}

/** A highlight is the target box plus this uniform padding (CSS px of the capture), stroke centred on it. */
export const HIGHLIGHT_PAD = 6;

// ───────────────────────── geometry ─────────────────────────

export const union = (a, b) => { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }; };
export const pad = (b, p) => ({ x: b.x - p, y: b.y - p, w: b.w + 2 * p, h: b.h + 2 * p });
export const overlapArea = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
export const overlaps = (a, b, m = 0) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;

/**
 * The view (what the camera can show), in CSS px of the capture.
 *   content: {x, y, w, h}   the window incl. chrome (camera never needs to show past it when zoomed)
 *   viewW/viewH             CSS px visible at zoom 1 (the output frame / base scale)
 *   zMax                    zoom ceiling (from the source resolution and the format)
 */
export const EDGE_SNAP = 0.12; // a zoomed view edge this close (fraction of the content) to the capture's own edge snaps to it

/**
 * Edge rules for a zoomed camera (pure; CSS px of the capture). Moves the view centre only:
 *  1. a view edge that slices a context box (a card, a logo: any boxed element of the capture,
 *     except ones wider than the view, which are containers) moves to that box's edge
 *     (include it, or leave it out: whichever is the smaller shift), when the target (plus
 *     `keep` px) still fits and the shift is <= 15 % of the view; and
 *  2. a view edge within EDGE_SNAP of the content edge snaps to it (the strip where logos,
 *     headers and footers live must not be sliced), under the same fit condition and only
 *     when that does not slice more context boxes.
 */
export function snapView(c, target, content, viewW, viewH, { context = [], keep = 0, snap = EDGE_SNAP } = {}) {
  if (c.z <= 1 + 1e-6) return c;
  const hw = viewW / (2 * c.z), hh = viewH / (2 * c.z);
  const t = pad(target, keep);
  const out = { ...c };
  const tol = 3; // CSS px: an edge this close to a box edge is not slicing it
  const axes = [
    { k: 'cx', h: hw, lo: content.x, hi: content.x + content.w, tLo: t.x, tHi: t.x + t.w, o: 'cy', oh: hh, size: content.w, b0: (b) => b.x, b1: (b) => b.x + b.w, p0: (b) => b.y, p1: (b) => b.y + b.h },
    { k: 'cy', h: hh, lo: content.y, hi: content.y + content.h, tLo: t.y, tHi: t.y + t.h, o: 'cx', oh: hw, size: content.h, b0: (b) => b.y, b1: (b) => b.y + b.h, p0: (b) => b.x, p1: (b) => b.x + b.w },
  ];
  for (const a of axes) {
    if (2 * a.h >= a.size - 1e-6) continue; // the view already spans the content on this axis
    const cur = out[a.k];
    const fits = (v) => v - a.h >= a.lo - 1e-6 && v + a.h <= a.hi + 1e-6 && a.tLo >= v - a.h - 1e-6 && a.tHi <= v + a.h + 1e-6;
    const ctxs = context.filter((b) => (a.b1(b) - a.b0(b)) < 2 * a.h && a.p1(b) > out[a.o] - a.oh && a.p0(b) < out[a.o] + a.oh);
    const slices = (v) => ctxs.reduce((n, b) => n + (a.b0(b) < v - a.h - tol && a.b1(b) > v - a.h + tol) + (a.b0(b) < v + a.h - tol && a.b1(b) > v + a.h + tol), 0);
    let best = cur, bestN = slices(cur);
    if (bestN > 0) {
      const cands = ctxs.flatMap((b) => [a.b0(b) + a.h, a.b1(b) + a.h, a.b1(b) - a.h, a.b0(b) - a.h]);
      for (const v of cands.sort((p, q) => Math.abs(p - cur) - Math.abs(q - cur))) {
        if (Math.abs(v - cur) > 0.15 * 2 * a.h || !fits(v)) continue;
        const n = slices(v);
        if (n < bestN) { best = v; bestN = n; }
      }
    }
    // edge snap: only toward an edge that is close, never at the cost of slicing more
    const band = snap * a.size;
    const snaps = [];
    if (best - a.h > a.lo + 1e-6 && best - a.h - a.lo < band) snaps.push(a.lo + a.h);
    if (a.hi - (best + a.h) > 1e-6 && a.hi - (best + a.h) < band) snaps.push(a.hi - a.h);
    for (const v of snaps.sort((p, q) => Math.abs(p - best) - Math.abs(q - best))) {
      if (fits(v) && slices(v) <= bestN) { best = v; break; }
    }
    out[a.k] = best;
  }
  return out;
}

/**
 * Recorded element boxes that a camera's left/right window edge slices mid-element (pure; CSS px).
 * Boxes as wide as the window (containers) and boxes outside its vertical span do not count.
 */
export function sidesSliced(c, context, viewW, viewH, tol = 3) {
  if (c.z <= 1 + 1e-6) return [];
  const hw = viewW / (2 * c.z), hh = viewH / (2 * c.z), l = c.cx - hw, r = c.cx + hw;
  return context.filter((b) => b.w < 2 * hw && b.y + b.h > c.cy - hh && b.y < c.cy + hh
    && ((b.x < l - tol && b.x + b.w > l + tol) || (b.x < r - tol && b.x + b.w > r + tol)));
}

export function makeView({ content, viewW, viewH, zMax = 2.4, fill = 0.6, padding = 40, minTarget = 0.4, wideTop = false, context = [] }) {
  let wide = { cx: content.x + content.w / 2, cy: content.y + content.h / 2, z: 1 };
  /** Clamp a camera so that, zoomed, it does not drift past the content edge. */
  function clampCam(c) {
    const hw = viewW / (2 * c.z), hh = viewH / (2 * c.z);
    const cx = 2 * hw >= content.w ? content.x + content.w / 2 : clamp(c.cx, content.x + hw, content.x + content.w - hw);
    const cy = 2 * hh >= content.h ? content.y + content.h / 2 : clamp(c.cy, content.y + hh, content.y + content.h - hh);
    return { cx, cy, z: c.z };
  }
  /** Camera that frames box b: fills `fill` of the width, never crops it, within [1, zMax]. */
  function frame(b, { fillW = fill, zCap = zMax } = {}) {
    // a lone button is shown with its neighbourhood: targets are at least
    // `minTarget` of the content width (context reads; no claustrophobic punch-in)
    const mw = minTarget * content.w, mh = minTarget * 0.5 * content.h;
    const bb = { x: b.x - Math.max(0, mw - b.w) / 2, y: b.y - Math.max(0, mh - b.h) / 2, w: Math.max(b.w, mw), h: Math.max(b.h, mh) };
    const p = pad(bb, padding);
    let z = clamp(Math.min((fillW * viewW) / p.w, (0.78 * viewH) / p.h), 1, Math.max(1, zCap));
    let cam = clampCam({ cx: p.x + p.w / 2, cy: p.y + p.h / 2, z });
    // the whole target stays inside the view (a content edge may have pulled the centre): back off the zoom
    for (let i = 0; i < 40 && cam.z > 1 && !shows(cam, b, 0); i++) { z = Math.max(1, z * 0.97); cam = clampCam({ ...cam, z }); }
    const keep = Math.min(padding * 0.5, 24);
    const settle = (c) => { const sn = snapView(c, b, content, viewW, viewH, { context, keep }); return clampCam(shows(sn, b, 0) ? sn : c); };
    cam = settle(cam);
    // hard rule: no side edge may slice a recorded element; relax the zoom until none does (z 1 spans the content: no side crop)
    for (let i = 0; i < 80 && cam.z > 1 && sidesSliced(cam, context, viewW, viewH).length; i++) cam = settle(clampCam({ ...cam, z: Math.max(1, cam.z * 0.97) }));
    if (cam.z > 1 && sidesSliced(cam, context, viewW, viewH).length) cam = clampCam({ ...cam, z: 1 });
    return cam;
  }
  /** Is box b fully on screen for camera c (with margin m, css px)? */
  function shows(c, b, m = 0) {
    const hw = viewW / (2 * c.z), hh = viewH / (2 * c.z);
    return b.x - m >= c.cx - hw - 1e-6 && b.x + b.w + m <= c.cx + hw + 1e-6 && b.y - m >= c.cy - hh - 1e-6 && b.y + b.h + m <= c.cy + hh + 1e-6;
  }
  // a window taller than the frame: the wide shot shows its top (title bar at the safe edge), the bottom bleeds
  if (wideTop) wide = clampCam({ cx: wide.cx, cy: content.y, z: 1 });
  return { content, viewW, viewH, zMax, fill, padding, minTarget, wide, clampCam, frame, shows, context };
}

// ───────────────────────── camera ─────────────────────────

export const CAMERA_FEEL = { f: 1.15, z: 1 }; // critically damped: settles, never bounces

/** Longer screen-space moves get a slightly slower (still critically damped) spring. */
export function moveFeel(a, b, view, vmax = MAX_SPEED) {
  const d = screenTravel(a, b, view);
  // critically damped peak speed = d·ω/e → cap it: a reading UI must stay legible mid-move
  const fCap = (Math.E * vmax) / (2 * Math.PI * Math.max(1e-6, d));
  return { f: clamp(Math.min(1.35 - 0.45 * d, fCap), 0.5, 1.35), z: 1 };
}

/** Peak camera speed, in frame widths per second (0.8 ≈ 1 540 px/s at 1080p). */
export const MAX_SPEED = 0.8;
/** How far a move travels on screen, in frame widths (pan at zoom + zoom change). */
export function screenTravel(a, b, view) {
  const zs = Math.max(a.z, b.z);
  return Math.hypot(b.cx - a.cx, b.cy - a.cy) * zs / view.viewW + Math.abs(Math.log(b.z / a.z)) * 0.5;
}

/**
 * Auto camera from film-time events. Returns keys [{t, cx, cy, z, why}] —
 * each key starts a spring toward that camera at time t.
 *   lead     camera starts moving this long before the event (anticipation)
 *   gapMax   events closer than this share one shot
 *   returnGap  if the next shot is further away than this, return wide in between
 *   linger   how long a shot holds after its last event
 */
export function planCamera(events, view, { lead = 0.42, gapMax = 1.6, returnGap = 2.5, linger = 0.75, minZoom = 1.18, minShot = 0.7, calm = 0.8, calmGap = 4, cutBeyond = 0.62, duration = Infinity } = {}) {
  const keys = [];
  // an `observe` is a focus event only when something narrates it (e.focus, set by the template for a callout's target)
  const focus = events.filter((e) => e.box && (e.type === 'click' || e.type === 'type' || e.type === 'hover' || (e.type === 'observe' && e.focus)));
  // a narrated element keeps the shot until its callout ends (e.holdUntil), but never past the next action's lead-in
  const holdEnd = (e) => {
    const end = e.t1 ?? e.t;
    if (e.holdUntil == null) return end;
    const nx = focus.find((x) => x !== e && x.t > e.t + 1e-6);
    return Math.max(end, Math.min(e.holdUntil, nx ? Math.min(nx.t, nx.attend ?? nx.t) - lead - 0.1 : Infinity));
  };
  const breaks = events.filter((e) => e.type === 'navigate' || e.type === 'scroll');
  const breakBetween = (a, b) => breaks.some((x) => x.t > a + 1e-6 && x.t < b - 1e-6);
  // 1. cluster
  const clusters = [];
  for (const e of focus) {
    const end = holdEnd(e);
    const st = Math.min(e.t, e.attend ?? e.t); // a callout can ask the camera to arrive earlier
    const c = clusters[clusters.length - 1];
    if (c && st - c.end <= gapMax && !breakBetween(c.end, st)) {
      const u = union(c.box, e.box);
      const zu = view.frame(u).z, zc = view.frame(c.box).z;
      // the union still frames tightly enough → same shot; else a new shot (the camera pans)
      if (zu >= Math.max(minZoom, zc * 0.72)) { c.box = u; c.end = Math.max(c.end, end); c.events.push(e); continue; }
    }
    clusters.push({ box: e.box, start: st, end, events: [e] });
  }
  // 1b. calm: neighbouring shots whose union frames nearly as tight become one
  // shot (no hop between two similar framings), as long as no page change sits between
  for (let k = 0; k + 1 < clusters.length;) {
    const a = clusters[k], b = clusters[k + 1];
    const zu = view.frame(union(a.box, b.box)).z;
    if (!breakBetween(a.end, b.start) && b.start - a.end <= calmGap && zu >= Math.max(minZoom, calm * Math.min(view.frame(a.box).z, view.frame(b.box).z))) {
      clusters.splice(k, 2, { box: union(a.box, b.box), start: a.start, end: Math.max(a.end, b.end), events: [...a.events, ...b.events] });
    } else k++;
  }
  // 2. shots → keys
  let last = view.wide;
  const push = (t, cam, why, focusPt) => {
    t = Math.max(0, t);
    const prev = keys[keys.length - 1];
    if (prev && t < prev.t + 0.2) keys.pop(); // a newer intention replaces one that never had time to show
    const feel = moveFeel(last, cam, view);
    // a speed-capped (slower) move starts earlier, so it has mostly arrived when the action happens
    if (!/wide/.test(why)) t = Math.max(prev ? prev.t + 0.25 : 0, t - Math.max(0, 0.62 / feel.f - lead));
    keys.push({ t, cx: cam.cx, cy: cam.cy, z: cam.z, why, feel, ...(focusPt ? { focus: focusPt } : {}) });
    last = cam;
  };
  // a pan between two zoomed shots that are far apart arcs out (pull back a
  // little, travel, push in) instead of whipping across the UI at full zoom
  const goTo = (t, cam, why, focusPt) => {
    const travel = Math.hypot(cam.cx - last.cx, cam.cy - last.cy) * Math.min(last.z, cam.z);
    // far apart at zoom: a clean cut beats a long blurred pan across a UI people are reading
    if (last.z > 1.05 && cam.z > 1.05 && travel > cutBeyond * view.viewW) {
      push(t - 0.1, cam, `${why} (cut)`, focusPt);
      keys[keys.length - 1].cut = true;
      return;
    }
    if (last.z > 1.05 && cam.z > 1.05 && travel > 0.3 * view.viewW) {
      const zMid = Math.max(1, Math.min(last.z, cam.z) * 0.62);
      const mid = view.clampCam({ cx: (last.cx + cam.cx) / 2, cy: (last.cy + cam.cy) / 2, z: zMid });
      push(t - 0.22, mid, 'arc out');
      push(t + 0.16, cam, why, focusPt);
      return;
    }
    push(t, cam, why, focusPt);
  };
  const isWide = (c) => Math.abs(c.z - 1) < 1e-6;
  const finish = () => {
    // a shot that would be left again within `minShot` is not a shot, it is a twitch
    for (let i = keys.length - 2; i >= 0; i--) {
      if (keys[i].why === 'arc out') continue;
      if (keys[i + 1].t - keys[i].t < minShot && keys[i + 1].why !== 'follow caret') keys.splice(i, 1);
    }
    // a key that asks for the camera it already has is noise
    for (let i = keys.length - 1; i >= 0; i--) {
      const p = i ? keys[i - 1] : view.wide;
      if (Math.abs(p.cx - keys[i].cx) < 1e-6 && Math.abs(p.cy - keys[i].cy) < 1e-6 && Math.abs(p.z - keys[i].z) < 1e-6) keys.splice(i, 1);
    }
    return keys;
  };
  clusters.forEach((c, k) => {
    const cam = view.frame(c.box);
    if (cam.z < minZoom) {
      if (!isWide(last)) push(c.start - lead, view.wide, 'wide (shot too large to zoom)');
      return;
    }
    goTo(c.start - lead, cam, `shot ${k + 1}: ${c.events.map((e) => e.step || e.type).filter((v, i, a) => a.indexOf(v) === i).join(' + ')}`, { x: c.box.x + c.box.w / 2, y: c.box.y + c.box.h / 2 });
    // typing in a field wider than the view: follow the caret gently
    for (const e of c.events) {
      if (e.type !== 'type' || !e.text || view.shows(cam, e.box, -8)) continue;
      const n = [...e.text].length, cw = e.box.h * 0.2;
      for (let s = e.t + 0.5; s < (e.t1 ?? e.t) - 0.1; s += 0.6) {
        const u = clamp((s - e.t) / Math.max(0.1, (e.t1 ?? e.t) - e.t));
        const caret = { x: e.box.x + Math.min(e.box.w - 16, 14 + u * n * cw), y: e.box.y + e.box.h / 2 };
        push(s, view.clampCam({ cx: lerp(cam.cx, caret.x, 0.6), cy: cam.cy, z: cam.z }), 'follow caret');
      }
    }
    const next = clusters[k + 1];
    const nextBreak = breaks.find((b) => b.t > c.end - 1e-6);
    const goWide = !next || next.start - lead - c.end > returnGap || breakBetween(c.end, next.start);
    if (goWide) {
      // return before a navigation/scroll happens (anticipated), else after a linger
      const tw = nextBreak && (!next || nextBreak.t < next.start) ? Math.min(c.end + linger, nextBreak.t - lead * 0.5) : c.end + linger;
      if (tw < duration) push(Math.max(c.end + 0.15, tw), view.wide, 'return wide');
    }
  });
  return finish();
}

/** Manual camera keys: [{at (film s), zoom, focus: {x,y} | box}] → keys (zoom 1 = wide). */
export function manualCamera(list, view) {
  return list.map((k) => {
    const z = clamp(k.zoom ?? 1, 1, view.zMax);
    const f = k.focus || { x: view.wide.cx, y: view.wide.cy };
    const cx = f.w != null ? f.x + f.w / 2 : f.x, cy = f.h != null ? f.y + f.h / 2 : f.y;
    return { t: Math.max(0, k.t), ...view.clampCam({ cx, cy, z }), why: 'manual' };
  }).sort((a, b) => a.t - b.t);
}

/**
 * Camera as a pure function of time: springs (closed form, superposed) on
 * centre and log-zoom, so zoom feels uniform and seek order never matters.
 */
export function cameraTrack(keys, view, feel = CAMERA_FEEL, { breathe = 0, drift, minHold = 2.2, driftHold = 2.5, duration = Infinity, fps = 30 } = {}) {
  const w = view.wide;
  const X = new Track(w.cx), Y = new Track(w.cy), Z = new Track(Math.log(w.z));
  // Long holds never freeze. `breathe` (legacy, ui-stage): a slow centre-fixed push <= breathe. `drift`
  // (ui-demo): in any shot longer than `driftHold` s the camera eases in by up to `drift` of its
  // zoom (never past view.zMax), about the shot's focus point when the key has one (so the ring
  // stays put on screen): a pure function of time like the springs, seek-order independent.
  // With no zoom headroom left it pans slowly (<= drift/2 of the view width) toward the content centre instead.
  const holds = [];
  const dr = drift ?? breathe;
  if (dr > 0) {
    const ts = [0, ...keys.map((k) => k.t), Math.min(duration, 1e9)];
    for (let i = 0; i + 1 < ts.length; i++) {
      const a = i ? ts[i] + 1.1 : 0.15, b = ts[i + 1];
      const long = drift != null ? b - ts[i] >= driftHold && b - a > 0.3 : b - a >= minHold - 1.1;
      if (long && Number.isFinite(b)) holds.push({ a, b, amt: Math.log(1 + dr * Math.min(1, (b - a) / (drift != null ? 4 : 5))), focus: i ? keys[i - 1].focus : null });
    }
  }
  const steps = [...keys.map((k) => ({ t: k.t, k })), ...holds.map((h) => ({ t: h.a, h }))].sort((p, q) => p.t - q.t || (p.k ? 1 : -1));
  const ease = (u) => -(Math.cos(Math.PI * u) - 1) / 2;
  for (const st of steps) {
    if (st.k && st.k.cut) {
      // a cut lands just after a frame boundary, so no frame mixes the two framings
      const k = st.k, tc = Math.ceil(k.t * fps - 1e-9) / fps + 1e-4;
      X.cut(tc, k.cx); Y.cut(tc, k.cy); Z.cut(tc, Math.log(k.z));
    } else if (st.k) { const k = st.k, f = k.feel || feel; X.spring(k.t, k.cx, f); Y.spring(k.t, k.cy, f); Z.spring(k.t, Math.log(k.z), f); }
    else if (drift == null) Z.ease(st.h.a, st.h.b - st.h.a, Z.last + st.h.amt, ease);
    else {
      const h = st.h, room = Math.log(Math.max(1, view.zMax)) - Z.last;
      let amt = Math.min(h.amt, Math.max(0, room));
      const dur = h.b - h.a, f0 = h.focus;
      // a push-in (or pan) must not slice a recorded element at a side edge: keep the largest share of it that stays clean
      let blocked = false;
      if (view.context?.length) {
        const sliced = (c) => sidesSliced(view.clampCam(c), view.context, view.viewW, view.viewH).length > 0;
        const clean = (a) => [1, 2, 3, 4].every((q) => { const k = Math.exp(a * q / 4); return !sliced({ cx: f0 ? f0.x + (X.last - f0.x) / k : X.last, cy: f0 ? f0.y + (Y.last - f0.y) / k : Y.last, z: Math.exp(Z.last + a * q / 4) }); });
        if (sliced({ cx: X.last, cy: Y.last, z: Math.exp(Z.last) })) blocked = true;
        else if (amt > 0) { while (amt > 0.002 && !clean(amt)) amt *= 0.75; if (amt <= 0.002) blocked = true; }
      }
      if (blocked) continue;
      if (amt >= h.amt * 0.25) {
        const r = Math.exp(amt), f = h.focus;
        Z.ease(h.a, dur, Z.last + amt, ease);
        if (f) { X.ease(h.a, dur, f.x + (X.last - f.x) / r, ease); Y.ease(h.a, dur, f.y + (Y.last - f.y) / r, ease); }
      } else {
        // zoom is at its ceiling: a slow pan toward the content centre keeps the frame alive
        const dir = Math.sign(view.content.x + view.content.w / 2 - X.last) || 1;
        X.ease(h.a, dur, X.last + dir * 0.5 * h.amt * view.viewW / Math.exp(Z.last), ease);
      }
    }
  }
  const at = (t) => {
    const c = { cx: X.at(t), cy: Y.at(t), z: Math.exp(Z.at(t)) };
    return view.clampCam(c);
  };
  /** Screen-space speed (CSS px of the viewport at zoom, per second) — drives motion-blur samples. */
  const cutAt = keys.filter((k) => k.cut).map((k) => Math.ceil(k.t * fps - 1e-9) / fps + 1e-4);
  const speed = (t, dt = 1 / 60) => {
    if (cutAt.some((c) => c > t - dt && c <= t)) return 0; // a cut is not motion (no blur across it)
    const a = at(t - dt), b = at(t);
    const zs = (a.z + b.z) / 2;
    return (Math.hypot(b.cx - a.cx, b.cy - a.cy) * zs + Math.abs(Math.log(b.z / a.z)) * view.viewW * 0.5) / dt;
  };
  return { at, speed, keys };
}

// ───────────────────────── cursor ─────────────────────────

/** Minimum-jerk position profile (Flash & Hogan): 10τ³ − 15τ⁴ + 6τ⁵. */
export const minJerk = (u) => { u = clamp(u); return u * u * u * (10 + u * (-15 + 6 * u)); };

/**
 * Cursor plan. Waypoints come from click/hover points; the cursor arrives
 * `arrive` s before each click, travels on a gently curved minimum-jerk path
 * whose duration follows Fitts' law, hides while typing (macOS does) and
 * reappears when it next moves. Returns {at(t), clicks, moves}.
 *   at(t) → {x, y, alpha, press (0..1)}
 */
export function planCursor(events, { start, arrive = 0.12, dwell = 0.16, seed = 1, bounds } = {}) {
  const pts = events.filter((e) => (e.type === 'click' || e.type === 'hover') && (e.point || e.box))
    .map((e) => ({ t: e.t, kind: e.type, x: e.point ? e.point.x : e.box.x + e.box.w / 2, y: e.point ? e.point.y : e.box.y + e.box.h / 2, step: e.step, by: e.arriveBy }));
  const typing = events.filter((e) => e.type === 'type').map((e) => ({ t0: e.t, t1: (e.t1 ?? e.t) + 0.25 }));
  const first = pts[0];
  let p0 = start || (first ? { x: first.x + 220, y: first.y + 160 } : { x: 0, y: 0 });
  if (bounds) p0 = { x: clamp(p0.x, bounds.x + 20, bounds.x + bounds.w - 20), y: clamp(p0.y, bounds.y + 20, bounds.y + bounds.h - 20) };
  const moves = [];
  let cur = { ...p0, t: -Infinity };
  pts.forEach((p, i) => {
    const d = Math.hypot(p.x - cur.x, p.y - cur.y);
    // arriveBy: a label names this control first — the cursor is there when it lands
    const arr = Math.min(p.t - (p.kind === 'click' ? arrive : 0), p.by ?? Infinity);
    if (d < 0.5) { cur = { x: p.x, y: p.y, t: p.t }; return; }
    const travel = clamp(0.3 + 0.1 * Math.log2(1 + d / 24), 0.32, 0.95); // Fitts-like
    let dep = Math.max(cur.t + dwell, arr - travel);
    let t1 = Math.max(dep + 0.12, arr);
    // a click lands where the tip is: never arrive after the click itself
    // (and never leave before the previous point was reached: moves must not overlap)
    if (p.kind === 'click' && t1 > p.t) { t1 = p.t; dep = Math.max(Math.min(cur.t, t1 - 1e-3), Math.min(dep, t1 - 0.12)); }
    const prev = moves[moves.length - 1];
    if (prev && prev.t1 > dep) { prev.t1 = Math.max(prev.t0 + 1e-3, dep); dep = Math.max(dep, prev.t1); } // the previous move finishes (faster) before this one leaves
    if (t1 - dep < 1e-3) dep = t1 - 1e-3;
    // perpendicular bow: 6–12 % of the distance, side chosen deterministically
    const side = hash(seed, 'bow', i) & 1 ? 1 : -1;
    const bow = (0.06 + 0.06 * ((hash(seed, 'bowk', i) % 1000) / 1000)) * d * side;
    const nx = -(p.y - cur.y) / d, ny = (p.x - cur.x) / d;
    moves.push({ t0: dep, t1, a: { x: cur.x, y: cur.y }, b: { x: p.x, y: p.y }, c: { x: (cur.x + p.x) / 2 + nx * bow, y: (cur.y + p.y) / 2 + ny * bow } });
    cur = { x: p.x, y: p.y, t: p.t };
  });
  const clicks = pts.filter((p) => p.kind === 'click').map((p) => p.t);
  function at(t) {
    let x = p0.x, y = p0.y;
    for (const m of moves) {
      if (t < m.t0) break;
      const u = minJerk((t - m.t0) / (m.t1 - m.t0));
      const v = 1 - u;
      x = v * v * m.a.x + 2 * v * u * m.c.x + u * u * m.b.x;
      y = v * v * m.a.y + 2 * v * u * m.c.y + u * u * m.b.y;
      if (t < m.t1) break;
    }
    // hidden while typing; fades back when it next moves (or after the typing)
    let alpha = 1;
    for (const ty of typing) {
      if (t < ty.t0) continue;
      const nextMove = moves.find((m) => m.t0 >= ty.t0 - 1e-6);
      const back = Math.min(ty.t1, nextMove ? nextMove.t0 : Infinity);
      if (t < back + 0.2) alpha = Math.min(alpha, t < ty.t0 + 0.12 ? 1 - (t - ty.t0) / 0.12 : t < back ? 0 : (t - back) / 0.2);
    }
    // press: quick in (40 ms before the click), spring release
    let press = 0;
    for (const c of clicks) {
      if (t >= c - 0.05 && t < c) press = Math.max(press, (t - (c - 0.05)) / 0.05);
      else if (t >= c && t < c + 0.4) press = Math.max(press, 1 - springStep(t - c, 4.5, 1));
    }
    return { x, y, alpha: clamp(alpha), press: clamp(press) };
  }
  return { at, moves, clicks, start: p0 };
}

// ───────────────────────── callouts ─────────────────────────

/**
 * Place a callout pill (w × h, screen px) next to a target box (screen px)
 * inside `safe` without covering the target or any `avoid` box. Tries the side
 * with the most room first. Returns {x, y, side, anchor:{x,y}, from:{x,y}}.
 * Clutter rule (the capture's pixels are not known at planning time, its element
 * boxes are): among the sides that are clear of the target and `avoid`, one whose pill
 * touches the fewest `soft` boxes (other known controls / labels, screen px) wins, then
 * one lying on the ground rather than over the app window `ui` (screen px); order breaks ties.
 */
export function placeCallout(target, w, h, safe, { gap = 28, avoid = [], prefer, only, rank: rankIn, soft = [], ui = null } = {}) {
  const room = {
    right: safe.x + safe.w - (target.x + target.w),
    left: target.x - safe.x,
    below: safe.y + safe.h - (target.y + target.h),
    above: target.y - safe.y,
  };
  // a side is comfortable when the pill fits with room to spare; comfortable sides go
  // right > below > left > above (reading order, short leaders), then the roomiest
  const need = (k) => (k === 'right' || k === 'left' ? w : h) + gap * 1.5;
  const rank = rankIn || { right: 0, below: 1, left: 2, above: 3 };
  const order = only ? [only] : Object.keys(room).sort((a, b) => (b === prefer) - (a === prefer)
    || (room[b] >= need(b)) - (room[a] >= need(a))
    || (room[a] >= need(a) ? rank[a] - rank[b] : room[b] / need(b) - room[a] / need(a)));
  const cy = target.y + target.h / 2, cx = target.x + target.w / 2;
  const fit = (x, y) => ({ x: clamp(x, safe.x, safe.x + safe.w - w), y: clamp(y, safe.y, safe.y + safe.h - h) });
  const cands = order.map((side) => {
    // step outward past obstacles (a longer leader beats covering a control)
    for (let k = 0; k < 6; k++) {
      const d = gap + k * gap * 0.9;
      let p;
      if (side === 'right') p = fit(target.x + target.w + d, cy - h / 2);
      else if (side === 'left') p = fit(target.x - d - w, cy - h / 2);
      else if (side === 'below') p = fit(cx - w / 2, target.y + target.h + d);
      else p = fit(cx - w / 2, target.y - d - h);
      const box = { x: p.x, y: p.y, w, h };
      const bad = overlaps(box, target, gap * 0.5) || avoid.some((a) => overlaps(box, a, 8));
      if (!bad || k === 5) {
        const softHits = soft.filter((a) => overlaps(box, a, 4)).length;
        const uiFrac = ui ? overlapArea(box, ui) / (w * h) : 0;
        return { side, ...p, bad, dist: d, softHits, uiFrac };
      }
    }
  });
  const clear = cands.filter((c) => !c.bad);
  const best = (soft.length || ui) ? [...clear].sort((a, b) => a.softHits - b.softHits || (a.uiFrac > 0.05) - (b.uiFrac > 0.05) || cands.indexOf(a) - cands.indexOf(b))[0] || cands[0] : clear[0] || cands[0];
  const anchor = best.side === 'right' ? { x: target.x + target.w, y: clamp(best.y + h / 2, target.y, target.y + target.h) }
    : best.side === 'left' ? { x: target.x, y: clamp(best.y + h / 2, target.y, target.y + target.h) }
    : best.side === 'below' ? { x: clamp(best.x + w / 2, target.x, target.x + target.w), y: target.y + target.h }
    : { x: clamp(best.x + w / 2, target.x, target.x + target.w), y: target.y };
  const from = best.side === 'right' ? { x: best.x, y: best.y + h / 2 } : best.side === 'left' ? { x: best.x + w, y: best.y + h / 2 }
    : best.side === 'below' ? { x: best.x + w / 2, y: best.y } : { x: best.x + w / 2, y: best.y + h };
  return { x: best.x, y: best.y, side: best.side, anchor, from, covered: best.bad, dist: best.dist, softHits: best.softHits, uiFrac: best.uiFrac };
}

/** Same words (case, spacing and punctuation aside)? A callout equal to its target's own text adds nothing. */
export const sameText = (a, b) => { const n = (v) => String(v ?? '').toLowerCase().replace(/[\s.,:;!·]+/g, ' ').trim(); return !!n(a) && n(a) === n(b); };

/**
 * placeCallout that keeps the wanted side only while its plate covers no recorded element (`soft`);
 * otherwise the sides are tried right, left, below, above and the first clear one wins (else the least cluttered).
 * Used per frame, so a camera move never leaves a plate over a neighbouring label or button.
 */
export function placeBeside(target, w, h, safe, { side, soft = [], ...opts } = {}) {
  const hits = (p) => soft.filter((a) => overlaps({ x: p.x, y: p.y, w, h }, a, 0)).length;
  const tries = [side, 'right', 'left', 'below', 'above'].filter((k, i, a) => k && a.indexOf(k) === i).map((k) => placeCallout(target, w, h, safe, { ...opts, soft, only: k }));
  return tries.find((p) => !p.covered && !hits(p)) || [...tries].sort((a, b) => (a.covered - b.covered) || hits(a) - hits(b))[0];
}

/**
 * Reading time a callout needs on screen (s): ~1.2 s plus 35 ms per character.
 */
export const readTime = (text) => clamp(1.2 + 0.035 * [...text].length, 1.4, 2.6);

/**
 * When each callout lands and the freeze-frames that give it reading time.
 *   items: [{ct (capture s of the anchored event), text, when: 'before' | 'after'}]
 * 'before' (default for clicks): the label lands just BEFORE the action, in
 * the quiet moment after the previous one; the capture freezes there while it
 * is read, the click happens, the label leaves — so a control is named before
 * its result (a sheet, a new page) covers it.
 * 'after': the label lands as the action's result shows; if the next action
 * would come before it is read, a freeze is placed just before that action.
 * Returns [{at (capture s where the label lands), hold}] in item order; holds
 * of 0 mean "no freeze needed".
 */
export function calloutPlan(cap, rt, items, { lead = 0.42, appear = 0.18, autoHold = true } = {}) {
  const evs = cap.events || [];
  // action times (a typed field's click stands for its typing)
  const acts = evs.filter((e) => e.type !== 'type' || !evs.some((c) => c.type === 'click' && c.step === e.step)).map((e) => e.t).sort((a, b) => a - b);
  const busyUntil = (ct) => Math.max(rt.c0, ...evs.filter((e) => e.t < ct - 1e-6).map((e) => e.t1 ?? e.t));
  return items.map((it) => {
    const need = readTime(it.text);
    if (it.when === 'before') {
      const at = Math.max(Math.min(it.ct - 0.12, busyUntil(it.ct) + 0.25), it.ct - 0.35);
      // it leaves 0.35 s after the click — or just before a page change the click causes
      const brk = evs.find((e) => (e.type === 'navigate' || e.type === 'scroll') && e.t >= it.ct - 1e-6);
      const stop = brk && brk.t - 0.12 < it.ct + 0.35 ? rt.toFilm(brk.t) - 0.12 : rt.toFilm(it.ct) + 0.35;
      const shown = stop - rt.toFilmFirst(at);
      return { at, hold: autoHold ? Math.max(0, Math.round((need - shown + 0.05) * 100) / 100) : 0 };
    }
    const at = it.ct;
    if (!autoHold) return { at, hold: 0, after: true };
    const next = acts.find((t) => t > it.ct + 0.05);
    if (next == null || next > rt.c1) {
      // the last callout: the film must not end under it (0.4 s to leave)
      const tail = rt.duration - 0.4 - (rt.toFilm(it.ct) + appear);
      return tail < need ? { at, holdAt: Math.min(rt.c1, it.ct + 0.45), hold: Math.round((need - tail + 0.1) * 100) / 100, after: true } : { at, hold: 0, after: true };
    }
    const avail = rt.toFilm(next) - lead - (rt.toFilm(it.ct) + appear);
    if (avail >= need) return { at, hold: 0, after: true };
    let holdAt = Math.max(it.ct + 0.4, next - 0.45);
    if (holdAt >= next) holdAt = (it.ct + next) / 2;
    return { at, holdAt, hold: Math.round((need - avail + 0.1) * 100) / 100, after: true };
  });
}

/** The freezes of a callout plan, as retime entries. */
export const planHolds = (plan) => plan.filter((p) => p.hold > 0).map((p) => ({ at: p.holdAt ?? p.at, hold: p.hold }));

/**
 * When a callout must leave: its duration, or earlier when the camera moves
 * off its target, or — for an untracked (fixed) box — just before the page
 * navigates/scrolls under it. A tracked target follows scrolls and its track
 * says when it is gone, so page changes do not end it here.
 */
export function calloutEnd(t0, dur, box, keys, view, events, { tracked = false } = {}) {
  let t1 = t0 + dur;
  for (const k of keys) if (k.t > t0 + 0.25 && k.t < t1 && !view.shows(k, box)) { t1 = k.t + 0.08; break; }
  if (!tracked) for (const e of events) if ((e.type === 'navigate' || e.type === 'scroll') && e.t > t0 && e.t - 0.12 < t1) { t1 = e.t - 0.12; break; }
  return t1;
}

/**
 * A label straddling the window's own edge reads as a mistake: move a placed
 * pill (x, y, w, h) fully off any edge of `rect` it crosses — outward when the
 * safe area has room, else back inside. Pure; returns {x, y}.
 */
export function clearEdges(p, w, h, rect, safe, m = 16) {
  let { x, y } = p;
  const inS = (v, lo, hi) => v >= lo - 1e-6 && v <= hi + 1e-6;
  for (const [edge, out, inn] of [[rect.y + rect.h, rect.y + rect.h + m, rect.y + rect.h - h - m], [rect.y, rect.y - h - m, rect.y + m]]) {
    if (y < edge && y + h > edge) y = inS(out, safe.y, safe.y + safe.h - h) ? out : inn;
  }
  for (const [edge, out, inn] of [[rect.x + rect.w, rect.x + rect.w + m, rect.x + rect.w - w - m], [rect.x, rect.x - w - m, rect.x + m]]) {
    if (x < edge && x + w > edge) x = inS(out, safe.x, safe.x + safe.w - w) ? out : inn;
  }
  return { x, y };
}

// ───────────────────────── frames (shared by ui-demo and brand-card) ─────────────────────────

/** One visual system for a product UI in a frame: chrome, bezel, corners, shadow. CSS px of the capture. */
export const FRAME = { chromeH: 40, bezel: 13, phoneR: 52, radius: 12 };
/** Soft, physically plausible shadow: wide ambient, mid, tight contact — [blur, dy, alpha] in px at unit 1. */
export const SHADOW_LAYERS = [[64, 30, 0.16], [18, 8, 0.12], [3, 1.5, 0.1]];

/** The frame's outer rect around a vw×vh viewport (viewport at 0,0). */
export function frameRect(kind, vw, vh) {
  if (kind === 'browser') return { x: 0, y: -FRAME.chromeH, w: vw, h: vh + FRAME.chromeH };
  if (kind === 'phone') return { x: -FRAME.bezel, y: -FRAME.bezel, w: vw + 2 * FRAME.bezel, h: vh + 2 * FRAME.bezel };
  return { x: 0, y: 0, w: vw, h: vh };
}

/**
 * Draw a captured UI in its frame, in CSS px of the capture under the caller's
 * transform. src = {bmp, sx, sy, sw, sh} (device px of the source, sw/sh = the
 * visible region) shown in the vw×vh viewport. chrome(g) draws the browser
 * title bar contents (dots, URL) when kind is 'browser'. Returns nothing.
 */
export function drawFrame(g, { kind, vw, vh, src, colors, chrome, radius = FRAME.radius, scale = 1 }) {
  const win = frameRect(kind, vw, vh);
  const R = kind === 'phone' ? FRAME.phoneR : radius;
  const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
  if (kind === 'phone') {
    rr(win.x, win.y, win.w, win.h, R);
    g.fillStyle = colors.body; g.fill();
    g.strokeStyle = colors.rim; g.lineWidth = 1.2; g.stroke();
    g.fillStyle = colors.body;
    rr(win.x + win.w - 1, 168, 3.5, 74, 2); g.fill();
    rr(win.x - 2.5, 140, 3.5, 40, 2); g.fill();
    rr(win.x - 2.5, 196, 3.5, 64, 2); g.fill();
  }
  g.save();
  if (kind === 'phone') rr(0, 0, vw, vh, R - FRAME.bezel + 2); else rr(win.x, win.y, win.w, win.h, R);
  g.clip();
  if (kind === 'browser') {
    g.fillStyle = colors.chrome;
    g.fillRect(0, -FRAME.chromeH, vw, FRAME.chromeH + 1);
    chrome?.(g);
    g.fillStyle = colors.chromeLine;
    g.fillRect(0, -1, vw, 1);
  }
  if (src?.bmp) {
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(src.bmp, src.sx ?? 0, src.sy ?? 0, src.sw ?? src.bmp.width, src.sh ?? src.bmp.height, 0, 0, vw, vh);
  } else { g.fillStyle = colors.empty; g.fillRect(0, 0, vw, vh); }
  g.restore();
  if (kind !== 'phone') {
    rr(win.x + 0.25, win.y + 0.25, win.w - 0.5, win.h - 0.5, R);
    g.strokeStyle = 'rgba(0,0,0,0.10)';
    g.lineWidth = 1 / scale;
    g.stroke();
  }
}

/** The frame's soft shadow, drawn directly (screen px): rect = the frame's outer rect on screen. */
export function drawFrameShadow(g, rect, radius, unit = 1, strength = 1) {
  // The shape sits in a clip hole of its own size (even-odd), so only its shadow lands outside it. The old trick (shape
  // drawn 10000 px off-canvas with a 10000 px shadow offset) lost the shadow's blur tail on the left of the frame: a
  // hard-edged dark slab beside product tiles (film polish lane 3).
  const B = 20000;
  for (const [blur, dy, a] of SHADOW_LAYERS) {
    g.save();
    g.beginPath();
    g.rect(rect.x - B, rect.y - B, 2 * B + rect.w, 2 * B + rect.h);
    g.roundRect(rect.x, rect.y, rect.w, rect.h, radius);
    g.clip('evenodd');
    g.shadowColor = `rgba(0,0,0,${Math.min(0.9, a * strength)})`;
    g.shadowBlur = blur * unit;
    g.shadowOffsetX = 0;
    g.shadowOffsetY = dy * unit;
    g.fillStyle = '#000';
    g.beginPath(); g.roundRect(rect.x, rect.y, rect.w, rect.h, radius); g.fill();
    g.restore();
  }
}

// ───────────────────────── pointer feedback (shared by ui-demo and ui-stage) ─────────────────────────
// All three draw in CSS px of the capture under the caller's capture→output transform.

/**
 * A crisp vector pointer (outline, not a bitmap): ink body, paper rim, soft shadow.
 * sc = size (CSS px), press 0..1, s = output px per CSS px at zoom 1 (shadow size).
 */
export function drawCursorArrow(g, x, y, sc, press, { ink, paper, s = 1 }) {
  const k = sc * (1 - 0.13 * press) / 21;
  g.save();
  g.translate(x, y);
  g.scale(k, k);
  g.beginPath();
  g.moveTo(0, 0); g.lineTo(0, 17.2); g.lineTo(4.3, 13.3); g.lineTo(7.3, 20.1); g.lineTo(10.1, 18.9);
  g.lineTo(7.2, 12.2); g.lineTo(12.6, 12.2); g.closePath();
  g.shadowColor = 'rgba(0,0,0,0.28)'; g.shadowBlur = 5 * k * s; g.shadowOffsetY = 1.4 * k * s;
  g.lineJoin = 'round';
  g.lineWidth = 2.6;
  g.strokeStyle = paper;
  g.stroke();
  g.shadowColor = 'rgba(0,0,0,0)';
  g.fillStyle = ink;
  g.fill();
  g.restore();
}

/** Click ripples (accent) for cursor.clicks at film time t; k = 1/√zoom keeps them from turning cartoonish. */
export function drawRipples(g, t, k, cursor, evs, { accent, touch = false }) {
  for (const tc of cursor.clicks) {
    const u = (t - tc) / 0.55;
    if (u < 0 || u >= 1) continue;
    const e = evs.find((q) => q.type === 'click' && Math.abs(q.t - tc) < 1e-9);
    const p = e.point || { x: e.box.x + e.box.w / 2, y: e.box.y + e.box.h / 2 };
    const r = (touch ? 22 : 8) * k + 30 * k * expoOut(u);
    g.save();
    g.globalAlpha = 0.9 * Math.pow(1 - u, 1.6);
    g.strokeStyle = accent;
    g.lineWidth = 2.4 * k;
    g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 0.16 * (1 - u);
    g.fillStyle = accent;
    g.fill();
    g.restore();
  }
}

/** Phone: no arrow — a touch indicator that appears just before each tap. */
export function drawTouch(g, t, k, cursor, evs, { ink, paper }) {
  for (const tc of cursor.clicks) {
    const u = (t - (tc - 0.2)) / 0.62;
    if (u < 0 || u >= 1) continue;
    const e = evs.find((q) => q.type === 'click' && Math.abs(q.t - tc) < 1e-9);
    const p = e.point || { x: e.box.x + e.box.w / 2, y: e.box.y + e.box.h / 2 };
    const a = u < 0.25 ? u / 0.25 : u > 0.6 ? 1 - (u - 0.6) / 0.4 : 1;
    const press = t >= tc - 0.05 && t < tc + 0.25 ? 0.85 : 1;
    g.save();
    g.globalAlpha = 0.28 * a;
    g.fillStyle = ink;
    g.beginPath(); g.arc(p.x, p.y, 21 * k * press, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 0.75 * a;
    g.strokeStyle = paper;
    g.lineWidth = 2 * k;
    g.stroke();
    g.restore();
  }
}

// ───────────────────────── QA: static holds ─────────────────────────

/**
 * Runs longer than `maxHold` s in which nothing changes. changed(i, a) says whether frame i
 * differs from frame a (the first frame of the current run); a run ends at the first frame
 * that does. Pure; returns [{t0, t1}] (s).
 */
export function staticRuns(n, fps, changed, { maxHold = 5 } = {}) {
  const runs = [];
  let a = 0;
  for (let i = 1; i < n; i++) {
    if (!changed(i, a)) continue;
    if ((i - a) / fps > maxHold) runs.push({ t0: a / fps, t1: i / fps });
    a = i;
  }
  if ((n - a) / fps > maxHold) runs.push({ t0: a / fps, t1: n / fps });
  return runs;
}
