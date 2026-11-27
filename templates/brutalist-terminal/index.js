// BRUTALIST TERMINAL — a raw command-line sequence on a hard mono grid.
// Commands type in with a block caret, output prints on sixteenths, ASCII
// progress bars fill in chunks that land on beats, a key line gets an inverse
// highlight, and the closing statement punches THROUGH the terminal: its
// letterforms are windows that invert the screen, then it goes solid.
import * as K from '../../src/kit/index.js';

const STYLES = ['brutal', 'crt-phosphor', 'paper-teletype'];
const STYLE_PALETTE = {
  brutal: {},
  'crt-phosphor': { bg: '#020C05', ink: '#8CFFAE', dim: '#2F7D4A', a: '#E2FFEA' },
  'paper-teletype': { bg: '#EEEAE0', ink: '#1C1A17', dim: '#8C867B', a: '#C4301C' },
};

export default {
  id: 'brutalist-terminal',
  version: '1.0.0',
  name: 'Brutalist Terminal',
  description:
    'Mono-grid command-line sequence: typed commands, sixteenth-note output, beat-filled ASCII progress bars, an inverted key line, and a heavy display statement that punches through the terminal. Dev/tech YouTube intros and explainers.',
  tags: ['terminal', 'code', 'dev', 'tech', 'mono', 'explainer', 'intro'],
  formats: ['landscape', 'square', 'vertical', 'portrait'],
  bpm: 120,
  duration: 16,
  loop: false,
  palette: { bg: '#0A0A0A', ink: '#EDEDED', dim: '#6E6E6E', a: '#FF5A1F' },
  paletteRoles: { bg: 'screen', ink: 'text', dim: 'prompt, grid, secondary output (neutral)', a: 'the one accent: caret, bars, highlight' },
  fonts: {
    mono: { family: 'JetBrains Mono', weight: 500 },
    monoBold: { family: 'JetBrains Mono', weight: 800 },
    display: { family: 'Archivo Black', weight: 400 },
    crt: { family: 'VT323', weight: 400 },
    typewriter: { family: 'Courier Prime', weight: 400 },
    typewriterBold: { family: 'Courier Prime', weight: 700 },
  },
  params: {
    cols: 0, // 0 = by format (landscape 64, square 40, vertical 32)
    cps: 24, // typing speed, chars/sec
    grid: true, // faint character-grid dots
    statementTracking: -40,
    style: 'brutal',
  },
  schema: {
    content: {
      type: 'object',
      additionalProperties: false,
      required: ['steps', 'statement'],
      properties: {
        title: { type: 'string', maxLength: 40, description: 'Header bar text (window title).' },
        prompt: { type: 'string', maxLength: 16, description: 'Prompt before each command, e.g. "~/app $".' },
        steps: {
          type: 'array',
          minItems: 1,
          maxItems: 6,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['cmd'],
            properties: {
              cmd: { type: 'string', maxLength: 60 },
              output: {
                type: 'array',
                maxItems: 8,
                items: {
                  oneOf: [
                    { type: 'string', maxLength: 90 },
                    {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        text: { type: 'string', maxLength: 90 },
                        highlight: { type: 'boolean', description: 'Invert this line on the next beat.' },
                        dim: { type: 'boolean' },
                        progress: { type: 'string', maxLength: 24, description: 'Label of an ASCII progress bar (replaces text).' },
                        beats: { type: 'integer', minimum: 1, maximum: 8, description: 'Beats the progress bar takes to fill.' },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
        statement: { type: 'string', maxLength: 24, description: 'Closing statement, 1–3 words, set huge.' },
        sub: { type: 'string', maxLength: 40, description: 'Optional mono line under the statement.' },
      },
    },
    params: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cols: { type: 'integer', minimum: 0, maximum: 140 },
        cps: { type: 'number', minimum: 4, maximum: 80 },
        grid: { type: 'boolean' },
        statementTracking: { type: 'number' },
        style: { enum: STYLES, description: 'brutal (mono grid, one hot accent) | crt-phosphor (VT323 pixel font, green phosphor, bloom + scanlines) | paper-teletype (Courier Prime on paper, red ribbon accent, paper grain)' },
      },
    },
  },
  notes: 'ASCII is safest; any character missing from the mono font fails QA. Lines longer than the grid wrap. Duration is derived from the content unless the spec sets it.',
  example: {
    template: 'brutalist-terminal',
    format: 'landscape',
    fps: 60,
    bpm: 120,
    seed: 5,
    content: {
      title: 'render.sh  --  zsh',
      prompt: '~/studio $',
      steps: [
        { cmd: 'kinetype templates', output: [{ text: '12 templates  /  0 dependencies on luck', dim: true }, 'street-poster  lyric-stack  split-flap  countdown'] },
        { cmd: 'kinetype render bumper.json --samples 8', output: [{ progress: 'frames', beats: 3 }, { progress: 'encode', beats: 2 }, { text: 'verdict: PASS  (frame 0 == frame 1199)', highlight: true }] },
        { cmd: 'ship --everywhere', output: ['uploaded: x  youtube  shorts'] },
      ],
      statement: 'SHIP IT.',
      sub: 'deterministic. every frame. every time.',
    },
  },

  build(ctx) {
    const { W, H, params, content: C, fonts, beat, seed, qa, fps } = ctx;
    const style = STYLES.includes(params.style) ? params.style : 'brutal';
    const userPal = ctx.spec.palette || {};
    for (const [k, v] of Object.entries(STYLE_PALETTE[style])) if (!(k in userPal)) ctx.palette[k] = v;
    const P = ctx.palette;
    // each style is its own machine: brutal mono, a CRT's pixel font, a teletype's slab
    const fM = style === 'crt-phosphor' ? fonts.get('crt') : style === 'paper-teletype' ? fonts.get('typewriter') : fonts.get('mono');
    const fB = style === 'crt-phosphor' ? fonts.get('crt') : style === 'paper-teletype' ? fonts.get('typewriterBold') : fonts.get('monoBold');
    const fD = fonts.get('display');
    const unit = Math.min(W, H) / 1080;
    const M = Math.round(Math.min(W, H) * 0.055);
    const q = (t) => K.frameQuant(t, fps);
    const B = (n) => beat.t(n);
    const S16 = beat.spb / 4;

    // ── grid
    const cols = params.cols || (ctx.aspect === 'landscape' ? 56 : ctx.aspect === 'vertical' ? 26 : 38);
    const advU = fM.glyph('M').adv / fM.upm; // em per cell
    const size = (W - 2 * M) / (cols * advU);
    const cw = size * advU, rowH = Math.round(size * 1.5);
    const capPx = fM.px(fM.capHeight, size);
    const headH = Math.round(rowH * 1.25);
    const x0 = M, top = M + headH + rowH * 0.6;
    const rowsVis = Math.floor((H - M - top) / rowH);
    const rowY = (r) => top + r * rowH + rowH / 2 + capPx / 2; // baseline of screen row r
    const runCache = new Map();
    const run = (s, face = fM) => {
      const key = face.key + '|' + s;
      let r = runCache.get(key);
      if (!r) { r = K.shape(face, s, { size, tracking: 0, kerning: 'none' }); runCache.set(key, r); }
      return r;
    };
    const wrap = (s) => {
      const out = [];
      for (let i = 0; i < Math.max(1, s.length); i += cols) out.push(s.slice(i, i + cols));
      return out;
    };

    // ── timeline: flatten steps into screen lines with appear times
    const prompt = (C.prompt ?? '$') + ' ';
    const lines = []; // {t, kind, text?, ...}
    let beatCursor = 1;
    const tHead = B(0);
    qa.hit(tHead, 'header');
    let lastT = B(1);
    C.steps.forEach((st, si) => {
      const tStart = B(beatCursor);
      qa.hit(tStart, `prompt ${si + 1}`);
      const tType = tStart + S16;
      const full = prompt + st.cmd;
      // typed timing (seeded human jitter)
      let acc = tType;
      const charT = [...st.cmd].map((_, i) => { acc += (0.55 + 0.9 * K.noise1(seed, 'ty', si, i)) / params.cps; return acc; });
      const tTyped = charT.length ? charT[charT.length - 1] : tType;
      const tEnter = Math.ceil((tTyped + S16) / S16 - 1e-9) * S16;
      const cmdRows = wrap(full).length;
      lines.push({ kind: 'cmd', t: tStart, tType, charT, tEnter, text: full, promptLen: prompt.length, rows: cmdRows, step: si });
      let t = tEnter + S16;
      for (const o of st.output || []) {
        const item = typeof o === 'string' ? { text: o } : o;
        if (item.progress) {
          const beats = item.beats ?? 2;
          const t0 = Math.ceil(t / beat.spb - 1e-9) * beat.spb; // bars start on a beat
          lines.push({ kind: 'bar', t: t0, label: item.progress, beats, fillT: Array.from({ length: beats }, (_, k) => t0 + (k + 1) * beat.spb), rows: 1 });
          for (let k = 1; k <= beats; k++) qa.hit(t0 + k * beat.spb, `${item.progress} ${k}/${beats}`);
          t = t0 + beats * beat.spb + S16;
        } else {
          const rows = wrap(item.text || '');
          rows.forEach((r, k) => lines.push({ kind: 'out', t: t + k * S16, text: r, dim: !!item.dim, rows: 1 }));
          const L = lines[lines.length - 1];
          if (item.highlight) {
            const th = Math.ceil((t + S16) / beat.spb - 1e-9) * beat.spb;
            L.hiT = th;
            qa.hit(th, 'highlight');
            t = Math.max(t + rows.length * S16, th + beat.spb * 0.5);
          } else t += rows.length * S16;
        }
      }
      lastT = t;
      beatCursor = Math.ceil(t / beat.spb - 1e-9) + 1;
    });
    const barLabelW = Math.max(4, ...lines.filter((l) => l.kind === 'bar').map((l) => l.label.length + 2));
    // screen rows: every line occupies `rows` rows
    let row = 0;
    for (const L of lines) { L.row = row; row += L.rows; }
    // scroll: one row each time a new row would fall off the bottom (spring snap)
    const scroll = new K.Track(0);
    for (const L of lines) {
      for (let k = 0; k < L.rows; k++) {
        const r = L.row + k;
        if (r >= rowsVis) scroll.spring(L.kind === 'cmd' && k > 0 ? L.tEnter - S16 : L.t, r - rowsVis + 1, { f: 7, z: 0.9 });
      }
    }

    // ── statement
    // a fresh, idle prompt with a blinking caret; the statement lands on the next half-bar
    const idleBeat = beatCursor - 1;
    lines.push({ kind: 'cmd', t: B(idleBeat), tType: B(idleBeat), charT: [], tEnter: Infinity, text: prompt, promptLen: prompt.length, rows: 1, idle: true, row: lines.length ? lines[lines.length - 1].row + lines[lines.length - 1].rows : 0 });
    { const L = lines[lines.length - 1]; if (L.row >= rowsVis) scroll.spring(L.t, L.row - rowsVis + 1, { f: 7, z: 0.9 }); }
    qa.hit(B(idleBeat), 'idle prompt');
    const barBeat = Math.ceil((idleBeat + 1.5) / 2) * 2;
    const tPunch = B(barBeat), tSolid = B(barBeat + 1), tSub = B(barBeat + 2);
    qa.hit(tPunch, 'statement punches through');
    qa.hit(tSolid, 'statement solid');
    const IW = W - 2 * M;
    // choose 1–3 lines: the layout with the biggest cap height whose stack fits 62% of the frame
    const words = C.statement.toUpperCase().trim().split(/\s+/);
    const maxCap = (ctx.aspect === 'landscape' ? 0.3 : 0.2) * H;
    let best = null;
    for (let n = 1; n <= Math.min(3, words.length); n++) {
      const ls = n === 1 ? [words.join(' ')] : K.balanceLines(fD, words.join(' '), 1, { size: 1000, tracking: params.statementTracking }).length === n
        ? K.balanceLines(fD, words.join(' '), 1, { size: 1000, tracking: params.statementTracking })
        : splitEven(words, n);
      const sz = Math.min(...ls.map((l) => K.fitSize(fD, l, IW, { tracking: params.statementTracking, capSymbols: true })), (maxCap * fD.upm) / fD.capHeight);
      const cap = fD.px(fD.capHeight, sz);
      const stackH = cap * n + cap * 0.16 * (n - 1);
      if (stackH > H * 0.62) continue;
      if (!best || cap > best.cap * 1.08) best = { ls, sz, cap };
    }
    function splitEven(ws, n) {
      const out = [];
      const per = Math.ceil(ws.length / n);
      for (let i = 0; i < ws.length; i += per) out.push(ws.slice(i, i + per).join(' '));
      return out;
    }
    const sRuns = best.ls.map((l) => K.shape(fD, l, { size: best.sz, tracking: params.statementTracking, capSymbols: true }));
    const sGap = Math.round(sRuns[0].capPx * 0.16);
    const subRun = C.sub ? K.shape(fM, C.sub, { size: Math.max(20 * unit, size * 0.9), tracking: 10, kerning: 'none' }) : null;
    const sH = K.stackHeight(sRuns, sGap) + (subRun ? subRun.capPx + 60 * unit : 0);
    const sBases = K.stackInk(sRuns, { top: K.snap(H / 2 - sH / 2, 8), gap: sGap });
    const sX = (r) => M - r.inkLeft;
    const lastRun = sRuns[sRuns.length - 1];
    const caretX = sX(lastRun) + lastRun.inkRight + lastRun.capPx * 0.12;
    const caretW = lastRun.capPx * 0.5;
    const caretFits = caretX + caretW <= W - M;
    const sPath = (() => {
      const p = new Path2D();
      sRuns.forEach((r, i) => p.addPath(K.runPath(r, sX(r), sBases[i])));
      return p;
    })();
    const duration = ctx.spec.duration ?? tSub + beat.spb * 8;
    sRuns.forEach((r, i) => qa.text('statement-' + i, { box: K.runBox(r, sX(r), sBases[i]), size: r.capPx, fg: P.ink, bg: P.bg }));
    if (subRun) qa.text('sub', { box: K.runBox(subRun, M, sBases[sBases.length - 1] + 60 * unit + subRun.capPx), size: subRun.capPx * 1.4, fg: P.dim, bg: P.bg });
    qa.text('terminal', { box: { x0, y0: top, x1: x0 + cols * cw, y1: top + rowsVis * rowH }, size: capPx * 1.4, fg: P.ink, bg: P.bg });
    qa.text('terminal-dim', { box: { x0, y0: top, x1: x0 + cols * cw, y1: top + rowsVis * rowH }, size: capPx * 1.4, fg: P.dim, bg: P.bg });

    // ── drawing
    const title = C.title ?? '';
    function drawHeader(g, t, inv) {
      const p = K.expoOut(K.clamp((t - tHead) / 0.45));
      if (p <= 0) return;
      K.bar(g, M, M, (W - 2 * M) * p, headH, inv ? P.bg : P.ink);
      if (p > 0.85) {
        const yb = M + headH / 2 + capPx / 2;
        K.drawRun(g, run(title, fB), M + cw, yb, { fill: inv ? P.ink : P.bg });
        const dims = `${cols}x${rowsVis}`;
        const rr = run(dims, fB);
        K.drawRun(g, rr, W - M - cw - rr.advance, yb, { fill: inv ? P.ink : P.bg });
      }
    }

    function drawGrid(g, t, col) {
      if (!params.grid) return;
      const a = K.clamp((t - tHead) / 0.6);
      if (a <= 0) return;
      g.fillStyle = col;
      const d = Math.max(1, 2 * unit);
      for (let r = 0; r <= rowsVis; r++) for (let c = 0; c <= cols; c += 4) g.fillRect(x0 + c * cw - d / 2, top + r * rowH - d / 2, d, d);
    }

    // caret position/state at t
    function caretState(t) {
      let pos = null, solid = false;
      for (const L of lines) {
        if (L.kind !== 'cmd' || t < L.t) continue;
        const n = L.charT.filter((c) => c <= t).length;
        if (t < L.tEnter) {
          const col = L.promptLen + n;
          pos = { row: L.row + Math.floor(col / cols), col: col % cols };
          solid = t >= L.tType && t < L.charT[L.charT.length - 1] + S16;
        } else pos = null;
      }
      // idle caret after all output, on a fresh prompt-less row
      return { pos, solid };
    }

    function drawTerminal(g, t, inv = false) {
      const tq = q(t);
      const ink = inv ? P.bg : P.ink, dim = inv ? P.bg : P.dim, acc = inv ? P.bg : P.a;
      const sc = scroll.at(t) * rowH;
      g.save();
      g.beginPath();
      g.rect(0, top - 2, W, rowsVis * rowH + 4);
      g.clip();
      g.translate(0, -sc);
      for (const L of lines) {
        if (tq < L.t) break;
        const y = rowY(L.row);
        if (y - sc < top - rowH || y - sc > top + (rowsVis + 1) * rowH) continue;
        if (L.kind === 'cmd') {
          const n = L.charT.filter((c) => c <= tq).length;
          const vis = L.text.slice(0, L.promptLen + n);
          wrap(vis).forEach((seg, k) => {
            if (k === 0) {
              K.drawRun(g, run(seg.slice(0, L.promptLen)), x0, y, { fill: dim });
              K.drawRun(g, run(seg.slice(L.promptLen), fB), x0 + L.promptLen * cw, y, { fill: ink });
            } else K.drawRun(g, run(seg, fB), x0, y + k * rowH, { fill: ink });
          });
        } else if (L.kind === 'out') {
          if (L.hiT != null && t >= L.hiT) {
            const p = K.springStep(t - L.hiT, 5, 0.85);
            K.bar(g, x0 - cw * 0.5, y - rowH / 2 - capPx / 2, (Math.max(L.text.length, 1) + 1) * cw * p, rowH, acc);
            K.drawRun(g, run(L.text, fB), x0, y, { fill: inv ? P.ink : P.bg });
          } else K.drawRun(g, run(L.text), x0, y, { fill: L.dim ? dim : ink });
        } else if (L.kind === 'bar') {
          const labelW = Math.min(10, barLabelW);
          const lab = L.label.slice(0, labelW).padEnd(labelW, ' ');
          K.drawRun(g, run(lab), x0, y, { fill: dim });
          const cells = Math.max(8, cols - labelW - 8);
          let f = 0;
          L.fillT.forEach((ft, k) => { f += K.clamp(K.springStep(t - ft, 6, 0.8), 0, 1) / L.beats; });
          // a little creep between beats so the bar is alive, landing hard on the beat
          const creep = K.clamp((t - L.t) / (L.beats * beat.spb)) * 0.9;
          const frac = K.clamp(Math.max(f, Math.min(creep, f + 0.5 / L.beats)));
          const bx = x0 + (labelW + 1) * cw;
          K.drawRun(g, run('['), bx, y, { fill: ink });
          const filled = Math.round(frac * cells);
          for (let c = 0; c < cells; c++) {
            const cx = bx + (c + 1) * cw;
            if (c < filled) K.bar(g, cx + cw * 0.08, y - capPx * 1.05, cw * 0.84, capPx * 1.2, acc);
            else K.bar(g, cx + cw * 0.42, y - capPx * 0.5, cw * 0.16, cw * 0.16, dim);
          }
          K.drawRun(g, run(']'), bx + (cells + 1) * cw, y, { fill: ink });
          const pct = `${String(Math.round(frac * 100)).padStart(3, ' ')}%`;
          // right-aligned to the grid's last column: the bold face is wider than a cell
          const pr = run(pct, fB);
          K.drawRun(g, pr, x0 + cols * cw - pr.advance, y, { fill: frac >= 1 ? acc : ink });
        }
      }
      // caret
      const cs = caretState(tq);
      if (cs.pos && (cs.solid || K.caretOn(tq, beat.spb))) {
        const y = rowY(cs.pos.row);
        K.bar(g, x0 + cs.pos.col * cw, y - capPx * 1.12, cw, capPx * 1.38, acc);
      }
      g.restore();
    }

    function drawStatement(g, t) {
      // phase 1: letterforms are windows that invert the screen
      const pp = K.springStep(t - tPunch, 2.8, 0.62);
      const zs = 1 + (1 - pp) * 0.9;
      const m = new DOMMatrix().translate(W / 2, H / 2).scale(zs, zs).translate(-W / 2, -H / 2);
      if (t < tSolid) {
        drawTerminal(g, t);
        g.save();
        g.clip(K.transformPath(sPath, m), 'nonzero');
        g.fillStyle = P.ink;
        g.fillRect(0, 0, W, H);
        drawGrid(g, t, P.bg);
        drawTerminal(g, t, true);
        g.restore();
        return;
      }
      // phase 2: the terminal is gone; statement solid, accent block caret
      const out = K.clamp((t - tSolid) / (S16 * 2));
      if (out < 1) {
        g.save();
        g.globalAlpha = 1 - out;
        drawTerminal(g, t);
        g.restore();
      }
      sRuns.forEach((r, i) => K.drawRun(g, r, sX(r), sBases[i], { fill: P.ink }));
      if (caretFits && K.caretOn(q(t) - tSolid, beat.spb)) K.bar(g, caretX, sBases[sBases.length - 1] - lastRun.capPx, caretW, lastRun.capPx, P.a);
      if (subRun && t >= tSub) {
        const n = K.typed(C.sub, q(t), tSub, 40, seed);
        const r2 = K.shape(fM, C.sub.slice(0, n), { size: subRun.size, tracking: 10, kerning: 'none' });
        K.drawRun(g, r2, M, sBases[sBases.length - 1] + 60 * unit + subRun.capPx, { fill: P.dim });
      }
    }

    // keyframes
    const kfs = [[0, 'empty'], [B(0.5), 'header'], [lines[0].charT[Math.floor(lines[0].charT.length / 2)] ?? B(1), 'typing']];
    const bar = lines.find((l) => l.kind === 'bar');
    if (bar) kfs.push([bar.t + beat.spb * 1.4, 'progress bar']);
    const hi = lines.find((l) => l.hiT != null);
    if (hi) kfs.push([hi.hiT + 0.2, 'highlight']);
    kfs.push([tPunch - S16, 'terminal full'], [tPunch + 0.12, 'punch-through'], [tPunch + beat.spb * 0.6, 'inverted letterforms'], [tSolid + 0.2, 'statement solid'], [tSub + 1.2, 'sub typed'], [duration - 1 / fps, 'last frame']);
    kfs.forEach(([t, l]) => qa.keyframe(Math.max(0, Math.min(duration - 1 / fps, t)), l));
    qa.note(`grid ${cols}x${rowsVis}, ${size.toFixed(1)}px mono, ${lines.length} lines`);

    function post(g, t) {
      if (style === 'crt-phosphor') {
        // phosphor bloom: the screen glows into itself; then scanlines and glass vignette
        g.save();
        g.globalCompositeOperation = 'lighten';
        g.globalAlpha = 0.55;
        g.filter = `blur(${(7 * unit).toFixed(1)}px)`;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.drawImage(g.canvas, 0, 0);
        g.restore();
        g.save();
        g.fillStyle = '#000000';
        g.globalAlpha = 0.28;
        const sl = Math.max(2, Math.round(3 * unit));
        for (let y = 0; y < H; y += sl) g.fillRect(0, y, W, Math.max(1, Math.round(sl / 2.5)));
        g.globalAlpha = 1;
        const r = Math.hypot(W, H) / 2;
        const v = g.createRadialGradient(W / 2, H / 2, r * 0.45, W / 2, H / 2, r * 1.05);
        v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.78)');
        g.fillStyle = v; g.fillRect(0, 0, W, H);
        g.restore();
      } else if (style === 'paper-teletype') {
        K.grain(g, W, H, { seed: 5, frame: 0, amount: 0.13, mode: 'multiply' });
      }
    }

    return {
      post,
      duration,
      draw(g, t) {
        if (t >= tPunch) {
          if (t < tSolid) { drawGrid(g, t, '#1E1E1E'); drawHeader(g, t); }
          drawStatement(g, t);
          return;
        }
        drawGrid(g, t, '#1E1E1E');
        drawHeader(g, t);
        drawTerminal(g, t);
      },
    };
  },
};
