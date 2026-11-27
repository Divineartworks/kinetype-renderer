// STORM — dark churning clouds, rain, and lightning that splits the sky
// behind him (deterministic strikes early and late in the moment).
import { lattice, fbm, field, blit, ramp, rnd, glow, fract, sky, clamp } from './util.js';

const CLOUD = [[0, [6, 8, 14]], [0.45, [22, 28, 40]], [0.7, [52, 60, 78]], [1, [110, 118, 140]]];
function bolt(seed, k, W, H) {
  // midpoint-displaced bolt from the top to ~60% down, with a branch
  let pts = [[W * (0.3 + rnd(seed, 'bolt', k, 0) * 0.4), -10], [W * (0.25 + rnd(seed, 'bolt', k, 1) * 0.5), H * 0.62]];
  for (let it = 0; it < 6; it++) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      const off = (rnd(seed, 'boltd', k, it * 97 + i) - 0.5) * Math.hypot(x1 - x0, y1 - y0) * 0.45;
      out.push([(x0 + x1) / 2 + off, (y0 + y1) / 2]);
      out.push(pts[i]);
    }
    pts = out;
  }
  return pts;
}
const cache = new Map();
export default {
  id: 'storm',
  concepts: 'storm storms thunder lightning chaos chaotic crazy madness insane fight fighting battle war panic danger dangerous violent violence power powerful'.split(' '),
  draw(g, t, u, env) {
    const { W, H, seed } = env;
    sky(g, W, H, [[0, '#020308'], [1, '#0b0f18']]);
    // strikes: early (u≈0.12) and late (u≈0.62)
    const strike = Math.max(Math.exp(-Math.abs(u - 0.14) * 40), 0.8 * Math.exp(-Math.abs(u - 0.62) * 45));
    const tab = lattice(seed);
    const w = 80, h = Math.round(80 * H / W);
    const img = field(`storm:${w}x${h}`, w, h, (nx, ny) => {
      const n = fbm(tab, nx * 2.4 + t * 0.12, ny * 2.2 - t * 0.05, 5);
      const c = clamp((n - 0.35) * 1.8 * (1 - ny * 0.55) + strike * 0.45 * (1 - ny));
      return ramp(CLOUD, c);
    });
    blit(g, img, W, H);
    // rain
    g.save();
    g.strokeStyle = 'rgba(170,190,230,0.22)';
    g.lineWidth = Math.max(1, W / 900);
    g.beginPath();
    for (let i = 0; i < 180; i++) {
      const x = rnd(seed, 'rain', i, 0) * W * 1.2 - W * 0.1, y = fract(rnd(seed, 'rain', i, 1) + t * (1.6 + rnd(seed, 'rain', i, 2))) * H * 1.1 - H * 0.05;
      const L = H * 0.05;
      g.moveTo(x, y); g.lineTo(x - L * 0.18, y + L);
    }
    g.stroke();
    g.restore();
    if (strike > 0.03) {
      const k = u < 0.4 ? 0 : 1;
      const key = `${seed}:${k}:${W}x${H}`;
      let pts = cache.get(key);
      if (!pts) { pts = bolt(seed, k, W, H); cache.set(key, pts); }
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = `rgba(170,200,255,${0.9 * strike})`;
      g.lineJoin = 'round';
      for (const [lw, a] of [[18, 0.12], [7, 0.35], [2.2, 1]]) {
        g.globalAlpha = (env.alpha ?? 1) * a;
        g.lineWidth = lw * W / 1080;
        g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
      }
      g.restore();
      glow(g, pts[0][0], H * 0.1, W * 0.9, [150, 175, 255], 0.35 * strike);
    }
  },
};
