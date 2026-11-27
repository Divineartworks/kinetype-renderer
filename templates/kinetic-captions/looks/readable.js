// kinetype-capability: readable/1  (house caption + wall of the hero word behind him; the app's bridge probes the marker before it stamps plan.readable)
// READABLE looks behind him (params.readable, a caller opt-in, personClean applied): noir, neon and terminal windows
// keep the look's grade (footage, vignette, grain) on the BACKGROUND, but
//   1. the spoken caption is the HOUSE caption (the cover look's caption: same face, size, weight, shadow as every normal caption),
//   2. the hero word behind him is a WALL of the word, big and bold, repeated in offset rows (like the poster kit's wall: one copy hidden
//      by his head, the next one still reads), on a dark scrim so the glow / white / phosphor holds against any graded background.
// One big effect at a time: no whole-frame flash, no front sign, no pull quote, no rim light.
import cover from './cover.js';

export const READABLE_LOOKS = new Set(['neon', 'noir', 'terminal']);
export const READABLE_FONTS = ['display', 'text'];

// The house caption sits over HIS body (the front pass, after he is re-drawn), so the type must hold on a black shirt AND a white one. The cover
// look's own shadow is a soft blur: it does not separate white type from a white shirt. In readable mode every caption word gets a hard dark
// outline (stroke-only pass under the fill). Contrast of the outline against the type inks (cream #F4F1EA, gold #E8B04A) is >= 4.5 (see test).
export const SMALL_WORD_OUTLINE = 0.15;    // outline width as a share of the word's cap height (floor)
export const HOUSE_OUTLINE = { color: '#050505', width: 5 };       // width in px at 1080 (unit 1); half of it shows outside the glyph
/** K with drawRun wrapped: a type pass (a fill, no blur) is preceded by its outline pass. Shadow passes (blurred) are left as they are. */
export function houseOutlineWidth(capPx, unit, outline = HOUSE_OUTLINE) { return Math.max(outline.width * unit, SMALL_WORD_OUTLINE * capPx); }
/** K with drawRun wrapped: a type pass (a fill, no blur) is preceded by a tight dark halo and its outline pass. Shadow passes (blurred) are left as they are.
 *  The outline is never thinner than SMALL_WORD_OUTLINE of the word's cap height, so the small secondary words ("to her", "she", "it") over the
 *  busy shirt print carry the same outline weight (relative to their size) as the hero words, not a hairline. */
export function withHouseOutline(K, unit, outline = HOUSE_OUTLINE) {
  return {
    ...K,
    drawRun(g, run, x, y, o = {}) {
      if (o.fill && !o.blur && !o.stroke && (o.alpha ?? 1) > 0.02) {
        const w = houseOutlineWidth(run?.capPx || 0, unit, outline);
        K.drawRun(g, run, x, y, { fill: outline.color, blur: Math.max(3 * unit, 0.08 * (run?.capPx || 0)), alpha: Math.min(1, (o.alpha ?? 1) * 0.9), group: o.group });
        K.drawRun(g, run, x, y, { stroke: outline.color, strokeWidth: w, alpha: Math.min(1, (o.alpha ?? 1) * 1.1), group: o.group });
      }
      return K.drawRun(g, run, x, y, o);
    },
  };
}
// His cut-out in a readable window: the matte alpha is choked (media.js chokeAlpha) so the soft fringe of hair / shoulders that still
// carries the old room colour does not show as a halo over the grey / dark background. Per-pixel curve, no erosion (hair is thinned, not cut).
export const READABLE_CHOKE = { lo: 0.3, hi: 0.85 };
export const readableWanted = (params, lookId) => params.readable === true && READABLE_LOOKS.has(lookId);

// per-look ink of the wall: neon = glowing tube, noir = white on grey, terminal = phosphor green
const STYLES = {
  neon: { glow: true, core: '#FFFFFF', coreMix: 0.3, scrim: [6, 2, 12], scrimA: 0.62, gases: (P) => [P.a, P.b], flicker: true },
  noir: { glow: false, core: '#F7F7F5', coreMix: 0, scrim: [26, 26, 26], scrimA: 0.5, gases: (P) => [P.ink, P.ink], flicker: false },
  terminal: { glow: true, core: '#E6FFEE', coreMix: 0.35, scrim: [1, 8, 3], scrimA: 0.62, gases: (P) => [P.a, P.a], flicker: false },
};

/** The sizes of the wall for a canvas: {rows, cap, gapY}. Pure, so the tests can assert them without rendering. */
export function wallGeometry({ W, H, tall, canvasPic, runAdvance }) {
  const rows = tall ? 4 : canvasPic ? 2 : 3;
  const span = (tall ? 0.46 : canvasPic ? 0.72 : 0.62) * H;       // the wall's share of the canvas height
  let cap = span / rows / 1.16;
  return { rows, cap, span, maxW: W * 0.92 };
}

export function buildReadable(A, base) {
  const { K, P, W, H, unit, tall, params, q, flicker, seed, sizeFor, safeTop, look } = A;
  const canvasPic = !!A.canvasPic;
  const userPal = A.ctx.spec.palette || {};
  const housePal = { ...cover.palette, ...userPal };
  // the house caption = cover's own build on the house palette
  // no ghost: a word is at full strength from its onset (the 50 ms fade-in read as a dim grey word on his dark shirt), and the cover
  // look's dimmed "whole phrase" preview (style: clean) is never used here
  const HA = { ...A, wordIn: (w, t, p, o = {}) => A.wordIn(w, t, p, { ...o, fade: 0.001 }), params: { ...params, style: params.style === 'clean' ? 'poster' : params.style },
    K: withHouseOutline(K, unit), P: housePal, up: (s) => (params.uppercase === false ? s : s.toUpperCase()) };
  const house = cover.build(HA);
  const fD = A.font('display');
  const S = STYLES[look.id];
  const gases = S.gases(P);
  const asHouse = (p, fn) => { const h = p.hero; p.hero = false; try { return fn(); } finally { p.hero = h; } };
  const upWord = (s) => (params.uppercase === false ? s : s.toUpperCase());

  function wallLayout(p) {
    const text = upWord(p.key.text);
    const geo = wallGeometry({ W, H, tall, canvasPic });
    let cap = geo.cap;
    let run = K.shape(fD, text, { size: sizeFor(fD, cap), tracking: 6, kerning: 'optical' });
    let ink = run.inkRight - run.inkLeft;
    if (ink > geo.maxW) { cap *= geo.maxW / ink; run = K.shape(fD, text, { size: sizeFor(fD, cap), tracking: 6, kerning: 'optical' }); ink = run.inkRight - run.inkLeft; }
    const gapX = cap * 0.5;
    const rowH = cap * 1.16;
    const top = Math.max(safeTop, H * 0.05);
    p.wall = { run, ink, cap: run.capPx, gapX, rowH, top, rows: geo.rows, y0: top, y1: top + geo.rows * rowH, text };
  }

  function drawWall(g, t, p) {
    const w = p.wall;
    if (!w) return;
    const d = t - p.key.start;
    if (d < -0.04) return;
    const outU = K.clamp((t - (p.out - 0.18)) / 0.18);
    let a = K.clamp((d + 0.04) / 0.1) * (1 - outU);
    if (S.flicker) a *= 0.35 + 0.65 * flicker('wall' + p.k, d, 0.3, 24);
    if (a <= 0.003) return;
    const settle = 1.05 - 0.05 * K.clamp(K.springStep(Math.max(0, d), 6, 0.85), 0, 1);
    // the scrim: soft top and bottom edges, so the type holds on any background and it never reads as a box
    const sy0 = w.y0 - w.rowH * 0.35, sy1 = w.y1 + w.rowH * 0.1;
    const gr = g.createLinearGradient(0, sy0, 0, sy1);
    const c = S.scrim.join(',');
    gr.addColorStop(0, `rgba(${c},0)`);
    gr.addColorStop(0.18, `rgba(${c},${S.scrimA})`);
    gr.addColorStop(0.82, `rgba(${c},${S.scrimA})`);
    gr.addColorStop(1, `rgba(${c},0)`);
    g.save(); g.globalAlpha = a; g.fillStyle = gr; g.fillRect(0, sy0, W, sy1 - sy0); g.restore();
    const period = w.ink + w.gapX;
    const drift = (t - p.key.start) * 14 * unit;
    for (let r = 0; r < w.rows; r++) {
      const base = w.top + r * w.rowH + w.cap + (w.rowH - w.cap) * 0.35;
      const dir = r % 2 ? -1 : 1;
      let off = -(r * period * 0.37) + dir * drift;
      off = ((off % period) + period) % period - period;           // wrap: copies tile the full width
      const gas = gases[r % 2];
      for (let x = off; x < W + period; x += period) {
        const ox = x - w.run.inkLeft;
        const grp = { s: settle };
        if (S.glow) {
          g.save(); g.globalCompositeOperation = 'lighter';
          K.drawRun(g, w.run, ox, base, { fill: gas, alpha: 0.55 * a, blur: 24 * unit, group: grp });
          K.drawRun(g, w.run, ox, base, { fill: gas, alpha: 0.95 * a, blur: 7 * unit, group: grp });
          g.restore();
        } else {
          K.drawRun(g, w.run, ox, base + 5 * unit, { fill: '#000000', alpha: 0.6 * a, blur: 12 * unit, group: grp });
        }
        K.drawRun(g, w.run, ox, base, { fill: S.coreMix ? K.mix(S.core, gas, S.coreMix) : S.core, alpha: Math.min(1, a * 1.05), group: grp });
      }
    }
  }

  return {
    layout(p) {
      const lay = asHouse(p, () => house.layout(p));
      if (p.hero && p.key) wallLayout(p);
      return { ...lay, fg: housePal.ink, bg: housePal.shade };
    },
    behind(g, t, tq, p) { if (p && p.hero && !p.front) drawWall(g, tq, p); },
    front(g, t, tq, p) { asHouse(p, () => house.front(g, t, tq, p)); },
    footage: base.footage,
    post: base.post,
    hit() {},
  };
}
