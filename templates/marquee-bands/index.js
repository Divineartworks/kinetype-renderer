// MARQUEE BANDS — crossing ticker bands.
// 2–4 thick bands at opposing angles, each an endless ticker of its own text
// with drawn separators. Tickers are tempo-locked: a slow drift plus a spring
// "kick" of a quarter-repeat on every beat, so every beat visibly lands.
// Bands slam in one per beat, a title card punches in on bar 3 and holds, the
// tickers brake to a dead stop for the final beats — the freeze IS frame 0, so
// the loop seam is the cut back to an empty ground.
import * as K from '../../src/kit/index.js';

const SEC = { in: 0, card: 8, lastKick: 27, stop: 30, end: 32 };
const STYLES = ['accent', 'ink', 'accent2', 'outline'];
const SEPS = ['dot', 'star', 'dash', 'star'];
const LOOKS = ['tape', 'stack', 'minimal'];
const LOOK_PALETTE = {
  tape: {},
  stack: { bg: '#0D0D0D', ink: '#EDEDED', a: '#2B59FF', b: '#FF2E63' },
  minimal: { bg: '#F1EEE8', ink: '#141414', a: '#FF4D00', b: '#141414' },
};

export default {
  id: 'marquee-bands',
  version: '1.1.0',
  name: 'Marquee Bands',
  description:
    'Loopable drop/event promo: 2–4 thick ticker bands cross at opposing angles, each text ticking on the beat with drawn separators; bands slam in, a title card punches in on bar 3 and holds, tickers brake to a freeze. 32 beats (16s at 120 BPM).',
  tags: ['promo', 'event', 'merch', 'drop', 'ticker', 'loop', 'bold'],
  formats: ['square', 'vertical', 'portrait', 'landscape'],
  bpm: 120,
  duration: 16,
  loop: true,
  palette: { bg: '#111111', ink: '#F2EFE8', a: '#FF4D00', b: '#FFE600' },
  paletteRoles: { bg: 'ground and text on light bands', ink: 'ink band, card, outline strokes', a: 'accent band + card rule', b: 'second accent band + subtitle chip' },
  fonts: {
    display: { family: 'Big Shoulders Display', weight: 900 },
    mono: { family: 'IBM Plex Mono', weight: 500 },
  },
  params: {
    style: 'tape',
    angle: 11,
    tracking: 20,
    repeatsPerBar: 1,
    punch: 1.04,
  },
  schema: {
    content: {
      type: 'object',
      additionalProperties: false,
      required: ['bands', 'title'],
      properties: {
        bands: {
          type: 'array',
          minItems: 2,
          maxItems: 4,
          description: 'Ticker bands, top to bottom. Each repeats its text endlessly.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['text'],
            properties: {
              text: { type: 'string', minLength: 1, maxLength: 36 },
              style: { enum: STYLES, description: 'accent | ink | accent2 | outline (default cycles)' },
              sep: { enum: ['dot', 'star', 'dash'], description: 'Separator shape between repeats' },
            },
          },
        },
        title: { type: 'string', minLength: 1, maxLength: 24, description: 'Card headline (1–3 words).' },
        subtitle: { type: 'string', maxLength: 36, description: 'Mono line under the title (date, place, price).' },
      },
    },
    params: {
      type: 'object',
      additionalProperties: false,
      properties: {
        style: { enum: LOOKS, description: 'tape (thick bands cross at angles, card punches in) | stack (horizontal parallax bands fill the frame, rows wipe in, a full-width title plate slams across) | minimal (hairline mono tickers at the edges, light ground, big bare title)' },
        angle: { type: 'number', minimum: 0, maximum: 30, description: 'Band tilt in degrees (alternates sign).' },
        tracking: { type: 'number', minimum: -60, maximum: 200 },
        repeatsPerBar: { type: 'number', minimum: 0.25, maximum: 4, description: 'Nominal ticker speed in text repeats per bar.' },
        punch: { type: 'number', minimum: 1, maximum: 1.2 },
      },
    },
  },
  example: {
    template: 'marquee-bands',
    name: 'marquee-bands',
    format: 'square',
    fps: 60,
    duration: 16,
    loop: true,
    bpm: 120,
    seed: 5,
    content: {
      bands: [
        { text: 'NEW DROP' },
        { text: 'LIMITED RUN' },
        { text: 'NO RESTOCK' },
      ],
      title: 'DROP 04',
      subtitle: 'FRI 18:00 CET · ONLINE ONLY',
    },
    rules: { beatCoverage: { dense: 16, then: 2, until: 28 }, loopExact: true },
  },
  notes: 'Bands are ordered so the two accent colours never cross each other (they only ever cross ink/outline bands). Tickers stop dead from beat 30 so frame 0 equals the last frame.',

  build(ctx) {
    const { W, H, palette: P, params, content: C, fonts, beat, seed, qa, fps } = ctx;
    const look = LOOKS.includes(params.style) ? params.style : 'tape';
    const userPal = ctx.spec.palette || {};
    for (const [k, v] of Object.entries(LOOK_PALETTE[look])) if (!(k in userPal)) P[k] = v;
    const stack = look === 'stack', minimal = look === 'minimal';
    const totalBeats = Math.round((ctx.duration * beat.bpm) / 60);
    const bs = totalBeats / SEC.end;
    const B = (n) => beat.t(n * bs);
    const D = ctx.duration;
    const unit = Math.min(W, H) / 1080;
    const cx = W / 2, cy = H / 2;
    const fD = fonts.get('display'), fM = fonts.get('mono');
    const q = (t) => K.frameQuant(t, fps);
    const tr = params.tracking;
    const S = Math.min(W, H);

    // ───────────── bands ─────────────
    const cap = S * (stack ? 0.058 : minimal ? 0.03 : 0.078);
    const size = (cap / (minimal ? fM : fD).capHeight) * (minimal ? fM : fD).upm;
    const thick = cap * (stack ? 1.55 : minimal ? 2.4 : 1.72);
    // stack: as many horizontal rows as fill the frame (content bands cycle)
    const rowsN = stack ? Math.max(C.bands.length, Math.ceil(H / (thick * 1.08))) : C.bands.length;
    const n = rowsN;
    const spacing = stack ? H / n : (H * (ctx.aspect === 'vertical' ? 0.58 : ctx.aspect === 'landscape' ? 0.5 : 0.46)) / Math.max(1, n - 1);
    const len = Math.hypot(W, H) * 1.35;
    const ang = stack || minimal ? 0 : (params.angle * Math.PI) / 180;
    const Mm = Math.round(S * 0.07);
    const colour = { accent: [P.a, P.bg], ink: [P.ink, P.bg], accent2: [P.b, P.bg], outline: [P.bg, P.ink] };
    const tStop = B(SEC.stop), tLastKick = B(SEC.lastKick);
    // optical balance: centre the bands' visible extent (tilt pushes it off-centre)
    const angOf = (i) => (i % 2 === 0 ? 1 : -1) * ang * (i >= 2 ? 0.55 : 1);
    // minimal: tickers hug the top and bottom margins, the middle is the title's
    const minimalY = (i) => {
      const top = Math.ceil(n / 2);
      return i < top ? Mm + thick / 2 + i * thick : H - Mm - thick / 2 - (n - 1 - i) * thick;
    };
    let yMin = Infinity, yMax = -Infinity;
    for (let i = 0; i < n; i++) {
      const y0 = cy + (i - (n - 1) / 2) * spacing, tn = Math.tan(angOf(i));
      for (const x of [0, W]) { const y = y0 + (x - cx) * tn; yMin = Math.min(yMin, y - thick / 2); yMax = Math.max(yMax, y + thick / 2); }
    }
    const yBalance = stack || minimal ? 0 : cy - (yMin + yMax) / 2;
    const bands = Array.from({ length: n }, (_, i) => {
      const bd = C.bands[i % C.bands.length];
      const style = stack ? (bd.style || ['ink', 'outline', 'accent', 'outline', 'accent2', 'outline'][i % 6]) : minimal ? 'hair' : bd.style || STYLES[i % STYLES.length];
      const run = K.shape(minimal ? fM : fD, bd.text.toUpperCase(), { size, tracking: minimal ? 120 : tr, ...(minimal ? { kerning: 'metric' } : {}) });
      const sep = bd.sep || SEPS[i % SEPS.length];
      const sepW = sep === 'dash' ? cap * 0.62 : cap * 0.42;
      const gap = cap * 0.5;
      const per = run.advance + gap * 2 + sepW;
      const dir = i % 2 === 0 ? -1 : 1;
      const a = angOf(i);
      const y = stack ? (i + 0.5) * spacing : minimal ? minimalY(i) : cy + (i - (n - 1) / 2) * spacing + yBalance;
      // tempo lock: kicks of a quarter repeat on every beat + a drift, scaled so
      // the whole travel is a whole number of repeats
      const kicks = SEC.lastKick + 1;
      const kickStep = per / 4;
      const nominal = (params.repeatsPerBar * per * (tStop / (beat.spb * bs * 4))) * (stack ? 1.4 + (i % 3) * 0.5 : minimal ? 0.25 : 0.5);
      const k = Math.max(1, Math.round((kicks * kickStep + nominal) / per));
      const drift = k * per - kicks * kickStep;
      const kick = new K.Track(K.noise1(seed, 'band', i) * per);
      if (!minimal) for (let b = 0; b < kicks; b++) kick.spring(B(b) + i * 0.02, kick.last + kickStep, stack ? 'lock' : { f: 4.2, z: 0.78 });
      // entrances: tape slams perpendicular; stack rows wipe in from their own side, staggered 1/16;
      // minimal draws its hairlines in (no slam)
      const enter = stack
        ? new K.Track((i % 2 === 0 ? -1 : 1) * len).spring(B(0) + i * beat.spb * bs * 0.25, 0, { f: 2.8, z: 0.8 })
        : minimal ? new K.Track(1).spring(B(0) + i * beat.spb * bs * 0.5, 0, { f: 1.4, z: 1 })
        : new K.Track((i % 2 === 0 ? -1 : 1) * (S * 0.9)).spring(B(i), 0, { f: 2.5, z: 0.6 });
      return { style, run, sep, sepW, gap, per, dir, a, y, drift, kick, enter, i };
    });
    // drift: constant speed, then a braking parabola to a dead stop at tStop
    const tBrake = B(SEC.lastKick + 1);
    const driftU = (t) => {
      const v = 1 / (tBrake + (tStop - tBrake) / 2);
      if (t <= tBrake) return v * t;
      if (t >= tStop) return 1;
      const u = (t - tBrake) / (tStop - tBrake);
      return v * (tBrake + ((tStop - tBrake) / 2) * (1 - (1 - u) * (1 - u)));
    };
    bands.forEach((b, i) => { if (!stack && !minimal) qa.hit(B(i), 'band slam'); });
    if (stack || minimal) for (let k = 0; k < 4; k++) qa.hit(B(k), stack ? 'rows wipe in' : 'hairlines draw');
    for (let b = 0; b <= SEC.lastKick; b++) qa.hit(B(b), 'ticker kick');
    const colourOf = (st) => (st === 'hair' ? [P.bg, P.ink] : colour[st]);
    bands.forEach((b) => qa.text('band-' + b.i, { box: { x0: 0, y0: b.y - thick / 2, x1: W, y1: b.y + thick / 2 }, size: cap, fg: colourOf(b.style)[1], bg: colourOf(b.style)[0], bleed: true, decorative: minimal }));

    function drawSep(g, b, x, fill) {
      const my = -cap / 2;
      g.fillStyle = fill;
      if (b.sep === 'dot') {
        g.beginPath(); g.arc(x + b.sepW / 2, my, cap * 0.17, 0, Math.PI * 2); g.fill();
      } else if (b.sep === 'dash') {
        g.fillRect(x, my - cap * 0.07, b.sepW, cap * 0.14);
      } else {
        const R = b.sepW / 2, r = R * 0.42, sx = x + R;
        g.beginPath();
        for (let k = 0; k < 12; k++) {
          const rr = k % 2 === 0 ? R : r, th = (k * Math.PI) / 6 - Math.PI / 2;
          g[k ? 'lineTo' : 'moveTo'](sx + Math.cos(th) * rr, my + Math.sin(th) * rr);
        }
        g.closePath(); g.fill();
      }
    }

    function drawBand(g, t, b) {
      const [fill, txt] = colourOf(b.style);
      g.save();
      g.translate(cx, b.y);
      g.rotate(b.a);
      if (stack) g.translate(b.enter.at(t), 0);
      else if (!minimal) g.translate(0, b.enter.at(t));
      if (minimal) {
        // hairline rules drawn in from the centre; tiny tracked mono ticker between them
        const e = 1 - K.clamp(b.enter.at(t));
        const lw = Math.max(1.5, 1.6 * unit), half = (len / 2) * e;
        g.fillStyle = P.ink;
        g.fillRect(-half, -thick / 2, half * 2, lw); g.fillRect(-half, thick / 2 - lw, half * 2, lw);
        g.globalAlpha = K.clamp(e * 1.3);
        const off = K.mod(b.dir * (b.kick.at(t) + b.drift * driftU(t)), b.per);
        for (let x = -len / 2 - b.per + off; x < len / 2; x += b.per) {
          K.drawRun(g, b.run, x, cap / 2, { fill: P.ink });
          g.save(); g.translate(0, cap / 2); drawSep(g, b, x + b.run.advance + b.gap, P.a); g.restore();
        }
        g.restore();
        return;
      }
      if (b.style === 'outline') {
        g.fillStyle = P.bg; g.fillRect(-len / 2, -thick / 2, len, thick);
        g.fillStyle = P.ink;
        const lw = Math.max(3, 4 * unit);
        g.fillRect(-len / 2, -thick / 2, len, lw); g.fillRect(-len / 2, thick / 2 - lw, len, lw);
      } else {
        g.fillStyle = fill; g.fillRect(-len / 2, -thick / 2, len, thick);
      }
      const off = K.mod(b.dir * (b.kick.at(t) + b.drift * driftU(t)), b.per);
      const base = cap / 2;
      for (let x = -len / 2 - b.per + off; x < len / 2; x += b.per) {
        if (b.style === 'outline') K.drawRun(g, b.run, x, base, { stroke: P.ink, strokeWidth: 2.4 * unit });
        else K.drawRun(g, b.run, x, base, { fill: txt });
        g.save(); g.translate(0, base); drawSep(g, b, x + b.run.advance + b.gap, txt); g.restore();
      }
      g.restore();
    }

    // ───────────── title card ─────────────
    const tCard = B(SEC.card);
    const title = C.title.toUpperCase();
    const cardW = stack ? W + 4 : minimal ? W - Mm * 2 : Math.min(W * 0.74, S * 0.86);
    const padX = S * 0.05, padY = S * 0.046;
    const capMax = ((S * (minimal ? 0.26 : stack ? 0.22 : 0.2)) / fD.capHeight) * fD.upm;
    let tLines = [title];
    let tSize = Math.min(K.fitSize(fD, title, cardW - padX * 2, { tracking: tr }), capMax);
    if (title.includes(' ') && tSize < capMax * 0.62) {
      const two = K.balanceLines(fD, title, K.shape(fD, title, { size: 100, tracking: tr }).inkWidth * 0.6, { size: 100, tracking: tr });
      const s2 = Math.min(...two.map((l) => K.fitSize(fD, l, cardW - padX * 2, { tracking: tr })), capMax);
      if (two.length === 2 && s2 > tSize * 1.25) { tLines = two; tSize = s2; }
    }
    const tRuns = tLines.map((l) => K.shape(fD, l, { size: tSize, tracking: tr }));
    const tRun = tRuns[0];
    const tLead = tRun.capPx * 0.2;
    const titleH = tRuns.length * tRun.capPx + (tRuns.length - 1) * tLead;
    const subtitle = (C.subtitle || '').toUpperCase();
    const sRun = subtitle ? K.shape(fM, subtitle, { size: Math.max(20 * unit, Math.min(30 * unit, (cardW - padX * 2) / (subtitle.length * 0.64))), tracking: 40, kerning: 'metric' }) : null;
    const ruleH = Math.max(6, Math.round(S * 0.011));
    const inner = titleH + (sRun ? ruleH + padY * 0.7 * 2 + sRun.capPx : 0);
    const cardH = inner + padY * 2;
    const cardX = cx - cardW / 2, cardY = K.snap(cy - cardH / 2, 2);
    const tBases = tRuns.map((_, i) => cardY + padY + tRun.capPx + i * (tRun.capPx + tLead));
    const tBase = tBases[tBases.length - 1];
    const ruleY = tBase + padY * 0.7;
    const sBase = ruleY + ruleH + padY * 0.7 + (sRun ? sRun.capPx : 0);
    const cardS = new K.Track(minimal ? 1.04 : 1.32).spring(tCard, 1, minimal ? { f: 1.2, z: 1 } : { f: 2.6, z: 0.62 });
    // stack: the plate slams ACROSS the frame (x), not in scale
    const cardX0 = new K.Track(stack ? -W * 1.1 : 0).spring(tCard, 0, { f: 3.2, z: 0.72 });
    const ruleGrow = new K.Track(0).spring(B(SEC.card + 2), 1, { f: 3, z: 0.85 });
    const zoom = new K.Track(1).spring(B(4), params.punch, 'slam').spring(B(5), 1, 'glide').spring(tCard, params.punch, 'slam').spring(B(SEC.card + 2), 1, 'glide');
    qa.hit(tCard, 'card punch');
    qa.hit(B(SEC.card + 1), 'subtitle types');
    qa.hit(B(SEC.card + 2), 'card rule');
    const tX = (r) => cx - (r.inkLeft + r.inkRight) / 2;
    const tFg = stack ? P.ink : minimal ? P.ink : P.bg, tBg = stack ? P.a : minimal ? P.bg : P.ink;
    tRuns.forEach((r, i) => qa.text('title-' + i, { box: K.runBox(r, tX(r), tBases[i]), size: r.capPx, fg: tFg, bg: tBg, lines: tLines, orphanOk: true }));
    if (sRun) qa.text('subtitle', { box: K.runBox(sRun, cx - sRun.advance / 2, sBase), size: sRun.capPx, fg: tFg, bg: tBg });

    function drawCard(g, t) {
      if (t < tCard) return;
      const s = cardS.at(t);
      // a punch is a hard appear at scale, then the slam down — never a fade
      g.save();
      g.translate(cx, cy); g.scale(s, s); g.translate(-cx, -cy);
      if (stack) g.translate(cardX0.at(t), 0);
      const sh = Math.round(S * 0.014);
      const titleFill = minimal ? P.ink : P.bg;
      if (minimal) {
        const a = K.clamp(K.springStep(t - tCard, 1.4, 1) * 1.5);
        g.globalAlpha = a;
      } else {
        // hard offset shadow in the ground colour separates the card from the bands
        if (!stack) { g.fillStyle = P.bg; g.fillRect(cardX + sh, cardY + sh, cardW, cardH); }
        g.fillStyle = stack ? P.a : P.ink; g.fillRect(cardX, cardY, cardW, cardH);
      }
      tRuns.forEach((r, i) => K.drawRun(g, r, tX(r), tBases[i], { fill: stack ? P.ink : titleFill }));
      const gr = K.clamp(ruleGrow.at(t), 0, 1.02);
      if (gr > 0) K.bar(g, cx - ((cardW - padX * 2) / 2) * gr, ruleY, (cardW - padX * 2) * gr, ruleH, stack ? P.ink : P.a);
      if (sRun) {
        const tq = q(t);
        const m = K.typed(subtitle, tq, B(SEC.card + 1), 30, seed);
        if (m > 0) K.drawRun(g, K.shape(fM, [...subtitle].slice(0, m).join(''), { size: sRun.size, tracking: 40, kerning: 'metric' }), cx - sRun.advance / 2, sBase, { fill: stack ? P.ink : titleFill });
      }
      g.restore();
    }

    [
      [0, 'loop frame = freeze'],
      [B(0.3), 'first band slams'],
      [B(1.5), 'second band'],
      [B(n - 1 + 0.6), 'all bands'],
      [B(4.1), 'punch'],
      [B(6.5), 'ticking'],
      [B(8.12), 'card punch'],
      [B(9.6), 'subtitle types'],
      [B(12.5), 'hold'],
      [B(20.3), 'kick'],
      [B(28.6), 'braking'],
      [D - 1 / fps, 'last frame'],
    ].forEach(([t, l]) => qa.keyframe(t, l));

    function drawAll(g, t) {
      g.save();
      const z = zoom.at(t);
      g.translate(cx, cy); g.scale(z, z); g.translate(-cx, -cy);
      // accents never cross: draw order is the content order; crossings are
      // always accent-over-ink/outline by construction of the style cycle
      for (const b of bands) if (stack || minimal || t >= B(b.i) || b.i === 0) drawBand(g, t, b);
      g.restore();
      drawCard(g, t);
    }

    return {
      draw(g, t) {
        drawAll(g, t <= 0 ? D - 1e-4 : t);
      },
    };
  },
};
