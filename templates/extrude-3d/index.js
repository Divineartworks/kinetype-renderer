// EXTRUDE 3D — chunky extruded type swinging in space.
// Every glyph is a solid: its outline is stamped along a projected extrusion
// vector (dozens of layers, batched into shade bands — darker toward the
// back), the crisp face goes on last, and a hard long shadow falls behind.
// The extrusion vector is a function of each glyph's own rotation, so when a
// letter swings about its Y axis the face foreshortens and the side wall grows
// — at 90° you see only the slab. Cards change with a staggered flip: letters
// rotate edge-on and away, the next word rotates in and lands with a spring.
// Letters nod on every beat; the whole card sways on the bars.
import * as K from '../../src/kit/index.js';
import { extrusionLayers, shadeHex } from '../../src/kit/x-3d.js';

const HALF_PI = Math.PI / 2;
const STYLES = ['block', 'neon-tube', 'stone'];
const STYLE_PALETTE = {
  block: {},
  'neon-tube': { bg: '#07060B', face: '#FF3EA5', side: '#2DE2E6', side2: '#B6FF3B', ink: '#F4EFF6' },
  stone: { bg: '#D9D3C6', face: '#F1ECE2', side: '#6E685E', side2: '#8A6F52', ink: '#2A2722' },
};

export default {
  id: 'extrude-3d',
  version: '1.1.0',
  name: 'Extrude 3D',
  description:
    'Chunky extruded 3D type: solid letters with shaded side walls and a hard long shadow, swinging in space; words change with a staggered edge-on flip, letters nod on the beat and the card sways on bars.',
  tags: ['3d', 'bold', 'promo', 'intro', 'retro', 'social', 'loop'],
  formats: ['square', 'landscape', 'vertical', 'portrait'],
  bpm: 120,
  duration: 12,
  loop: false,
  palette: { bg: '#141414', face: '#F4EFE6', side: '#FF3B2F', side2: '#FFB400', ink: '#F4EFE6' },
  paletteRoles: { bg: 'background', face: 'letter faces', side: 'extrusion walls on odd cards (shaded toward the back)', side2: 'extrusion walls on even cards', ink: 'sub line' },
  fonts: {
    display: { family: 'Archivo Black', weight: 400 },
    mono: { family: 'IBM Plex Mono', weight: 500 },
  },
  params: {
    style: 'block',
    beatsPerCard: 4,
    depth: 0.7,
    layers: 40,
    shadow: 1.3,
    sway: 1,
    nod: 1,
    tracking: -10,
  },
  schema: {
    content: {
      type: 'object',
      additionalProperties: false,
      required: ['cards'],
      properties: {
        cards: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 20 }, description: 'One card per entry, 1–3 words each (balanced over up to 2 lines). The last card holds to the end.' },
        sub: { type: 'string', maxLength: 40, description: 'Optional flat mono line under the final card.' },
      },
    },
    params: {
      type: 'object',
      additionalProperties: false,
      properties: {
        style: { enum: STYLES, description: 'block (solid shaded walls, edge-on flips, long shadow) | neon-tube (glowing stroked letterforms, wireframe depth, flicker-on) | stone (light carved monoliths that rise and sink with heavy springs)' },
        beatsPerCard: { type: 'integer', minimum: 2, maximum: 16 },
        depth: { type: 'number', minimum: 0.1, maximum: 1, description: 'Extrusion depth as a fraction of cap height.' },
        layers: { type: 'integer', minimum: 8, maximum: 60, description: 'Extrusion layers (smoother walls, more cost).' },
        shadow: { type: 'number', minimum: 0, maximum: 4, description: 'Long-shadow length in cap heights (0 = none).' },
        sway: { type: 'number', minimum: 0, maximum: 3 },
        nod: { type: 'number', minimum: 0, maximum: 3, description: 'Per-beat letter nod strength.' },
        tracking: { type: 'number', minimum: -80, maximum: 200 },
      },
    },
  },
  example: {
    template: 'extrude-3d',
    name: 'extrude-3d',
    format: 'square',
    fps: 60,
    duration: 12,
    bpm: 120,
    seed: 3,
    content: { cards: ['MAKE IT', 'BIGGER', 'MAKE IT', 'LOUDER', 'MAKE IT 3D'], sub: 'THE SOLID ISSUE — NO. 3' },
    rules: { beatCoverage: { dense: 16, then: 2, until: 20 } },
  },
  notes: 'Chunky faces (Archivo Black, Anton) read best. Keep cards short: 1–2 words per line. The final card holds with a slow sway.',

  build(ctx) {
    const { W, H, palette: P, params, content: C, fonts, beat, seed, qa, fps } = ctx;
    const style = STYLES.includes(params.style) ? params.style : 'block';
    const userPal = ctx.spec.palette || {};
    for (const [k, v] of Object.entries(STYLE_PALETTE[style])) if (!(k in userPal)) P[k] = v;
    const neon = style === 'neon-tube', stone = style === 'stone';
    // stroked tubes need air between letters; stone reads slightly open too
    if (ctx.spec.params?.tracking == null) params.tracking = neon ? 70 : stone ? 10 : params.tracking;
    const D = ctx.duration;
    const unit = Math.min(W, H) / 1080;
    const cx = W / 2, cy = H / 2;
    const M = Math.round(Math.min(W, H) * 0.0667);
    const IW = W - 2 * M;
    const fD = fonts.get('display'), fM = fonts.get('mono');
    const q = (t) => K.frameQuant(t, fps);
    const S32 = beat.spb / 8;
    const bpc = params.beatsPerCard;

    // ── cards: balanced lines, fitted to width and a cap ceiling ─────────────
    const capMax = Math.min(W, H) * (ctx.aspect === 'landscape' ? 0.21 : ctx.aspect === 'vertical' ? 0.3 : 0.25);
    const cards = C.cards.map((text, ci) => {
      const words = text.toUpperCase().split(/\s+/);
      const lines = words.length > 1 && fD ? K.balanceLines(fD, words.join(' '), IW * 0.7, { size: fD.upm, tracking: params.tracking }) : [words.join(' ')];
      const useLines = lines.length > 2 ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : lines;
      let size = Infinity;
      for (const l of useLines) size = Math.min(size, K.fitSize(fD, l, IW * 0.8, { tracking: params.tracking }));
      size = Math.min(size, (capMax * fD.upm) / fD.capHeight);
      // height fit: lines + gaps + extrusion + shadow (+ sub) must fit the safe area
      {
        const n = useLines.length;
        const cap0 = (size * fD.capHeight) / fD.upm;
        const need = n * cap0 + (n - 1) * (cap0 * 0.34 + cap0 * params.depth * 0.5) + cap0 * params.depth + cap0 * params.shadow * 0.5
          + (ci === C.cards.length - 1 && C.sub ? cap0 * (0.6 + params.shadow * 0.72) : 0);
        const avail = H - 2 * Math.round(Math.min(W, H) * 0.08);
        if (need > avail) size *= avail / need;
      }
      const runs = useLines.map((l) => K.shape(fD, l, { size, tracking: params.tracking }));
      const cap = runs[0].capPx;
      const depth = cap * params.depth;
      const gap = cap * 0.34 + depth * 0.5;
      const blockH = runs.length * cap + (runs.length - 1) * gap;
      // shift the block up-left by half the extrusion so the SOLID is centred
      const offX = -depth * 0.3, offY = -depth * 0.3;
      const top = cy - blockH / 2 + offY - (ci === C.cards.length - 1 && C.sub ? cap * (0.3 + params.shadow * 0.36) : 0);
      const placed = runs.map((r, i) => ({ run: r, x: cx - (r.inkLeft + r.inkRight) / 2 + offX, y: K.snap(top + cap + i * (cap + gap), 2) }));
      let k0 = 0;
      for (const p of placed) { p.k0 = k0; k0 += p.run.inked.length; }
      return { ci, text, placed, cap, depth, n: k0, t0: beat.t(ci * bpc), t1: ci < C.cards.length - 1 ? beat.t((ci + 1) * bpc) : Infinity };
    });
    cards.forEach((c, i) => {
      qa.hit(c.t0, `card ${i + 1}`);
      c.placed.forEach((p, j) => qa.text(`card${i + 1}-${j}`, { box: K.runBox(p.run, p.x, p.y), size: p.run.capPx, fg: P.face, bg: neon ? P.bg : P.side }));
    });
    const last = cards[cards.length - 1];
    const subRun = C.sub ? K.shape(fM, C.sub.toUpperCase(), { size: Math.max(26 * unit, last.cap * 0.16), tracking: 60, kerning: 'metric' }) : null;
    // the sub sits clear of the long shadow's full drop (never on top of it)
    const lastBottom = last.placed[last.placed.length - 1].y + Math.max(last.depth * 0.5, params.shadow * last.cap * 0.72);
    const subY = lastBottom + last.cap * 0.22 + (subRun ? subRun.capPx : 0);
    const tSub = last.t0 + beat.spb * 2;
    if (subRun) {
      qa.text('sub', { box: K.runBox(subRun, cx - subRun.advance / 2, subY), size: subRun.capPx * 1.4, fg: P.ink, bg: P.bg });
      qa.hit(tSub, 'sub');
    }
    // every beat is a nod
    const totalBeats = Math.floor(D / beat.spb);
    for (let n = 0; n < totalBeats; n++) qa.hit(beat.t(n), 'nod');

    // ── motion ───────────────────────────────────────────────────────────────
    // resting pose shows the walls down-right; the whole card sways on bars
    const swayY = new K.Track(0.34), swayX = new K.Track(-0.24);
    for (let bar = 1; beat.t(bar * 4) < D; bar++) {
      const tb = beat.t(bar * 4);
      swayY.spring(tb, 0.34 + (bar % 2 ? -0.16 : 0.06) * params.sway, 'heavy');
      swayX.spring(tb + beat.spb, -0.24 + (bar % 2 ? 0.08 : -0.05) * params.sway, 'glide');
    }
    const flipInDur = beat.spb * 0.5;
    const glyphPose = (card, k, t) => {
      const tin = card.t0 + k * S32;
      if (t < tin) return null;
      if (stone) {
        // monoliths: rise from below on a heavy spring, sink away on the change
        const rise = 1 - K.springStep(t - tin, 1.3, 0.82);
        let dy = rise * H * 0.7;
        const tout = card.t1 - beat.spb * 0.6 + k * S32 * 0.6;
        if (t >= tout) {
          const u = K.clamp((t - tout) / (beat.spb * 0.45));
          dy += K.cubicIn(u) * H * 0.8;
          if (u >= 1) return null;
        }
        return { ry: swayY.at(t) * 0.45, rx: swayX.at(t) * 0.6, dy };
      }
      if (neon) {
        // tube flicker-on: deterministic on/off per frame for ~0.3 s, then steady
        const d = K.frameQuant(t, fps) - tin;
        if (d < 0.32 && K.noise1(seed, 'flick', k, Math.round(d * fps)) < 0.45 + d) return null;
      }
      // flip in: from edge-on (-90°) with an honest spring overshoot
      let ry = swayY.at(t) - HALF_PI * (1 - K.springStep(t - tin, 3.2, 0.62));
      let rx = swayX.at(t);
      // flip out: swing past edge-on and vanish
      const tout = card.t1 - beat.spb * 0.4 + k * S32 * 0.6;
      if (t >= tout) {
        const u = K.clamp((t - tout) / (beat.spb * 0.28));
        ry += (HALF_PI - ry) * K.cubicIn(u) + (u >= 1 ? 1 : 0);
        if (ry >= HALF_PI - 0.03) return null;
      }
      // beat nod: a quick tilt toward camera, rippling across the word
      rx += 0.16 * params.nod * (neon ? 0.5 : 1) * beat.pulse(t - k * 0.028, 1, 9) * (t > tin + flipInDur ? 1 : 0);
      ry = K.clamp(ry, -HALF_PI + 0.02, HALF_PI - 0.02);
      return { ry, rx };
    };

    // colours: side bands shade toward the back; long shadow is a darker ground
    const BANDS = 6;
    const bands = (hex) => Array.from({ length: BANDS }, (_, b) => shadeHex(hex, 0.92 - 0.5 * (b / (BANDS - 1))));
    const bandSets = [bands(P.side), bands(P.side2)];
    const shadowCol = shadeHex(P.bg, 0.45);

    function drawNeon(g, card, t) {
      const all = [];
      for (const p of card.placed) {
        all.push(...extrusionLayers({ run: p.run, x: p.x, y: p.y, depth: card.depth, layers: 3, base: { x: 0.16, y: 0.16 },
          glyphState: (it, kk) => glyphPose(card, p.k0 + kk, t) || { hidden: true } }));
      }
      if (!all.length) return;
      const w = Math.max(2, card.cap * 0.035);
      const wire = card.ci % 2 ? P.side2 : P.side;
      // wireframe depth: one receding tube behind the face
      for (const f of [0.55]) {
        const PW = new Path2D();
        for (const gl of all) PW.addPath(gl.it.g.path2d, gl.face(f));
        g.save();
        g.globalAlpha = 0.35 + 0.4 * (1 - f);
        g.lineWidth = (w * 0.45) / (card.placed[0].run.scale);
        g.strokeStyle = wire;
        g.lineJoin = 'round';
        // stroke in path space: scale-aware width via setTransform-free path
        g.lineWidth = w * 0.45;
        g.stroke(PW);
        g.restore();
      }
      const PF = new Path2D();
      for (const gl of all) PF.addPath(gl.it.g.path2d, gl.face(0));
      g.save();
      g.lineJoin = 'round';
      g.globalCompositeOperation = 'lighten';
      g.filter = `blur(${(w * 1.6).toFixed(1)}px)`;
      g.globalAlpha = 0.55;
      g.lineWidth = w * 2.6;
      g.strokeStyle = P.face;
      g.stroke(PF);
      g.filter = 'none';
      g.globalAlpha = 1;
      g.lineWidth = w;
      g.stroke(PF);
      g.lineWidth = w * 0.32;
      g.strokeStyle = P.ink;
      g.stroke(PF);
      g.restore();
    }

    function drawCard(g, card, t) {
      if (neon) return drawNeon(g, card, t);
      const L = params.layers;
      const bandCol = bandSets[card.ci % 2];
      const all = [];
      for (const p of card.placed) {
        const lay = extrusionLayers({
          run: p.run, x: p.x, y: p.y, depth: card.depth, layers: L, base: { x: 0.16, y: 0.16 },
          glyphState: (it, kk) => glyphPose(card, p.k0 + kk, t) || { hidden: true },
        });
        all.push(...lay);
      }
      if (!all.length) return;
      // long shadow: the extrusion continued far back, flat and dark
      if (params.shadow > 0) {
        const P2 = new Path2D();
        const shadowK = stone ? 0.45 : 1;
        // the light is fixed (upper-left): the shadow falls down-right from the
        // face's current silhouette, whatever the letter's own rotation
        // ~3px sweep steps: the shadow's diagonal edges stay clean, no staircase
        const len = params.shadow * card.cap * shadowK, steps = Math.ceil(len / Math.max(2, card.cap * 0.011));
        for (const gl of all) {
          const f0 = gl.face(0);
          for (let s = 1; s <= steps; s++) {
            const d = (len * s) / steps;
            P2.addPath(gl.it.g.path2d, new DOMMatrix().translate(d * 0.72, d * 0.72).multiply(f0));
          }
        }
        g.fillStyle = shadowCol;
        g.fill(P2);
      }
      // side walls, back band first (all walls sit behind all faces)
      for (let b = BANDS - 1; b >= 0; b--) {
        const P3 = new Path2D();
        const k0 = Math.floor((b * L) / BANDS) + 1, k1 = Math.floor(((b + 1) * L) / BANDS);
        for (const gl of all) for (let k = k1; k >= k0; k--) P3.addPath(gl.it.g.path2d, gl.face(k / L));
        g.fillStyle = bandCol[b];
        g.fill(P3);
      }
      // faces + a crisp edge where face meets wall
      const PF = new Path2D();
      for (const gl of all) PF.addPath(gl.it.g.path2d, gl.face(0));
      g.fillStyle = P.face;
      g.fill(PF);
      g.lineWidth = Math.max(1, card.cap * 0.008);
      g.strokeStyle = bandCol[0];
      g.stroke(PF);
    }

    [0, beat.t(0.3), beat.t(1.5), beat.t(bpc - 0.35), beat.t(bpc + 0.1), beat.t(bpc + 0.4), beat.t(bpc * 2 - 0.3), beat.t(bpc * 2 + 0.2), beat.t(bpc * 3 + 1.4), beat.t(bpc * 4 - 0.35), last.t0 + 0.25, last.t0 + beat.spb * 1.5, tSub + 0.8, D - 1 / fps]
      .filter((t) => t >= 0 && t < D)
      .forEach((t, i) => qa.keyframe(t, `k${i + 1}`));

    return {
      samplesHint: (t) => {
        for (const c of cards) if ((t > c.t0 - 0.02 && t < c.t0 + flipInDur + S32 * c.n) || (t > c.t1 - beat.spb * 0.5 && t < c.t1 + 0.05)) return 12;
        return 0;
      },
      draw(g, t) {
        for (const c of cards) if (t >= c.t0 && t < c.t1 + beat.spb) drawCard(g, c, t);
        if (subRun && t >= tSub) {
          const n = K.typed(subRun.text, q(t), tSub, 30, seed);
          if (n > 0) K.drawRun(g, K.shape(fM, [...subRun.text].slice(0, n).join(''), { size: subRun.size, tracking: 60, kerning: 'metric' }), cx - subRun.advance / 2, subY, { fill: P.ink });
        }
      },
    };
  },
};
