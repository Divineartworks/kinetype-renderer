// CITY NIGHT — the room dissolves into out-of-focus city lights in the
// look's colours, drifting, breathing.
import { rnd, fract, sky, hex, rgba } from './util.js';

export default {
  id: 'bokeh',
  concepts: 'city night nights streets street party club world society social media people women men girls girl guys dating instagram tinder date dates bar clubs lights nightlife'.split(' '),
  draw(g, t, u, { W, H, seed, P }) {
    sky(g, W, H, [[0, '#040309'], [1, '#0b0714']]);
    const cols = [hex(P.a || '#ff2e8b'), hex(P.b || '#34e4ff'), [255, 179, 71], [255, 94, 94], [111, 168, 255], [255, 225, 170]];
    for (let i = 0; i < 48; i++) {
      const depth = rnd(seed, 'bo', i, 0);
      const r = (0.025 + depth * 0.09) * W * (1 + 0.06 * Math.sin(t * 0.9 + i));
      const x = fract(rnd(seed, 'bo', i, 1) + t * 0.008 * (depth - 0.3)) * W * 1.2 - W * 0.1;
      const y = (0.05 + rnd(seed, 'bo', i, 2) * 0.9) * H + Math.sin(t * 0.3 + i) * 8;
      const c = cols[i % cols.length], a = 0.14 + (1 - depth) * 0.22;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, rgba(c, a * 0.8));
      gr.addColorStop(0.82, rgba(c, a));
      gr.addColorStop(1, rgba(c, 0));
      g.fillStyle = gr;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  },
};
