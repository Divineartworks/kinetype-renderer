// BRAND CARD — the glue shots of a product film: a hook, a benefit list, one
// big number, a call to action — optionally beside a still of the REAL
// product (content.product: a capture frame in the same frame and shadow as
// ui-demo), so cards and UI shots read as one film. The final composition is
// laid out ONCE; every element animates into its fixed final place on
// near-critically damped springs (scene.elements lists when each settles, and
// QA warns if anything is still moving into the final hold). Light (bg) or
// brand night ground (params.ground).
import * as K from '../../src/kit/index.js';
import * as X from '../../src/kit/x-ui.js';

const MODES = ['hook', 'benefit', 'stat', 'cta'];
const DEFAULT_DURATION = { hook: 3.4, benefit: 4.6, stat: 4.2, cta: 4.4 };
const HOLD = 0.9; // seconds of settled hold every mode keeps at the end
const SPRING = { f: 2.8, z: 0.92 }; // honest damping: a hair of overshoot, no bounce
const SOFT = { f: 2.2, z: 1 };
const TILE = { f: 1.9, z: 1 };
const REF = ['string', 'number'];

export default {
  id: 'brand-card',
  version: '1.2.0',
  name: 'Brand Card',
  description: 'Product-film glue shot: hook, benefit list, counting stat or call to action, with the brand logo and optionally a still of the real product UI (same frame as ui-demo) beside the type. Light or brand-night ground.',
  tags: ['product', 'brand', 'saas', 'hook', 'stat', 'cta', 'launch', 'film'],
  formats: ['landscape', 'vertical', 'square', 'portrait'],
  bpm: 120,
  duration: 4,
  loop: false,
  palette: { bg: '#F2F1ED', night: '#0F1626', ink: '#141518', paper: '#FFFFFF', primary: '#2F55E4', accent: '#E4572E', mute: '#5E6168' },
  paletteRoles: { bg: 'light ground', night: 'night ground (params.ground "night")', ink: 'text on light', paper: 'text on night and on the button', primary: 'brand: number, kicker, numerals, button', accent: 'one signal: dot, underline', mute: 'secondary text on light' },
  fonts: {
    display: { family: 'Inter Tight', weight: 700 },
    text: { family: 'Inter', weight: 500 },
  },
  params: { ground: 'light', entrance: 'rise', grain: 0.02, scale: 1, drift: 0.012 },
  schema: {
    content: {
      type: 'object',
      additionalProperties: false,
      required: ['mode'],
      properties: {
        mode: { enum: MODES },
        logo: { type: 'string', description: 'spec.media id of the logo lockup (svg/png)' },
        logoNight: { type: 'string', description: 'logo for the night ground' },
        kicker: { type: 'string', maxLength: 28 },
        headline: { type: 'string', maxLength: 48 },
        lines: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string', maxLength: 40 }, description: 'benefit lines' },
        numerals: { type: 'boolean' },
        value: { type: 'string', maxLength: 12, pattern: '^[0-9][0-9 ,.]*$', description: 'stat: "30", "2.5", "1 200"' },
        prefix: { type: 'string', maxLength: 4 },
        suffix: { type: 'string', maxLength: 8 },
        label: { type: 'string', maxLength: 60 },
        footnote: { type: 'string', maxLength: 60, description: 'small print, bottom-left (claims)' },
        cta: { type: 'string', maxLength: 24, description: 'button label' },
        url: { type: 'string', maxLength: 40 },
        product: {
          type: 'object', additionalProperties: false, required: ['capture'],
          description: 'a still of the real product: {capture: media id, at: mark/step/s, frame?, crop? {x,y,w,h} CSS px}',
          properties: { capture: { type: 'string' }, at: { type: REF }, frame: { enum: ['browser', 'phone', 'bare'] }, crop: { type: 'object' }, urlLabel: { type: 'string', maxLength: 48 } },
        },
      },
    },
    params: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ground: { enum: ['light', 'night'] },
        entrance: { enum: ['rise', 'slam'], description: 'hook headline' },
        grain: { type: 'number', minimum: 0, maximum: 0.03 },
        scale: { type: 'number', minimum: 0.7, maximum: 1.3 },
        drift: { type: 'number', minimum: 0, maximum: 0.04, description: 'Very slow scale drift of the product tile (and of the night ground\'s light) over the whole shot, up to this fraction by the end (default 0.012), so no frame group is identical for more than 5 s. Text stays pixel-crisp: only the tile and the ground move. 0 = off.' },
      },
    },
  },
  example: {
    template: 'brand-card', format: 'landscape', fps: 30,
    content: { mode: 'hook', kicker: 'FIELDNOTE', headline: 'Every job, one calm place' },
  },
  notes: 'Fields: hook {headline, kicker?}, benefit {lines, numerals?, headline?}, stat {value, label, prefix?, suffix?}, cta {headline, cta, url?}; any mode: logo, footnote, product. Product tile: right of the type (landscape) or below it (vertical/square). Logo and product pixels are exempt from palette QA. Last 0.9 s is a still hold. params.drift (default 0.012): the product tile (and a night ground\'s light) drift very slowly over the shot so no frame group is identical for > 5 s; a stat card with no product beside it that holds > 4 s gets a slow push of its whole block instead (scaled by drift; drift 0 = fully still, which the settle contract tests); otherwise the type never moves. QA static-hold (warn) when a settled type-only light card would hold > 5 s.',

  build(ctx) {
    const { W, H, fps, params, content: C, palette: P, qa, fonts } = ctx;
    const mode = C.mode;
    if (!MODES.includes(mode)) throw new Error(`brand-card: content.mode must be one of ${MODES.join(', ')}`);
    const need = { hook: ['headline'], benefit: ['lines'], stat: ['value', 'label'], cta: ['headline', 'cta'] }[mode];
    for (const f of need) if (!C[f] || (Array.isArray(C[f]) && !C[f].length)) throw new Error(`brand-card: mode "${mode}" needs content.${f}`);
    const unit = (Math.min(W, H) / 1080) * (params.scale ?? 1);
    const land = ctx.aspect === 'landscape';
    const vert = ctx.aspect === 'vertical';
    const fD = fonts.get('display'), fT = fonts.get('text');
    const sz = (face, cap) => (cap * face.upm) / face.capHeight;
    const D = ctx.spec.duration ?? DEFAULT_DURATION[mode];
    const hit = (t, l) => qa.hit(t, l);
    const q = (t) => K.frameQuant(t, fps);

    // ───────── ground + colours ─────────
    const night = params.ground === 'night';
    if (night) P.muteNight = K.mix(P.paper, P.night, 0.36); // derived token: secondary text on night
    const GROUND = night ? P.night : P.bg, FG = night ? P.paper : P.ink, SUB = night ? P.muteNight : P.mute;

    // ───────── settle registry: every element animates into a FIXED final place ─────────
    const elements = [];
    const settle = (id, t0, feel = SPRING, box = null) => elements.push({ id, t0, until: t0 + K.springSettle(feel.f, feel.z), box });
    const sp = (t, t0, f = SPRING) => K.springStep(t - t0, f.f, f.z);

    // ───────── frame of the composition (computed once) ─────────
    const mx = Math.round(ctx.grid.margin * (land ? 1.25 : vert ? 1.05 : 1.1));
    const topY = Math.round(vert ? H * 0.07 : ctx.grid.margin * 0.95);
    const botY = H - Math.round(vert ? H * 0.06 : ctx.grid.margin * 0.9);

    // logo lockup (top-left; a cta without a product carries it in the block, larger)
    const logoId = night && C.logoNight ? C.logoNight : C.logo;
    let logo = null;
    // a cta carries the logo as a lockup at the top of its text column (with or without a product tile)
    const inBlockLogo = mode === 'cta';
    if (logoId) {
      const m = ctx.media.get(logoId);
      const h = Math.round((inBlockLogo ? (vert ? 112 : 108) : vert ? 70 : 62) * unit);
      logo = { m, h, w: Math.round((h * m.w) / m.h) };
    }
    const headTop = logo && !inBlockLogo ? topY + logo.h + Math.round(40 * unit) : topY;

    // footnote (R1): small print bottom-left inside the safe area, any mode
    const fCap = Math.max(16 * unit, Math.round(Math.min(W, H) * 0.0148));
    const foot = C.footnote ? K.shape(fT, C.footnote, { size: sz(fT, fCap), tracking: 0 }) : null;
    const footBase = botY;
    const bottom = foot ? footBase - fCap - Math.round(44 * unit) : botY;

    // product tile region and the text region beside / above it
    let tile = null, region;
    if (C.product) {
      const pm = ctx.media.src[C.product.capture];
      if (!pm || pm.kind !== 'capture') throw new Error(`brand-card: content.product.capture "${C.product.capture}" must be a spec.media entry with "capture"`);
      const cap = pm.capture;
      const kind = C.product.frame || (cap.device.kind === 'phone' ? 'phone' : 'browser');
      const dsf = cap.device.deviceScaleFactor || pm.w / cap.device.viewport.width;
      const cr = C.product.crop || { x: 0, y: 0, w: cap.device.viewport.width, h: cap.device.viewport.height };
      const win = X.frameRect(kind, cr.w, cr.h);
      const ct = C.product.at != null ? X.captureTime(cap, C.product.at) : cap.duration - 1 / cap.fps;
      const idx = K.clamp(Math.floor(ct * cap.fps + 1e-6), 0, pm.frames - 1);
      // the product is a confident presence, not a thumbnail: landscape — a large tile
      // running off the right edge; vertical — the device rising from the bottom edge
      const phoneTile = kind === 'phone';
      const bleedOK = !foot;
      let s, tx, ty;
      if (land) {
        const gx = Math.round(W * 0.52);
        s = Math.min((W * (phoneTile ? 0.3 : 0.56)) / win.w, (H * (phoneTile ? 0.92 : 0.82)) / win.h, 1.15 * dsf);
        tx = phoneTile ? Math.round(W * 0.7 - (win.w * s) / 2) : gx; ty = Math.round(H * 0.53 - (win.h * s) / 2);
        if (!bleedOK) tx = Math.min(tx, W - Math.round(mx * 0.7) - win.w * s);
        // the type column ends a gap before the tile's ACTUAL left edge (the tile moves left
        // when a footnote keeps it inside the frame), never before the nominal split
        region = { x: mx, y: headTop, w: Math.min(gx, tx) - mx - Math.round(W * 0.04), h: bottom - headTop };
      } else {
        const split = Math.round(H * (vert ? 0.5 : 0.53));
        const availH = (bleedOK ? H * 1.04 : bottom) - split;
        s = Math.min((W - 2 * mx) / win.w, (phoneTile ? H * 0.56 : availH) / win.h, 1.15 * dsf);
        tx = Math.round((W - win.w * s) / 2); ty = split + Math.round(30 * unit);
        if (!bleedOK || !phoneTile) ty = Math.min(ty, Math.round(bottom - win.h * s));
        // ...and above the tile's actual top edge when it was pushed up to fit
        region = { x: mx, y: headTop, w: W - 2 * mx, h: Math.min(split, ty) - headTop - Math.round(56 * unit) };
      }
      const tw = win.w * s, th = win.h * s;
      const urlRun = kind === 'browser' && C.product.urlLabel ? K.shape(fT, C.product.urlLabel, { size: 13.5, tracking: 0, kerning: 'metric' }) : null;
      tile = { id: C.product.capture, idx, kind, cr, win, s, dsf, x: tx, y: ty, w: tw, h: th, urlRun, vx: tx - win.x * s, vy: ty - win.y * s };
    } else region = { x: mx, y: headTop, w: W - 2 * mx, h: bottom - headTop };
    const maxW = region.w;
    // optical centre of the text block: a touch above the region's middle
    const centreY = Math.round(region.y + region.h * (tile ? 0.5 : 0.47));
    const rx = region.x;

    // ───────── type helpers ─────────
    const place = (run, x, base) => ({ run, x: x - run.inkLeft, base });
    const typeBoxes = []; // every text box registered for QA (label, box): the no-overlap invariant checks them against the tile
    const regText = (label, o) => { typeBoxes.push({ label, box: o.box }); qa.text(label, o); };
    const regQ = (label, b, fg, size) => regText(label, { box: K.runBox(b.run, b.x, b.base), size: size ?? b.run.capPx, fg, bg: GROUND });
    /**
     * Largest cap <= capMax at which text breaks into <= maxLines balanced lines
     * that fit w. The column width is a HARD constraint: the cap never exceeds
     * what the longest word allows, and when nothing fits at capMin the type keeps
     * shrinking (to 0.6 × capMin) instead of overflowing; if even that fails, QA warns.
     */
    function fitLines(face, text, w, capMax, maxLines, tracking, capMin, prefer = maxLines, label = 'text') {
      const words = text.split(/\s+/).filter(Boolean);
      const wordCap = Math.min(...words.map((wd) => (K.fitSize(face, wd, w * 0.995, { tracking }) * face.capHeight) / face.upm));
      capMax = Math.min(capMax, wordCap);
      capMin = Math.min(capMin, capMax);
      const pm = text.match(/^([^,:;]+[,:;])\s+([^,:;]+)$/);
      const tryFit = (limit, floor) => {
        for (let cap = capMax; cap >= floor - 1e-6; cap *= 0.96) {
          const size = sz(face, cap);
          const cands = [];
          if (pm && limit >= 2) cands.push([pm[1], pm[2]]);
          cands.push(K.balanceLines(face, text, w, { size, tracking }));
          for (const lines of cands) {
            const runs = lines.map((l) => K.shape(face, l, { size, tracking }));
            if (lines.length <= limit && runs.every((r) => r.inkWidth <= w + 0.5)) return { runs, cap };
          }
        }
        return null;
      };
      const got = tryFit(prefer, capMax * 0.74) || tryFit(maxLines, capMin) || tryFit(maxLines + 1, capMin * 0.6);
      if (got) return got;
      const size = sz(face, capMin * 0.6);
      const runs = K.balanceLines(face, text, w, { size, tracking }).map((l) => K.shape(face, l, { size, tracking }));
      qa.warn(`brand-card: "${text}" (${label}) does not fit its ${Math.round(w)} px column in ${maxLines + 1} lines even at ${Math.round(capMin * 0.6)} px cap — shorten the copy`);
      return { runs, cap: capMin * 0.6 };
    }
    function wordMap(run) {
      const mp = new Map();
      let w = 0;
      for (const it of run.items) { if (it.ws) w++; else mp.set(it, w); }
      return { mp, n: w + 1 };
    }
    /** A run rising through a horizontal line mask; p(it) is 0..1 per glyph. */
    function riseRun(g, b, cap, p, fill) {
      g.save();
      g.beginPath();
      g.rect(0, b.base - cap * 1.12, W, cap * 1.52);
      g.clip();
      K.drawRun(g, b.run, b.x, b.base, { fill, each: (it) => { const v = p(it); return v >= 1 ? undefined : { dy: (1 - v) * cap * 1.55 }; } });
      g.restore();
    }
    const caps = (face, text, cap, tracking = 160) => K.shape(face, text, { size: sz(face, cap), tracking, kerning: 'metric' });
    const fadeUp = (g, run, x, base, p, dy, fill) => { if (p > 0) K.drawRun(g, run, x - run.inkLeft, base + (1 - p) * dy, { fill, alpha: K.clamp(p * 1.4) }); };
    function dot(g, cx, cy, r, fill, p = 1) {
      if (p <= 0) return;
      g.fillStyle = fill; g.beginPath(); g.arc(cx, cy, r * Math.min(p, 1), 0, Math.PI * 2); g.fill();
    }
    const S = tile ? (land ? 0.8 : 0.9) : 1; // type steps down beside the product

    // each mode: { endT (design seconds incl. hold), reg(k) → keyframe times, draw(g, t, k) }
    let M;

    // ═════════════ HOOK ═════════════
    if (mode === 'hook') {
      const cap0 = (land ? 168 : vert ? 176 : 150) * unit * S;
      const kCap = (vert ? 30 : 26) * unit;
      const kick = C.kicker ? caps(fT, C.kicker.toUpperCase(), kCap, 170) : null;
      // beside / above a product tile the whole block must fit its region (the headline gives way)
      let capTop = cap0, fit, cap, pitch, kGap, blockH;
      for (let it = 0; it < 14; it++) {
        fit = fitLines(fD, C.headline, maxW, capTop, vert ? 4 : 3, -24, 56 * unit, vert ? 3 : 2);
        cap = fit.cap; pitch = cap * 1.36;
        kGap = kick ? Math.round(cap * 0.62) : 0;
        blockH = (kick ? kCap + kGap : 0) + cap + (fit.runs.length - 1) * pitch;
        if (!tile || blockH <= region.h || capTop <= 40 * unit) break;
        capTop = Math.max(40 * unit, Math.min(capTop * 0.93, cap * 0.97));
      }
      if (tile && blockH > region.h + 1) qa.warn(`brand-card hook: block ${Math.round(blockH)} px is taller than its ${Math.round(region.h)} px region — shorten the headline`);
      const y0 = Math.round(centreY - blockH / 2);
      const dotR = 5.5 * unit;
      const kBase = y0 + kCap;
      const kX = rx + dotR * 2 + 16 * unit;
      const lines = fit.runs.map((r, i) => ({ ...place(r, rx, y0 + (kick ? kCap + kGap : 0) + cap + i * pitch), wm: wordMap(r) }));
      const nW = lines.reduce((a, l) => a + l.wm.n, 0);
      const slam = params.entrance === 'slam';
      const tK = 0.15, tH = slam ? 0.4 : 0.45, wStep = 0.085, lStep = slam ? 0.16 : 0.04;
      const lastE = tH + (slam ? lines.length * lStep : nW * wStep + lines.length * lStep);
      M = {
        endT: lastE + 1.0 + HOLD,
        reg(k) {
          if (kick) { regQ('kicker', place(kick, kX, kBase), P.primary); settle('kicker', tK * k, SOFT); }
          lines.forEach((l, i) => regQ(`headline ${i + 1}`, l, FG));
          hit(tK * k, 'kicker');
          let off = 0;
          lines.forEach((l, i) => { const t0 = tH + (slam ? i * lStep : off * wStep + i * lStep); hit(t0 * k, `headline line ${i + 1}`); off += l.wm.n; settle(`headline ${i + 1}`, (tH + (slam ? i * lStep : (off - 1) * wStep + i * lStep)) * k, slam ? { f: 3.6, z: 0.88 } : SPRING); });
          return [0.05, (tK + 0.12) * k, (tH + 0.1) * k, (tH + 0.3) * k, (tH + 0.55) * k, (tH + 0.85) * k, (lastE + 0.3) * k, (lastE + 0.7) * k, D * 0.8, D - 1 / fps];
        },
        draw(g, t, k) {
          if (kick) {
            const p = sp(t, tK * k, SOFT);
            dot(g, rx + dotR, kBase - kCap / 2, dotR, P.accent, K.clamp(p * 1.3));
            fadeUp(g, kick, kX, kBase, p, 10 * unit, P.primary);
          }
          let off = 0;
          lines.forEach((l, i) => {
            if (slam) {
              const p = sp(t, (tH + i * lStep) * k, { f: 3.6, z: 0.88 });
              if (p > 0) K.drawRun(g, l.run, l.x, l.base, { fill: FG, alpha: K.clamp(p * 2.2), blur: (1 - K.clamp(p)) * 7 * unit, group: { s: 1 + (1 - p) * 0.045, dy: (1 - p) * cap * 0.18 } });
            } else {
              const o = off;
              riseRun(g, l, cap, (it) => sp(t, (tH + (o + l.wm.mp.get(it)) * wStep + i * lStep) * k), FG);
            }
            off += l.wm.n;
          });
        },
      };
    }

    // ═════════════ BENEFIT ═════════════
    if (mode === 'benefit') {
      const lines = C.lines;
      const num = !!C.numerals;
      const numCol = num ? Math.round((vert ? 124 : 128) * unit * S) : 0;
      const w = maxW - numCol;
      // a strong size that wraps to two lines before it shrinks (the longest word must fit)
      let cap = (land ? (tile ? 66 : 100) : vert ? 96 : 84) * unit * (tile ? 1 : S);
      for (const s of lines) for (const wd of s.split(/\s+/)) cap = Math.min(cap, (K.fitSize(fD, wd, w * 0.985, { tracking: -14 }) * fD.capHeight) / fD.upm);
      cap = Math.max(cap, 34 * unit);
      const hCap = (vert ? 40 : 34) * unit;
      const head = C.headline ? K.shape(fT, C.headline, { size: sz(fT, hCap), tracking: 0 }) : null;
      const headGap = head ? Math.round(hCap * 1.7) : 0;
      let rowRuns, lp, padY, rowH, blockH;
      // beside / above a product tile the whole list must fit its region (the rows shrink)
      for (let it = 0; it < 14; it++) {
        rowRuns = lines.map((s) => fitLines(fD, s, w, cap, 2, -14, 30 * unit).runs);
        lp = cap * 1.36; padY = Math.round(cap * 0.62);
        rowH = (r) => padY * 2 + cap + (r.length - 1) * lp;
        blockH = (head ? hCap + headGap : 0) + rowRuns.reduce((a, r) => a + rowH(r), 0);
        if (!tile || blockH <= region.h || cap <= 24 * unit) break;
        cap *= 0.93;
      }
      if (tile && blockH > region.h + 1) qa.warn(`brand-card benefit: block ${Math.round(blockH)} px is taller than its ${Math.round(region.h)} px region — shorten the list`);
      let y = Math.round(centreY - blockH / 2);
      const headB = head ? place(head, rx, y + hCap) : null;
      y += head ? hCap + headGap : 0;
      const nCap = (vert ? 29 : 26) * unit;
      const rows = rowRuns.map((r, i) => {
        const top = y, h = rowH(r);
        y += h;
        const base0 = top + padY + cap;
        const nrun = num ? caps(fT, String(i + 1).padStart(2, '0'), nCap, 100) : null;
        return { top, h, i, lines: r.map((rr, j) => ({ ...place(rr, rx + numCol, base0 + j * lp), wm: wordMap(rr) })), n: nrun && place(nrun, rx, base0 - (cap - nCap) / 2) };
      });
      const ruleW = maxW, hairline = Math.max(1, Math.round(1.5 * unit));
      const tH = 0.2, tR = (i) => 0.55 + i * 0.5;
      M = {
        endT: tR(rows.length - 1) + 1.1 + HOLD,
        reg(k) {
          if (headB) { regQ('headline', headB, SUB); settle('headline', tH * k, SOFT); }
          rows.forEach((r) => {
            r.lines.forEach((l, j) => regQ(`line ${r.i + 1}${r.lines.length > 1 ? '.' + (j + 1) : ''}`, l, FG));
            if (r.n) regQ(`numeral ${r.i + 1}`, r.n, P.primary);
            hit(tR(r.i) * k, `line ${r.i + 1}`);
            settle(`row ${r.i + 1}`, tR(r.i) * k + 0.05 + 0.06 * (r.lines.length - 1) + 0.03 * Math.max(...r.lines.map((l) => l.wm.n)), SPRING);
          });
          if (head) hit(tH * k, 'headline');
          const kf = [0.05, (tH + 0.2) * k];
          rows.forEach((r) => kf.push((tR(r.i) + 0.12) * k, (tR(r.i) + 0.7) * k));
          kf.push(D * 0.85, D - 1 / fps);
          return kf;
        },
        draw(g, t, k) {
          if (head) fadeUp(g, head, rx, headB.base, sp(t, tH * k, SOFT), 10 * unit, SUB);
          rows.forEach((r) => {
            const t0 = tR(r.i) * k;
            const rule = sp(t, t0, SOFT);
            if (rule > 0) K.bar(g, rx, r.top, ruleW * K.clamp(rule), hairline, K.rgba(SUB, 0.45));
            r.lines.forEach((l, j) => riseRun(g, l, cap, (it) => sp(t, t0 + 0.05 + 0.06 * j + 0.03 * l.wm.mp.get(it)), FG));
            if (r.n) {
              g.save();
              g.beginPath(); g.rect(0, r.n.base - nCap * 1.4, W, nCap * 2.2); g.clip();
              K.drawRun(g, r.n.run, r.n.x, r.n.base + (1 - sp(t, t0 + 0.03, SOFT)) * nCap * 2, { fill: P.primary });
              g.restore();
            }
          });
          const last = rows[rows.length - 1], c = sp(t, tR(rows.length - 1) * k + 0.25, SOFT);
          if (c > 0) K.bar(g, rx, last.top + last.h, ruleW * K.clamp(c), hairline, K.rgba(SUB, 0.45));
        },
      };
    }

    // ═════════════ STAT ═════════════
    if (mode === 'stat') {
      const raw = C.value.trim();
      const gm = raw.match(/^\d{1,3}([ ,])\d{3}/);
      const grp = gm ? gm[1] : '';
      const decSep = grp ? (raw.includes('.') ? '.' : '') : /^\d+,\d+$/.test(raw) ? ',' : raw.includes('.') ? '.' : '';
      const clean = grp ? raw.split(grp).join('') : raw;
      const target = Number(decSep ? clean.replace(decSep, '.') : clean);
      if (!Number.isFinite(target)) throw new Error(`brand-card: content.value "${C.value}" is not a number`);
      const decimals = decSep ? clean.split(decSep)[1].length : 0;
      const fmt = (v) => {
        const [ip, dp] = v.toFixed(decimals).split('.');
        const gi = grp ? ip.replace(/\B(?=(\d{3})+(?!\d))/g, grp) : ip;
        return dp !== undefined ? gi + decSep + dp : gi;
      };
      const finalStr = fmt(target);
      const prefix = (C.prefix || '').trim(), suffix = (C.suffix || '').trim();
      // tabular layout: every digit centred in a cell the width of "0" — the final layout, fixed
      const layout = (cap) => {
        const size = sz(fD, cap);
        const run = (s) => K.shape(fD, s, { size, tracking: -20 });
        const cw = run('0').advance;
        const cells = [...finalStr].map((ch) => (/\d/.test(ch) ? cw : ch === ' ' ? size * 0.26 : run(ch).advance));
        const numW = cells.reduce((a, b) => a + b, 0);
        const sCap = cap * 0.42, sSize = sz(fD, sCap);
        const pre = prefix ? K.shape(fD, prefix, { size: sSize, tracking: -10 }) : null;
        const suf = suffix ? K.shape(fD, suffix, { size: sSize, tracking: -10 }) : null;
        const gapS = size * 0.07;
        const total = (pre ? pre.advance + gapS : 0) + numW + (suf ? gapS + suf.advance : 0);
        return { run, cw, cells, numW, pre, suf, gapS, total, cap, sCap };
      };
      const lbl = fitLines(fT, C.label, land && !tile ? Math.min(maxW, W * 0.52) : maxW, (land ? 52 : vert ? 70 : 54) * unit * Math.max(S, 0.85), 3, 0, 28 * unit);
      const lblPitch = lbl.cap * 1.42;
      const heightAt = (c) => c + Math.round(c * 0.16) + Math.max(3, Math.round(7 * unit)) + Math.round(c * 0.18 + lbl.cap * 0.9) + (lbl.runs.length - 1) * lblPitch;
      let cap = (land ? 380 : vert ? 560 : 400) * unit * S; // as big as the column allows
      let L = layout(cap);
      // ...and, beside / above a product tile, as tall as the region allows
      while ((L.total > maxW || (tile && heightAt(cap) > region.h)) && cap > 60 * unit) { cap *= 0.96; L = layout(cap); }
      if (tile && heightAt(cap) > region.h + 1) qa.warn(`brand-card stat: block ${Math.round(heightAt(cap))} px is taller than its ${Math.round(region.h)} px region`);
      const f0 = L.run([...finalStr][0]);
      // no product beside it: the number + caption block is centred in the column (not left-aligned with half the canvas empty)
      const blockW = Math.max(L.total, ...lbl.runs.map((r) => r.inkWidth));
      const sx = tile ? rx : rx + Math.max(0, (maxW - blockW) / 2);
      const lblX = (r) => (tile ? sx : sx + (L.total - r.inkWidth) / 2);
      const ox = L.pre ? sx - L.pre.inkLeft : sx - (L.cw - f0.inkWidth) / 2;
      const numX0 = ox + (L.pre ? L.pre.advance + L.gapS : 0);
      const rightEdge = numX0 + L.numW + (L.suf ? L.gapS + L.suf.inkRight : 0);
      const ulH = Math.max(3, Math.round(7 * unit));
      const gUL = Math.round(cap * 0.16), gLbl = Math.round(cap * 0.18 + lbl.cap * 0.9);
      const blockH = cap + gUL + ulH + gLbl + (lbl.runs.length - 1) * lblPitch;
      const y0 = Math.round(centreY - blockH / 2);
      const base = y0 + cap, ulY = base + gUL, lblB = ulY + ulH + gLbl;
      const lblLines = lbl.runs.map((r, i) => place(r, lblX(r), lblB + i * lblPitch));
      const c0 = 0.4, cd = 1.6, tL = 0.85;
      const cellX = [];
      { let x = numX0; for (const c of L.cells) { cellX.push(x); x += c; } }
      const dRuns = new Map();
      const dRun = (ch) => { if (!dRuns.has(ch)) dRuns.set(ch, L.run(ch)); return dRuns.get(ch); };
      // a stat that holds > 4 s keeps moving: a slow 1.00 -> 1.04 push of the whole block about its centre
      // it is deliberate slow motion, so it obeys params.drift like the tile/ground drift: drift 0 = off (the settle contract), default 0.012 -> 4 %
      const pushAmt = D > 4 ? K.clamp(params.drift ?? 0, 0, 0.04) * (0.04 / 0.012) : 0;
      M = {
        push: pushAmt ? { cx: sx + blockW / 2, cy: y0 + blockH / 2, amt: pushAmt, t0: c0 } : null,
        endT: c0 + cd + 0.4 + HOLD,
        reg(k) {
          regText('value', { box: { x0: sx, y0: base - cap, x1: rightEdge, y1: base }, size: cap, fg: P.primary, bg: GROUND });
          lblLines.forEach((l, i) => regQ(`label ${i + 1}`, l, FG));
          hit(c0 * k, 'count start'); hit((c0 + cd) * k, 'count lands'); hit(tL * k, 'label');
          settle('value', 0.1 * k, SOFT); settle('count', (c0 + cd) * k, { f: 50, z: 1 });
          lblLines.forEach((l, i) => settle(`label ${i + 1}`, (tL + i * 0.09) * k));
          return [0.05, (c0 + 0.25) * k, (c0 + 0.6) * k, (tL + 0.2) * k, (c0 + cd * 0.75) * k, (c0 + cd + 0.1) * k, (c0 + cd + 0.5) * k, D * 0.85, D - 1 / fps];
        },
        draw(g, t, k) {
          const p = K.clamp((q(t) - c0 * k) / (cd * k));
          const prog = 1 - Math.pow(1 - p, 4); // ease out, lands exactly
          const cur = fmt(p >= 1 ? target : Math.round(target * prog * 10 ** decimals) / 10 ** decimals);
          const aIn = K.clamp(sp(t, 0.1 * k, SOFT) * 1.6);
          const dy = (1 - aIn) * 14 * unit;
          // right-aligned inside the final cell layout: digit positions never move
          const chars = [...cur], off = L.cells.length - chars.length;
          chars.forEach((ch, i) => {
            const ci = off + i;
            if (ci < 0 || ch === ' ') return;
            const r = dRun(ch);
            K.drawRun(g, r, cellX[ci] + L.cells[ci] / 2 - (r.inkLeft + r.inkRight) / 2, base + dy, { fill: P.primary, alpha: aIn });
          });
          if (L.pre) K.drawRun(g, L.pre, ox, base + dy, { fill: P.primary, alpha: aIn });
          if (L.suf) K.drawRun(g, L.suf, numX0 + L.numW + L.gapS, base + dy, { fill: P.primary, alpha: aIn });
          // the one signal: an underline that measures the count
          const ulW = (rightEdge - sx) * prog;
          if (ulW > 0.5 && aIn > 0) K.bar(g, sx, ulY, ulW, ulH, P.accent);
          lblLines.forEach((l, i) => riseRun(g, l, lbl.cap, () => sp(t, (tL + i * 0.09) * k), FG));
        },
      };
    }

    // ═════════════ CTA ═════════════
    if (mode === 'cta') {
      const bCap = (vert ? 40 : 34) * unit, bH = Math.round((vert ? 128 : 112) * unit), bPad = Math.round(bH * 0.48);
      const blab = K.shape(fD, C.cta, { size: sz(fD, bCap), tracking: 0 });
      const bW = Math.round(bPad * 2 + blab.inkWidth);
      const uCap = (vert ? 32 : 28) * unit;
      const url = C.url ? K.shape(fT, C.url, { size: sz(fT, uCap), tracking: 10 }) : null;
      const dotR = 5.5 * unit;
      const beside = !!url && bW + 44 * unit + dotR * 2 + 16 * unit + url.inkWidth <= maxW;
      // the lockup never exceeds the column (a wide wordmark scales down to fit)
      if (logo && inBlockLogo && logo.w > maxW * 0.9) { const k2 = (maxW * 0.9) / logo.w; logo.w = Math.round(logo.w * k2); logo.h = Math.round(logo.h * k2); }
      const urlDrop = Math.round(uCap * 2.6);
      // the whole block (lockup + headline + button) must fit its region: the headline gives way first
      let capTop = (land ? 140 : vert ? 146 : 124) * unit * S, fit, cap, pitch, logoGap, gH, blockH;
      for (let it = 0; it < 14; it++) {
        fit = fitLines(fD, C.headline, maxW, capTop, vert ? 4 : 3, -22, 52 * unit, vert ? 3 : 2);
        cap = fit.cap; pitch = cap * 1.36;
        logoGap = logo && inBlockLogo ? Math.round(cap * 0.8) : 0;
        gH = Math.round(cap * 0.9);
        blockH = (logo && inBlockLogo ? logo.h + logoGap : 0) + cap + (fit.runs.length - 1) * pitch + gH + bH + (url && !beside ? urlDrop : 0);
        if (blockH <= region.h || capTop <= 52 * unit) break;
        capTop = Math.max(52 * unit, Math.min(capTop * 0.93, cap * 0.97));
      }
      if (blockH > region.h + 1) qa.warn(`brand-card cta: block ${Math.round(blockH)} px is taller than its ${Math.round(region.h)} px region — shorten the headline`);
      const y0 = Math.round(centreY - blockH / 2);
      if (logo && inBlockLogo) logo.box = { x: rx, y: y0, w: logo.w, h: logo.h };
      const hy = y0 + (logo && inBlockLogo ? logo.h + logoGap : 0);
      const lines = fit.runs.map((r, i) => ({ ...place(r, rx, hy + cap + i * pitch), wm: wordMap(r) }));
      const by = hy + cap + (fit.runs.length - 1) * pitch + gH;
      const uBase = beside ? by + bH / 2 + uCap / 2 : by + bH + urlDrop - uCap * 0.5;
      const uX = (beside ? rx + bW + 44 * unit : rx) + dotR * 2 + 16 * unit;
      const nW = lines.reduce((a, l) => a + l.wm.n, 0);
      const tH = 0.35, wStep = 0.085, tB = tH + nW * wStep + 0.3, tU = tB + 0.3;
      M = {
        endT: tU + 0.9 + HOLD,
        reg(k) {
          lines.forEach((l, i) => regQ(`headline ${i + 1}`, l, FG));
          regText('button', { box: K.runBox(blab, rx + bPad - blab.inkLeft, by + bH / 2 + bCap / 2), size: blab.capPx, fg: P.paper, bg: P.primary });
          typeBoxes.push({ label: 'button plate', box: { x0: rx, y0: by, x1: rx + bW, y1: by + bH } });
          if (url) regQ('url', place(url, uX, uBase), SUB);
          hit(tH * k, 'headline'); hit(tB * k, 'button'); if (url) hit(tU * k, 'url');
          settle('headline', (tH + nW * wStep) * k); settle('button', tB * k, { f: 2.6, z: 0.9 }); if (url) settle('url', tU * k, SOFT);
          return [0.05, (tH + 0.15) * k, (tH + 0.5) * k, (tB + 0.1) * k, (tB + 0.45) * k, (tU + 0.2) * k, (tU + 0.7) * k, D * 0.85, D - 1 / fps];
        },
        draw(g, t, k) {
          let off = 0;
          lines.forEach((l) => {
            const o = off;
            riseRun(g, l, cap, (it) => sp(t, (tH + (o + l.wm.mp.get(it)) * wStep) * k), FG);
            off += l.wm.n;
          });
          const p = sp(t, tB * k, { f: 2.6, z: 0.9 });
          if (p > 0) {
            g.save();
            g.globalAlpha = K.clamp(p * 2);
            g.translate(rx + bW / 2, by + bH / 2);
            const s = 0.94 + 0.06 * p;
            g.scale(s, s);
            g.translate(-bW / 2, -bH / 2);
            g.beginPath(); g.roundRect(0, 0, bW, bH, bH * 0.3);
            g.fillStyle = P.primary;
            g.fill();
            K.drawRun(g, blab, bPad - blab.inkLeft, bH / 2 + bCap / 2, { fill: P.paper });
            g.restore();
          }
          if (url) {
            const pu = sp(t, tU * k, SOFT);
            dot(g, uX - 16 * unit - dotR, uBase - uCap / 2, dotR, P.accent, K.clamp(pu * 1.3));
            fadeUp(g, url, uX, uBase, pu, 8 * unit, SUB);
          }
        },
      };
    }

    // ───────── time scale: always keep a still hold at the end ─────────
    const k = Math.min(1, Math.max(0.35, D / M.endT));
    const kf = M.reg(k);
    if (logo && !logo.box) logo.box = { x: mx, y: topY, w: logo.w, h: logo.h };
    if (logo) { qa.hit(0.1 * k, 'logo'); settle('logo', 0.1 * k, SOFT, logo.box); }
    const tTile = 0.25 * k;
    if (tile) { qa.hit(tTile, 'product'); settle('product', tTile, TILE, { x: tile.x, y: tile.y, w: tile.w, h: tile.h }); kf.push(tTile + 0.35); }
    const tFoot = Math.min(0, D * 0.45); // the demo/pilot label is on screen from the first frame (film polish lane 3)
    if (foot) {
      const fb = place(foot, mx, footBase);
      regText('footnote', { box: K.runBox(fb.run, fb.x, fb.base), size: fCap, fg: SUB, bg: GROUND });
      qa.hit(tFoot, 'footnote');
      settle('footnote', tFoot, SOFT);
    }
    // QA: type never touches the product tile (the tile only ever animates away from the type: it rises from below)
    if (tile) {
      if (logo) typeBoxes.push({ label: 'logo', box: { x0: logo.box.x, y0: logo.box.y, x1: logo.box.x + logo.box.w, y1: logo.box.y + logo.box.h } });
      const gd = Math.max(tile.w, tile.h) * K.clamp(params.drift ?? 0, 0, 0.04) / 2; // the tile's end-of-shot growth
      const hits = typeBoxes.filter(({ box: b }) => b.x0 < tile.x + tile.w + gd && b.x1 > tile.x - gd && b.y0 < tile.y + tile.h + gd && b.y1 > tile.y - gd);
      qa.check('type-clear-of-tile', hits.length ? 'fail' : 'pass',
        hits.length ? `${hits.length} box(es) intersect the product tile: ${hits.map((h) => h.label).join(', ')}` : `${typeBoxes.length} text boxes (text, button plate, logo) clear of the product tile`,
        hits.length ? hits.map((h) => ({ label: h.label, box: h.box, tile: { x0: tile.x, y0: tile.y, x1: tile.x + tile.w, y1: tile.y + tile.h } })) : undefined);
    }
    [...new Set(kf.map((x) => Math.max(0, Math.min(D - 1 / fps, Math.round(x * fps) / fps))))].sort((a, b) => a - b).forEach((t, i) => qa.keyframe(t, `kf ${i + 1}`));
    // the final composition must be still before the closing hold
    const lastSettle = Math.max(...elements.map((e) => e.until));
    if (lastSettle > D - 0.25) qa.warn(`brand-card: elements still settling at ${lastSettle.toFixed(2)}s of ${D.toFixed(2)}s (${elements.filter((e) => e.until > D - 0.25).map((e) => e.id).join(', ')}) — raise duration`);
    qa.note(`brand-card ${mode}: ${elements.length} elements, all settled by ${lastSettle.toFixed(2)}s; final hold from there to ${D.toFixed(2)}s`);
    const grainAmt = Math.min(0.03, params.grain ?? 0.02);
    // slow drift of the tile and the ground (never the type): u runs 0..1 over the whole shot
    const drift = K.clamp(params.drift ?? 0, 0, 0.04);
    const driftU = (t) => K.clamp(t / D);
    // QA: a settled composition with nothing moving for more than 5 s is a frozen picture
    {
      const moving = (drift > 0 && (tile || night)) || !!M.push;
      const still = D - lastSettle;
      qa.check('static-hold', still > 5 && !moving ? 'warn' : 'pass',
        still > 5 && !moving ? `${still.toFixed(1)}s after the last element settles nothing moves (no product tile or night ground to drift, or params.drift 0): shorten the shot or add a product tile` : moving ? `tile/ground drift ${(drift * 100).toFixed(1)} % over ${D.toFixed(1)}s: no frame group is identical for more than 5 s` : `only ${Math.max(0, still).toFixed(1)}s of settled hold (limit 5 s)`);
    }

    // product tile drawing (same frame, colours and shadow as ui-demo)
    const frameColors = { body: night ? '#05070B' : P.ink, rim: K.rgba(P.paper, 0.16), chrome: K.mix(P.bg, P.paper, 0.5), chromeLine: K.rgba(P.mute, 0.16), empty: P.paper };
    P.chromeTile = frameColors.chrome; // derived token: browser title bar of the product tile
    if (tile?.urlRun) {
      // the tile's URL label is ours (the captured UI is not): P.mute on the tile's title bar
      const ratio = K.contrast(P.mute, frameColors.chrome);
      qa.check('overlay-contrast', ratio < 4.5 ? 'fail' : 'pass', ratio < 4.5 ? `tile URL label ${ratio.toFixed(2)}:1 on its title bar (needs 4.5:1)` : `tile URL label ${ratio.toFixed(2)}:1 on its title bar`);
    }
    function drawTile(g, t) {
      const p = sp(t, tTile, TILE);
      if (p <= 0) return;
      const dy = (1 - p) * 48 * unit, sc = (0.965 + 0.035 * p) * (1 + drift * driftU(t));
      g.save();
      g.globalAlpha = K.clamp(p * 1.6);
      g.translate(tile.x + tile.w / 2, tile.y + tile.h / 2 + dy);
      g.scale(sc, sc);
      g.translate(-tile.w / 2, -tile.h / 2);
      X.drawFrameShadow(g, { x: 0, y: 0, w: tile.w, h: tile.h }, (tile.kind === 'phone' ? X.FRAME.phoneR : X.FRAME.radius) * tile.s, unit * 0.8 * (ctx.renderScale || 1), night ? 1.8 : 1);
      g.translate(-tile.win.x * tile.s, -tile.win.y * tile.s);
      g.scale(tile.s, tile.s);
      const bmp = ctx.media.captureFrame(tile.id, tile.idx);
      const d = tile.dsf;
      X.drawFrame(g, {
        kind: tile.kind, vw: tile.cr.w, vh: tile.cr.h, colors: frameColors, scale: tile.s,
        src: bmp ? { bmp, sx: tile.cr.x * d, sy: tile.cr.y * d, sw: tile.cr.w * d, sh: tile.cr.h * d } : null,
        chrome: (cg) => {
          cg.fillStyle = K.rgba(P.mute, 0.32);
          for (let i = 0; i < 3; i++) { cg.beginPath(); cg.arc(20 + i * 19, -X.FRAME.chromeH / 2, 6, 0, Math.PI * 2); cg.fill(); }
          if (tile.urlRun) K.drawRun(cg, tile.urlRun, tile.cr.w / 2, -X.FRAME.chromeH / 2 + tile.urlRun.capPx / 2, { align: 'center', fill: P.mute });
        },
      });
      g.restore();
    }
    const tileView = () => ({ x: tile.vx, y: tile.vy, w: tile.cr.w * tile.s, h: tile.cr.h * tile.s });

    return {
      duration: D,
      elements, // [{id, t0, until, box?}] — what settles when (tests + QA)
      ...(tile ? { mediaNeeds: () => [{ id: tile.id, idx: tile.idx }] } : {}),
      qaExempt(t) {
        const r = [];
        if (logo) r.push({ x: logo.box.x - 2, y: logo.box.y - 14 * unit, w: logo.box.w + 4, h: logo.box.h + 16 * unit });
        if (tile) { const v = tileView(); const gw = v.w * drift; r.push({ x: v.x - 2 - gw, y: v.y - 2 - gw, w: v.w + 4 + 2 * gw, h: v.h + 52 * unit + 2 * gw }); }
        return r;
      },
      post(g, t) {
        if (grainAmt > 0) K.grain(g, W, H, { seed: 7, frame: Math.round(q(t) * fps), amount: grainAmt, mode: 'overlay' });
      },
      draw(g, t) {
        g.fillStyle = GROUND;
        g.fillRect(0, 0, W, H);
        if (night) {
          // the brand's night: a breath of light toward the type, darker edges
          const gr = g.createRadialGradient(W * (tile && land ? 0.3 : 0.4) + W * 1.5 * drift * driftU(t), H * 0.4, Math.min(W, H) * 0.05, W / 2, H / 2, Math.hypot(W, H) * 0.62);
          gr.addColorStop(0, K.rgba(P.paper, 0.06));
          gr.addColorStop(0.55, K.rgba(P.paper, 0));
          gr.addColorStop(1, 'rgba(0,0,0,0.3)');
          g.fillStyle = gr;
          g.fillRect(0, 0, W, H);
        }
        if (tile) drawTile(g, t);
        if (logo) {
          const p = sp(t, 0.1 * k, SOFT);
          if (p > 0) {
            g.save();
            g.globalAlpha = K.clamp(p * 1.4);
            logo.m.draw(g, t, { x: logo.box.x, y: logo.box.y + (1 - p) * 12 * unit, w: logo.box.w, h: logo.box.h }, { fit: 'contain', focusX: 0 });
            g.restore();
          }
        }
        if (M.push) {
          const { cx, cy, amt, t0 } = M.push, sc = 1 + amt * K.cubicInOut(K.clamp((t - t0 * k) / Math.max(0.1, D - t0 * k)));
          g.save(); g.translate(cx, cy); g.scale(sc, sc); g.translate(-cx, -cy);
          M.draw(g, t, k);
          g.restore();
        } else M.draw(g, t, k);
        if (foot) fadeUp(g, foot, mx, footBase, sp(t, tFoot, SOFT), 6 * unit, SUB);
      },
    };
  },
};
