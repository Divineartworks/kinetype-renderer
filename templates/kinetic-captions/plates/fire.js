// FIRE — the room goes up in flames behind him: a rising noise-driven fire
// field (soft, out of focus), embers drifting up, heat at the bottom.
import { lattice, fbm, field, blit, ramp, rnd, glow, fract, sky } from './util.js';

const RAMP = [[0, [4, 1, 0]], [0.28, [58, 4, 0]], [0.46, [150, 22, 0]], [0.62, [236, 92, 8]], [0.78, [255, 170, 48]], [0.92, [255, 232, 170]], [1, [255, 250, 230]]];
export default {
  id: 'fire',
  concepts: 'fire fires burn burning burned burnt flame flames hell rage angry anger furious heat hot devastate devastated devastation destroy destroyed destruction war explode explosion ashes blaze inferno'.split(' '),
  draw(g, t, u, { W, H, seed }) {
    sky(g, W, H, [[0, '#050100'], [1, '#1a0500']]);
    const w = 90, h = Math.round(90 * H / W);
    const tab = lattice(seed);
    const img = field(`fire:${w}x${h}`, w, h, (nx, ny) => {
      const rise = t * 0.9;
      const n = fbm(tab, nx * 3.6 + 7, ny * 2.6 + rise, 4);
      const n2 = fbm(tab, nx * 8.5 + 31, ny * 6 + rise * 1.8, 3);
      // the fire burns hottest around the head and shoulders — the part of the
      // background a close-up actually shows — so he is rimmed in flame;
      // it never burns out to white where captions sit
      const base = 0.5 + 0.35 * ny;
      const halo = 0.3 * Math.exp(-((nx - 0.5) ** 2 * 5 + (ny - 0.3) ** 2 * 4));
      const heat = Math.max(0, Math.min(0.84, (base + halo + (n - 0.5) * 1.25 + (n2 - 0.5) * 0.45 - 0.22) * (0.85 + 0.15 * u)));
      return ramp(RAMP, heat);
    });
    blit(g, img, W, H);
    // embers
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 70; i++) {
      const sp = 0.12 + rnd(seed, 'ember', i, 0) * 0.25;
      const y = (1 - fract(rnd(seed, 'ember', i, 1) + t * sp)) * H;
      const x = (rnd(seed, 'ember', i, 2) + Math.sin(t * (0.8 + rnd(seed, 'ember', i, 3)) + i) * 0.03) * W;
      const r = (2 + rnd(seed, 'ember', i, 4) * 5) * W / 1080;
      const life = y / H;
      glow(g, x, y, r * 4, [255, 150, 40], 0.5 * life);
      glow(g, x, y, r, [255, 230, 170], 0.9 * life);
    }
    g.restore();
    // keep the top moody so the head silhouette reads
    const top = g.createLinearGradient(0, 0, 0, H * 0.18);
    top.addColorStop(0, 'rgba(0,0,0,0.35)');
    top.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = top; g.fillRect(0, 0, W, H * 0.18);
  },
};
