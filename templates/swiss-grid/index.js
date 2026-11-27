// SWISS GRID — International Typographic Style chapter opener / explainer card.
// Light ground, one signal colour, a strict 12-column grid whose guides flash
// on the beat, a slot-machine numeral, flush-left ragged type revealed through
// line masks, and numbered point modules that slide on grid rails.
// Authored in beats (16 beats = 9.6s at 100 BPM); build-in, hold, build-out.
import * as K from '../../src/kit/index.js';

const BEATS = 16;
const STYLES = ['classic', 'brutal-grid', 'motion-poster'];
// palette defaults per style (only for tokens the spec does not set)
const STYLE_PALETTE = {
  classic: {},
  'brutal-grid': { bg: '#0E0E0E', ink: '#F2F0EB', signal: '#FF2A1A', muted: '#A3A19C' },
  'motion-poster': { bg: '#ECE9E1', ink: '#111111', signal: '#1F3BFF', muted: '#55534F' },
};
// spring feel of every line/module reveal per style
const FEEL = {
  classic: { f: 2.6, z: 0.86 },
  'brutal-grid': { f: 5.2, z: 1 },
  'motion-poster': { f: 3.1, z: 0.58 },
};

export default {
  id: 'swiss-grid',
  version: '1.1.0',
  name: 'Swiss Grid',
  description:
    'International Typographic Style chapter opener in three styles: classic (rolling red numeral, line-mask title, point modules on a flashing 12-column grid), brutal-grid (dark, thick rules, signal block numeral, slabs that drop), motion-poster (giant alternating-colour title, outline numeral that fills, overshooting reveals, slow push). Landscape-first.',
  tags: ['youtube', 'chapter', 'explainer', 'swiss', 'grid', 'light', 'editorial'],
  formats: ['landscape', 'square', 'vertical', 'portrait'],
  bpm: 100,
  duration: 9.6,
  loop: false,
  palette: { bg: '#F2F0EB', ink: '#111111', signal: '#E30613', muted: '#6E6C68' },
  paletteRoles: { bg: 'paper ground', ink: 'type and hairlines', signal: 'the one signal colour (numeral, markers)', muted: 'secondary text (must stay ≥4.5:1 on bg)' },
  fonts: {
    display: { family: 'Inter Tight', weight: 800 },
    text: { family: 'Inter Tight', weight: 500 },
  },
  params: {
    style: 'classic',
    guides: true,
    outro: true,
    tracking: { display: -35, text: -10, label: 60 },
  },
  schema: {
    content: {
      type: 'object',
      additionalProperties: false,
      required: ['title'],
      properties: {
        number: { type: 'string', maxLength: 3, description: 'Chapter numeral, e.g. "03". Digits roll like a counter; other characters mask in.' },
        kicker: { type: 'string', maxLength: 32, description: 'Small label above the grid, e.g. "CHAPTER THREE".' },
        title: { type: 'string', maxLength: 60, description: '1–6 words, set flush-left ragged, balanced into ≤3 lines.' },
        subtitle: { type: 'string', maxLength: 110, description: 'One sentence under the title.' },
        points: { type: 'array', maxItems: 4, items: { type: 'string', maxLength: 70 }, description: 'Up to 4 short points, one numbered module each.' },
        footer: { type: 'string', maxLength: 48, description: 'Small footer label (source, series, URL).' },
      },
    },
    params: {
      type: 'object',
      additionalProperties: false,
      properties: {
        style: { enum: STYLES, description: 'classic | brutal-grid (dark, thick, blocky, hard cuts) | motion-poster (huge alternating title, outline numeral fill, overshoot)' },
        guides: { type: 'boolean', description: 'Flash the 12 column guides on each beat' },
        outro: { type: 'boolean', description: 'Build out to a clean ground at the end' },
        tracking: { type: 'object', properties: { display: { type: 'number' }, text: { type: 'number' }, label: { type: 'number' } }, additionalProperties: false },
      },
    },
  },
  example: {
    template: 'swiss-grid',
    format: 'landscape',
    fps: 60,
    duration: 9.6,
    bpm: 100,
    seed: 3,
    content: {
      number: '03',
      kicker: 'CHAPTER THREE',
      title: 'Why workflows beat prompts',
      subtitle: 'The same model, the same budget — a repeatable pipeline wins every time.',
      points: ['Lock the reference frame first', 'Write the shot as JSON', 'Zero keyframes, one pass', 'Upscale last, never first'],
      footer: 'AI VIDEO FIELD GUIDE — EP. 12',
    },
  },
  notes: 'Landscape is the reference layout (numeral left, text right, points in one row). Square and vertical stack numeral → title → points (2×2 / list). Keep the title to ≤6 words and points ≤ ~40 characters for the cleanest rag.',

  build(ctx) {
    const { W, H, params, content: C, fonts, beat, qa, fps } = ctx;
    const style = STYLES.includes(params.style) ? params.style : 'classic';
    const brutal = style === 'brutal-grid', poster = style === 'motion-poster';
    const userPal = ctx.spec.palette || {};
    for (const [k, v] of Object.entries(STYLE_PALETTE[style])) if (!(k in userPal)) ctx.palette[k] = v;
    const P = ctx.palette;
    const feel = FEEL[style];
    const tr = brutal ? { ...params.tracking, display: -15 } : params.tracking;
    const titleText = brutal ? C.title.toUpperCase() : C.title;
    const fD = fonts.get('display'), fT = fonts.get('text');
    const unit = Math.min(W, H) / 1080;
    const land = ctx.aspect === 'landscape', vert = ctx.aspect === 'vertical';
    const totalBeats = Math.round((ctx.duration * beat.bpm) / 60);
    const bs = totalBeats / BEATS;
    const B = (n) => beat.t(n * bs);
    const S16 = (beat.spb * bs) / 4;
    const D = ctx.duration;
    const grid = new K.Grid({ width: W, height: H, cols: 12, margin: Math.round((land ? 88 : 72) * unit), gutter: Math.round(16 * unit), baseline: 8 });
    const M = grid.margin;
    const hair = Math.max(1, Math.round((brutal ? 5 : 2) * unit));
    const disp = (s, size, o = {}) => K.shape(fD, s, { size, tracking: tr.display, ...o });
    const text = (s, size, o = {}) => K.shape(fT, s, { size, tracking: tr.text, ...o });
    const label = (s, size = 24 * unit) => K.shape(fT, s.toUpperCase(), { size, tracking: tr.label, kerning: 'metric' });
    const sizeForCap = (face, cap) => (cap * face.upm) / face.capHeight;
    const hit = (t, l) => qa.hit(t, l);

    // ───────── zones ─────────
    const topRuleY = M + Math.round(44 * unit);
    const botRuleY = H - M - Math.round(44 * unit);
    const side = !vert; // landscape & square: numeral beside the text column
    let numSpan, txtCol, txtSpan;
    if (land) { numSpan = 4; txtCol = 5; txtSpan = 7; }
    else if (side) { numSpan = 4; txtCol = 4; txtSpan = 8; }
    else { numSpan = 7; txtCol = 0; txtSpan = 12; }
    const txtX = grid.x(txtCol), txtW = grid.spanW(txtSpan);
    const numX = grid.x(0), numW = grid.spanW(numSpan);

    // kicker + footer labels
    const kick = C.kicker ? label(C.kicker) : null;
    const foot = C.footer ? label(C.footer, 22 * unit) : null;
    const kickY = topRuleY - Math.round(16 * unit);
    const footY = botRuleY + Math.round(16 * unit) + (foot ? foot.capPx : 0);
    const bodyTop = topRuleY + Math.round((land ? 64 : 56) * unit);

    // ───────── point modules (laid out first: they anchor to the bottom rule) ─────────
    const pts = (C.points || []).slice(0, 4);
    const nP = pts.length;
    const pCap = (land ? 30 : side ? 26 : 30) * unit;
    const pSize = sizeForCap(fT, pCap);
    const pLead = Math.round(pCap * 1.62);
    const cols = land ? nP : side ? Math.min(2, nP) : 1;
    const pX0 = land ? txtX : grid.x(0), pW = land ? txtW : grid.spanW(12);
    const rows = nP ? Math.ceil(nP / cols) : 0;
    const modW = nP ? (pW - grid.gutter * (cols - 1)) / cols : 0;
    const numLbl = (i) => label(String(i + 1).padStart(2, '0'), 23 * unit);
    const modules = pts.map((p, i) => {
      const lines = K.balanceLines(fT, p, modW - 8 * unit, { size: pSize, tracking: tr.text });
      return { lines, runs: lines.map((l) => text(l, pSize)), col: i % cols, row: Math.floor(i / cols) };
    });
    const maxLines = Math.max(1, ...modules.map((m) => m.runs.length));
    const modH = Math.round(20 * unit + 30 * unit + pCap + (maxLines - 1) * pLead + (side && !land ? 26 : 36) * unit);
    const modGapY = Math.round((side && !land ? 18 : 28) * unit);
    const pBottom = botRuleY - Math.round((side && !land ? 28 : 48) * unit);
    const pTop = nP ? pBottom - rows * modH - (rows - 1) * modGapY : botRuleY;
    modules.forEach((m) => {
      m.x = pX0 + m.col * (modW + grid.gutter);
      m.y = pTop + m.row * (modH + modGapY);
    });

    // subtitle
    const sCap = (land ? 30 : side ? 27 : 30) * unit;
    const sSize = sizeForCap(fT, sCap);
    const sW = land ? grid.spanW(6) : side ? txtW : txtW * 0.86;
    const sLines = C.subtitle ? K.balanceLines(fT, C.subtitle, sW, { size: sSize, tracking: tr.text }) : [];
    const sRuns = sLines.map((l) => text(l, sSize));
    const sLead = Math.round(sCap * 1.72);

    // numeral
    const numStr = C.number || '';
    const numCapMax = land ? H * 0.40 : vert ? H * 0.17 : H * 0.2;
    const numFitW = numW - (side && !land ? grid.colW * 0.7 : 0); // keep air between numeral and the rule
    const numSize = numStr ? Math.min(K.fitSize(fD, numStr, numFitW, { tracking: -30 }), sizeForCap(fD, numCapMax)) : 0;
    const numRun = numStr ? disp(numStr, numSize, { tracking: -30 }) : null;

    // ───────── title: best split × size (no single short word stranded on a line) ─────────
    // For 1..3 lines, every split of the words is scored by the cap height it
    // allows at txtW; lines made of one ≤3-letter word are penalised (the
    // "Why / workflows / beat prompts" problem).
    const pickTitle = (capMax) => {
      const words = titleText.split(/\s+/).filter(Boolean);
      const probe = (line) => disp(line, 1000).inkWidth / 1000; // width per px of size
      let best = null;
      const consider = (lines) => {
        const sizeByW = txtW / Math.max(...lines.map(probe));
        const cap = Math.min(capMax, (sizeByW * fD.capHeight) / fD.upm);
        const stranded = lines.some((l) => !/\s/.test(l) && l.replace(/[^A-Za-z0-9]/g, '').length <= 3) && lines.length > 1;
        const score = cap * (stranded ? 0.6 : 1) * (1 - 0.06 * (lines.length - 1));
        if (!best || score > best.score) best = { lines, cap, score };
      };
      for (let n = 1; n <= Math.min(3, words.length); n++) {
        const rec = (start, left, acc) => {
          if (left === 1) return consider([...acc, words.slice(start).join(' ')]);
          for (let e = start + 1; e <= words.length - (left - 1); e++) rec(e, left - 1, [...acc, words.slice(start, e).join(' ')]);
        };
        if (words.length <= 12) rec(0, n, []);
      }
      return best;
    };
    const designCap = (land ? 92 : vert ? 150 : 80) * unit * (poster ? 1.55 : brutal ? 1.15 : 1);
    const picked = pickTitle(designCap);
    let tCap = picked.cap;
    let tLines, tRuns, tLead, numBase, tBases, sBases;
    for (let iter = 0; ; iter++) {
      const tSize = sizeForCap(fD, tCap);
      tLines = picked.lines.map((l) => l);
      if (Math.max(...picked.lines.map((l) => disp(l, tSize).inkWidth)) > txtW) tLines = K.balanceLines(fD, titleText, txtW, { size: tSize, tracking: tr.display });
      tRuns = tLines.map((l) => disp(l, tSize));
      // leading from real ink: descenders of one line never touch ascenders of the next
      tLead = Math.round(Math.max(tCap * 1.16, Math.max(0, ...tRuns.map((r) => r.inkBottom)) + Math.max(...tRuns.map((r) => -r.inkTop)) + tCap * 0.12));
      let tBase0;
      if (side) {
        tBase0 = grid.base(bodyTop + tCap);
        numBase = numRun ? tBase0 - tCap + numRun.capPx : 0; // numeral cap-top aligns to title cap-top
      } else {
        numBase = numRun ? grid.base(bodyTop + numRun.capPx) : bodyTop;
        tBase0 = grid.base((numRun ? numBase : bodyTop) + Math.round(72 * unit) + tCap);
      }
      tBases = tRuns.map((_, i) => tBase0 + i * tLead);
      const sBase0 = grid.base(tBases[tBases.length - 1] + Math.round(sCap + 44 * unit));
      sBases = sRuns.map((_, i) => sBase0 + i * sLead);
      const textBottom = sRuns.length ? sBases[sBases.length - 1] + sRuns[sRuns.length - 1].descPx : tBases[tBases.length - 1] + tRuns[tRuns.length - 1].inkBottom;
      const widest = Math.max(...tRuns.map((r) => r.inkWidth));
      const bandBottom = side && !land && numRun ? Math.max(textBottom, numBase + 8 * unit) : textBottom;
      const fits = tLines.length <= 3 && widest <= txtW && bandBottom <= pTop - 36 * unit;
      if (fits || tCap < 28 * unit || iter > 40) {
        if (!fits) qa.warn('swiss-grid: title/subtitle could not clear the point modules; shorten copy');
        break;
      }
      tCap *= 0.95;
    }

    // ───────── timeline ─────────
    const T = {
      rules: B(0), kicker: B(0.5), vrule: B(1), numeral: B(1),
      title: tRuns.map((_, i) => B(2 + i * (brutal ? 0.25 : 0.5))),
      sub: B(2 + tRuns.length * 0.5 + 0.5),
      pts: modules.map((_, i) => B(5 + i)),
      footer: B(5 + Math.max(nP, 1)),
      out: B(12), end: B(BEATS),
    };
    const out = params.outro;
    const tOut = (k) => (out ? T.out + k * S16 : Infinity);
    hit(T.rules, 'rules draw');
    hit(T.vrule, 'numeral roll');
    T.title.forEach((t) => hit(t, 'title line'));
    if (sRuns.length) hit(T.sub, 'subtitle');
    T.pts.forEach((t) => hit(t, 'point module'));
    if (foot) hit(T.footer, 'footer');
    if (out) { hit(T.out, 'build-out'); hit(B(13), 'text out'); hit(B(14), 'numeral out'); hit(B(15), 'rules retract'); }

    // QA registration
    const reg = (lbl, run, x, y, size, fg, extra = {}) => qa.text(lbl, { box: K.runBox(run, x, y), size, fg, bg: P.bg, ...extra });
    if (kick) reg('kicker', kick, M, kickY, kick.capPx, P.ink);
    if (foot) reg('footer', foot, M, footY, foot.capPx, P.muted);
    if (numRun) {
      if (brutal) qa.text('numeral', { box: K.runBox(numRun, numX - numRun.inkLeft, numBase), size: numRun.capPx, fg: P.bg, bg: P.signal });
      else reg('numeral', numRun, numX - numRun.inkLeft, numBase, numRun.capPx, P.signal);
    }
    const titleFill = (i) => (poster && i % 2 === 1 ? P.signal : P.ink);
    tRuns.forEach((r, i) => reg('title-' + i, r, txtX - r.inkLeft, tBases[i], r.capPx, titleFill(i), i === 0 ? { lines: tLines } : {}));
    sRuns.forEach((r, i) => reg('subtitle-' + i, r, txtX - r.inkLeft, sBases[i], r.capPx * 1.4, P.muted, i === 0 ? { lines: sLines } : {}));
    modules.forEach((m, i) => m.runs.forEach((r, j) => reg(`point-${i}-${j}`, r, m.x - r.inkLeft, m.y + 50 * unit + pCap + j * pLead, r.capPx * 1.4, P.ink, j === 0 ? { lines: m.lines, orphanOk: m.lines.join(' ').split(' ').length < 6 } : {})));

    // ───────── primitives ─────────
    const ruleTrack = (tin, tout) => ({ grow: new K.Track(0).spring(tin, 1, { f: 1.7, z: 1 }), shrink: new K.Track(0).spring(tout, 1, { f: 2.2, z: 1 }) });
    const hRule = (g, t, rt, x0, x1, y, w = hair, col = P.ink) => {
      const a = K.clamp(rt.grow.at(t)), b = K.clamp(rt.shrink.at(t));
      if (a <= b) return;
      K.bar(g, x0 + (x1 - x0) * b, y - w / 2, (x1 - x0) * (a - b), w, col);
    };
    const vRule = (g, t, rt, x, y0, y1, w = hair, col = P.ink) => {
      const a = K.clamp(rt.grow.at(t)), b = K.clamp(rt.shrink.at(t));
      if (a <= b) return;
      K.bar(g, x - w / 2, y0 + (y1 - y0) * b, w, (y1 - y0) * (a - b), col);
    };
    // text through a line mask: rises into its line box, exits upward
    const maskLine = (g, t, run, x, y, tin, tout, fill, o = {}) => {
      const h = run.ascPx + run.descPx;
      const dy = new K.Track(h * 1.05).spring(tin, 0, feel).spring(tout, -h * 1.1, { f: 2.4, z: 1 }).at(t);
      if (t < tin || dy <= -h * 1.09) return;
      g.save();
      g.beginPath();
      g.rect(x + run.inkLeft - 40 * unit, y - run.ascPx, run.inkWidth + 80 * unit, h + 2);
      g.clip();
      K.drawRun(g, run, x, y + dy, { fill, ...o });
      g.restore();
    };

    const rTop = ruleTrack(T.rules, tOut(12));
    const rBot = ruleTrack(T.rules + S16, tOut(12));
    const rV = ruleTrack(T.vrule, tOut(10));
    const modRules = modules.map((_, i) => ruleTrack(T.pts[i], tOut(i)));

    // numeral: each digit column rolls a full revolution plus its value, staggered
    const digits = numRun ? numRun.items.map((it) => ({ it, d: /\d/.test(it.ch) ? Number(it.ch) : null })) : [];
    const digitRuns = Array.from({ length: 10 }, (_, d) => disp(String(d), numSize, { tracking: 0 }));
    const rollers = digits.map((dg, i) => new K.Track(0).spring(T.numeral + i * S16 * 1.5, dg.d == null ? 1 : 10 + dg.d, { f: 0.9, z: 0.93 }));
    const numOut = new K.Track(0).spring(tOut(8), 1, { f: 2, z: 1 });

    // brutal: a signal slab fills the numeral column and the numeral is knocked out of it
    // the knocked-out numeral fits INSIDE the slab's padding
    const slabNum = numRun ? disp(numStr, Math.min(numSize, K.fitSize(fD, numStr, numW - 44 * unit, { tracking: -30 })), { tracking: -30 }) : null;
    const slabIn = new K.Track(0).spring(T.numeral, 1, { f: 3.4, z: 1 }).spring(tOut(8), 0, { f: 3, z: 1 });
    const slabTop = topRuleY + hair, slabBot = land ? botRuleY - hair : (numRun ? numBase + Math.round(28 * unit) : topRuleY);
    // motion-poster: the numeral is an outline that fills from the bottom on the beat
    const fillUp = new K.Track(0).spring(B(3), 1, { f: 1.3, z: 1 });
    function drawNumeralStyled(g, t) {
      if (!numRun || t < T.numeral) return;
      const x = numX - numRun.inkLeft, y = numBase, h = numRun.capPx;
      if (brutal) {
        const p = K.clamp(slabIn.at(t));
        if (p <= 0) return;
        const sh = (slabBot - slabTop) * p;
        K.bar(g, numX, slabTop, numW, sh, P.signal);
        g.save();
        g.beginPath(); g.rect(numX, slabTop, numW, sh); g.clip();
        const pad = Math.round(22 * unit);
        const nb = land ? slabBot - pad : y;
        K.drawRun(g, slabNum, numX + pad - slabNum.inkLeft, nb, { fill: P.bg });
        g.restore();
        return;
      }
      // poster
      const exit = numOut.at(t) * h * 1.25;
      const appear = K.springStep(t - T.numeral, 2.2, 0.62);
      g.save();
      g.translate(0, -exit);
      const s0 = 0.8 + 0.2 * appear;
      const cxN = x + (numRun.inkLeft + numRun.inkRight) / 2, cyN = y - h / 2;
      g.translate(cxN, cyN); g.scale(s0, s0); g.translate(-cxN, -cyN);
      K.drawRun(g, numRun, x, y, { fill: P.signal, stroke: P.signal, strokeWidth: 3 * unit, alpha: K.clamp(appear * 2) });
      const f = K.clamp(fillUp.at(t));
      if (f > 0) {
        g.save();
        g.beginPath(); g.rect(x + numRun.inkLeft - 10, y - (h + 30 * unit) * f, numRun.inkWidth + 20, (h + 30 * unit) * f + 14 * unit); g.clip();
        K.drawRun(g, numRun, x, y, { fill: P.signal });
        g.restore();
      }
      g.restore();
    }

    function drawNumeral(g, t) {
      if (brutal || poster) return drawNumeralStyled(g, t);
      if (!numRun || t < T.numeral) return;
      const x = numX - numRun.inkLeft, y = numBase;
      const h = numRun.capPx;
      const exit = numOut.at(t) * h * 1.25;
      g.save();
      g.beginPath();
      g.rect(numX - 20 * unit, y - h - 12 * unit, numW + 40 * unit, h + 24 * unit);
      g.clip();
      digits.forEach((dg, i) => {
        const it = dg.it;
        const cxSlot = x + (it.ink.x0 + it.ink.x1) / 2;
        if (dg.d == null) {
          const p = K.clamp(rollers[i].at(t));
          K.drawRun(g, numRun, x, y + (1 - p) * h * 1.2 - exit, { fill: P.signal, each: (jt) => (jt === it ? {} : { hidden: true }) });
          return;
        }
        const v = rollers[i].at(t);
        const lo = Math.floor(v), f = v - lo;
        for (const [dv, off] of [[lo, f], [lo + 1, f - 1]]) {
          const r = digitRuns[K.mod(dv, 10)];
          const gx = cxSlot - (r.inkLeft + r.inkRight) / 2;
          K.drawRun(g, r, gx, y + off * h * 1.2 - exit, { fill: P.signal });
        }
      });
      g.restore();
    }

    function drawGuides(g, t) {
      if (!params.guides) return;
      const p = beat.pulse(t, 1, 7) * (t < T.out ? 1 : 0.5);
      if (p < 0.02 || t < T.rules) return;
      g.save();
      g.globalAlpha = 0.07 * p;
      for (let c = 0; c <= 12; c++) {
        const x = c === 12 ? grid.right : grid.x(c);
        K.bar(g, x - hair / 4, topRuleY, Math.max(1, hair / 2), botRuleY - topRuleY, P.ink);
        if (c < 12 && c > 0) K.bar(g, x - grid.gutter - hair / 4, topRuleY, Math.max(1, hair / 2), botRuleY - topRuleY, P.ink);
      }
      g.restore();
    }

    function drawModule(g, t, m, i) {
      const tin = T.pts[i], to = tOut(i);
      hRule(g, t, modRules[i], m.x, m.x + modW, m.y, hair * 1.5);
      if (t < tin) return;
      // slide in along the grid rail (from one column to the left), clipped to the module
      const dx = brutal ? 0 : new K.Track(poster ? modW * 0.6 : -modW * 0.35).spring(tin, 0, poster ? { f: 3, z: 0.55 } : { f: 2.4, z: 0.9 }).spring(to, modW * 1.1, { f: 1.8, z: 1 }).at(t);
      const dyB = brutal ? new K.Track(-modH).spring(tin, 0, { f: 5, z: 1 }).spring(to, modH * 1.1, { f: 3, z: 1 }).at(t) : 0;
      const a = K.clamp(new K.Track(0).spring(tin, 1, { f: 4, z: 1 }).spring(to, 0, { f: 4, z: 1 }).at(t));
      g.save();
      g.beginPath();
      g.rect(m.x, m.y + hair, modW, modH);
      g.clip();
      if (brutal) {
        // slab: a solid module that drops in, signal cap bar
        g.translate(0, dyB);
        K.bar(g, m.x, m.y + hair, modW, modH - hair, '#1C1C1C');
        K.bar(g, m.x, m.y + hair, modW, Math.round(6 * unit), P.signal);
      }
      g.globalAlpha = a;
      const sq = Math.round(12 * unit);
      K.bar(g, m.x + dx, m.y + 22 * unit, sq, sq, P.signal);
      const nl = numLbl(i);
      K.drawRun(g, nl, m.x + dx + sq + 12 * unit, m.y + 22 * unit + sq, { fill: P.ink, alpha: a });
      const inset = brutal ? Math.round(16 * unit) : 0;
      m.runs.forEach((r, j) => K.drawRun(g, r, m.x + dx + inset - r.inkLeft, m.y + 50 * unit + pCap + j * pLead, { fill: P.ink, alpha: a }));
      g.restore();
    }

    // keyframes
    [
      [0, 'empty ground'], [B(0.6), 'rules drawing'], [B(1.6), 'numeral rolling'], [B(2.7), 'title reveal'],
      [B(4.3), 'subtitle'], [B(5.5), 'first module'], [B(8.6), 'all modules'], [B(10.5), 'hold'],
      [B(12.6), 'build-out'], [B(14.4), 'numeral out'], [D - 1 / fps, 'last frame'],
    ].forEach(([t, l]) => qa.keyframe(t, l));

    // landscape: a points index fills the numeral column's lower half —
    // one segment per module, lighting up as each module lands
    const idxTracks = modules.map((_, i) => new K.Track(0).spring(T.pts[i], 1, { f: 2.4, z: 1 }).spring(tOut(i), 0, { f: 3, z: 1 }));
    function drawIndex(g, t) {
      const segW = (numW - grid.gutter * (nP - 1)) / nP;
      const y = botRuleY - Math.round(56 * unit);
      for (let i = 0; i < nP; i++) {
        const x = numX + i * (segW + grid.gutter);
        const p = K.clamp(idxTracks[i].at(t));
        const base = K.clamp(rBot.grow.at(t)) - K.clamp(rBot.shrink.at(t));
        if (base > 0) K.bar(g, x, y, segW * K.clamp(base), hair, P.muted);
        if (p > 0) {
          K.bar(g, x, y - Math.round(4 * unit), segW * p, Math.round(8 * unit), P.signal);
          const n = numLbl(i);
          K.drawRun(g, n, x, y - Math.round(22 * unit), { fill: P.ink, alpha: p });
        }
      }
    }
    if (land && !brutal && nP) qa.text('index', { box: { x0: numX, y0: botRuleY - 100 * unit, x1: numX + numW, y1: botRuleY }, size: 23 * unit * 0.7, fg: P.ink, bg: P.bg, decorative: true });
    const push = new K.Track(1).ease(0, D, 1.04, K.sineInOut);

    const rollEnd = T.numeral + digits.length * S16 * 1.5 + 1.1;
    return {
      // the counter roll moves ~30 digit-heights/s: sample it densely instead of strobing
      samplesHint: (t) => (numRun && t > T.numeral && t < rollEnd ? 24 : 0),
      draw(g, t) {
        if (poster) { const z = push.at(t); g.translate(W / 2, H / 2); g.scale(z, z); g.translate(-W / 2, -H / 2); }
        drawGuides(g, t);
        hRule(g, t, rTop, M, W - M, topRuleY);
        hRule(g, t, rBot, M, W - M, botRuleY);
        if (side && numRun && !brutal) vRule(g, t, rV, grid.x(txtCol) - grid.gutter / 2 - (land ? grid.colW / 2 : 0), topRuleY, land ? botRuleY : (nP ? pTop - 24 * unit : botRuleY));
        if (kick) maskLine(g, t, kick, M, kickY, T.kicker, tOut(9), P.ink);
        if (kick) {
          const sq = Math.round(10 * unit);
          const p = K.clamp(new K.Track(0).spring(T.kicker, 1, 'snap').spring(tOut(9), 0, 'lock').at(t));
          if (p > 0) K.bar(g, W - M - sq, kickY - kick.capPx + (kick.capPx - sq) / 2, sq * p, sq, P.signal);
        }
        drawNumeral(g, t);
        tRuns.forEach((r, i) => maskLine(g, t, r, txtX - r.inkLeft, tBases[i], T.title[i], tOut(4 + i * 0.5), titleFill(i)));
        if (land && !brutal && nP) drawIndex(g, t);
        sRuns.forEach((r, i) => maskLine(g, t, r, txtX - r.inkLeft, sBases[i], T.sub + i * S16, tOut(5 + i * 0.5), P.muted));
        modules.forEach((m, i) => drawModule(g, t, m, i));
        if (foot) maskLine(g, t, foot, M, footY, T.footer, tOut(10), P.muted);
      },
    };
  },
};
