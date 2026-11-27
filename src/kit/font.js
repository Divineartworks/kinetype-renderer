// Typography core: fonts are parsed with opentype.js and every glyph is drawn
// from its outline. Nothing goes through fillText, so layout never depends on
// installed fonts, glyph outlines are available as masks, and per-glyph
// motion is addressable.
//
// Units: font units internally (y-down, baseline at 0), pixels at the edges.
// Tracking is in 1/1000 em (After Effects convention: -40 = -0.04em).
import { parse as parseFont } from 'opentype.js/dist/opentype.mjs';

const BANDS = 32;

// Complex scripts (joining, reordering, marks) are shaped by HarfBuzz when a
// shaper is registered (the runtime does it once per page); Latin/Greek/Cyrillic
// keep the optical-kerning path below. Detection is by Unicode block.
let HB = null;
/** Register harfbuzzjs (the module namespace) as the complex-script shaper. */
export function useHarfBuzz(hb) { HB = hb; }
export const hasHarfBuzz = () => !!HB;
export const COMPLEX = /[\u0590-\u08FF\u0900-\u0DFF\u0E00-\u0EFF\u0F00-\u0FFF\u1000-\u109F\u1780-\u17FF\u1800-\u18AF\uA800-\uA8FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

export class Face {
  constructor(key, font, meta = {}, buffer = null) {
    this.key = key;
    this.font = font;
    this.buffer = buffer; // raw bytes, for HarfBuzz
    this._byId = new Map();
    this.meta = meta;
    this.upm = font.unitsPerEm;
    const os2 = font.tables.os2 || {};
    this.ascender = font.ascender;
    this.descender = font.descender; // negative
    this.capHeight = os2.sCapHeight || Math.round(this.upm * 0.7);
    this.xHeight = os2.sxHeight || Math.round(this.upm * 0.5);
    this._glyphs = new Map();
    this._pairs = new Map();
    this._refGap = null;
  }

  /** Cached per-codepoint glyph record: advance, Path2D (font units), ink box, band profiles. */
  glyph(ch) {
    let g = this._glyphs.get(ch);
    if (g) return g;
    const og = this.font.charToGlyph(ch);
    const p = og.getPath(0, 0, this.upm); // y-down, font units
    const bb = og.getBoundingBox(); // y-up
    const hasInk = p.commands.length > 0 && bb.x2 > bb.x1;
    g = {
      ch,
      og,
      index: og.index,
      adv: og.advanceWidth || 0,
      missing: og.index === 0 && ch !== ' ',
      hasInk,
      path2d: typeof Path2D !== 'undefined' ? new Path2D(p.toPathData(3)) : null,
      pathData: p.toPathData(3),
      commands: p.commands,
      ink: hasInk ? { x0: bb.x1, x1: bb.x2, y0: -bb.y2, y1: -bb.y1 } : { x0: 0, x1: 0, y0: 0, y1: 0 },
      prof: null,
    };
    if (hasInk) g.prof = profiles(p.commands, this);
    this._glyphs.set(ch, g);
    return g;
  }

  /** Glyph record by glyph id (HarfBuzz output), same shape as glyph(ch). */
  glyphById(gid, ch = '') {
    let g = this._byId.get(gid);
    if (g) return g;
    const og = this.font.glyphs.get(gid);
    const p = og.getPath(0, 0, this.upm);
    const bb = og.getBoundingBox();
    const hasInk = p.commands.length > 0 && bb.x2 > bb.x1;
    g = {
      ch, og, index: gid, adv: og.advanceWidth || 0, missing: gid === 0, hasInk,
      path2d: typeof Path2D !== 'undefined' ? new Path2D(p.toPathData(3)) : null,
      pathData: p.toPathData(3), commands: p.commands,
      ink: hasInk ? { x0: bb.x1, x1: bb.x2, y0: -bb.y2, y1: -bb.y1 } : { x0: 0, x1: 0, y0: 0, y1: 0 },
      prof: null,
    };
    this._byId.set(gid, g);
    return g;
  }

  /** HarfBuzz font for this face (lazily created). */
  hbFont() {
    if (!this._hb && HB && this.buffer) {
      const blob = new HB.Blob(this.buffer);
      const face = new HB.Face(blob, 0);
      this._hb = new HB.Font(face);
    }
    return this._hb;
  }

  metricKern(a, b) {
    try {
      return this.font.getKerningValue(a.og, b.og) || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Optical kern for a pair, in font units, relative to the metric advance.
   * Equalises the band-averaged white between ink edges against the font's own
   * "HH" (stem–stem) spacing, and guarantees `minClear` of clearance after
   * tracking so tight display tracking never makes letters collide.
   */
  opticalKern(a, b) {
    if (!a.prof || !b.prof) return this.metricKern(a, b);
    const key = a.index + ':' + b.index;
    let k = this._pairs.get(key);
    if (k !== undefined) return k;
    const ref = this.refGap();
    const { mean } = pairGap(a, b, this);
    // Blend toward the optical target; keep a little of the designer's metric
    // kerning, which knows things about the shapes bands cannot see.
    k = 0.8 * (ref - mean) + 0.2 * this.metricKern(a, b);
    // never let optical spacing open a pair wider than a stem pair would sit
    k = Math.min(k, this.upm * 0.04);
    this._pairs.set(key, k);
    return k;
  }

  refGap() {
    if (this._refGap == null) {
      const h = this.glyph('H'), o = this.glyph('O');
      // White beyond ~1.35 stem gaps reads as "open", not as "more space":
      // counting it fully is what makes naive optical kerning crush L-I or S-T.
      this._cap = h.prof ? pairGap(h, h, this, Infinity).mean * 1.35 : this.upm * 0.2;
      const hh = pairGap(h, h, this).mean, ho = pairGap(h, o, this).mean, oo = pairGap(o, o, this).mean;
      // HH is the stem reference; blend in round pairs so the target sits where
      // the type designer's own rhythm sits.
      this._refGap = hh * 0.6 + ho * 0.25 + oo * 0.15;
    }
    return this._refGap;
  }

  /** Minimum horizontal clearance between a and b's ink when b sits at a.adv + extra. */
  clearance(a, b, extra) {
    if (!a.prof || !b.prof) return Infinity;
    return pairGap(a, b, this).min + extra;
  }

  px(units, size) {
    return (units * size) / this.upm;
  }
}

/** Flatten outline commands and record leftmost / rightmost ink per horizontal band. */
function profiles(cmds, face) {
  const top = -Math.max(face.ascender, face.capHeight * 1.05);
  const bot = -face.descender;
  const L = new Float64Array(BANDS).fill(Infinity);
  const R = new Float64Array(BANDS).fill(-Infinity);
  const bh = (bot - top) / BANDS;
  const mark = (x, y) => {
    const i = Math.floor((y - top) / bh);
    if (i < 0 || i >= BANDS) return;
    if (x < L[i]) L[i] = x;
    if (x > R[i]) R[i] = x;
  };
  let cx = 0, cy = 0, sx = 0, sy = 0;
  const seg = (x0, y0, x1, y1) => {
    const n = Math.max(2, Math.ceil(Math.abs(y1 - y0) / (bh * 0.5)));
    for (let k = 0; k <= n; k++) mark(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n);
  };
  for (const c of cmds) {
    if (c.type === 'M') { cx = sx = c.x; cy = sy = c.y; }
    else if (c.type === 'L') { seg(cx, cy, c.x, c.y); cx = c.x; cy = c.y; }
    else if (c.type === 'Q') {
      let px = cx, py = cy;
      for (let k = 1; k <= 12; k++) {
        const t = k / 12, u = 1 - t;
        const x = u * u * cx + 2 * u * t * c.x1 + t * t * c.x;
        const y = u * u * cy + 2 * u * t * c.y1 + t * t * c.y;
        seg(px, py, x, y); px = x; py = y;
      }
      cx = c.x; cy = c.y;
    } else if (c.type === 'C') {
      let px = cx, py = cy;
      for (let k = 1; k <= 16; k++) {
        const t = k / 16, u = 1 - t;
        const x = u * u * u * cx + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x;
        const y = u * u * u * cy + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y;
        seg(px, py, x, y); px = x; py = y;
      }
      cx = c.x; cy = c.y;
    } else if (c.type === 'Z') { seg(cx, cy, sx, sy); cx = sx; cy = sy; }
  }
  return { L, R, top, bh };
}

/** White between a's right ink edge and b's left ink edge, per band, with b at a.adv. */
function pairGap(a, b, face, capOverride) {
  const cap = capOverride ?? face._cap ?? face.upm * 0.2;
  let sum = 0, n = 0, min = Infinity;
  const zoneTop = Math.floor((-(face.capHeight) - a.prof.top) / a.prof.bh);
  const zoneBot = Math.ceil((0 - a.prof.top) / a.prof.bh);
  for (let i = 0; i < BANDS; i++) {
    const ra = a.prof.R[i], lb = b.prof.L[i];
    const hasA = ra > -Infinity, hasB = lb < Infinity;
    if (hasA && hasB) {
      const g = a.adv - ra + lb;
      if (g < min) min = g;
      if (i >= zoneTop && i < zoneBot) { sum += Math.min(g, cap); n++; }
    } else if ((hasA || hasB) && i >= zoneTop && i < zoneBot) {
      sum += cap; n++;
    }
  }
  return { mean: n ? sum / n : 0, min };
}

export class FontBook {
  constructor() {
    this.faces = new Map();
  }
  /** Register a parsed face under a role key such as "display" or "mono". */
  addBuffer(key, buffer, meta) {
    const font = parseFont(buffer);
    const face = new Face(key, font, meta, buffer);
    this.faces.set(key, face);
    return face;
  }
  get(key) {
    const f = this.faces.get(key);
    if (!f) throw new Error(`font role "${key}" is not loaded (have: ${[...this.faces.keys()].join(', ')})`);
    return f;
  }
  has(key) {
    return this.faces.has(key);
  }
}

/**
 * Shape a single line into positioned glyphs.
 * @param {Face} face
 * @param {string} text
 * @param {{size:number, tracking?:number, kerning?:'optical'|'metric'|'none', minClear?:number|null}} o
 *   minClear: minimum ink clearance in em between neighbours after tracking (default 0.012em); null disables.
 * @returns {Run}
 */
export function shape(face, text, o) {
  if (HB && COMPLEX.test(text)) return shapeComplex(face, text, o);
  const size = o.size;
  const tracking = ((o.tracking ?? 0) / 1000) * face.upm;
  const mode = o.kerning ?? 'optical';
  const minClear = o.minClear === null ? null : (o.minClear ?? 0.012) * face.upm;
  const capSym = o.capSymbols ? new Set([...(typeof o.capSymbols === 'string' ? o.capSymbols : '@#&%*+=~$€£¥')]) : null;
  const chars = [...text];
  const glyphs = [];
  let x = 0; // font units
  let prev = null;
  for (let i = 0; i < chars.length; i++) {
    const g = face.glyph(chars[i]);
    // Optical sizing for symbols: scale so the ink spans exactly baseline→cap.
    let gs = 1, gdy = 0;
    if (capSym && capSym.has(chars[i]) && g.hasInk) {
      gs = face.capHeight / Math.max(1, g.ink.y1 - g.ink.y0);
      gdy = -g.ink.y1 * gs;
    }
    if (prev) {
      let adj = tracking;
      if (gs === 1 && prev.gs === 1) {
        if (mode === 'optical') adj += face.opticalKern(prev.g, g);
        else if (mode === 'metric') adj += face.metricKern(prev.g, g);
        if (minClear !== null && prev.g.prof && g.prof) {
          const clear = face.clearance(prev.g, g, adj);
          if (clear < minClear) adj += minClear - clear;
        }
      } else {
        // scaled symbols: space by ink, one stem gap apart
        const ref = face.refGap();
        const prevRight = prev.xu + prev.g.ink.x1 * prev.gs;
        const curLeft = x + adj + g.ink.x0 * gs;
        adj += prevRight + ref * 0.9 - curLeft;
      }
      x += adj;
    }
    glyphs.push({ i, ch: chars[i], g, xu: x, gs, gdy });
    x += g.adv * gs;
    prev = glyphs[glyphs.length - 1];
  }
  return new Run(face, size, glyphs, x, text);
}

/**
 * HarfBuzz path: correct joining / reordering / mark placement for complex
 * scripts, in visual order (RTL runs come back left-to-right on screen).
 * Tracking is applied only between clusters of NON-joining scripts (tracking
 * cursive Arabic would break the joins).
 */
function shapeComplex(face, text, o) {
  const hbFont = face.hbFont();
  if (!hbFont) throw new Error(`font "${face.key}" has no raw bytes for complex shaping`);
  const buf = new HB.Buffer();
  buf.addText(text);
  buf.guessSegmentProperties();
  HB.shape(hbFont, buf);
  const infos = buf.getGlyphInfos(), pos = buf.getGlyphPositions();
  const cursive = /[\u0600-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u0700-\u074F\u1800-\u18AF]/.test(text);
  const tracking = cursive ? 0 : ((o.tracking ?? 0) / 1000) * face.upm;
  const chars = [...text];
  const glyphs = [];
  let x = 0, prevCluster = null;
  infos.forEach((info, k) => {
    if (prevCluster !== null && info.cluster !== prevCluster) x += tracking;
    const ch = text.slice(info.cluster, infos.find((j) => j.cluster > info.cluster)?.cluster ?? text.length) || chars[0];
    const g = face.glyphById(info.codepoint, ch);
    glyphs.push({ i: k, ch, g, xu: x + (pos[k].xOffset || 0), gs: 1, gdy: -(pos[k].yOffset || 0) });
    x += pos[k].xAdvance;
    prevCluster = info.cluster;
  });
  buf.destroy?.();
  return new Run(face, o.size, glyphs, x, text);
}

export class Run {
  constructor(face, size, glyphs, advUnits, text) {
    this.face = face;
    this.size = size;
    this.text = text;
    this.scale = size / face.upm;
    this.items = glyphs.map((q) => {
      const s = this.scale;
      return {
        i: q.i,
        ch: q.ch,
        g: q.g,
        x: q.xu * s, // pen position (px) relative to the run origin
        adv: q.g.adv * s * (q.gs ?? 1),
        gs: q.gs ?? 1, // extra glyph scale (cap-sized symbols)
        gdy: (q.gdy ?? 0) * s, // baseline shift in px for scaled symbols
        ink: {
          x0: (q.xu + q.g.ink.x0 * (q.gs ?? 1)) * s,
          x1: (q.xu + q.g.ink.x1 * (q.gs ?? 1)) * s,
          y0: (q.g.ink.y0 * (q.gs ?? 1) + (q.gdy ?? 0)) * s,
          y1: (q.g.ink.y1 * (q.gs ?? 1) + (q.gdy ?? 0)) * s,
        },
        ws: /\s/.test(q.ch),
      };
    });
    this.advance = advUnits * this.scale;
    const inked = this.items.filter((it) => it.g.hasInk);
    this.inkLeft = inked.length ? Math.min(...inked.map((it) => it.ink.x0)) : 0;
    this.inkRight = inked.length ? Math.max(...inked.map((it) => it.ink.x1)) : this.advance;
    this.inkTop = inked.length ? Math.min(...inked.map((it) => it.ink.y0)) : -face.px(face.capHeight, size);
    this.inkBottom = inked.length ? Math.max(...inked.map((it) => it.ink.y1)) : 0;
    this.inkWidth = this.inkRight - this.inkLeft;
    this.capPx = face.px(face.capHeight, size);
    this.xPx = face.px(face.xHeight, size);
    this.ascPx = face.px(face.ascender, size);
    this.descPx = -face.px(face.descender, size);
    this.missing = this.items.filter((it) => it.g.missing).map((it) => it.ch);
  }
  /**
   * The whole run as ONE Path2D (pen origin, baseline at 0), built once.
   * Filling it is one draw call — so a blur filter costs one pass per run
   * instead of one per glyph.
   */
  get combined() {
    if (!this._combined && typeof Path2D !== 'undefined') {
      const P = new Path2D();
      for (const it of this.items) {
        if (!it.g.hasInk) continue;
        P.addPath(it.g.path2d, new DOMMatrix().translate(it.x, it.gdy).scale(this.scale * it.gs, this.scale * it.gs));
      }
      this._combined = P;
    }
    return this._combined;
  }
  /** Glyphs that carry ink (no spaces). */
  get inked() {
    return this.items.filter((it) => it.g.hasInk);
  }
}

/** Font size (px) at which `text` has exactly `width` px of INK (optical edge alignment). */
export function fitSize(face, text, width, o = {}) {
  const probe = shape(face, text, { ...o, size: 1000 });
  return (1000 * width) / Math.max(1e-6, probe.inkWidth);
}

/** Size that fits both a width and a cap-height ceiling. */
export function fitBox(face, text, width, capMax, o = {}) {
  const byW = fitSize(face, text, width, o);
  const byH = (capMax * face.upm) / face.capHeight;
  return Math.min(byW, byH);
}

/**
 * Greedy line breaking with a balanced second pass: returns lines whose widths
 * are as even as possible (no single-word orphans unless unavoidable).
 */
export function balanceLines(face, text, maxWidth, o) {
  // a no-break space (U+00A0, e.g. «1 893,75 kr») never breaks: split on ordinary whitespace only (JS \s includes it)
  const words = text.split(/[ \t\n\r\f\v\u2028\u2029]+/).filter(Boolean);
  if (!words.length) return [];
  const widthOf = (s) => shape(face, s, o).inkWidth;
  // greedy count
  const greedy = [];
  let cur = [];
  for (const w of words) {
    const tryLine = [...cur, w].join(' ');
    if (cur.length && widthOf(tryLine) > maxWidth) { greedy.push(cur); cur = [w]; }
    else cur.push(w);
  }
  if (cur.length) greedy.push(cur);
  const n = greedy.length;
  if (n <= 1) return [words.join(' ')];
  // exhaustive balanced split into n lines (word counts are small in kinetic type)
  let best = null;
  const rec = (start, left, acc) => {
    if (left === 1) {
      const line = words.slice(start).join(' ');
      const all = [...acc, line];
      const ws = all.map(widthOf);
      if (Math.max(...ws) > maxWidth * 1.0001) return;
      const mean = ws.reduce((a, b) => a + b, 0) / ws.length;
      const cost = ws.reduce((a, w) => a + (w - mean) ** 2, 0) + (words.length - start === 1 && words.length > 2 ? maxWidth ** 2 : 0);
      if (!best || cost < best.cost) best = { cost, lines: all };
      return;
    }
    for (let e = start + 1; e <= words.length - (left - 1); e++) rec(e, left - 1, [...acc, words.slice(start, e).join(' ')]);
  };
  if (words.length <= 14) rec(0, n, []);
  return best ? best.lines : greedy.map((l) => l.join(' '));
}
