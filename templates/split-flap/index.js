// SPLIT-FLAP — a mechanical departures board (Solari).
// Every cell is two card halves on a hinge. A flip folds the top half of the
// current character down over the bottom (foreshortened, darkening as it
// turns edge-on), then the bottom half of the next character unfolds into
// place. Cells walk a fixed drum; rows ripple left→right and land on beats.
import * as K from '../../src/kit/index.js';

const DRUM = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:-/&!?\'#@+%';
const STYLES = ['terminal', 'arcade-led', 'museum'];
const STYLE_PALETTE = {
  terminal: {},
  'arcade-led': { bg: '#050505', housing: '#0B0B0B', card: '#1A1206', ink: '#FFB000', a: '#FF5A1F', b: '#FF2A55' },
  museum: { bg: '#E9E4D8', housing: '#D8D1C2', card: '#F6F2EA', ink: '#1C1B19', a: '#B3261E', b: '#1F4E8C' },
};
// timing feel per style: flap seconds, flip counts, ripple
const STYLE_TIMING = {
  terminal: {},
  'arcade-led': { flip: 0.04, flipsMin: 6, flipsMax: 16, ripple: 0.8 },
  museum: { flip: 0.09, flipsMin: 3, flipsMax: 7, ripple: 0.35 },
};

export default {
  id: 'split-flap',
  version: '1.1.0',
  name: 'Split-Flap Board',
  description:
    'Information board in three styles: terminal (Solari departures board, two-half flaps), arcade-led (glowing dot-matrix LED panel that scrambles into place), museum (warm light board, slow deliberate flaps). Rows ripple and land on beats, optional status column and a later update. Announcements, lists, stats, schedules.',
  tags: ['board', 'list', 'announcement', 'mechanical', 'stats', 'schedule'],
  formats: ['landscape', 'square', 'vertical', 'portrait'],
  bpm: 120,
  duration: 12,
  loop: false,
  palette: { bg: '#0B0B0C', housing: '#131314', card: '#1C1C1D', ink: '#F2F2F0', a: '#FFB000', b: '#FF4130' },
  paletteRoles: { bg: 'background', housing: 'board housing (neutral)', card: 'flap card (neutral)', ink: 'character', a: 'title + status accent', b: 'alert status accent' },
  fonts: {
    cell: { family: 'Oswald', weight: 600 },
    label: { family: 'IBM Plex Mono', weight: 500 },
  },
  params: {
    style: 'terminal',
    flip: 0.06, // seconds per flap
    flipsMin: 5,
    flipsMax: 13,
    ripple: 0.5, // column ripple, in flaps
    push: 1.03, // slow camera push over the whole piece
    rowBeats: 1, // beats between row landings
  },
  schema: {
    content: {
      type: 'object',
      additionalProperties: false,
      required: ['rows'],
      properties: {
        title: { type: 'string', maxLength: 20, description: 'Header row, flipped in the accent colour.' },
        columns: {
          type: 'object',
          additionalProperties: false,
          properties: { main: { type: 'string', maxLength: 20 }, status: { type: 'string', maxLength: 10 } },
          description: 'Small mono column labels above the board.',
        },
        rows: {
          type: 'array',
          minItems: 1,
          maxItems: 6,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['text'],
            properties: {
              text: { type: 'string', maxLength: 20 },
              status: { type: 'string', maxLength: 10 },
              statusColor: { enum: ['a', 'b', 'ink'] },
              color: { enum: ['ink', 'a', 'b'] },
              then: {
                type: 'object',
                additionalProperties: false,
                description: 'A later change on this row (flips again at content.updateAt).',
                properties: { text: { type: 'string', maxLength: 20 }, status: { type: 'string', maxLength: 10 }, statusColor: { enum: ['a', 'b', 'ink'] } },
              },
            },
          },
        },
        updateAt: { type: 'number', minimum: 0, description: 'Beat at which rows with `then` flip again (default: 3 beats after the board settles).' },
      },
    },
    params: {
      type: 'object',
      additionalProperties: false,
      properties: {
        style: { enum: STYLES, description: 'terminal (flap board) | arcade-led (dot-matrix LED) | museum (light, slow, elegant)' },
        flip: { type: 'number', minimum: 0.03, maximum: 0.2 },
        flipsMin: { type: 'integer', minimum: 1, maximum: 30 },
        flipsMax: { type: 'integer', minimum: 1, maximum: 40 },
        ripple: { type: 'number', minimum: 0, maximum: 3 },
        push: { type: 'number', minimum: 1, maximum: 1.2 },
        rowBeats: { type: 'number', minimum: 0.25, maximum: 8 },
      },
    },
  },
  notes: 'Characters outside A–Z 0–9 . , : - / & ! ? \' # @ + % render as blanks. Text is upper-cased. Duration is derived from the content unless the spec sets it.',
  example: {
    template: 'split-flap',
    format: 'landscape',
    fps: 60,
    bpm: 120,
    seed: 11,
    content: {
      title: 'DEPARTURES',
      columns: { main: 'DESTINATION', status: 'STATUS' },
      rows: [
        { text: '09:40 BERLIN', status: 'ON TIME' },
        { text: '09:55 LISBON', status: 'BOARDING', statusColor: 'a' },
        { text: '10:05 TOKYO', status: 'DELAYED', statusColor: 'b', then: { status: 'CANCELLED', statusColor: 'b' } },
        { text: '10:20 NEW YORK', status: 'ON TIME', then: { status: 'GATE 12', statusColor: 'a' } },
        { text: '10:35 SAO PAULO', status: 'ON TIME' },
      ],
    },
  },

  build(ctx) {
    const { W, H, fonts, beat, seed, qa, fps } = ctx;
    const style = STYLES.includes(ctx.params.style) ? ctx.params.style : 'terminal';
    const led = style === 'arcade-led', museum = style === 'museum';
    const userPal = ctx.spec.palette || {};
    for (const [k, v] of Object.entries(STYLE_PALETTE[style])) if (!(k in userPal)) ctx.palette[k] = v;
    const P = ctx.palette;
    // style timing unless the spec set those params explicitly
    const userParams = ctx.spec.params || {};
    const params = { ...ctx.params };
    for (const [k, v] of Object.entries(STYLE_TIMING[style])) if (!(k in userParams)) params[k] = v;
    // Optional fields (title, columns, updateAt) must not leak in from the
    // template example when the spec brings its own rows.
    const C = ctx.spec.content?.rows ? ctx.spec.content : ctx.content;
    const fCell = fonts.get('cell'), fLab = fonts.get('label');
    const unit = Math.min(W, H) / 1080;
    const M = Math.round(Math.min(W, H) * 0.074);
    const IW = W - 2 * M, IH = H - 2 * M;
    const cx = W / 2, cy = H / 2;
    const q = (t) => K.frameQuant(t, fps);
    const fd = params.flip;
    const vertical = ctx.aspect === 'vertical' || H > W * 1.15;

    const clean = (s) => [...String(s || '').toUpperCase()].map((c) => (DRUM.includes(c) ? c : ' ')).join('');
    const bad = [...(C.rows || [])].flatMap((r) => [...String(r.text + (r.status || '')).toUpperCase()]).filter((c) => !DRUM.includes(c));
    if (bad.length) qa.warn(`characters not on the drum render blank: ${[...new Set(bad)].join(' ')}`);

    const rows = C.rows.map((r) => ({ ...r, text: clean(r.text), status: r.status ? clean(r.status) : '', then: r.then ? { ...r.then, text: r.then.text != null ? clean(r.then.text) : null, status: r.then.status != null ? clean(r.then.status) : null } : null }));
    const hasStatus = rows.some((r) => r.status || r.then?.status);
    const textCols = Math.max(...rows.map((r) => Math.max(r.text.length, r.then?.text?.length ?? 0)), vertical ? 0 : clean(C.title).length);
    const statusCols = hasStatus ? Math.max(...rows.map((r) => Math.max(r.status.length, r.then?.status?.length ?? 0))) : 0;
    const title = C.title ? clean(C.title) : '';

    // ── geometry: cells fill the width, board centred; vertical stacks status under the row
    const stacked = vertical;
    const wrapWords = (text, n) => {
      const out = [];
      let cur = '';
      for (const w of text.trim().split(/ +/)) {
        if (!cur) cur = w;
        else if ((cur + ' ' + w).length <= n) cur += ' ' + w;
        else { out.push(cur); cur = w; }
      }
      if (cur) out.push(cur);
      return out.length ? out : [''];
    };
    const longestWord = Math.max(1, ...rows.flatMap((r) => r.text.trim().split(/ +/).map((w) => w.length)));
    const wrapCols = Math.max(longestWord, statusCols, Math.min(title.length, 10), 7);
    const cols = stacked ? Math.max(Math.min(textCols, wrapCols), statusCols, title.length) : Math.max(textCols + (hasStatus ? 1 + statusCols : 0), title.length);
    const gapR = 0.1, aspect = 1.42;
    const lines = []; // each line: {cells:[{target, color, then?}], kind}
    if (title) lines.push({ kind: 'title', chars: title.padEnd(cols, ' ').slice(0, cols), color: 'a' });
    rows.forEach((r, i) => {
      const mk = (text, status, sc, color) => {
        if (stacked) return null;
        let s = (text || '').padEnd(textCols, ' ').slice(0, textCols);
        if (hasStatus) s += ' ' + (status || '').padEnd(statusCols, ' ').slice(0, statusCols);
        return s.padEnd(cols, ' ');
      };
      const colorOf = (k, sc) => (k >= textCols + 1 && hasStatus && !stacked ? sc || 'ink' : r.color || 'ink');
      if (!stacked) {
        const now = mk(r.text, r.status);
        const later = r.then ? mk(r.then.text ?? r.text, r.then.status ?? r.status) : null;
        lines.push({ kind: 'row', row: i, chars: now, later, color: (k) => colorOf(k, r.statusColor), laterColor: (k) => colorOf(k, r.then?.statusColor ?? r.statusColor) });
      } else {
        // vertical: long rows wrap at spaces so cells can be bigger
        const parts = r.then?.text != null ? [r.text] : wrapWords(r.text, wrapCols);
        parts.forEach((part, pi) => lines.push({ kind: pi === 0 ? 'row' : 'rowcont', row: i, chars: part.padEnd(cols, ' '), later: pi === 0 && r.then?.text != null ? r.then.text.padEnd(cols, ' ') : null, color: () => r.color || 'ink', laterColor: () => r.color || 'ink' }));
        if (hasStatus) {
          const pad = (s) => (s || '').padStart(cols, ' ');
          lines.push({ kind: 'status', row: i, chars: pad(r.status), later: r.then?.status != null ? pad(r.then.status) : null, color: () => r.statusColor || 'ink', laterColor: () => r.then?.statusColor ?? r.statusColor ?? 'ink' });
        }
      }
    });
    const nL = lines.length;
    const labelH = C.columns ? 46 * unit : 0;
    const titleGap = title ? 0.55 : 0; // extra gap (in cell heights) under the title row
    const statusPairGap = stacked ? 0.12 : 0.22;
    let cellW = IW / (cols + gapR * (cols - 1));
    let cellH = cellW * aspect;
    const rowGapF = stacked ? 0.12 : 0.22;
    const boardHf = (ch) => {
      let h = labelH;
      lines.forEach((l, i) => {
        h += ch;
        if (i < nL - 1) h += ch * (l.kind === 'title' ? titleGap + rowGapF : (l.kind === 'row' || l.kind === 'rowcont') && stacked ? (lines[i + 1]?.row === l.row ? statusPairGap : 0.42) : stacked ? 0.42 : rowGapF);
      });
      return h;
    };
    if (boardHf(cellH) > IH) {
      const k = IH / boardHf(cellH);
      cellH *= k;
      cellW *= k;
    }
    const gapX = cellW * gapR;
    const boardW = cols * cellW + (cols - 1) * gapX;
    const boardH = boardHf(cellH);
    const bx = cx - boardW / 2;
    let y = K.snap(cy - boardH / 2 + labelH, 2);
    lines.forEach((l, i) => {
      l.y = y;
      y += cellH + (i < nL - 1 ? cellH * (l.kind === 'title' ? titleGap + rowGapF : (l.kind === 'row' || l.kind === 'rowcont') && stacked ? (lines[i + 1]?.row === l.row ? statusPairGap : 0.42) : stacked ? 0.42 : rowGapF) : 0);
    });
    const colX = (c) => bx + c * (cellW + gapX);
    const hinge = Math.max(1.5, cellH * 0.022);
    const radius = Math.max(2, cellW * 0.06);

    // glyph size: cap height ~ 60% of the cell, centred on the hinge
    const size = (cellH * 0.66 * fCell.upm) / fCell.capHeight;
    const glyphCache = new Map();
    const glyphRun = (ch) => {
      let r = glyphCache.get(ch);
      if (!r) { r = K.shape(fCell, ch, { size, kerning: 'none' }); glyphCache.set(ch, r); }
      return r;
    };
    // narrow cells: condense wide glyphs (M, W) so nothing touches the card edge
    const maxInk = cellW * 0.78;

    // ── schedule: each cell is a list of contiguous flaps {t0, from, to}
    const tTitle = beat.t(2);
    const firstRow = title ? 3 : 2;
    const rb = params.rowBeats;
    const rowLand = (i) => beat.t(firstRow + i * rb);
    const drumIdx = (c) => Math.max(0, DRUM.indexOf(c));
    const flapsFor = (key, target, settle, from) => {
      const nMin = params.flipsMin, nMax = Math.max(params.flipsMin, params.flipsMax);
      const n = target === ' ' && from === ' ' ? 0 : nMin + (K.hash(seed, key) % (nMax - nMin + 1));
      const ti = drumIdx(target);
      const seq = [from];
      for (let k = n - 1; k >= 0; k--) seq.push(DRUM[(((ti - k) % DRUM.length) + DRUM.length) % DRUM.length]);
      if (seq[seq.length - 1] !== target) seq.push(target);
      const nf = seq.length - 1;
      const t0 = settle - nf * fd;
      return seq.slice(1).map((to, k) => ({ t0: t0 + k * fd, from: seq[k], to }));
    };
    let settleAll = tTitle;
    const lastInk = (s) => { let k = s.length - 1; while (k > 0 && s[k] === ' ') k--; return k; };
    const cells = [];
    lines.forEach((l, li) => {
      const landing = l.kind === 'title' ? tTitle : rowLand(l.row) + (l.kind === 'status' ? beat.spb * 0.5 : l.kind === 'rowcont' ? beat.spb * 0.25 : 0);
      const li0 = lastInk(l.chars);
      l.cells = [...l.chars].map((ch, c) => {
        const settle = landing - Math.max(0, li0 - c) * fd * params.ripple;
        const color = typeof l.color === 'function' ? l.color(c) : l.color;
        const flaps = flapsFor(`${li}:${c}`, ch, settle, ' ').map((f) => ({ ...f, fromColor: color, toColor: color }));
        settleAll = Math.max(settleAll, settle);
        return { c, flaps, color, laterColor: l.laterColor ? l.laterColor(c) : null };
      });
      cells.push(...l.cells);
      if (l.kind === 'title') qa.hit(tTitle, 'title lands');
      else if (l.kind === 'row') qa.hit(landing, `row ${l.row + 1} lands`);
    });
    const updBeat = C.updateAt ?? Math.ceil(beat.b(settleAll)) + 3;
    const tUpd = beat.t(updBeat);
    let lastEvent = settleAll;
    let anyUpdate = false;
    lines.forEach((l, li) => {
      if (!l.later) return;
      const li0 = Math.max(lastInk(l.later), lastInk(l.chars));
      const landing = tUpd + (l.kind === 'status' ? beat.spb * 0.5 : 0) + (l.row - Math.min(...lines.filter((x) => x.later).map((x) => x.row))) * beat.spb;
      l.cells.forEach((cell, c) => {
        const from = l.chars[c], to = l.later[c];
        if (from === to && cell.laterColor === cell.color) return;
        const settle = landing - Math.max(0, li0 - c) * fd * params.ripple;
        // colour belongs to the CHARACTER: the old character keeps its colour,
        // drum characters passing by are neutral, only the landing one is recoloured
        const more = flapsFor(`u${li}:${c}`, to, settle, from).map((f, k, arr) => ({ ...f, later: true, fromColor: k === 0 ? cell.color : 'ink', toColor: k === arr.length - 1 ? cell.laterColor ?? cell.color : 'ink' }));
        cell.flaps.push(...more);
        lastEvent = Math.max(lastEvent, settle);
        anyUpdate = true;
      });
      qa.hit(landing, `row ${l.row + 1} update`);
    });
    const duration = ctx.spec.duration ?? Math.ceil(beat.b(lastEvent)) * beat.spb + beat.spb * 6;

    // QA: readable text
    lines.forEach((l, i) => {
      const ink = [...l.chars].some((c) => c !== ' ');
      if (!ink) return;
      qa.text(`${l.kind}-${l.row ?? 0}`, { box: { x0: bx, y0: l.y, x1: bx + boardW, y1: l.y + cellH }, size: cellH * 0.66, fg: l.kind === 'title' ? P.a : P.ink, bg: P.card });
    });
    const colLabels = C.columns ? [
      [C.columns.main || '', bx, 'l'],
      [!stacked && hasStatus ? C.columns.status || '' : '', colX(textCols + 1), 'l'],
    ] : [];
    if (C.columns) qa.text('column-labels', { box: { x0: bx, y0: lines[title ? 1 : 0].y - labelH, x1: bx + boardW, y1: lines[title ? 1 : 0].y }, size: 16 * unit * 0.7, fg: museum ? '#6B665C' : '#8C8C8C', bg: P.bg, decorative: true });

    const pushZ = new K.Track(1).ease(0, duration, params.push, K.sineInOut);
    const colOf = (tok) => P[tok] ?? P.ink;

    function drawHalf(g, x, yTop, ch, half, scaleY, shade, color) {
      const hy = yTop + cellH / 2;
      g.save();
      if (scaleY !== 1) {
        g.translate(0, hy);
        g.scale(1, Math.max(0.0001, scaleY));
        g.translate(0, -hy);
      }
      g.beginPath();
      if (half === 'top') g.rect(x - 1, yTop - 1, cellW + 2, cellH / 2 - hinge / 2 + 1);
      else g.rect(x - 1, hy + hinge / 2, cellW + 2, cellH / 2 - hinge / 2 + 1);
      g.clip();
      g.fillStyle = P.card;
      g.beginPath();
      g.roundRect(x, yTop, cellW, cellH, radius);
      g.fill();
      if (museum) {
        // printed-card edge: a hairline frame instead of a dark sheen
        g.strokeStyle = 'rgba(0,0,0,0.12)';
        g.lineWidth = 1;
        g.stroke();
      }
      if (ch !== ' ') {
        const run = glyphRun(ch);
        const s = Math.min(1, maxInk / Math.max(1, run.inkWidth));
        const gx = x + cellW / 2 - (run.inkLeft + run.inkWidth / 2);
        const gy = hy + run.capPx / 2;
        K.drawRun(g, run, gx, gy, { fill: color, each: () => (s < 1 ? { sx: s } : null) });
      }
      // card sheen: halves read as separate plates
      g.fillStyle = museum ? (half === 'top' ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.04)') : half === 'top' ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.10)';
      g.fillRect(x, yTop, cellW, cellH);
      if (shade > 0.001) {
        g.fillStyle = `rgba(0,0,0,${shade.toFixed(3)})`;
        g.fillRect(x, yTop, cellW, cellH);
      }
      g.restore();
    }

    function cellState(cell, tq) {
      let cur = ' ', curColor = cell.color, active = null;
      for (const f of cell.flaps) {
        if (tq >= f.t0 + fd) { cur = f.to; curColor = f.toColor; }
        else if (tq >= f.t0) { active = f; break; }
        else break;
      }
      return { cur, curColor, active };
    }

    // ── arcade-led: characters as a 7×11 dot matrix sampled from the real glyph
    const DX = 7, DY = 11;
    const dotCache = new Map();
    const dotsFor = (ch) => {
      let d = dotCache.get(ch);
      if (d) return d;
      d = new Uint8Array(DX * DY);
      if (ch !== ' ') {
        const S = 8; // supersample per dot
        const c = new OffscreenCanvas(DX * S, DY * S);
        const cg = c.getContext('2d', { willReadFrequently: true });
        const run = K.shape(fCell, ch, { size: 100, kerning: 'none' });
        const k = Math.min((DY * S * 0.86) / run.capPx, (DX * S * 0.92) / Math.max(1, run.inkWidth));
        cg.translate((DX * S) / 2, (DY * S) / 2 + (run.capPx * k) / 2);
        cg.scale(k, k);
        K.drawRun(cg, run, -(run.inkLeft + run.inkWidth / 2), 0, { fill: '#fff' });
        const px = cg.getImageData(0, 0, DX * S, DY * S).data;
        for (let yy = 0; yy < DY; yy++) for (let xx = 0; xx < DX; xx++) {
          let sum = 0;
          for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) sum += px[((yy * S + sy) * DX * S + (xx * S + sx)) * 4 + 3];
          d[yy * DX + xx] = sum / (S * S * 255) > 0.42 ? 1 : 0;
        }
      }
      dotCache.set(ch, d);
      return d;
    };
    const offPath = new Map();
    function drawLedLine(g, l, t) {
      // one Path2D per colour so the glow is ONE shadow pass per line, not per dot
      const byColor = new Map();
      const off = new Path2D();
      const pitchX = cellW / DX, pitchY = cellH / DY, r = Math.min(pitchX, pitchY) * 0.36;
      for (const cell of l.cells) {
        const x = colX(cell.c);
        const { cur, curColor, active } = cellState(cell, t);
        // LED refresh: a changing cell shows the incoming character immediately
        const ch = active ? active.to : cur;
        const col = active ? active.toColor : curColor;
        const d = dotsFor(ch);
        for (let yy = 0; yy < DY; yy++) for (let xx = 0; xx < DX; xx++) {
          const px = x + (xx + 0.5) * pitchX, py = l.y + (yy + 0.5) * pitchY;
          const lit = d[yy * DX + xx];
          const P2 = lit ? byColor.get(col) ?? byColor.set(col, new Path2D()).get(col) : off;
          P2.moveTo(px + r, py);
          P2.arc(px, py, r, 0, Math.PI * 2);
        }
      }
      g.fillStyle = P.card;
      g.fill(off);
      for (const [col, path] of byColor) {
        g.save();
        g.shadowColor = colOf(col);
        g.shadowBlur = r * 3.2;
        g.fillStyle = colOf(col);
        g.fill(path);
        g.restore();
      }
    }

    function drawCell(g, x, yTop, cell, t) {
      const tq = t; // flaps are continuous motion; blur sub-samples should differ
      const { cur, curColor, active } = cellState(cell, tq);
      if (!active) {
        drawHalf(g, x, yTop, cur, 'top', 1, 0, colOf(curColor));
        drawHalf(g, x, yTop, cur, 'bot', 1, 0, colOf(curColor));
        return;
      }
      // gravity: the flap accelerates as it falls
      const u = K.clamp((tq - active.t0) / fd);
      const p = u * u * (1.35 - 0.35 * u);
      const cFrom = colOf(active.fromColor), cTo = colOf(active.toColor);
      // behind: next char's top is revealed; old char's bottom stays until covered
      drawHalf(g, x, yTop, active.to, 'top', 1, 0.25 * (1 - p), cTo);
      drawHalf(g, x, yTop, active.from, 'bot', 1, 0.3 * p, cFrom);
      if (p < 0.5) {
        const a = p * Math.PI; // 0 → π/2
        drawHalf(g, x, yTop, active.from, 'top', Math.cos(a), 0.55 * Math.sin(a), cFrom);
      } else {
        const a = (1 - p) * Math.PI; // π/2 → 0
        drawHalf(g, x, yTop, active.to, 'bot', Math.cos(a), 0.45 * Math.sin(a), cTo);
      }
    }

    function drawLabels(g, t) {
      if (!C.columns) return;
      const a = K.clamp((t - beat.t(0.5)) / 0.25);
      if (a <= 0) return;
      const yL = lines[title ? 1 : 0].y - 16 * unit;
      for (const [s, x] of colLabels) {
        if (!s) continue;
        const run = K.shape(fLab, s.toUpperCase(), { size: 16 * unit, tracking: 60, kerning: 'metric' });
        K.drawRun(g, run, x, yL, { fill: museum ? '#6B665C' : '#8C8C8C', alpha: a });
      }
      // hairline under the title row
      if (title) K.bar(g, bx, lines[0].y + cellH + cellH * titleGap * 0.5, boardW * K.expoOut(K.clamp((t - beat.t(1)) / 0.6)), Math.max(1, 2 * unit), museum ? '#B9B1A1' : '#3A3A3A');
    }

    // keyframes
    const kf = [
      [0, 'blank board'],
      [tTitle - fd * 4, 'title flipping'],
      [tTitle + 0.05, 'title landed'],
      [rowLand(0) - fd * 3, 'row 1 ripple'],
      [rowLand(Math.floor((rows.length - 1) / 2)) - fd * 2, 'mid rows'],
      [settleAll + 0.1, 'board settled'],
    ];
    if (anyUpdate) kf.push([tUpd - fd * 3, 'update flipping'], [lastEvent + 0.1, 'update landed']);
    kf.push([duration - 1 / fps, 'last frame']);
    kf.forEach(([t, l]) => qa.keyframe(Math.max(0, Math.min(duration - 1 / fps, t)), l));
    qa.note(`board ${cols} cols × ${nL} lines, cell ${cellW.toFixed(1)}×${cellH.toFixed(1)}px`);

    return {
      duration,
      draw(g, t) {
        g.save();
        const z = pushZ.at(t);
        g.translate(cx, cy);
        g.scale(z, z);
        g.translate(-cx, -cy);
        // housing: the board is an object, not cells floating in space
        const hp = cellW * 0.45;
        g.fillStyle = P.housing ?? '#121213';
        g.beginPath();
        g.roundRect(bx - hp, lines[0].y - hp - (title ? 0 : labelH), boardW + hp * 2, boardH + hp * 2 - (title ? labelH : 0) + (title ? 0 : 0), radius * 2);
        g.fill();
        drawLabels(g, t);
        if (led) for (const l of lines) drawLedLine(g, l, t);
        else for (const l of lines) for (const cell of l.cells) drawCell(g, colX(cell.c), l.y, cell, t);
        g.restore();
      },
    };
  },
};
