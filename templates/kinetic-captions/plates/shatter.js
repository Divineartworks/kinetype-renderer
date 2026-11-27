// SHATTER — the world behind him cracks like a pane of glass: cracks race
// out from behind his head, then the shards drift apart, catching light.
import { rnd, sky, hex, rgba, clamp } from './util.js';

const cache = new Map();
function geometry(seed, W, H) {
  const key = `${seed}:${W}x${H}`;
  let g = cache.get(key);
  if (g) return g;
  const cx = W * 0.5, cy = H * 0.3, R = Math.hypot(W, H);
  const n = 15, rings = [0.07, 0.16, 0.28, 0.44, 0.64, 0.9];
  const ang = Array.from({ length: n }, (_, i) => (i + 0.3 + rnd(seed, 'sh-a', i, 0) * 0.5) / n * Math.PI * 2);
  // vertex (i, k): along ray i at ring k, jittered
  const V = ang.map((a, i) => rings.map((r, k) => {
    const rr = r * R * (0.85 + rnd(seed, 'sh-r', i, k) * 0.3);
    const aa = a + (rnd(seed, 'sh-j', i, k) - 0.5) * 0.12;
    return [cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr];
  }));
  const shards = [];
  for (let i = 0; i < n; i++) for (let k = 0; k < rings.length - 1; k++) {
    const j = (i + 1) % n;
    const poly = [[cx, cy], V[i][k], V[j][k]].slice(k ? 1 : 0);
    const q = k ? [V[i][k], V[j][k], V[j][k + 1], V[i][k + 1]] : [[cx, cy], V[i][0], V[j][0]];
    const mx = q.reduce((a, p) => a + p[0], 0) / q.length, my = q.reduce((a, p) => a + p[1], 0) / q.length;
    shards.push({ q, mx, my, k, shade: rnd(seed, 'sh-s', i, k), spin: (rnd(seed, 'sh-p', i, k) - 0.5) * 0.08 });
    void poly;
  }
  g = { cx, cy, R, V, n, rings, shards };
  cache.set(key, g);
  return g;
}
export default {
  id: 'shatter',
  concepts: 'shatter shattered broken break breaking breaks crack cracked divorce heartbreak heartbroken rejection rejected reject betrayal betrayed betray cheated cheating ruined ruin collapse collapsed destroyed'.split(' '),
  draw(g, t, u, { W, H, seed, P }) {
    sky(g, W, H, [[0, '#04050a'], [1, '#0d1018']]);
    const G = geometry(seed, W, H);
    const grow = clamp(u / 0.28), crack = 1 - Math.pow(1 - grow, 3); // cracks race out
    const drift = Math.pow(clamp((u - 0.22) / 0.78), 1.6);
    const acc = hex(P.a || '#ff2e5a');
    // shards: dark glass panes with a sheen, drifting outward
    for (const s of G.shards) {
      const dx = (s.mx - G.cx) / G.R, dy = (s.my - G.cy) / G.R;
      const push = drift * 60 * (W / 1080) * (1 + s.k * 0.6);
      g.save();
      g.translate(s.mx + dx * push * 6, s.my + dy * push * 6);
      g.rotate(s.spin * drift * 3);
      g.translate(-s.mx, -s.my);
      g.beginPath(); s.q.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
      const l = 14 + s.shade * 26;
      const gr = g.createLinearGradient(s.q[0][0], s.q[0][1], s.mx, s.my);
      gr.addColorStop(0, `rgb(${l + 30},${l + 34},${l + 46})`);
      gr.addColorStop(1, `rgb(${l},${l + 2},${l + 8})`);
      g.fillStyle = gr; g.fill();
      g.restore();
    }
    // cracks: bright edges racing outward from behind the head
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    const reach = crack * G.R;
    for (const [lw, a, col] of [[9, 0.12, acc], [2.4, 0.85, [235, 240, 255]]]) {
      g.strokeStyle = rgba(col, a * (1 - drift * 0.5));
      g.lineWidth = lw * W / 1080;
      g.beginPath();
      for (let i = 0; i < G.n; i++) {
        let px = G.cx, py = G.cy;
        g.moveTo(px, py);
        for (let k = 0; k < G.rings.length; k++) {
          const [x, y] = G.V[i][k];
          const d = Math.hypot(x - G.cx, y - G.cy);
          if (d > reach) { const f = (reach - Math.hypot(px - G.cx, py - G.cy)) / Math.max(1, d - Math.hypot(px - G.cx, py - G.cy)); if (f > 0) g.lineTo(px + (x - px) * f, py + (y - py) * f); break; }
          g.lineTo(x, y); px = x; py = y;
        }
        // ring segments once the cracks have passed them
        for (let k = 0; k < G.rings.length; k++) {
          const [x0, y0] = G.V[i][k], [x1, y1] = G.V[(i + 1) % G.n][k];
          if (Math.hypot(x0 - G.cx, y0 - G.cy) < reach * 0.92 && Math.hypot(x1 - G.cx, y1 - G.cy) < reach * 0.92) { g.moveTo(x0, y0); g.lineTo(x1, y1); }
        }
      }
      g.stroke();
    }
    g.restore();
  },
};
