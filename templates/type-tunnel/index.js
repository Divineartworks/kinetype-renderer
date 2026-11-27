// TYPE TUNNEL — a perspective flight through typography.
// Rings of words circle the camera axis at spaced depths; every glyph is a
// billboard projected with true perspective and fogged into the ground. The
// camera's forward speed SURGES on every beat (a spring on each beat's
// distance increment, so position stays continuous and only velocity kicks),
// it rolls on the bars, and rings counter-spin. At the end a giant finale word
// waits in the dark: the camera flies THROUGH its thickest stroke — the
// letterforms are windows onto the lockup — and lands hard on it.
import * as K from '../../src/kit/index.js';
import { mixHex } from '../../src/kit/x-3d.js';

const STYLES = ['rings', 'helix', 'corridor'];
const STYLE_PALETTE = {
  rings: {},
  helix: { bg: '#05070F', ink: '#E6ECFF', a: '#3D7BFF' },
  corridor: { bg: '#0B0907', ink: '#F1E4CC', a: '#FFB21A' },
};

export default {
  id: 'type-tunnel',
  version: '1.1.0',
  name: 'Type Tunnel',
  description:
    'Pseudo-3D flight down a tunnel of word rings: perspective glyph billboards with depth fog, beat-surging camera speed, bar rolls, counter-spinning rings, then a fly-through the finale word\'s own letterform into a hard lockup. 28 beats (14s at 120 BPM).',
  tags: ['3d', 'intro', 'hype', 'promo', 'music', 'tunnel', 'bold', 'social'],
  formats: ['square', 'landscape', 'vertical', 'portrait'],
  bpm: 120,
  duration: 14,
  loop: false,
  palette: { bg: '#07070A', ink: '#EDEDED', a: '#FF4A1C' },
  paletteRoles: { bg: 'background and depth fog', ink: 'ring words, lockup', a: 'accent rings, lockup rule' },
  fonts: {
    ring: { family: 'Anton', weight: 400 },
    display: { family: 'Anton', weight: 400 },
    mono: { family: 'IBM Plex Mono', weight: 500 },
  },
  params: {
    style: 'rings',
    accentEvery: 4,
    speed: 1,
    surge: 1,
    roll: 1,
    spin: 1,
    tracking: 40,
    glow: 0,
    loop: false,
  },
  schema: {
    content: {
      type: 'object',
      additionalProperties: false,
      required: ['words', 'finale'],
      properties: {
        words: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 16 }, description: 'Ring words, cycled ring by ring. Short uppercase words read best.' },
        finale: { type: 'string', minLength: 1, maxLength: 24, description: 'The word(s) you fly through and land on (1–3 words).' },
        sub: { type: 'string', maxLength: 40, description: 'Optional mono line typed under the lockup.' },
      },
    },
    params: {
      type: 'object',
      additionalProperties: false,
      properties: {
        style: { enum: STYLES, description: 'rings (counter-spinning word rings, bar rolls) | helix (a single twisting ribbon of type spirals around the flight path) | corridor (a square hallway: words run flat along floor, walls and ceiling, sliding toward you)' },
        accentEvery: { type: 'integer', minimum: 0, maximum: 12, description: 'Every Nth ring in the accent colour (0 = none).' },
        speed: { type: 'number', minimum: 0.3, maximum: 3, description: 'Cruise speed multiplier.' },
        surge: { type: 'number', minimum: 0, maximum: 3, description: 'Per-beat surge strength.' },
        roll: { type: 'number', minimum: 0, maximum: 3, description: 'Camera roll on bars.' },
        spin: { type: 'number', minimum: 0, maximum: 3, description: 'Ring counter-spin.' },
        tracking: { type: 'number', minimum: -50, maximum: 300 },
        glow: { type: 'number', minimum: 0, maximum: 1, description: 'Neon bloom around the type (0 = off): soft outer glow plus a tight halo, tinted toward palette.a' },
        loop: { type: 'boolean', description: 'Frame 0 = the lockup (seamless loop via a hard cut into the tunnel).' },
        subScale: { type: 'number', minimum: 0.5, maximum: 2, description: 'Tagline size multiplier (default 1 ≈ 22% of the lockup cap height, capped to its width).' },
      },
    },
  },
  example: {
    template: 'type-tunnel',
    name: 'type-tunnel',
    format: 'square',
    fps: 60,
    duration: 14,
    bpm: 120,
    seed: 5,
    content: { words: ['FASTER', 'DEEPER', 'LOUDER', 'NO BRAKES'], finale: 'ARRIVE', sub: 'SEASON 02 — OUT NOW' },
    rules: { beatCoverage: { dense: 16, then: 2, until: 22 } },
  },
  notes: 'Best with 3–6 short ring words and a 1-word finale with at least one straight vertical stroke (I, T, H, L, E, N...) — the camera flies through its thickest stroke.',

  build(ctx) {
    const { W, H, palette: P, params, content: C, fonts, beat, seed, qa, fps } = ctx;
    const style = STYLES.includes(params.style) ? params.style : 'rings';
    const userPal = ctx.spec.palette || {};
    for (const [k, v] of Object.entries(STYLE_PALETTE[style])) if (!(k in userPal)) P[k] = v;
    const helix = style === 'helix', corridor = style === 'corridor';
    const totalBeats = Math.round((ctx.duration * beat.bpm) / 60);
    const bs = totalBeats / 28;
    const B = (n) => beat.t(n * bs);
    const D = ctx.duration;
    const loop = !!(ctx.spec.loop ?? params.loop);
    const unit = Math.min(W, H) / 1080;
    const cx = W / 2, cy = H / 2;
    const M = Math.round(Math.min(W, H) * 0.0667);
    const fR = fonts.get('ring'), fD = fonts.get('display'), fM = fonts.get('mono');
    const q = (t) => K.frameQuant(t, fps);

    // ── world ────────────────────────────────────────────────────────────────
    const f = Math.max(W, H) * 0.42; // focal length in px
    const R = 1; // tunnel radius (world units)
    const capH = 0.2; // glyph cap height (world)
    const SP = 0.85; // ring spacing
    const NEAR = 0.12, FAR = 13;
    const upw = capH / fR.capHeight; // world units per font unit

    // ── camera: cruise + one spring-smoothed forward step per beat ───────────
    const tGate = B(22); // camera crosses the finale plane on beat 22
    const surgeBeats = [];
    for (let n = 1; n < 22; n++) surgeBeats.push(B(n));
    const cruise = 0.9 * params.speed;
    const step = 0.55 * params.surge;
    const camZ0 = (t) => {
      let z = cruise * t;
      for (const tb of surgeBeats) z += step * K.springStep(t - tb, 2.6, 0.9);
      return z;
    };
    const zGate = camZ0(tGate);
    const camZ = (t) => (t < tGate ? camZ0(t) : zGate + (t - tGate) * 4);
    surgeBeats.forEach((tb) => qa.hit(tb, 'surge'));
    qa.hit(0, 'launch');

    // roll on bars (alternating), counter-spinning rings
    const roll = new K.Track(0);
    // corridor: the hallway never rolls (walls are the horizon); helix: a slow continuous corkscrew
    if (helix) roll.ease(0, B(22), 0.6 * params.roll, K.sineInOut);
    else if (!corridor) for (let bar = 1; bar * 4 < 22; bar++) roll.spring(B(bar * 4), (bar % 2 ? 1 : -1) * 0.07 * params.roll, 'heavy');
    roll.spring(B(21), 0, 'glide');
    const spin = new K.Track(0);
    for (let bar = 0; bar * 4 < 22; bar++) spin.spring(B(bar * 4 + 2), (bar + 1) * 0.22 * params.spin, 'snap');

    // ── rings: repeat each word around the circumference ─────────────────────
    const words = C.words.map((w) => w.toUpperCase());
    const ringCache = new Map();
    const ringRun = (w) => {
      if (!ringCache.has(w)) ringCache.set(w, K.shape(fR, w + ' ', { size: fR.upm, tracking: params.tracking, kerning: 'metric' }));
      return ringCache.get(w);
    };
    const nRings = Math.ceil((zGate - 1.2) / SP) + 1;
    const rings = [];
    for (let k = 0; k < nRings; k++) {
      const z = 1.1 + k * SP;
      if (z > zGate - 0.3) break;
      const w = words[k % words.length];
      const run = ringRun(w);
      // glyph arc positions: one run advance in world units
      const advW = run.advance * upw; // font units → world (size = upm → 1 unit per font unit)
      const circ = corridor ? 8 * R * 0.86 : 2 * Math.PI * (R - capH * 0.5);
      const reps = Math.max(1, Math.floor(circ / advW));
      const gap = (circ - reps * advW) / reps;
      const glyphs = [];
      for (let r = 0; r < reps; r++) {
        for (const it of run.items) {
          if (!it.g.hasInk) continue;
          const arc = r * (advW + gap) + (it.x + it.adv / 2) * upw;
          // helix: only a ribbon (just over half the ring) survives; twisted per ring below
          if (helix && arc / circ > 0.56) continue;
          glyphs.push({ g: it.g, arc, halfAdv: (it.adv / 2) });
        }
      }
      const accent = params.accentEvery > 0 && k % params.accentEvery === params.accentEvery - 1;
      rings.push({ k, z, glyphs, accent, circ, dir: helix ? 1 : k % 2 ? 1 : -1, phase: helix ? z * 1.25 : K.noise1(seed, 'ring', k) * Math.PI * 2 });
    }

    // ── finale / gate ────────────────────────────────────────────────────────
    const finale = C.finale.toUpperCase();
    const IW = W - 2 * M;
    // lockup fits the width AND a cap-height ceiling (a wide frame must not
    // turn a short word into a wall)
    const lockSize = Math.min(K.fitSize(fD, finale, IW * 0.84, { tracking: 10 }), (Math.min(W, H) * 0.27 * fD.upm) / fD.capHeight);
    const lockRun = K.shape(fD, finale, { size: lockSize, tracking: 10 });
    const lockX = cx - (lockRun.inkLeft + lockRun.inkRight) / 2;
    // tagline: a real supporting line (~22% of the lockup cap), capped to the lockup width
    const subSize0 = Math.max(30 * unit, lockRun.capPx * 0.22) * (params.subScale ?? 1);
    const subProbe = C.sub ? K.shape(fM, C.sub.toUpperCase(), { size: subSize0, tracking: 60, kerning: 'metric' }) : null;
    const subSize = subProbe ? Math.min(subSize0, subSize0 * (lockRun.inkWidth * 0.9) / Math.max(1, subProbe.advance)) : 0;
    const subRun = C.sub ? K.shape(fM, C.sub.toUpperCase(), { size: subSize, tracking: 60, kerning: 'metric' }) : null;
    const ruleGap = Math.round(lockRun.capPx * 0.14), ruleH = Math.max(6 * unit, lockRun.capPx * 0.03);
    const blockH = lockRun.capPx + ruleGap + ruleH + (subRun ? ruleGap + subRun.capPx : 0);
    const lockBase = K.snap(cy - blockH / 2 + lockRun.capPx, 8);
    const ruleY = lockBase + ruleGap;
    const subY = ruleY + ruleH + ruleGap + (subRun ? subRun.capPx : 0);
    qa.text('finale', { box: K.runBox(lockRun, lockX, lockBase), size: lockRun.capPx, fg: P.ink, bg: P.bg });
    if (subRun) qa.text('sub', { box: K.runBox(subRun, cx - subRun.advance / 2, subY), size: subRun.capPx * 1.4, fg: P.ink, bg: P.bg });

    // the gate word in world space: centred so its thickest stroke sits on the axis
    const gateFontPx = lockRun.size; // same shape as the lockup: fly through → land on it
    const gatePath = K.runPath(lockRun, lockX, lockBase);
    let focal = { x: cx, y: lockBase - lockRun.capPx / 2, w: 20 };
    {
      const oc = new OffscreenCanvas(8, 8).getContext('2d');
      let best = null;
      for (const fy of [0.4, 0.5, 0.6]) {
        const y = lockBase - lockRun.capPx * fy;
        let start = null;
        for (let x = lockX + lockRun.inkLeft - 2; x <= lockX + lockRun.inkRight + 2; x += 1) {
          const inside = oc.isPointInPath(gatePath, x, y, 'nonzero');
          if (inside && start === null) start = x;
          if (!inside && start !== null) {
            const wd = x - start, mx = (start + x) / 2;
            const score = Math.min(wd, lockRun.capPx * 0.4) - Math.abs(mx - cx) * 0.03;
            if (!best || score > best.score) best = { x: mx, y, w: wd, score };
            start = null;
          }
        }
      }
      if (best) focal = best;
    }
    qa.note(`fly-through stroke at ${focal.x.toFixed(0)},${focal.y.toFixed(0)} (${focal.w.toFixed(0)}px wide)`);
    // at the lockup the gate word is drawn 1:1 at distance dLock; its screen
    // scale is dLock/dz, centred on the focal stroke
    const dLock = 1.6;
    const gateScale = (t) => dLock / Math.max(1e-4, zGate - camZ(t));
    // the window covers the frame once the focal stroke is wider than the diagonal
    const coverScale = (Math.hypot(W, H) * 2.2) / Math.max(6, focal.w);

    // lockup landing: hard slam + rule + typed sub
    const tLand = tGate;
    qa.hit(tLand, 'land');
    const land = (t) => K.springStep(t - tLand, 2.8, 0.55);
    const ruleIn = new K.Track(0).spring(B(23), 1, 'lock');
    qa.hit(B(23), 'rule');
    const tSub = B(24);
    if (subRun) qa.hit(tSub, 'sub');

    function drawLockup(g, t, settled = false) {
      const p = settled ? 1 : land(t);
      g.save();
      const sc = 1 + (1 - p) * 0.35;
      g.translate(focal.x, focal.y); g.scale(sc, sc); g.translate(-focal.x, -focal.y);
      K.drawRun(g, lockRun, lockX, lockBase, { fill: P.ink });
      g.restore();
      const r = settled ? 1 : K.clamp(ruleIn.at(t));
      const rw = lockRun.inkWidth * 0.34 * r;
      K.bar(g, cx - rw / 2, ruleY, rw, ruleH, P.a);
      if (subRun) {
        const n = settled ? [...subRun.text].length : K.typed(subRun.text, q(t), tSub, 32, seed);
        if (n > 0) {
          const part = K.shape(fM, [...subRun.text].slice(0, n).join(''), { size: subRun.size, tracking: 60, kerning: 'metric' });
          K.drawRun(g, part, cx - subRun.advance / 2, subY, { fill: P.ink });
        }
      }
    }

    // ── tunnel rendering ─────────────────────────────────────────────────────
    function drawTunnel(g, t, czOverride, alphaMul = 1, ghost = czOverride != null) {
      const cz = czOverride ?? camZ(t);
      const rl = t == null ? 0 : roll.at(t), sp = t == null ? spin.at(tGate) + czOverride * 0.2 : spin.at(t);
      const vis = [];
      for (const ring of rings) {
        const dz = ring.z - cz;
        if (dz < NEAR || dz > FAR) continue;
        vis.push([ring, dz]);
      }
      vis.sort((a, b) => b[1] - a[1]); // far → near
      const cosR = Math.cos(rl), sinR = Math.sin(rl);
      for (const [ring, dz] of vis) {
        const persp = f / dz;
        const fog = K.clamp((dz - 1.2) / (FAR - 1.2));
        const nearFade = K.smoothstep(NEAR, NEAR * 3.2, dz);
        const base = ring.accent && !ghost ? P.a : P.ink;
        const fill = mixHex(base, P.bg, Math.pow(fog, 0.75));
        g.globalAlpha = nearFade * alphaMul;
        g.fillStyle = fill;
        const s = upw * persp; // px per font unit
        const theta0 = ring.phase + ring.dir * sp;
        const Path = new Path2D();
        for (const gl of ring.glyphs) {
          let wx, wy, rot;
          if (corridor) {
            // square hallway: walk the perimeter; words slide along the walls
            const h = R * 0.86, per = ring.circ;
            let sp2 = K.mod(gl.arc + ring.phase * h + ring.dir * sp * h * 1.4, per);
            const side = Math.floor(sp2 / (2 * h)), u = sp2 - side * 2 * h - h;
            // glyphs never wrap a corner: a letter folded across two walls reads as noise
            if (Math.abs(u) > h - gl.halfAdv * upw - capH * 1.05) continue; // + clear the adjacent wall's cap band
            // reading direction continues around the hallway: floor →, right wall ↑, ceiling ←, left wall ↓
            if (side === 0) { wx = u; wy = h; rot = 0; }
            else if (side === 1) { wx = h; wy = -u; rot = -Math.PI / 2; }
            else if (side === 2) { wx = -u; wy = -h; rot = Math.PI; }
            else { wx = -h; wy = u; rot = Math.PI / 2; }
            rot += rl;
          } else {
            const th = theta0 - gl.arc / (R - capH * 0.5);
            // baseline on the wall at radius R; tops point to the axis
            wx = R * Math.cos(th); wy = R * Math.sin(th);
            rot = th - Math.PI / 2 + rl;
          }
          let sx = wx * persp, sy = wy * persp;
          const rx = sx * cosR - sy * sinR, ry = sx * sinR + sy * cosR;
          if (Math.abs(rx) > W && Math.abs(ry) > H) continue;
          const m = new DOMMatrix().translate(cx + rx, cy + ry).rotate((rot * 180) / Math.PI).scale(s, s).translate(-gl.halfAdv, 0);
          Path.addPath(gl.g.path2d, m);
        }
        g.fill(Path);
      }
      g.globalAlpha = 1;
    }

    // after landing, the tunnel keeps drifting far behind the lockup, barely there
    const ghostEnd = D - 0.5;
    function drawGhost(g, t) {
      const u = Math.min(t, ghostEnd) - tGate;
      const a = 0.075 * K.clamp(u / 0.6);
      if (a <= 0.005) return;
      g.save();
      g.globalAlpha = a;
      drawTunnel(g, null, 2.2 + u * 0.35, a);
      g.restore();
    }

    function drawGateFar(g, t) {
      // the finale word hanging at the end of the tunnel, fogged by distance
      const gs = gateScale(t);
      const dz = zGate - camZ(t);
      const fog = K.clamp((dz - 1.2) / (FAR - 1.2));
      const a = 1 - K.smoothstep(FAR * 0.8, FAR, dz);
      if (a <= 0) return;
      const m = new DOMMatrix().translate(cx, cy).scale(gs, gs).translate(-focal.x, -focal.y);
      g.save();
      g.globalAlpha = a;
      // the gate heats from ink to accent as the camera closes in
      const heat = K.smoothstep(3.2, 1.1, dz);
      g.fillStyle = mixHex(mixHex(P.ink, P.a, heat), P.bg, Math.pow(fog, 0.75));
      g.fill(K.transformPath(gatePath, m));
      g.restore();
    }

    const keyframes = [
      [0, 'launch'], [B(1.3), 'first surge'], [B(4.5), 'bar roll'], [B(8.2), 'cruise'], [B(12.4), 'accent ring'],
      [B(16.3), 'deep'], [B(19.5), 'finale in sight'], [B(21.2), 'gate'], [tGate - 0.12, 'through the stroke'],
      [tGate - 0.04, 'window'], [tGate + 0.1, 'land'], [B(23.5), 'rule'], [B(25.5), 'sub'], [D - 1 / fps, 'last frame'],
    ];
    keyframes.forEach(([t, l]) => qa.keyframe(Math.max(0, t), l));

    return {
      loop,
      samplesHint: (t) => (t > tGate - 0.5 && t < tGate + 0.25 ? 24 : 8),
      draw(g, t) {
        if (loop && t <= 0) { drawGhost(g, D); return drawLockup(g, t, true); }
        if (t >= tGate) {
          drawGhost(g, t);
          return drawLockup(g, t);
        }
        const gs = gateScale(t);
        // through the stroke: the frame floods with the accent — the arrival hit
        if (gs > coverScale) { g.fillStyle = P.a; g.fillRect(0, 0, W, H); return; }
        drawGateFar(g, t);
        drawTunnel(g, t);
      },
      // neon bloom, except on the frames where the whole screen floods with the accent (it would blow out)
      post(g, t) { K.bloom(g, { amount: t < tGate && gateScale(t) > coverScale ? 0 : K.glowAmount(params), color: P.a, unit }); },
    };
  },
};
