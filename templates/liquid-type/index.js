// LIQUID TYPE — typography as a liquid signal.
// Each line is rasterised once into a band, then redrawn every frame as thin
// horizontal slices displaced by a smooth flow field (sines + seeded value
// noise). Beats send shock waves travelling down the frame; the inks split
// into pink/cyan channels while the type is moving and fuse back to one ink
// the instant it settles — springs bring the displacement to EXACTLY zero, so
// the rest frames are pixel-crisp type. Lines change by melting: the outgoing
// line drips down in viscous columns, the incoming one condenses up.
import * as K from '../../src/kit/index.js';

const STYLES = ['signal', 'mercury', 'heat-haze'];
const STYLE_PALETTE = {
  signal: {},
  mercury: { bg: '#060708', ink: '#E6E9EE', a: '#FFFFFF', b: '#8E97A3', dim: '#80868E' },
  'heat-haze': { bg: '#150904', ink: '#FFE8CF', a: '#FF7417', b: '#FFC53D', dim: '#9A7B63' },
};
// motion character per style
const STYLE_CFG = {
  signal: { time: 1, freq: 1, amp: 1, shock: 1, chroma: 1, melt: 'down', chrome: false },
  mercury: { time: 0.45, freq: 0.55, amp: 1.5, shock: 1.25, chroma: 0, melt: 'down', chrome: true },
  'heat-haze': { time: 2.4, freq: 3.2, amp: 0.28, shock: 0.35, chroma: 0.35, melt: 'up', chrome: false },
};

export default {
  id: 'liquid-type',
  version: '1.1.0',
  name: 'Liquid Type',
  description:
    'Hypnotic liquid typography: lines ripple as a displaced signal, beat shock waves travel down the frame, inks split into channels in motion and fuse back into perfectly crisp type at rest; lines melt out in viscous drips and condense in.',
  tags: ['liquid', 'distortion', 'signal', 'music', 'promo', 'intro', 'wow'],
  formats: ['square', 'vertical', 'landscape', 'portrait'],
  bpm: 110,
  duration: 16,
  loop: false,
  palette: { bg: '#0A0B0F', ink: '#F2F4F3', a: '#FF3D6E', b: '#3DE8E0', dim: '#8C8C8C' },
  paletteRoles: { bg: 'background', ink: 'type', a: 'channel split (warm)', b: 'channel split (cool)', dim: 'labels (neutral)' },
  fonts: {
    display: { family: 'Unbounded', weight: 800 },
    mono: { family: 'IBM Plex Mono', weight: 500 },
  },
  params: {
    lineBeats: 8,
    finalBeats: 6,
    amplitude: 0.055,
    shock: 0.09,
    chroma: 0.45,
    slice: 3,
    tracking: -20,
    labels: true,
    glow: 0,
    style: 'signal',
  },
  schema: {
    content: {
      type: 'object',
      additionalProperties: false,
      required: ['lines'],
      properties: {
        lines: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 32 }, description: 'Lines of 1–4 words, shown one at a time.' },
        final: { type: 'string', maxLength: 32, description: 'Optional last line held crisp at the end.' },
        label: { type: 'string', maxLength: 40, description: 'Optional mono label (top-left).' },
      },
    },
    params: {
      type: 'object',
      additionalProperties: false,
      properties: {
        lineBeats: { type: 'number', minimum: 5, maximum: 16 },
        finalBeats: { type: 'number', minimum: 2, maximum: 16 },
        amplitude: { type: 'number', minimum: 0, maximum: 0.2, description: 'Flow displacement (fraction of frame width)' },
        shock: { type: 'number', minimum: 0, maximum: 0.3, description: 'Beat shock-wave displacement' },
        chroma: { type: 'number', minimum: 0, maximum: 1.5, description: 'Channel split per px of displacement' },
        slice: { type: 'integer', minimum: 1, maximum: 12, description: 'Slice height in px (at 1080)' },
        tracking: { type: 'number' },
        glow: { type: 'number', minimum: 0, maximum: 1, description: 'Neon bloom around the type (0 = off): soft outer glow plus a tight halo, tinted toward palette.a' },
        labels: { type: 'boolean' },
        style: { enum: STYLES, description: 'signal (pink/cyan channel split, drips) | mercury (liquid chrome: metallic gradient, specular band, slow viscous flow) | heat-haze (warm fine shimmer, type evaporates upward)' },
      },
    },
  },
  example: {
    template: 'liquid-type',
    format: 'square',
    fps: 60,
    bpm: 110,
    seed: 4,
    content: { lines: ['STAY LIQUID', 'BEND THE SIGNAL', 'NEVER STATIC'], final: 'KINETYPE', label: 'SIGNAL / 04' },
  },
  notes: 'Each line: condense in (1 beat) → crisp (1) → liquid with beat shocks (4) → crisp (1) → melt out (1). Duration derives from the line count unless spec.duration is set.',

  build(ctx) {
    const { W, H, params, content: C, fonts, beat, seed, qa, fps } = ctx;
    const style = STYLES.includes(params.style) ? params.style : 'signal';
    const userPal = ctx.spec.palette || {};
    for (const [k, v] of Object.entries(STYLE_PALETTE[style])) if (!(k in userPal)) ctx.palette[k] = v;
    const P = ctx.palette;
    const SC = STYLE_CFG[style];
    const fD = fonts.get('display'), fM = fonts.get('mono');
    const unit = Math.min(W, H) / 1080;
    const M = Math.round(Math.min(W, H) * 0.075);
    const tall = ctx.aspect === 'vertical';
    // vertical: keep type clear of the Shorts/Reels right-hand rail and the caption band
    const MR = tall ? Math.round(W * 0.14) : M;
    const IW = W - M - MR;
    const cx = M + IW / 2, cy = tall ? Math.round(H * 0.45) : H / 2;
    const B = (n) => beat.t(n);
    const q = (t) => K.frameQuant(t, fps);
    const lines = [...C.lines, ...(C.final ? [C.final] : [])];
    const LB = params.lineBeats;

    // ── layout: each line centred; long/tall lines stack into 2–3 rows ──
    const blocks = lines.map((text) => {
      const words = text.trim().split(/\s+/);
      let rows = [text];
      if (words.length > 1) {
        const probe = K.shape(fD, text, { size: 100, tracking: params.tracking });
        const ratio = probe.inkWidth / probe.capPx;
        if (tall ? ratio > 4 : ratio > 9) rows = K.balanceLines(fD, text, IW * (tall ? 0.55 : 0.6), { size: 100, tracking: params.tracking });
      }
      const capMax = H * (tall ? 0.1 : 0.2);
      const runs = rows.map((r) => {
        const s = Math.min(K.fitSize(fD, r, IW, { tracking: params.tracking }), (capMax * fD.upm) / fD.capHeight);
        return K.shape(fD, r, { size: s, tracking: params.tracking });
      });
      // equalise: every row at the smallest size so the block reads as one voice
      const size = Math.min(...runs.map((r) => r.size));
      const eq = rows.map((r) => K.shape(fD, r, { size, tracking: params.tracking }));
      const gap = eq[0].capPx * 0.34;
      const h = K.stackHeight(eq, gap);
      const bases = K.stackInk(eq, { top: cy - h / 2, gap, grid: 1 });
      const placed = eq.map((r, i) => ({ run: r, x: cx - r.inkWidth / 2 - r.inkLeft, y: bases[i] }));
      const pad = Math.round(eq[0].capPx * 0.45);
      const top = Math.floor(Math.min(...placed.map((p) => p.y + p.run.inkTop)) - pad);
      const bot = Math.ceil(Math.max(...placed.map((p) => p.y + p.run.inkBottom)) + pad);
      return { text, rows, runs: eq, placed, top, bot, cap: eq[0].capPx };
    });

    // ── timeline ──
    const segs = lines.map((_, i) => {
      const b0 = i * LB;
      const last = i === lines.length - 1;
      return {
        i, last,
        tIn: B(b0), tCrisp1: B(b0 + 1), tLiquid: B(b0 + 2), tCrisp2: B(b0 + 6), tOut: B(b0 + 7),
        tEnd: last ? B(b0 + 5 + params.finalBeats) : B(b0 + LB),
        nShock: last ? 2 : 4,
      };
    });
    // the last line: in → crisp → liquid (short) → crisp until the end
    const lastSeg = segs[segs.length - 1];
    if (lastSeg) {
      lastSeg.tCrisp2 = B((lines.length - 1) * LB + 5);
      lastSeg.tOut = Infinity;
    }
    const duration = ctx.spec.duration ?? lastSeg.tEnd;
    // energy tracks: up on the liquid beat, back to EXACTLY 0 before crisp
    const energy = segs.map((s) => new K.Track(0).spring(s.tLiquid, 1, { f: 1.6, z: 0.9 }).spring(s.tCrisp2 - B(1) * 0 - 0.9, 0, { f: 2.6, z: 1 }));

    // ── QA ──
    blocks.forEach((bk, i) => {
      const x0 = Math.min(...bk.placed.map((p) => p.x + p.run.inkLeft)), x1 = Math.max(...bk.placed.map((p) => p.x + p.run.inkRight));
      qa.text('line-' + i, { box: { x0, y0: bk.top + bk.cap * 0.45, x1, y1: bk.bot - bk.cap * 0.45 }, size: bk.cap, fg: P.ink, bg: P.bg, lines: bk.rows, orphanOk: true });
    });
    segs.forEach((s) => {
      qa.hit(s.tIn, 'condense');
      qa.hit(s.tCrisp1, 'crisp');
      for (let b = 0; b < s.nShock; b++) qa.hit(s.tLiquid + b * beat.spb, 'shock');
      if (!s.last) { qa.hit(s.tCrisp2, 'settle'); qa.hit(s.tOut, 'melt'); }
    });
    if (params.labels) qa.text('labels', { box: { x0: M, y0: M, x1: W - M, y1: H - M }, size: 11 * unit, fg: P.dim, bg: P.bg, decorative: true });
    const kf = [[0.02, 'condensing'], [segs[0].tIn + beat.spb * 0.45, 'condense mid'], [segs[0].tCrisp1 + 0.1, 'crisp'], [segs[0].tLiquid + beat.spb * 0.9, 'liquid'], [segs[0].tLiquid + beat.spb * 2.2, 'shock wave'], [segs[0].tCrisp2 + 0.2, 'settled crisp']];
    if (segs[1]) kf.push([segs[0].tOut + beat.spb * 0.5, 'melting'], [segs[1].tIn + beat.spb * 0.5, 'condense 2'], [segs[1].tLiquid + beat.spb * 1.6, 'liquid 2']);
    if (segs[2]) kf.push([segs[1].tOut + beat.spb * 0.7, 'drip 2'], [segs[2].tLiquid + beat.spb * 2.5, 'liquid 3']);
    kf.push([lastSeg.tLiquid + beat.spb * 0.8, 'final liquid'], [duration - 1 / fps, 'last frame']);
    kf.filter(([t]) => t < duration).forEach(([t, l]) => qa.keyframe(t, l));

    // ── band rasters: one CPU canvas per ink for the CURRENT line only ──
    const cache = { i: -1, layers: null };
    function layersFor(i) {
      if (cache.i === i) return cache.layers;
      const bk = blocks[i];
      const bh = bk.bot - bk.top;
      const mk = (fill) => {
        const c = new OffscreenCanvas(W, bh);
        const g = c.getContext('2d', { willReadFrequently: true });
        g.translate(0, -bk.top);
        for (const p of bk.placed) {
          let f = fill;
          if (fill === 'chrome') {
            // liquid chrome: each row gets its own horizon — sky above, a hard
            // dark reflection line, ground light below
            // drawRun fills after translating to the run's baseline, so the
            // gradient lives in baseline space: cap top = -capPx, baseline = 0
            f = g.createLinearGradient(0, -p.run.capPx, 0, 0);
            f.addColorStop(0, '#FFFFFF'); f.addColorStop(0.42, '#B9C0CA'); f.addColorStop(0.5, '#3A4048');
            f.addColorStop(0.58, '#6F7884'); f.addColorStop(1, '#EEF1F5');
          }
          K.drawRun(g, p.run, p.x, p.y, { fill: f });
        }
        return c;
      };
      cache.i = i;
      cache.layers = { ink: mk(SC.chrome ? 'chrome' : P.ink), a: mk(P.a), b: mk(P.b), bh };
      return cache.layers;
    }

    // smooth 1-D value noise (cosine-interpolated seeded lattice)
    const vn = (x, key) => {
      const i = Math.floor(x), f = x - i;
      const a = K.noise1(seed, key, i), b = K.noise1(seed, key, i + 1);
      const u = (1 - Math.cos(Math.PI * f)) / 2;
      return a + (b - a) * u;
    };
    const amp = params.amplitude * W * SC.amp;
    const flow = (y, t) => {
      const fy = y * SC.freq, ft = t * SC.time;
      return 0.55 * Math.sin(fy * 0.019 / unit + ft * 2.4) + 0.3 * Math.sin(fy * 0.043 / unit - ft * 3.3 + 1.7) + 0.5 * (vn(fy * 0.011 / unit + ft * 0.8, 'vn') - 0.5) * 2;
    };
    function shockAt(yAbs, t, s) {
      let d = 0;
      for (let b = 0; b < s.nShock; b++) {
        const tb = s.tLiquid + b * beat.spb, dt = t - tb;
        if (dt < 0 || dt > 1.6) continue;
        const front = -H * 0.15 + dt * H * 1.25;
        const z = (yAbs - front) / (70 * unit);
        d += Math.exp(-z * z) * Math.sin(z * 2.2) * Math.exp(-dt * 1.7) * (b % 2 ? -1 : 1);
      }
      return d * params.shock * SC.shock * W;
    }

    function drawLiquid(g, i, t, s) {
      const L = layersFor(i), bk = blocks[i];
      const E = energy[i].at(t);
      const hasShock = t >= s.tLiquid && t < s.tLiquid + (s.nShock - 1) * beat.spb + 1.6;
      if (E === 0 && !hasShock) {
        g.drawImage(L.ink, 0, bk.top);
        return;
      }
      const sh = Math.max(1, Math.round(params.slice * unit));
      const rows = Math.ceil(L.bh / sh);
      const dx = new Float64Array(rows);
      let maxd = 0;
      for (let r = 0; r < rows; r++) {
        const yAbs = bk.top + r * sh + sh / 2;
        dx[r] = E * amp * flow(yAbs, t) + (hasShock ? shockAt(yAbs, t, s) : 0);
        maxd = Math.max(maxd, Math.abs(dx[r]));
      }
      if (maxd < 0.01) { g.drawImage(L.ink, 0, bk.top); return; }
      const ch = params.chroma * SC.chroma;
      g.save();
      g.globalCompositeOperation = 'lighten';
      for (const [layer, sign] of SC.chroma > 0 ? [[L.b, -1], [L.a, 1]] : []) {
        g.globalAlpha = 0.9;
        for (let r = 0; r < rows; r++) {
          const off = dx[r] + sign * (Math.abs(dx[r]) * ch + E * 3 * unit);
          g.drawImage(layer, 0, r * sh, W, sh, off, bk.top + r * sh, W, sh);
        }
      }
      g.globalAlpha = 1;
      for (let r = 0; r < rows; r++) g.drawImage(L.ink, 0, r * sh, W, sh, dx[r], bk.top + r * sh, W, sh);
      if (SC.chrome && E > 0.02) {
        // a specular band travels down the liquid chrome with the flow
        const yb = bk.top + K.mod(t * 0.35, 1.4) / 1.4 * (L.bh + 120 * unit) - 60 * unit;
        for (let r = 0; r < rows; r++) {
          const yr = bk.top + r * sh;
          const w = Math.exp(-(((yr - yb) / (22 * unit)) ** 2));
          if (w < 0.05) continue;
          g.globalAlpha = 0.85 * w * E;
          g.drawImage(L.a, 0, r * sh, W, sh, dx[r], yr, W, sh);
        }
        g.globalAlpha = 1;
      }
      g.restore();
    }

    // vertical-slice melts
    const colW = Math.max(2, Math.round(4 * unit));
    function drawMelt(g, i, t, mode, t0, dur) {
      const L = layersFor(i), bk = blocks[i];
      const cols = Math.ceil(W / colW);
      const u = K.clamp((t - t0) / dur);
      g.save();
      g.globalCompositeOperation = 'lighten';
      for (let c = 0; c < cols; c++) {
        const x = c * colW;
        // low-frequency field: neighbouring columns move together, like a liquid surface
        const n = vn(c * 0.028 + (mode === 'out' ? 3 : 11), mode === 'out' ? 'drip' : 'rise');
        const n2 = vn(c * 0.11, 'fine' + mode) * 0.25;
        if (mode === 'out' && SC.melt === 'up') {
          // heat haze: the type evaporates — columns rise, stretch thin and fade
          const sp = 0.4 + 0.5 * n + n2;
          const e = Math.pow(u, 1.5) * sp;
          const dy = -e * H * 0.35;
          const alpha = 1 - Math.pow(u, 1.6);
          if (alpha <= 0.002) continue;
          g.globalAlpha = alpha * 0.7;
          g.drawImage(L.a, x, 0, colW, L.bh, x, bk.top + dy * 1.3 - L.bh * e, colW, L.bh * (1 + e * 1.6));
          g.globalAlpha = alpha;
          g.drawImage(L.ink, x, 0, colW, L.bh, x, bk.top + dy, colW, L.bh * (1 - e * 0.3));
          continue;
        }
        if (mode === 'out') {
          const sp = 0.3 + 0.55 * n + n2;
          const e = Math.pow(u, 1.7) * sp;
          const dy = e * H * 0.5, sy = 1 + e * 2.2;
          const alpha = 1 - Math.pow(u, 2.4);
          if (alpha <= 0.002) continue;
          // pink drip tails: the pink layer hangs a little further than the ink
          g.globalAlpha = alpha * 0.85;
          g.drawImage(L.a, x, 0, colW, L.bh, x, bk.top + dy * 1.12, colW, L.bh * (1 + e * 2.9));
          g.globalAlpha = alpha;
          g.drawImage(L.ink, x, 0, colW, L.bh, x, bk.top + dy, colW, L.bh * sy);
        } else {
          const delay = (n * 0.8 + n2) * dur * 0.5;
          const p = K.springStep(t - t0 - delay, 2.4, 0.8);
          const dy = (1 - p) * H * 0.2;
          const sy = 1 + Math.max(0, 1 - p) * 0.6;
          const alpha = K.clamp(p * 2.2);
          if (alpha <= 0.002) continue;
          g.globalAlpha = alpha * 0.8;
          g.drawImage(L.b, x, 0, colW, L.bh, x, bk.top + dy * 1.25, colW, L.bh * (sy + (1 - K.clamp(p)) * 0.3));
          g.globalAlpha = alpha;
          g.drawImage(L.ink, x, 0, colW, L.bh, x, bk.top + dy, colW, L.bh * sy);
        }
      }
      g.restore();
    }

    const lab = (s) => K.shape(fM, s, { size: 16 * unit, tracking: 20, kerning: 'metric' });
    function drawLabels(g, t, i) {
      if (!params.labels) return;
      if (C.label) K.drawRun(g, lab(C.label.toUpperCase()), M, M + 16 * unit, { fill: P.dim });
      const c = lab(`${String(i + 1).padStart(2, '0')}/${String(lines.length).padStart(2, '0')}  ${Math.round(beat.bpm)} BPM`);
      K.drawRun(g, c, W - M - c.advance, M + 16 * unit, { fill: P.dim });
      // a thin level meter tracking liquid energy, like a signal readout
      const e = energy[i].at(t);
      const w = IW * 0.18;
      K.bar(g, M, H - M, w, 2 * unit, P.dim);
      if (e > 0.002) K.bar(g, M, H - M - 2 * unit, w * K.clamp(e), 4 * unit, P.a);
    }

    return {
      duration,
      samplesHint: (t) => (segs.some((s) => (t > s.tIn && t < s.tCrisp1) || (t > s.tOut && t < s.tEnd)) ? 6 : 0),
      draw(g, t) {
        const tq = q(t);
        let i = segs.findIndex((s) => tq >= s.tIn && tq < s.tEnd);
        if (i < 0) i = tq < 0 ? 0 : segs.length - 1;
        const s = segs[i];
        if (tq < s.tCrisp1) drawMelt(g, i, t, 'in', s.tIn, s.tCrisp1 - s.tIn);
        else if (tq >= s.tOut) drawMelt(g, i, t, 'out', s.tOut, s.tEnd - s.tOut);
        else drawLiquid(g, i, t, s);
        drawLabels(g, t, i);
      },
      post(g) { K.bloom(g, { amount: K.glowAmount(params), color: P.a, unit }); },
    };
  },
};
