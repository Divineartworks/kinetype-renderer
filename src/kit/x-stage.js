// UI-stage kit: pure planners for a multi-device stage (2–3 recorded product UIs
// in one frame). Each panel is a device (phone bezel, browser chrome, bare card)
// whose SCREEN shows its capture through the panel's own camera (a screen zoom:
// the device stays put, the UI inside it is framed); the stage places devices by
// arrangement keyframes. One composed affine map per panel takes capture CSS px
// to output px; frames, highlights, cursor, callouts and connectors all use it.
// Everything here is a pure function of its inputs (unit-tested without a browser).
import { clamp, lerp } from './math.js';
import { cubicInOut } from './ease.js';
import { frameRect } from './x-ui.js';

// ───────────────────────── film-time references ─────────────────────────

/**
 * A film-time reference on the STAGE clock: a number (seconds) or "panel:ref"
 * where ref is a mark or step id of that panel's capture (mapped through that
 * panel's clock, so it lands on the frame where the mark shows). `resolve(panelId,
 * ref)` returns the film time or throws. "panel:ref+0.4" adds an offset.
 */
export function filmRef(at, resolve) {
  if (typeof at === 'number') return at;
  const str = String(at), i = str.indexOf(':');
  if (i < 1 || i === str.length - 1) throw new Error(`time "${at}" must be seconds or "panel:mark" (e.g. "owner:beat-dagen", "owner:beat-dagen+0.4")`);
  const pid = str.slice(0, i), ref = str.slice(i + 1);
  // an id may itself end in "-2": the whole ref wins; only then is a trailing ±s an offset
  const m = /^(.+?)([+-]\d+(?:\.\d+)?)$/.exec(ref);
  if (!m) return resolve(pid, ref);
  try { return resolve(pid, ref); } catch { return resolve(pid, m[1]) + +m[2]; }
}

// ───────────────────────── panel clock ─────────────────────────

/**
 * Film clock → panel clock. The panel runs its retimed capture from film time
 * `start`; before it, it holds its first frame (holdBefore "first"); after its
 * end it holds the last (holdAfter "last"). localT(t) is the panel's own film time.
 */
export function panelClock({ start = 0, duration }) {
  const local = (t) => clamp(t - start, 0, duration);
  return { start, duration, end: start + duration, localT: local, running: (t) => t >= start && t <= start + duration };
}

// ───────────────────────── composed map ─────────────────────────

/**
 * The ONE capture-CSS → output map of a panel at one instant:
 *   T   = stage placement {x, y, k}: device-local px (screen top-left = 0,0) → output,
 *         out = (T.x + k·lx, T.y + k·ly)
 *   cam = panel camera {cx, cy, z} in capture CSS px (screen zoom)
 *   geo = {sw, sh, zMin}: the screen in CSS px, and the camera's base zoom
 * The screen shows capture CSS x at lx = sw/2 + (x − cx)·zMin·z.
 * Returns {K (output px per CSS px), pt, box, apply(g), screen (output rect), src (visible capture region, CSS)}.
 */
export function composeMap(T, cam, { sw, sh, zMin = 1 }) {
  const zz = zMin * cam.z, K = T.k * zz;
  const ox = T.x + T.k * (sw / 2 - cam.cx * zz), oy = T.y + T.k * (sh / 2 - cam.cy * zz);
  return {
    K, ox, oy,
    pt: (x, y) => ({ x: ox + x * K, y: oy + y * K }),
    box: (b) => ({ x: ox + b.x * K, y: oy + b.y * K, w: b.w * K, h: b.h * K }),
    apply: (g) => { g.translate(ox, oy); g.scale(K, K); },
    screen: { x: T.x, y: T.y, w: T.k * sw, h: T.k * sh },
    src: { x: cam.cx - sw / (2 * zz), y: cam.cy - sh / (2 * zz), w: sw / zz, h: sh / zz },
  };
}

/** 2D affine as [a, b, c, d, e, f] (canvas order). */
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const tr = (x, y) => [1, 0, 0, 1, x, y];
const sc = (k) => [k, 0, 0, k, 0, 0];
/**
 * The same map built independently as a product of elementary affines
 * (stage ∘ screen-centre ∘ camera zoom ∘ camera centre). QA compares the drawn
 * geometry against this, so an algebra slip in composeMap cannot hide.
 */
export function composeMatrix(T, cam, { sw, sh, zMin = 1 }) {
  let m = tr(T.x, T.y);
  m = mul(m, sc(T.k));
  m = mul(m, tr(sw / 2, sh / 2));
  m = mul(m, sc(zMin * cam.z));
  m = mul(m, tr(-cam.cx, -cam.cy));
  return m;
}
export const applyMatrix = (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
export function matrixBox(m, b) {
  const p = applyMatrix(m, b.x, b.y), q = applyMatrix(m, b.x + b.w, b.y + b.h);
  return { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(q.x - p.x), h: Math.abs(q.y - p.y) };
}

// ───────────────────────── arrangements ─────────────────────────

/** Arrangements as rows of panel indices (top → bottom; each row left → right). */
export const ARRANGEMENTS = {
  solo: { n: 1, rows: [[0]] },
  dual: { n: 2, rows: [[0, 1]] },
  triad: { n: 3, rows: [[0, 1, 2]] },
  stack2: { n: 2, rows: [[0], [1]] },
  stack3: { n: 3, rows: [[0], [1], [2]] },
  split3: { n: 3, rows: [[0, 1], [2]] }, // two side by side over one (9:16: two phones over a desktop)
  split3b: { n: 3, rows: [[0], [1, 2]] }, // one over two
};

/**
 * Place devices for one arrangement. items = [{id, frame: {x,y,w,h} device-local
 * frame rect (CSS px), labelH (output px under the device)}], in panel order.
 * area = output rect available. Each device's fit = its size alone in the area,
 * capped at `boost` × its equal-share size; the focus device keeps its full fit, the others `rho` of theirs (smaller, same
 * family). When that does not fit, the others give way first (down to `minRho`
 * of their fit: the focus device's size is the hierarchy), only then everything
 * shrinks together (λ). Rows stack centred with `gap`; devices centre in their
 * row; labels sit under each device. Returns Map id → T {x, y, k} (screen top-left, scale).
 */
export function arrange(arrangement, items, focus, area, { gap = 60, rho = 0.78, minRho = 0.5, boost = 1.6, maxK = Infinity } = {}) {
  const A = ARRANGEMENTS[arrangement];
  if (!A) throw new Error(`unknown arrangement "${arrangement}" (have: ${Object.keys(ARRANGEMENTS).join(', ')})`);
  if (items.length !== A.n) throw new Error(`arrangement "${arrangement}" shows ${A.n} panel(s), got ${items.length}`);
  const rows = A.rows, lh = (i) => items[i].labelH || 0;
  const alone = items.map((it, i) => Math.min(area.w / it.frame.w, (area.h - lh(i)) / it.frame.h, maxK, it.maxK ?? Infinity));
  const solo = items.length === 1;
  // the extents a row/column of devices needs at scales ks (fixed gaps/labels apart)
  const rowW = (r, ks) => r.reduce((s, i) => s + items[i].frame.w * ks[i], 0);
  const rowH = (r, ks) => Math.max(...r.map((i) => items[i].frame.h * ks[i] + lh(i)));
  const fits = (ks) => rows.every((r) => rowW(r, ks) + gap * (r.length - 1) <= area.w + 1e-6)
    && rows.reduce((s, r) => s + rowH(r, ks), 0) + gap * (rows.length - 1) <= area.h + 1e-6;
  const bisect = (ok) => { let lo = 0, hi = 1; for (let it = 0; it < 50; it++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; } return lo; };
  // a device's fit: its size alone in the area, but never more than `boost` × the size it has
  // when every device shares the arrangement equally (λ0): one huge focus must not starve the rest
  const lam0 = fits(alone) ? 1 : bisect((m) => fits(alone.map((k) => k * m)));
  const fit = alone.map((k) => (solo ? k : Math.min(k, k * lam0 * boost)));
  const ksOf = (mu, lam) => items.map((it, i) => fit[i] * (solo || it.id === focus ? 1 : rho * mu) * lam);
  let mu = 1;
  const muMin = Math.min(1, minRho / rho);
  if (!fits(ksOf(1, 1)) && !solo) {
    if (fits(ksOf(muMin, 1))) { let lo = muMin, hi = 1; for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (fits(ksOf(m, 1))) lo = m; else hi = m; } mu = lo; } else mu = muMin;
  }
  let lam = 1;
  if (!fits(ksOf(mu, 1))) lam = bisect((m) => fits(ksOf(mu, m)));
  if (!(lam > 1e-3)) throw new Error(`arrangement "${arrangement}" does not fit the area (${Math.round(area.w)}×${Math.round(area.h)} px): gaps/labels leave no room`);
  const ks = ksOf(mu, lam);
  const totalH = rows.reduce((s, r) => s + rowH(r, ks), 0) + gap * (rows.length - 1);
  let y = area.y + (area.h - totalH) / 2;
  const out = new Map();
  for (const r of rows) {
    const rh = rowH(r, ks);
    let x = area.x + area.w / 2 - (rowW(r, ks) + gap * (r.length - 1)) / 2;
    for (const i of r) {
      const it = items[i], k = ks[i], fw = it.frame.w * k, fh = it.frame.h * k;
      const fy = y + (rh - lh(i)) / 2 - fh / 2;
      // T = where the screen's top-left lands (the frame rect starts at it.frame.x/y, ≤ 0)
      out.set(it.id, { x: x - it.frame.x * k, y: fy - it.frame.y * k, k });
      x += fw + gap;
    }
    y += rh + gap;
  }
  return out;
}

/** Output rect of a device frame under T. */
export const frameOut = (T, fr) => ({ x: T.x + fr.x * T.k, y: T.y + fr.y * T.k, w: fr.w * T.k, h: fr.h * T.k });

// ───────────────────────── layout track ─────────────────────────

/**
 * Layout keyframes → a pure state(t): per panel {x, y, k (= T), alpha, focus (0..1)}.
 * keys = [{t, arrangement, focus, panels: [ids in order], dur}] (t strictly
 * increasing). Key 0 is the opening state (no transition). Key i > 0 starts its
 * transition at t and settles at t + dur (cubic in-out on the device centre,
 * log k, alpha and focus), starting from wherever the stage was at t, so an
 * interrupted transition continues without a jump. A panel absent from a key
 * fades out in place shrinking to 0.94 about its centre; an entering panel grows
 * from 0.94 at its new place. place(key) → Map id → T; frames: id → frame rect.
 */
export function layoutTrack(keys, ids, place, frames) {
  if (!keys.length) throw new Error('layout needs at least one keyframe');
  for (let i = 1; i < keys.length; i++) if (!(keys[i].t > keys[i - 1].t)) throw new Error(`layout keyframes must be strictly increasing in time (key ${i + 1} at ${keys[i].t.toFixed(3)}s ≤ key ${i} at ${keys[i - 1].t.toFixed(3)}s)`);
  // centre-based state (scale about the device centre), converted to T on the way out
  const toC = (id, T) => { const fr = frames[id]; return { cx: T.x + T.k * (fr.x + fr.w / 2), cy: T.y + T.k * (fr.y + fr.h / 2), k: T.k }; };
  const toT = (id, c) => { const fr = frames[id]; return { x: c.cx - c.k * (fr.x + fr.w / 2), y: c.cy - c.k * (fr.y + fr.h / 2), k: c.k, alpha: c.alpha, focus: c.focus }; };
  const placed = keys.map((k) => place(k));
  const targets = keys.map((k, i) => {
    const st = {};
    for (const id of ids) {
      const T = placed[i].get(id);
      if (T) { st[id] = { ...toC(id, T), alpha: 1, focus: id === k.focus ? 1 : 0 }; continue; }
      // absent: hold the nearest placement (earlier first, else later), invisible, at 0.94
      let ref = null;
      for (let j = i - 1; j >= 0 && !ref; j--) if (placed[j].get(id)) ref = toC(id, placed[j].get(id));
      for (let j = i + 1; j < keys.length && !ref; j++) if (placed[j].get(id)) ref = toC(id, placed[j].get(id));
      st[id] = ref ? { ...ref, k: ref.k * 0.94, alpha: 0, focus: 0 } : { cx: 0, cy: 0, k: 1, alpha: 0, focus: 0 };
    }
    return st;
  });
  const mix = (a, b, u) => {
    const o = {};
    for (const id of ids) {
      let p = a[id];
      const q = b[id];
      // a panel that was invisible appears at its destination (no fly-in from a stale place)
      if (p.alpha <= 1e-6 && q.alpha > 0) p = { ...q, k: q.k * 0.94, alpha: 0, focus: 0 };
      o[id] = { cx: lerp(p.cx, q.cx, u), cy: lerp(p.cy, q.cy, u), k: Math.exp(lerp(Math.log(p.k), Math.log(q.k), u)), alpha: lerp(p.alpha, q.alpha, u), focus: lerp(p.focus, q.focus, u) };
    }
    return o;
  };
  const ease = (i, t) => cubicInOut(clamp((t - keys[i].t) / (keys[i].dur || 1e-9)));
  const starts = [targets[0]];
  for (let i = 1; i < keys.length; i++) {
    const j = i - 1;
    starts.push(j === 0 || keys[i].t >= keys[j].t + (keys[j].dur || 0) ? targets[j] : mix(starts[j], targets[j], ease(j, keys[i].t)));
  }
  const out = (st) => { const o = {}; for (const id of ids) o[id] = toT(id, st[id]); return o; };
  const settled = targets.map(out);
  function state(t) {
    let i = 0;
    while (i + 1 < keys.length && t >= keys[i + 1].t) i++;
    if (i === 0 || t >= keys[i].t + (keys[i].dur || 0)) return settled[i];
    return out(mix(starts[i], targets[i], ease(i, t)));
  }
  /** Is the layout moving at t (a transition in progress)? */
  const moving = (t) => keys.some((k, i) => i > 0 && t >= k.t && t <= k.t + (k.dur || 0));
  return { state, moving, keys, settled };
}

// ───────────────────────── story clock ─────────────────────────

/** "HH:MM" → minutes since midnight (throws on anything else). */
export function parseClock(s) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(s));
  if (!m) throw new Error(`clock time "${s}" must be HH:MM (24 h)`);
  return +m[1] * 60 + +m[2];
}

/**
 * Story-clock keyframes [{t, time "HH:MM", roll}] → at(t) = {from, to, u} where
 * from/to are the displayed strings and u ∈ [0,1] the roll progress (u = 1:
 * settled on `to`). Keys must be strictly increasing in t and non-decreasing in
 * time (a story clock never runs backwards). A rolled key animates over `rollDur`
 * starting at its t; an unrolled key cuts on the frame boundary.
 */
export function clockTrack(keys, { rollDur = 0.6 } = {}) {
  if (!keys.length) throw new Error('clock needs at least one key');
  for (let i = 0; i < keys.length; i++) {
    parseClock(keys[i].time);
    if (i && !(keys[i].t > keys[i - 1].t)) throw new Error(`clock keys must be strictly increasing in film time (key ${i + 1} at ${keys[i].t.toFixed(3)}s)`);
    if (i && parseClock(keys[i].time) < parseClock(keys[i - 1].time)) throw new Error(`clock runs backwards: ${keys[i - 1].time} → ${keys[i].time} (story clocks are monotonic)`);
  }
  function at(t) {
    let i = 0;
    while (i + 1 < keys.length && t >= keys[i + 1].t) i++;
    const k = keys[i];
    if (i === 0 || !k.roll || t >= k.t + rollDur) return { from: k.time, to: k.time, u: 1 };
    return { from: keys[i - 1].time, to: k.time, u: clamp((t - k.t) / rollDur) };
  }
  return { at, keys, rollDur };
}

/**
 * Per-character roll of a clock string: each character that changes slides up
 * (old out, new in), staggered right → left so the minutes lead. Returns
 * [{from, to, u}] per character position (u eased; equal chars have u = 1).
 */
export function rollDigits(from, to, u, { stagger = 0.12 } = {}) {
  const n = Math.max(from.length, to.length), out = [];
  const changed = [];
  for (let i = 0; i < n; i++) if (from[i] !== to[i]) changed.push(i);
  for (let i = 0; i < n; i++) {
    const a = from[i] ?? '', b = to[i] ?? '';
    if (a === b) { out.push({ from: a, to: b, u: 1 }); continue; }
    const rank = changed.length - 1 - changed.indexOf(i); // rightmost first
    const span = 1 - stagger * (changed.length - 1);
    const v = clamp((u - rank * stagger) / Math.max(0.2, span));
    out.push({ from: a, to: b, u: cubicInOut(v) });
  }
  return out;
}

// ───────────────────────── connectors ─────────────────────────

/**
 * The point of box b (output px) facing point p: the midpoint of the side toward
 * it. Devices sit side by side in a row, so a point beyond the box horizontally
 * is met on the left/right side; only a point above/below the box's span (a
 * column) uses the top/bottom side.
 */
export function anchorToward(b, p) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  if (p.x > b.x + b.w) return { x: b.x + b.w, y: cy, side: 'right' };
  if (p.x < b.x) return { x: b.x, y: cy, side: 'left' };
  return p.y >= cy ? { x: cx, y: b.y + b.h, side: 'bottom' } : { x: cx, y: b.y, side: 'top' };
}

/**
 * Where a connector leaves a target ring b (output px) inside its device frame
 * `fr`, heading for point p: the side that gets OUT of the device soonest (the
 * shortest run over the UI), among sides that do not point away from p. Ties go
 * to the side facing p. Returns {x, y, side, exit} — exit = output px from the
 * ring edge to the device edge along that side's normal.
 */
export function exitToward(b, fr, p) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const dx = p.x - cx, dy = p.y - cy, dl = Math.hypot(dx, dy) || 1;
  const sides = [
    { side: 'left', n: [-1, 0], x: b.x, y: cy, exit: b.x - fr.x },
    { side: 'right', n: [1, 0], x: b.x + b.w, y: cy, exit: fr.x + fr.w - (b.x + b.w) },
    { side: 'top', n: [0, -1], x: cx, y: b.y, exit: b.y - fr.y },
    { side: 'bottom', n: [0, 1], x: cx, y: b.y + b.h, exit: fr.y + fr.h - (b.y + b.h) },
  ].map((s) => ({ ...s, dot: (s.n[0] * dx + s.n[1] * dy) / dl, exit: Math.max(0, s.exit) }));
  const ok = sides.filter((s) => s.dot > -0.25);
  ok.sort((a, b) => a.exit - b.exit + (b.dot - a.dot) * 40);
  const s = ok[0] || sides.sort((a, b) => b.dot - a.dot)[0];
  return { x: s.x, y: s.y, side: s.side, exit: s.exit };
}

/**
 * A calm arc from a to b (output px): a cubic Bézier that leaves each endpoint
 * along its side's outward normal (out past its device edge when `exit` is
 * given, + margin) and bows by `bow` of the chord. Returns
 * {pts (n+1 samples), len, at(u) → point at arc-length fraction u, mid}.
 */
export function arcPath(a, b, { bow = 0.18, n = 48, margin = 0, maxReach = Infinity } = {}) {
  const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nrm = (side) => (side === 'right' ? [1, 0] : side === 'left' ? [-1, 0] : side === 'bottom' ? [0, 1] : side === 'top' ? [0, -1] : [0, 0]);
  const [ax, ay] = nrm(a.side), [bx, by] = nrm(b.side);
  // each end reaches out along its side's normal at least past its device edge (a.exit) + margin
  const reach = Math.min(d * (0.28 + bow), maxReach);
  const ra = Math.max(reach, (a.exit ?? 0) + margin), rb = Math.max(reach, (b.exit ?? 0) + margin);
  const p1 = { x: a.x + ax * ra, y: a.y + ay * ra - (ax || ay ? 0 : d * bow) };
  const p2 = { x: b.x + bx * rb, y: b.y + by * rb - (bx || by ? 0 : d * bow) };
  const bez = (u) => {
    const v = 1 - u;
    return { x: v * v * v * a.x + 3 * v * v * u * p1.x + 3 * v * u * u * p2.x + u * u * u * b.x, y: v * v * v * a.y + 3 * v * v * u * p1.y + 3 * v * u * u * p2.y + u * u * u * b.y };
  };
  const pts = [], acc = [0];
  for (let i = 0; i <= n; i++) pts.push(bez(i / n));
  for (let i = 1; i <= n; i++) acc.push(acc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const len = acc[n];
  const at = (u) => {
    const L = clamp(u) * len;
    let i = 1;
    while (i < n && acc[i] < L) i++;
    const f = (L - acc[i - 1]) / ((acc[i] - acc[i - 1]) || 1);
    return { x: lerp(pts[i - 1].x, pts[i].x, f), y: lerp(pts[i - 1].y, pts[i].y, f), i };
  };
  return { pts, acc, len, at, mid: at(0.5), p1, p2 };
}

/**
 * Route a connector between two target rings (output px) on different devices:
 * try every pair of sides (left/right/top/bottom of each ring) and keep the arc
 * that stays on the stage (`bounds`) and runs least over device UI (all `frames`,
 * output rects) — a connector is
 * read against the ground, not across someone's screen — then the shortest.
 * Sides pointing away from the other end are not used. Pure; returns
 * {a, b, arc, overUi (output px of path over devices)}.
 */
export function routeConnector(ra, frA, rb, frB, frames, { bow = 0.16, margin = 36, maxReach = Infinity, bounds = null, sides: fixedSides = null } = {}) {
  const sides = (r, fr) => {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    return [
      { side: 'left', x: r.x, y: cy, exit: Math.max(0, r.x - fr.x) },
      { side: 'right', x: r.x + r.w, y: cy, exit: Math.max(0, fr.x + fr.w - r.x - r.w) },
      { side: 'top', x: cx, y: r.y, exit: Math.max(0, r.y - fr.y) },
      { side: 'bottom', x: cx, y: r.y + r.h, exit: Math.max(0, fr.y + fr.h - r.y - r.h) },
    ];
  };
  const inside = (p) => frames.some((f) => p.x > f.x && p.x < f.x + f.w && p.y > f.y && p.y < f.y + f.h);
  const ring = (p, r) => p.x >= r.x - 1 && p.x <= r.x + r.w + 1 && p.y >= r.y - 1 && p.y <= r.y + r.h + 1;
  let best = null;
  // fixedSides {a, b}: keep a route chosen earlier (no side flipping while the stage moves)
  for (const a of sides(ra, frA).filter((x) => !fixedSides || x.side === fixedSides.a)) for (const b of sides(rb, frB).filter((x) => !fixedSides || x.side === fixedSides.b)) {
    const arc = arcPath(a, b, { bow, margin, maxReach, n: 64 });
    let over = 0, out = 0;
    for (let i = 1; i < arc.pts.length; i++) {
      const p = arc.pts[i - 1], q = arc.pts[i], m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      if (inside(m) && !ring(m, ra) && !ring(m, rb)) over += Math.hypot(q.x - p.x, q.y - p.y);
      if (bounds && !(m.x >= bounds.x && m.x <= bounds.x + bounds.w && m.y >= bounds.y && m.y <= bounds.y + bounds.h)) out += Math.hypot(q.x - p.x, q.y - p.y);
    }
    // a run of `exit` px over the source/target device is unavoidable; everything else counts
    const cost = out * 50 + Math.max(0, over - a.exit - b.exit) * 4 + over + arc.len * 0.25;
    if (!best || cost < best.cost - 1e-9) best = { a, b, arc, overUi: over, offStage: out, cost };
  }
  return best;
}

/**
 * Where a w × h label sits on an arc: try arc-length fractions u (0.1–0.9) and
 * offsets across the arc (on it, or just above/below it), and keep the spot whose
 * label rect covers the least weighted obstacle area (obstacles [{x,y,w,h,weight}]:
 * e.g. the focus device 3, a dimmed device 1, the clock chip 6), nearest the middle
 * of the arc on ties. Pure; decide it once per connector, then hold it.
 * Returns {u, dy} (dy = vertical offset of the label centre from the arc point).
 */
export function labelSpot(arc, w, h, obstacles, { bounds = null } = {}) {
  const area = (r, o) => Math.max(0, Math.min(r.x + r.w, o.x + o.w) - Math.max(r.x, o.x)) * Math.max(0, Math.min(r.y + r.h, o.y + o.h) - Math.max(r.y, o.y));
  let best = null;
  for (let u = 0.1; u <= 0.901; u += 0.05) {
    for (const dy of [0, -h * 0.85, h * 0.85]) {
      const p = arc.at(u), r = { x: p.x - w / 2, y: p.y + dy - h / 2, w, h };
      let cost = obstacles.reduce((s, o) => s + area(r, o) * (o.weight ?? 1), 0) + Math.abs(u - 0.5) * w * h * 0.12 + (dy ? w * h * 0.05 : 0);
      if (bounds && (r.x < bounds.x || r.y < bounds.y || r.x + r.w > bounds.x + bounds.w || r.y + r.h > bounds.y + bounds.h)) cost += w * h * 100;
      if (!best || cost < best.cost - 1e-9) best = { u: +u.toFixed(2), dy, cost };
    }
  }
  return { u: best.u, dy: best.dy };
}

// ───────────────────────── legibility ─────────────────────────

/**
 * Body text size on screen (output px, normalised to a 1080-px short side) for a
 * panel shown at K output px per CSS px, given the capture's body text size in CSS px.
 */
export const textPx = (K, cssText, unit) => (K * cssText) / unit;

/** Rects overlap (strictly, with margin m). */
export const rectsOverlap = (a, b, m = 0) => a.x < b.x + b.w - m && b.x < a.x + a.w - m && a.y < b.y + b.h - m && b.y < a.y + a.h - m;
/** a inside b (± eps). */
export const rectInside = (a, b, eps = 0.5) => a.x >= b.x - eps && a.y >= b.y - eps && a.x + a.w <= b.x + b.w + eps && a.y + a.h <= b.y + b.h + eps;

export { frameRect };
