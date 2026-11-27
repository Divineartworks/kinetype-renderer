// Choreographer: the human tempo of a native device recording, as pure, seeded schedules.
//
// The LLM never performs on camera. A flow is authored, rehearsed, then replayed by a driver whose every
// timing comes from here: deterministic for a (flow, seed) pair, so two performances differ only by the
// device's own latency. Preset "demo-artist" encodes the LIVE_COMMON pace standards: a confident operator
// who has done this flow a thousand times — no hesitation, no missed target, no re-try.
import { rng } from '../capture/timeline.js';

export const TEMPO = {
  'demo-artist': {
    approach: [0.35, 0.45],     // s between the previous beat settling and the finger landing (the travel the
                                //   post-drawn finger shows; ease-out)
    press: [0.060, 0.090],      // finger down → up
    typing: [0.040, 0.080],     // s per character, seeded jitter
    afterSpace: 1.2,            //   a word boundary breathes a little
    typingCap: 1.0,             // a field never takes longer than this on screen (compressed, floor below)
    typingFloor: 0.030,
    keyboardWait: 0.30,         // after a tap on a field: the keyboard slides in before the first key
    settle: { quiet: 0.12, max: 2.5 },   // "nothing moves" for quiet s ends a step; max = never longer on camera
    hold: [0.6, 1.2],           // payoff marks
    fling: { duration: [0.10, 0.14], hz: 120, velocity: 3200 },   // video px/s at release
    swipe: { duration: [0.40, 0.55], hz: 120, rest: 0.06 },        // a controlled drag that stops before lifting
    comfort: [0.25, 0.62],      // a target is "in reach" when its centre sits in this band of the viewport height
    jitter: 0.12,               // tap point: ±12 % of the box around the centre, clamped to the inner 60 %
    flingTau: 0.33,             // stand-in momentum (s); a real device uses its own physics
  },
  // For machine checks of the pipeline: fast, still human-shaped.
  brisk: {
    approach: [0.18, 0.22], press: [0.05, 0.06], typing: [0.03, 0.04], afterSpace: 1.1, typingCap: 0.8, typingFloor: 0.02,
    keyboardWait: 0.2, settle: { quiet: 0.1, max: 2 }, hold: [0.3, 0.4], fling: { duration: [0.1, 0.12], hz: 120, velocity: 3200 },
    swipe: { duration: [0.3, 0.35], hz: 120, rest: 0.05 }, comfort: [0.25, 0.62], jitter: 0.08, flingTau: 0.33,
  },
};

/** Resolved tempo: preset + flow-level overrides + step-level overrides (shallow per key). */
export function tempoFor(flowTempo = {}, stepTempo = {}) {
  const preset = TEMPO[stepTempo.preset || flowTempo.preset || 'demo-artist'];
  if (!preset) throw new Error(`unknown tempo preset "${stepTempo.preset || flowTempo.preset}" (have: ${Object.keys(TEMPO).join(', ')})`);
  const strip = ({ preset: _p, ...o }) => o;
  return { ...preset, ...strip(flowTempo), ...strip(stepTempo) };
}

const pick = (r, [a, b]) => a + (b - a) * r();
const r4 = (n) => Math.round(n * 10000) / 10000;

/** A per-step rng: the same flow + seed always yields the same performance, whatever ran before. */
export function stepRng(seed, stepId) {
  let h = 2166136261 ^ (seed >>> 0);
  for (const c of String(stepId)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return rng(h >>> 0);
}

/** Tap: approach time, press duration and the landing point inside the box (video px). */
export function tapPlan(vbox, tempo, r) {
  const j = tempo.jitter;
  const off = (n) => Math.max(-0.3, Math.min(0.3, (r() * 2 - 1) * j)) * n;
  return {
    approach: r4(pick(r, tempo.approach)),
    press: r4(pick(r, tempo.press)),
    point: { x: Math.round(vbox.x + vbox.w / 2 + off(vbox.w)), y: Math.round(vbox.y + vbox.h / 2 + off(vbox.h)) },
  };
}

/** Typing: offsets (s from the first key) per character; a field fits typingCap (compressed down to the floor). */
export function typingPlan(text, tempo, r) {
  const chars = [...text];
  const gaps = chars.map((_, i) => {
    let g = pick(r, tempo.typing);
    if (i > 0 && /[\s,.;:!?]/.test(chars[i - 1])) g *= tempo.afterSpace;
    return g;
  });
  gaps[0] = 0;
  const total = gaps.reduce((a, b) => a + b, 0);
  let k = 1;
  if (total > tempo.typingCap) k = Math.max(tempo.typingCap / total, tempo.typingFloor / (total / Math.max(1, chars.length - 1)));
  let t = 0;
  const keys = chars.map((ch, i) => { t += gaps[i] * k; return { ch, at: r4(t) }; });
  return { keys, duration: r4(t), compressed: k < 1 ? r4(k) : null, overCap: t > tempo.typingCap + 1e-9 };
}

/**
 * Drag path (video px) sampled at `hz`: a fling accelerates and lifts at full speed (the OS turns the release
 * velocity into momentum); a swipe eases in and out and rests before lifting (no momentum, lands where asked).
 * Returns [{x, y, t}] with t in s from touch-down; the last sample is the lift point.
 */
export function dragPath(from, to, { kind = 'swipe', tempo, r, duration, velocity } = {}) {
  const spec = kind === 'fling' ? tempo.fling : tempo.swipe;
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  let T = duration ?? pick(r, spec.duration);
  // a fling with a release velocity: ease-in u² ends at speed 2·dist/T, so T = 2·dist/v
  if (kind === 'fling' && velocity) T = Math.max(0.06, Math.min(0.3, (2 * dist) / velocity));
  const n = Math.max(3, Math.round(T * spec.hz));
  const ease = kind === 'fling' ? (u) => u * u : (u) => (u < 0.5 ? 4 * u * u * u : 1 - ((-2 * u + 2) ** 3) / 2);
  // tiny, seeded lateral drift: a thumb never moves on a ruler-straight line
  const drift = (r() * 2 - 1) * Math.min(14, dist * 0.04);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, e = ease(u);
    const bow = Math.sin(Math.PI * u) * drift;
    const nx = dist ? -(to.y - from.y) / dist : 0, ny = dist ? (to.x - from.x) / dist : 0;
    pts.push({ x: Math.round(from.x + (to.x - from.x) * e + nx * bow), y: Math.round(from.y + (to.y - from.y) * e + ny * bow), t: r4(T * u) });
  }
  if (kind === 'swipe') pts.push({ ...pts[pts.length - 1], t: r4(T + spec.rest) });
  return { points: pts, duration: pts[pts.length - 1].t, releaseVelocity: kind === 'fling' ? r4((2 * dist) / T) : 0 };
}

/**
 * Plan the gestures that bring a target (CSS box, viewport height vh) into the comfort band — how a person
 * scrolls: one fling when it is far (model distance = gain·v, learned in rehearsal), then — only if it did not
 * land in the band — a calm swipe for the rest; a single swipe when it is near. Returns [{kind, dyCss}] where dyCss > 0 moves content UP (finger up).
 */
export function reachPlan(box, vh, tempo, { flingGain = tempo.flingTau, calibrated = false, maxSwipe = 0.7, scrollMax = Infinity } = {}) {
  const [lo, hi] = tempo.comfort;
  const c = box.y + box.h / 2;
  if (c >= lo * vh && c <= hi * vh) return [];
  let need = c - ((lo + hi) / 2) * vh;
  if (need > 0) need = Math.min(need, scrollMax);
  const plan = [];
  const swipeMax = maxSwipe * vh;
  if (Math.abs(need) > swipeMax) {
    // with a fling gain measured in rehearsal, aim at the band centre (one confident fling); untested, undershoot
    // and finish with a calm swipe (overshooting and coming back reads as a miss)
    const aim = calibrated ? 1 : 0.85;
    plan.push({ kind: 'fling', dyCss: need * aim, gain: flingGain });
    need *= 1 - aim;
  }
  while (Math.abs(need) > 4) {
    const d = Math.sign(need) * Math.min(Math.abs(need), swipeMax);
    plan.push({ kind: 'swipe', dyCss: d });
    need -= d;
  }
  return plan;
}

/** Hold for a step: explicit hold wins; marks get the payoff hold; everything else a short beat. */
export function holdFor(step, tempo, r) {
  if (step.hold !== undefined) return step.hold;
  if (step.action === 'mark') return r4(pick(r, tempo.hold));
  return 0;
}
