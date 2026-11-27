// TIME — a giant clock face turns behind him: 60 ticks, rings, a sweeping
// hand, and falling sand catching the light.
import { rnd, glow, fract, sky, hex, rgba } from './util.js';

export default {
  id: 'time',
  concepts: 'time clock hour hours year years waiting wait late forever never always days minutes seconds future past patience patient age aging old older soon finally tomorrow yesterday'.split(' '),
  draw(g, t, u, { W, H, seed, P }) {
    sky(g, W, H, [[0, '#01060a'], [1, '#07161d']]);
    const cx = W * 0.5, cy = H * 0.3, R = W * 0.62;
    const acc = hex(P.b || '#58d6ff');
    glow(g, cx, cy, R * 1.2, acc, 0.1);
    g.save();
    g.translate(cx, cy);
    g.rotate(t * 0.04);
    for (let i = 0; i < 60; i++) {
      const a = i / 60 * Math.PI * 2, big = i % 5 === 0;
      const r0 = R * (big ? 0.84 : 0.9), r1 = R * 0.97;
      g.strokeStyle = rgba(big ? [220, 235, 240] : acc, big ? 0.55 : 0.3);
      g.lineWidth = (big ? 6 : 2.5) * W / 1080;
      g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); g.stroke();
    }
    for (const [r, a] of [[1.02, 0.35], [0.78, 0.18], [0.55, 0.12]]) {
      g.strokeStyle = rgba(acc, a); g.lineWidth = 2 * W / 1080;
      g.beginPath(); g.arc(0, 0, R * r, 0, Math.PI * 2); g.stroke();
    }
    g.restore();
    // the hand: one sweep across the moment
    const ha = -Math.PI / 2 + u * Math.PI * 1.6 + t * 0.2;
    g.save(); g.globalCompositeOperation = 'lighter';
    g.strokeStyle = 'rgba(255,240,220,0.8)'; g.lineWidth = 5 * W / 1080; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(ha) * R * 0.95, cy + Math.sin(ha) * R * 0.95); g.stroke();
    // a pulse ring on each second
    const s = fract(t);
    g.strokeStyle = rgba(acc, 0.35 * (1 - s)); g.lineWidth = 3 * W / 1080;
    g.beginPath(); g.arc(cx, cy, R * (0.55 + s * 0.5), 0, Math.PI * 2); g.stroke();
    // sand
    for (let i = 0; i < 90; i++) {
      const x = cx + (rnd(seed, 'sand', i, 0) - 0.5) * W * 0.18, y = fract(rnd(seed, 'sand', i, 1) + t * (0.35 + rnd(seed, 'sand', i, 2) * 0.2)) * H;
      glow(g, x, y, 5 * W / 1080, [255, 215, 160], 0.55);
    }
    g.restore();
  },
};
