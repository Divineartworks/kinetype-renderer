// VOID — deep space: a slow nebula in the look's colours and a star field
// warping toward the viewer, as if the room fell away into the universe.
import { rnd, glow, fract, sky, hex } from './util.js';

export default {
  id: 'void',
  concepts: 'space universe void nothing nothingness lost dream dreams stars star infinite infinity soul god meaning life death die dead dying spiritual spirit heaven existence exist purpose'.split(' '),
  draw(g, t, u, { W, H, seed, P }) {
    sky(g, W, H, [[0, '#000003'], [1, '#04020b']]);
    const a = hex(P.a || '#ff2e8b'), b = hex(P.b || '#34e4ff');
    glow(g, W * (0.3 + Math.sin(t * 0.07) * 0.05), H * 0.28, H * 0.55, b, 0.22);
    glow(g, W * (0.75 + Math.cos(t * 0.06) * 0.05), H * 0.5, H * 0.5, a, 0.16);
    glow(g, W * 0.5, H * 0.18, H * 0.35, [120, 80, 200], 0.18);
    const cx = W * 0.5, cy = H * 0.32;
    g.save(); g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 320; i++) {
      const z = fract(rnd(seed, 'star', i, 0) - t * (0.05 + 0.1 * u));
      const zz = 0.04 + z;
      const x = cx + (rnd(seed, 'star', i, 1) - 0.5) * W * 0.9 / zz * 0.12, y = cy + (rnd(seed, 'star', i, 2) - 0.5) * H * 0.9 / zz * 0.12;
      if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
      const r = Math.min(6, 0.5 / zz) * W / 1080;
      const br = Math.min(1, 0.25 / zz);
      glow(g, x, y, r * 3, [200, 220, 255], 0.35 * br);
      g.fillStyle = `rgba(255,255,255,${0.8 * br})`;
      g.fillRect(x - r * 0.4, y - r * 0.4, r * 0.8, r * 0.8);
    }
    g.restore();
  },
};
