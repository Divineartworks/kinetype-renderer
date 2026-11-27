// Real-video edit kit: pure planners that turn NATIVE phone recordings
// (kinetype.capture.v1 + the C2 v2 fields: clock "wall", vbox/vpoint, idle,
// busy, sessionOffset) into a paced, camera-moved, multi-device edit.
// Everything is a pure function of its inputs, shared by the ui-demo template
// (in the browser) and the Node side (pace report, SFX placement, mix), so the
// picture and the sound are planned from the very same film clock.
// Coordinates are VIDEO px of the recording (C2 v2 vbox) unless a name says
// "screen"; times are seconds on the capture clock unless a name says film.
import { clamp } from './math.js';
import { captureTime, HOLD_EPS, makeView, union } from './x-ui.js';

// ───────────────────────── capture normalisation ─────────────────────────

/** A capture is "real" (C2 v2) when it runs on the wall clock or carries video-px geometry. */
export const isReal = (cap) => cap?.clock === 'wall' || !!cap?.mapping || (cap?.events || []).some((e) => e.vbox || e.vpoint);

const mapPt = (p, m) => p && { x: p.x * m.s + m.ox, y: p.y * m.s + m.oy };
const mapBox = (b, m) => b && { x: b.x * m.s + m.ox, y: b.y * m.s + m.oy, w: b.w * m.s, h: b.h * m.s };

/**
 * C2 v2 → the v1 shape the ui-demo planners speak, in VIDEO px: viewport =
 * the video frame, deviceScaleFactor 1, every box/point/track = its video-px
 * image (vbox/vpoint when the producer wrote them, else box·s + offset through
 * the event's mapping). `tap` events become `click`. The CSS geometry is kept
 * under `css` for reports. `cssScale` = video px per CSS px (text legibility).
 */
export function normalizeReal(cap) {
  const vid = cap.device?.video || cap.video || {};
  const W = vid.width || cap.frames?.width, H = vid.height || cap.frames?.height;
  if (!W || !H) throw new Error(`capture ${cap.flow}: a real capture needs device.video (or video) {width, height}`);
  const m0 = cap.mapping || { s: cap.device?.deviceScaleFactor || 1, ox: 0, oy: 0 };
  const events = (cap.events || []).map((e) => {
    const m = e.mapping || m0;
    const ev = { ...e, type: e.type === 'tap' ? 'click' : e.type, css: { box: e.box, point: e.point }, cssScale: m.s };
    if (e.box || e.vbox) ev.box = e.vbox || mapBox(e.box, m);
    if (e.point || e.vpoint) ev.point = e.vpoint || mapPt(e.point, m);
    // the finger path (swipe/fling: vpath in video px; else vfrom/vto; else the CSS from/to mapped)
    const vp = Array.isArray(e.vpath) && e.vpath.length > 1 ? e.vpath : null;
    if (vp || e.vfrom || e.from?.x != null) ev.pfrom = vp ? { x: vp[0].x, y: vp[0].y } : e.vfrom || mapPt(e.from, m);
    if (vp || e.vto || e.to?.x != null) ev.pto = vp ? { x: vp[vp.length - 1].x, y: vp[vp.length - 1].y } : e.vto || mapPt(e.to, m);
    if (Array.isArray(e.track)) ev.track = e.track.map((tr) => ({ ...tr, box: tr.vbox || mapBox(tr.box, m) }));
    return ev;
  });
  return {
    ...cap,
    real: true,
    device: { ...cap.device, viewport: { width: W, height: H }, deviceScaleFactor: 1, cssScale: m0.s, chrome: cap.device?.chrome },
    events,
    idle: normRanges(cap.idle),
    busy: normRanges(cap.busy),
    sessionOffset: cap.sessionOffset || 0,
  };
}

/** Sorted, merged, positive-length [t0, t1] ranges. */
export function normRanges(rs) {
  const a = (rs || []).map((r) => (Array.isArray(r) ? [r[0], r[1]] : [r.t0, r.t1])).filter(([x, y]) => y > x).sort((p, q) => p[0] - q[0]);
  const out = [];
  for (const r of a) { const l = out[out.length - 1]; if (l && r[0] <= l[1] + 1e-9) l[1] = Math.max(l[1], r[1]); else out.push([...r]); }
  return out;
}
/** a minus b (both normalised range lists). */
export function subRanges(a, b) {
  const out = [];
  for (const [x0, x1] of a) {
    let cur = [[x0, x1]];
    for (const [y0, y1] of b) cur = cur.flatMap(([p, q]) => (y1 <= p || y0 >= q ? [[p, q]] : [[p, Math.min(q, y0)], [Math.max(p, y1), q]].filter(([u, v]) => v - u > 1e-6)));
    out.push(...cur);
  }
  return out;
}
/** a ∩ b. */
export function andRanges(a, b) {
  const out = [];
  for (const [x0, x1] of a) for (const [y0, y1] of b) { const p = Math.max(x0, y0), q = Math.min(x1, y1); if (q - p > 1e-6) out.push([p, q]); }
  return normRanges(out);
}
const inRanges = (rs, t) => rs.some(([a, b]) => t > a + 1e-9 && t < b - 1e-9);

// ───────────────────────── time map with cuts ─────────────────────────

/**
 * Film clock ↔ capture clock from an ordered list of pieces
 * {c0, c1, speed} (speed 0 = a freeze of `dur` film seconds at c0, shown
 * HOLD_EPS before c0 like x-ui's holds). Consecutive pieces whose capture
 * ranges do not touch are a CUT (the capture jumps). Pieces flagged `open`
 * (a cold open: the payoff shown first) are out of the capture order and never
 * answer toFilm. Returns the x-ui retime interface (duration, c0, c1,
 * toCapture, toFilm, toFilmFirst) plus cuts, skipped(c) and mixAt(t, fps)
 * (the 2-frame match dissolve over each cut).
 */
export function timeMap(pieces0) {
  const pieces = [];
  let f = 0;
  for (const p of pieces0) {
    const d = p.speed ? (p.c1 - p.c0) / p.speed : p.dur;
    if (!(d > 1e-9)) continue;
    pieces.push({ ...p, f0: f, f1: f + d });
    f += d;
  }
  if (!pieces.length) throw new Error('timeMap: empty edit');
  const duration = f;
  pieces.forEach((p, i) => { p.cmax = p.speed && pieces[i + 1] && !pieces[i + 1].speed && Math.abs(pieces[i + 1].c0 - p.c1) < 1e-9 ? p.c1 - HOLD_EPS : p.c1; });
  const main = pieces.filter((p) => !p.open);
  const c0 = main[0].c0, c1 = main[main.length - 1].c1;
  const cuts = [];
  for (let i = 1; i < pieces.length; i++) {
    const a = pieces[i - 1], b = pieces[i];
    if (Math.abs(b.c0 - a.c1) > 1e-6) cuts.push({ t: b.f0, from: a.c1, to: b.c0, open: !!a.open });
  }
  const capOf = (p, t) => (p.speed ? Math.min(p.cmax, p.c0 + (t - p.f0) * p.speed) : p.c0 - HOLD_EPS);
  function pieceAt(t) {
    let lo = 0, hi = pieces.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (pieces[m].f0 <= t) lo = m; else hi = m - 1; }
    return lo;
  }
  function toCapture(t) {
    if (t <= 0) return pieces[0].speed ? pieces[0].c0 : pieces[0].c0 - HOLD_EPS;
    if (t >= duration) return pieces[pieces.length - 1].c1;
    return capOf(pieces[pieceAt(t)], t);
  }
  /** Is capture time c jumped over by a cut (never shown in the main edit)? */
  const skipped = (c) => c >= c0 && c <= c1 && !main.some((p) => c >= p.c0 - 1e-9 && c <= p.c1 + 1e-9);
  function toFilm(c) {
    // an event at the very first point plays after any freeze held on it (contract C3)
    if (c <= c0 + 1e-9) return (main.find((p) => p.speed) || main[0]).f0 - (c0 - c);
    if (c >= c1) return duration + (c - c1);
    for (const p of main) if (p.speed && c >= p.c0 - 1e-9 && c < p.c1 - 1e-9) return p.f0 + (c - p.c0) / p.speed;
    return toFilmFirst(c);
  }
  function toFilmFirst(c) {
    if (c <= c0) return main[0].f0 - (c0 - c);
    if (c >= c1) return duration + (c - c1);
    for (const p of main) if (c >= p.c0 - 1e-9 && c <= p.c1 + 1e-9) return p.speed ? p.f0 + (c - p.c0) / p.speed : p.f0;
    // inside a cut: the moment the edit lands after it
    const nx = main.find((p) => p.c0 > c);
    return nx ? nx.f0 : duration;
  }
  /**
   * Capture frames that make output frame t: one [{c, a: 1}] or, on the two
   * frames around a cut, a 2-frame match dissolve [{c: before, a}, {c: after, a}]
   * (alphas 0.75/0.25 then 0.25/0.75; t is quantised to the frame).
   */
  function mixAt(t, fps) {
    const c = toCapture(t);
    if (!fps) return [{ c, a: 1 }];
    for (const k of cuts) {
      if (k.dissolve === false) continue;
      const i = Math.round((t - k.t) * fps); // -1 → the frame before the cut, 0 → the first after
      if (Math.abs(t - k.t - i / fps) > 0.5 / fps || (i !== -1 && i !== 0)) continue;
      const wNew = i === -1 ? 0.25 : 0.75;
      const before = capOf(pieces[pieceAt(k.t - 1e-6)], k.t - 1e-6);
      const after = capOf(pieces[pieceAt(k.t + 1e-6)], Math.max(k.t, t));
      return [{ c: before, a: 1 - wNew }, { c: after, a: wNew }];
    }
    return [{ c, a: 1 }];
  }
  return { duration, pieces, c0, c1, cuts, toCapture, toFilm, toFilmFirst, skipped, mixAt };
}

// ───────────────────────── auto pace ─────────────────────────

/** LIVE_COMMON pace standards (seconds, film clock). */
export const PACE = {
  deadMax: 0.25, // an idle/busy stretch shows at most this long
  cutOver: 1.0, // longer dead stretches are cut (2-frame match dissolve) instead of sped up
  keepHead: 0.12, keepTail: 0.1, // what a cut keeps of a dead stretch (the spinner is seen, the tap is anticipated)
  typeBudget: 0.9, typeMax: 1.0, typeSpeedMax: 4,
  payoffHold: 0.9, payoffMin: 0.6, payoffMax: 1.2,
  shotRead: 0.8,
  pressHold: 0.15, // the pre-contact frame of a navigating tap is held this long (the press lands on the button) // a shot's first screen is shown at least this long before dead air is compressed
  spinnerMax: 0.3, firstPayoff: 3.0, feedbackMax: 2.5, staticMax: 1.6,
  cadenceMax: 3.0, cadenceAdMax: 25, // films ≤ 25 s are ads: a cut or camera change every ≤ 3 s
  beatSpeedMax: 2,
};

export const isPayoff = (m) => m.payoff === true || m.kind === 'payoff';

/**
 * Auto pace (content.retime "auto"): the pieces of a paced edit of one
 * capture between capture times c0 and c1.
 *   cap        normalised capture ({events, marks, idle, busy})
 *   overrides  explicit x-ui retime entries ({from,to,speed} | {at,hold}); they win
 *   beats      [{at, t}] narration beats: capture ref → film second
 *   open       {at, dur} cold open: show capture [at, at+dur] first, then cut to c0
 * Returns {pieces, map, notes}. Rules (LIVE_COMMON): dead (idle ∪ busy)
 * stretches → ≤ deadMax on screen, cut when > cutOver; typing ≤ typeBudget;
 * payoffs never sped up and held payoffHold (0.6–1.2 s) before the next change;
 * beats land on their marks by holding on static frames or speeding plain play.
 */
export function pacePlan(cap, { c0, c1, overrides = [], beats = [], open = null, auto = true, P = PACE } = {}) {
  const notes = [];
  const marks = (cap.marks || []).filter((m) => m.t >= c0 - 1e-9 && m.t <= c1 + 1e-9);
  const evs = (cap.events || []).filter((e) => e.t >= c0 - 1e-9 && e.t <= c1 + 1e-9);
  const speeds = [], holds = [];
  for (const r of overrides) {
    if (r.hold != null) { holds.push({ at: captureTime(cap, r.at), dur: r.hold, why: 'override' }); continue; }
    const a = Math.max(c0, captureTime(cap, r.from)), b = Math.min(c1, captureTime(cap, r.to, r.toEdge || 't0'));
    if (b > a) speeds.push([a, b, r.speed]);
  }
  // labelled intervals by priority: override > payoff > type > dead > play
  const payoffs = auto ? normRanges(marks.filter(isPayoff).map((m) => [m.t, Math.min(c1, m.t + P.payoffHold)])) : [];
  const reads = auto ? subRanges([[c0, Math.min(c1, c0 + P.shotRead)]], payoffs) : [];
  const typing = auto ? evs.filter((e) => e.type === 'type' && e.t1 > e.t).map((e) => [e.t, Math.min(c1, e.t1), e]) : [];
  const ov = normRanges(speeds.map(([a, b]) => [a, b]));
  let dead = [];
  if (auto) {
    const busy = (cap.busy || []).map(([a, b]) => [Math.max(a, c0), Math.min(b, c1)]).filter(([a, b]) => b > a);
    const idle = (cap.idle || []).map(([a, b]) => [Math.max(a, c0), Math.min(b, c1)]).filter(([a, b]) => b > a);
    const block = normRanges([...payoffs, ...reads, ...typing.map(([a, b]) => [a, b]), ...ov]);
    const tag = (rs, kind) => subRanges(normRanges(rs), block).map(([a, b]) => ({ a, b, kind }));
    // busy wins where it overlaps idle (a spinner can look static between its frames)
    const bz = tag(busy, 'busy');
    dead = [...bz, ...tag(subRanges(normRanges(idle), normRanges(busy)), 'idle')].sort((p, q) => p.a - q.a);
  }
  // breakpoints → pieces in capture order
  const xs = [...new Set([c0, c1, ...ov.flat(), ...payoffs.flat(), ...reads.flat(), ...typing.flatMap(([a, b]) => [a, b]), ...dead.flatMap((d) => [d.a, d.b])])].filter((x) => x >= c0 - 1e-9 && x <= c1 + 1e-9).sort((a, b) => a - b);
  const pieces = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i], b = xs[i + 1], mid = (a + b) / 2, d = b - a;
    if (d < 1e-9) continue;
    const so = speeds.find(([p, q]) => mid > p && mid < q);
    if (so) { pieces.push({ c0: a, c1: b, speed: so[2], kind: 'override' }); continue; }
    if (payoffs.some(([p, q]) => mid > p && mid < q)) { pieces.push({ c0: a, c1: b, speed: 1, kind: 'payoff' }); continue; }
    if (reads.some(([p, q]) => mid > p && mid < q)) { pieces.push({ c0: a, c1: b, speed: 1, kind: 'read' }); continue; }
    const ty = typing.find(([p, q]) => mid > p && mid < q);
    if (ty) {
      const sp = clamp((ty[1] - ty[0]) / P.typeBudget, 1, P.typeSpeedMax);
      pieces.push({ c0: a, c1: b, speed: sp, kind: 'type', step: ty[2].step });
      continue;
    }
    const dz = dead.find((z) => mid > z.a && mid < z.b);
    if (dz) {
      if (d <= P.deadMax) pieces.push({ c0: a, c1: b, speed: 1, kind: dz.kind });
      else if (d <= P.cutOver) pieces.push({ c0: a, c1: b, speed: d / P.deadMax, kind: dz.kind, compressed: d });
      else {
        // cut: keep the head (the spinner is seen / the screen settles) and the tail (the tap is anticipated)
        pieces.push({ c0: a, c1: a + P.keepHead, speed: 1, kind: dz.kind, cutHead: true });
        pieces.push({ c0: b - P.keepTail, c1: b, speed: 1, kind: dz.kind, cutTail: true, cutFrom: a + P.keepHead, removed: d - P.keepHead - P.keepTail });
      }
      continue;
    }
    pieces.push({ c0: a, c1: b, speed: 1, kind: 'play' });
  }
  const insertHold = (at0, dur, why) => {
    let at = at0;
    if (!(dur > 1e-3)) return;
    // a freeze at capture time `at`: split the piece that contains it
    const i = pieces.findIndex((p) => at > p.c0 + 1e-9 && at < p.c1 - 1e-9);
    if (i >= 0) {
      const p = pieces[i];
      pieces.splice(i, 1, { ...p, c1: at }, { c0: at, c1: at, speed: 0, dur, kind: 'hold', why }, { ...p, c0: at, cutTail: false, cutFrom: undefined });
      return;
    }
    let j = pieces.findIndex((p) => Math.abs(p.c0 - at) < 1e-9 && p.speed);
    if (j < 0) { const k = pieces.findIndex((p) => Math.abs(p.c1 - at) < 1e-9); if (k >= 0) j = k + 1; }
    if (j < 0) {
      // inside a cut-away stretch (or past the end): freeze where the edit lands next, never at film start
      j = pieces.findIndex((p) => p.c0 >= at - 1e-9);
      if (j < 0) { const l = pieces[pieces.length - 1]; pieces.push({ c0: l.c1, c1: l.c1, speed: 0, dur, kind: 'hold', why }); return; }
      at = pieces[j].c0;
    }
    pieces.splice(j, 0, { c0: at, c1: at, speed: 0, dur, kind: 'hold', why });
  };
  for (const h of holds) insertHold(clamp(h.at, c0, c1), h.dur, h.why);
  // a navigating tap: the recording's tap frame already shows the next screen (the button is gone), so the
  // press could never be seen landing on it — hold the last frame before contact (the button) for P.pressHold
  if (auto) for (const e of evs) if (e.type === 'click' && navigatingTap(e, cap.fps || 60) && e.t > c0 + 0.05) insertHold(e.t, P.pressHold, `press ${e.step || ''}`.trim());
  // payoff dwell: the settled payoff stays payoffHold before the next change (an event or a cut)
  if (auto) {
    for (const m of marks.filter(isPayoff)) {
      const map = timeMap(pieces);
      const tMark = map.toFilmFirst(m.t);
      const nextEv = evs.find((e) => e.t > m.t + 1e-6 && e.type !== 'navigate' && e.type !== 'observe');
      const nextCut = map.cuts.find((k) => !k.open && k.t > tMark + 1e-6);
      const tEv = nextEv ? map.toFilmFirst(nextEv.t) : Infinity, tCut = nextCut ? nextCut.t : Infinity;
      const dwell = Math.min(tEv, tCut) - tMark;
      // freeze the SETTLED payoff just before whatever changes it next (the event, or the cut leaving it)
      if (Number.isFinite(dwell) && dwell < P.payoffHold - 0.02) insertHold(tCut <= tEv ? nextCut.from : nextEv.t, P.payoffHold - dwell, `payoff ${m.id}`);
    }
  }
  // narration beats: a mark lands on its beat (beat times count from the shot start, cold open included)
  const openDur = open ? Math.min(cap.duration, captureTime(cap, open.at) + clamp(open.dur ?? 1.4, 0.4, 3)) - captureTime(cap, open.at) : 0;
  for (const bt0 of [...beats].sort((a, b) => a.t - b.t)) {
    const bt = { ...bt0, t: bt0.t - openDur };
    const ct = captureTime(cap, bt.at);
    if (ct < c0 - 1e-9 || ct > c1 + 1e-9) { notes.push(`beat ${bt.at}: outside the shot`); continue; }
    const map = timeMap(pieces);
    const have = map.toFilm(ct), delta = bt.t - have; // when the mark's action plays (after any freeze on it)
    const prevC = Math.max(c0, ...beats.filter((b) => b.t < bt0.t).map((b) => captureTime(cap, b.at)).filter((x) => x <= ct));
    if (delta > 0.02) {
      // prefer a freeze on a frame nobody can see freezing: the end of a dead stretch before the mark
      const z = [...pieces].reverse().find((p) => (p.kind === 'idle' || p.kind === 'busy') && p.speed && p.c1 <= ct + 1e-9 && p.c0 >= prevC - 1e-9);
      const at = z ? (z.cutHead ? z.c1 - 1e-4 : (z.c0 + z.c1) / 2) : ct;
      insertHold(at, delta, `beat ${bt.at}${z ? ' (static)' : ' (freeze)'}`);
      if (!z) notes.push(`beat ${bt.at}: no static stretch before it — ${delta.toFixed(2)} s freeze just before the mark`);
    } else if (delta < -0.02) {
      // speed up plain play between the previous beat and this mark
      const span = pieces.filter((p) => p.kind === 'play' && p.speed && p.c0 >= prevC - 1e-9 && p.c1 <= ct + 1e-9);
      const film = span.reduce((s, p) => s + (p.c1 - p.c0) / p.speed, 0);
      const k = film > 0 ? clamp(film / Math.max(1e-3, film + delta), 1, P.beatSpeedMax) : 1;
      for (const p of span) p.speed *= k;
      const got = film - film / k;
      if (got < -delta - 0.02) notes.push(`beat ${bt.at}: lands ${(-delta - got).toFixed(2)} s late (plain play sped ×${k.toFixed(2)}, the cap)`);
    }
  }
  if (open) {
    const oc = captureTime(cap, open.at);
    const od = clamp(open.dur ?? 1.4, 0.4, 3);
    pieces.unshift({ c0: oc, c1: Math.min(cap.duration, oc + od), speed: 1, kind: 'open', open: true });
  }
  return { pieces, map: timeMap(pieces), notes };
}

/** Events of a capture on the film clock of map (cut-over and open-only events dropped); keys + t1 mapped too. */
export function filmEventsOf(cap, map, { device } = {}) {
  const out = [];
  for (const e of cap.events || []) {
    // a shot is half-open [c0, c1): an event on the boundary belongs to the next shot (no double taps / sounds)
    if (e.t < map.c0 - 1e-9 || e.t > map.c1 - 1e-6 || map.skipped(e.t)) continue;
    const ev = { ...e, ct: e.t, devT: e.devT ?? e.t, t: map.toFilm(e.t), device: device ?? e.device };
    if (e.type === 'click') ev.tDown = map.toFilmFirst(e.t); // a press hold before contact: the finger is down through it
    if (e.t1 != null) ev.t1 = map.toFilm(Math.min(e.t1, map.c1));
    if (Array.isArray(e.keys)) ev.keys = e.keys.filter((k) => !map.skipped(k.t)).map((k) => ({ ...k, ct: k.t, t: map.toFilm(k.t) }));
    out.push(ev);
  }
  for (const m of cap.marks || []) {
    if (m.t < map.c0 - 1e-9 || m.t > map.c1 - 1e-6 || map.skipped(m.t)) continue; // half-open like events
    out.push({ type: 'mark', id: m.device ? m.id.slice(m.device.length + 1) : m.id, kind: m.kind || (isPayoff(m) ? 'payoff' : undefined), payoff: isPayoff(m), ct: m.t, t: map.toFilmFirst(m.t), device: device ?? m.device });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Is this tap's target visible on the frame before contact but gone on the contact frame (the tap navigates at once)? */
export function navigatingTap(e, fps) {
  const tr = e.track;
  if (!Array.isArray(tr) || !tr.length) return false;
  const at = (idx) => { let k = -1; for (let i = 0; i < tr.length; i++) if (Math.round(tr[i].t * fps) <= idx) k = i; return k < 0 ? null : tr[k]; };
  const i = Math.round(e.t * fps), pre = at(i - 1), on = at(i);
  return !!(pre && pre.visible && on && !on.visible);
}

// ───────────────────────── pace report ─────────────────────────

/**
 * Pace report of an edit (film clock). Inputs are plain lists so a multi-shot
 * edit can pass its concatenation:
 *   duration, events (film; with type/t/t1/payoff/device), segments
 *   [{f0, f1, map, cap}] (each shot's piece map + its capture), changes
 *   (film times of cuts + camera moves + device switches), P.
 * Returns {metrics, checks:[{id, status, detail}], status}.
 */
export function paceReport({ duration, events, segments, changes = [], cardAt = null, P = PACE }) {
  const checks = [];
  const add = (id, ok, detail, warnOnly = false) => checks.push({ id, status: ok ? 'pass' : warnOnly ? 'warn' : 'fail', detail });
  // first payoff on screen
  const pay = events.filter((e) => e.type === 'mark' && e.payoff).map((e) => e.t).filter((t) => t >= -1e-6);
  const openPay = segments.flatMap((s) => s.map.pieces.filter((p) => p.open).map((p) => s.f0 + p.f0));
  const firstPayoff = Math.min(...pay, ...openPay, Infinity);
  add('first-payoff', firstPayoff <= P.firstPayoff + 1e-6, `first payoff at ${Number.isFinite(firstPayoff) ? firstPayoff.toFixed(2) + ' s' : 'never'} (≤ ${P.firstPayoff} s)`);
  // spinner (busy) visible, static stretches, typing, payoff holds — from each shot's pieces
  let spinner = 0, spinnerAt = null, longestStatic = 0, staticAt = null;
  const typingTimes = [], holdsOut = [];
  for (const s of segments) {
    const cap = s.cap, pieces = s.map.pieces;
    // contiguous visible busy across pieces (a cut ends it)
    let run = 0, runStart = 0, prev = null;
    for (const p of pieces) {
      const f0 = s.f0 + p.f0, f1 = s.f0 + p.f1;
      const busyLen = p.speed ? overlapLen(cap.busy || [], p.c0, p.c1) / p.speed : inRangesClosed(cap.busy || [], p.c0 - HOLD_EPS) ? p.f1 - p.f0 : 0;
      // a cut through one spinner keeps its head and tail: both are on screen, so they add up
      const contiguous = prev && (Math.abs(prev.c1 - p.c0) < 1e-6 || (prev.cutHead && p.cutTail));
      if (busyLen > 0) { if (!contiguous) run = 0; if (!run) runStart = f0; run += busyLen; if (run > spinner) { spinner = run; spinnerAt = runStart; } } else run = 0;
      prev = p;
      void f1;
    }
    // static: film stretches where the capture shows no change (idle frames, freezes) — a cut is a change
    let st = 0, stStart = 0; prev = null;
    for (const p of pieces) {
      if (cardAt != null && s.f0 + p.f0 >= cardAt - 1e-6) break;
      const contiguous = prev && Math.abs(prev.c1 - p.c0) < 1e-6 && !(changes.some((c) => Math.abs(c - (s.f0 + p.f0)) < 1e-6));
      let len = p.speed ? overlapLen(cap.idle || [], p.c0, p.c1) / p.speed : p.f1 - p.f0;
      if (cardAt != null && s.f0 + p.f1 > cardAt) len = Math.max(0, len - (s.f0 + p.f1 - cardAt));
      const whole = p.speed ? Math.abs(len - (p.c1 - p.c0) / p.speed) < 1e-6 : true;
      if (!contiguous) { st = 0; stStart = s.f0 + p.f0; }
      if (len > 0) { if (!st) stStart = s.f0 + p.f1 - len; st += len; if (st > longestStatic) { longestStatic = st; staticAt = stStart; } }
      if (!whole) st = 0;
      prev = p;
    }
  }
  // camera moves break a static stretch too: measured against the change list
  if (longestStatic > P.staticMax && changes.some((c) => c > staticAt + 0.2 && c < staticAt + longestStatic - 0.2)) {
    const inside = changes.filter((c) => c > staticAt && c < staticAt + longestStatic).sort((a, b) => a - b);
    const pts = [staticAt, ...inside, staticAt + longestStatic];
    longestStatic = Math.max(...pts.slice(1).map((v, i) => v - pts[i]));
  }
  add('spinner', spinner <= P.spinnerMax + 1e-6, `longest spinner/skeleton on screen ${spinner.toFixed(2)} s${spinnerAt != null ? ` @ ${spinnerAt.toFixed(2)} s` : ''} (≤ ${P.spinnerMax} s)`);
  add('longest-static', longestStatic <= P.staticMax + 1e-6, `longest static picture ${longestStatic.toFixed(2)} s${staticAt != null ? ` @ ${staticAt.toFixed(2)} s` : ''} (≤ ${P.staticMax} s incl. payoff holds)`, true);
  for (const e of events.filter((x) => x.type === 'type' && x.t1 != null)) typingTimes.push({ step: e.step, device: e.device, t: +e.t.toFixed(2), dur: +(e.t1 - e.t).toFixed(3) });
  const slowType = typingTimes.filter((x) => x.dur > P.typeMax + 1e-6);
  add('typing', !slowType.length, typingTimes.length ? `typing per field ${typingTimes.map((x) => `${x.step} ${x.dur.toFixed(2)} s`).join(', ')} (≤ ${P.typeMax} s)` : 'no typing');
  // pre-feedback wait: from each tap to the next visible change of its device (film)
  const waits = [];
  for (const s of segments) {
    const evs = events.filter((e) => e.type === 'click' && e.t >= s.f0 - 1e-6 && e.t <= s.f0 + s.map.duration + 1e-6 && (s.device == null || e.device === s.device));
    for (const e of evs) {
      const changeAt = nextChange(s.cap, e.ct + 1 / (s.cap.fps || 60));
      const tf = s.f0 + s.map.toFilmFirst(Math.min(changeAt, s.map.c1));
      waits.push({ step: e.step, device: e.device, t: +e.t.toFixed(2), wait: +Math.max(0, tf - e.t).toFixed(3) });
    }
  }
  const worstWait = waits.reduce((a, w) => (w.wait > (a?.wait ?? -1) ? w : a), null);
  add('feedback-wait', !worstWait || worstWait.wait <= P.feedbackMax + 1e-6, worstWait ? `longest tap → visible change ${worstWait.wait.toFixed(2)} s (${worstWait.step} @ ${worstWait.t} s; ≤ ${P.feedbackMax} s)` : 'no taps');
  // payoff holds: a payoff lasts until the picture changes — the next action, or a cut (a camera push during it is emphasis, not a change)
  const hardCuts = [...segments.map((s) => s.f0).filter((f) => f > 0), ...segments.flatMap((s) => s.map.cuts.filter((k) => k.open).map((k) => s.f0 + k.t))];
  for (const s of segments) {
    for (const m of (s.cap.marks || []).filter(isPayoff)) {
      if (m.t < s.map.c0 - 1e-9 || m.t > s.map.c1 - 1e-6 || s.map.skipped(m.t)) continue;
      const tm = s.f0 + s.map.toFilmFirst(m.t);
      const end = s.f0 + s.map.duration;
      const nxt = Math.min(end, ...hardCuts.filter((c) => c > tm + 1e-3), ...events.filter((e) => e.t > tm + 1e-3 && e.type !== 'mark' && e.type !== 'navigate' && e.type !== 'observe').map((e) => e.t));
      // a payoff that hands over to the next payoff (banner → counter) is one payoff sequence: held as a whole
      const nextPay = events.find((e) => e.type === 'mark' && e.payoff && !e.open && e.t > tm + 1e-3 && e.t <= nxt + 0.05); // incl. a payoff that opens the next shot (cause → effect across a cut)
      if (nextPay) { holdsOut.push({ mark: m.id, device: s.device, t: +tm.toFixed(2), hold: +(nextPay.t - tm).toFixed(3), chained: true }); continue; }
      const last = Math.abs(nxt - end) < 0.02;
      holdsOut.push({ mark: m.id, device: s.device, t: +tm.toFixed(2), hold: +(nxt - tm).toFixed(3), last, shotEnd: last && end < duration - 1e-6 });
    }
  }
  const badHold = holdsOut.filter((h) => !h.chained && (h.hold < P.payoffMin - 1e-3 || (h.hold > (h.shotEnd ? P.payoffMax + 0.3 : P.payoffMax) + 1e-3 && !(h.last && !h.shotEnd))));
  add('payoff-hold', !badHold.length, holdsOut.length ? `payoff holds ${holdsOut.map((h) => `${h.mark} ${h.hold.toFixed(2)} s${h.chained ? ' (→ next payoff)' : h.shotEnd ? ' (shot end)' : h.last ? ' (film end)' : ''}`).join(', ')} (${P.payoffMin}–${P.payoffMax} s)` : 'no payoff marks', !holdsOut.length);
  // cut cadence (ads)
  const ch = [0, ...[...new Set(changes.map((c) => +c.toFixed(3)))].filter((c) => c > 0.05 && c < duration - 0.05).sort((a, b) => a - b), duration];
  const gaps = ch.slice(1).map((v, i) => v - ch[i]);
  const maxGap = Math.max(...gaps), meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const ad = duration <= P.cadenceAdMax;
  add('cut-cadence', !ad || maxGap <= P.cadenceMax + 1e-6, `${ch.length - 2} cuts/camera changes, mean gap ${meanGap.toFixed(2)} s, longest ${maxGap.toFixed(2)} s${ad ? ` (ad ≤ ${P.cadenceAdMax} s: ≤ ${P.cadenceMax} s)` : ' (not an ad: reported only)'}`, !ad);
  const status = checks.some((c) => c.status === 'fail') ? 'fail' : checks.some((c) => c.status === 'warn') ? 'pass-with-warnings' : 'pass';
  return {
    status,
    metrics: {
      duration: +duration.toFixed(3), firstPayoff: Number.isFinite(firstPayoff) ? +firstPayoff.toFixed(3) : null,
      longestSpinner: +spinner.toFixed(3), longestStatic: +longestStatic.toFixed(3), typing: typingTimes, tapFeedback: waits, payoffHolds: holdsOut,
      cadence: { changes: ch.slice(1, -1).map((c) => +c.toFixed(3)), meanGap: +meanGap.toFixed(3), maxGap: +maxGap.toFixed(3) },
    },
    checks,
  };
}
function overlapLen(rs, a, b) { let s = 0; for (const [x, y] of rs) s += Math.max(0, Math.min(b, y) - Math.max(a, x)); return s; }
const inRangesClosed = (rs, t) => rs.some(([a, b]) => t >= a - 1e-9 && t <= b + 1e-9);
/** First capture time ≥ t where the picture changes (not inside an idle range). */
export function nextChange(cap, t) {
  for (const [a, b] of cap.idle || []) if (t >= a - 1e-9 && t < b) return b;
  return t;
}

// ───────────────────────── legibility + camera ─────────────────────────

/** Min zoom so text of `textVideoPx` (video px) renders ≥ minPx at s output px per video px. */
export const legibilityZoom = (textVideoPx, s, minPx = 18) => Math.max(1, minPx / Math.max(1e-6, textVideoPx * s));

/**
 * Camera keys for a real recording: calm reframes, not punch-ins. Each focus
 * event (tap, typing, tracked payoff) asks for the zoom its text needs
 * (zText = legibility, ≥ 1) — a payoff gets a gentle push (zPush) — centred on
 * the target and clamped so the target is never cropped. Requests that
 * differ by less than `still` (fraction of the view) share one framing.
 * Returns keys [{t, cx, cy, z, why}] (x-ui cameraTrack input).
 */
export function planRealCamera(events, view, { lead = 0.35, zText = 1, zPush = 1.1, zTap = 1, payoffWide = false, zReveal = 1, still = 0.08, minShot = 0.9, settle = 0.8 } = {}) {
  const keys = [];
  const want = [];
  // only a narrow target earns a tap punch-in (a full-width field would lose its edges)
  for (const e of events) {
    const box = e.box || (e.point && { x: e.point.x - 40, y: e.point.y - 40, w: 80, h: 80 });
    if (!box && !(e.type === 'mark' && e.payoff && payoffWide)) continue;
    if (e.type === 'click' || e.type === 'type') want.push({ t: e.type === 'click' ? Math.min(e.t, e.tDown ?? e.t) : e.t, box, z: e.type === 'click' && box.w <= 0.6 * view.viewW ? Math.max(zText, zTap) : zText, punch: e.type === 'click' && box.w <= 0.6 * view.viewW && zTap > zText + 1e-3, why: `${e.type} ${e.step || ''}`.trim() });
    else if (e.type === 'mark' && e.payoff && payoffWide) want.push({ t: e.t + lead * 0.5, box: null, z: zReveal, why: `payoff ${e.id} (reveal)` });
    else if (e.type === 'mark' && e.payoff && e.box) want.push({ t: e.t, box: e.box, z: Math.max(zText, zPush), why: `payoff ${e.id}` });
  }
  let last = view.wide;
  for (const w of want) {
    if (!w.box) {
      // a reveal shows (nearly) the whole screen: the content centre, a touch above (headers and banners live at the top)
      const c = view.content, z = clamp(w.z, 1, view.zMax);
      const cam = view.clampCam({ cx: c.x + c.w / 2, cy: c.y + view.viewH / (2 * z) - 8, z }); // top-anchored: header, banners and the result in view
      keys.push({ t: Math.max(0, w.t - lead), ...cam, why: w.why, feel: { f: 0.9, z: 1 } });
      last = cam;
      continue;
    }
    let z = clamp(w.z, 1, view.zMax);
    // never crop the target: back off the zoom until it fits (with a small margin)
    const fitZ = Math.min(view.viewW / (w.box.w + 24), view.viewH / (w.box.h + 24));
    z = Math.max(1, Math.min(z, fitZ));
    const cam = view.clampCam({ cx: w.box.x + w.box.w / 2, cy: w.box.y + w.box.h / 2, z });
    // a target already well framed by the current camera needs no move
    const inner = { ...view, viewW: view.viewW * (1 - still), viewH: view.viewH * (1 - still * 2) };
    const near = Math.abs(cam.z - last.z) < 0.03 && view.shows(last, w.box) && makeShows(inner)(last, w.box);
    if (near) continue;
    const prev = keys[keys.length - 1];
    // a punch-in on a tap settles BEFORE the finger lands (a camera still moving at the press blurs the key beat)
    let t = Math.max(0, w.t - (w.punch ? Math.max(lead, 0.75) : lead));
    // too soon after the last move: skip it — unless the current framing would crop the target (never crop a tap)
    const crops = !view.shows(last, w.box);
    let cut = false;
    if (prev && t - prev.t < minShot) { if (w.why.startsWith('payoff') || crops || Math.abs(cam.cy - prev.cy) * cam.z > view.viewH * 0.25) { t = Math.max(t, prev.t + 0.25); } else { continue; } }
    if (crops && !w.why.startsWith('payoff')) {
      // a move that uncovers the target must have LANDED when the finger does: start it a full beat early, and if
      // there is no room for that, reframe with a cut just before the press (a spring still travelling = off-frame tap)
      t = Math.max(prev ? prev.t + 0.25 : 0, Math.min(t, w.t - 0.75));
      if (w.t - t < 0.6) { t = Math.max(prev ? prev.t + 0.05 : 0, w.t - 0.2); cut = true; }
    }
    keys.push({ t, ...cam, why: w.why, feel: { f: 0.9, z: 1 }, ...(cut ? { cut: true } : {}) });
    last = cam;
  }
  void settle;
  return keys;
}
/**
 * Cadence fill: wherever the camera would hold longer than `gap` seconds, a
 * deliberate, gentle move starts (a slow push toward the current framing, or a
 * settle back out) — a held phone recording reads as frozen, and a 20 s ad
 * needs a change every 1.5–3 s. Never crops a target (it only pushes about the
 * current centre, within zMax) and never lands within 0.6 s of another key.
 */
export function fillCamera(keys, view, { duration, gap = 2.6, zMax = 1.15, bleed = false, events = [], zBase = 1 } = {}) {
  const out = [...keys].sort((a, b) => a.t - b.t);
  // full-bleed: the screen edges ARE the frame — a push may only eat into the app's own side margin (≈ 4 %)
  const zIn = Math.min(zMax, bleed ? 1.045 * zBase : 1.3 * zBase);
  zBase = Math.min(zBase, zMax);
  for (let guard = 0; guard < 64; guard++) {
    const ts = [0, ...out.map((k) => k.t), duration];
    let i = -1;
    for (let k = 0; k + 1 < ts.length; k++) if (ts[k + 1] - ts[k] > gap + 1e-6) { i = k; break; }
    if (i < 0) break;
    const prev = i ? out[i - 1] : view.wide;
    const t = ts[i] + Math.min(gap * 0.75, (ts[i + 1] - ts[i]) / 2);
    // every target worked on while this framing holds (until the next key) must stay wholly in shot
    const until = ts[i + 1];
    const tgts = events.filter((e) => e.box && e.t > t - 0.3 && e.t < until + 0.2);
    let z = prev.z < (zBase + zIn) / 2 ? zIn : zBase;
    let cam = view.clampCam({ cx: prev.cx, cy: prev.cy, z });
    const ok = (c) => tgts.every((e) => view.shows(c, e.box));
    if (!ok(cam) && tgts.length) { const u = tgts.map((e) => e.box).reduce(union); cam = view.clampCam({ cx: u.x + u.w / 2, cy: u.y + u.h / 2, z }); }
    if (!ok(cam)) { z = zBase; cam = view.clampCam({ cx: prev.cx, cy: prev.cy, z }); }
    if (Math.abs(cam.z - prev.z) < 1e-3 && Math.abs(cam.cx - prev.cx) < 1 && Math.abs(cam.cy - prev.cy) < 1) {
      // no admissible move here: a slow vertical drift of 3 % of the view keeps the picture alive without cropping anyone
      cam = view.clampCam({ cx: prev.cx, cy: prev.cy + (prev.cy > view.content.y + view.content.h / 2 ? -1 : 1) * view.viewH * 0.03 / prev.z, z: prev.z });
    }
    out.splice(i, 0, { t, ...cam, why: z > zBase + 1e-6 ? 'cadence push' : 'cadence settle', feel: { f: 0.55, z: 1 } });
  }
  return out;
}
const makeShows = (v) => (c, b) => {
  const hw = v.viewW / (2 * c.z), hh = v.viewH / (2 * c.z);
  return b.x >= c.cx - hw && b.x + b.w <= c.cx + hw && b.y >= c.cy - hh && b.y + b.h <= c.cy + hh;
};

// ───────────────────────── touch ─────────────────────────

/** Touch feel: press 75 ms (60–90), the disc lands 40 ms before contact, the ripple runs 380 ms. */
export const TOUCH = { pre: 0.04, press: 0.075, ripple: 0.38, fade: 0.2, r: 0.024, ringMax: 2.6 };

/**
 * The press indicator of one tap at film time t (video px; centre EXACTLY at
 * the tap's vpoint). r0 = disc radius (video px). Returns null when nothing
 * shows, else {x, y, disc: {r, a}, ring: {r, a, w} | null}.
 */
export function touchAt(t, tap, r0, T = TOUCH) {
  // the finger lands at tDown (≤ t: a held pre-contact frame) and lifts T.press after contact
  const down = Math.min(tap.tDown ?? tap.t, tap.t), press = T.press + (tap.t - down);
  const u = t - down;
  T = { ...T, press };
  if (u < -T.pre || u > T.press + Math.max(T.ripple, T.fade) + 1e-9) return null;
  const { x, y } = tap.point;
  // disc: grows in as the finger lands, slightly smaller while pressed, fades after release
  let dr, da;
  if (u < 0) { const k = (u + T.pre) / T.pre; dr = r0 * (0.7 + 0.3 * k); da = 0.42 * k; }
  else if (u < T.press) { dr = r0 * 0.92; da = 0.42; }
  else { const k = clamp((u - T.press) / T.fade); dr = r0 * (0.92 + 0.12 * k); da = 0.42 * (1 - k) * (1 - k); }
  let ring = null;
  if (u >= T.press * 0.4) {
    const k = clamp((u - T.press * 0.4) / T.ripple);
    if (k < 1) ring = { r: r0 * (1 + (T.ringMax - 1) * (1 - Math.pow(1 - k, 3))), a: 0.75 * Math.pow(1 - k, 1.3), w: r0 * 0.12 };
  }
  if (da <= 1e-3 && !ring) return null;
  return { x, y, disc: { r: dr, a: da }, ring };
}

/** Swipe / fling trail at film time t: points along the finger path for the last `tail` s, fading. */
export function swipeTrail(t, sw, { tail = 0.14, fade = 0.22, n = 12 } = {}) {
  const t0 = sw.t, t1 = Math.max(sw.t1 ?? sw.t + 0.25, t0 + 0.05);
  if (t < t0 || t > t1 + fade) return null;
  const at = (s) => { const u = clamp((s - t0) / (t1 - t0)); const e = 1 - Math.pow(1 - u, 2.2); return { x: sw.from.x + (sw.to.x - sw.from.x) * e, y: sw.from.y + (sw.to.y - sw.from.y) * e }; };
  const head = Math.min(t, t1), a = t > t1 ? 1 - (t - t1) / fade : 1;
  const pts = [];
  for (let i = 0; i <= n; i++) { const s = head - tail * (i / n); if (s < t0) break; pts.push({ ...at(s), w: 1 - i / n }); }
  return pts.length > 1 ? { pts, a: clamp(a) } : null;
}

/** The finger path of a scroll/swipe event (video px): its own from/to points, else the box centre dragged against the scroll. */
export function swipePath(e, view) {
  if (e.pfrom && e.pto) return { from: e.pfrom, to: e.pto };
  const b = e.box || view.content;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const dy = clamp(((e.to ?? 0) - (e.from ?? 0)) * (e.cssScale ?? 1), -view.viewH * 0.45, view.viewH * 0.45) || view.viewH * 0.3;
  return { from: { x: cx, y: cy + dy / 2 }, to: { x: cx, y: cy - dy / 2 } };
}

// ───────────────────────── session (multi-device) ─────────────────────────

/** "device:mark±s" | number (session s) → session seconds. caps: {id: normalised capture}. */
export function sessionTime(caps, ref, edge = 't0') {
  if (typeof ref === 'number') return ref;
  const m = /^([a-z0-9][a-z0-9_-]*):(.+?)([+-]\d+(?:\.\d+)?)?$/i.exec(ref);
  if (!m || !caps[m[1]]) throw new Error(`session ref "${ref}": use "device:mark[±s]" (devices: ${Object.keys(caps).join(', ')})`);
  const cap = caps[m[1]];
  return captureTime(cap, m[2], edge) + (m[3] ? parseFloat(m[3]) : 0) + (cap.sessionOffset || 0);
}

/**
 * A virtual capture on the SESSION clock for a split shot: every device's
 * events/marks shifted by its sessionOffset (ids prefixed "device:"), and
 * dead ranges where ALL devices are dead (idle where all idle; busy where one
 * is busy and the rest are dead).
 */
export function sessionCapture(caps, ids) {
  const sh = (rs, o) => rs.map(([a, b]) => [a + o, b + o]);
  const deadOf = (c) => normRanges([...sh(c.idle || [], c.sessionOffset), ...sh(c.busy || [], c.sessionOffset)]);
  let dead = deadOf(caps[ids[0]]);
  for (const id of ids.slice(1)) dead = andRanges(dead, deadOf(caps[id]));
  const idleAll = ids.map((id) => normRanges(sh(caps[id].idle || [], caps[id].sessionOffset))).reduce((a, b) => andRanges(a, b));
  const events = [], marks = [];
  for (const id of ids) {
    const c = caps[id], o = c.sessionOffset;
    for (const e of c.events || []) events.push({ ...e, devT: e.t, t: e.t + o, ...(e.t1 != null ? { t1: e.t1 + o } : {}), ...(e.keys ? { keys: e.keys.map((k) => ({ ...k, t: k.t + o })) } : {}), device: id });
    for (const m of c.marks || []) marks.push({ ...m, id: `${id}:${m.id}`, t: m.t + o, device: id });
  }
  const t0 = Math.min(...ids.map((id) => caps[id].sessionOffset)), t1 = Math.max(...ids.map((id) => caps[id].sessionOffset + caps[id].duration));
  return {
    flow: ids.join('+'), fps: caps[ids[0]].fps, duration: t1, start: t0,
    events: events.sort((a, b) => a.t - b.t), marks: marks.sort((a, b) => a.t - b.t), steps: [],
    idle: idleAll, busy: subRanges(dead, idleAll), sessionOffset: 0, devices: ids,
  };
}

// ───────────────────────── layout ─────────────────────────

/** Phone looks for 16:9 (proportions of the recording's own screen; radii in video px of a 1080-wide screen). */
export const PHONES = {
  slab: { bezel: 0.019, screenR: 0.085, body: '#16171B', rim: 'rgba(255,255,255,0.16)', edge: '#2A2C31', note: 'thin graphite bezel, soft rim light' },
  glass: { bezel: 0, screenR: 0.085, body: null, rim: 'rgba(255,255,255,0.0)', edge: null, note: 'the screen alone, floating (no device)' },
  silver: { bezel: 0.022, screenR: 0.085, body: '#E4E5E8', rim: 'rgba(0,0,0,0.12)', edge: '#C9CBD0', note: 'light aluminium frame' },
};

/**
 * Where each device screen sits on the output (screen px) for a shot.
 *   W, H        output frame; band = {top, bottom} px kept free (captions/clock)
 *   screens     [{vw, vh}] video sizes of the shot's devices (1 or 2)
 *   frame       'none' (9:16 full-bleed, one device) | 'phone' (device on a ground)
 *   side        16:9: fraction of the width reserved for captions on the right (0 = centred)
 * Returns [{x, y, w, h, s, r, bezel}] — s = output px per video px at zoom 1, r = screen corner radius (output px).
 */
export function layoutScreens({ W, H, screens, frame = 'phone', phone = PHONES.slab, side = 0, top = 0, bottom = 0, gap = null }) {
  const n = screens.length;
  if (frame === 'none' && n === 1) {
    const { vw } = screens[0];
    const s = W / vw;
    return [{ x: 0, y: 0, w: W, h: screens[0].vh * s, s, r: 0, bezel: 0, bleed: true }];
  }
  const availW = W * (1 - side), availH = H - top - bottom;
  const g = gap ?? Math.round(Math.min(W, H) * (W > H ? 0.06 : 0.035));
  const vMargin = Math.round(H * (W > H ? 0.03 : 0.025));
  const out = [];
  // equal height for all devices, fitted to the available width and height
  const bz = (sc) => phone.bezel * sc.vw;
  const unitW = screens.reduce((a, sc) => a + sc.vw + 2 * bz(sc), 0), unitH = Math.max(...screens.map((sc) => sc.vh + 2 * bz(sc)));
  const s = Math.min((availW - g * (n - 1) - (W > H ? W * 0.06 : W * 0.05)) / unitW, (availH - 2 * vMargin) / unitH);
  const total = unitW * s + g * (n - 1);
  let x = (availW - total) / 2;
  for (const sc of screens) {
    const b = bz(sc) * s, w = sc.vw * s, h = sc.vh * s;
    out.push({ x: x + b, y: top + (availH - h) / 2, w, h, s, r: phone.screenR * sc.vw * s, bezel: b });
    x += w + 2 * b + g;
  }
  return out;
}

/** The view (camera space) of one full-bleed or framed screen: video px content, output px viewport. */
export function screenView({ vw, vh, viewW, viewH, zMax, wideTop = false }) {
  return makeView({ content: { x: 0, y: 0, w: vw, h: vh }, viewW, viewH, zMax, fill: 0.9, padding: 24, minTarget: 0, wideTop });
}

export { union };

// ───────────────────────── the edit plan (shared by template and Node) ─────────────────────────

/**
 * Plan a real-video edit: shots (one device, or a 2-up split on the session
 * clock) paced, laid out and camera-planned. Pure.
 *   caps     {deviceId: normalised capture}
 *   content  {shots?, retime ('auto' | [..] | {mode:'auto', overrides}), beats?, open?, captions?, frame?, camera?}
 *   W, H, fps, params {zoomMax, textCss, legibility, phone, side, top, bottom, breathe}
 * Returns {duration, shots:[{f0, f1, kind, devices, map, cap, panels:[{device, rect, view, keys}], events}], events, changes, report}.
 */
export function planEdit({ caps, content: C, W, H, fps = 30, params = {} }) {
  const ids = Object.keys(caps);
  // payoff marks named by the edit (the recorder logs only {t, id}): stamped here so auto pace holds them and the report measures them
  for (const ref of C.payoffs || []) {
    const [d, id] = ref.includes(':') ? ref.split(':') : [null, ref];
    if (d && !caps[d]) throw new Error(`payoffs: unknown device "${d}" in "${ref}"`);
    for (const dd of d ? [d] : ids) caps[dd].marks = (caps[dd].marks || []).map((m) => (m.id === id ? { ...m, kind: 'payoff' } : m));
  }
  // full-bleed only: the OS status bar / browser toolbar above cropTop (video px) is never shown (a dev URL, a stray clock)
  const cropOf = (d) => Math.max(0, C.session?.devices?.find((x) => x.id === d)?.cropTop ?? caps[d].device?.cropTop ?? 0);
  // 9:16 full-bleed: a headline band of bandTop × H above the recording (captions + brand live there, never over the UI)
  const bandT = H > W && (C.frame || 'none') === 'none' ? Math.round((params.bandTop ?? 0) * H) : 0;
  const rt = C.retime ?? 'auto';
  const auto = rt === 'auto' || rt?.mode === 'auto';
  const overrides = Array.isArray(rt) ? rt : rt?.overrides || [];
  const shotsIn = C.edit?.length ? C.edit : [{ device: ids[0], from: C.range?.from, to: C.range?.to }];
  const phone = PHONES[params.phone || 'slab'] || PHONES.slab;
  const frame = C.frame || (H > W ? 'none' : 'phone');
  const beats = (C.beats || []).map((b) => ({ ...b }));
  const shots = [], events = [], changes = [];
  let f = 0;
  shotsIn.forEach((sh, k) => {
    const split = Array.isArray(sh.split) ? sh.split : null;
    const devs = split || [sh.device || ids[0]];
    for (const d of devs) if (!caps[d]) throw new Error(`shot ${k + 1}: unknown device "${d}" (have ${ids.join(', ')})`);
    let cap, c0, c1;
    if (split) {
      cap = sessionCapture(caps, devs);
      c0 = sh.from != null ? sessionTime(caps, sh.from) : cap.start;
      c1 = sh.to != null ? sessionTime(caps, sh.to, 't1') : cap.duration;
    } else {
      const d = devs[0];
      cap = caps[d];
      const ref = (r, edge) => (typeof r === 'string' && r.includes(':') ? sessionTime(caps, r, edge) - cap.sessionOffset : captureTime(cap, r, edge));
      c0 = sh.from != null ? ref(sh.from) : 0;
      c1 = sh.to != null ? ref(sh.to, 't1') : cap.duration;
    }
    c0 = clamp(c0, split ? cap.start : 0, cap.duration); c1 = clamp(c1, c0 + 0.05, cap.duration);
    // beats inside this shot, on its own clock (refs → this shot's capture clock)
    const local = beats.filter((b) => !b.used).map((b) => {
      let ct;
      try { ct = split ? sessionTime(caps, b.at) : typeof b.at === 'string' && b.at.includes(':') ? (b.at.startsWith(devs[0] + ':') ? sessionTime(caps, b.at) - cap.sessionOffset : null) : captureTime(cap, b.at); } catch { ct = null; }
      return ct != null && ct >= c0 - 1e-9 && ct < c1 - 1e-6 ? { b, at: ct, t: b.t - f } : null;
    }).filter(Boolean);
    local.forEach((x) => { x.b.used = true; });
    const open = sh.open || (k === 0 && C.open) || null;
    // a solo shot can only cold-open on its own recording: converting another device's mark through the session
    // clock silently showed the wrong phone (separate takes share no moment) — say so instead
    if (open && !split && typeof open.at === 'string' && open.at.includes(':') && open.at.split(':')[0] !== devs[0]) {
      throw new Error(`ui-demo: open at "${open.at}" is on device "${open.at.split(':')[0]}" but shot ${k} shows "${devs[0]}" — start the edit with a "${open.at.split(':')[0]}" shot (or give that shot its own "open")`);
    }
    const openC = open ? { at: split ? sessionTime(caps, open.at) : (typeof open.at === 'string' && open.at.includes(':') ? sessionTime(caps, open.at) - cap.sessionOffset : captureTime(cap, open.at)), dur: open.dur } : null;
    const plan = pacePlan(cap, { c0, c1, overrides: (Array.isArray(sh.retime) ? sh.retime : sh.retime?.overrides || overrides).filter((r) => { try { if (r.hold != null) return captureTime(cap, r.at) >= c0; captureTime(cap, r.from); captureTime(cap, r.to); return true; } catch { return false; } }), beats: local.map((x) => ({ at: x.at, t: x.t })), open: openC, auto: sh.retime === 'auto' || sh.retime?.mode === 'auto' || (sh.retime == null && auto) });
    const map = plan.map;
    // layout + camera
    const screens = devs.map((d) => ({ vw: caps[d].device.viewport.width, vh: caps[d].device.viewport.height }));
    const rects = layoutScreens({ W, H, screens, frame: split ? 'phone' : frame, phone, side: split ? 0 : frame === 'phone' && W > H ? params.side ?? 0 : 0, top: params.top ?? 0, bottom: params.bottom ?? 0 });
    const shotEvents = (split ? filmEventsOf(cap, map) : filmEventsOf(cap, map, { device: devs[0] }));
    const panels = devs.map((d, i) => {
      const r = rects[i].bleed && bandT ? { ...rects[i], y: bandT, h: H - bandT } : rects[i], vw = screens[i].vw, vh = screens[i].vh;
      const bleed = !!r.bleed;
      const zRes = 1.15 / r.s;
      const zMax = Math.max(1, Math.min(params.zoomMax ?? (bleed ? 1.15 : 2.2), zRes));
      const bz = phone.bezel * vw;
      const cropT = bleed ? Math.min(cropOf(d), Math.max(0, vh - (H - bandT) / r.s)) : 0;
      const content = bleed ? { x: 0, y: cropT, w: vw, h: vh - cropT } : { x: -bz, y: -bz, w: vw + 2 * bz, h: vh + 2 * bz };
      let splitStart = null;
      let view = makeView({ content, viewW: W / r.s, viewH: (H - (bleed ? bandT : 0)) / r.s, zMax, fill: 0.9, padding: 24, minTarget: 0, wideTop: bleed });
      // stage centre: full-bleed → frame centre (below the band); framed → the screen's own centre at zoom 1
      let centre = bleed ? { x: W / 2, y: bandT + (H - bandT) / 2 } : { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      if (split) {
        // a split shares ONE stage camera: every panel's camera is the frame-centred stage zoom
        // expressed in its own video px (wide = the point that maps to the frame centre)
        const cxw = vw / 2 + (W / 2 - centre.x) / r.s, cyw = vh / 2 + (H / 2 - centre.y) / r.s;
        view = makeView({ content: { x: cxw - W / (2 * r.s), y: cyw - H / (2 * r.s), w: W / r.s, h: H / r.s }, viewW: W / r.s, viewH: H / r.s, zMax: 1.8, fill: 0.9, padding: 0, minTarget: 0 });
        centre = { x: W / 2, y: H / 2 };
        // the 2-up is shown close: the stage zoomed about the phones' top edge (headers stay, the lower screens bleed off)
        const r0 = rects[0]; // the leftmost device bounds how far the 2-up can zoom before it leaves the frame
        const k = Math.max(1, Math.min(params.splitZoom ?? (W > H ? 1.45 : 1), (W * 0.98) / (W - 2 * (r0.x - r0.bezel))));
        const qy = r.y - r.bezel;
        splitStart = { cx: cxw, cy: cyw + ((H / 2 - qy) * (1 - k)) / (r.s * k), z: k }; // zoom k about the frame point (W/2, qy)
      }
      const textPx = (params.textCss ?? 16) * (caps[d].device.cssScale || 1);
      // framed (16:9 / phone): the camera pushes in to the active region (params.focus, ≥ legibility); full-bleed: legibility only
      const zText = Math.max(legibilityZoom(textPx, r.s, params.legibility ?? 18), bleed ? 1 : params.focus ?? 2.0);
      let keys = [];
      if (!split && C.camera !== 'wide') {
        const evs = shotEvents.filter((e) => (e.box || e.type === 'mark') && e.t >= 0);
        keys = planRealCamera(evs.map((e) => (e.type === 'mark' && !e.box ? { ...e, box: null } : e)), view, { zText, zPush: Math.min(zMax, params.push ?? 1.08), zTap: bleed ? Math.min(zMax, params.tapPush ?? 1.1) : 1, payoffWide: !bleed, zReveal: Math.min(zMax, params.reveal ?? 1.5) });
      }
      const focusEvents = [];
      if (!split && sh.focus?.box && C.camera !== 'wide') {
        const fb = sh.focus.box, fat = sh.focus.at != null ? (typeof sh.focus.at === 'number' ? sh.focus.at : map.toFilm(captureTime(cap, sh.focus.at))) : 0.6;
        const fz = Math.max(1, Math.min(zMax, sh.focus.zoom ?? zMax, view.viewW / (fb.w + 24), view.viewH / (fb.h + 24)));
        keys = [...keys.filter((k) => k.t < fat - 0.3), { t: fat, ...view.clampCam({ cx: fb.x + fb.w / 2, cy: fb.y + fb.h / 2, z: fz }), why: 'focus', feel: { f: 0.8, z: 1 } }];
        for (let q = fat; q < map.duration + 30; q += 0.5) focusEvents.push({ type: 'focus', t: q, box: fb });
      }
      if (split && C.camera !== 'wide') keys = [{ t: -0.1, ...splitStart, why: 'split start', cut: true }, ...fillCamera([{ t: -0.1, ...splitStart }], view, { duration: map.duration, gap: params.cameraGap ?? 2.4, zMax: splitStart.z * 1.05, bleed: true, zBase: splitStart.z }).slice(1)];
      else if (C.camera !== 'wide') keys = fillCamera(keys, view, { duration: map.duration, gap: params.cameraGap ?? 2.2, zMax, bleed, events: [...shotEvents, ...focusEvents], zBase: bleed ? 1 : Math.min(zMax, params.reveal ?? 1.5) });
      if (!split && !bleed && C.camera !== 'wide') {
        // a framed shot opens ON its working framing (a cut, no move): never on a small whole-phone wide
        const zB = Math.min(zMax, params.reveal ?? 1.5);
        const k0 = { t: -0.1, ...view.clampCam({ cx: content.x + content.w / 2, cy: content.y + view.viewH / (2 * zB) - 8, z: zB }), why: 'shot start', cut: true };
        keys = [k0, ...keys.filter((k) => k.t > 0.25)];
      }
      return { device: d, rect: r, view, centre, keys, zText, textPx, zMax, splitZ: splitStart?.z, fillEvents: focusEvents };
    });
    if (k > 0) changes.push(f);
    // the open's cut and cuts out of a spinner change the picture; a cut through static frames is invisible
    for (const c of map.cuts) if (c.open || (cap.busy || []).some(([a, b]) => c.from >= a - 1e-6 && c.from <= b + 1e-6)) changes.push(f + c.t);
    for (const p of panels) for (const key of p.keys) if (key.t > 0.05) changes.push(f + key.t);
    // the cold open shows a payoff out of capture order: its marks (incl. one just before the open, e.g. a banner arriving) sound there too
    for (const op of map.pieces.filter((p) => p.open)) {
      for (const m of cap.marks || []) if (m.t >= op.c0 - 0.5 && m.t <= op.c1) shotEvents.push({ type: 'mark', id: m.device ? m.id.slice(m.device.length + 1) : m.id, kind: m.kind || (isPayoff(m) ? 'payoff' : undefined), payoff: false, open: true, ct: m.t, t: Math.max(0.05, op.f0 + (m.t - op.c0)), device: split ? m.device : devs[0] });
    }
    for (const e of shotEvents) events.push({ ...e, t: e.t + f, ...(e.tDown != null ? { tDown: e.tDown + f } : {}), ...(e.t1 != null ? { t1: e.t1 + f } : {}), ...(e.keys ? { keys: e.keys.map((q) => ({ ...q, t: q.t + f })) } : {}), shot: k });
    shots.push({ index: k, f0: f, f1: f + map.duration, kind: split ? 'split' : 'solo', devices: devs, cap, map, panels, events: shotEvents, notes: plan.notes });
    f += map.duration;
  });
  for (const b of beats) if (!b.used) shots[0].notes.push(`beat ${b.at}: not inside any shot — ignored`);
  // minDuration: the film never ends under the voice — the last shot's final frame is held (the camera keeps breathing)
  if (C.minDuration && f < C.minDuration - 1e-6) {
    const last = shots[shots.length - 1], extra = C.minDuration - f;
    const pieces = [...last.map.pieces.map(({ f0, f1, cmax, ...p }) => p), { c0: last.map.c1, c1: last.map.c1, speed: 0, dur: extra, kind: 'hold', why: 'minDuration tail' }];
    last.map = timeMap(pieces);
    last.f1 += extra; f += extra;
    for (const p of last.panels) if (C.camera !== 'wide') p.keys = fillCamera(p.keys.filter((k) => k.t < last.map.duration - extra), p.view, { duration: last.map.duration, gap: params.cameraGap ?? 2.2, zMax: p.splitZ ? p.splitZ * 1.05 : p.zMax, bleed: !!p.splitZ || p.rect.bleed, events: p.splitZ ? [] : [...last.events, ...(p.fillEvents || [])], zBase: p.splitZ || (p.rect.bleed ? 1 : Math.min(p.zMax, params.reveal ?? 1.5)) });
    for (const p of last.panels) for (const key of p.keys) if (last.f0 + key.t > f - extra - 1e-6) changes.push(last.f0 + key.t);
  }
  const duration = f;
  // an end card (content.endCard) wipes in over the last shot: a picture change; its held CTA is not a static UI stretch
  const cardAt = C.endCard?.at;
  if (cardAt != null) changes.push(cardAt, cardAt + 0.45);
  const report = paceReport({ duration, events, segments: shots.map((s) => ({ f0: s.f0, map: s.map, cap: s.cap, device: s.kind === 'solo' ? s.devices[0] : undefined })), changes, cardAt });
  report.notes = shots.flatMap((s) => s.notes);
  return { duration, shots, events, changes: [...new Set(changes)].sort((a, b) => a - b), report, frame };
}

/** The shot showing film time t (the last one at/after its start). */
export const shotAt = (plan, t) => plan.shots.find((s, i) => t < s.f1 || i === plan.shots.length - 1);
