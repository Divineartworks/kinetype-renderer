// Neon bloom: a frame-level glow for black-ground type cards. Run it from a template's `post` (once per output
// frame, after motion-blur accumulation). It adds a soft outer bloom (wide blur) and a tight halo around everything
// bright, tinted toward the accent, so type reads like a lit neon tube on a dark screen. Pure canvas 2D, seek-pure.

let scratch = null;

/** Accent colour -> glow tint: the accent itself, pushed toward white so the bloom stays luminous. */
function tintOf(hex) {
  const h = String(hex || '#ffffff').replace('#', '');
  const v = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) || 0);
  return `rgb(${v.map((c) => Math.round(c + (255 - c) * 0.15)).join(',')})`;
}

/**
 * @param g   2D context (any transform; it is reset and restored)
 * @param o   { amount 0..1 (0 = off), color accent hex, unit px-per-design-unit }
 */
export function bloom(g, { amount = 1, color = '#FF2E8B', unit = 1 } = {}) {
  if (!(amount > 0.001)) return;
  const cv = g.canvas, cw = cv.width, ch = cv.height;
  const s = unit;
  const k = 0.25; // bloom is built at quarter resolution: smooth, and cheap
  const w = Math.max(8, Math.round(cw * k)), h = Math.max(8, Math.round(ch * k));
  if (!scratch || scratch.width !== w || scratch.height !== h) scratch = new OffscreenCanvas(w, h);
  const sg = scratch.getContext('2d', { willReadFrequently: true });
  sg.save();
  sg.setTransform(1, 0, 0, 1, 0, 0);
  sg.globalCompositeOperation = 'source-over';
  sg.globalAlpha = 1;
  sg.filter = 'none';
  sg.clearRect(0, 0, w, h);
  sg.drawImage(cv, 0, 0, w, h);
  // keep only the bright parts (the type), then tint toward the accent
  sg.globalCompositeOperation = 'multiply';
  sg.fillStyle = tintOf(color);
  sg.fillRect(0, 0, w, h);
  sg.restore();
  // knee: only light above the ground adds bloom, so a dark card keeps its black (no purple wash over the whole frame)
  const px4 = sg.getImageData(0, 0, w, h), d = px4.data, knee = 46, gain = 255 / (255 - knee);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.max(0, d[i] - knee) * gain;
    d[i + 1] = Math.max(0, d[i + 1] - knee) * gain;
    d[i + 2] = Math.max(0, d[i + 2] - knee) * gain;
  }
  sg.putImageData(px4, 0, 0);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'lighter';
  const px = (cw / 1080) * s;
  // wide outer bloom, mid halo, then a tight hot edge
  for (const [blur, a] of [[46, 0.55], [18, 0.6], [6, 0.5]]) {
    g.filter = `blur(${(blur * px).toFixed(2)}px)`;
    g.globalAlpha = Math.min(1, a * amount);
    g.drawImage(scratch, 0, 0, cw, ch);
  }
  g.restore();
}

/** The glow amount a template should use: params.glow (0..1), 0 when absent. */
export const glowAmount = (params) => {
  const v = Number(params && params.glow);
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
};
