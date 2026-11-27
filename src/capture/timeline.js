// Pure helpers: frame clock, seeded jitter, typing schedule, scroll easing, frame-hole resampling.
// Nothing here touches the browser, so all of it is unit-tested.

/** mulberry32 — tiny seeded rng; the only randomness a capture may use. */
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const frameOf = (seconds, fps) => Math.round(seconds * fps);
export const secondsOf = (frame, fps) => +(frame / fps).toFixed(6);

/**
 * Per-character offsets (in frames from the start) for typing `text` at `cps` characters/second.
 * Deterministic jitter (±25 %), a slightly longer beat after spaces and punctuation, and every
 * character lands on a distinct frame so the film shows each keystroke.
 */
export function typingSchedule(text, { cps = 14, fps = 30, seed = 1 } = {}) {
  const r = rng(seed);
  const chars = [...text];
  const out = [];
  let t = 0;
  let prev = -1;
  for (const [i, ch] of chars.entries()) {
    let dt = (1 / cps) * (0.75 + 0.5 * r());
    if (i > 0 && /[\s,.;:!?]/.test(chars[i - 1])) dt *= 1.35;
    t += dt;
    let f = Math.max(0, Math.round(t * fps));
    if (f <= prev) f = prev + 1;
    prev = f;
    out.push({ ch, frame: f });
  }
  return out;
}

/** easeInOutCubic */
export const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - ((-2 * u + 2) ** 3) / 2);

/** Integer wheel deltas, one per frame, that sum to exactly `total` along an ease-in-out curve. */
export function scrollSteps(total, frames) {
  const n = Math.max(1, frames);
  const out = [];
  let done = 0;
  for (let i = 1; i <= n; i++) {
    const target = Math.round(total * ease(i / n));
    out.push(target - done);
    done = target;
  }
  return out;
}

/** Points along a pointer path (ease-in-out), one per frame, ending exactly on `to`. */
export function pointerPath(from, to, frames) {
  const n = Math.max(1, frames);
  const pts = [];
  for (let i = 1; i <= n; i++) {
    const u = ease(i / n);
    pts.push({ x: +(from.x + (to.x - from.x) * u).toFixed(2), y: +(from.y + (to.y - from.y) * u).toFixed(2) });
  }
  return pts;
}

/** Travel time (seconds) for a pointer move of `dist` css px: quick but readable. */
export const travelSeconds = (dist) => Math.min(0.9, Math.max(0.25, 0.25 + dist / 1800));

/**
 * Resample timestamped shots to a constant frame rate.
 * shots: [{t: seconds, id}] sorted by t; returns, for each output frame i (t=i/fps), the id of the
 * latest shot at or before that time (the first shot is held backwards). Used when a source can only
 * deliver frames at irregular times; `holes` counts output frames that reused an older shot.
 */
export function resample(shots, fps, duration) {
  const count = Math.max(1, Math.round(duration * fps));
  const frames = [];
  let k = 0;
  let holes = 0;
  let lastUsed = -1;
  for (let i = 0; i < count; i++) {
    const t = i / fps;
    while (k + 1 < shots.length && shots[k + 1].t <= t + 1e-9) k++;
    if (k === lastUsed) holes++;
    lastUsed = k;
    frames.push(shots[k].id);
  }
  return { frames, holes, count };
}

/**
 * Frame store policy: a tick may deliver no fresh pixels (nothing damaged). The previous frame is
 * repeated — identical pixels are the truth — and counted as `unchanged`, not as dropped.
 */
export function fillFrames(shots) {
  let last = null;
  let unchanged = 0;
  const out = shots.map((s) => {
    if (s) { last = s; return s; }
    if (last) unchanged++;
    return last;
  });
  return { frames: out, unchanged, leading: out.findIndex((x) => x !== null) };
}

export function stats(values) {
  if (!values.length) return { n: 0, median: 0, p95: 0, max: 0 };
  const v = [...values].sort((a, b) => a - b);
  const q = (p) => v[Math.min(v.length - 1, Math.floor(v.length * p))];
  return { n: v.length, median: q(0.5), p95: q(0.95), max: v[v.length - 1] };
}
