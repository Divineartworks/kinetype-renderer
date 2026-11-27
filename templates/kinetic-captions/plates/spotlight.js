// SPOTLIGHT — the room goes black and a single stage beam falls on him,
// dust turning in the light, a pool on the floor.
import { rnd, glow, fract, sky, lattice, fbm, field, blit } from './util.js';

export default {
  id: 'spotlight',
  concepts: 'stage spotlight attention fame famous respect self-respect confidence confident power king kings queen legacy approval validation pride proud status ego alpha leader leadership boss champion greatness great'.split(' '),
  draw(g, t, u, { W, H, seed }) {
    sky(g, W, H, [[0, '#010101'], [1, '#050403']]);
    const cx = W * 0.5;
    // haze: faint noise so the beam has something to light
    const tab = lattice(seed);
    const w = 48, h = Math.round(48 * H / W);
    const img = field(`spot:${w}x${h}`, w, h, (nx, ny) => {
      const n = fbm(tab, nx * 3 + t * 0.05, ny * 3 - t * 0.03, 3);
      const inBeam = Math.max(0, 1 - Math.abs(nx - 0.5) / (0.12 + ny * 0.32));
      const v = (8 + n * 28) * (0.25 + inBeam * 1.6);
      return [v * 1.05, v, v * 0.92];
    });
    blit(g, img, W, H);
    // the beam
    g.save(); g.globalCompositeOperation = 'lighter';
    const flick = 0.92 + 0.08 * Math.sin(t * 7.3) * Math.sin(t * 3.1);
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, `rgba(255,240,215,${0.42 * flick})`);
    gr.addColorStop(0.7, `rgba(255,235,205,${0.14 * flick})`);
    gr.addColorStop(1, 'rgba(255,235,205,0)');
    g.fillStyle = gr;
    g.filter = `blur(${Math.round(18 * W / 1080)}px)`;
    g.beginPath(); g.moveTo(cx - W * 0.07, -10); g.lineTo(cx + W * 0.07, -10); g.lineTo(cx + W * 0.42, H); g.lineTo(cx - W * 0.42, H); g.closePath(); g.fill();
    g.filter = 'none';
    glow(g, cx, H * 0.97, W * 0.5, [255, 235, 200], 0.28);
    glow(g, cx, 0, W * 0.2, [255, 250, 235], 0.7);
    // dust in the beam
    for (let i = 0; i < 110; i++) {
      const ny = fract(rnd(seed, 'dust', i, 0) + t * 0.015 * (rnd(seed, 'dust', i, 1) - 0.4));
      const spread = 0.07 + ny * 0.35;
      const nx = 0.5 + (rnd(seed, 'dust', i, 2) - 0.5) * 2 * spread * 0.9 + Math.sin(t * 0.5 + i) * 0.01;
      glow(g, nx * W, ny * H, (2 + rnd(seed, 'dust', i, 3) * 4) * W / 1080, [255, 245, 225], 0.55);
    }
    g.restore();
  },
};
