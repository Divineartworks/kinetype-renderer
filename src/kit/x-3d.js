// Pseudo-3D helpers for canvas typography (type-tunnel, extrude-3d).
// Pure functions of their inputs; no caches that depend on draw order.
import { hexToRgb, rgbToHex } from './color.js';

/** Linear mix of two hex colours. */
export function mixHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A.map((v, i) => v + (B[i] - v) * t));
}

/** Multiply a colour toward black (k = brightness 0..1). Hue is preserved. */
export function shadeHex(hex, k) {
  return rgbToHex(hexToRgb(hex).map((v) => v * k));
}

/**
 * Draw ONE glyph record (font-unit Path2D) with its pen origin at (x, y) in
 * screen space, rotated by `rot` about the pen origin, scaled by `s`
 * (screen px per font unit).
 */
export function fillGlyph(g, glyph, x, y, s, rot, fill) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.translate(x, y);
  if (rot) g.rotate(rot);
  g.scale(s, s);
  g.fillStyle = fill;
  g.fill(glyph.path2d);
}

/**
 * Extruded glyph geometry. For a run, returns per-glyph layer placement so a
 * caller can batch layers of MANY glyphs into one Path2D per shade band
 * (sides are all behind all faces, so drawing every side band first and
 * every face last is correct occlusion for a front-facing extrusion).
 *
 * Each glyph gets an orthographic "rotation": ry (about Y) foreshortens the
 * face horizontally and swings the extrusion sideways; rx (about X) does the
 * same vertically. Returns matrices in canvas space.
 */
export function extrusionLayers({ run, x, y, glyphState, depth, layers, base }) {
  const out = [];
  const sc = run.scale;
  let k = 0;
  for (const it of run.items) {
    if (!it.g.hasInk) continue;
    const st = glyphState(it, k++) || {};
    if (st.hidden) continue;
    const ry = st.ry ?? 0, rx = st.rx ?? 0, s = st.s ?? 1;
    const cosy = Math.cos(ry), cosx = Math.cos(rx);
    const pivX = x + (it.ink.x0 + it.ink.x1) / 2 + (st.dx ?? 0);
    const pivY = y + (it.ink.y0 + it.ink.y1) / 2 + (st.dy ?? 0);
    // extrusion runs "into the screen"; its projection swings with rotation,
    // plus a base oblique direction so a front-on letter still shows depth
    const ex = (Math.sin(ry) + base.x) * depth * s;
    const ey = (-Math.sin(rx) + base.y) * depth * s;
    const face = (off) =>
      new DOMMatrix()
        .translate(pivX + off * ex, pivY + off * ey)
        .scale(cosy * s, cosx * s)
        .translate(-pivX + (st.dx ?? 0) * 0, -pivY)
        .translate(x + it.x + (st.dx ?? 0), y + it.gdy + (st.dy ?? 0))
        .scale(sc * it.gs, sc * it.gs);
    out.push({ it, st, face, ex, ey, cosy, cosx, alpha: st.alpha ?? 1 });
  }
  return out;
}
