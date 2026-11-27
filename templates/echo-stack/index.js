// ECHO STACK — the giant-word repeat.
// One word (or two) set full-bleed and tiled into a wall of rows. Rows march
// on every beat with a per-row delay so the wall ripples; bar 1–2 alternates
// solid and outline rows, bar 3–4 goes all-outline while a solid accent band
// sweeps down through it; bar 5 hard-cuts to a clean lockup of the message,
// which holds to the end. Frame 0 IS the lockup, so the loop seam is the cut.
import * as K from '../../src/kit/index.js';

const SEC = { stack: 0, sweep: 8, lock: 16, end: 24 };
const STYLES = ['wall', 'strobe', 'outline-drift'];
// palette defaults per style (only applied to tokens the spec does not set)
const STYLE_PALETTE = {
  wall: {},
  strobe: { bg: '#0A0A0A', ink: '#F4F4F4', a: '#E8FF2E' },
  'outline-drift': { bg: '#0E0E10', ink: '#EDE8DE', a: '#C9A56B' },
};

export default {
  id: 'echo-stack',
  version: '1.1.0',
  name: 'Echo Stack',
  description:
    'Loopable hype wall: one giant word tiled full-bleed into rows that ripple on every beat, solid/outline alternation, an accent band sweeping through the outlines, then a hard cut to a clean message lockup. 24 beats (12s at 120 BPM).',
  tags: ['hype', 'promo', 'music', 'sports', 'loop', 'bold', 'social'],
  formats: ['square', 'vertical', 'portrait', 'landscape'],
  bpm: 120,
  duration: 12,
  loop: true,
  palette: { bg: '#0B0B0B', ink: '#F2F2F2', a: '#FF3B1F' },
  paletteRoles: { bg: 'background', ink: 'rows and lockup type', a: 'accent: sweep band, separators, lockup rule' },
  fonts: {
    display: { family: 'Anton', weight: 400 },
    mono: { family: 'IBM Plex Mono', weight: 500 },
  },
  params: {
    style: 'wall',
    rows: 0,
    tracking: 10,
    stroke: 2.5,
    tilt: 0,
    punch: 1.05,
  },
  schema: {
    content: {
      type: 'object',
      additionalProperties: false,
      required: ['words', 'message'],
      properties: {
        words: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'string', minLength: 1, maxLength: 14 }, description: 'The word(s) tiled into the wall. Two words alternate by row. Short and loud: 3–8 letters is ideal.' },
        message: { type: 'string', minLength: 1, maxLength: 40, description: 'The lockup line (auto-balanced over up to 3 lines).' },
        sub: { type: 'string', maxLength: 40, description: 'Optional mono sub-label under the lockup (date, venue, handle).' },
      },
    },
    params: {
      type: 'object',
      additionalProperties: false,
      properties: {
        style: { enum: STYLES, description: 'wall (rows march + ripple, accent sweep, hard cut) | strobe (beat-locked snaps, pattern inverts every beat, full-frame invert on bar downbeats, lines cut in one per beat) | outline-drift (hairline outlines drifting at constant speed, one solid row wandering bar by bar, lockup rises through blur)' },
        rows: { type: 'integer', minimum: 0, maximum: 24, description: 'Rows in the wall; 0 = auto by aspect (landscape 5, square 7, vertical 11).' },
        tracking: { type: 'number', minimum: -80, maximum: 200 },
        stroke: { type: 'number', minimum: 0.5, maximum: 12, description: 'Outline weight in px @1080.' },
        tilt: { type: 'number', minimum: -20, maximum: 20, description: 'Wall rotation in degrees.' },
        punch: { type: 'number', minimum: 1, maximum: 1.25, description: 'Camera punch-in on each bar downbeat.' },
      },
    },
  },
  example: {
    template: 'echo-stack',
    name: 'echo-stack',
    format: 'square',
    fps: 60,
    duration: 12,
    loop: true,
    bpm: 120,
    seed: 11,
    content: { words: ['LOUDER'], message: 'LOUDER THAN EVER', sub: 'FRI 21:00 — WAREHOUSE 9' },
    rules: { beatCoverage: { dense: 16, then: 2, until: 19 }, loopExact: true },
  },
  notes: 'Best with one 4–8 letter word. The wall bleeds off every edge by design (registered as bleed). Duration/bpm re-time all 24 beats proportionally.',

  build(ctx) {
    const { W, H, palette: P, params, content: C, fonts, beat, seed, qa, fps } = ctx;
    const style = STYLES.includes(params.style) ? params.style : 'wall';
    const userPal = ctx.spec.palette || {};
    for (const [k, v] of Object.entries(STYLE_PALETTE[style])) if (!(k in userPal)) P[k] = v;
    const strobe = style === 'strobe', drift = style === 'outline-drift';
    const totalBeats = Math.round((ctx.duration * beat.bpm) / 60);
    const bs = totalBeats / SEC.end;
    const B = (n) => beat.t(n * bs);
    const D = ctx.duration;
    const unit = Math.min(W, H) / 1080;
    const cx = W / 2, cy = H / 2;
    const M = Math.round(Math.min(W, H) * 0.0667);
    const IW = W - 2 * M;
    const fD = fonts.get('display'), fM = fonts.get('mono');
    const q = (t) => K.frameQuant(t, fps);
    const ink = P.ink, A = P.a;

    // ───────────── the wall ─────────────
    const rows = params.rows || (ctx.aspect === 'landscape' ? 5 : ctx.aspect === 'vertical' ? 11 : 7);
    const pitch = H / rows;
    const cap = pitch * (drift ? 0.7 : 0.84); // rows nearly touch: a wall, not a list (drift breathes more)
    const size = (cap / fD.capHeight) * fD.upm;
    const words = C.words.map((w) => w.toUpperCase());
    const runs = words.map((w) => K.shape(fD, w, { size, tracking: params.tracking }));
    const sepR = cap * 0.075, sepGap = cap * 0.42;
    const tileOf = (r) => runs[K.mod(r, runs.length)];
    const period = (run) => run.advance + sepGap * 2 + sepR * 2;
    const r0 = -1, r1 = rows + 1; // one bleed row above and below
    const baseY = (r) => (r + 0.5) * pitch + cap / 2; // baseline: cap centred in its pitch
    const step = cap * 1.15; // march per beat
    const ripple = beat.spb * bs * 0.09; // per-row delay → the ripple
    const march = new Map();
    for (let r = r0; r <= r1; r++) {
      const dir = r % 2 === 0 ? 1 : -1;
      const tk = new K.Track(K.noise1(seed, 'row', r) * period(tileOf(r)));
      if (drift) {
        // constant velocity: one step per beat, but linear — a slow conveyor, no hits
        tk.ease(B(0), B(SEC.lock) - B(0), tk.last + dir * step * SEC.lock * 0.55, (u) => u);
      } else if (strobe) {
        // hard, locked snaps on every beat (no ripple): the wall moves like a machine
        for (let n = 0; n < SEC.lock; n++) tk.spring(B(n), tk.last + dir * step * 1.6, 'lock');
      } else {
        for (let n = 0; n < SEC.lock; n++) tk.spring(B(n) + (r - r0) * ripple, tk.last + dir * step, { f: 3.4, z: 0.74 });
      }
      march.set(r, tk);
    }
    for (let n = 0; n < SEC.lock; n++) qa.hit(B(n), n === 0 ? 'cut to wall' : n === SEC.sweep ? 'outline flip' : 'march');
    const zoom = new K.Track(1);
    if (drift) zoom.ease(B(0), B(SEC.lock) - B(0), 1.12, K.sineInOut); // one long push, no punches
    else for (let n = 0; n < SEC.lock; n += 4) zoom.spring(B(n), strobe ? params.punch * 1.04 : params.punch, strobe ? 'whip' : 'slam').spring(B(n + 1), 1, 'glide');
    // strobe: full-frame invert on each bar downbeat (2 frames) — pure palette swap
    const flashes = [];
    if (strobe) for (let n = 4; n < SEC.lock; n += 4) flashes.push(B(n));
    const flashOn = (t) => flashes.some((f) => t >= f && t < f + 2 / fps);
    // drift: the one solid row wanders to a new row every bar
    const solidRow = (t) => {
      const bar = Math.floor(Math.max(0, beat.b(t) / bs) / 4);
      return Math.floor(K.noise1(seed, 'drift-row', bar) * rows);
    };
    // the accent band sweeps top → bottom one notch per beat through bars 3–4
    const sweepSteps = SEC.lock - SEC.sweep;
    const cellTop = (k) => k * pitch;
    const sweep = new K.Track(cellTop(-1.5));
    for (let n = 0; n < sweepSteps; n++) sweep.spring(B(SEC.sweep + n), cellTop(Math.round((n * (rows - 1)) / (sweepSteps - 1))), { f: 3.8, z: 0.8 });
    qa.text('wall', { box: { x0: 0, y0: 0, x1: W, y1: H }, size: cap, fg: ink, bg: P.bg, bleed: true, decorative: true });
    qa.note(`wall: ${rows} rows, cap ${cap.toFixed(0)}px, period ${period(runs[0]).toFixed(0)}px`);

    function drawRow(g, t, r, mode, cols = { ink, A, bg: P.bg }) {
      const run = tileOf(r);
      const { ink: INK, A: ACC, bg: BG } = cols;
      const per = period(run);
      const off = K.mod(march.get(r).at(t), per);
      const y = baseY(r);
      const reach = Math.max(W, H) * 0.5; // bleed so tilt never shows an edge
      for (let x = off - per * Math.ceil((reach + off) / per); x < W + reach; x += per) {
        if (mode === 'solid') K.drawRun(g, run, x, y, { fill: INK });
        else if (mode === 'accent') K.drawRun(g, run, x, y, { fill: ACC });
        else K.drawRun(g, run, x, y, { stroke: INK, strokeWidth: (drift ? 1.2 : params.stroke) * unit });
        if (drift) continue; // drift: no separators, pure outline rhythm
        g.fillStyle = mode === 'outline' ? INK : mode === 'accent' ? BG : ACC;
        g.beginPath();
        g.arc(x + run.advance + sepGap + sepR, y - cap / 2, sepR, 0, Math.PI * 2);
        g.fill();
      }
    }

    function drawWall(g, t) {
      g.save();
      const z = zoom.at(t);
      g.translate(cx, cy);
      g.rotate((params.tilt * Math.PI) / 180);
      g.scale(z, z);
      g.translate(-cx, -cy);
      const sweeping = t >= B(SEC.sweep);
      if (drift) {
        const sr = solidRow(t);
        for (let r = r0; r <= r1; r++) drawRow(g, t, r, r === sr ? 'accent' : 'outline');
        g.restore();
        return;
      }
      if (strobe) {
        // pattern inverts every beat; bar downbeats flip the whole frame
        const beatN = Math.floor(Math.max(0, beat.b(K.frameQuant(t, fps)) / bs));
        const inv = flashOn(t);
        const cols = inv ? { ink: P.bg, A: P.bg, bg: ink } : { ink, A, bg: P.bg };
        if (inv) { g.fillStyle = ink; g.fillRect(-W, -H, W * 3, H * 3); }
        for (let r = r0; r <= r1; r++) {
          const lit = K.mod(r + beatN, 2) === 0;
          const accentRow = !inv && K.mod(r, rows) === Math.floor(K.noise1(seed, 'strobe', beatN) * rows);
          drawRow(g, t, r, accentRow ? 'accent' : lit ? 'solid' : 'outline', cols);
        }
        g.restore();
        return;
      }
      for (let r = r0; r <= r1; r++) drawRow(g, t, r, sweeping ? 'outline' : K.mod(r, 2) === 0 ? 'solid' : 'outline');
      if (sweeping) {
        const y0 = sweep.at(t);
        g.save();
        g.beginPath();
        g.rect(-W, y0, W * 3, pitch);
        g.clip();
        g.fillStyle = P.bg;
        g.fillRect(-W, y0, W * 3, pitch);
        for (let r = r0; r <= r1; r++) drawRow(g, t, r, 'accent');
        g.restore();
      }
      g.restore();
    }

    // ───────────── the lockup (also frame 0) ─────────────
    const tLock = B(SEC.lock);
    const msg = C.message.toUpperCase();
    // Justified block: every line fitted to the same ink width, then the whole
    // block scaled to fit 58% of the height. Pick the line count whose
    // smallest line is biggest (legibility of the weakest line wins).
    const tr = params.tracking;
    const gapK = 0.16;
    let best = null;
    const ws = msg.split(/\s+/);
    for (let n = 1; n <= Math.min(ctx.aspect === "vertical" ? 4 : 3, ws.length); n++) {
      const probe = K.shape(fD, msg, { size: 100, tracking: tr });
      const lns = n === 1 ? [msg] : K.balanceLines(fD, msg, (probe.inkWidth / n) * 1.18, { size: 100, tracking: tr });
      if (lns.length !== n) continue;
      const sizes = lns.map((l) => K.fitSize(fD, l, IW, { tracking: tr }));
      const capK = fD.capHeight / fD.upm;
      const totalH = sizes.reduce((a, z) => a + z * capK, 0) * (1 + gapK) - sizes[0] * capK * gapK;
      const f = Math.min(1, (H * (ctx.aspect === 'vertical' ? 0.66 : 0.58)) / totalH);
      const minSize = Math.min(...sizes) * f;
      if (!best || minSize > best.minSize * 1.05) best = { minSize, lns, sizes: sizes.map((z) => z * f) };
    }
    const lines = best.lns;
    const lockRuns = lines.map((l, i) => K.shape(fD, l, { size: best.sizes[i], tracking: tr }));
    const lGap = Math.round(Math.min(...lockRuns.map((r) => r.capPx)) * gapK);
    const sub = C.sub ? C.sub.toUpperCase() : '';
    const subSize = Math.max(26 * unit, Math.min(40 * unit, (lockRuns[0].capPx * 0.13) / (fM.capHeight / fM.upm)));
    const subRun = sub ? K.shape(fM, sub, { size: subSize, tracking: 60, kerning: 'metric' }) : null;
    const ruleH = Math.max(6, Math.round(lockRuns[0].capPx * 0.09));
    const subGap = Math.round(lockRuns[0].capPx * 0.34);
    const blockH = K.stackHeight(lockRuns, lGap) + (subRun ? ruleH + subGap * 2 + subRun.capPx : 0);
    const lBases = K.stackInk(lockRuns, { top: K.snap(cy - blockH / 2, 8), gap: lGap });
    const lX = (run) => cx - (run.inkLeft + run.inkRight) / 2;
    const lastBase = lBases[lBases.length - 1];
    const blockW = Math.max(...lockRuns.map((r) => r.inkWidth));
    // clear of descenders (Arabic dots, g/y/p) — Latin caps without descenders are unchanged
    const ruleY = lastBase + Math.max(subGap, Math.round(lockRuns[lockRuns.length - 1].inkBottom + subGap * 0.45));
    const subBase = ruleY + ruleH + subGap + (subRun ? subRun.capPx : 0);
    const lockZoom = new K.Track(1.09).cut(0, 1.09).spring(tLock, 1, { f: 3.2, z: 1 });
    const ruleGrow = new K.Track(0).spring(B(SEC.lock + 2), 1, { f: 3, z: 0.86 });
    qa.hit(tLock, 'hard cut to lockup');
    if (strobe) lockRuns.forEach((_, i) => i > 0 && qa.hit(tLock + i * beat.spb * bs, 'line cut'));
    qa.hit(B(SEC.lock + 1), 'sub types');
    qa.hit(B(SEC.lock + 2), 'rule');
    lockRuns.forEach((r, i) => qa.text('lockup-' + i, { box: K.runBox(r, lX(r), lBases[i]), size: r.capPx, fg: ink, bg: P.bg, lines, orphanOk: true }));
    if (subRun) qa.text('sub', { box: K.runBox(subRun, cx - subRun.advance / 2, subBase), size: subRun.capPx, fg: ink, bg: P.bg });

    // per-line entrances: strobe cuts one line per beat; drift rises through blur
    const lineIn = lockRuns.map((_, i) => tLock + (strobe ? i * beat.spb * bs : drift ? i * beat.spb * bs * 0.5 : 0));
    function drawLock(g, t) {
      g.save();
      const z = lockZoom.at(t);
      g.translate(cx, cy);
      g.scale(z, z);
      g.translate(-cx, -cy);
      lockRuns.forEach((r, i) => {
        if (t < lineIn[i] && t > 0 && t < D - 1e-3) return; // strobe/drift: line not in yet
        if (drift && t > 0 && t < D - 1e-3) {
          const p = K.springStep(t - lineIn[i], 1.6, 1);
          K.drawRun(g, r, lX(r), lBases[i] + (1 - p) * r.capPx * 0.25, { fill: ink, alpha: K.clamp(p * 1.4), blur: (1 - K.clamp(p)) * 14 * unit });
        } else K.drawRun(g, r, lX(r), lBases[i], { fill: ink });
      });
      const gr = K.clamp(ruleGrow.at(t), 0, 1.02);
      if (gr > 0) K.bar(g, cx - (blockW / 2) * gr, ruleY, blockW * gr, ruleH, A);
      if (subRun) {
        const tq = q(t);
        const n = K.typed(sub, tq, B(SEC.lock + 1), 28, seed);
        if (n > 0) {
          const part = K.shape(fM, [...sub].slice(0, n).join(''), { size: subRun.size, tracking: 60, kerning: 'metric' });
          K.drawRun(g, part, cx - subRun.advance / 2, subBase, { fill: ink });
        }
      }
      g.restore();
    }

    [
      [0, 'loop frame = lockup'],
      [B(0.35), 'wall cut in'],
      [B(1.3), 'ripple'],
      [B(3.5), 'bar 1 end'],
      [B(4.15), 'bar punch'],
      [B(6.6), 'solid/outline'],
      [B(8.3), 'outline flip + sweep'],
      [B(10.5), 'sweep mid'],
      [B(13.2), 'sweep low'],
      [B(15.7), 'last march'],
      [B(16.05), 'hard cut'],
      [B(17.4), 'sub typing'],
      [B(18.6), 'rule'],
      [D - 1 / fps, 'last frame'],
    ].forEach(([t, l]) => qa.keyframe(t, l));

    return {
      draw(g, t) {
        if (t <= 0 || t >= tLock) return drawLock(g, t <= 0 ? D - 1e-4 : t);
        drawWall(g, t);
      },
    };
  },
};
