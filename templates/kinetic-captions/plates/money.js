// MONEY — warm gold light pours in from above, coins tumble through it,
// gold dust hangs in the air.
import { rnd, glow, fract, sky } from './util.js';

export default {
  id: 'money',
  concepts: 'money cash rich richer wealth wealthy gold dollar dollars paid pay payment finances financial finance success successful win winning invest investment million millions bank business profit worth value expensive'.split(' '),
  draw(g, t, u, env) {
    const { W, H, seed } = env;
    sky(g, W, H, [[0, '#120900'], [0.6, '#1d1002'], [1, '#2b1904']]);
    // god rays
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const x = W * (0.2 + i * 0.15 + Math.sin(t * 0.3 + i) * 0.02), wdt = W * (0.08 + rnd(seed, 'ray', i, 0) * 0.08);
      const gr = g.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, `rgba(255,200,90,${0.16 + 0.06 * Math.sin(t + i)})`);
      gr.addColorStop(1, 'rgba(255,200,90,0)');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(x - wdt * 0.3, 0); g.lineTo(x + wdt * 0.3, 0); g.lineTo(x + wdt * 1.6, H); g.lineTo(x - wdt * 1.6, H); g.closePath(); g.fill();
    }
    g.restore();
    // coins
    for (let i = 0; i < 46; i++) {
      const depth = 0.4 + rnd(seed, 'coin', i, 0) * 0.9;
      const x = rnd(seed, 'coin', i, 1) * W, y = (fract(rnd(seed, 'coin', i, 2) + t * 0.22 * depth) * 1.2 - 0.1) * H;
      const r = 26 * depth * W / 1080, spin = t * (2 + rnd(seed, 'coin', i, 3) * 4) + i;
      const sx = Math.abs(Math.cos(spin)) * r + 1.5;
      g.save();
      g.translate(x, y); g.rotate(rnd(seed, 'coin', i, 4) * Math.PI);
      const gr = g.createLinearGradient(-sx, -r, sx, r);
      gr.addColorStop(0, '#fff1b8'); gr.addColorStop(0.45, '#f2b53a'); gr.addColorStop(1, '#8a5a10');
      g.globalAlpha = (env.alpha ?? 1) * (0.55 + 0.45 * depth / 1.3);
      g.fillStyle = gr;
      g.beginPath(); g.ellipse(0, 0, sx, r, 0, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    // dust
    g.save(); g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 50; i++) {
      const x = (rnd(seed, 'du', i, 0) + Math.sin(t * 0.4 + i) * 0.01) * W, y = fract(rnd(seed, 'du', i, 1) - t * 0.02) * H;
      glow(g, x, y, (6 + rnd(seed, 'du', i, 2) * 14) * W / 1080, [255, 205, 110], 0.35);
    }
    g.restore();
  },
};
