// Grids and safe areas in design pixels.
import { snap } from './math.js';

export const FORMATS = {
  square: { width: 1080, height: 1080 },
  'square-1080': { width: 1080, height: 1080 },
  landscape: { width: 1920, height: 1080 },
  'landscape-1080': { width: 1920, height: 1080 },
  'landscape-4k': { width: 3840, height: 2160 },
  vertical: { width: 1080, height: 1920 },
  'vertical-1080': { width: 1080, height: 1920 },
  portrait: { width: 1080, height: 1350 },
};

export function resolveFormat(f) {
  if (!f) return { ...FORMATS.square, fps: 60, name: 'square' };
  if (typeof f === 'string') {
    const base = FORMATS[f];
    if (!base) throw new Error(`unknown format "${f}" (known: ${Object.keys(FORMATS).join(', ')})`);
    return { ...base, fps: 60, name: f };
  }
  const named = f.name && FORMATS[f.name] ? FORMATS[f.name] : {};
  return { width: f.width ?? named.width ?? 1080, height: f.height ?? named.height ?? 1080, fps: f.fps ?? 60, name: f.name ?? `${f.width}x${f.height}` };
}

/** "square" | "landscape" | "vertical" by aspect, for templates that adapt. */
export function aspectClass(w, h) {
  const r = w / h;
  if (r > 1.2) return 'landscape';
  if (r < 0.85) return 'vertical';
  return 'square';
}

export class Grid {
  /**
   * @param {{width:number,height:number,cols?:number,rows?:number,margin?:number,gutter?:number,baseline?:number}} o
   */
  constructor(o) {
    this.w = o.width;
    this.h = o.height;
    this.cols = o.cols ?? 12;
    this.rows = o.rows ?? 12;
    this.margin = o.margin ?? Math.round(Math.min(o.width, o.height) * 0.0741); // 80px at 1080
    this.gutter = o.gutter ?? 16;
    this.baseline = o.baseline ?? 8;
    this.innerW = this.w - this.margin * 2;
    this.innerH = this.h - this.margin * 2;
    this.colW = (this.innerW - this.gutter * (this.cols - 1)) / this.cols;
    this.rowH = (this.innerH - this.gutter * (this.rows - 1)) / this.rows;
  }
  x(col) { return this.margin + col * (this.colW + this.gutter); }
  y(row) { return this.margin + row * (this.rowH + this.gutter); }
  spanW(n) { return n * this.colW + (n - 1) * this.gutter; }
  spanH(n) { return n * this.rowH + (n - 1) * this.gutter; }
  /** Snap a baseline to the baseline grid. */
  base(y) { return snap(y, this.baseline); }
  get left() { return this.margin; }
  get right() { return this.w - this.margin; }
  get top() { return this.margin; }
  get bottom() { return this.h - this.margin; }
}

/**
 * Stack runs top→bottom by INK (not line-height): each line's ink top sits
 * `gap` px under the previous line's ink bottom (descenders and tall symbols
 * included). `gaps` may give a per-boundary gap array. Baselines snap to grid.
 * Returns baselines (y of each run).
 */
export function stackInk(runs, { top, gap = 0, gaps, grid = 8 }) {
  const ys = [];
  let cursor = top;
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    let y = cursor + inkAbove(r);
    y = snap(y, grid);
    ys.push(y);
    cursor = y + inkBelow(r) + (gaps ? gaps[i] ?? gap : gap);
  }
  return ys;
}

const inkAbove = (r) => Math.max(r.capPx, -r.inkTop);
const inkBelow = (r) => Math.max(0, r.inkBottom);

/** Total height of an ink stack (ink top of first → ink bottom of last). */
export function stackHeight(runs, gap = 0, gaps) {
  return runs.reduce((a, r, i) => a + inkAbove(r) + inkBelow(r) + (i < runs.length - 1 ? (gaps ? gaps[i] ?? gap : gap) : 0), 0);
}
