// LYRIC STACK — high-energy kinetic lyric video.
// Every line becomes a poster: words land exactly on their sung start times
// and auto-stack into 2–5 balanced rows of different sizes (held / emphasised
// words set huge in a condensed display face, connective words small in a
// grotesk). Held notes stretch their tracking and fill a sustain meter; the
// camera punches on the beat; lines change by cut, smash-pan or wipe, chosen
// deterministically so no two consecutive transitions repeat.
import * as K from '../../src/kit/index.js';
import { FUNCTION_WORDS, wordKey, normalizeLyrics, lineAt, energyAt, displayWord, punchEnv } from '../../src/kit/x-lyrics.js';

const MODES = ['cut', 'smash', 'wipe'];
const STYLES = ['poster', 'handbill', 'minimal'];
const STYLE_PALETTE = {
  poster: {},
  handbill: { bg: '#ECE6D9', ink: '#141312', a: '#D2281A', mute: '#5C564C' },
  minimal: { bg: '#0D0D0E', ink: '#EDEDED', a: '#EDEDED', mute: '#828282' },
};

export default {
  id: 'lyric-stack',
  version: '1.1.0',
  name: 'Lyric Stack',
  description:
    'High-energy kinetic lyric video: word-timed poster stacks (huge held/emphasised words, small connective words), sustain meters, beat punches, cut/smash-pan/wipe line changes. Vertical-first, works in any format.',
  tags: ['lyric', 'music', 'kinetic', 'poster', 'shorts', 'reels', 'youtube'],
  formats: ['vertical', 'square', 'portrait', 'landscape'],
  bpm: 96,
  duration: 24,
  loop: false,
  palette: { bg: '#0B0B0C', ink: '#F4F1EA', a: '#FF3B1F', mute: '#8C8C8C' },
  paletteRoles: { bg: 'background', ink: 'sung words', a: 'emphasis words, sustain meter, wipe edge', mute: 'labels (neutral grey)' },
  fonts: {
    display: { family: 'Anton', weight: 400 },
    grotesk: { family: 'Inter Tight', weight: 800 },
    mono: { family: 'IBM Plex Mono', weight: 500 },
  },
  params: {
    uppercase: true,
    stripPunctuation: true,
    align: 'left',
    tracking: { display: 10, grotesk: -20, mono: 30 },
    punch: 0.035,
    labels: true,
    glow: 0,
    platformSafe: true,
    tail: 1.6,
    transitions: ['cut', 'smash', 'wipe'],
    style: 'poster',
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
          description: 'Word-timed lyrics (docs/LYRICS_FORMAT.md). Use content.lyricsSrc to reference a JSON file instead.',
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
        title: { type: 'string', maxLength: 40, description: 'Song title (small corner label)' },
        artist: { type: 'string', maxLength: 40, description: 'Artist (small corner label)' },
      },
    },
    params: {
      type: 'object',
      additionalProperties: false,
      properties: {
        uppercase: { type: 'boolean' },
        stripPunctuation: { type: 'boolean' },
        align: { enum: ['left', 'center', 'margin'], description: 'left = flush-left rows in a centred block; margin = hard left; center' },
        tracking: { type: 'object', properties: { display: { type: 'number' }, grotesk: { type: 'number' }, mono: { type: 'number' } }, additionalProperties: false },
        punch: { type: 'number', minimum: 0, maximum: 0.12, description: 'Beat punch zoom amount' },
        style: { enum: STYLES, description: 'poster (condensed poster stacks, beat punches) | handbill (paper flyer: black ink, red accent, lines pasted askew, grain) | minimal (one grotesk voice, whole line waits dimmed, words light as sung, no punch)' },
        glow: { type: 'number', minimum: 0, maximum: 1, description: 'Neon bloom around the type (0 = off): soft outer glow plus a tight halo, tinted toward palette.a' },
        labels: { type: 'boolean' },
        platformSafe: { type: 'boolean', description: 'Keep vertical layouts clear of Shorts/Reels UI (top 12%, bottom 30%)' },
        tail: { type: 'number', minimum: 0, maximum: 10, description: 'Seconds held after the last word before the end' },
        transitions: { type: 'array', items: { enum: ['cut', 'smash', 'wipe'] }, minItems: 1 },
      },
    },
  },
  example: {
    template: 'lyric-stack',
    format: 'vertical',
    fps: 60,
    bpm: 96,
    seed: 11,
    content: { lyricsSrc: 'lyrics/demo-verse.json', title: 'Hold The Line', artist: 'Demo Artist' },
  },
  notes:
    'Duration defaults to the last word end + params.tail. With audio.analysis, punches follow the detected beats and scale with energy. Never more than one line block on screen except during a 0.3s transition.',

  build(ctx) {
    const { W, H, params, content: C, fonts, beat, seed, qa, fps } = ctx;
    const style = STYLES.includes(params.style) ? params.style : 'poster';
    const userPal = ctx.spec.palette || {};
    for (const [k, v] of Object.entries(STYLE_PALETTE[style])) if (!(k in userPal)) ctx.palette[k] = v;
    const P = ctx.palette;
    const lines = normalizeLyrics(C.lyrics).lines;
    const fG = fonts.get('grotesk'), fM = fonts.get('mono');
    // minimal sets everything in one grotesk voice
    const fD = style === 'minimal' ? fG : fonts.get('display');
    const tr = params.tracking;
    const unit = Math.min(W, H) / 1080;
    const aspect = ctx.aspect;
    const M = Math.round(Math.min(W, H) * 0.075);
    const IW = W - 2 * M;
    const vertical = aspect === 'vertical' || H / W > 1.15;
    const safeTop = vertical && params.platformSafe ? H * 0.12 : M + 44 * unit;
    const safeBot = vertical && params.platformSafe ? H * 0.7 : H - M - 44 * unit;
    const safeH = safeBot - safeTop;
    const capMax = (vertical ? 0.2 : aspect === 'landscape' ? 0.27 : 0.23) * H;
    const lastEnd = lines[lines.length - 1].end;
    const duration = ctx.spec.duration ?? lastEnd + params.tail;
    const q = (t) => K.frameQuant(t, fps);
    const disp = (w) => displayWord(w, { upper: params.uppercase, strip: params.stripPunctuation });

    // ── layout: each line → balanced poster rows ─────────────────────────────
    const REL = style === 'minimal' ? { hero: 1, body: 0.86, fn: 0.62 } : { hero: 1, body: 1, fn: 0.46 };
    const faceOf = (kind) => (kind === 'fn' ? fG : fD);
    const trackOf = (kind) => (kind === 'fn' ? tr.grotesk : tr.display);
    const shapeTok = (tok, size) => K.shape(faceOf(tok.kind), tok.text, { size: size * REL[tok.kind], tracking: trackOf(tok.kind), capSymbols: true });

    // word space in em of the row size: small connective pairs need relatively more air
    const gapEm = (a, b) => (a.kind === 'fn' && b.kind === 'fn' ? 0.16 : 0.2 * Math.max(REL[a.kind], REL[b.kind]));
    function partition(toks, k) {
      const n = toks.length;
      const len = toks.map((t) => [...t.text].length * (t.kind === 'fn' ? 0.5 : 1) + 0.6);
      const total = len.reduce((a, b) => a + b, 0), mean = total / k;
      let best = null;
      const rec = (start, left, acc) => {
        if (left === 1) {
          const rows = [...acc, [start, n]];
          let cost = 0;
          for (const [a, b] of rows) {
            const l = len.slice(a, b).reduce((x, y) => x + y, 0);
            cost += (l - mean) ** 2;
            const seg = toks.slice(a, b);
            if (seg[seg.length - 1].kind === 'fn' && b < n) cost += mean * mean * 0.8; // no dangling "the"
            const heroes = seg.filter((t) => t.kind === 'hero').length;
            if (heroes && seg.length > 2) cost += mean * mean * 0.35 * heroes; // heroes want their own row
          }
          if (!best || cost < best.cost) best = { cost, rows };
          return;
        }
        for (let e = start + 1; e <= n - (left - 1); e++) rec(e, left - 1, [...acc, [start, e]]);
      };
      rec(0, k, []);
      return best.rows;
    }

    function layoutLine(line, li) {
      const toks = line.words.map((w, wi) => {
        const key = wordKey(w.text);
        const dur = w.end - w.start;
        const kind = w.emph || (dur >= 0.75 && key.length >= 3) ? 'hero' : FUNCTION_WORDS.has(key) && key.length <= 5 ? 'fn' : 'body';
        return { w, wi, text: disp(w.text), kind, held: dur >= 0.75, dur };
      }).filter((t) => t.text);
      const n = toks.length;
      let k = n <= 2 ? n : n <= 4 ? 2 : n <= 7 ? 3 : n <= 10 ? 4 : 5;
      if (!vertical) k = Math.min(k, aspect === 'landscape' ? 3 : 4);
      const rowsIdx = partition(toks, Math.max(1, Math.min(k, n)));
      // size each row so its ink fills the measure (capped), then fit the stack
      const rows = rowsIdx.map(([a, b]) => {
        const seg = toks.slice(a, b);
        const probe = seg.map((t) => shapeTok(t, 1000));
        const gapU = (i) => gapEm(seg[i], seg[i + 1]) * 1000;
        let wsum = probe.reduce((x, r) => x + r.inkWidth, 0);
        for (let i = 0; i < seg.length - 1; i++) wsum += gapU(i);
        const capAt1000 = Math.max(...probe.map((r) => r.capPx));
        const size = Math.min((IW * 1000) / wsum, (capMax * 1000) / capAt1000);
        return { seg, size };
      });
      const gapOf = (r) => 0.1 * rows[r].size * 0.72 + 14 * unit;
      let scale = 1;
      const buildRows = (s) =>
        rows.map((r) => {
          const runs = r.seg.map((t) => shapeTok(t, r.size * s));
          return { ...r, runs };
        });
      let built = buildRows(1);
      const stackH = (b) => K.stackHeight(b.map((r) => tallest(r.runs)), 0, b.map((_, i) => gapOf(i) * scale));
      const h0 = stackH(built);
      if (h0 > safeH) {
        scale = safeH / h0;
        built = buildRows(scale);
      }
      const reps = built.map((r) => tallest(r.runs));
      const gaps = built.map((_, i) => gapOf(i) * scale);
      const hh = K.stackHeight(reps, 0, gaps);
      const bases = K.stackInk(reps, { top: K.snap(safeTop + (safeH - hh) / 2, 8), gaps });
      const items = [];
      const rowW = built.map((r) => r.runs.reduce((x, run) => x + run.inkWidth, 0) + r.runs.slice(0, -1).reduce((x, run, i) => x + gapEm(r.seg[i], r.seg[i + 1]) * r.size * scale, 0));
      // 'left': rows flush-left inside a block that is itself centred (a poster
      // column, not a left-hugging paragraph); 'margin': hard left; 'center'.
      const blockLeft = params.align === 'margin' ? M : M + (IW - Math.max(...rowW)) / 2;
      built.forEach((r, ri) => {
        const inkW = rowW[ri];
        let x = params.align === 'center' ? (W - inkW) / 2 : blockLeft;
        const rowSlack = W - M - (x + inkW);
        r.runs.forEach((run, i) => {
          const tok = r.seg[i];
          items.push({ ...tok, run, row: ri, x: x - run.inkLeft, y: bases[ri], slack: rowSlack });
          x += run.inkWidth + (i < r.runs.length - 1 ? gapEm(tok, r.seg[i + 1]) * r.size * scale : 0);
        });
      });
      const box = {
        x0: Math.min(...items.map((it) => it.x + it.run.inkLeft)),
        x1: Math.max(...items.map((it) => it.x + it.run.inkRight)),
        y0: Math.min(...items.map((it) => it.y + it.run.inkTop)),
        y1: Math.max(...items.map((it) => it.y + it.run.inkBottom)),
      };
      return { line, li, items, box, rows: built.length, cx: (box.x0 + box.x1) / 2, cy: (box.y0 + box.y1) / 2 };
    }
    const tallest = (runs) => runs.reduce((a, r) => (r.capPx > a.capPx || -r.inkTop > -a.inkTop ? r : a), runs[0]);

    const L = lines.map(layoutLine);

    // ── transitions: deterministic, never the same twice in a row ─────────────
    const allowed = params.transitions.filter((m) => MODES.includes(m));
    const modes = [null];
    for (let i = 1; i < L.length; i++) {
      let m = allowed[Math.floor(K.noise1(seed, 'tr', i) * allowed.length)];
      if (allowed.length > 1 && m === modes[i - 1]) m = allowed[(allowed.indexOf(m) + 1) % allowed.length];
      modes.push(m);
    }
    const TR = 0.3; // transition length (s)
    // Pre-roll: a moving transition must LAND on the next line's first sung
    // word, not start there (starting on the word made it visible ~0.2 s late).
    // Never pre-roll before the previous line's last word has landed.
    const tStart = L.map((l, i) => {
      const T = l.line.start;
      if (i === 0 || modes[i] === 'cut') return T;
      const prevLast = L[i - 1].line.words[L[i - 1].line.words.length - 1].start;
      return Math.max(prevLast + 0.12, T - TR * 0.75, T - TR);
    });

    // ── QA registration ───────────────────────────────────────────────────────
    const byRow = (l) => {
      const out = [];
      for (let r = 0; r < l.rows; r++) out.push(l.items.filter((it) => it.row === r).map((it) => it.text).join(' '));
      return out;
    };
    L.forEach((l) => {
      l.items.forEach((it) => qa.hit(it.w.start, `${l.li}:${it.text}`));
      const minCap = Math.min(...l.items.map((it) => it.run.capPx));
      qa.text(`line-${l.li + 1}`, { box: l.box, size: minCap, fg: P.ink, bg: P.bg, lines: byRow(l), orphanOk: true });
      l.items.filter((it) => it.w.emph).forEach((it) => qa.text(`line-${l.li + 1}-emph-${it.text}`, { box: K.runBox(it.run, it.x, it.y), size: it.run.capPx, fg: P.a, bg: P.bg }));
    });
    qa.note(`${L.length} lines, transitions: ${modes.slice(1).join(', ')}`);
    const lab = (s) => K.shape(fM, s, { size: 16 * unit, tracking: tr.mono, kerning: 'metric' });
    const labTop = vertical && params.platformSafe ? H * 0.075 : M;
    const labBot = vertical && params.platformSafe ? H * 0.72 + 40 * unit : H - M;
    if (params.labels) qa.text('labels', { box: { x0: M, y0: labTop - 12 * unit, x1: W - M, y1: labBot }, size: 11 * unit, fg: P.mute, bg: P.bg, decorative: true });

    // keyframes: each line fully built, a few mid-builds and transitions
    const kf = [[0.2, 'pre-roll']];
    L.forEach((l, i) => {
      const next = L[i + 1]?.line.start ?? lastEnd + 0.4;
      kf.push([Math.min(next - 0.04, l.line.end + 0.1), `line ${i + 1} built`]);
    });
    const mid = L.find((l) => l.items.length >= 10) || L[0];
    kf.push([mid.items[Math.floor(mid.items.length / 2)].w.start + 0.03, 'fast line mid-build']);
    const held = L.flatMap((l) => l.items).find((it) => it.held && it.dur > 1.5);
    if (held) kf.push([held.w.start + held.dur * 0.5, 'sustain meter']);
    for (let i = 1; i < L.length && kf.length < 17; i++) if (modes[i] !== 'cut') kf.push([tStart[i] + TR * 0.5, `${modes[i]} → line ${i + 1}`]);
    kf.push([duration - 1 / fps, 'last frame']);
    kf.sort((a, b) => a[0] - b[0]).forEach(([t, l]) => qa.keyframe(t, l));

    // ── drawing ──────────────────────────────────────────────────────────────
    function drawLine(g, l, t, { alpha = 1 } = {}) {
      const e = energyAt(ctx.audio, t);
      const amt = style === 'minimal' ? 0 : params.punch * (e == null ? 1 : 0.5 + e);
      const z = 1 + amt * punchEnv(beat, t, 1, 7) + amt * 0.8 * punchEnv(beat, t, beat.beatsPerBar, 5);
      g.save();
      g.translate(l.cx, l.cy);
      // handbill: each line is a flyer pasted up slightly askew (deterministic per line)
      if (style === 'handbill') g.rotate((K.noise1(seed, 'tilt', l.li) - 0.5) * 0.09);
      g.scale(z, z);
      g.translate(-l.cx, -l.cy);
      const shift = new Map(); // row → extra px from sustained words earlier in the row
      for (const it of l.items) {
        const w = it.w;
        const ds = t - w.start;
        const extra = shift.get(it.row) || 0;
        if (ds < 0) {
          // minimal: the whole line waits, dimmed; each word lights as it is sung
          if (style === 'minimal') K.drawRun(g, it.run, it.x + extra, it.y, { fill: P.ink, alpha: alpha * 0.16 });
          continue;
        }
        const fill = w.emph ? P.a : P.ink;
        const o = { fill, alpha };
        let spread = 0;
        if (it.held) {
          // sustained note: glyphs arrive in a quick ripple, tracking widens
          // across the sung duration (only into real slack), meter fills
          const n = it.run.inked.length;
          const prog = K.clamp(ds / it.dur);
          const maxSpread = Math.max(0, Math.min(it.slack * 0.7, it.run.capPx * 0.34));
          spread = maxSpread * K.cubicOut(prog);
          const per = n > 1 ? spread / (n - 1) : 0;
          const step = Math.min(0.055, (0.45 * it.dur) / Math.max(1, n));
          o.each = (g2, k) => {
            const d = ds - k * step;
            if (d < 0) return { hidden: true };
            const p = K.springStep(d, 3.4, 0.62);
            return { dx: extra + per * k, dy: (1 - p) * it.run.capPx * 0.55, alpha: K.clamp(K.springStep(d, 9, 1)) };
          };
          const mw = (it.run.inkWidth + spread) * prog;
          const my = it.y + Math.max(10 * unit, it.run.inkBottom) + 8 * unit;
          K.bar(g, it.x + it.run.inkLeft + extra, my, mw, Math.max(4, 7 * unit), P.a);
        } else if (it.kind === 'hero') {
          const p = K.springStep(ds, 3.1, 0.56);
          o.group = { s: 1 + (1 - p) * 0.45, dx: extra };
          o.alpha = alpha * K.clamp(K.springStep(ds, 11, 1));
        } else if (it.kind === 'fn') {
          const p = K.springStep(ds, 4.6, 0.8);
          o.group = { dx: extra - (1 - p) * it.run.capPx * 0.8 };
          o.alpha = alpha * K.clamp(K.springStep(ds, 10, 1));
        } else {
          const p = K.springStep(ds, 4, 0.66);
          o.group = { dx: extra, dy: (1 - p) * it.run.capPx * 0.6 };
          o.alpha = alpha * K.clamp(K.springStep(ds, 11, 1));
        }
        K.drawRun(g, it.run, it.x, it.y, o);
        if (spread) shift.set(it.row, extra + spread);
      }
      g.restore();
    }

    function drawLabels(g, t, li) {
      if (!params.labels) return;
      const items = [[`${String(li + 1).padStart(2, '0')}/${String(L.length).padStart(2, '0')}`, M, labTop, 'l'], [`${Math.round(beat.bpm)} BPM`, W - M, labTop, 'r']];
      const credit = [C.artist, C.title].filter(Boolean).join(' — ');
      if (credit) items.push([credit.toUpperCase(), M, labBot, 'l']);
      const tq = q(t), mm = Math.floor(tq / 60), ss = (tq % 60).toFixed(2).padStart(5, '0');
      items.push([`${String(mm).padStart(2, '0')}:${ss}`, W - M, labBot, 'r']);
      for (const [s, x, y, al] of items) {
        const run = lab(s);
        K.drawRun(g, run, al === 'r' ? x - run.advance : x, y, { fill: P.mute });
      }
    }

    const outStart = lastEnd + Math.min(0.6, params.tail * 0.4);
    return {
      post(g) {
        if (style === 'handbill') K.grain(g, W, H, { seed: 3, frame: 0, amount: 0.12, mode: 'multiply' });
        K.bloom(g, { amount: K.glowAmount(params), color: P.a, unit });
      },
      duration,
      samplesHint: (t) => {
        for (let i = 1; i < L.length; i++) if (modes[i] !== 'cut' && t > tStart[i] - 0.01 && t < tStart[i] + TR) return 24;
        return 0;
      },
      draw(g, t) {
        // cuts happen BETWEEN frames: choose the line on the frame grid so no
        // motion-blur sub-sample of one frame straddles a cut (ghost frames)
        let i = lineAt(lines, q(t));
        if (i + 1 < L.length && q(t) >= tStart[i + 1]) i++; // pre-rolled transition into the next line
        drawLabels(g, t, Math.max(0, i));
        if (i < 0) return;
        const l = L[i];
        const T = tStart[i];
        const mode = modes[i];
        if (i === L.length - 1 && t >= outStart) {
          // outro: the last poster drops away
          const u = K.clamp((t - outStart) / 0.45);
          if (u >= 1) return;
          g.save();
          g.translate(0, K.cubicIn(u) * H * 0.08);
          drawLine(g, l, t, { alpha: 1 - K.cubicIn(u) });
          g.restore();
          return;
        }
        if (i > 0 && t < T + TR && mode !== 'cut') {
          const prev = L[i - 1];
          if (mode === 'smash') {
            const pan = K.springStep(t - T, 4.4, 0.8) * W;
            g.save(); g.translate(-pan, 0); drawLine(g, prev, t); g.restore();
            g.save(); g.translate(W - pan, 0); drawLine(g, l, t); g.restore();
            return;
          }
          // wipe: an accent blade sweeps; the new line lives behind it
          const u = K.expoInOut(K.clamp((t - T) / TR));
          const bw = 0.07 * W;
          const edge = -bw + (W + bw * 2) * u;
          g.save(); g.beginPath(); g.rect(edge, 0, W, H); g.clip(); drawLine(g, prev, t); g.restore();
          g.save(); g.beginPath(); g.rect(0, 0, Math.max(0, edge - bw), H); g.clip(); drawLine(g, l, t); g.restore();
          K.bar(g, edge - bw, 0, bw, H, P.a);
          return;
        }
        drawLine(g, l, t);
      },
    };
  },
};
