// Drawing shaped runs. Every glyph is a Path2D in font units; transforms are
// applied about the glyph's ink centre so scale/rotate read as the letter
// itself moving, not the pen origin.

/**
 * @typedef {{dx?:number, dy?:number, sx?:number, sy?:number, s?:number, rot?:number, skewX?:number,
 *   alpha?:number, blur?:number, fill?:string, stroke?:string, strokeWidth?:number, ch?:string, hidden?:boolean}} GlyphState
 */

const pivotOf = (it) => [(it.ink.x0 + it.ink.x1) / 2, (it.ink.y0 + it.ink.y1) / 2];

/**
 * Draw a run with its pen origin at (x, y) = left edge of the first advance, on the baseline.
 * opts.align: 'pen' (default) | 'ink-left' | 'center' | 'ink-right' — horizontal reference for x.
 * opts.each(it, k) → GlyphState per glyph (k counts only inked glyphs).
 */
export function drawRun(g, run, x, y, opts = {}) {
  const ox = x - alignOffset(run, opts.align);
  if (opts.group) {
    // whole-word transform about the run's ink centre
    const gr = opts.group;
    const px = ox + (run.inkLeft + run.inkRight) / 2, py = y + (run.inkTop + run.inkBottom) / 2;
    g.save();
    g.translate(px + (gr.dx ?? 0), py + (gr.dy ?? 0));
    if (gr.rot) g.rotate(gr.rot);
    g.scale((gr.sx ?? 1) * (gr.s ?? 1), (gr.sy ?? 1) * (gr.s ?? 1));
    g.translate(-px, -py);
    drawRun(g, run, x, y, { ...opts, group: null });
    g.restore();
    return;
  }
  const baseFill = opts.fill ?? '#fff';
  const baseAlpha = opts.alpha ?? 1;
  // Fast path: nothing per-glyph → one fill of the run's combined outline
  // (one blur pass instead of N). Pixel-equivalent for opaque fills; with
  // alpha < 1 overlapping glyphs no longer double-darken, which is correct.
  if (!opts.each && !opts.stroke) {
    if (baseAlpha <= 0.001 || !run.combined) return;
    g.save();
    g.globalAlpha = baseAlpha;
    if (opts.blur && opts.blur > 0.05) g.filter = `blur(${opts.blur.toFixed(2)}px)`;
    g.translate(ox, y);
    g.fillStyle = baseFill;
    g.fill(run.combined);
    g.restore();
    return;
  }
  let k = 0;
  for (const it of run.items) {
    if (!it.g.hasInk) continue;
    const st = opts.each ? opts.each(it, k) || {} : {};
    k++;
    if (st.hidden) continue;
    const a = baseAlpha * (st.alpha ?? 1);
    if (a <= 0.001) continue;
    const glyph = st.ch && st.ch !== it.ch ? run.face.glyph(st.ch) : it.g;
    if (!glyph.hasInk) continue;
    // substituted glyphs are centred in the true glyph's ink slot
    const subDx = glyph === it.g ? 0 : (it.ink.x0 + it.ink.x1) / 2 - (it.x + ((glyph.ink.x0 + glyph.ink.x1) / 2) * run.scale);
    // substituted glyphs never overflow the true glyph's slot
    const subFit = glyph === it.g ? 1 : Math.min(1, (it.ink.x1 - it.ink.x0) / Math.max(1e-6, (glyph.ink.x1 - glyph.ink.x0) * run.scale));
    g.save();
    g.globalAlpha = a;
    const bl = st.blur ?? opts.blur;
    if (bl && bl > 0.05) g.filter = `blur(${bl.toFixed(2)}px)`;
    g.translate(ox + (st.dx ?? 0), y + (st.dy ?? 0));
    const sx = (st.sx ?? 1) * (st.s ?? 1) * subFit, sy = (st.sy ?? 1) * (st.s ?? 1);
    if (sx !== 1 || sy !== 1 || st.rot || st.skewX) {
      const [px, py] = pivotOf(it);
      g.translate(px, py);
      if (st.rot) g.rotate(st.rot);
      if (st.skewX) g.transform(1, 0, Math.tan(st.skewX), 1, 0, 0);
      g.scale(sx, sy);
      g.translate(-px, -py);
    }
    g.translate(it.x + subDx, it.gdy);
    g.scale(run.scale * it.gs, run.scale * it.gs);
    if (st.stroke || opts.stroke) {
      g.strokeStyle = st.stroke ?? opts.stroke;
      g.lineWidth = (st.strokeWidth ?? opts.strokeWidth ?? 2) / (run.scale * it.gs);
      g.lineJoin = 'miter';
      g.stroke(glyph.path2d);
    }
    if (!(opts.stroke && !opts.fillToo && !st.fill)) {
      g.fillStyle = st.fill ?? baseFill;
      g.fill(glyph.path2d);
    }
    g.restore();
  }
}

export function alignOffset(run, align = 'pen') {
  switch (align) {
    case 'ink-left': return run.inkLeft;
    case 'center': return run.inkLeft + run.inkWidth / 2;
    case 'ink-right': return run.inkRight;
    case 'advance-center': return run.advance / 2;
    default: return 0;
  }
}

/**
 * The run's outlines as ONE Path2D in canvas space — for clip masks, wipes,
 * knockouts. `each` may move/scale glyphs exactly as in drawRun.
 */
export function runPath(run, x, y, opts = {}) {
  const P = new Path2D();
  const ox = x - alignOffset(run, opts.align);
  let k = 0;
  for (const it of run.items) {
    if (!it.g.hasInk) continue;
    const st = opts.each ? opts.each(it, k) || {} : {};
    k++;
    if (st.hidden) continue;
    let m = new DOMMatrix().translate(ox + (st.dx ?? 0), y + (st.dy ?? 0));
    const sx = (st.sx ?? 1) * (st.s ?? 1), sy = (st.sy ?? 1) * (st.s ?? 1);
    if (sx !== 1 || sy !== 1 || st.rot) {
      const [px, py] = pivotOf(it);
      m = m.translate(px, py).rotate(((st.rot ?? 0) * 180) / Math.PI).scale(sx, sy).translate(-px, -py);
    }
    m = m.translate(it.x, it.gdy).scale(run.scale * it.gs, run.scale * it.gs);
    P.addPath(it.g.path2d, m);
  }
  return P;
}

/** Canvas-space ink box of a run placed at (x, y) with the given align. */
export function runBox(run, x, y, align) {
  const ox = x - alignOffset(run, align);
  return { x0: ox + run.inkLeft, x1: ox + run.inkRight, y0: y + run.inkTop, y1: y + run.inkBottom };
}

/** Transform a path by a matrix (e.g. scale a word-mask about a focal point). */
export function transformPath(path, m) {
  const P = new Path2D();
  P.addPath(path, m);
  return P;
}
