// EDITORIAL SERIF — magazine / documentary title card and pull-quote.
// High-contrast serif set with generous negative space; words fade up out of
// a soft defocus on slow, heavy springs; one headline word swaps from roman to
// italic on the beat and the rest of its line reflows around it. Quote mode
// hangs the opening mark in the margin and reveals the quote word by word.
import * as K from '../../src/kit/index.js';

const BEATS = 12;
const STYLES = ['magazine', 'noir', 'gallery'];
const STYLE_PALETTE = {
  magazine: {},
  noir: { bg: '#040404', ink: '#F4F4F2', accent: '#E8DFCB', muted: '#8A8A8A' },
  gallery: { bg: '#F1EEE8', ink: '#191919', accent: '#191919', muted: '#6A6660' },
};
// size of the type relative to the magazine layout, and how words arrive
const STYLE_CFG = {
  magazine: { scale: 1, reveal: 'defocus' },
  noir: { scale: 1.08, reveal: 'light-cut' },
  gallery: { scale: 0.6, reveal: 'fade' },
};
const STOP = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'and', 'or', 'but', 'with', 'from', 'as', 'is', 'my', 'your', 'our', 'its']);

export default {
  id: 'editorial-serif',
  version: '1.1.0',
  name: 'Editorial Serif',
  description:
    'Magazine/documentary title card or pull-quote: high-contrast serif, a headline word that swaps to italic on the beat while its line reflows, hairline rules, mono section numbers, slow luxurious springs. Modes: title | quote.',
  tags: ['editorial', 'documentary', 'title', 'quote', 'serif', 'elegant', 'youtube', 'podcast'],
  formats: ['landscape', 'square', 'vertical', 'portrait'],
  bpm: 72,
  duration: 10,
  loop: false,
  palette: { bg: '#101010', ink: '#EDE6D6', accent: '#C8A15A', muted: '#9A9282' },
  paletteRoles: { bg: 'ground', ink: 'headline and quote', accent: 'italic swap word, quote mark, hairline highlights', muted: 'standfirst, labels, attribution' },
  fonts: {
    serif: { family: 'Instrument Serif', weight: 400 },
    italic: { family: 'Instrument Serif', weight: 400, style: 'italic' },
    mono: { family: 'IBM Plex Mono', weight: 400 },
  },
  params: {
    outro: true,
    tracking: { serif: -10, mono: 140 },
    align: 'left',
    style: 'magazine',
  },
  schema: {
    content: {
      type: 'object',
      additionalProperties: false,
      properties: {
        mode: { enum: ['title', 'quote'], description: 'title: section number + headline + standfirst + byline. quote: hanging-mark pull quote + attribution.' },
        number: { type: 'string', maxLength: 8, description: 'Section/issue number, e.g. "04" (rendered as N° 04).' },
        section: { type: 'string', maxLength: 32, description: 'Section label, e.g. "THE LONG READ".' },
        headline: { type: 'string', maxLength: 80, description: 'Title mode: 3–9 words, balanced into ≤3 lines.' },
        swap: { type: 'string', maxLength: 24, description: 'Word of the headline that swaps to italic on the beat (default: the longest word).' },
        standfirst: { type: 'string', maxLength: 160, description: 'Title mode: one or two sentences under the headline.' },
        byline: { type: 'string', maxLength: 60, description: 'Title mode: credits line, e.g. "WORDS — S. LUND".' },
        quote: { type: 'string', maxLength: 220, description: 'Quote mode: the quote, without quotation marks. Wrap words in *asterisks* to set them italic in the accent.' },
        attribution: { type: 'string', maxLength: 40, description: 'Quote mode: who said it.' },
        role: { type: 'string', maxLength: 48, description: 'Quote mode: their role / source.' },
      },
    },
    params: {
      type: 'object',
      additionalProperties: false,
      properties: {
        outro: { type: 'boolean', description: 'Fade everything down to the ground at the end' },
        tracking: { type: 'object', properties: { serif: { type: 'number' }, mono: { type: 'number' } }, additionalProperties: false },
        align: { enum: ['left'], description: 'Editorial left alignment (reserved for future centred variant)' },
        style: { enum: STYLES, description: 'magazine (defocus fades, gold italic swap) | noir (black & white, venetian-blind light, hard light-cut reveals, grain) | gallery (museum wall label: paper ground, small precise type, pure fades, hairline)' },
      },
    },
  },
  example: {
    template: 'editorial-serif',
    format: 'landscape',
    fps: 60,
    duration: 10,
    bpm: 72,
    seed: 11,
    content: {
      mode: 'title',
      number: '04',
      section: 'The Long Read',
      headline: 'The quiet death of the keyframe',
      swap: 'quiet',
      standfirst: 'How a generation of editors stopped animating by hand — and started directing machines that animate for them.',
      byline: 'Words — Sam Lund · Film — Studio North',
    },
  },
  notes: 'Title mode wants 3–9 headline words; quote mode up to ~35 words (the size adapts). Mark quote emphasis with *asterisks*. Works on dark and light palettes (override bg/ink/accent/muted together).',

  build(ctx) {
    const { W, H, params, content: C, fonts, beat, qa, fps } = ctx;
    const style = STYLES.includes(params.style) ? params.style : 'magazine';
    const userPal = ctx.spec.palette || {};
    for (const [k, v] of Object.entries(STYLE_PALETTE[style])) if (!(k in userPal)) ctx.palette[k] = v;
    const P = ctx.palette;
    const SC = STYLE_CFG[style];
    const tr = params.tracking;
    const fS = fonts.get('serif'), fI = fonts.get('italic'), fM = fonts.get('mono');
    const unit = Math.min(W, H) / 1080;
    const land = ctx.aspect === 'landscape', vert = ctx.aspect === 'vertical';
    const totalBeats = Math.round((ctx.duration * beat.bpm) / 60);
    const bs = totalBeats / BEATS;
    const B = (n) => beat.t(n * bs);
    const E8 = (beat.spb * bs) / 2;
    const D = ctx.duration;
    const mode = C.mode === 'quote' ? 'quote' : 'title';
    const Mx = Math.round((land ? 150 : vert ? 84 : 96) * unit);
    const My = Math.round((land ? 110 : vert ? 150 : 96) * unit);
    const IW = W - 2 * Mx;
    const hair = Math.max(1, Math.round(1.5 * unit));
    const capSize = (face, cap) => (cap * face.upm) / face.capHeight;
    const mono = (s, size = 23 * unit) => K.shape(fM, s.toUpperCase(), { size, tracking: tr.mono, kerning: 'metric' });
    const hit = (t, l) => qa.hit(t, l);
    const outOn = params.outro;
    const tOut = outOn ? B(10.3) : Infinity;
    const fadeOut = (t, k = 0) => (outOn ? 1 - K.clamp(K.springStep(t - tOut - k * E8 * 0.15, 1.7, 1)) : 1);
    const GLIDE = { f: 0.85, z: 1 };

    // word-level layout: each word is its own run so it can fade, swap and reflow
    function setWords(words, faceOf, size, maxW) {
      const probe = (w) => K.shape(faceOf(w), w.text, { size, tracking: tr.serif, capSymbols: false });
      const space = K.shape(fS, 'n n', { size, tracking: tr.serif }).advance - 2 * K.shape(fS, 'n', { size, tracking: tr.serif }).advance;
      const runs = words.map(probe);
      // balanced breaking on measured widths (words are few; exhaustive DP)
      const n = words.length;
      const lineW = (a, b) => runs.slice(a, b).reduce((s, r) => s + r.advance, 0) + space * (b - a - 1);
      const best = new Array(n + 1).fill(Infinity), prev = new Array(n + 1).fill(-1);
      best[0] = 0;
      for (let b = 1; b <= n; b++) for (let a = b - 1; a >= 0; a--) {
        const w = lineW(a, b);
        if (w > maxW && b - a > 1) break;
        const slack = maxW - w;
        const last = b === n;
        // editorial rag: never end a line on a function word ("death of / the")
        const tail = !last && STOP.has(words[b - 1].text.toLowerCase().replace(/[^a-z’']/g, '')) ? (maxW * 0.45) ** 2 : 0;
        const cost = best[a] + tail + (last ? Math.max(0, slack - maxW * 0.45) ** 2 * 0.3 + (b - a === 1 && n > 2 ? maxW * maxW : 0) : slack * slack);
        if (cost < best[b]) { best[b] = cost; prev[b] = a; }
      }
      const breaks = [];
      for (let b = n; b > 0; b = prev[b]) breaks.unshift([prev[b], b]);
      const lines = breaks.map(([a, b]) => {
        let x = 0;
        const items = [];
        for (let k = a; k < b; k++) { items.push({ k, run: runs[k], x }); x += runs[k].advance + space; }
        return { items, width: x - space };
      });
      return { runs, lines, space };
    }

    const reg = (label, run, x, y, fg, extra = {}) => qa.text(label, { box: K.runBox(run, x, y), size: run.capPx, fg, bg: P.bg, ...extra });
    const fadeUp = (t, t0, cap) => {
      if (SC.reveal === 'light-cut') return { dy: 0, alpha: K.clamp((t - t0) / 0.07), blur: 0 };
      if (SC.reveal === 'fade') return { dy: 0, alpha: K.clamp(K.springStep(t - t0, 0.55, 1)), blur: 0 };
      const p = K.springStep(t - t0, 0.95, 1);
      // sub-0.4px defocus is invisible but costs a filter pass per glyph: skip it
      const bl = (1 - K.clamp(p)) * 7 * unit;
      return { dy: (1 - p) * cap * 0.42, alpha: K.clamp(K.springStep(t - t0, 1.3, 1)), blur: bl < 0.4 ? 0 : bl };
    };
    // hairlines draw in from the left and retract to the left on the outro
    const rule = (g, t, t0, x0, x1, y, col = P.muted, w = hair) => {
      const p = K.clamp(K.springStep(t - t0, 0.7, 1)) * fadeOut(t, 2);
      if (p > 0) K.bar(g, x0, y - w / 2, (x1 - x0) * p, w, col);
    };

    // ───────── header: N° number · section, hairline ─────────
    const headRuleY = My + Math.round(34 * unit);
    const hNum = C.number ? mono(`N° ${C.number}`) : null;
    const hSec = C.section ? mono(C.section) : null;
    const headY = headRuleY - Math.round(16 * unit);
    const tHead = B(0);
    hit(tHead, 'header rule');
    if (hNum) reg('number', hNum, Mx, headY, P.muted);
    if (hSec) reg('section', hSec, W - Mx - hSec.advance, headY, P.muted);

    let drawBody;
    const keys = [[0, 'empty ground'], [B(0.8), 'header']];

    if (mode === 'title') {
      // ───────── headline ─────────
      const raw = (C.headline || 'Untitled').trim().split(/\s+/);
      const clean = (w) => w.replace(/[^\p{L}\p{N}’'-]/gu, '').toLowerCase();
      const swapIdx = C.swap ? raw.findIndex((w) => clean(w) === clean(C.swap)) : raw.reduce((bi, w, i) => (clean(w).length > clean(raw[bi]).length ? i : bi), 0);
      const words = raw.map((text, k) => ({ text, k }));
      let cap = (land ? 136 : vert ? 110 : 104) * unit * SC.scale, L;
      const maxW = (land ? IW * 0.8 : IW) * (style === 'gallery' ? 0.72 : 1);
      for (;;) {
        const size = capSize(fS, cap);
        L = setWords(words, () => fS, size, maxW);
        if (L.lines.length <= 3 || cap < 40 * unit) break;
        cap *= 0.94;
      }
      const size = capSize(fS, cap);
      const italicRun = swapIdx >= 0 ? K.shape(fI, raw[swapIdx], { size, tracking: tr.serif }) : null;
      const lead = Math.round(cap * 1.34);
      // standfirst
      const sCap = (land ? 25 : 26) * unit;
      const sSize = capSize(fS, sCap);
      const sMaxW = land ? IW * 0.5 : IW * 0.9;
      const sLines = C.standfirst ? K.balanceLines(fS, C.standfirst, sMaxW, { size: sSize, tracking: 0 }) : [];
      const sRuns = sLines.map((l) => K.shape(fS, l, { size: sSize, tracking: 0 }));
      const sLead = Math.round(sCap * 1.9);
      const by = C.byline ? mono(C.byline, 23 * unit) : null;
      // vertical: headline block sits in the lower-middle; byline on the bottom rule
      const footRuleY = H - My - Math.round(40 * unit);
      const byY = footRuleY + Math.round(16 * unit) + (by ? by.capPx : 0);
      const blockH = cap + (L.lines.length - 1) * lead + (sRuns.length ? Math.round(sCap + 70 * unit) + (sRuns.length - 1) * sLead : 0);
      const blockBottom = footRuleY - Math.round((land ? 90 : 110) * unit);
      const top0 = Math.max(headRuleY + Math.round(80 * unit), blockBottom - blockH);
      const base0 = Math.round(top0 + cap);
      const bases = L.lines.map((_, i) => base0 + i * lead);
      const sBase0 = bases[bases.length - 1] + Math.round(sCap + 70 * unit);
      const sBases = sRuns.map((_, i) => sBase0 + i * sLead);
      // timing
      const tWords = [];
      let n = 0;
      L.lines.forEach((ln) => ln.items.forEach((it) => { tWords[it.k] = B(1) + n * E8 * 0.5; n++; }));
      const tSwap = B(4), tStand = B(5), tBy = B(6);
      hit(B(1), 'headline in');
      hit(tSwap, 'italic swap');
      if (sRuns.length) hit(tStand, 'standfirst');
      if (by) hit(tBy, 'byline');
      if (outOn) hit(tOut, 'outro');
      // swap geometry: the italic word's line reflows (following words close up)
      const swapLine = L.lines.findIndex((ln) => ln.items.some((it) => it.k === swapIdx));
      const dW = italicRun ? italicRun.advance - L.runs[swapIdx].advance : 0;
      const pSwap = (t) => K.springStep(t - tSwap, 1.1, 0.9);
      // QA
      L.lines.forEach((ln, i) => ln.items.forEach((it) => reg(`headline-${i}-${it.k}`, it.run, Mx + it.x, bases[i], P.ink, it.k === 0 ? { lines: L.lines.map((l) => l.items.map((q) => raw[q.k]).join(' ')) } : {})));
      if (italicRun) qa.text('swap-italic', { box: K.runBox(italicRun, Mx + L.lines[swapLine].items.find((it) => it.k === swapIdx).x, bases[swapLine]), size: italicRun.capPx, fg: P.accent, bg: P.bg });
      sRuns.forEach((r, i) => reg('standfirst-' + i, r, Mx, sBases[i], P.muted, i === 0 ? { lines: sLines } : {}));
      if (by) reg('byline', by, Mx, byY, P.muted);
      keys.push([B(2.2), 'headline rising'], [B(3.6), 'headline set'], [B(4.35), 'italic swap'], [B(5.6), 'standfirst'], [B(7.5), 'full card'], [B(9.6), 'hold']);

      drawBody = (g, t) => {
        const ps = italicRun ? pSwap(t) : 0;
        L.lines.forEach((ln, i) => {
          ln.items.forEach((it) => {
            const shift = i === swapLine && it.k > swapIdx ? dW * ps : 0;
            const f = fadeUp(t, tWords[it.k], cap);
            const o = fadeOut(t, i);
            if (t < tWords[it.k]) return;
            const x = Mx + it.x + shift, y = bases[i] + f.dy;
            if (it.k === swapIdx && italicRun) {
              // roman letters sink away, italic letters settle in, one glyph per 1/32
              K.drawRun(g, it.run, x, y, { fill: P.ink, each: (gi, j) => {
                const q = K.clamp(K.springStep(t - tSwap - j * E8 * 0.12, 1.6, 1));
                return { alpha: f.alpha * o * (1 - q), dy: q * cap * 0.16, blur: f.blur + q * 4 * unit };
              } });
              K.drawRun(g, italicRun, x, y, { fill: P.accent, each: (gi, j) => {
                const q = K.clamp(K.springStep(t - tSwap - j * E8 * 0.12, 1.6, 1));
                return { alpha: o * q, dy: (1 - q) * -cap * 0.16, blur: (1 - q) * 4 * unit };
              } });
            } else {
              K.drawRun(g, it.run, x, y, { fill: P.ink, alpha: f.alpha * o, blur: f.blur });
            }
          });
        });
        sRuns.forEach((r, i) => {
          if (t < tStand + i * E8 * 0.5) return;
          const f = fadeUp(t, tStand + i * E8 * 0.5, sCap);
          K.drawRun(g, r, Mx, sBases[i] + f.dy, { fill: P.muted, alpha: f.alpha * fadeOut(t, 3), blur: f.blur * 0.5 });
        });
        rule(g, t, tBy, Mx, W - Mx, footRuleY);
        if (by && t >= tBy + E8 * 0.5) {
          const f = fadeUp(t, tBy + E8 * 0.5, by.capPx);
          K.drawRun(g, by, Mx, byY + f.dy * 0.5, { fill: P.muted, alpha: f.alpha * fadeOut(t, 4) });
        }
      };
      drawBody.footRuleY = footRuleY;
    } else {
      // ───────── quote ─────────
      const toks = (C.quote || '').trim().split(/\s+/).map((w, k) => {
        const em = /^\*.*\*[^\p{L}]*$|^\*/u.test(w) || /\*$/.test(w);
        return { text: w.replace(/\*/g, ''), k, em };
      });
      // propagate *multi word* emphasis spans
      let inEm = false;
      (C.quote || '').trim().split(/\s+/).forEach((w, k) => {
        const open = w.startsWith('*'), close = /\*[^\p{L}]*$/u.test(w);
        if (open) inEm = true;
        toks[k].em = inEm;
        if (close) inEm = false;
      });
      const n = toks.length;
      let cap = (land ? (n > 22 ? 58 : 72) : vert ? (n > 22 ? 84 : 100) : n > 22 ? 52 : 64) * unit * SC.scale;
      const markRun0 = (c) => K.shape(fS, '“', { size: capSize(fS, c) * 2.4 });
      let L, markRun;
      const maxLines = land ? 5 : vert ? 9 : 6;
      for (;;) {
        const size = capSize(fS, cap);
        markRun = markRun0(cap);
        const indent = 0;
        L = setWords(toks, (w) => (w.em ? fI : fS), size, (land ? IW * 0.86 : IW - markRun.inkWidth * 0.9) - indent);
        if (L.lines.length <= maxLines || cap < 30 * unit) break;
        cap *= 0.94;
      }
      const lead = Math.round(cap * 1.42);
      // hanging punctuation: the mark lives in the margin, the text block keeps a clean left edge
      const qX = Mx + Math.round(markRun.inkWidth * (land ? 0.6 : 0.9));
      const blockH = cap + (L.lines.length - 1) * lead;
      const attr = C.attribution ? mono(`— ${C.attribution}`, 24 * unit) : null;
      const role = C.role ? mono(C.role, 23 * unit) : null;
      const attrGap = Math.round(84 * unit);
      const totalH = blockH + (attr ? attrGap + attr.capPx + (role ? 34 * unit : 0) : 0);
      const top0 = Math.max(headRuleY + markRun.capPx * 0.6 + 60 * unit, Math.round((H - totalH) / 2 + 10 * unit));
      const base0 = top0 + cap;
      const bases = L.lines.map((_, i) => base0 + i * lead);
      const markX = qX - markRun.inkRight - Math.round(cap * 0.18);
      const markBase = base0 - cap + markRun.capPx * 0.72 + (vert || !land ? 0 : 0);
      const attrY = bases[bases.length - 1] + attrGap;
      const roleY = attrY + Math.round(40 * unit);
      // closing mark hangs off the last word
      const lastLine = L.lines[L.lines.length - 1];
      const lastIt = lastLine.items[lastLine.items.length - 1];
      const closeRun = K.shape(fS, '”', { size: capSize(fS, cap) });
      // timing: words spread from beat 1 across a reveal window proportional to length
      const revealBeats = K.clamp(n / 3.2, 3, 6.5);
      const tMark = B(0.5), tQ0 = B(1), tQ1 = B(1 + revealBeats);
      const tWord = (k) => tQ0 + ((tQ1 - tQ0) * k) / Math.max(1, n - 1);
      const tAttr = B(Math.min(9, Math.ceil(1 + revealBeats + 0.5)));
      hit(tMark, 'quote mark');
      hit(tQ0, 'quote reveal');
      hit(tAttr, 'attribution');
      if (outOn) hit(tOut, 'outro');
      // QA
      L.lines.forEach((ln, i) => ln.items.forEach((it) => reg(`quote-${i}-${it.k}`, it.run, qX + it.x, bases[i], toks[it.k].em ? P.accent : P.ink, it.k === 0 ? { lines: L.lines.map((l) => l.items.map((q) => toks[q.k].text).join(' ')), orphanOk: false } : {})));
      if (attr) reg('attribution', attr, qX, attrY, P.ink);
      if (role) reg('role', role, qX, roleY, P.muted);
      keys.push([tMark + 0.3, 'mark'], [K.lerp(tQ0, tQ1, 0.3), 'quote 30%'], [K.lerp(tQ0, tQ1, 0.7), 'quote 70%'], [tQ1 + 0.4, 'quote set'], [tAttr + 0.8, 'attribution'], [B(9.5), 'hold']);

      drawBody = (g, t) => {
        if (t >= tMark) {
          const p = K.springStep(t - tMark, 0.8, 1);
          K.drawRun(g, markRun, markX, markBase, { fill: P.accent, alpha: K.clamp(p) * fadeOut(t, 0), group: { s: 1 + (1 - p) * 0.12 } });
        }
        L.lines.forEach((ln, i) => ln.items.forEach((it) => {
          const t0 = tWord(it.k);
          if (t < t0) return;
          const f = fadeUp(t, t0, cap);
          const em = toks[it.k].em;
          K.drawRun(g, it.run, qX + it.x, bases[i] + f.dy, { fill: em ? P.accent : P.ink, alpha: f.alpha * fadeOut(t, 1 + i * 0.3), blur: f.blur });
          if (it === lastIt) {
            const cx0 = qX + it.x + it.run.advance + Math.round(cap * 0.04);
            K.drawRun(g, closeRun, cx0, bases[i] + f.dy, { fill: P.accent, alpha: f.alpha * fadeOut(t, 1) });
          }
        }));
        if (attr) {
          rule(g, t, tAttr, qX, qX + Math.round(64 * unit), attrY - attr.capPx - Math.round(30 * unit), P.accent, hair * 1.4);
          if (t >= tAttr) {
            const f = fadeUp(t, tAttr + E8 * 0.3, attr.capPx);
            K.drawRun(g, attr, qX, attrY + f.dy * 0.5, { fill: P.ink, alpha: f.alpha * fadeOut(t, 3) });
            if (role) K.drawRun(g, role, qX, roleY + f.dy * 0.5, { fill: P.muted, alpha: K.clamp(K.springStep(t - tAttr - E8, 1.3, 1)) * fadeOut(t, 3) });
          }
        }
      };
    }

    keys.push([B(11), 'outro'], [D - 1 / fps, 'last frame']);
    keys.forEach(([t, l]) => qa.keyframe(t, l));

    // noir: light through venetian blinds rakes across the frame, slowly
    function drawBlinds(g, t) {
      const o = fadeOut(t, 0);
      g.save();
      g.globalAlpha = 0.07 * o;
      g.fillStyle = P.ink;
      g.translate(W * 0.5, H * 0.5);
      g.rotate(-0.33);
      const span = Math.hypot(W, H), sp = 96 * unit, bw = 44 * unit;
      const off = K.mod(t * 14 * unit, sp);
      for (let y = -span / 2 - sp; y < span / 2 + sp; y += sp) g.fillRect(-span / 2, y + off, span, bw);
      g.restore();
    }
    return {
      post(g, t) {
        if (style !== 'noir') return;
        const r = Math.hypot(W, H) / 2;
        const v = g.createRadialGradient(W * 0.45, H * 0.45, r * 0.25, W * 0.5, H * 0.5, r);
        v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.72)');
        g.fillStyle = v; g.fillRect(0, 0, W, H);
        K.grain(g, W, H, { seed: 11, frame: Math.round(K.frameQuant(t, fps) * fps), amount: 0.09, mode: 'overlay' });
      },
      draw(g, t) {
        if (style === 'noir') drawBlinds(g, t);
        if (style === 'gallery') {
          // a hairline runs down the left edge like a wall-label mount
          const p = K.clamp(K.springStep(t - tHead, 0.5, 1)) * fadeOut(t, 2);
          if (p > 0) K.bar(g, Mx - Math.round(34 * unit), headRuleY, hair, (H - My - headRuleY) * p, P.muted);
        }
        const o = fadeOut(t, 5);
        g.save();
        g.globalAlpha = 1;
        rule(g, t, tHead, Mx, W - Mx, headRuleY);
        g.restore();
        if (o < 1) {
          // retract the header rule as the card fades
          const r = 1 - o;
          K.bar(g, Mx, headRuleY - hair, (W - 2 * Mx) * r, hair * 2, P.bg);
        }
        if (hNum && t >= tHead) { const f = fadeUp(t, tHead + E8 * 0.4, hNum.capPx); K.drawRun(g, hNum, Mx, headY + f.dy * 0.4, { fill: P.muted, alpha: f.alpha * o }); }
        if (hSec && t >= tHead) { const f = fadeUp(t, tHead + E8 * 0.8, hSec.capPx); K.drawRun(g, hSec, W - Mx - hSec.advance, headY + f.dy * 0.4, { fill: P.muted, alpha: f.alpha * o }); }
        drawBody(g, t);
        if (drawBody.footRuleY && o < 1) K.bar(g, Mx, drawBody.footRuleY - hair, (W - 2 * Mx) * (1 - o), hair * 2, P.bg);
      },
    };
  },
};
