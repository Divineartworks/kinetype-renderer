// RAIN — alone at night: cold blue, blurred city lights through wet glass,
// rain streaks and a low fog.
import { rnd, glow, fract, sky, hex } from './util.js';

export default {
  id: 'rain',
  concepts: 'rain raining alone lonely loneliness sad sadness cry crying tears depression depressed empty cold miss missing grief lost pain hurt hurts suffering suffer anxiety'.split(' '),
  draw(g, t, u, { W, H, seed, P }) {
    sky(g, W, H, [[0, '#03060c'], [0.6, '#0a1624'], [1, '#101e2e']]);
    const tints = [[90, 140, 210], [60, 110, 180], [150, 175, 215], hex(P.b || '#6fa8ff')];
    for (let i = 0; i < 22; i++) {
      const x = rnd(seed, 'bk', i, 0) * W, y = (0.15 + rnd(seed, 'bk', i, 1) * 0.75) * H;
      const r = (0.04 + rnd(seed, 'bk', i, 2) * 0.09) * W * (1 + 0.1 * Math.sin(t * 0.7 + i));
      glow(g, x + Math.sin(t * 0.2 + i) * 6, y, r, tints[i % tints.length], 0.18 + rnd(seed, 'bk', i, 3) * 0.18);
    }
    // streaks
    g.save();
    g.lineWidth = Math.max(1, W / 700);
    for (let layer = 0; layer < 2; layer++) {
      g.strokeStyle = layer ? 'rgba(200,220,255,0.28)' : 'rgba(160,190,230,0.14)';
      g.beginPath();
      for (let i = 0; i < 160; i++) {
        const x = rnd(seed, 'st' + layer, i, 0) * W, y = fract(rnd(seed, 'st' + layer, i, 1) + t * (layer ? 1.4 : 0.9)) * H * 1.1 - H * 0.05;
        const L = H * (layer ? 0.07 : 0.035);
        g.moveTo(x, y); g.lineTo(x - L * 0.08, y + L);
      }
      g.stroke();
    }
    g.restore();
    const fog = g.createLinearGradient(0, H * 0.6, 0, H);
    fog.addColorStop(0, 'rgba(120,150,190,0)');
    fog.addColorStop(1, `rgba(120,150,190,${0.18 + 0.05 * u})`);
    g.fillStyle = fog; g.fillRect(0, H * 0.6, W, H * 0.4);
  },
};
