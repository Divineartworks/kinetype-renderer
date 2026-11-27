// Media layer: images and video clips as deterministic, frame-exact sources.
// Video is pre-decoded by the Node side into a numbered JPEG sequence; the
// runtime prefetches exactly the frames a render sample needs (prepare) so
// draw(g, t) stays synchronous and a pure function of t.
import { clamp, mod } from './math.js';

export class MediaHub {
  /** sources: { id: {kind:'image'|'video', url, w, h, fps?, frames?, start?, speed?, loop?} } */
  constructor(sources = {}) {
    this.src = sources;
    this.images = new Map(); // id → ImageBitmap (images)
    this.cache = new Map(); // `${id}:${idx}` → ImageBitmap (video frames)
    this.order = [];
    this.limit = 160;
    this.pixelLimit = 120e6; // ~480 MB of decoded RGBA
    this._cuts = new Map(); // id → cached subject cut-out {c, g, key}
  }
  async init() {
    await Promise.all(Object.entries(this.src).filter(([, m]) => m.kind === 'image').map(async ([id, m]) => {
      const blob = await (await fetch(m.url)).blob();
      if (/svg/i.test(blob.type) || /\.svg(\?|$)/i.test(m.url)) {
        // SVG: createImageBitmap(blob) is unreliable; rasterise through an <img> at 4x so a vector logo stays crisp
        const u = URL.createObjectURL(new Blob([await blob.text()], { type: 'image/svg+xml' }));
        const img = new Image();
        img.src = u;
        await img.decode();
        const k = 4, c = new OffscreenCanvas(Math.round((m.w || img.naturalWidth) * k), Math.round((m.h || img.naturalHeight) * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(u);
        this.images.set(id, await createImageBitmap(c));
      } else this.images.set(id, await createImageBitmap(blob));
    }));
  }
  ids() { return Object.keys(this.src); }
  /** A reusable CPU-backed scratch layer (subject cut-outs). Exactly w x h: a canvas
   *  left over from an earlier, larger request rasterised the same layer ±1 differently
   *  (and so a frame depended on which frames the page had drawn before), so the size
   *  must be a pure function of the request, never of the history. */
  layer(w, h) {
    if (!this._layer || this._layer.c.width !== w || this._layer.c.height !== h) {
      const c = new OffscreenCanvas(w, h);
      this._layer = { c, g: c.getContext('2d', { willReadFrequently: true }) };
    }
    return this._layer;
  }
  /** Source frame index shown at composition time t. */
  index(id, t) {
    const m = this.src[id];
    if (!m || m.kind !== 'video') return 0;
    const f = t * (m.speed ?? 1) * m.fps; // frame 1 of the sequence is `start` in the source
    const i = Math.floor(f + 1e-6);
    return m.loop ? mod(i, m.frames) : clamp(i, 0, m.frames - 1);
  }
  /** Fetch every frame needed for these times (all video sources).
   *  `fresh` first drops every cached bitmap (and the cut-outs built from them): the
   *  same video frame drawn from an ImageBitmap that an EARLIER render frame already
   *  drew rasterises up to ±2 channel values differently from a first draw, so a frame
   *  rendered right after its neighbour differed from the same frame rendered cold
   *  ("non-deterministic frames" when workers raced under load). Rendering always starts
   *  from freshly decoded bitmaps, so a frame is independent of what the page drew before. */
  /** Cache key + URL of capture frame idx (kind 'capture': a recorded UI, addressed by exact frame index). */
  captureKey(id, idx) { return id + '#' + idx; }
  captureUrl(id, idx) {
    const m = this.src[id];
    return `${m.url}/${m.pattern.replace(/%0(\d+)d/, (_, n) => String(idx).padStart(Number(n), '0'))}`;
  }
  /** Capture frame idx (clamped), or null if it was not prepared. */
  captureFrame(id, idx) {
    const m = this.src[id];
    if (!m || m.kind !== 'capture') return null;
    return this.cache.get(this.captureKey(id, Math.max(0, Math.min(m.frames - 1, idx | 0)))) ?? null;
  }
  /**
   * `needs`: explicit capture frames [{id, idx}] a scene asked for (its own
   * film-clock → capture-clock map decides them, see scene.mediaNeeds).
   */
  async prepare(times, { fresh = false, needs = null } = {}) {
    if (fresh) {
      for (const b of this.cache.values()) b?.close?.();
      this.cache.clear();
      this.order.length = 0;
      this._cuts.clear();
    }
    const jobs = [];
    for (const [id, m] of Object.entries(this.src)) {
      if (m.kind !== 'video') continue;
      for (const t of times) {
        const idx = this.index(id, Math.max(0, t));
        const key = id + ':' + idx;
        if (this.cache.has(key) || jobs.some((j) => j.key === key)) continue;
        jobs.push({ key, url: `${m.url}/${String(idx + 1).padStart(6, '0')}.jpg` });
        if (m.matte && !this.cache.has(key + ':m')) jobs.push({ key: key + ':m', url: `${m.url}/m${String(idx + 1).padStart(6, '0')}.png` });
      }
    }
    for (const n of needs || []) {
      const m = this.src[n.id];
      if (!m || m.kind !== 'capture') continue;
      const idx = Math.max(0, Math.min(m.frames - 1, n.idx | 0));
      const key = this.captureKey(n.id, idx);
      if (this.cache.has(key) || jobs.some((j) => j.key === key)) continue;
      jobs.push({ key, url: this.captureUrl(n.id, idx) });
    }
    await Promise.all(jobs.map(async (j) => {
      const r = await fetch(j.url);
      if (!r.ok) throw new Error(`media frame ${j.url} → ${r.status}`);
      this.cache.set(j.key, await createImageBitmap(await r.blob()));
      this.order.push(j.key);
    }));
    // bounded by count AND pixels: one 2880×1800 capture frame is 20 MB decoded
    const keep = new Set(jobs.map((j) => j.key));
    const px = () => { let n = 0; for (const b of this.cache.values()) n += (b?.width || 0) * (b?.height || 0); return n; };
    let total = px();
    while (this.order.length > this.limit || (total > this.pixelLimit && this.order.length && !keep.has(this.order[0]))) {
      const k = this.order.shift();
      const b = this.cache.get(k);
      total -= (b?.width || 0) * (b?.height || 0);
      b?.close?.();
      this.cache.delete(k);
    }
  }
  /** The bitmap to show for `id` at time t (null if not prepared/unknown). */
  frame(id, t) {
    const m = this.src[id];
    if (!m) return null;
    if (m.kind === 'image') return this.images.get(id) ?? null;
    return this.cache.get(id + ':' + this.index(id, Math.max(0, t))) ?? null;
  }
  /** Person matte (alpha = subject) for `id` at time t, or null. */
  matte(id, t) {
    const m = this.src[id];
    if (!m || !m.matte) return null;
    return this.cache.get(id + ':' + this.index(id, Math.max(0, t)) + ':m') ?? null;
  }
  /** Template-facing handle. */
  get(id) {
    const m = this.src[id];
    if (!m) throw new Error(`media "${id}" is not declared in spec.media (have: ${this.ids().join(', ') || 'none'})`);
    const hub = this;
    return {
      id, kind: m.kind, w: m.w, h: m.h, duration: m.kind === 'video' ? m.frames / m.fps / (m.speed ?? 1) : Infinity,
      frame: (t) => hub.frame(id, t),
      /** Draw into box {x,y,w,h} with fit 'cover' (default) | 'contain' | 'fill'; focus 0..1 for cover crop. */
      draw(g, t, box, { fit = 'cover', focusX = 0.5, focusY = 0.5 } = {}) {
        const bmp = hub.frame(id, t);
        if (!bmp) return false;
        drawFit(g, bmp, box, fit, focusX, focusY);
        return true;
      },
      hasMatte: !!m.matte,
      matte: (t) => hub.matte(id, t),
      /**
       * Draw ONLY the subject (person) — the frame masked by its matte — so
       * anything drawn before it sits BEHIND the person. Same box/fit as draw().
       * opts.filter applies a CSS filter (e.g. the same grade as the plate).
       */
      subject(g, t, box, { fit = 'cover', focusX = 0.5, focusY = 0.5, filter = null, feather = 0, choke = null } = {}) {
        const bmp = hub.frame(id, t), mt = hub.matte(id, t);
        if (!bmp || !mt) return false;
        // the cut-out is built once per (video frame, filter, feather) at source
        // resolution and reused by every motion-blur sample and any camera box:
        // the result depends only on that key, so seek order cannot change it
        const key = `${hub.index(id, Math.max(0, t))}|${filter || ''}|${feather}|${choke ? `${choke.lo},${choke.hi},${choke.decontam === false ? 0 : 1}` : ''}`;
        let cut = hub._cuts.get(id);
        if (!cut || cut.c.width !== bmp.width || cut.c.height !== bmp.height) {
          const c = new OffscreenCanvas(bmp.width, bmp.height);
          cut = { c, g: c.getContext('2d', { willReadFrequently: true }), key: null };
          hub._cuts.set(id, cut);
        }
        if (cut.key !== key) {
          const lg = cut.g;
          lg.setTransform(1, 0, 0, 1, 0, 0);
          lg.globalCompositeOperation = 'source-over';
          lg.filter = 'none';
          lg.clearRect(0, 0, cut.c.width, cut.c.height);
          lg.filter = filter || 'none';
          lg.drawImage(bmp, 0, 0);
          lg.filter = feather > 0 ? `blur(${feather}px)` : 'none';
          lg.globalCompositeOperation = 'destination-in';
          lg.drawImage(choke ? chokedMatte(mt, cut.c.width, cut.c.height, choke) : mt, 0, 0, cut.c.width, cut.c.height);
          lg.globalCompositeOperation = 'source-over';
          if (choke && choke.decontam !== false) {   // readable window: the edge band carries his colour, not the old room's
            lg.filter = 'none';
            lg.putImageData(decontaminateEdge(lg.getImageData(0, 0, cut.c.width, cut.c.height)), 0, 0);
          }
          lg.filter = 'none';
          cut.key = key;
        }
        drawFit(g, cut.c, box, fit, focusX, focusY);
        return true;
      },
      /**
       * Light that falls ON the subject only: paint(lg, w, h) fills the layer
       * (gradients, colour washes), the matte keeps just the person, and the
       * result is composited with `blend` (default 'screen' = additive light).
       * Rim light from a neon sign, a duotone ink, a projector wash.
       */
      light(g, t, box, paint, { fit = 'cover', focusX = 0.5, focusY = 0.5, blend = 'screen', alpha = 1 } = {}) {
        const mt = hub.matte(id, t);
        if (!mt) return false;
        const L = hub.layer(Math.ceil(box.w), Math.ceil(box.h));
        const lg = L.g;
        lg.setTransform(1, 0, 0, 1, 0, 0);
        lg.globalCompositeOperation = 'source-over';
        lg.filter = 'none';
        lg.globalAlpha = 1;
        lg.clearRect(0, 0, L.c.width, L.c.height);
        lg.save(); lg.translate(-box.x, -box.y); paint(lg, box.w, box.h, box); lg.restore();
        lg.globalCompositeOperation = 'destination-in';
        drawFit(lg, mt, { x: 0, y: 0, w: box.w, h: box.h }, fit, focusX, focusY);
        lg.globalCompositeOperation = 'source-over';
        g.save();
        g.globalCompositeOperation = blend;
        g.globalAlpha = alpha;
        g.drawImage(L.c, 0, 0, box.w, box.h, box.x, box.y, box.w, box.h);
        g.restore();
        return true;
      },
    };
  }
}

export function drawFit(g, bmp, box, fit = 'cover', fx = 0.5, fy = 0.5) {
  const iw = bmp.width, ih = bmp.height;
  if (fit === 'fill') return g.drawImage(bmp, box.x, box.y, box.w, box.h);
  const s = fit === 'contain' ? Math.min(box.w / iw, box.h / ih) : Math.max(box.w / iw, box.h / ih);
  const dw = iw * s, dh = ih * s;
  g.drawImage(bmp, box.x + (box.w - dw) * fx, box.y + (box.h - dh) * fy, dw, dh);
}

/**
 * Choke for a soft person matte: the alpha is re-mapped through a steeper ramp, so the faint outer fringe of the Vision matte (the
 * "halo" of hair / shoulder pixels that still carry the old background) goes to 0 and the solid body stays 1. A pure per-pixel curve:
 * no spatial erosion, so a wisp of hair above `lo` is thinned, never cut off. choke = {lo, hi} in 0..1 (alpha <= lo -> 0, alpha >= hi -> 1).
 */
export function chokeAlpha(a, { lo, hi }) {
  const u = Math.min(1, Math.max(0, (a / 255 - lo) / Math.max(1e-6, hi - lo)));
  return Math.round(u * u * (3 - 2 * u) * 255);
}
export function chokeImageData(img, choke) {
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = chokeAlpha(d[i], choke);
  return img;
}
/**
 * Edge colour decontamination for a choked cut-out. The old room's warm / dark fringe sits in the matte's edge band AND in the first few
 * px of "opaque" pixels inside it (the choke maps alpha >= hi to 1, but those pixels still carry the old background). So: a CORE pixel is
 * alpha >= 250 with no translucent pixel within `band` px; every other visible pixel (alpha > 0) gets the colour of the nearby core pixels
 * (a separable box average of colour weighted by the core, `radius` px). The alpha is NOT touched (hair keeps its coverage); a pixel with
 * no core nearby keeps its colour. img = {data, width, height} RGBA, unpremultiplied.
 */
export function decontaminateEdge(img, { band = 2, radius = 5 } = {}) {
  const { data: d, width: w, height: h } = img, n = w * h;
  const box = (a, rad) => {
    const t = new Float32Array(n), o = new Float32Array(n);
    for (let y = 0; y < h; y++) { let acc = 0; const r0 = y * w;
      for (let x = -rad; x <= rad; x++) if (x >= 0 && x < w) acc += a[r0 + x];
      for (let x = 0; x < w; x++) { t[r0 + x] = acc; const add = x + rad + 1, sub = x - rad; if (add < w) acc += a[r0 + add]; if (sub >= 0) acc -= a[r0 + sub]; } }
    for (let x = 0; x < w; x++) { let acc = 0;
      for (let y = -rad; y <= rad; y++) if (y >= 0 && y < h) acc += t[y * w + x];
      for (let y = 0; y < h; y++) { o[y * w + x] = acc; const add = y + rad + 1, sub = y - rad; if (add < h) acc += t[add * w + x]; if (sub >= 0) acc -= t[sub * w + x]; } }
    return o;
  };
  const T = new Float32Array(n);
  let any = false;
  for (let i = 0, j = 3; i < n; i++, j += 4) if (d[j] < 250) { T[i] = 1; any = true; }
  if (!any) return img;
  const near = box(T, band);
  const S = new Float32Array(n), R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) if (near[i] === 0) { S[i] = 1; R[i] = d[j]; G[i] = d[j + 1]; B[i] = d[j + 2]; }
  const bS = box(S, radius), bR = box(R, radius), bG = box(G, radius), bB = box(B, radius);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    if (d[j + 3] === 0 || near[i] === 0 || bS[i] < 1) continue;
    d[j] = bR[i] / bS[i]; d[j + 1] = bG[i] / bS[i]; d[j + 2] = bB[i] / bS[i];
  }
  return img;
}
let _chokeCanvas = null;
function chokedMatte(mt, w, h, choke) {
  if (!_chokeCanvas || _chokeCanvas.width !== w || _chokeCanvas.height !== h) _chokeCanvas = new OffscreenCanvas(w, h);
  const c = _chokeCanvas.getContext('2d', { willReadFrequently: true });
  c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-over'; c.filter = 'none';
  c.clearRect(0, 0, w, h);
  c.drawImage(mt, 0, 0, w, h);
  c.putImageData(chokeImageData(c.getImageData(0, 0, w, h), choke), 0, 0);
  return _chokeCanvas;
}
