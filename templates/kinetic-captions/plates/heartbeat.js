// HEARTBEAT — the room goes dark red and pulses with a heart (lub-dub),
// an ECG trace sweeps across the band behind his head.
import { glow, sky, hex, rgba, fract } from './util.js';

const beat = (t) => { const p = fract(t / 0.86); return Math.exp(-p * 14) + 0.7 * Math.exp(-Math.max(0, p - 0.2) * 16) * (p > 0.2 ? 1 : 0); };
function ecg(x) { // one period over x in 0..1
  const p = fract(x);
  if (p < 0.35) return Math.sin(p / 0.35 * Math.PI) * 0.06;
  if (p < 0.42) return -0.12 * Math.sin((p - 0.35) / 0.07 * Math.PI);
  if (p < 0.46) return 1.0 * Math.sin((p - 0.42) / 0.04 * Math.PI);
  if (p < 0.52) return -0.3 * Math.sin((p - 0.46) / 0.06 * Math.PI);
  if (p < 0.75) return 0.16 * Math.sin((p - 0.58) / 0.17 * Math.PI) * (p > 0.58 ? 1 : 0);
  return 0;
}
export default {
  id: 'heartbeat',
  concepts: 'heart hearts love loved loving obsession obsessed obsess attached attachment desire pulse alive blood passion addicted addiction need needy crave craving'.split(' '),
  draw(g, t, u, { W, H, P }) {
    sky(g, W, H, [[0, '#070002'], [1, '#140006']]);
    const b = beat(t);
    const red = hex('#ff1e3c');
    glow(g, W * 0.5, H * 0.34, H * 0.75, red, 0.18 + 0.5 * b);
    glow(g, W * 0.5, H * 0.34, H * 0.35, [255, 90, 110], 0.1 + 0.35 * b);
    // ECG across the top band
    const y0 = H * 0.2, amp = H * 0.085, span = W * 1.1, head = ((t * 0.55) % 1) * span - W * 0.05;
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.lineJoin = 'round';
    const accent = hex(P.a || '#ff2e5a');
    for (const [lw, a] of [[14, 0.1], [5, 0.3], [2, 1]]) {
      g.lineWidth = lw * W / 1080;
      g.beginPath();
      let started = false;
      for (let x = Math.max(-10, head - W * 0.9); x <= head; x += 3) {
        const y = y0 - ecg((x + W) / (W * 0.55)) * amp;
        if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
      }
      const grad = g.createLinearGradient(head - W * 0.9, 0, head, 0);
      grad.addColorStop(0, rgba(accent, 0));
      grad.addColorStop(1, rgba([255, 160, 170], a));
      g.strokeStyle = grad;
      g.stroke();
    }
    glow(g, head, y0 - ecg((head + W) / (W * 0.55)) * amp, 26 * W / 1080, [255, 220, 225], 0.9);
    g.restore();
  },
};
