// Scalar helpers. Everything in the kit is a pure function of its arguments.
export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, x) => (a === b ? 0 : (x - a) / (b - a));
export const remap = (x, a0, a1, b0, b1, doClamp = true) => {
  const t = invLerp(a0, a1, x);
  return lerp(b0, b1, doClamp ? clamp(t) : t);
};
export const fract = (x) => x - Math.floor(x);
export const mod = (x, m) => ((x % m) + m) % m;
export const smoothstep = (a, b, x) => {
  const t = clamp(invLerp(a, b, x));
  return t * t * (3 - 2 * t);
};
/** 1 inside [t0, t1), else 0. */
export const within = (t, t0, t1) => t >= t0 && t < t1;
/** Linear window progress 0→1 across [t0, t1], clamped. */
export const prog = (t, t0, t1) => clamp(invLerp(t0, t1, t));
/** Round to a grid step (e.g. snap a baseline to an 8px grid). */
export const snap = (x, step) => Math.round(x / step) * step;
/**
 * Quantise time to the frame it belongs to (trailing-shutter convention), so
 * discrete state (scramble glyphs, typed characters, timecodes) is identical
 * across all motion-blur sub-samples of one frame — no double exposures.
 */
export const frameQuant = (t, fps) => Math.ceil(t * fps - 1e-6) / fps;
