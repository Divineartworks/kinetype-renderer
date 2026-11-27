// ASCII CAM — the footage rendered AS typography. Each output frame the video
// is sampled into a coarse grid; every cell becomes a mono glyph chosen from a
// density ramp (sorted by the glyphs' MEASURED ink coverage, so the tone scale
// is honest), drawn from outlines, tinted in palette inks. Cells punch bigger
// on the beat, a scan band reveals the true video underneath, and a display
// headline carves a clean channel through the field.
import * as K from '../../src/kit/index.js';

const STYLES = ['glyph', 'halftone', 'word-mosaic'];
const STYLE_PALETTE = {
  glyph: {},
  halftone: { bg: '#EDE8DD', ink: '#141414', a: '#D8321E', b: '#141414', mute: '#5F5A51' },
  'word-mosaic': { bg: '#060607', ink: '#F2EFE8', a: '#FFB000', b: '#8A7F6C', mute: '#7D7D7D' },
};

export default {
  id: 'ascii-cam',
  version: '1.1.0',
  name: 'ASCII Cam',
  description:
    'Your footage rendered as live typography: a glyph field that tracks the video, resolution punches on the beat, a scan band that reveals the real picture, and a headline carving through the field.',
  tags: ['footage', 'music-video', 'glitch', 'type', 'social', 'intro'],
  formats: ['vertical', 'square', 'portrait', 'landscape'],
  bpm: 100,
  duration: 16,
  loop: false,
  palette: { bg: '#07080A', ink: '#EDEBE4', a: '#FF4D2E', b: '#3FD6C6', mute: '#7D7D7D' },
  paletteRoles: { bg: 'ground', ink: 'highlight glyphs, headline', a: 'accent: scan band edges, headline rule', b: 'duotone shadows', mute: 'labels' },
  fonts: {
    glyph: { family: 'IBM Plex Mono', weight: 700 },
    display: { family: 'Anton', weight: 400 },
    label: { family: 'IBM Plex Mono', weight: 500 },
  },
  params: {
    media: 'clip',
    cell: 13,
    aspect: 1.6,
    lo: 0.06,
    hi: 0.9,
    gamma: 0.9,
    punch: 0.45,
    scan: true,
    levels: 'auto',
    detail: 1.4,
    tracking: { display: -5, label: 120 },
    style: 'glyph',
  },
  schema: {
    content: {
      type: 'object',
      additionalProperties: false,
      properties: {
        headline: { type: 'string', maxLength: 24, description: '1–3 words that carve through the glyph field' },
        sub: { type: 'string', maxLength: 48, description: 'Small mono line under the headline' },
        ramp: { type: 'string', minLength: 3, maxLength: 40, description: 'Glyphs to render with (any order: sorted by measured ink coverage). Default " .·:;-=+*x%#@"' },
        mode: { enum: ['duotone', 'mono'], description: 'duotone: cool shadows, bright highlights; mono: one ink, tone by glyph density and alpha' },
      },
    },
    params: {
      type: 'object',
      additionalProperties: false,
      properties: {
        media: { type: 'string' },
        cell: { type: 'number', minimum: 6, maximum: 48, description: 'Base cell width in px at 1080' },
        aspect: { type: 'number', minimum: 1, maximum: 2.6, description: 'Cell height / width' },
        lo: { type: 'number', minimum: 0, maximum: 0.5 },
        hi: { type: 'number', minimum: 0.5, maximum: 1 },
        gamma: { type: 'number', minimum: 0.3, maximum: 2.5 },
        punch: { type: 'number', minimum: 0, maximum: 2, description: 'Beat resolution punch (cell growth)' },
        scan: { type: 'boolean', description: 'Scan band revealing the real video every 2 bars' },
        levels: { enum: ['auto', 'fixed'], description: 'auto: per-frame 2–98% percentile levels; fixed: params.lo/hi' },
        detail: { type: 'number', minimum: 0, maximum: 4, description: 'Local-contrast boost (edges, features)' },
        tracking: { type: 'object', properties: { display: { type: 'number' }, label: { type: 'number' } }, additionalProperties: false },
        style: { enum: STYLES, description: 'glyph (density-ramp ASCII, duotone) | halftone (newsprint dots on paper, dot size = shadow, red registration band) | word-mosaic (the portrait is built from the headline\'s own letters, sized by brightness)' },
      },
    },
  },
  example: {
    template: 'ascii-cam',
    name: 'ascii-cam',
    format: 'vertical',
    bpm: 100,
    seed: 3,
    duration: 10,
    media: { clip: { src: '../fixtures/footage-abstract.mp4', loop: true } },
    content: { headline: 'SIGNAL', sub: 'KINETYPE — ASCII CAM', mode: 'duotone' },
  },
  notes: 'Needs spec.media (id params.media, default "clip"). Best on footage with a clear subject and light: faces read at cell 11–14. Duration defaults to 16s (set spec.duration to match your clip).',

  build(ctx) {
    const { W, H, params, content: C, fonts, beat, fps, qa, seed } = ctx;
    const style = STYLES.includes(params.style) ? params.style : 'glyph';
    const userPal = ctx.spec.palette || {};
    for (const [k, v] of Object.entries(STYLE_PALETTE[style])) if (!(k in userPal)) ctx.palette[k] = v;
    const P = ctx.palette;
    const clip = ctx.media.get(params.media);
    const fG = fonts.get('glyph'), fD = fonts.get('display'), fL = fonts.get('label');
    const unit = Math.min(W, H) / 1080;
    const M = Math.round(Math.min(W, H) * 0.06);
    const cx = W / 2, cy = H / 2;
    const duration = ctx.duration;
    const spb = beat.beatLen(0);
    const mode = C.mode || 'duotone';

    // ── the ramp, sorted by measured ink coverage of THIS font's glyphs ────────
    const rampChars = [...new Set([...(C.ramp || ' .·:;-=+*x%#@')])];
    const cov = (() => {
      const S = 48, c = new OffscreenCanvas(S, S), g = c.getContext('2d', { willReadFrequently: true });
      return rampChars.map((ch) => {
        const gl = fG.glyph(ch);
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, S, S);
        if (gl.hasInk) {
          const s = S / fG.upm;
          g.setTransform(s, 0, 0, s, (S - gl.adv * s) / 2, S * 0.78);
          g.fillStyle = '#fff';
          g.fill(gl.path2d);
        }
        const d = g.getImageData(0, 0, S, S).data;
        let a = 0;
        for (let i = 3; i < d.length; i += 4) a += d[i];
        return { ch, gl, a };
      });
    })();
    const ramp = cov.sort((x, y) => x.a - y.a);
    qa.note(`ramp by ink coverage: "${ramp.map((r) => r.ch).join('')}"`);

    // ── cell size: base, intro drop from huge, beat punches (stacked springs) ──
    const base = params.cell * unit;
    const cellTrack = new K.Track(base * 7).spring(0.05, base, { f: 1.1, z: 0.9 });
    const nBeats = Math.floor(duration / spb);
    for (let n = 2; n < nBeats; n++) {
      const t0 = beat.t(n);
      if (t0 > duration - spb) break;
      const amp = n % 4 === 0 ? params.punch : params.punch * 0.45;
      cellTrack.ease(t0, 0.02, base * (1 + amp), K.linear).spring(t0 + 0.02, base, { f: 2.6, z: 0.85 });
      qa.hit(t0, n % 4 === 0 ? 'bar punch' : 'beat punch');
    }
    // outro: resolution collapses into big blocks and dissolves
    const tOut = duration - spb * 2;
    cellTrack.spring(tOut, base * 9, { f: 0.9, z: 1 });

    // ── headline + sub ─────────────────────────────────────────────────────────
    const tall = ctx.aspect === 'vertical';
    const hl = (C.headline || '').trim();
    const hWords = hl ? hl.split(/\s+/) : [];
    const hLines = hWords.length > 1 && tall ? hWords : hWords.length ? [hWords.join(' ')] : [];
    const IW = W - 2 * M;
    const hRuns = hLines.map((l) => K.shape(fD, l, { size: K.fitSize(fD, l, IW * (tall ? 0.9 : 0.8), { tracking: params.tracking.display }), tracking: params.tracking.display }));
    let hSize = hRuns.length ? Math.min(...hRuns.map((r) => r.size)) : 0;
    const capMax = H * (tall ? 0.16 : 0.24);
    if (hRuns.length) hSize = Math.min(hSize, (capMax * fD.upm) / fD.capHeight);
    const hR = hLines.map((l) => K.shape(fD, l, { size: hSize, tracking: params.tracking.display }));
    const hGap = Math.round(14 * unit);
    const hH = hR.length ? K.stackHeight(hR, hGap) : 0;
    const hBases = hR.length ? K.stackInk(hR, { top: Math.round(cy - hH / 2), gap: hGap, grid: 2 }) : [];
    const hX = (r) => cx - (r.inkLeft + r.inkRight) / 2;
    const tHead = beat.t(8);
    hR.forEach((r, i) => qa.text(`headline-${i}`, { box: K.runBox(r, hX(r), hBases[i]), size: r.capPx, fg: P.ink, bg: P.bg }));
    if (hR.length) qa.hit(tHead, 'headline');
    const subRun = C.sub ? K.shape(fL, C.sub.toUpperCase(), { size: 26 * unit, tracking: params.tracking.label, kerning: 'metric' }) : null;
    const subY = hR.length ? hBases[hBases.length - 1] + 64 * unit : H - M;
    if (subRun) qa.text('sub', { box: K.runBox(subRun, cx - subRun.advance / 2, subY), size: subRun.capPx, fg: P.ink, bg: P.bg });

    // ── sampler: one tiny CPU canvas; result cached per output frame ──────────
    const sampler = new OffscreenCanvas(8, 8);
    const sg = sampler.getContext('2d', { willReadFrequently: true });
    let memo = { key: null, bmp: null, buckets: null, cellW: 0, cellH: 0 };
    const NB = 4; // tone buckets (alpha / ink steps)
    const mosaicChars = [...((C.headline || 'KINETYPE').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'KINETYPE')];
    function field(tq, t) {
      // memo is keyed by time AND the decoded frame: a draw before the frame
      // was fetched (engine warm-up) must never be reused once it exists.
      // Fallback to t: a still at an off-grid time only has frame(t) prepared.
      const bmp = clip.frame(tq) || clip.frame(t);
      if (memo.key === tq && memo.bmp === bmp) return memo;
      const cellW = Math.max(4, cellTrack.at(tq)) * (style === 'halftone' ? 1.25 : style === 'word-mosaic' ? 1.1 : 1);
      const cellH = style === 'halftone' ? cellW : cellW * (style === 'word-mosaic' ? 1.3 : params.aspect);
      const cols = Math.ceil(W / cellW) + 1, rows = Math.ceil(H / cellH) + 1;
      sampler.width = cols;
      sampler.height = rows;
      if (!bmp) { memo = { key: tq, bmp, buckets: null, cellW, cellH }; return memo; }
      sg.imageSmoothingEnabled = true;
      sg.imageSmoothingQuality = 'high';
      // cover-fit the frame into the grid (cells are not square)
      const s = Math.max((cols * cellW) / bmp.width, (rows * cellH) / bmp.height);
      const dw = (bmp.width * s) / cellW, dh = (bmp.height * s) / cellH;
      sg.clearRect(0, 0, cols, rows);
      sg.drawImage(bmp, (cols - dw) / 2, (rows - dh) / 2, dw, dh);
      const d = sg.getImageData(0, 0, cols, rows).data;
      const buckets = Array.from({ length: NB }, () => new Path2D());
      const gs = cellW / (fG.glyph('M').adv || fG.upm * 0.6);
      // luminance grid
      const N = cols * rows, L = new Float32Array(N);
      for (let k = 0; k < N; k++) L[k] = (0.2126 * d[k * 4] + 0.7152 * d[k * 4 + 1] + 0.0722 * d[k * 4 + 2]) / 255;
      // auto-levels: the frame's own 2nd–98th percentile spans the ramp, so a
      // bright window cannot flatten the subject into one mid-grey texture
      let lo = params.lo, hi = params.hi;
      if (params.levels !== 'fixed') {
        const sorted = Float32Array.from(L).sort();
        lo = sorted[Math.floor(N * 0.02)];
        hi = sorted[Math.floor(N * 0.98)];
      }
      const range = Math.max(0.08, hi - lo);
      // local contrast: l + detail·(l − box-blur(l)) brings out eyes, jaw, edges
      const R = Math.max(1, Math.round(3 * (base / cellW)));
      const Bl = new Float32Array(N);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          let sum = 0, cnt = 0;
          for (let dy = -R; dy <= R; dy++) {
            const rr = r + dy;
            if (rr < 0 || rr >= rows) continue;
            for (let dx = -R; dx <= R; dx++) {
              const cc = c + dx;
              if (cc < 0 || cc >= cols) continue;
              sum += L[rr * cols + cc]; cnt++;
            }
          }
          Bl[r * cols + c] = sum / cnt;
        }
      }
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const k = r * cols + c;
          const lum = L[k] + params.detail * (L[k] - Bl[k]);
          const l = Math.pow(K.clamp((lum - lo) / range), params.gamma);
          if (style === 'halftone') {
            // newsprint: dot AREA carries the shadow tone
            const tone = 1 - l;
            if (tone < 0.04) continue;
            const rad = Math.min(cellW * 0.62, cellW * 0.56 * Math.sqrt(tone));
            const bk = Math.min(NB - 1, Math.floor(tone * NB));
            const x = c * cellW + cellW / 2, y = r * cellH + cellH / 2;
            buckets[bk].moveTo(x + rad, y);
            buckets[bk].arc(x, y, rad, 0, Math.PI * 2);
            continue;
          }
          if (style === 'word-mosaic') {
            // the picture is written in the headline's own letters
            if (l < 0.07) continue;
            const ch = mosaicChars[(r * cols + c) % mosaicChars.length];
            const gl2 = fG.glyph(ch);
            if (!gl2.hasInk) continue;
            const sz = gs * (0.12 + 1.05 * l); // strong size contrast so the portrait reads
            const bk = Math.min(NB - 1, Math.floor(l * NB));
            const gx = c * cellW + (cellW - gl2.adv * sz) / 2, gy = r * cellH + cellH * 0.5 + (fG.capHeight * sz) / 2;
            buckets[bk].addPath(gl2.path2d, new DOMMatrix().translate(gx, gy).scale(sz, sz));
            continue;
          }
          const gi = Math.min(ramp.length - 1, Math.floor(l * ramp.length));
          const gl = ramp[gi].gl;
          if (!gl.hasInk) continue;
          const bk = Math.min(NB - 1, Math.floor(l * NB));
          buckets[bk].addPath(gl.path2d, new DOMMatrix().translate(c * cellW, r * cellH + cellH * 0.78).scale(gs, gs));
        }
      }
      memo = { key: tq, bmp, buckets, cellW, cellH };
      return memo;
    }
    const inks = style === 'halftone'
      ? [[P.ink, 1], [P.ink, 1], [P.ink, 1], [P.ink, 1]]
      : style === 'word-mosaic'
        ? [[P.b, 0.55], [P.b, 1], [P.ink, 0.85], [P.ink, 1]]
        : mode === 'mono'
      ? [[P.ink, 0.28], [P.ink, 0.5], [P.ink, 0.75], [P.ink, 1]]
      : [[P.b, 0.55], [P.b, 0.9], [P.ink, 0.8], [P.ink, 1]];

    // scan band: every 2 bars sweeps top→bottom over 2 beats
    const scanAt = (t) => {
      if (!params.scan) return null;
      const period = spb * 8, t0 = spb * 4;
      if (t < t0 || t > tOut) return null;
      const ph = (t - t0) % period;
      if (ph > spb * 2) return null;
      const u = K.cubicInOut(ph / (spb * 2));
      const bh = H * 0.2;
      return { y: -bh + (H + bh) * u, h: bh };
    };
    for (let t = spb * 4; t < tOut; t += spb * 8) qa.hit(t, 'scan');

    // ── keyframes ─────────────────────────────────────────────────────────────
    [[0, 'open'], [0.5, 'resolution drop'], [spb * 3.05, 'beat punch'], [spb * 5, 'scan'], [tHead + 0.25, 'headline slam'],
      [tHead + spb * 2, 'headline hold'], [spb * 13, 'scan 2'], [tOut + spb * 0.8, 'outro blocks'], [duration - 1 / fps, 'last frame']]
      .filter(([t]) => t < duration).forEach(([t, l]) => qa.keyframe(t, l));

    return {
      duration,
      draw(g, t) {
        const tq = K.frameQuant(t, fps); // one glyph field per output frame (no double exposure)
        const f = field(tq, t);
        const outA = 1 - K.clamp((t - tOut) / (spb * 2));
        if (f.buckets) {
          f.buckets.forEach((p, i) => {
            g.globalAlpha = inks[i][1] * outA;
            g.fillStyle = inks[i][0];
            g.fill(p);
          });
          g.globalAlpha = 1;
        }
        // scan band: the real picture, framed by accent hairlines
        const sc = scanAt(tq);
        if (sc) {
          g.save();
          g.beginPath(); g.rect(0, sc.y, W, sc.h); g.clip();
          if (style === 'halftone') g.filter = 'grayscale(1) contrast(1.25)';
          clip.draw(g, tq, { x: 0, y: 0, w: W, h: H });
          g.restore();
          K.bar(g, 0, sc.y, W, 2 * unit, P.a);
          K.bar(g, 0, sc.y + sc.h - 2 * unit, W, 2 * unit, P.a);
        }
        // headline carves a channel through the field, then sits in it
        if (hR.length && t >= tHead) {
          hR.forEach((r, i) => {
            const x = hX(r), y = hBases[i];
            let k = 0;
            const each = () => {
              const d = t - tHead - (k++) * spb / 8;
              if (d <= 0) return { hidden: true };
              const p = K.springStep(d, 3, 0.6);
              return { s: 1 + (1 - p) * 0.9, alpha: K.clamp(p * 3) };
            };
            // the carve: a thick ground-coloured outline clears the glyphs around the letters
            k = 0;
            K.drawRun(g, r, x, y, { fill: P.bg, stroke: P.bg, strokeWidth: 26 * unit, fillToo: true, each });
            k = 0;
            K.drawRun(g, r, x, y, { fill: P.ink, each });
          });
          const rp = K.springStep(t - tHead - spb, 2.4, 0.9);
          if (rp > 0 && hR.length) {
            const last = hR[hR.length - 1];
            const rw = last.inkWidth * K.clamp(rp);
            K.bar(g, cx - rw / 2, hBases[hBases.length - 1] + 22 * unit, rw, 5 * unit, P.a);
          }
          if (subRun) {
            const a = K.clamp(K.springStep(t - tHead - spb * 1.5, 3, 1));
            if (a > 0.01) {
              // a clean slot for the sub line: ground plate the width of the run
              const pad = 14 * unit;
              g.globalAlpha = a;
              g.fillStyle = P.bg;
              g.fillRect(cx - subRun.advance / 2 - pad, subY - subRun.capPx - pad, subRun.advance + pad * 2, subRun.capPx + pad * 2);
              g.globalAlpha = 1;
            }
            K.drawRun(g, subRun, cx - subRun.advance / 2, subY, { fill: P.ink, alpha: a });
          }
        }
        // corner labels
        const lab = K.shape(fL, `${Math.round(W / (f.cellW || base))}×${Math.round(H / (f.cellH || base))} · ${tq.toFixed(2)}S`, { size: 16 * unit, tracking: params.tracking.label, kerning: 'metric' });
        K.drawRun(g, lab, M, M, { fill: P.mute, alpha: outA });
      },
    };
  },
};
