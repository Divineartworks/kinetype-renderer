// LYRIC CINEMA — the elegant one. One line at a time, set in a refined serif;
// each word fills from dim to bright across exactly its sung duration (a
// feathered karaoke sweep), emphasised words turn italic and warm. The next
// line waits below, small and dim, and glides up into place — the reader is
// always one breath ahead of the singer. Letterbox, deterministic grain,
// glide-only camera: no drift, no jitter, no bounce.
import * as K from '../../src/kit/index.js';
import { normalizeLyrics, displayWord, filmGrain } from '../../src/kit/x-lyrics.js';

export default {
  id: 'lyric-cinema',
  version: '1.1.0',
  name: 'Lyric Cinema',
  description:
    'Cinematic lyric video for ballads/R&B: one serif line at a time with a feathered karaoke fill that follows each sung word, italic warm emphasis, next-line preview gliding into place, letterbox and film grain.',
  tags: ['lyric', 'music', 'cinematic', 'elegant', 'ballad', 'karaoke', 'youtube'],
  formats: ['landscape', 'square', 'vertical', 'portrait'],
  bpm: 96,
  duration: 24,
  loop: false,
  palette: { bg: '#120E0B', ink: '#F3E6D3', dim: '#7A6B5D', a: '#E0A15E', bar: '#050403', mute: '#8F8577' },
  paletteRoles: { bg: 'background', ink: 'sung words', dim: 'unsung words', a: 'emphasised words (italic) once sung', bar: 'letterbox bars', mute: 'credits / labels' },
  fonts: {
    serif: { family: 'Instrument Serif', weight: 400 },
    italic: { family: 'Instrument Serif', weight: 400, style: 'italic' },
    mono: { family: 'IBM Plex Mono', weight: 500 },
    vhs: { family: 'VT323', weight: 400 },
  },
  params: {
    style: 'cinema',
    size: 0.118,
    tracking: { serif: -10, mono: 40 },
    letterbox: 'auto',
    grain: 0.07,
    vignette: 0.55,
    preview: true,
    feather: 0.22,
    credits: true,
    platformSafe: true,
    tail: 2.0,
  },
  schema: {
    content: {
      type: 'object',
      additionalProperties: false,
      anyOf: [{ required: ['lyrics'] }, { required: ['lyricsSrc'] }],
      properties: {
        lyricsSrc: { type: 'string', description: 'Path (relative to the spec) of a word-timed lyrics JSON; inlined as content.lyrics' },
        lyrics: {
          type: 'object',
          required: ['lines'],
          description: 'Word-timed lyrics (docs/LYRICS_FORMAT.md).',
          properties: {
            lines: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                required: ['words'],
                properties: {
                  start: { type: 'number' },
                  end: { type: 'number' },
                  words: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 24,
                    items: {
                      type: 'object',
                      required: ['text', 'start'],
                      properties: { text: { type: 'string', maxLength: 24 }, start: { type: 'number' }, end: { type: 'number' }, emph: { type: 'boolean' } },
                    },
                  },
                },
              },
            },
          },
        },
        title: { type: 'string', maxLength: 48 },
        artist: { type: 'string', maxLength: 48 },
      },
    },
    params: {
      type: 'object',
      additionalProperties: false,
      properties: {
        style: { enum: ['cinema', 'vhs', 'silent-film'], description: 'cinema (karaoke fill, letterbox, grain) | vhs (tape: chroma ghost, tracking jitter, scanlines, PLAY timecode) | silent-film (intertitle card: 4:3 academy frame, double-rule border, whole-line cuts, flicker, scratches)' },
        size: { type: 'number', minimum: 0.04, maximum: 0.2, description: 'Type size as a fraction of min(W,H)' },
        tracking: { type: 'object', properties: { serif: { type: 'number' }, mono: { type: 'number' } }, additionalProperties: false },
        letterbox: { enum: ['auto', 'on', 'off'], description: 'auto = 2.39:1 bars on landscape, slimmer on square, none on vertical' },
        grain: { type: 'number', minimum: 0, maximum: 0.3 },
        vignette: { type: 'number', minimum: 0, maximum: 1 },
        preview: { type: 'boolean', description: 'Show the next line dimmed below the current one' },
        feather: { type: 'number', minimum: 0, maximum: 1, description: 'Softness of the karaoke sweep edge (em)' },
        credits: { type: 'boolean' },
        platformSafe: { type: 'boolean' },
        tail: { type: 'number', minimum: 0, maximum: 10 },
      },
    },
  },
  example: {
    template: 'lyric-cinema',
    format: 'landscape',
    fps: 60,
    bpm: 96,
    seed: 5,
    content: { lyricsSrc: 'lyrics/demo-verse.json', title: 'Hold The Line', artist: 'Demo Artist' },
  },
  notes: 'Duration defaults to last word end + params.tail. Word timing drives the fill sweep, so tight alignment matters more here than in lyric-stack.',

  build(ctx) {
    const { W, H, params, content: C, fonts, seed, qa, fps } = ctx;
    const STYLES = ['cinema', 'vhs', 'silent-film'];
    const style = STYLES.includes(params.style) ? params.style : 'cinema';
    const STYLE_PALETTE = {
      cinema: {},
      vhs: { bg: '#0A0A12', ink: '#F4F2FF', dim: '#5B5974', a: '#FF5AA8', bar: '#000000', mute: '#A6A4BE' },
      'silent-film': { bg: '#0C0B09', ink: '#EFE6CF', dim: '#EFE6CF', a: '#EFE6CF', bar: '#000000', mute: '#9C947F' },
    };
    const userPal = ctx.spec.palette || {};
    for (const [k, v] of Object.entries(STYLE_PALETTE[style])) if (!(k in userPal)) ctx.palette[k] = v;
    const P = ctx.palette;
    const silent = style === 'silent-film', vhs = style === 'vhs';
    const fV = vhs ? fonts.get('vhs') : null;
    const lines = normalizeLyrics(C.lyrics).lines;
    const fS = fonts.get('serif'), fI = fonts.get('italic'), fM = fonts.get('mono');
    const unit = Math.min(W, H) / 1080;
    const vertical = H / W > 1.15;
    const q = (t) => K.frameQuant(t, fps);
    const lastEnd = lines[lines.length - 1].end;
    const duration = ctx.spec.duration ?? lastEnd + params.tail;
    const cx = W / 2;

    // letterbox geometry
    const lbMode = params.letterbox === 'auto' ? (vertical || silent ? 'off' : 'on') : params.letterbox;
    const barH = lbMode === 'off' ? 0 : W / H > 1.2 ? Math.round((H - W / 2.39) / 2) : Math.round(H * 0.075);
    // silent film: a 4:3 academy frame inside wide formats (pillarbox)
    const pillar = silent && W / H > 1.4 ? Math.round((W - (H * 4) / 3) / 2) : 0;
    const M = Math.round(Math.min(W, H) * 0.08) + (silent ? Math.round(Math.min(W, H) * 0.04) : 0);
    const areaTop = Math.max(barH + 24 * unit, vertical && params.platformSafe ? H * 0.14 : M);
    const areaBot = Math.min(H - barH - 24 * unit, vertical && params.platformSafe ? H * 0.68 : H - M);
    // a cinematic measure: long lines break in two rather than running wall to wall
    const maxW = pillar ? W - 2 * pillar - 2 * M : W / H > 1.2 ? W * 0.68 : W - 2 * M;

    // ── layout: words shaped individually (roman / italic), balanced lines ──
    function layout(line, size) {
      const words = line.words.map((w) => {
        const face = w.emph ? fI : fS;
        const run = K.shape(face, displayWord(w.text, { upper: false, strip: false }), { size, tracking: params.tracking.serif, capSymbols: false });
        return { w, run, emph: w.emph };
      });
      const space = size * 0.26;
      const widthOf = (a, b) => words.slice(a, b).reduce((x, it) => x + it.run.advance, 0) + space * (b - a - 1);
      const n = words.length;
      let best = null;
      for (let k = 1; k <= Math.min(3, n); k++) {
        const rec = (start, left, acc) => {
          if (left === 1) {
            const rows = [...acc, [start, n]];
            const ws = rows.map(([a, b]) => widthOf(a, b));
            if (Math.max(...ws) > maxW) return;
            const mean = ws.reduce((x, y) => x + y, 0) / ws.length;
            // prefer fewer lines, even widths, no one-word last line
            let cost = k * maxW * maxW * 0.08 + ws.reduce((x, v) => x + (v - mean) ** 2, 0);
            if (k > 1 && rows[rows.length - 1][1] - rows[rows.length - 1][0] === 1) cost += maxW * maxW * 0.5;
            if (!best || cost < best.cost) best = { cost, rows };
            return;
          }
          for (let e = start + 1; e <= n - (left - 1); e++) rec(e, left - 1, [...acc, [start, e]]);
        };
        rec(0, k, []);
      }
      if (!best) return null;
      const lead = size * 1.16;
      const capPx = fS.px(fS.capHeight, size);
      const blockH = capPx + lead * (best.rows.length - 1);
      const items = [];
      best.rows.forEach(([a, b], r) => {
        let x = cx - widthOf(a, b) / 2;
        for (let i = a; i < b; i++) {
          items.push({ ...words[i], x, row: r });
          x += words[i].run.advance + space;
        }
      });
      return { items, rows: best.rows.length, blockH, lead, capPx, size, texts: best.rows.map(([a, b]) => words.slice(a, b).map((it) => it.run.text).join(' ')) };
    }
    const base = Math.min(W, H) * params.size;
    const L = lines.map((line, i) => {
      let s = base, l = null;
      for (let tries = 0; tries < 12; tries++) {
        l = layout(line, s);
        if (l && l.blockH <= (areaBot - areaTop) * 0.62) break;
        s *= 0.92;
      }
      l.li = i;
      l.line = line;
      return l;
    });

    // main slot: block centred in the text area; preview slot sits below it
    const mainCy = areaTop + (areaBot - areaTop) * (params.preview && !silent ? 0.42 : 0.5);
    const pvScale = 0.5;
    const mainBottom = mainCy + Math.max(...L.map((x) => x.blockH)) / 2;
    const pvTop = mainBottom + 64 * unit;
    // each preview gets its own scale so a 3-row line never runs into the bars
    L.forEach((l) => { l.pv = Math.min(pvScale, (areaBot - pvTop) / (l.blockH + l.size * 0.3)); });
    const slotY = (l, slot) => {
      // returns the baseline of the first row for the given slot
      if (slot === 'main') return mainCy - l.blockH / 2 + l.capPx;
      return pvTop + l.capPx * l.pv;
    };

    // ── timing: activation (preview → main) and exits ────────────────────────
    const act = L.map((l, i) => {
      const s = l.line.start;
      if (i === 0) return Math.max(0, s - 0.8);
      const prevEnd = L[i - 1].line.end;
      return Math.min(s - 0.15, Math.max(prevEnd - 0.05, s - 0.5));
    });
    const outT = lastEnd + 0.45;
    L.forEach((l) => l.items.forEach((it) => qa.hit(it.w.start, it.run.text)));
    L.forEach((l, i) => {
      const y0 = slotY(l, 'main') - l.capPx;
      const wmax = Math.max(...l.texts.map((_, r) => {
        const its = l.items.filter((it) => it.row === r);
        return its[its.length - 1].x + its[its.length - 1].run.advance - its[0].x;
      }));
      qa.text(`line-${i + 1}`, { box: { x0: cx - wmax / 2, x1: cx + wmax / 2, y0, y1: y0 + l.blockH + l.size * 0.25 }, size: l.capPx, fg: P.ink, bg: P.bg, lines: l.texts });
    });
    qa.note(`letterbox ${barH}px, main slot centre ${mainCy.toFixed(0)}`);

    const kf = [[0.35, 'focus-in']];
    L.forEach((l, i) => {
      const mid = l.items[Math.floor(l.items.length / 2)];
      kf.push([mid.w.start + (mid.w.end - mid.w.start) * 0.5, `line ${i + 1} mid-sweep`]);
    });
    [2, 5].forEach((i) => L[i] && kf.push([act[i] + 0.18, `preview → line ${i + 1}`]));
    const held = L.flatMap((l) => l.items).find((it) => it.w.end - it.w.start > 1.5);
    if (held) kf.push([held.w.start + (held.w.end - held.w.start) * 0.6, 'held note sweep']);
    kf.push([outT + 0.3, 'outro'], [duration - 1 / fps, 'last frame']);
    kf.sort((a, b) => a[0] - b[0]).forEach(([t, l]) => qa.keyframe(t, l));

    // camera: glide-only push that alternates per line (never drifts)
    const zoom = new K.Track(1);
    act.forEach((t, i) => zoom.spring(t, 1 + (i % 2 ? 0.022 : 0.008), 'glide'));
    const barIn = new K.Track(0).spring(0, 1, { f: 0.7, z: 1 }).spring(duration - 1.1, 0, { f: 1.1, z: 1 });

    // ── drawing ──────────────────────────────────────────────────────────────
    const glideIn = (d) => K.springStep(d, 1.5, 1);
    function wordFill(g, it, x, y, t, color, A = 1) {
      // silent film: the whole card is the line — no karaoke sweep
      if (silent) return K.drawRun(g, it.run, x, y, { fill: it.emph ? P.a : color, alpha: A });
      // dim base, then the sung part bright with a feathered leading edge
      const w = it.w, run = it.run;
      K.drawRun(g, run, x, y, { fill: P.dim, alpha: A });
      const prog = K.clamp((t - w.start) / Math.max(0.05, w.end - w.start));
      if (prog <= 0) return;
      const bright = it.emph ? P.a : color;
      if (prog >= 1) return K.drawRun(g, run, x, y, { fill: bright, alpha: A });
      const x0 = x + run.inkLeft, iw = run.inkWidth, F = run.size * params.feather;
      const edge = x0 + (iw + F) * prog; // sweep travels until the feather clears the word
      g.save(); g.beginPath(); g.rect(x0 - 4, y - run.size * 1.2, Math.max(0, edge - F - x0 + 4), run.size * 1.6); g.clip();
      K.drawRun(g, run, x, y, { fill: bright, alpha: A });
      g.restore();
      const N = 8;
      for (let k = 0; k < N; k++) {
        const a = 1 - (k + 0.5) / N;
        const sx = edge - F + (F * k) / N;
        g.save(); g.beginPath(); g.rect(sx, y - run.size * 1.2, F / N + 0.5, run.size * 1.6); g.clip();
        K.drawRun(g, run, x, y, { fill: bright, alpha: a * A });
        g.restore();
      }
    }

    function drawLine(g, l, t, { slotFrom, slotTo, tSwitch, alpha = 1, blur = 0, dy = 0, sweep = true }) {
      const p = tSwitch == null ? 1 : glideIn(t - tSwitch);
      const yFrom = slotY(l, slotFrom), yTo = slotY(l, slotTo);
      const sFrom = slotFrom === 'preview' ? l.pv : 1, sTo = slotTo === 'preview' ? l.pv : 1;
      const s = K.lerp(sFrom, sTo, p);
      const y1 = K.lerp(yFrom, yTo, p) + dy;
      g.save();
      if (blur > 0.1) g.filter = `blur(${blur.toFixed(2)}px)`;
      g.translate(cx, y1);
      g.scale(s, s);
      g.translate(-cx, -slotY(l, 'main'));
      const yMain = slotY(l, 'main');
      for (const it of l.items) {
        const y = yMain + it.row * l.lead;
        if (sweep) wordFill(g, it, it.x, y, t, P.ink, alpha);
        else K.drawRun(g, it.run, it.x, y, { fill: P.dim, alpha });
      }
      g.restore();
    }

    // vignette + grain are frame-static: drawn once per output frame (engine post layer)
    function drawPost(g, t) {
      const fi = Math.round(q(t) * fps);
      if (vhs) {
        // tape: a chroma-shifted ghost, tracking jitter bands, scanlines, a noise strip now and then
        g.save();
        g.setTransform(1, 0, 0, 1, 0, 0);
        const cw0 = g.canvas.width, ch0 = g.canvas.height, sc = cw0 / W;
        g.globalCompositeOperation = 'lighten';
        g.globalAlpha = 0.28;
        g.drawImage(g.canvas, Math.round(5 * unit * sc), 0);
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
        for (let k = 0; k < 3; k++) {
          const yb = Math.floor(K.noise1(seed, 'vhs-y', fi, k) * ch0);
          const hb = Math.max(2, Math.floor((4 + K.noise1(seed, 'vhs-h', fi, k) * 18) * unit * sc));
          const dx = Math.round((K.noise1(seed, 'vhs-x', fi, k) - 0.5) * 22 * unit * sc);
          g.drawImage(g.canvas, 0, yb, cw0, hb, dx, yb, cw0, hb);
        }
        g.fillStyle = '#000000';
        g.globalAlpha = 0.18;
        const sl = Math.max(2, Math.round(3 * unit * sc));
        for (let y = 0; y < ch0; y += sl) g.fillRect(0, y, cw0, 1);
        g.globalAlpha = 1;
        const cyc = K.mod(t, 5.2);
        if (cyc > 4.8) {
          const yb = ch0 * (0.86 + (cyc - 4.8) * 0.2);
          g.globalAlpha = 0.5;
          g.fillStyle = '#FFFFFF';
          for (let k = 0; k < 40; k++) g.fillRect(K.noise1(seed, 'vhs-n', fi, k) * cw0, yb + K.noise1(seed, 'vhs-m', fi, k) * 26 * unit * sc, 18 * unit * sc, 2 * sc);
        }
        g.restore();
        const tc = K.shape(fV, `PLAY \u25B6  SP ${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}:${String(fi % fps).padStart(2, '0')}`, { size: 42 * unit, tracking: 20, kerning: 'metric' });
        K.drawRun(g, tc, M, M + tc.capPx, { fill: '#F4F2FF', alpha: 0.9 });
        return;
      }
      if (silent) {
        // projector flicker, heavy grain, the odd scratch
        const fl = K.noise1(seed, 'flick', fi) * 0.14;
        g.fillStyle = '#000000'; g.globalAlpha = fl; g.fillRect(0, 0, W, H); g.globalAlpha = 1;
        filmGrain(g, W, H, { seed, frame: fi, amount: 0.17, mode: 'overlay' });
        if (K.noise1(seed, 'scr', Math.floor(fi / 3)) > 0.55) {
          const x = pillar + K.noise1(seed, 'scrx', Math.floor(fi / 3)) * (W - 2 * pillar);
          g.fillStyle = '#EFE6CF'; g.globalAlpha = 0.35; g.fillRect(x, 0, Math.max(1, 1.5 * unit), H); g.globalAlpha = 1;
        }
        const r = Math.hypot(W, H) / 2;
        const v = g.createRadialGradient(cx, H / 2, r * 0.3, cx, H / 2, r * 0.95);
        v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.75)');
        g.fillStyle = v; g.fillRect(0, 0, W, H);
        if (pillar) { K.bar(g, 0, 0, pillar, H, '#000000'); K.bar(g, W - pillar, 0, pillar, H, '#000000'); }
        return;
      }
      if (params.vignette > 0) {
        const r = Math.hypot(W, H) / 2;
        const grd = g.createRadialGradient(cx, H / 2, r * 0.35, cx, H / 2, r);
        const [br, bg_, bb] = K.hexToRgb(P.bar);
        grd.addColorStop(0, `rgba(${br},${bg_},${bb},0)`);
        grd.addColorStop(1, `rgba(${br},${bg_},${bb},${params.vignette})`);
        g.fillStyle = grd;
        g.fillRect(0, 0, W, H);
      }
      if (params.grain > 0) filmGrain(g, W, H, { seed, frame: Math.round(q(t) * fps), amount: params.grain, mode: 'overlay' });
    }

    function drawChrome(g, t) {
      if (silent) {
        // intertitle card: a double-rule frame inside the academy frame
        const x0 = pillar + M * 0.55, y0 = M * 0.55, x1 = W - pillar - M * 0.55, y1 = H - M * 0.55;
        const lw = Math.max(1, 2 * unit), gap = 9 * unit;
        g.save(); g.strokeStyle = P.ink; g.globalAlpha = 0.8;
        g.lineWidth = lw * 1.6; g.strokeRect(x0, y0, x1 - x0, y1 - y0);
        g.lineWidth = lw * 0.7; g.strokeRect(x0 + gap, y0 + gap, x1 - x0 - gap * 2, y1 - y0 - gap * 2);
        g.restore();
        return;
      }
      const bi = K.clamp(barIn.at(t), 0, 1);
      if (barH > 0 && bi > 0) {
        K.bar(g, 0, 0, W, barH * bi, P.bar);
        K.bar(g, 0, H - barH * bi, W, barH * bi, P.bar);
      }
      if (params.credits && (C.title || C.artist)) {
        const credit = [C.artist, C.title].filter(Boolean).join('  ·  ').toUpperCase();
        const run = K.shape(fM, credit, { size: 17 * unit, tracking: params.tracking.mono, kerning: 'metric' });
        const y = barH > 40 * unit ? H - barH / 2 + run.capPx / 2 : H - M * 0.8;
        const a = K.clamp(K.springStep(t - 0.2, 0.8, 1)) * (1 - K.clamp((t - (duration - 1.2)) / 0.8));
        K.drawRun(g, run, cx, y, { align: 'advance-center', fill: P.mute, alpha: a });
      }
    }

    return {
      post: drawPost,
      duration,
      draw(g, t) {
        const tq = q(t);
        g.save();
        const z = zoom.at(t);
        g.translate(cx, H / 2); g.scale(z, z); g.translate(-cx, -H / 2);
        // active index on the frame grid (so a switch never splits a frame's shutter)
        let i = -1;
        for (let k = 0; k < L.length; k++) if (tq >= act[k]) i = k;
        if (i >= 0) {
          const l = L[i];
          const since = t - act[i];
          if (i === 0) {
            // first line focuses in from nothing
            const f = glideIn(since);
            if (t < outT) drawLine(g, l, t, { slotFrom: 'main', slotTo: 'main', alpha: K.clamp(f * 1.4), blur: (1 - f) * 16 * unit, dy: (1 - f) * 18 * unit });
          } else if (t < outT || i < L.length - 1) {
            if (silent) {
              // intertitle: a hard cut to the next card, with a brief projector flash-in
              drawLine(g, l, t, { slotFrom: 'main', slotTo: 'main', alpha: K.clamp(since / 0.08) });
            } else drawLine(g, l, t, { slotFrom: 'preview', slotTo: 'main', tSwitch: act[i] + 0.06 });
          }
          // the previous line lifts away, defocusing (silent film simply cuts)
          if (i > 0 && since < 0.6 && !silent) {
            const u = K.springStep(since, 3.4, 1);
            drawLine(g, L[i - 1], t, { slotFrom: 'main', slotTo: 'main', alpha: 1 - u, blur: u * 16 * unit, dy: -u * (L[i - 1].blockH * 0.6 + L[i - 1].size * 0.6) });
          }
          // next line waits below
          if (params.preview && !silent && L[i + 1]) {
            const f = glideIn(since - 0.12);
            drawLine(g, L[i + 1], t, { slotFrom: 'preview', slotTo: 'preview', alpha: 0.55 * K.clamp(f), blur: (1 - f) * 10 * unit, sweep: false });
          }
          if (i === L.length - 1 && t >= outT) {
            const u = K.springStep(t - outT, 1.4, 1);
            drawLine(g, l, t, { slotFrom: 'main', slotTo: 'main', alpha: 1 - u, blur: u * 18 * unit, dy: -u * l.size * 0.3 });
          }
        }
        g.restore();
        drawChrome(g, t);
      },
    };
  },
};
