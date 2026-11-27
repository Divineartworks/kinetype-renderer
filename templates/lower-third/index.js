// LOWER THIRD — broadcast name super for overlaying on footage.
// Renders on a transparent ground (ProRes 4444 / VP9 alpha). Three styles:
//   broadcast  plate system with a racing accent edge-light, name slam, typed
//              role, handle chip; hairline + soft shadow give the plate an
//              edge over dark footage.
//   editorial  no boxes: a soft scrim, a serif name rising through a line mask,
//              a hairline rule that draws, mono role + handle in small caps.
//   kinetic    skewed plates smash in on a whip, letters slam with overshoot,
//              the group whips out; for fast-cut, high-energy edits.
import * as K from '../../src/kit/index.js';

const BEATS = 12;
const STYLES = ['broadcast', 'editorial', 'kinetic'];
// palette defaults per style (only applied to tokens the spec does not set)
const STYLE_PALETTE = {
  broadcast: {},
  editorial: { plate: '#050505', ink: '#F7F4EE', accent: '#E8C27A', accentInk: '#E8C27A', chip: '#F7F4EE', chipInk: '#F7F4EE' },
  kinetic: { plate: '#111111', ink: '#FFFFFF', accent: '#FF3B30', accentInk: '#FFFFFF', chip: '#FFFFFF', chipInk: '#111111' },
};

export default {
  id: 'lower-third',
  version: '1.1.0',
  name: 'Lower Third',
  description:
    'Broadcast lower-third on a transparent background in three styles (broadcast plate system, editorial serif with scrim, kinetic skewed smash). Name, role, handle; clean build-out. Safe-area aware for 16:9 and 9:16.',
  tags: ['lower-third', 'overlay', 'alpha', 'broadcast', 'youtube', 'interview', 'name-super'],
  formats: ['landscape', 'vertical', 'square', 'landscape-4k'],
  bpm: 120,
  duration: 6,
  loop: false,
  palette: { bg: '#5E6268', plate: '#0F0F10', ink: '#F7F7F5', accent: '#FFD23F', accentInk: '#111111', chip: '#F7F7F5', chipInk: '#111111' },
  paletteRoles: {
    bg: 'preview ground only (not drawn when render.transparent)',
    plate: 'name plate (editorial: scrim)', ink: 'name text', accent: 'bar, edge-light, role plate (editorial: rule + role text)', accentInk: 'role text',
    chip: 'handle chip', chipInk: 'handle text',
  },
  fonts: {
    name: { family: 'Inter Tight', weight: 800 },
    role: { family: 'Inter Tight', weight: 500 },
    mono: { family: 'IBM Plex Mono', weight: 500 },
    serif: { family: 'Instrument Serif', weight: 400 },
  },
  params: {
    style: 'broadcast',
    preview: 'none',
    tracking: { name: -20, role: 0, mono: 10 },
    scale: 1,
  },
  schema: {
    content: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: {
        name: { type: 'string', maxLength: 32, description: 'Person / subject name (one line).' },
        role: { type: 'string', maxLength: 48, description: 'Title or role (one line, typed in).' },
        handle: { type: 'string', maxLength: 24, description: 'Social handle for the chip, e.g. "@techhalla".' },
        position: { enum: ['bottom-left', 'bottom-center', 'top-left'], description: 'Placement inside the title-safe area (9:16 avoids platform UI zones).' },
        uppercase: { type: 'boolean', description: 'Set the name in capitals (default false; kinetic defaults to true).' },
      },
    },
    params: {
      type: 'object',
      additionalProperties: false,
      properties: {
        style: { enum: STYLES, description: 'broadcast (plates + edge-light) | editorial (serif, scrim, hairline) | kinetic (skewed smash, whip out)' },
        preview: { enum: ['none', 'checker', 'busy', 'dark'], description: 'Opaque renders only: a checkerboard, busy pseudo-footage, or near-black footage ground to judge contrast.' },
        tracking: { type: 'object', properties: { name: { type: 'number' }, role: { type: 'number' }, mono: { type: 'number' } }, additionalProperties: false },
        scale: { type: 'number', minimum: 0.6, maximum: 1.6, description: 'Overall size multiplier' },
      },
    },
  },
  example: {
    template: 'lower-third',
    format: 'landscape',
    fps: 60,
    duration: 6,
    bpm: 120,
    seed: 2,
    content: { name: 'Sam Lund', role: 'Director, Studio North', handle: '@samlund', position: 'bottom-left' },
    params: { style: 'broadcast' },
    render: { transparent: true, formats: ['mov-alpha', 'webm'] },
  },
  notes: 'Render with render.transparent=true (formats mov-alpha / webm) to composite over footage. For a quick look without alpha, set render.transparent=false and params.preview="busy" or "dark". In 9:16 the group keeps clear of the bottom 20% and right 16% where platform UI sits. Styles change choreography, layout and palette defaults; spec.palette always wins.',

  build(ctx) {
    const { W, H, params, content: C, fonts, beat, qa, fps } = ctx;
    const style = STYLES.includes(params.style) ? params.style : 'broadcast';
    // style palette defaults, never overriding what the spec set
    const userPal = ctx.spec.palette || {};
    for (const [k, v] of Object.entries(STYLE_PALETTE[style])) if (!(k in userPal)) ctx.palette[k] = v;
    const P = ctx.palette;
    const tr = params.tracking;
    const fN = style === 'editorial' ? fonts.get('serif') : fonts.get('name');
    const fR = fonts.get('role'), fM = fonts.get('mono');
    const unit = (Math.min(W, H) / 1080) * (params.scale ?? 1);
    const vert = ctx.aspect === 'vertical';
    const totalBeats = Math.round((ctx.duration * beat.bpm) / 60);
    const bs = totalBeats / BEATS;
    const B = (n) => beat.t(n * bs);
    const S16 = (beat.spb * bs) / 4;
    const D = ctx.duration;
    const capSize = (face, cap) => (cap * face.upm) / face.capHeight;
    const hit = (t, l) => qa.hit(t, l);
    const pos = C.position || 'bottom-left';
    const upper = C.uppercase ?? style === 'kinetic';

    // ───────── type ─────────
    const nameText = upper ? C.name.toUpperCase() : C.name;
    const nCap = (style === 'editorial' ? (vert ? 76 : 72) : style === 'kinetic' ? (vert ? 64 : 60) : vert ? 60 : 56) * unit;
    const nameRun = K.shape(fN, nameText, { size: capSize(fN, nCap), tracking: style === 'editorial' ? -10 : tr.name });
    const monoRole = style === 'editorial';
    const rCap = (monoRole ? 22 : 27) * unit;
    const roleText = C.role ? (monoRole ? C.role.toUpperCase() : C.role) : '';
    const roleShape = (s) => (monoRole ? K.shape(fM, s, { size: capSize(fM, rCap), tracking: 140, kerning: 'metric' }) : K.shape(fR, s, { size: capSize(fR, rCap), tracking: tr.role }));
    const roleRun = C.role ? roleShape(roleText) : null;
    const hCap = (monoRole ? 22 : 25) * unit;
    const handleText = C.handle ? (monoRole ? C.handle.toUpperCase() : C.handle) : '';
    const handleRun = C.handle ? K.shape(fM, handleText, { size: capSize(fM, hCap), tracking: monoRole ? 140 : tr.mono, kerning: 'metric' }) : null;

    // ───────── geometry (group origin top-left) ─────────
    const skew = style === 'kinetic' ? -0.21 : 0; // radians, kinetic plates lean forward
    const lean = (h) => Math.tan(-skew) * h; // horizontal offset of a plate's top edge
    const barW = style === 'editorial' ? 0 : Math.round(12 * unit);
    const padX = Math.round((style === 'kinetic' ? 34 : 32) * unit);
    const nameH = Math.round(nCap + 2 * (style === 'editorial' ? 10 : 30) * unit);
    const roleH = roleRun ? Math.round(rCap + 2 * (style === 'editorial' ? 12 : 17) * unit) : 0;
    const nameW0 = Math.round(padX * 2 + nameRun.inkWidth + 6 * unit + lean(nameH));
    const roleW = roleRun ? Math.round(padX * 2 + roleRun.inkWidth + lean(roleH)) : 0;
    const nameW = style === 'editorial' ? nameRun.inkWidth : Math.max(nameW0, roleW);
    const chipH = handleRun ? roleH || Math.round(hCap + 34 * unit) : 0;
    const chipW = handleRun ? Math.round(24 * unit * 2 + handleRun.advance + lean(chipH)) : 0;
    const chipGap = Math.round(8 * unit);
    const edGap = Math.round(22 * unit); // editorial: name → rule → role spacing
    const edRoleW = style === 'editorial' ? (roleRun ? roleRun.advance : 0) + (handleRun ? Math.round(28 * unit) + handleRun.advance : 0) : 0;
    const safeX = Math.round(W * (vert ? 0.075 : 0.08)), safeTop = Math.round(H * (vert ? 0.12 : 0.1));
    // 9:16: if role + chip side by side would reach the platform's right-hand
    // UI rail, the chip drops UNDER the role plate instead of being clipped.
    const chipBelow = vert && style !== 'editorial' && !!handleRun && !!roleRun && safeX + barW + roleW + chipGap + chipW > W * 0.84;
    const groupW = style === 'editorial' ? Math.max(nameW, edRoleW) : barW + Math.max(nameW, chipBelow ? Math.max(roleW, chipW) : roleW + (handleRun ? chipGap + chipW : 0));
    const groupH = style === 'editorial' ? nameH + edGap * 2 + (roleRun || handleRun ? roleH : 0) : nameH + (roleRun || handleRun ? (chipBelow ? roleH + chipGap + chipH : Math.max(roleH, chipH)) : 0);

    const safeBottom = Math.round(H * (vert ? 0.2 : 0.1));
    let gx, gy;
    if (pos === 'top-left') { gx = safeX; gy = safeTop; }
    else if (pos === 'bottom-center') { gx = Math.round((W - groupW) / 2); gy = H - safeBottom - groupH; }
    else { gx = safeX; gy = H - safeBottom - groupH; }
    if (vert && gx + groupW > W * 0.84) qa.warn(`lower-third: group (${Math.round(groupW)}px) reaches into the right-side UI zone of 9:16; shorten name/role or lower params.scale`);

    const x0 = gx + barW;
    const nameBase = gy + Math.round(nameH / 2 + nCap / 2);
    const roleY0 = gy + nameH;
    const roleBase = roleY0 + Math.round(roleH / 2 + rCap / 2);
    const chipY0 = chipBelow ? roleY0 + roleH + chipGap : roleY0;
    const chipX = chipBelow ? x0 : x0 + roleW + chipGap, chipBase = chipY0 + Math.round(chipH / 2 + hCap / 2);
    // editorial layout
    const edRuleY = gy + nameH + edGap;
    const edRoleBase = edRuleY + edGap + Math.round(rCap);

    // ───────── timeline ─────────
    const fast = style === 'kinetic';
    const T = fast
      ? { bar: B(0), name: B(0.25), nameText: B(0.5), role: B(1.25), roleText: B(1.5), chip: B(2.25), outChip: B(9), outRole: B(9.25), outName: B(9.5), outBar: B(9.5) }
      : { bar: B(0), name: B(0.5), nameText: B(1), role: B(2), roleText: B(2.25), chip: B(3), outChip: B(8.5), outRole: B(9), outName: B(9.5), outBar: B(10) };
    hit(T.bar, 'bar'); hit(T.nameText, 'name slam'); if (roleRun) hit(T.role, 'role'); if (handleRun) hit(T.chip, 'chip');
    hit(T.outChip, 'out'); hit(T.outName, 'name out'); hit(T.outBar, 'bar out');
    const barGrow = new K.Track(0).spring(T.bar, 1, { f: 3, z: 0.8 }).spring(T.outBar, 0, { f: 3.2, z: 1 });
    const nameWipe = new K.Track(0).spring(T.name, 1, fast ? { f: 4.6, z: 0.7 } : { f: 2.6, z: 0.78 }).spring(T.outName, 0, { f: 2.8, z: 1 });
    const roleWipe = new K.Track(0).spring(T.role, 1, fast ? { f: 4.2, z: 0.72 } : { f: 2.8, z: 0.8 }).spring(T.outRole, 0, { f: 3, z: 1 });
    const chipPop = new K.Track(0).spring(T.chip, 1, { f: 3.6, z: 0.62 }).spring(T.outChip, 0, { f: 4, z: 1 });
    // kinetic: whole group whips out left on the last beat
    const whipOut = new K.Track(0).spring(T.outName, 1, { f: 3.2, z: 0.9 });
    const whipIn = new K.Track(-1).spring(T.name, 0, { f: 4.4, z: 0.66 });

    // QA: contrast against the plate / scrim, not the (absent) ground
    const nameBg = P.plate, nameX = style === 'editorial' ? gx - nameRun.inkLeft : x0 + padX - nameRun.inkLeft;
    qa.text('name', { box: K.runBox(nameRun, nameX, nameBase), size: nameRun.capPx, fg: P.ink, bg: nameBg });
    if (roleRun) {
      if (style === 'editorial') qa.text('role', { box: K.runBox(roleRun, gx, edRoleBase), size: roleRun.capPx * 1.4, fg: P.accentInk, bg: P.plate });
      else qa.text('role', { box: K.runBox(roleRun, x0 + padX - roleRun.inkLeft, roleBase), size: roleRun.capPx * 1.4, fg: P.accentInk, bg: P.accent });
    }
    if (handleRun) {
      if (style === 'editorial') qa.text('handle', { box: K.runBox(handleRun, gx + (roleRun ? roleRun.advance + 28 * unit : 0), edRoleBase), size: handleRun.capPx * 1.4, fg: P.chipInk, bg: P.plate });
      else qa.text('handle', { box: K.runBox(handleRun, chipX + 24 * unit, chipBase), size: handleRun.capPx * 1.4, fg: P.chipInk, bg: P.chip });
    }
    const kf = fast
      ? [[0, 'empty'], [B(0.35), 'smash in'], [B(0.7), 'letter slam'], [B(1.1), 'name set'], [B(1.6), 'role slide'], [B(2.5), 'chip'], [B(5), 'hold'], [B(9.35), 'whip out'], [B(9.7), 'whip out blur'], [D - 1 / fps, 'last frame']]
      : [[0, 'empty'], [B(0.4), 'bar'], [B(0.9), 'wipe + edge-light'], [B(1.35), 'name slam'], [B(2.5), 'role'], [B(3.3), 'chip'],
        [B(5), 'hold'], [B(8.8), 'out'], [B(9.6), 'plates out'], [B(10.3), 'bar out'], [D - 1 / fps, 'last frame']];
    kf.forEach(([t, l]) => qa.keyframe(t, l));

    // ───────── preview grounds (opaque renders only) ─────────
    function drawPreview(g) {
      if (ctx.transparent || params.preview === 'none') return;
      if (params.preview === 'checker') {
        const s = Math.round(32 * unit);
        for (let y = 0; y < H; y += s) for (let x = 0; x < W; x += s) if (((x / s) + (y / s)) % 2 === 0) K.bar(g, x, y, s, s, '#7A7E84');
        return;
      }
      const r = K.rng(ctx.seed, 'busy');
      const dark = params.preview === 'dark';
      for (let i = 0; i < 90; i++) {
        const v = Math.floor(dark ? r() * 46 : r() * 255);
        const hex = '#' + v.toString(16).padStart(2, '0').repeat(3);
        K.bar(g, r() * W - 100, r() * H - 100, 60 + r() * W * 0.35, 20 + r() * H * 0.3, hex);
      }
    }

    // a plate: rectangle (or parallelogram for kinetic), revealed left→right by `w` (0..1)
    function plate(g, x, y, w, h, fill, fullW, { shadow = false, edge = false } = {}) {
      if (w <= 0) return;
      const ww = fullW * w;
      g.save();
      if (shadow) {
        g.shadowColor = 'rgba(0,0,0,0.38)';
        g.shadowBlur = 26 * unit;
        g.shadowOffsetY = 6 * unit;
      }
      g.fillStyle = fill;
      g.beginPath();
      const l = lean(h);
      g.moveTo(x + l, y);
      g.lineTo(x + ww, y);
      g.lineTo(x + ww - l, y + h);
      g.lineTo(x, y + h);
      g.closePath();
      g.fill();
      g.restore();
      if (edge) {
        // hairline edge: separates a dark plate from near-black footage
        g.save();
        g.strokeStyle = 'rgba(255,255,255,0.16)';
        g.lineWidth = Math.max(1, 1.5 * unit);
        g.beginPath();
        g.moveTo(x + l, y + 0.5);
        g.lineTo(x + ww, y + 0.5);
        g.lineTo(x + ww - l, y + h - 0.5);
        g.lineTo(x, y + h - 0.5);
        g.closePath();
        g.stroke();
        g.restore();
      }
    }
    const clipPlate = (g, x, y, w, h) => {
      const l = lean(h);
      g.beginPath();
      g.moveTo(x + l, y); g.lineTo(x + w, y); g.lineTo(x + w - l, y + h); g.lineTo(x, y + h); g.closePath();
      g.clip();
    };

    function drawBroadcastOrKinetic(g, t) {
      const bar = K.clamp(barGrow.at(t), 0, 1.08);
      const nw = K.clamp(nameWipe.at(t), 0, 1.04);
      const rw = K.clamp(roleWipe.at(t), 0, 1.04);
      const cp = Math.max(0, chipPop.at(t));
      if (bar <= 0 && nw <= 0) return;
      g.save();
      if (fast) {
        // smash in from the left, whip out left
        const inX = whipIn.at(t) * (gx + groupW + 40 * unit);
        const outX = -whipOut.at(t) * (gx + groupW + 60 * unit);
        g.translate(inX + outX, 0);
      }
      // accent bar grows from its bottom edge
      const bh = groupH * bar;
      if (bar > 0) {
        g.save();
        if (fast) { g.translate(gx, gy + groupH); g.transform(1, 0, Math.tan(skew), 1, 0, 0); g.translate(-gx, -(gy + groupH)); }
        K.bar(g, gx, gy + groupH - bh, barW, bh, P.accent);
        g.restore();
      }
      // name plate wipes out of the bar
      if (nw > 0) {
        plate(g, x0, gy, K.clamp(nw, 0, 1), nameH, P.plate, nameW, { shadow: true, edge: true });
        if (!fast) {
          // racing edge-light: runs ahead of the wipe, settles as a top accent line
          const lead = K.clamp(nw * 1.18, 0, 1);
          K.bar(g, x0, gy, nameW * lead, Math.max(2, 3 * unit), P.accent);
        }
        g.save();
        clipPlate(g, x0, gy, nameW * K.clamp(nw, 0, 1.04), nameH);
        if (t >= T.nameText) {
          K.drawRun(g, nameRun, x0 + padX - nameRun.inkLeft, nameBase, {
            fill: P.ink,
            each: (it, k) => {
              if (fast) {
                const t0 = T.nameText + k * S16 * 0.35;
                if (t < t0) return { hidden: true };
                const p = K.springStep(t - t0, 4.2, 0.55);
                return { s: 1 + (1 - p) * 0.9, alpha: K.clamp(K.springStep(t - t0, 12, 1)), skewX: -skew * 0.5 };
              }
              const p = K.springStep(t - T.nameText - k * S16 * 0.18, 3.4, 0.72);
              return { dy: (1 - p) * nameH * 0.9 };
            },
          });
        }
        g.restore();
      }
      // role plate
      if (roleRun && rw > 0) {
        const rx = fast ? x0 + lean(roleH) * 0.5 + (1 - K.clamp(rw)) * 60 * unit : x0;
        plate(g, rx, roleY0, K.clamp(rw, 0, 1), roleH, P.accent, roleW, { shadow: !fast });
        const tq = K.frameQuant(t, fps);
        const n = fast ? [...C.role].length : K.typed(C.role, tq, T.roleText, 40, ctx.seed);
        const sub = [...C.role].slice(0, n).join('');
        g.save();
        clipPlate(g, rx, roleY0, roleW * K.clamp(rw, 0, 1.04), roleH);
        if (n > 0 && t >= T.roleText - (fast ? 0.2 : 0)) K.drawRun(g, roleShape(sub), rx + padX - roleRun.inkLeft, roleBase, { fill: P.accentInk });
        g.restore();
      }
      // handle chip
      if (handleRun && cp > 0.001) {
        g.save();
        g.translate(chipX, chipY0);
        g.scale(Math.min(cp, 1.06), 1);
        if (fast) {
          g.strokeStyle = P.chip;
          g.lineWidth = 2.5 * unit;
          g.beginPath();
          const l = lean(chipH);
          g.moveTo(l, 1); g.lineTo(chipW, 1); g.lineTo(chipW - l, chipH - 1); g.lineTo(0, chipH - 1); g.closePath();
          g.stroke();
        } else plate(g, 0, 0, 1, chipH, P.chip, chipW, { shadow: true });
        g.restore();
        if (cp > 0.5) K.drawRun(g, handleRun, chipX + 24 * unit + lean(chipH) * 0.5, chipBase, { fill: fast ? P.chip : P.chipInk, alpha: K.clamp((cp - 0.5) * 2) });
      }
      g.restore();
    }

    function drawEditorial(g, t) {
      const nIn = K.springStep(t - T.name, 1.4, 1);
      const nOut = K.springStep(t - T.outName, 1.6, 1);
      const rule = K.springStep(t - T.role, 1.6, 1) * (1 - K.springStep(t - T.outRole, 2, 1));
      const rIn = K.springStep(t - T.roleText, 1.8, 1) * (1 - K.springStep(t - T.outChip, 2, 1));
      if (nIn <= 0) return;
      // soft elliptical scrim for legibility over footage: no hard edges anywhere
      const scx = gx + groupW * 0.42, scy = gy + groupH * 0.5;
      const srx = groupW * 0.95 + 160 * unit, sry = groupH * 0.95 + 70 * unit;
      const sa = 0.7 * K.clamp(nIn * 1.4) * (1 - nOut);
      if (sa > 0.005) {
        const [r, gg, b] = K.hexToRgb(P.plate);
        g.save();
        g.translate(scx, scy);
        g.scale(1, sry / srx);
        const gr = g.createRadialGradient(0, 0, 0, 0, 0, srx);
        gr.addColorStop(0, `rgba(${r},${gg},${b},${sa})`);
        gr.addColorStop(0.45, `rgba(${r},${gg},${b},${sa * 0.82})`);
        gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
        g.fillStyle = gr;
        g.fillRect(-srx, -srx, srx * 2, srx * 2);
        g.restore();
      }
      // name rises through a line mask
      g.save();
      g.beginPath();
      g.rect(gx - 20 * unit, gy - 10 * unit, groupW + 60 * unit, nameH + 20 * unit);
      g.clip();
      const dy = (1 - nIn) * nameH * 0.85 + nOut * nameH * 0.3;
      K.drawRun(g, nameRun, gx - nameRun.inkLeft, nameBase + dy, { fill: P.ink, alpha: 1 - nOut, blur: (1 - nIn) * 3 * unit });
      g.restore();
      // hairline rule draws left → right
      if (rule > 0) K.bar(g, gx, edRuleY, Math.max(nameW, edRoleW) * rule, Math.max(1, 1.5 * unit), P.accent);
      // role + handle in spaced small caps
      if (rIn > 0) {
        const tq = K.frameQuant(t, fps);
        const n = K.typed(roleText, tq, T.roleText, 34, ctx.seed);
        if (roleRun && n > 0) K.drawRun(g, roleShape([...roleText].slice(0, n).join('')), gx - roleRun.inkLeft, edRoleBase, { fill: P.accentInk, alpha: K.clamp(rIn * 1.5) });
        if (handleRun && t >= T.chip) {
          const hx = gx + (roleRun ? roleRun.advance + 28 * unit : 0);
          K.drawRun(g, handleRun, hx, edRoleBase, { fill: P.chipInk, alpha: K.clamp(K.springStep(t - T.chip, 2, 1)) * K.clamp(rIn * 1.5) * 0.9 });
        }
      }
    }

    return {
      samplesHint: (t) => (fast && ((t > T.name - 0.01 && t < T.name + 0.3) || (t > T.outName - 0.01 && t < T.outName + 0.45)) ? 24 : 0),
      draw(g, t) {
        drawPreview(g);
        if (style === 'editorial') drawEditorial(g, t);
        else drawBroadcastOrKinetic(g, t);
      },
    };
  },
};
