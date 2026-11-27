// GLYPH MORPH — letters that redraw themselves.
// Every word is sampled into its own outline: an ordered loop of points along
// the real contours of each glyph. A word dissolves into that luminous
// outline, the points fling outward along curling paths and reconverge onto
// the NEXT word's outline, and the solid glyphs snap back in with a flash.
// Nothing here is decorative particle filler: every point belongs to a letter.
// Holds carry a sonar ripple that travels through the letterforms on the beat.
import * as K from '../../src/kit/index.js';
import { samplePoints } from '../../src/kit/x-morph.js';

const tau = Math.PI * 2;
const STYLES = ['light-paint', 'blueprint', 'ink-bleed'];
// palette defaults per style (only for tokens the spec does not set)
const STYLE_PALETTE = {
  'light-paint': {},
  blueprint: { bg: '#0B2340', ink: '#DCEBFF', a: '#7FD4FF', dim: '#7F9DC2' },
  'ink-bleed': { bg: '#EEE8DC', ink: '#161412', a: '#D2381F', dim: '#6E675E' },
};
// how each style moves and marks
const STYLE_CFG = {
  'light-paint': { blend: 'lighten', motion: 'curl', explode: 1, curl: 1, line: 1, trails: true, rest: 'fill' },
  blueprint: { blend: 'lighten', motion: 'plotter', explode: 0, curl: 0, line: 0.8, trails: false, rest: 'outline' },
  'ink-bleed': { blend: 'multiply', motion: 'curl', explode: 0.55, curl: 1.8, line: 1.9, trails: true, rest: 'fill' },
};

export default {
  id: 'glyph-morph',
  version: '1.1.0',
  name: 'Glyph Morph',
  description:
    'Words dissolve into their own luminous outlines, fling outward on curling paths and re-form as the next word; the solid type snaps back in with a flash, and every hold carries a sonar ripple through the letterforms on the beat.',
  tags: ['morph', 'outline', 'reveal', 'title', 'intro', 'wow', 'loop-friendly'],
  formats: ['square', 'landscape', 'vertical', 'portrait'],
  bpm: 100,
  duration: 16,
  loop: false,
  palette: { bg: '#08080A', ink: '#F4F1EA', a: '#FF4D2E', dim: '#8C8C8C' },
  paletteRoles: { bg: 'background', ink: 'solid type and outline strokes', a: 'glow, pen tip, flash, ripple', dim: 'labels (neutral)' },
  fonts: {
    display: { family: 'Archivo Black', weight: 400 },
    mono: { family: 'IBM Plex Mono', weight: 500 },
  },
  params: {
    points: 1500,
    holdBeats: 3,
    morphBeats: 2,
    introBeats: 2,
    outroBeats: 4,
    tracking: -30,
    explode: 0.17,
    curl: 1.0,
    ripple: true,
    ghost: 0,
    glow: 0,
    labels: true,
    style: 'light-paint',
  },
  schema: {
    content: {
      type: 'object',
      additionalProperties: false,
      required: ['words'],
      properties: {
        words: { type: 'array', minItems: 2, maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 18 }, description: 'Words (or short phrases) in order; each morphs into the next.' },
        final: { type: 'string', maxLength: 18, description: 'Optional last word held at the end (appended after words).' },
        label: { type: 'string', maxLength: 40, description: 'Optional mono label (bottom-left).' },
      },
    },
    params: {
      type: 'object',
      additionalProperties: false,
      properties: {
        points: { type: 'integer', minimum: 400, maximum: 3000, description: 'Outline points per word (detail vs speed)' },
        holdBeats: { type: 'number', minimum: 1, maximum: 8 },
        morphBeats: { type: 'number', minimum: 1, maximum: 6 },
        introBeats: { type: 'number', minimum: 1, maximum: 6 },
        outroBeats: { type: 'number', minimum: 1, maximum: 12 },
        tracking: { type: 'number' },
        explode: { type: 'number', minimum: 0, maximum: 0.5, description: 'Mid-morph fling distance (fraction of frame)' },
        curl: { type: 'number', minimum: 0, maximum: 3, description: 'How much the fling paths curl' },
        ripple: { type: 'boolean' },
        glow: { type: 'number', minimum: 0, maximum: 1, description: 'Neon bloom around the type and strokes (0 = off)' },
        ghost: { type: 'number', minimum: 0, maximum: 1, description: 'Legibility during the morph: the outgoing word stays as a faint solid ghost and the incoming word fades in under the strokes, so a still taken mid-morph still reads (0 = classic full dissolve)' },
        labels: { type: 'boolean' },
        style: { enum: STYLES, description: 'light-paint (luminous strokes, curling flings) | blueprint (technical drawing: guides, outline type, orthogonal plotter paths) | ink-bleed (ink on paper: multiply strokes, brushy curls, vermilion stamp)' },
      },
    },
  },
  example: {
    template: 'glyph-morph',
    format: 'square',
    fps: 60,
    bpm: 100,
    seed: 5,
    content: { words: ['NOISE', 'SIGNAL', 'SHAPE', 'STORY'], final: 'YOURS', label: 'KINETYPE — GLYPH MORPH' },
  },
  notes: 'Duration is derived from the word count (intro + holds + morphs + outro) unless spec.duration is set. Short, heavy words morph best; 1–2 short words per entry in vertical.',

  build(ctx) {
    const { W, H, params, content: C, fonts, beat, seed, qa, fps } = ctx;
    const style = STYLES.includes(params.style) ? params.style : 'light-paint';
    const userPal = ctx.spec.palette || {};
    for (const [k, v] of Object.entries(STYLE_PALETTE[style])) if (!(k in userPal)) ctx.palette[k] = v;
    const P = ctx.palette;
    const SC = STYLE_CFG[style];
    const BLEND = SC.blend;
    const fD = fonts.get('display'), fM = fonts.get('mono');
    const unit = Math.min(W, H) / 1080;
    const M = Math.round(Math.min(W, H) * 0.08);
    const IW = W - 2 * M;
    const cx = W / 2, cy = H / 2;
    const tall = ctx.aspect === 'vertical';
    const q = (t) => K.frameQuant(t, fps);
    const N = params.points;
    const words = [...C.words, ...(C.final ? [C.final] : [])];
    const B = (n) => beat.t(n);

    // ── layout: each word as a centred block (vertical: phrases may stack) ──
    const blocks = words.map((w) => {
      let lines = [w];
      if (tall && /\s/.test(w)) lines = K.balanceLines(fD, w, IW, { size: 200, tracking: params.tracking });
      const capMax = H * (tall ? 0.17 : 0.34) / Math.sqrt(lines.length);
      const runs = lines.map((l) => {
        const s = Math.min(K.fitSize(fD, l, IW * (lines.length > 1 ? 0.95 : 0.94), { tracking: params.tracking }), (capMax * fD.upm) / fD.capHeight);
        return K.shape(fD, l, { size: s, tracking: params.tracking });
      });
      const gap = runs[0].capPx * 0.22;
      const h = K.stackHeight(runs, gap);
      const bases = K.stackInk(runs, { top: cy - h / 2, gap, grid: 1 });
      const placed = runs.map((r, i) => ({ run: r, x: cx - r.inkWidth / 2 - r.inkLeft, y: bases[i] }));
      const pts = samplePoints(placed, N);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < N; i++) { x0 = Math.min(x0, pts.x[i]); x1 = Math.max(x1, pts.x[i]); y0 = Math.min(y0, pts.y[i]); y1 = Math.max(y1, pts.y[i]); }
      return { text: w, runs, placed, pts, box: { x0, x1, y0, y1 }, cap: Math.min(...runs.map((r) => r.capPx)) };
    });

    // ── timeline (beats) ──
    const intro = params.introBeats, hold = params.holdBeats, morph = params.morphBeats;
    const rest = []; // [start,end) of each word's solid rest, in beats
    let b = intro;
    words.forEach((_, k) => {
      const end = k === words.length - 1 ? b + params.outroBeats : b + hold;
      rest.push([b, end]);
      b = end + (k === words.length - 1 ? 0 : morph);
    });
    const duration = ctx.spec.duration ?? B(rest[rest.length - 1][1]);
    const morphs = words.slice(0, -1).map((_, k) => ({ k, T: B(rest[k][1]), T1: B(rest[k + 1][0]) }));

    // ── per-morph pairing + motion constants ──
    for (const m of morphs) {
      const A = blocks[m.k].pts, Bp = blocks[m.k + 1].pts;
      const dur = m.T1 - m.T;
      const bx0 = Math.min(blocks[m.k].box.x0, blocks[m.k + 1].box.x0), bx1 = Math.max(blocks[m.k].box.x1, blocks[m.k + 1].box.x1);
      const mcx = (bx0 + bx1) / 2;
      const r = K.rng(seed, 'morph', m.k);
      const delay = new Float64Array(N), ex = new Float64Array(N), ey = new Float64Array(N);
      const stagger = dur * 0.44;
      const flip = m.k % 2 ? -1 : 1;
      for (let i = 0; i < N; i++) {
        const nx = (A.x[i] - bx0) / Math.max(1, bx1 - bx0);
        // smooth delay: neighbours along an outline stay in step (no furry jitter)
        delay[i] = (flip > 0 ? nx : 1 - nx) * stagger + (0.5 + 0.5 * Math.sin(i * 0.021 + m.k)) * dur * 0.05;
        // fling: outward from the word's centre, curled by a smooth angle field
        const dx = A.x[i] - mcx, dy = A.y[i] - cy;
        const len = Math.hypot(dx, dy) || 1;
        const field = Math.sin(A.x[i] * 0.006 + m.k * 1.7) + Math.cos(A.y[i] * 0.009 - m.k);
        const ang = Math.atan2(dy, dx) + params.curl * SC.curl * (field * 0.55 + flip * 0.6);
        // magnitude varies SMOOTHLY along the outline so strands move as ribbons, not hair
        const along = 0.55 + 0.45 * Math.sin(i * 0.045 + m.k * 2.1) * Math.cos(i * 0.013 - m.k);
        const mag = Math.min(W, H) * params.explode * SC.explode * along * (0.6 + 0.4 * Math.min(1, len / (Math.min(W, H) * 0.3)));
        ex[i] = Math.cos(ang) * mag;
        ey[i] = Math.sin(ang) * mag;
      }
      Object.assign(m, { A, Bp, delay, ex, ey, dur });
    }

    // ── QA ──
    blocks.forEach((bk, k) => {
      const r = bk.runs[0];
      qa.text('word-' + k, { box: { x0: bk.box.x0, y0: bk.box.y0, x1: bk.box.x1, y1: bk.box.y1 }, size: bk.cap, fg: P.ink, bg: P.bg, lines: bk.runs.map((x) => x.text), orphanOk: true });
    });
    qa.hit(B(0), 'draw-on');
    rest.forEach(([s0, s1], k) => {
      qa.hit(B(s0), `settle ${k}`);
      for (let bb = Math.ceil(s0 + 0.001); bb < s1; bb++) qa.hit(B(bb), `ripple ${k}`);
    });
    morphs.forEach((m) => qa.hit(m.T, `morph ${m.k}`));
    const lab = (s) => K.shape(fM, s, { size: 16 * unit, tracking: 20, kerning: 'metric' });
    if (params.labels) qa.text('labels', { box: { x0: M, y0: H - M - 20, x1: W - M, y1: H - M }, size: 12 * unit, fg: P.dim, bg: P.bg, decorative: true });
    const kf = [[0, 'empty'], [B(intro * 0.45), 'outline drawing itself'], [B(intro) + 0.12, 'first settle flash'], [B(rest[0][0] + 1.25), 'ripple']];
    morphs.slice(0, 3).forEach((m) => {
      kf.push([m.T + m.dur * 0.12, `dissolve ${m.k}`], [m.T + m.dur * 0.42, `fling ${m.k}`], [m.T + m.dur * 0.72, `converge ${m.k}`]);
    });
    kf.push([B(rest[rest.length - 1][0]) + 0.3, 'final'], [duration - 1 / fps, 'last frame']);
    kf.filter(([t]) => t < duration).forEach(([t, l]) => qa.keyframe(t, l));

    // ── drawing helpers ──
    const zoom = new K.Track(1);
    rest.forEach(([s0], k) => { if (k) zoom.spring(B(s0), 1.035, 'pop').spring(B(s0) + 0.35, 1, 'glide'); });
    const lineW = 1.8 * unit * SC.line;

    function strokeLoops(g, X, Y, loopW, alpha, color, width, mode = 'source-over') {
      if (alpha <= 0.003) return;
      const P2 = new Path2D();
      const maxLen = Math.min(W, H) * 0.2;
      for (let i = 0; i < N; i++) {
        const j = i + 1 < N ? i + 1 : -1;
        const w = loopW(i, j);
        if (w <= 0.5) {
          // close the loop back to its first point
          continue;
        }
        const x0 = X(i), y0 = Y(i), x1 = X(j), y1 = Y(j);
        if (Math.abs(x1 - x0) + Math.abs(y1 - y0) > maxLen) continue;
        P2.moveTo(x0, y0);
        P2.lineTo(x1, y1);
      }
      g.save();
      g.globalCompositeOperation = mode;
      g.globalAlpha = alpha;
      g.strokeStyle = color;
      g.lineWidth = width;
      g.lineCap = 'round';
      g.stroke(P2);
      g.restore();
    }
    // closing segments: last point of each loop → its first point
    const closers = (pts) => {
      const out = [];
      let start = 0;
      for (let i = 1; i <= N; i++) {
        if (i === N || pts.loop[i] !== pts.loop[i - 1]) { out.push([i - 1, start]); start = i; }
      }
      return out;
    };
    blocks.forEach((bk) => { bk.close = closers(bk.pts); });

    function fillWord(g, bk, color, alpha = 1) {
      if (SC.rest === 'outline') {
        // blueprint: a faint tint + a crisp hairline outline
        for (const p of bk.placed) K.drawRun(g, p.run, p.x, p.y, { fill: color, alpha: alpha * 0.1 });
        for (const p of bk.placed) K.drawRun(g, p.run, p.x, p.y, { stroke: color, strokeWidth: 2.2 * unit, alpha });
        return;
      }
      for (const p of bk.placed) K.drawRun(g, p.run, p.x, p.y, { fill: color, alpha });
    }
    // blueprint construction lines: cap line, baseline, ink extents, dimension
    function drawGuides(g, bk, alpha) {
      if (style !== 'blueprint' || alpha <= 0.01) return;
      g.save();
      g.globalAlpha = alpha;
      for (const p of bk.placed) {
        const top = p.y - p.run.capPx, base = p.y;
        const xl = p.x + p.run.inkLeft, xr = p.x + p.run.inkRight;
        g.fillStyle = P.dim;
        g.fillRect(M, Math.round(top), IW, 1.2 * unit);
        g.fillRect(M, Math.round(base), IW, 1.2 * unit);
        for (const x of [xl, xr]) g.fillRect(Math.round(x), top - 40 * unit, 1.2 * unit, p.run.capPx + 80 * unit);
        const dy = base + 46 * unit;
        g.fillStyle = P.a;
        g.fillRect(xl, dy, xr - xl, 1.5 * unit);
        g.fillRect(xl, dy - 8 * unit, 1.5 * unit, 16 * unit);
        g.fillRect(xr - 1.5 * unit, dy - 8 * unit, 1.5 * unit, 16 * unit);
        const dim = K.shape(fM, `${Math.round(xr - xl)} PX`, { size: 15 * unit, tracking: 60, kerning: 'metric' });
        K.drawRun(g, dim, (xl + xr) / 2 - dim.advance / 2, dy + 26 * unit, { fill: P.a });
        const capL = K.shape(fM, 'CAP', { size: 13 * unit, tracking: 60, kerning: 'metric' });
        K.drawRun(g, capL, M, top - 8 * unit, { fill: P.dim });
        const baseL = K.shape(fM, 'BASELINE', { size: 13 * unit, tracking: 60, kerning: 'metric' });
        K.drawRun(g, baseL, M, base - 8 * unit, { fill: P.dim });
      }
      g.restore();
    }

    function drawRestWord(g, t, k) {
      const bk = blocks[k];
      const tS = B(rest[k][0]);
      const flash = q(t) - tS < 2 / fps;
      drawGuides(g, bk, K.clamp((t - tS) / 0.4));
      fillWord(g, bk, flash ? P.a : P.ink);
      if (style === 'blueprint' && params.ripple) {
        // a ruler scans across the drawing on each hold beat
        const [s0b, s1b] = rest[k];
        for (let bb = Math.ceil(s0b + 0.001); bb < s1b; bb++) {
          const dt = t - B(bb);
          if (dt < 0 || dt > 0.9) continue;
          const x = bk.box.x0 - 40 * unit + (bk.box.x1 - bk.box.x0 + 80 * unit) * K.cubicInOut(dt / 0.9);
          K.bar(g, x, bk.box.y0 - 70 * unit, 2 * unit, bk.box.y1 - bk.box.y0 + 140 * unit, P.a);
        }
        return;
      }
      // sonar ripple through the outlines on each hold beat
      if (!params.ripple) return;
      const [s0, s1] = rest[k];
      for (let bb = Math.ceil(s0 + 0.001); bb < s1; bb++) {
        const tb = B(bb), dt = t - tb;
        if (dt < 0 || dt > 1.4) continue;
        const pts = bk.pts;
        const R = dt * Math.max(W, H) * 0.75;
        const amp = 12 * unit * Math.exp(-dt * 2.6);
        const wid = 38 * unit;
        const disp = new Float64Array(N);
        const DX = new Float64Array(N), DY = new Float64Array(N);
        for (let i = 0; i < N; i++) {
          const dx = pts.x[i] - cx, dy = pts.y[i] - cy;
          const d = Math.hypot(dx, dy) || 1;
          const w = Math.exp(-(((d - R) / wid) ** 2));
          disp[i] = w;
          DX[i] = pts.x[i] + (dx / d) * amp * w;
          DY[i] = pts.y[i] + (dy / d) * amp * w;
        }
        const fade = Math.exp(-dt * 1.4);
        for (const [lo, hi, a] of [[0.7, 2, 0.95], [0.4, 0.7, 0.55], [0.15, 0.4, 0.2]]) {
          const same = (i, j) => (j >= 0 && pts.loop[i] === pts.loop[j] && disp[i] > lo && disp[i] <= hi ? 1 : 0);
          strokeLoops(g, (i) => DX[i], (i) => DY[i], same, a * fade, P.a, lineW * 1.2, BLEND);
        }
      }
    }

    function drawIntro(g, t) {
      const bk = blocks[0], pts = bk.pts;
      const t1 = B(intro);
      // each contour draws itself, staggered left→right; a pen tip leads
      const nl = pts.loop[N - 1] + 1;
      const starts = [], ends = [];
      let s = 0;
      for (let i = 1; i <= N; i++) if (i === N || pts.loop[i] !== pts.loop[i - 1]) { starts.push(s); ends.push(i - 1); s = i; }
      const span = t1 * 0.72;
      const P2 = new Path2D(), tips = [];
      for (let c = 0; c < nl; c++) {
        const c0 = (c / Math.max(1, nl - 1)) * t1 * 0.25;
        const f = K.clamp(K.cubicInOut(K.clamp((t - c0) / span)));
        if (f <= 0) continue;
        const cnt = ends[c] - starts[c] + 1;
        const upto = Math.floor(f * cnt);
        for (let k = 0; k < upto; k++) {
          const i = starts[c] + k, j = k + 1 < cnt ? i + 1 : starts[c];
          P2.moveTo(pts.x[i], pts.y[i]);
          P2.lineTo(pts.x[j], pts.y[j]);
        }
        if (f < 1) tips.push(starts[c] + Math.min(upto, cnt - 1));
      }
      g.save();
      g.globalCompositeOperation = BLEND;
      g.lineCap = 'round';
      if (style === 'blueprint') drawGuides(g, bk, K.clamp(t / (t1 * 0.5)));
      g.globalCompositeOperation = BLEND;
      g.globalAlpha = 0.22; g.strokeStyle = P.a; g.lineWidth = lineW * 4; g.stroke(P2);
      g.globalAlpha = 0.95; g.strokeStyle = P.ink; g.lineWidth = lineW; g.stroke(P2);
      g.globalAlpha = 1; g.fillStyle = P.a;
      for (const i of tips) g.fillRect(pts.x[i] - 3 * unit, pts.y[i] - 3 * unit, 6 * unit, 6 * unit);
      g.restore();
    }

    function drawMorph(g, t, m) {
      const { A, Bp, delay, ex, ey, dur, k } = m;
      const out = blocks[k], inn = blocks[k + 1];
      const local = t - m.T;
      // the solid word dissolves into its outline in the first beat-sixth
      const fillOut = 1 - K.clamp(local / (dur * 0.12));
      if (fillOut > 0) fillWord(g, out, P.ink, fillOut);
      // ghost: both words stay faintly solid under the strokes (outgoing fades out by 50%, incoming fades in from 35%)
      const gh = K.clamp(params.ghost ?? 0);
      const mu = K.clamp(local / dur);
      if (gh > 0) {
        const gOut = gh * 0.5 * (1 - K.clamp((mu - 0.2) / 0.3));
        const gIn = gh * 0.5 * K.clamp((mu - 0.35) / 0.5);
        if (gOut > 0.01 && fillOut < gOut) fillWord(g, out, P.ink, gOut);
        if (gIn > 0.01) fillWord(g, inn, P.ink, gIn);
      }
      const posAt = (lt) => {
        const X = new Float64Array(N), Y = new Float64Array(N), U = new Float64Array(N);
        let e = 0;
        for (let i = 0; i < N; i++) {
          const p = K.springStep(lt - delay[i], 1.1, 0.84);
          const u = K.clamp(p);
          const bump = Math.pow(Math.sin(Math.PI * u), 1.25);
          if (SC.motion === 'plotter') {
            // plotter: travel in x first, then in y — orthogonal, machine-drawn paths
            const px = K.springStep(lt - delay[i], 1.6, 1), py = K.springStep(lt - delay[i] - dur * 0.2, 1.6, 1);
            X[i] = A.x[i] + (Bp.x[i] - A.x[i]) * px;
            Y[i] = A.y[i] + (Bp.y[i] - A.y[i]) * py;
            U[i] = K.clamp((px + py) / 2);
            e += Math.sin(Math.PI * U[i]);
            continue;
          }
          X[i] = A.x[i] + (Bp.x[i] - A.x[i]) * p + ex[i] * bump;
          Y[i] = A.y[i] + (Bp.y[i] - A.y[i]) * p + ey[i] * bump;
          U[i] = u;
          e += bump;
        }
        return { X, Y, U, e: e / N };
      };
      const { X, Y, U, e: energy } = posAt(local);
      const same = (i, j) => {
        if (j < 0) return 0;
        const u = (U[i] + U[j]) / 2;
        const sa = A.loop[i] === A.loop[j] ? 1 : 0, sb = Bp.loop[i] === Bp.loop[j] ? 1 : 0;
        return sa * (1 - u) + sb * u;
      };
      // settle: solid type of the next word snaps in with a flash
      const tS = m.T1;
      const lineFade = 1 - K.clamp((t - (tS - dur * 0.06)) / (dur * 0.1));
      // light-painting trails: the same outline a few hundredths of a second ago
      if (energy > 0.02 && SC.trails) {
        for (let k = 4; k >= 1; k--) {
          const tr = posAt(local - k * 0.032);
          strokeLoops(g, (i) => tr.X[i], (i) => tr.Y[i], same, (0.34 - k * 0.06) * Math.min(1, energy * 4) * lineFade, P.a, lineW * 1.4, BLEND);
        }
      }
      if (style === 'blueprint') {
        drawGuides(g, out, 1 - K.clamp(local / (dur * 0.3)));
        drawGuides(g, inn, K.clamp((local - dur * 0.6) / (dur * 0.4)));
      }
      strokeLoops(g, (i) => X[i], (i) => Y[i], same, (0.16 + 0.55 * energy) * (1 - 0.6 * gh) * lineFade * (style === 'blueprint' ? 0.5 : 1), P.a, lineW * (style === 'blueprint' ? 2.5 : 6), BLEND);
      strokeLoops(g, (i) => X[i], (i) => Y[i], same, lineFade, P.ink, lineW * 1.25, BLEND);
      // closing segments of each contour (weighted the same way)
      // contour-closing segments, weighted by how far each side has travelled
      const maxC = Math.min(W, H) * 0.12;
      for (const [bk, side] of [[out, 0], [inn, 1]]) {
        const Pc = new Path2D();
        let wsum = 0;
        for (const [i, j] of bk.close) {
          if (Math.abs(X[i] - X[j]) + Math.abs(Y[i] - Y[j]) > maxC) continue;
          Pc.moveTo(X[i], Y[i]); Pc.lineTo(X[j], Y[j]);
          wsum += side ? (U[i] + U[j]) / 2 : 1 - (U[i] + U[j]) / 2;
        }
        const a = bk.close.length ? wsum / bk.close.length : 0;
        g.save(); g.globalCompositeOperation = BLEND; g.globalAlpha = 0.95 * a * lineFade; g.strokeStyle = P.ink; g.lineWidth = lineW; g.stroke(Pc); g.restore();
      }
      // pen dots on the fastest-moving points
      if (energy > 0.05) {
        g.save();
        g.globalCompositeOperation = BLEND;
        g.fillStyle = P.a;
        for (let i = 0; i < N; i += style === 'blueprint' ? 23 : 7) {
          const bump = Math.sin(Math.PI * U[i]);
          if (bump < 0.25) continue;
          g.globalAlpha = Math.min(1, bump * 1.1) * lineFade;
          if (style === 'blueprint') {
            // plotter crosshairs
            const s = 7 * unit, w = 1.2 * unit;
            g.fillRect(X[i] - s, Y[i] - w / 2, s * 2, w);
            g.fillRect(X[i] - w / 2, Y[i] - s, w, s * 2);
          } else {
            const s = (style === 'ink-bleed' ? 3.2 : 2.2) * unit;
            g.fillRect(X[i] - s / 2, Y[i] - s / 2, s, s);
          }
        }
        g.restore();
      }
    }

    function drawLabels(g, t, k) {
      if (!params.labels) return;
      const counter = lab(`${String(k + 1).padStart(2, '0')} / ${String(words.length).padStart(2, '0')}`);
      K.drawRun(g, counter, W - M - counter.advance, H - M, { fill: P.dim });
      if (C.label) K.drawRun(g, lab(C.label.toUpperCase()), M, H - M, { fill: P.dim });
      // progress rule
      const pr = K.clamp(t / duration);
      K.bar(g, M, M, IW * pr, 2 * unit, P.dim);
    }

    let gridPath = null;
    return {
      duration,
      samplesHint: (t) => (morphs.some((m) => t > m.T && t < m.T1) ? 8 : 0),
      draw(g, t) {
        if (style === 'blueprint') {
          // drafting grid: fine 24px + major every 4
          if (!gridPath) {
            gridPath = [new Path2D(), new Path2D()];
            const step = 24 * unit;
            for (let x = 0, i = 0; x <= W; x += step, i++) gridPath[i % 4 ? 0 : 1].rect(Math.round(x), 0, 1, H);
            for (let y = 0, i = 0; y <= H; y += step, i++) gridPath[i % 4 ? 0 : 1].rect(0, Math.round(y), W, 1);
          }
          g.save(); g.fillStyle = P.dim; g.globalAlpha = 0.07; g.fill(gridPath[0]); g.globalAlpha = 0.16; g.fill(gridPath[1]); g.restore();
        }
        const zi = rest.findIndex(([s0, s1]) => t >= B(s0) && t < B(s1));
        g.save();
        const z = zoom.at(t);
        g.translate(cx, cy); g.scale(z, z); g.translate(-cx, -cy);
        let k = 0;
        if (t < B(intro)) drawIntro(g, t);
        else if (zi >= 0) { drawRestWord(g, t, zi); k = zi; }
        else {
          const m = morphs.find((mm) => t >= mm.T && t < mm.T1);
          if (m) { drawMorph(g, t, m); k = m.k; }
          else { drawRestWord(g, t, words.length - 1); k = words.length - 1; }
        }
        g.restore();
        drawLabels(g, t, k);
      },
      post(g) { K.bloom(g, { amount: K.glowAmount(params), color: P.a, unit }); },
    };
  },
};
