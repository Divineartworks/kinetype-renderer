// Easing curves. Deliberately no bounce/elastic presets: overshoot comes from
// springs with an honest damping ratio, never from cartoon curves.
import { clamp } from './math.js';

export const linear = (t) => t;
export const quadOut = (t) => 1 - (1 - t) * (1 - t);
export const cubicOut = (t) => 1 - Math.pow(1 - t, 3);
export const quartOut = (t) => 1 - Math.pow(1 - t, 4);
export const quintOut = (t) => 1 - Math.pow(1 - t, 5);
export const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const expoIn = (t) => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10));
export const cubicIn = (t) => t * t * t;
export const quintIn = (t) => t * t * t * t * t;
export const cubicInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const quintInOut = (t) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2);
export const expoInOut = (t) =>
  t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2;
export const sineInOut = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

/** CSS-style cubic-bezier(x1,y1,x2,y2) solved with Newton + bisection. */
export function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (u) => ((ax * u + bx) * u + cx) * u;
  const sy = (u) => ((ay * u + by) * u + cy) * u;
  const dx = (u) => (3 * ax * u + 2 * bx) * u + cx;
  return (x) => {
    x = clamp(x);
    let u = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(u) - x;
      if (Math.abs(e) < 1e-7) return sy(u);
      const d = dx(u);
      if (Math.abs(d) < 1e-7) break;
      u -= e / d;
    }
    let lo = 0, hi = 1;
    u = x;
    for (let i = 0; i < 40; i++) {
      const v = sx(u);
      if (Math.abs(v - x) < 1e-7) break;
      if (v < x) lo = u; else hi = u;
      u = (lo + hi) / 2;
    }
    return sy(u);
  };
}

/** The motion-designer's "hard ease": fast attack, long luxurious tail. */
export const poster = bezier(0.16, 1, 0.3, 1);
/** Anticipation-free whip used for smash pans. */
export const whip = bezier(0.7, 0, 0.13, 1);

export const EASES = {
  linear, quadOut, cubicOut, quartOut, quintOut, expoOut, expoIn, cubicIn, quintIn,
  cubicInOut, quintInOut, expoInOut, sineInOut, poster, whip,
};
export function easeByName(name) {
  const f = EASES[name];
  if (!f) throw new Error(`unknown ease "${name}"`);
  return f;
}
