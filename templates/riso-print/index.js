// RISO PRINT — two-drum risograph zine.
// Paper ground, two spot inks printed with 'multiply' so overlaps make the
// colours a real 2-drum riso makes. The hero word and a disc are halftone
// screens (deterministic dot grids at classic screen angles) that "print" in
// with a drum-roll sweep; headline words thunk down like a press; every beat
// is a new print pass — the misregistration and paper grain step together,
// stop-motion style, never per-frame jitter.
import * as K from '../../src/kit/index.js';

const SEC = { disc: 0, hero: 2, stamps: 4, sub: 8, badge: 9, labels: 10, end: 16 };

const STYLES = ['zine', 'gig-poster', 'botanical'];
// real riso drum pairs per style (only applied to tokens the spec does not set)
const STYLE_PALETTE = {
  zine: {},
  'gig-poster': { bg: '#EFE8DA', a: '#FF6C2F', b: '#3255A4' },
  botanical: { bg: '#F4EFDF', a: '#FF665E', b: '#407060' }, // riso Bright Red + Hunter Green
};

// multiply of two sRGB colours with coverage c of the second ink
function overprint(a, b, c = 1) {
  const A = K.hexToRgb(a), Bv = K.hexToRgb(b);
  return K.rgbToHex(A.map((v, i) => v * (1 - c + (c * Bv[i]) / 255)));
}

export default {
  id: 'riso-print',
  version: '1.1.0',
  name: 'Riso Print',
  description:
    'Two-colour risograph zine page that prints itself: halftone disc and hero word roll in, headline words stamp down like a press, per-beat print passes step the misregistration and grain. Paper ground, multiply overprint. 16 beats (10s at 96 BPM).',
  tags: ['zine', 'print', 'editorial', 'poster', 'texture', 'music', 'event'],
  formats: ['square', 'portrait', 'vertical', 'landscape'],
  bpm: 96,
  duration: 10,
  loop: false,
  palette: { bg: '#F3EFE6', a: '#FF48B0', b: '#0078BF' },
  paletteRoles: {
    bg: 'paper',
    a: 'drum 1 ink (fluorescent pink): hero halftone, stamp twins, badge ring',
    b: 'drum 2 ink (blue): disc halftone, stamps, badge number',
    'over / over75 / over50 / over25': 'DERIVED, not settable: multiply(a, b) at 100/75/50/25% blue coverage — the only third colours this press can make; QA checks against them',
  },
  fonts: {
    display: { family: 'Archivo Black', weight: 400 },
    stamp: { family: 'Anton', weight: 400 },
    mono: { family: 'Space Mono', weight: 700 },
  },
  params: {
    style: 'zine',
    pitch: 11,
    misregister: 2.5,
    grain: 0.1,
    screenA: 15,
    screenB: 75,
    tracking: 0,
  },
  schema: {
    content: {
      type: 'object',
      additionalProperties: false,
      required: ['headline'],
      properties: {
        headline: { type: 'string', minLength: 1, maxLength: 36, description: '1–4 words, stamped one per beat, stacked flush-left.' },
        hero: { type: 'string', maxLength: 12, description: 'The halftone hero word printed huge across the page (default: last headline word). 3–7 letters is ideal.' },
        subhead: { type: 'string', maxLength: 60, description: 'One mono line under the stamps.' },
        labels: { type: 'array', maxItems: 4, items: { type: 'string', maxLength: 18 }, description: 'Tiny mono labels along the foot of the page.' },
        issue: { type: 'string', maxLength: 4, description: 'Issue number for the round stamp (e.g. "07").' },
      },
    },
    params: {
      type: 'object',
      additionalProperties: false,
      properties: {
        style: { enum: STYLES, description: 'zine (halftone disc, flush-left stamps, pink/blue) | gig-poster (halftone sunburst rays, flush-right stamps, heavy press thunk, orange/federal blue) | botanical (overlapping halftone leaves, centred type, gentle press, red/green)' },
        pitch: { type: 'number', minimum: 5, maximum: 30, description: 'Halftone screen pitch in px @1080.' },
        misregister: { type: 'number', minimum: 0, maximum: 12, description: 'Max drum misregistration per pass, px @1080.' },
        grain: { type: 'number', minimum: 0, maximum: 0.35 },
        screenA: { type: 'number', description: 'Screen angle (deg) of ink a.' },
        screenB: { type: 'number', description: 'Screen angle (deg) of ink b.' },
        tracking: { type: 'number', minimum: -60, maximum: 120 },
      },
    },
  },
  example: {
    template: 'riso-print',
    name: 'riso-print',
    format: 'square',
    fps: 60,
    duration: 10,
    bpm: 96,
    seed: 3,
    content: {
      headline: 'NO SIGNAL TONIGHT',
      hero: 'STATIC',
      subhead: 'A ZINE ABOUT NOISE, RADIOS & THE DARK',
      labels: ['RISO 2C', 'A5 / 24PP', 'EDITION OF 100'],
      issue: '07',
    },
  },
  notes: 'Readable text is printed as overprint (both drums), which is how riso gets a legible dark; pink alone never carries small text (contrast). Every beat is a print pass.',

  build(ctx) {
    const { W, H, palette: P, params, content: C, fonts, beat, seed, qa, fps } = ctx;
    const style = STYLES.includes(params.style) ? params.style : 'zine';
    const userPal = ctx.spec.palette || {};
    for (const [k, v] of Object.entries(STYLE_PALETTE[style])) if (!(k in userPal)) P[k] = v;
    const gig = style === 'gig-poster', bot = style === 'botanical';
    const align = gig ? 'right' : bot ? 'center' : 'left';
    const misAmt = params.misregister * (gig ? 1.6 : bot ? 0.6 : 1);
    const thunk = gig ? 4.6 : bot ? 0.9 : 2.2;
    const pressF = gig ? 8 : bot ? 3 : 6; // stamp settle stiffness
    const totalBeats = Math.round((ctx.duration * beat.bpm) / 60);
    const bs = totalBeats / SEC.end;
    const B = (n) => beat.t(n * bs);
    const D = ctx.duration;
    const S = Math.min(W, H), unit = S / 1080;
    const M = Math.round(S * 0.07);
    const IW = W - 2 * M;
    const fD = fonts.get('display'), fS = fonts.get('stamp'), fM = fonts.get('mono');
    const q = (t) => K.frameQuant(t, fps);
    // derived overprint ramp (registered so palette QA knows the press's colours)
    P.over = overprint(P.a, P.b, 1);
    P.over75 = overprint(P.a, P.b, 0.75);
    P.over50 = overprint(P.a, P.b, 0.5);
    P.over25 = overprint(P.a, P.b, 0.25);
    const landscape = ctx.aspect === 'landscape', vertical = ctx.aspect === 'vertical';

    // ───────────── print passes: one per beat ─────────────
    const passOf = (t) => Math.max(0, Math.floor(beat.b(q(t)) / bs + 1e-6));
    const mis = (p, ink) => {
      const r = K.rng(seed, 'pass', p, ink);
      const ang = r() * Math.PI * 2, mag = (0.35 + 0.65 * r()) * misAmt * unit;
      return [Math.round(Math.cos(ang) * mag * 2) / 2, Math.round(Math.sin(ang) * mag * 2) / 2];
    };
    for (let n = 0; n < totalBeats / bs; n++) qa.hit(B(n), 'print pass');

    // ───────────── layout ─────────────
    const words = C.headline.toUpperCase().split(/\s+/).filter(Boolean).slice(0, 4);
    // hero geometry first: everything above must clear its cap line
    const heroWord0 = (C.hero || words[words.length - 1]).toUpperCase();
    const heroCap = S * (vertical ? 0.22 : landscape ? 0.21 : 0.24);
    const labSize = 23 * unit;
    const heroRun0 = K.shape(fD, heroWord0, { size: Math.min(K.fitSize(fD, heroWord0, IW, { tracking: -20 }), (heroCap / fD.capHeight) * fD.upm), tracking: -20 });
    const heroTop = K.snap(H - M - labSize * 2.2 - S * 0.015, 2) - heroRun0.capPx;
    const stampW = IW * (landscape ? 0.46 : vertical ? 0.9 : bot ? 0.52 : 0.6);
    // x of a run for the style's alignment (flush-left / flush-right / centred)
    const ax = (r, w) => (align === 'right' ? W - M - (w ?? r.inkRight) : align === 'center' ? W / 2 - (w != null ? w / 2 : (r.inkLeft + r.inkRight) / 2) : M - (w != null ? 0 : r.inkLeft));
    const sub = (C.subhead || '').toUpperCase();
    const subSize = Math.max(24 * unit, Math.min(30 * unit, stampW / Math.max(8, sub.length * 0.62)));
    const subLines = sub ? K.balanceLines(fM, sub, stampW, { size: subSize, tracking: 30, kerning: 'metric' }) : [];
    const subRuns = subLines.map((l) => K.shape(fM, l, { size: subSize, tracking: 30, kerning: 'metric' }));
    const subH = subRuns.length ? K.stackHeight(subRuns, subSize * 0.45) + S * 0.04 : 0;
    const sGap = Math.round(S * 0.018);
    let capMax = S * (vertical ? 0.16 : landscape ? 0.14 : 0.15);
    let sRuns;
    for (let k = 0; k < 12; k++) {
      sRuns = words.map((w) => {
        const sz = Math.min(K.fitSize(fS, w, stampW, { tracking: params.tracking }), (capMax / fS.capHeight) * fS.upm);
        return K.shape(fS, w, { size: sz, tracking: params.tracking });
      });
      const need = M + S * 0.02 + K.stackHeight(sRuns, sGap) + subH + S * 0.03;
      if (need <= heroTop || vertical) break;
      capMax *= 0.92;
    }
    const sBases = K.stackInk(sRuns, { top: M + S * 0.02, gap: sGap, grid: 4 });
    const sIn = sRuns.map((_, i) => B(SEC.stamps + i));
    const twin = sRuns.map((_, i) => {
      const r = K.rng(seed, 'twin', i);
      return { dx: (r() < 0.5 ? -1 : 1) * (5 + 4 * r()) * unit, dy: (r() < 0.5 ? -1 : 1) * (3 + 3 * r()) * unit, rot: (r() - 0.5) * 0.05 };
    });
    sIn.forEach((t) => qa.hit(t, 'stamp'));
    sRuns.forEach((r, i) => qa.text('stamp-' + i, { box: K.runBox(r, ax(r), sBases[i]), size: r.capPx, fg: P.over, bg: P.bg }));
    const subX = (r) => (align === 'left' ? M : ax(r, r.advance));
    const lastStamp = sBases[sBases.length - 1];
    const subBases = subRuns.length ? K.stackInk(subRuns, { top: lastStamp + S * 0.04, gap: subSize * 0.45, grid: 2 }) : [];
    const tSub = B(SEC.sub);
    if (sub) qa.hit(tSub, 'subhead');
    subRuns.forEach((r, i) => qa.text('subhead-' + i, { box: K.runBox(r, subX(r), subBases[i]), size: r.capPx, fg: P.over, bg: P.bg, lines: subLines, orphanOk: true }));

    // disc (ink b)
    const disc0 = landscape
      ? { x: W * 0.7, y: H * 0.43, r: S * 0.34 }
      : vertical
        ? { x: W * 0.6, y: H * 0.56, r: S * 0.4 }
        : { x: W * 0.66, y: H * 0.5, r: S * 0.28 };
    // gig-poster: the sunburst sits opposite the flush-right type; botanical: leaves centred behind
    const disc = gig ? { ...disc0, x: W - disc0.x, r: disc0.r * 1.25 } : bot ? { x: W * 0.74, y: H * (vertical ? 0.58 : 0.54), r: disc0.r * 1.05 } : disc0;
    const inkShape = new Path2D();
    if (gig) {
      const N = 18;
      for (let k = 0; k < N; k++) {
        const a0 = (k / N) * Math.PI * 2, a1 = a0 + Math.PI / N;
        inkShape.moveTo(disc.x, disc.y);
        inkShape.arc(disc.x, disc.y, disc.r * 1.6, a0, a1);
        inkShape.closePath();
      }
    } else if (bot) {
      // a five-petal bloom: every petal its own closed sub-path, same winding
      for (let k = 0; k < 5; k++) {
        const a = -Math.PI / 2 + (k * Math.PI * 2) / 5;
        const px = disc.x + Math.cos(a) * disc.r * 0.5, py = disc.y + Math.sin(a) * disc.r * 0.5;
        inkShape.moveTo(px + Math.cos(a) * disc.r * 0.52, py + Math.sin(a) * disc.r * 0.52);
        inkShape.ellipse(px, py, disc.r * 0.52, disc.r * 0.24, a, 0, Math.PI * 2);
      }
      inkShape.moveTo(disc.x + disc.r * 0.2, disc.y);
      inkShape.arc(disc.x, disc.y, disc.r * 0.2, 0, Math.PI * 2);
    } else inkShape.arc(disc.x, disc.y, disc.r, 0, Math.PI * 2);
    // hero word (ink a), full width at the foot
    const heroWord = heroWord0;
    const heroRun = heroRun0;
    const labels = (C.labels || []).map((l) => l.toUpperCase());
    const labRuns = labels.map((l) => K.shape(fM, l, { size: labSize, tracking: 60, kerning: 'metric' }));
    const labBase = H - M;
    const heroBase = K.snap(labBase - labSize * 2.2 - S * 0.015, 2);
    const heroX = cx(heroRun);
    function cx(run) { return W / 2 - (run.inkLeft + run.inkRight) / 2; }
    const heroPath = K.runPath(heroRun, heroX, heroBase);
    qa.text('hero', { box: K.runBox(heroRun, heroX, heroBase), size: heroRun.capPx, decorative: true });
    qa.hit(B(SEC.disc), 'disc prints');
    qa.hit(B(SEC.hero), 'hero prints');
    const tLabels = B(SEC.labels);
    if (labels.length) qa.hit(tLabels, 'labels');
    const labX = labRuns.map((r, i) => (labRuns.length === 1 ? ax(r, r.advance) : M + ((IW - r.advance) * i) / (labRuns.length - 1)));
    labRuns.forEach((r, i) => qa.text('label-' + i, { box: K.runBox(r, labX[i], labBase), size: r.capPx, fg: P.over, bg: P.bg }));

    // issue badge
    const issue = C.issue ? String(C.issue) : '';
    const bR = S * 0.085;
    // the badge sits in the corner the type does not use
    const badge = { x: gig ? M + bR * 1.1 : W - M - bR * 1.1, y: M + bR * 1.1, r: bR };
    const bNum = issue ? K.shape(fS, issue, { size: ((badge.r * 0.7) / fS.capHeight) * fS.upm, tracking: 0 }) : null;
    const bNo = K.shape(fM, 'NO.', { size: 22 * unit, tracking: 80, kerning: 'metric' });
    const tBadge = B(SEC.badge);
    if (issue) {
      qa.hit(tBadge, 'badge stamp');
      qa.text('issue', { box: { x0: badge.x - badge.r, y0: badge.y - badge.r, x1: badge.x + badge.r, y1: badge.y + badge.r }, size: bNum.capPx, fg: P.b, bg: P.bg });
    }

    // ───────────── halftone ─────────────
    const pitch = params.pitch * unit;
    /** Dot screen over a box; radius from tone(x,y) (0..1 ink coverage) × grow(x,y). */
    const screenCache = new Map();
    function screen(g, box, angDeg, tone, grow, cacheKey) {
      // once a screen has fully printed it never changes: build its dots once
      if (cacheKey && screenCache.has(cacheKey)) return g.fill(screenCache.get(cacheKey));
      const a = (angDeg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
      const cxb = (box.x0 + box.x1) / 2, cyb = (box.y0 + box.y1) / 2;
      const R = Math.hypot(box.x1 - box.x0, box.y1 - box.y0) / 2 + pitch;
      const n = Math.ceil(R / pitch);
      const path = new Path2D();
      for (let i = -n; i <= n; i++) {
        for (let j = -n; j <= n; j++) {
          const u = i * pitch, v = j * pitch;
          const x = cxb + u * ca - v * sa, y = cyb + u * sa + v * ca;
          if (x < box.x0 - pitch || x > box.x1 + pitch || y < box.y0 - pitch || y > box.y1 + pitch) continue;
          const cov = K.clamp(tone(x, y)) * grow(x, y);
          if (cov <= 0.01) continue;
          // dot area ∝ coverage; above ~78% the dots merge into solid, like film
          const r = Math.min(pitch * 0.72, pitch * Math.sqrt(cov / Math.PI));
          path.moveTo(x + r, y);
          path.arc(x, y, r, 0, Math.PI * 2);
        }
      }
      if (cacheKey) screenCache.set(cacheKey, path);
      g.fill(path);
    }
    const rollDone = (t, t0) => t >= t0 + beat.spb * bs * 1.2 + K.springSettle(3.2, 0.95);
    // drum roll: ink lands in a sweep across the sheet over ~1.5 beats
    const roll = (t, t0, dirX, span) => (x, y) => {
      const f = K.clamp(dirX ? (x - span[0]) / (span[1] - span[0]) : (y - span[0]) / (span[1] - span[0]));
      return K.springStep(t - (t0 + f * beat.spb * bs * 1.2), 3.2, 0.95);
    };

    function inkB(g, t) {
      // disc
      const ext = gig ? 1.6 : 1;
      const box = { x0: disc.x - disc.r * ext, y0: disc.y - disc.r * ext, x1: disc.x + disc.r * ext, y1: disc.y + disc.r * ext };
      g.save();
      g.clip(inkShape, 'nonzero');
      g.fillStyle = P.b;
      screen(g, box, params.screenB, (x, y) => 0.18 + 0.8 * K.smoothstep(box.y0, box.y1, y), roll(t, B(SEC.disc), true, [box.x0, box.x1]), rollDone(t, B(SEC.disc)) ? 'disc' : null);
      g.restore();
      // stamps
      sRuns.forEach((r, i) => {
        if (t < sIn[i]) return;
        const d = t - sIn[i];
        const s = 1 + (gig ? 0.22 : bot ? 0.06 : 0.14) * (1 - K.springStep(d, pressF, 1));
        K.drawRun(g, r, ax(r), sBases[i], { fill: P.b, group: { s, rot: twin[i].rot * 0.3 } });
      });
      if (issue && t >= tBadge && bNum) {
        const s = 1 + 0.2 * (1 - K.springStep(t - tBadge, 6, 1));
        g.save();
        g.translate(badge.x, badge.y); g.rotate(-0.14); g.scale(s, s); g.translate(-badge.x, -badge.y);
        K.drawRun(g, bNum, badge.x - (bNum.inkLeft + bNum.inkRight) / 2, badge.y + bNum.capPx / 2 + badge.r * 0.16, { fill: P.b });
        g.restore();
      }
    }

    function inkA(g, t) {
      // hero halftone word, rolled top → bottom
      const hb = K.runBox(heroRun, heroX, heroBase);
      g.save();
      g.clip(heroPath, 'nonzero');
      g.fillStyle = P.a;
      screen(g, { x0: hb.x0, y0: hb.y0, x1: hb.x1, y1: hb.y1 }, params.screenA, (x) => 0.3 + 0.68 * K.smoothstep(hb.x0, hb.x1, x), roll(t, B(SEC.hero), false, [hb.y0, hb.y1]), rollDone(t, B(SEC.hero)) ? 'hero' : null);
      g.restore();
      // stamp twins: the second drum's hit, knocked slightly off
      sRuns.forEach((r, i) => {
        if (t < sIn[i]) return;
        const d = t - sIn[i];
        const s = 1 + (gig ? 0.22 : bot ? 0.06 : 0.14) * (1 - K.springStep(d, pressF, 1));
        K.drawRun(g, r, ax(r) + twin[i].dx, sBases[i] + twin[i].dy, { fill: P.a, group: { s, rot: twin[i].rot } });
      });
      if (issue && t >= tBadge) {
        const s = 1 + 0.2 * (1 - K.springStep(t - tBadge, 6, 1));
        g.save();
        g.translate(badge.x, badge.y); g.rotate(-0.14); g.scale(s, s);
        g.lineWidth = badge.r * 0.13;
        g.strokeStyle = P.a;
        g.beginPath(); g.arc(0, 0, badge.r, 0, Math.PI * 2); g.stroke();
        g.restore();
      }
    }

    // text both drums print (subhead, labels, NO.) — overprint = legible dark
    function inkBoth(g, t, fill) {
      const tq = q(t);
      if (sub && tq >= tSub) subRuns.forEach((r, i) => K.drawRun(g, r, subX(r), subBases[i], { fill }));
      if (labels.length && tq >= tLabels) labRuns.forEach((r, i) => K.drawRun(g, r, labX[i], labBase, { fill }));
      if (issue && tq >= tBadge) {
        g.save();
        g.translate(badge.x, badge.y); g.rotate(-0.14); g.translate(-badge.x, -badge.y);
        K.drawRun(g, bNo, badge.x - bNo.advance / 2, badge.y - badge.r * 0.34, { fill });
        g.restore();
      }
    }

    // press thunk: the sheet jolts a hair on each stamp
    const thunkTimes = [...sIn, tSub, tBadge].filter((x) => x != null);
    const jolt = (t) => thunkTimes.reduce((a, t0) => (t >= t0 && t - t0 < 0.12 ? a + Math.sin(((t - t0) / 0.12) * Math.PI) * thunk * unit : a), 0);

    [
      [B(0.6), 'disc rolling'],
      [B(1.8), 'disc printed'],
      [B(2.7), 'hero rolling'],
      [B(4.08), 'stamp thunk'],
      [B(5.5), 'stamps'],
      [B(7.4), 'all stamps'],
      [B(8.3), 'subhead'],
      [B(9.1), 'badge thunk'],
      [B(10.5), 'labels'],
      [B(12.5), 'pass'],
      [B(14.5), 'pass'],
      [D - 1 / fps, 'last frame'],
    ].forEach(([t, l]) => qa.keyframe(t, l));

    return {
      draw(g, t) {
        const p = passOf(t);
        const [ax, ay] = mis(p, 'a'), [bx, by] = mis(p, 'b');
        const j = jolt(t);
        g.save();
        g.translate(0, j);
        g.globalCompositeOperation = 'multiply';
        g.save(); g.translate(ax, ay); inkA(g, t); inkBoth(g, t, P.a); g.restore();
        g.save(); g.translate(bx, by); inkB(g, t); inkBoth(g, t, P.b); g.restore();
        g.restore();
      },
      // paper grain is multiplicative and constant within a frame: apply once
      // per output frame after motion-blur averaging (identical result, ~4x cheaper)
      post(g, t) {
        if (params.grain > 0) K.grain(g, W, H, { seed, frame: passOf(t), amount: params.grain, mode: 'multiply', size: 256 });
      },
    };
  },
};
