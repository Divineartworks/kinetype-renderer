// STREET POSTER — kinetic identity bumper.
// A street-poster that moves: justified display blocks, a scramble-to-grid
// thesis, a zoom-through-the-letterform mask cut, a typed prompt that gets
// struck out and becomes an underline, and an L-bracket lockup that loops
// seamlessly (frame 0 IS the lockup; the cold open shoves it off).
//
// Structure is authored in BEATS, so tempo/duration changes re-time everything.
import * as K from '../../src/kit/index.js';

const SECTIONS = { open: 0, thesisA: 5, thesisB: 13, proof: 21, cta: 27, brand: 29, settle: 35, end: 40 };
const STYLES = ['poster', 'brutal-mono', 'acid-rave'];
// per-style defaults, applied only where the spec did not set the token/param
const STYLE_PALETTE = {
  poster: {},
  'brutal-mono': { bg: '#ECEBE6', ink: '#111111', a: '#111111', b: '#D83200' },
  'acid-rave': { bg: '#0A0A0A', ink: '#F5F5F5', a: '#B8FF00', b: '#FF2BD6' },
};
const STYLE_PARAMS = {
  poster: {},
  // no smear, no misregistration, no punches: type lands dead still, like a stencil
  'brutal-mono': { misregister: 0, smear: false, punch: 1, waveform: false },
  // everything louder: wide misregistration, deep punches, the camera kicks on every impact
  'acid-rave': { misregister: 6, punch: 1.12 },
};

export default {
  id: 'street-poster',
  version: '1.1.0',
  name: 'Street Poster',
  description:
    'Loopable kinetic identity bumper: slam open, scramble-to-grid thesis, glyph-outline mask cut, typed prompt struck through into an underline, L-bracket handle lockup. 40 beats (20s at 120 BPM).',
  tags: ['bumper', 'identity', 'loop', 'poster', 'bold', 'social'],
  formats: ['square', 'portrait', 'vertical', 'landscape'],
  bpm: 120,
  duration: 20,
  loop: true,
  palette: { bg: '#0A0A0A', a: '#FF2BD6', b: '#B8FF00', ink: '#F5F5F5' },
  paletteRoles: { bg: 'background', a: 'primary accent (smear, highlight, brand bar)', b: 'secondary accent (waveform, strike/underline rule)', ink: 'readable type' },
  fonts: {
    display: { family: 'Archivo Black', weight: 400 },
    grotesk: { family: 'Syne', weight: 800 },
    mono: { family: 'IBM Plex Mono', weight: 500 },
  },
  params: {
    style: 'poster',
    tracking: { display: -60, grotesk: -40, mono: 20 },
    misregister: 3,
    punch: 1.08,
    smear: true,
    labels: true,
    waveform: true,
  },
  schema: {
    content: {
      type: 'object',
      additionalProperties: false,
      required: ['open', 'thesisA', 'thesisB', 'proof', 'cta', 'handle'],
      properties: {
        open: { type: 'string', maxLength: 28, description: 'Cold-open slam, 1–3 words. First word is set huge.' },
        thesisA: { type: 'string', maxLength: 40, description: 'Thesis, up to 4 words; the LAST word is the scream line, a contraction/negation word is highlighted.' },
        thesisB: { type: 'string', maxLength: 32, description: 'Counter-thesis, 2–4 words; the last word lands alone in the accent colour.' },
        proof: { type: 'string', maxLength: 32, description: 'Rapid stack, "A > B" style; tokens stack one per beat.' },
        prompt: { type: 'array', maxItems: 3, items: { type: 'string', maxLength: 24 }, description: 'Up to 3 mono lines typed in the terminal block.' },
        cta: { type: 'string', maxLength: 28, description: 'Call to action; last word is underlined by the rule.' },
        handle: { type: 'string', maxLength: 18, description: 'Brand handle for the lockup.' },
        crumbs: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 18 }, description: 'Mono crumbs orbiting the terminal block and ticking in corners.' },
        highlight: { type: 'string', description: 'Word of thesisA to highlight (default: first word containing an apostrophe or NOT/NO)' },
      },
    },
    params: {
      type: 'object',
      additionalProperties: false,
      properties: {
        tracking: { type: 'object', properties: { display: { type: 'number' }, grotesk: { type: 'number' }, mono: { type: 'number' } }, additionalProperties: false },
        style: { enum: STYLES, description: 'poster (magenta/acid street poster: smear, misregistration, punches) | brutal-mono (paper ground, black stencil type, mono secondary lines, no smear/punch — dead-still landings, one red accent) | acid-rave (acid-green lead accent, 2x misregistration, deep punches, the camera kicks a few degrees on every impact)' },
        misregister: { type: 'number', minimum: 0, maximum: 8, description: 'Print misregistration offset in px on impact frames' },
        punch: { type: 'number', minimum: 1, maximum: 1.3, description: 'Camera punch-in zoom' },
        smear: { type: 'boolean' },
        labels: { type: 'boolean', description: 'Corner mono labels (section / timecode / crumb / bpm)' },
        waveform: { type: 'boolean' },
      },
    },
  },
  example: {
    template: 'street-poster',
    format: 'square',
    rules: { beatCoverage: { dense: 16, then: 2, until: 35 }, loopExact: true },
    fps: 60,
    duration: 20,
    loop: true,
    bpm: 120,
    seed: 7,
    content: {
      open: 'STOP SCROLLING',
      thesisA: 'AI VIDEO ISN’T EXPENSIVE',
      thesisB: 'BAD PROMPTING IS',
      proof: 'WORKFLOWS > WISHES',
      prompt: ['> MODEL: SEEDANCE', '> KEYFRAMES: 0', '> UPSCALE: MAGNIFIC'],
      cta: 'STEAL THE PROMPT',
      handle: '@ TECHHALLA',
      crumbs: ['JSON', 'H3', 'SEEDANCE', '0 KEYFRAMES', 'MAGNIFIC', 'COPY/PASTE'],
    },
  },

  build(ctx) {
    const { W, H, palette: P, params, content: C, fonts, beat, seed, qa, fps } = ctx;
    const style = STYLES.includes(params.style) ? params.style : 'poster';
    const userPal = ctx.spec.palette || {}, userPar = ctx.spec.params || {};
    for (const [k, v] of Object.entries(STYLE_PALETTE[style])) if (!(k in userPal)) P[k] = v;
    for (const [k, v] of Object.entries(STYLE_PARAMS[style])) if (!(k in userPar)) params[k] = v;
    const brutal = style === 'brutal-mono', acid = style === 'acid-rave';
    const totalBeats = Math.round((ctx.duration * beat.bpm) / 60);
    const bs = totalBeats / SECTIONS.end; // beat scale if duration/bpm differ from 40 beats
    const B = (n) => beat.t(n * bs); // section beat → seconds
    const S16 = (beat.spb * bs) / 4; // one sixteenth
    const D = ctx.duration;
    const fD = fonts.get('display'), fG = brutal ? fonts.get('mono') : fonts.get('grotesk'), fM = fonts.get('mono');
    const tr = brutal && !(userPar.tracking && 'grotesk' in userPar.tracking) ? { ...params.tracking, grotesk: -30 } : params.tracking;
    const M = Math.round(Math.min(W, H) * 0.0667); // 72 @1080
    // Vertical (Shorts/Reels/TikTok): content lives in the platform-safe box —
    // clear of the right-hand action rail and the bottom caption area.
    const tall = ctx.aspect === 'vertical';
    const MR = tall ? Math.round(W * 0.14) : M;
    const IW = W - M - MR;
    const cx = M + IW / 2, cy = tall ? Math.round(H * 0.45) : H / 2;
    const labBottom = tall ? Math.round(H * 0.8) : H - M;
    const unit = Math.min(W, H) / 1080;
    const q = (t) => K.frameQuant(t, fps); // discrete state changes on frame boundaries
    const disp = (text, size, o = {}) => K.shape(fD, text, { size, tracking: tr.display, capSymbols: true, ...o });
    const grot = (text, size, o = {}) => K.shape(fG, text, { size, tracking: tr.grotesk, capSymbols: true, ...o });
    const mono = (text, size = 18 * unit, o = {}) => K.shape(fM, text, { size, tracking: tr.mono, kerning: 'metric', ...o });
    const fitD = (text, w, o = {}) => disp(text, K.fitSize(fD, text, w, { tracking: tr.display, capSymbols: true, ...o }), o);
    const fitG = (text, w, o = {}) => grot(text, K.fitSize(fG, text, w, { tracking: tr.grotesk, capSymbols: true, ...o }), o);
    const words = (s) => s.trim().split(/\s+/);
    const hit = (t, label) => qa.hit(t, label);
    const zoomAbout = (g, z, x = cx, y = cy) => { g.translate(x, y); g.scale(z, z); g.translate(-x, -y); };

    // Impact frames: misregistration fires on the 4 frames after each impact only.
    const impacts = [];
    const impact = (t, label) => { impacts.push(t); hit(t, label); };
    const misAmt = (t) => {
      let a = 0;
      for (const ti of impacts) {
        const d = t - ti;
        if (d >= 0 && d < 4 / fps) a = Math.max(a, d < 2 / fps ? 1 : 0.6);
      }
      return a;
    };
    const ink = P.ink, A = P.a, Bc = P.b, grey = brutal ? '#62625E' : '#8C8C8C';
    const withMis = (g, t, draw) => K.misregister(g, draw, { a: A, b: Bc, amount: misAmt(t), offset: params.misregister * unit, alpha: 0.4 });

    // ───────────────────────── BRAND LOCKUP (also frame 0) ─────────────────────────
    const tBrand = B(SECTIONS.brand), tSettle = B(SECTIONS.settle);
    const hRun = fitD(C.handle, IW * (W > H * 1.2 ? 0.6 : 0.78));
    const cap = hRun.capPx;
    const barW = Math.round(cap * 0.3), barGap = Math.round(cap * 0.3);
    const ruleH = Math.max(4, Math.round(cap * 0.075));
    const lockW = barW + barGap + hRun.inkWidth;
    const lockLeft = cx - lockW / 2;
    const hX = lockLeft + barW + barGap - hRun.inkLeft; // pen x
    const hBase = K.snap(cy + cap * 0.62, 8);
    const barX = lockLeft, barTop = hBase - cap * 1.72, barBot = hBase + cap * 0.46;
    const ruleY = barBot - ruleH, ruleX1 = hX + hRun.inkRight;
    const hIn = hRun.inked.map((_, k) => B(SECTIONS.brand) + k * S16 * 0.5);
    const barGrow = new K.Track(0).spring(B(SECTIONS.brand + 1), 1, 'heavy');
    const ruleGrow = new K.Track(0).spring(B(SECTIONS.brand + 2), 1, 'lock');
    impact(B(SECTIONS.brand), 'handle slam');
    hit(B(SECTIONS.brand + 1), 'brand bar');
    hit(B(SECTIONS.brand + 2), 'green rule');
    impact(B(SECTIONS.brand + 3), 'lockup accent');
    const brandZoom = new K.Track(1).spring(B(SECTIONS.brand + 3), 1 + (params.punch - 1) * 0.6, 'slam').spring(B(SECTIONS.brand + 5), 1, 'glide');
    hit(B(SECTIONS.brand + 5), 'settle');
    const breathEnd = B(SECTIONS.end - 0.5);
    const breath = (t) => (t <= tSettle || t >= breathEnd ? 1 : 1 + 0.012 * Math.sin(Math.PI * K.cubicInOut((t - tSettle) / (breathEnd - tSettle))));
    qa.text('handle', { box: K.runBox(hRun, hX, hBase), size: cap, fg: ink, bg: P.bg });
    qa.note(`lockup settles exactly at ${breathEnd.toFixed(3)}s; frames after it are identical to frame 0`);

    function drawBrand(g, t, dy = 0) {
      g.save();
      g.translate(0, dy);
      zoomAbout(g, breath(t) * brandZoom.at(t));
      withMis(g, t, (fill) => {
        const gb = barGrow.at(t);
        if (gb > 0) K.bar(g, barX, barBot - (barBot - barTop) * gb, barW, (barBot - barTop) * gb, fill ?? A);
        const gr = ruleGrow.at(t);
        if (gr > 0) K.bar(g, barX, ruleY, (ruleX1 - barX) * gr, ruleH, fill ?? Bc);
        K.drawRun(g, hRun, hX, hBase, {
          fill: fill ?? ink,
          each: (it, k) => {
            const p = K.springStep(t - hIn[k], 2.8, 0.62);
            const o = K.springStep(t - hIn[k], 7, 1);
            return { dy: (1 - p) * cap * 1.6, alpha: K.clamp(o), blur: (1 - K.clamp(o)) * 8 * unit };
          },
        });
      });
      g.restore();
    }

    // ───────────────────────── 1. COLD OPEN ─────────────────────────
    const ow = words(C.open);
    const o1 = fitD(ow[0], IW), o2 = ow.length > 1 ? fitD(ow.slice(1).join(' '), IW) : null;
    const oRuns = o2 ? [o1, o2] : [o1];
    const oGap = Math.round(30 * unit);
    const oBases = K.stackInk(oRuns, { top: K.snap(cy - K.stackHeight(oRuns, oGap) / 2 - 24 * unit, 8), gap: oGap });
    const oX = (run) => M - run.inkLeft;
    const oStarts = [o1.inked.map((_, k) => B(0) + k * S16), o2 ? o2.inked.map((_, k) => B(1) + k * S16) : []];
    impact(B(0), 'open slam');
    hit(B(1), 'open line 2');
    hit(B(2), 'waveform');
    impact(B(3), 'open impact');
    const openZoom = new K.Track(1).spring(B(4), params.punch, 'slam');
    hit(B(4), 'punch-in');
    oRuns.forEach((r, i) => qa.text('open-' + i, { box: K.runBox(r, oX(r), oBases[i]), size: r.capPx, fg: ink, bg: P.bg }));
    const riseFrom = H - oBases[0] + o1.capPx + 60 * unit;
    const slamY = (t, t0) => (1 - K.springStep(t - t0, 2.3, 0.6)) * riseFrom;
    const waveY = oBases[oBases.length - 1] + Math.round(40 * unit);

    function drawSlamRun(g, t, run, x, base, starts) {
      const state = (tt, k) => {
        const d = tt - starts[k];
        return { dy: slamY(tt, starts[k]), alpha: K.clamp(K.springStep(d, 9, 1)), blur: (1 - K.springStep(d, 4.5, 1)) * 6 * unit };
      };
      if (params.smear) {
        // magenta smear: the glyph's own recent past, sampled back in time
        const N = 10;
        for (let s = N; s >= 1; s--) {
          const tb = t - s / 150;
          K.drawRun(g, run, x, base, {
            fill: A,
            each: (it, k) => {
              if (tb < starts[k]) return { hidden: true };
              const now = slamY(t, starts[k]), past = slamY(tb, starts[k]);
              const v = past - now; // px travelled since tb (up = positive)
              if (v < 8 * unit) return { hidden: true };
              return { dy: past, alpha: 0.34 * (1 - (s - 1) / N) * K.clamp(v / (80 * unit)), sy: 1 + Math.min(0.5, v / (700 * unit)) };
            },
          });
        }
      }
      withMis(g, t, (fill) => K.drawRun(g, run, x, base, { fill: fill ?? ink, each: (it, k) => (t < starts[k] ? { hidden: true } : state(t, k)) }));
    }

    function drawWaveform(g, t) {
      if (!params.waveform) return;
      const t0 = B(2), t1 = B(4.5);
      if (t < t0) return;
      const sweep = K.quartOut(K.clamp((t - t0) / (t1 - t0)));
      const step = 12 * unit;
      const n = Math.floor(IW / step);
      const pulse = beat.pulse(t, 0.5, 9);
      for (let i = 0; i <= Math.floor(n * sweep); i++) {
        const r = K.noise1(seed, 'wave', i);
        const env = 0.3 + 0.7 * Math.abs(Math.sin(i * 0.37 + r * 2.1)) * (0.6 + 0.4 * Math.sin(i * 0.11));
        const h = Math.round((6 + 30 * env * (0.5 + 0.5 * pulse)) * unit);
        K.bar(g, M + i * step, waveY - h, (i % 8 === 0 ? 4 : 2) * unit, h, Bc);
      }
      K.bar(g, M, waveY, IW * sweep, 3 * unit, Bc);
    }

    function drawOpen(g, t) {
      g.save();
      zoomAbout(g, openZoom.at(t));
      drawWaveform(g, t);
      oRuns.forEach((r, i) => drawSlamRun(g, t, r, oX(r), oBases[i], oStarts[i]));
      g.restore();
    }

    // ───────────────────────── 2. THESIS A — scramble, snap to the grid ─────────────────────────
    const tA = B(SECTIONS.thesisA), tB = B(SECTIONS.thesisB);
    hit(tA, 'smash-pan');
    const ta = words(C.thesisA);
    const hiWord = C.highlight || ta.slice(0, -1).find((w) => /[’']|^NOT$|^NO$/i.test(w));
    const hiIdx = hiWord ? ta.indexOf(hiWord) : -1;
    const aLines = [];
    const leadEnd = hiIdx >= 0 ? hiIdx : ta.length - 1;
    if (leadEnd > 0) {
      // tall frames: one word per line, so the stack uses the height
      if (tall) ta.slice(0, leadEnd).forEach((w) => aLines.push({ text: w, font: 'g' }));
      else aLines.push({ text: ta.slice(0, leadEnd).join(' '), font: 'g' });
    }
    if (hiIdx >= 0) aLines.push({ text: hiWord, font: 'd', hi: true });
    aLines.push({ text: ta[ta.length - 1], font: 'd' });
    const aRuns = aLines.map((l) => (l.font === 'g' ? fitG(l.text, IW * (tall ? Math.min(0.9, 0.2 * l.text.length) : 0.9)) : l.hi ? fitD(l.text, IW * (tall ? 0.8 : 0.62)) : fitD(l.text, IW)));
    const hiPad = (r) => r.capPx * 0.16;
    const aGaps = aRuns.map((r, i) => 26 * unit + (aLines[i].hi || aLines[i + 1]?.hi ? hiPad(aLines[i].hi ? r : aRuns[i + 1]) : 0));
    const aH = K.stackHeight(aRuns, 0, aGaps);
    const aBases = K.stackInk(aRuns, { top: K.snap(cy - aH / 2, 8), gaps: aGaps });
    const aLock = aRuns.map((_, i) => B(SECTIONS.thesisA + 1 + i));
    aLock.forEach((t, i) => (i === aRuns.length - 1 ? impact(t, 'thesis snap') : hit(t, 'thesis snap')));
    const hiBarT = B(SECTIONS.thesisA + 4);
    hit(hiBarT, 'highlight bar');
    const aSqueeze = new K.Track(0).spring(B(SECTIONS.thesisA + 5), 1, 'snap');
    hit(B(SECTIONS.thesisA + 5), 'squeeze');
    const aZoom = new K.Track(1).spring(B(SECTIONS.thesisA + 6), 1 + (params.punch - 1) * 0.75, 'slam');
    impact(B(SECTIONS.thesisA + 6), 'punch');
    hit(B(SECTIONS.thesisA + 7), 'label tick');
    const scrCharset = [...new Set(C.thesisA.replace(/[^A-Z0-9]/gi, '').toUpperCase() + '0123456789')].join('');
    aRuns.forEach((r, i) => qa.text('thesisA-' + i, { box: K.runBox(r, M - r.inkLeft, aBases[i]), size: r.capPx, fg: aLines[i].hi ? P.bg : ink, bg: aLines[i].hi ? A : P.bg }));

    function drawThesisA(g, t) {
      const tq = q(t);
      g.save();
      zoomAbout(g, aZoom.at(t));
      aRuns.forEach((run, i) => {
        const x = M - run.inkLeft, y = aBases[i], lockT = aLock[i], hi = aLines[i].hi;
        if (hi) {
          const p = K.springStep(t - hiBarT, 3.4, 0.82);
          if (p > 0) {
            const pad = hiPad(run);
            K.bar(g, M - pad, y - run.capPx - pad, (run.inkWidth + pad * 2) * p, run.capPx + pad * 2, A);
          }
        }
        const squeeze = i === aRuns.length - 1 ? aSqueeze.at(t) : 0;
        const fill = hi ? (t >= hiBarT + 0.06 ? P.bg : A) : ink;
        const center = (run.inkLeft + run.inkRight) / 2;
        withMis(g, t, (mf) => K.drawRun(g, run, x, y, {
          fill: mf ?? fill,
          each: (it, k) => {
            const locked = tq >= lockT;
            const pop = locked ? 1 + 0.1 * (1 - K.springStep(t - lockT, 4.5, 0.7)) : 1;
            const ch = K.scrambleChar(seed, `${i}:${k}`, it.ch, tq, lockT, { charset: scrCharset, step: S16 / 2, startAt: tA - 0.5 });
            return { ch, s: pop, dx: squeeze * ((it.ink.x0 + it.ink.x1) / 2 - center) * -0.035 };
          },
        }));
      });
      g.restore();
    }

    // ───────────────────────── 3. THESIS B — fly through the outgoing word ─────────────────────────
    const tb = words(C.thesisB);
    const bLast = tb[tb.length - 1];
    const bFirst = tb.length > 2 ? tb[0] : null;
    const bMid = tb.slice(bFirst ? 1 : 0, -1).join(' ');
    const bRuns = [];
    if (bFirst) bRuns.push({ run: fitD(bFirst, IW * 0.56), align: 'left', fill: ink, role: 'first' });
    if (bMid) bRuns.push({ run: fitD(bMid, IW), align: 'left', fill: ink, role: 'mid' });
    bRuns.push({ run: fitD(bLast, IW * (bLast.length <= 3 ? 0.4 : 0.7)), align: 'right', fill: A, role: 'last' });
    const bGap = Math.round(28 * unit);
    // short words fitted to a width can grow taller than the frame: scale the
    // whole stack down to fit (never triggers for copy that already fits)
    {
      const h0 = K.stackHeight(bRuns.map((r) => r.run), bGap), room = (H - 2 * M) * 0.9;
      if (h0 > room) for (const r of bRuns) r.run = K.shape(r.run.face, r.run.text, { size: r.run.size * (room / h0), tracking: tr.display, capSymbols: true });
    }
    const bBases = K.stackInk(bRuns.map((r) => r.run), { top: K.snap(cy - K.stackHeight(bRuns.map((r) => r.run), bGap) / 2, 8), gap: bGap });
    const bX = (r) => (r.align === 'right' ? W - MR - r.run.inkRight : M - r.run.inkLeft);
    const tMask = tB, maskDur = beat.spb * bs; // one beat
    impact(tMask, 'mask cut');
    const bMidIn = B(SECTIONS.thesisB + 1);
    hit(bMidIn, 'mid line');
    hit(B(SECTIONS.thesisB + 2), 'label tick');
    const bLastIn = B(SECTIONS.thesisB + 3);
    impact(bLastIn, 'last word slam');
    const bZoom = new K.Track(1).spring(bLastIn, params.punch, 'slam').spring(B(SECTIONS.thesisB + 5), 1.0, 'heavy');
    hit(B(SECTIONS.thesisB + 5), 'release');
    hit(B(SECTIONS.thesisB + 7), 'anticipate');
    bRuns.forEach((r, i) => qa.text('thesisB-' + i, { box: K.runBox(r.run, bX(r), bBases[i]), size: r.run.capPx, fg: r.fill, bg: P.bg }));

    // Focal point: the thickest horizontal cross-section inside the outgoing
    // scream line (for EXPENSIVE, the stem of the I). The camera flies into it.
    const outRun = aRuns[aRuns.length - 1];
    const outX = M - outRun.inkLeft, outY = aBases[aBases.length - 1];
    const outPath = K.runPath(outRun, outX, outY);
    let focal = { x: cx, y: outY - outRun.capPx / 2, w: 40 };
    {
      const oc = new OffscreenCanvas(8, 8).getContext('2d');
      let best = null;
      for (const f of [0.35, 0.5, 0.65]) {
        const y = outY - outRun.capPx * f;
        let start = null;
        for (let x = outX + outRun.inkLeft - 2; x <= outX + outRun.inkRight + 2; x += 1) {
          const inside = oc.isPointInPath(outPath, x, y, 'nonzero');
          if (inside && start === null) start = x;
          if (!inside && start !== null) {
            const w = x - start, mx = (start + x) / 2;
            const score = Math.min(w, outRun.capPx * 0.5) - Math.abs(mx - cx) * 0.04;
            if (!best || score > best.score) best = { x: mx, y, w, score };
            start = null;
          }
        }
      }
      if (best) focal = best;
    }
    const maskEnd = (Math.hypot(W, H) * 1.3) / Math.max(8, Math.min(focal.w, outRun.capPx) / 2);
    const flyScale = (t) => {
      const u = K.clamp((t - tMask) / maskDur);
      return Math.exp(Math.log(maskEnd) * (0.22 * u + 0.78 * u * u * u));
    };
    const r0 = bRuns[0], b0x = bX(r0);
    const bFocus = { x: b0x + (r0.run.inkLeft + r0.run.inkRight) / 2, y: bBases[0] - r0.run.capPx / 2 };
    qa.note(`mask focal ${focal.x.toFixed(0)},${focal.y.toFixed(0)} (cross-section ${focal.w.toFixed(0)}px)`);

    function drawThesisBContent(g, t, split = 0) {
      g.save();
      zoomAbout(g, bZoom.at(t));
      bRuns.forEach((r, i) => {
        const x = bX(r), y = bBases[i];
        const o = { fill: r.fill };
        if (r.role === 'last') {
          if (t < bLastIn) return;
          const p = K.springStep(t - bLastIn, 2.6, 0.58);
          o.group = { s: 1 + (1 - p) * 1.5 };
          o.alpha = K.clamp(K.springStep(t - bLastIn, 10, 1));
        } else if (r.role === 'mid' && bFirst) {
          if (t < bMidIn) return;
          o.each = (it, k) => {
            const t0 = bMidIn + k * S16 * 0.5;
            if (t < t0) return { hidden: true };
            const p = K.springStep(t - t0, 3, 0.62);
            return { dx: (1 - p) * W * 0.55, alpha: K.clamp(K.springStep(t - t0, 9, 1)) };
          };
        }
        const drawIt = (fill) => K.drawRun(g, r.run, x, y, { ...o, fill: fill ?? r.fill });
        if (split > 0.01) {
          for (const [col, sg] of [[A, -1], [Bc, 1]]) {
            g.save(); g.globalAlpha = 0.85; g.globalCompositeOperation = 'lighten'; g.translate(sg * 12 * unit * split, 0); drawIt(col); g.restore();
          }
          drawIt(null);
        } else withMis(g, t, drawIt);
      });
      g.restore();
    }

    function drawThesisB(g, t) {
      const split = Math.max(0, 1 - (t - tMask) / (0.3 * bs));
      if (t < tMask + maskDur) {
        const s = flyScale(t);
        // the outgoing poster carries its own punch-in; the mask must ride the
        // same camera or the windows slide off the letters
        const zA = aZoom.at(t);
        const fx = cx + (focal.x - cx) * zA, fy = cy + (focal.y - cy) * zA;
        g.save();
        zoomAbout(g, s, fx, fy);
        drawThesisA(g, t);
        g.restore();
        const m = new DOMMatrix().translate(fx, fy).scale(s, s).translate(-fx, -fy).translate(cx, cy).scale(zA, zA).translate(-cx, -cy);
        g.save();
        g.clip(K.transformPath(outPath, m), 'nonzero');
        g.fillStyle = P.bg;
        g.fillRect(0, 0, W, H);
        // the next poster waits inside the letter: small and centred on the
        // focal stem, it grows to full frame as the camera flies through
        // BAD waits right behind the stem: flying through the I lands on it,
        // then the poster eases into its own layout.
        const u = K.clamp((t - tMask) / maskDur), e = K.quintInOut(K.clamp((u - 0.6) / 0.4));
        const sB = K.lerp(0.75, 1, e);
        g.translate(K.lerp(fx, bFocus.x, e), K.lerp(fy, bFocus.y, e));
        g.scale(sB, sB);
        g.translate(-bFocus.x, -bFocus.y);
        drawThesisBContent(g, t, split);
        g.restore();
      } else drawThesisBContent(g, t, split);
    }

    // ───────────────────────── 4. PROOF — stack, terminal, strike ─────────────────────────
    const tP = B(SECTIONS.proof);
    const pTok = C.proof.split(/\s+/).filter(Boolean);
    const isSym = (w) => /^[>→=+&<]$/.test(w);
    const pRuns = pTok.map((w) => (isSym(w) ? fitD(w, IW * 0.3) : fitG(w, IW)));
    const pIn = pTok.map((_, i) => B(SECTIONS.proof + i * 0.5));
    pIn.forEach((t, i) => (i === 0 ? impact(t, 'proof slam') : Number.isInteger(((t - tP) / beat.spb) * 1) ? hit(t, 'proof token') : null));
    const pGap = Math.round(26 * unit);
    const pBases = K.stackInk(pRuns, { top: K.snap(cy - K.stackHeight(pRuns, pGap) / 2, 8), gap: pGap });
    const pX = (r, i) => (isSym(pTok[i]) ? cx - r.inkWidth / 2 - r.inkLeft : M - r.inkLeft);
    pRuns.forEach((r, i) => qa.text('proof-' + i, { box: K.runBox(r, pX(r, i), pBases[i]), size: r.capPx, fg: isSym(pTok[i]) ? Bc : ink, bg: P.bg }));

    const tTerm = B(SECTIONS.proof + 2);
    const lines = (C.prompt || []).slice(0, 3);
    const lSize = 40 * unit, lineH = 64 * unit, numW = 64 * unit;
    const lFull = lines.map((l) => mono(l, lSize, { tracking: 0 }));
    const textW = Math.max(10, ...lFull.map((r) => r.advance));
    const padX = 40 * unit, padY = 44 * unit;
    const blockW = Math.min(IW * 0.9, Math.max(IW * 0.6, numW + textW + padX * 2 + 30 * unit));
    const capL = lFull[0]?.capPx ?? lSize * 0.7;
    const blockH = padY * 2 + capL + (lines.length - 1) * lineH;
    const bx0 = cx - blockW / 2, by0 = K.snap(cy - blockH / 2, 8);
    const lineIn = lines.map((_, i) => B(SECTIONS.proof + 2 + i));
    lineIn.forEach((t) => hit(t, 'type line'));
    const tStrike = B(SECTIONS.cta - 1);
    hit(tStrike, 'strike');
    const tCta = B(SECTIONS.cta);
    lFull.forEach((r, i) => qa.text('prompt-' + i, { box: K.runBox(r, bx0 + padX + numW, by0 + padY + capL + i * lineH), size: r.capPx * 1.4, fg: ink, bg: P.bg }));
    const crumbs = (C.crumbs || []).slice(0, 8);
    const cRuns = crumbs.map((c) => mono(c, 21 * unit));
    // crumbs ride a rectangular track around the block, one step per beat
    // the track is the poster's own inner frame: a conveyor, well clear of the block
    const trk = { x0: M + 12 * unit, y0: tall ? Math.round(H * 0.16) : M + 96 * unit, x1: W - MR, y1: tall ? Math.round(H * 0.74) : H - M - 70 * unit };
    const per = 2 * (trk.x1 - trk.x0 + trk.y1 - trk.y0);
    const onTrack = (d) => {
      d = K.mod(d, per);
      const w = trk.x1 - trk.x0, h = trk.y1 - trk.y0;
      if (d < w) return [trk.x0 + d, trk.y0, 'h'];
      d -= w;
      if (d < h) return [trk.x1, trk.y0 + d, 'v'];
      d -= h;
      if (d < w) return [trk.x1 - d, trk.y1, 'h'];
      d -= w;
      return [trk.x0, trk.y1 - d, 'v'];
    };

    function drawProof(g, t) {
      if (t < tTerm) {
        pRuns.forEach((run, i) => {
          if (t < pIn[i]) return;
          const fill = isSym(pTok[i]) ? Bc : ink;
          const o = { fill };
          if (isSym(pTok[i])) {
            const p = K.springStep(t - pIn[i], 3, 0.55);
            o.group = { s: 1 + (1 - p) * 2 };
            o.alpha = K.clamp(p * 3);
          } else {
            o.each = (it, k) => {
              const t0 = pIn[i] + k * S16 * 0.25;
              if (t < t0) return { hidden: true };
              return { dy: (1 - K.springStep(t - t0, 2.9, 0.6)) * H * 0.6 };
            };
          }
          withMis(g, t, (mf) => K.drawRun(g, run, pX(run, i), pBases[i], { ...o, fill: mf ?? fill }));
        });
        return;
      }
      const tq = q(t);
      const open = K.springStep(t - tTerm, 3.4, 0.8);
      const bw = blockW * open;
      g.save();
      g.lineWidth = 3 * unit;
      g.strokeStyle = ink;
      g.strokeRect(cx - bw / 2, by0, bw, blockH);
      g.restore();
      // file tab
      const tab = mono('PROMPT.JSON', 15 * unit);
      const tabW = tab.advance + 24 * unit;
      K.bar(g, cx - bw / 2, by0 - 30 * unit, tabW * K.clamp(open), 30 * unit, ink);
      if (open > 0.95) K.drawRun(g, tab, cx - bw / 2 + 12 * unit, by0 - 9 * unit, { fill: P.bg });
      g.save();
      g.beginPath();
      g.rect(cx - bw / 2, by0, bw, blockH);
      g.clip();
      lines.forEach((l, i) => {
        if (tq < lineIn[i]) return;
        const y = by0 + padY + capL + i * lineH;
        K.drawRun(g, mono(String(i + 1).padStart(2, '0'), lSize * 0.62), bx0 + padX, y, { fill: grey });
        const n = K.typed(l, tq, lineIn[i], 30, seed + i);
        const run = mono([...l].slice(0, n).join(''), lSize, { tracking: 0 });
        K.drawRun(g, run, bx0 + padX + numW, y, { fill: ink });
        const active = i === lines.length - 1 || tq < lineIn[i + 1];
        if (active && tq < tStrike && K.caretOn(tq - lineIn[i], beat.spb)) K.bar(g, bx0 + padX + numW + run.advance + 6 * unit, y - capL - 5 * unit, 22 * unit, capL + 12 * unit, Bc);
      });
      g.restore();
      if (t >= tStrike) {
        const u = K.clamp((t - tStrike) / (S16 * 2));
        K.bar(g, bx0 - 24 * unit, by0 + blockH / 2 - 8 * unit, (blockW + 48 * unit) * K.expoOut(u), 16 * unit, Bc);
      }
      const nC = cRuns.length;
      const bb = beat.b(t) - beat.b(tTerm);
      const stepped = Math.floor(bb) + K.springStep((bb - Math.floor(bb)) * beat.spb, 5, 0.85);
      cRuns.forEach((run, i) => {
        const appear = K.clamp(K.springStep(t - tTerm - i * S16 * 0.5, 5, 0.9));
        if (appear <= 0) return;
        const [x, y, dir] = onTrack((i / nC) * per + stepped * (per / nC) * 0.25);
        // on the side rails text hangs outward, never toward the block
        const lx = dir === 'v' ? (x < cx ? M + 12 * unit : W - MR - run.advance) : K.clamp(x - run.advance / 2, M + 12 * unit, W - MR - run.advance), ly = y + run.capPx / 2;
        K.bar(g, lx - 12 * unit, ly - run.capPx - 3 * unit, 5 * unit, run.capPx + 6 * unit, i % 2 ? A : Bc);
        K.drawRun(g, run, lx, ly, { fill: ink, alpha: appear });
      });
    }

    // ───────────────────────── 5. CTA — the strike becomes the underline ─────────────────────────
    const cw = words(C.cta);
    const cLast = cw[cw.length - 1], cLead = cw.slice(0, -1).join(' ');
    const c2 = fitD(cLast, IW);
    const c1 = cLead ? fitG(cLead, IW * 0.74) : null;
    const cStack = c1 ? [c1, c2] : [c2];
    const cGap = Math.round(26 * unit);
    const cBases = K.stackInk(cStack, { top: K.snap(cy - (K.stackHeight(cStack, cGap) + 44 * unit) / 2, 8), gap: cGap });
    const ulY = cBases[cBases.length - 1] + 26 * unit, ulH = 16 * unit;
    impact(tCta, 'cta slam');
    impact(B(SECTIONS.cta + 1), 'cta accent');
    const ctaZoom = new K.Track(1).spring(B(SECTIONS.cta + 1), 1 + (params.punch - 1) * 0.6, 'slam');
    cStack.forEach((r, i) => qa.text('cta-' + i, { box: K.runBox(r, M - r.inkLeft, cBases[i]), size: r.capPx, fg: ink, bg: P.bg }));

    function drawCta(g, t) {
      const drop = K.springStep(t - tCta, 3.4, 0.72);
      const y = K.lerp(by0 + blockH / 2 - 8 * unit, ulY, drop);
      const x0 = K.lerp(bx0 - 24 * unit, M, drop);
      const w = K.lerp(blockW + 48 * unit, c2.inkWidth, drop);
      g.save();
      zoomAbout(g, ctaZoom.at(t));
      withMis(g, t, (mf) => {
        cStack.forEach((run, i) => {
          const p = K.springStep(t - tCta - i * S16, 2.9, 0.6);
          K.drawRun(g, run, M - run.inkLeft, cBases[i], { fill: mf ?? ink, each: () => ({ dy: (1 - p) * -H * 0.4, alpha: K.clamp(p * 4) }) });
        });
        K.bar(g, x0, y, w, ulH, mf ?? Bc);
      });
      g.restore();
    }

    // ───────────────────────── corner labels (sections 2–5 only: loop-safe) ─────────────────────────
    const lab = (s) => mono(s, 17 * unit);
    const nSec = 5;
    function drawLabels(g, t) {
      if (!params.labels || t < tA || t >= tBrand) return;
      const tq = q(t);
      const sec = t < tB ? 2 : t < tP ? 3 : t < tCta ? 4 : 5;
      const tc = Math.floor(beat.b(tq) * 4) / 4 * beat.spb;
      const mm = String(Math.floor(tc / 60)).padStart(2, '0'), ss = (tc % 60).toFixed(3).padStart(6, '0');
      const crumb = crumbs.length ? crumbs[Math.floor(beat.b(tq) / 2) % crumbs.length] : '';
      const items = [[`${String(sec).padStart(2, '0')}/${String(nSec).padStart(2, '0')}`, M, M + 16 * unit, 'l'], [`${mm}:${ss}`, W - M, M + 16 * unit, 'r'], [crumb, M, labBottom, 'l'], [`${Math.round(beat.bpm)} BPM`, W - MR, labBottom, 'r']];
      for (const [s, x, y, al] of items) {
        const run = lab(s);
        K.drawRun(g, run, al === 'r' ? x - run.advance : x, y, { fill: grey });
      }
    }
    qa.text('labels', { box: { x0: M, y0: M, x1: W - M, y1: H - M }, size: 17 * unit * 0.7, fg: grey, bg: P.bg, decorative: true });

    // ───────────────────────── pre-pass keyframes ─────────────────────────
    [
      [0, 'loop frame = lockup'],
      [B(0.35), 'lockup shoved'],
      [B(0.9), 'open slam + smear'],
      [B(4.4), 'open settled'],
      [B(SECTIONS.thesisA + 0.12), 'smash-pan'],
      [B(SECTIONS.thesisA + 1.5), 'scramble'],
      [B(SECTIONS.thesisA + 4.6), 'thesis locked'],
      [tMask + maskDur * 0.3, 'fly-through 30%'],
      [tMask + maskDur * 0.75, 'fly-through 75%'],
      [B(SECTIONS.thesisB + 3.6), 'counter-thesis'],
      [B(SECTIONS.proof + 1.3), 'proof stack'],
      [B(SECTIONS.proof + 4.7), 'terminal + track'],
      [B(SECTIONS.cta - 0.8), 'strike'],
      [B(SECTIONS.cta + 0.18), 'strike → underline'],
      [B(SECTIONS.cta + 1.5), 'cta'],
      [B(SECTIONS.brand + 0.6), 'handle slam'],
      [B(SECTIONS.brand + 3.1), 'lockup accent'],
      [D - 1 / fps, 'last frame'],
    ].forEach(([t, l]) => qa.keyframe(t, l));

    // ───────────────────────── master timeline ─────────────────────────
    const tPushEnd = B(1.5);
    const whips = [[tA - 0.02, tA + 0.4 * bs, 32], [tMask, tMask + maskDur, 32], [0, B(0.25), 12]];
    // acid-rave: the camera kicks a few degrees on every impact before the lockup
    // (alternating sign, springs back); zero outside (0, tBrand) so the loop stays exact
    let kick = null;
    if (acid) {
      kick = new K.Track(0);
      impacts.filter((ti) => ti > 0 && ti < tBrand).sort((a, b) => a - b).forEach((ti, i) => kick.spring(ti, (i % 2 ? -1 : 1) * 0.045, 'whip').spring(ti + S16 * 2, 0, 'snap'));
    }
    const draw0 = (g, t) => {
        if (t <= 0 || t >= tBrand) return drawBrand(g, t <= 0 ? D - 1e-4 : t);
        if (t < tA) {
          // cold open: the rising slam shoves the lockup up and out
          if (t < tPushEnd) drawBrand(g, D - 1e-4, -K.springStep(t, 2.3, 0.6) * H * 1.05);
          return drawOpen(g, t);
        }
        if (t < tA + 0.6 * bs) {
          // horizontal smash-pan into thesis A
          const pan = K.springStep(t - tA, 3.6, 0.72) * W;
          g.save(); g.translate(-pan, 0); drawOpen(g, t); g.restore();
          g.save(); g.translate(W - pan, 0); drawThesisA(g, t); drawLabels(g, t); g.restore();
          return;
        }
        if (t < tB) drawThesisA(g, t);
        else if (t < tP) drawThesisB(g, t);
        else if (t < tCta) drawProof(g, t);
        else drawCta(g, t);
        drawLabels(g, t);
    };
    return {
      samplesHint: (t) => whips.reduce((n, [a, b, k]) => (t > a && t <= b ? Math.max(n, k) : n), 0),
      draw(g, t) {
        if (!kick || t <= 0 || t >= tBrand) return draw0(g, t);
        const r = kick.at(t);
        g.save();
        g.translate(cx, cy); g.rotate(r); g.scale(1 + Math.abs(r) * 0.7, 1 + Math.abs(r) * 0.7); g.translate(-cx, -cy);
        draw0(g, t);
        g.restore();
      },
    };
  },
};
