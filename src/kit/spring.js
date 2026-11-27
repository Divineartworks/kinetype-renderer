// Closed-form springs.
//
// A spring here is the step response of a damped harmonic oscillator that
// starts at rest: x(0)=0, x'(0)=0, target 1. Because that system is linear, a
// property that retargets many times is EXACTLY the sum of one step response
// per retarget (superposition). So a Track is a pure function of time: no
// integration, no frame-to-frame state, identical at any seek order.
//
// Parameters are perceptual: f = natural frequency in Hz (how fast), z =
// damping ratio (z<1 overshoots once or more, z=1 critically damped, z>1 slow).

const SETTLE_EPS = 1e-5;

/** Step response in [0, ~1+overshoot]; exactly 1 once the envelope is below 1e-5. */
export function springStep(t, f = 2, z = 0.6) {
  if (t <= 0) return 0;
  const w = 2 * Math.PI * f;
  // Past the settle point the residual is < 1e-5 of the move; clamp to the
  // exact target so holds are pixel-identical (loop seams depend on this).
  if (z * w * t > -Math.log(SETTLE_EPS) + 2) return 1;
  if (Math.abs(z - 1) < 1e-6) return 1 - Math.exp(-w * t) * (1 + w * t);
  if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
  }
  const s = Math.sqrt(z * z - 1);
  const r1 = -w * (z - s), r2 = -w * (z + s);
  return 1 + (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r1 - r2);
}

/** Seconds until a spring is within 1e-5 of its target (upper bound). */
export function springSettle(f = 2, z = 0.6) {
  const w = 2 * Math.PI * f;
  return (-Math.log(SETTLE_EPS) + 2) / (Math.min(z, 1) * w);
}

/**
 * Named feels. Tuned against poster-type motion at 60fps:
 *  slam   one crisp overshoot (~12%), settles < 0.45s — the "hit"
 *  snap   quick, tiny overshoot (~2%) — scramble locks, UI snaps
 *  lock   critically damped, fast — things that must land dead still
 *  glide  critically damped, slow — camera push, breath
 *  whip   very fast, slight overshoot — smash pans
 *  heavy  slow with weight — big blocks, brand bars
 */
export const SPRINGS = {
  slam: { f: 2.4, z: 0.55 },
  snap: { f: 4.2, z: 0.78 },
  lock: { f: 3.6, z: 1 },
  glide: { f: 0.9, z: 1 },
  whip: { f: 5.5, z: 0.72 },
  heavy: { f: 1.5, z: 0.62 },
  pop: { f: 3.2, z: 0.45 },
};

function resolveSpring(s) {
  if (!s) return SPRINGS.snap;
  if (typeof s === 'string') {
    const r = SPRINGS[s];
    if (!r) throw new Error(`unknown spring "${s}"`);
    return r;
  }
  return s;
}

/**
 * A property over time, built from stacked retargets.
 *   const y = track(400).spring(0.0, 0, 'slam').spring(2.5, -900, 'whip');
 *   y.at(t)
 * Kinds of retarget:
 *   spring(t0, value, feel)     closed-form spring toward value
 *   ease(t0, dur, value, fn)    eased tween toward value over dur
 *   cut(t0, value)              instantaneous jump at t0 (inclusive)
 * Each retarget moves from the PREVIOUS retarget's value, so the sum is exact.
 */
export class Track {
  constructor(initial = 0) {
    this.v0 = initial;
    this.steps = [];
  }
  get last() {
    return this.steps.length ? this.steps[this.steps.length - 1].v : this.v0;
  }
  spring(t0, v, feel) {
    const s = resolveSpring(feel);
    this.steps.push({ kind: 's', t0, v, d: v - this.last, f: s.f, z: s.z });
    return this;
  }
  ease(t0, dur, v, fn) {
    this.steps.push({ kind: 'e', t0, dur: Math.max(1e-6, dur), v, d: v - this.last, fn: fn || ((x) => x) });
    return this;
  }
  cut(t0, v) {
    this.steps.push({ kind: 'c', t0, v, d: v - this.last });
    return this;
  }
  at(t) {
    let x = this.v0;
    for (const s of this.steps) {
      if (t <= s.t0 && s.kind !== 'c') continue;
      if (s.kind === 's') x += s.d * springStep(t - s.t0, s.f, s.z);
      else if (s.kind === 'e') {
        const u = (t - s.t0) / s.dur;
        x += s.d * (u >= 1 ? 1 : s.fn(u));
      } else if (t >= s.t0) x += s.d;
    }
    return x;
  }
  /** Times at which this track starts moving (for beat-coverage QA). */
  get times() {
    return this.steps.map((s) => s.t0);
  }
}
export const track = (v) => new Track(v);

/** One-shot spring from a to b triggered at t0. */
export function spring(t, t0, a, b, feel) {
  const s = resolveSpring(feel);
  return a + (b - a) * springStep(t - t0, s.f, s.z);
}
