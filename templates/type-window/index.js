// TYPE WINDOW — giant typography as the window onto your footage.
// Window mode: words fill the frame edge to edge on a solid ground and the
// footage plays ONLY inside the letterforms; then the camera flies through the
// thickest stem until the footage owns the frame full-bleed, and the frame
// collapses back into the next word's letterforms. Knockout mode: the footage
// plays full-frame and an accent plate wipes across it with the word cut out,
// so the letters are holes onto the video.
import * as K from '../../src/kit/index.js';
import { drawFit } from '../../src/kit/media.js';

// Beats per entry in window mode: in/hold (4) · fly-through (1) · full-bleed (3)
const HOLD = 4, FLY = 1, FULL = 3, PER = HOLD + FLY + FULL;
const STYLES = ['window', 'shutter', 'prism'];
const STYLE_PALETTE = {
  window: {},
  shutter: { bg: '#E9E4DA', ink: '#151515', a: '#151515', mute: '#5E594F' },
  prism: { bg: '#07070A', ink: '#F4F1EA', a: '#FF2E6A', b: '#2EC5FF', mute: '#8E8E8E' },
};

export default {
  id: 'type-window',
  version: '1.1.0',
  name: 'Type Window',
  description:
    'Giant words as windows onto your footage: video plays only inside the letterforms, the camera flies through a stem into full-bleed footage, then collapses into the next word. Knockout mode cuts the word out of an accent plate over full-frame video.',
  tags: ['footage', 'title', 'intro', 'music-video', 'mask', 'bold', 'social'],
  formats: ['vertical', 'square', 'portrait', 'landscape'],
  bpm: 100,
  duration: 18,
  loop: false,
  palette: { bg: '#0B0B0C', ink: '#F4F1EA', a: '#FF3B1F', b: '#2EC5FF', mute: '#8E8E8E' },
  paletteRoles: { bg: 'ground around the letters', ink: 'letter edge light, labels', a: 'plate (knockout), accent rule', mute: 'small labels' },
  fonts: {
    display: { family: 'Anton', weight: 400 },
    mono: { family: 'IBM Plex Mono', weight: 500 },
  },
  params: {
    media: 'clip',
    tracking: { display: -10, mono: 120 },
    edge: 0.55,
    dim: 0.18,
    labels: true,
    split: 'auto',
    style: 'window',
  },
  schema: {
    content: {
      type: 'object',
      additionalProperties: false,
      required: ['words'],
      properties: {
        words: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string', minLength: 1, maxLength: 28 }, description: 'Each entry 1–3 words; each fills the frame as a window onto the footage' },
        sub: { type: 'string', maxLength: 48, description: 'Small mono line under the final word' },
        mode: { enum: ['window', 'knockout'], description: 'window (default): footage inside the letters on a solid ground, with fly-through; knockout: accent plate with the word cut out over full-frame footage' },
      },
    },
    params: {
      type: 'object',
      additionalProperties: false,
      properties: {
        media: { type: 'string', description: 'spec.media id of the footage (default "clip")' },
        tracking: { type: 'object', properties: { display: { type: 'number' }, mono: { type: 'number' } }, additionalProperties: false },
        edge: { type: 'number', minimum: 0, maximum: 1, description: 'Hairline edge light around the letter windows (keeps letters legible over dark footage)' },
        dim: { type: 'number', minimum: 0, maximum: 0.9, description: 'Darken full-bleed footage' },
        labels: { type: 'boolean' },
        split: { enum: ['auto', 'never'], description: 'Vertical: split short single words into two stacked halves to fill the frame' },
        style: { enum: STYLES, description: 'window (colour footage in the letters, fly-through a stem) | shutter (paper ground, black-and-white footage, letters open through camera-shutter slats that click on the beat, blinds transitions) | prism (the letter window splits into pink/cyan tinted echoes that spread on the beat)' },
      },
    },
  },
  example: {
    template: 'type-window',
    name: 'type-window',
    format: 'vertical',
    bpm: 100,
    seed: 4,
    media: { clip: { src: '../fixtures/footage-abstract.mp4', loop: true } },
    content: { words: ['LOOK', 'CLOSER', 'IT WAS ALWAYS', 'HERE'], sub: 'KINETYPE — TYPE WINDOW', mode: 'window' },
  },
  notes: 'Needs spec.media with the footage id named by params.media (default "clip"). Short, fat words make the best windows; 1–3 words per entry. Vertical is the primary format for phone footage.',

  build(ctx) {
    const { W, H, params, content: C, fonts, beat, fps, qa } = ctx;
    const style = STYLES.includes(params.style) ? params.style : 'window';
    const userPal = ctx.spec.palette || {};
    for (const [k, v] of Object.entries(STYLE_PALETTE[style])) if (!(k in userPal)) ctx.palette[k] = v;
    const P = ctx.palette;
    const mono0 = style === 'shutter';
    const clip = ctx.media.get(params.media);
    const fD = fonts.get('display'), fM = fonts.get('mono');
    const unit = Math.min(W, H) / 1080;
    const M = Math.round(Math.min(W, H) * 0.06);
    const tall = ctx.aspect === 'vertical';
    const IW = W - 2 * M;
    const cx = W / 2, cy = H / 2;
    const B = (n) => beat.t(n);
    const spb = beat.beatLen(0);
    const mode = C.mode || 'window';
    const words = C.words;
    const n = words.length;
    const mono = (s, size) => K.shape(fM, s, { size, tracking: params.tracking.mono, kerning: 'metric' });

    // ── layout: every entry fills the frame; lines stacked full width ──────────
    const layoutEntry = (text) => {
      const ws = text.trim().split(/\s+/);
      let lines;
      // tall frames: a short single word splits into two stacked halves
      // (RE/AL) so the window fills the frame instead of a thin band
      if (tall && ws.length === 1 && params.split !== 'never' && [...ws[0]].length >= 4 && [...ws[0]].length <= 7) {
        const ch = [...ws[0]], h = Math.ceil(ch.length / 2);
        lines = [ch.slice(0, h).join(''), ch.slice(h).join('')];
      } else if (tall || ws.length > 2) lines = ws.length <= 3 ? ws : [ws.slice(0, Math.ceil(ws.length / 2)).join(' '), ws.slice(Math.ceil(ws.length / 2)).join(' ')];
      else lines = [ws.join(' ')];
      // try the single-line version in wide frames when it is not absurdly thin
      // knockout: a band, so live footage stays visible above and below the plate
      const maxH = H * (mode === 'knockout' ? (tall ? 0.56 : 0.6) : tall ? 0.8 : 0.78);
      const gap = Math.round(18 * unit);
      let runs = lines.map((l) => K.shape(fD, l, { size: K.fitSize(fD, l, IW, { tracking: params.tracking.display }), tracking: params.tracking.display }));
      let hh = K.stackHeight(runs, gap);
      if (hh > maxH) {
        const s = maxH / hh;
        runs = runs.map((r, i) => K.shape(fD, lines[i], { size: r.size * s, tracking: params.tracking.display }));
        hh = K.stackHeight(runs, gap * s);
      }
      const bases = K.stackInk(runs, { top: Math.round(cy - hh / 2), gap, grid: 2 });
      const items = runs.map((r, i) => ({ run: r, x: cx - (r.inkLeft + r.inkRight) / 2, y: bases[i] }));
      const path = new Path2D();
      items.forEach((it) => path.addPath(K.runPath(it.run, it.x, it.y)));
      // focal point: the thickest horizontal cross-section near the centre
      const oc = new OffscreenCanvas(8, 8).getContext('2d');
      let best = null;
      for (const it of items) {
        for (const f of [0.35, 0.5, 0.65]) {
          const y = it.y - it.run.capPx * f;
          let start = null;
          for (let x = it.x + it.run.inkLeft - 2; x <= it.x + it.run.inkRight + 2; x += 2) {
            const inside = oc.isPointInPath(path, x, y, 'nonzero');
            if (inside && start === null) start = x;
            if (!inside && start !== null) {
              const w = x - start, mx = (start + x) / 2;
              const score = Math.min(w, it.run.capPx * 0.6) - Math.hypot(mx - cx, y - cy) * 0.05;
              if (!best || score > best.score) best = { x: mx, y, w, score };
              start = null;
            }
          }
        }
      }
      const focal = best || { x: cx, y: cy, w: 40 };
      const flyEnd = (Math.hypot(W, H) * 1.25) / Math.max(6, focal.w / 2);
      const box = { x0: Math.min(...items.map((it) => it.x + it.run.inkLeft)), x1: Math.max(...items.map((it) => it.x + it.run.inkRight)), y0: items[0].y - items[0].run.capPx, y1: items[items.length - 1].y + Math.max(0, items[items.length - 1].run.inkBottom) };
      return { text, lines, items, path, focal, flyEnd, box };
    };
    const E = words.map(layoutEntry);
    E.forEach((e, i) => e.items.forEach((it, j) => qa.text(`word-${i + 1}-${j + 1}`, { box: K.runBox(it.run, it.x, it.y), size: it.run.capPx, fg: P.ink, bg: P.bg, bleed: true })));

    // ── timeline ──────────────────────────────────────────────────────────────
    const T0 = (i) => B(i * PER); // entry i begins (entry 0: slam; others: collapse lands here)
    const lastHold = 5;
    const duration = mode === 'knockout' ? B(n * 6 + 2) : T0(n - 1) + spb * (HOLD + lastHold);
    const subRun = C.sub ? mono(C.sub.toUpperCase(), 28 * unit) : null;
    const subY = Math.min(H - M - 20 * unit, E[n - 1].box.y1 + 70 * unit);
    if (subRun) qa.text('sub', { box: K.runBox(subRun, cx - subRun.advance / 2, subY), size: subRun.capPx, fg: P.ink, bg: P.bg });

    // shared: the footage itself, full frame, with a slow push so it never sits dead
    const drawFootage = (g, t, zoom = 1) => {
      g.save();
      if (mono0) g.filter = 'grayscale(1) contrast(1.18)';
      g.translate(cx, cy); g.scale(zoom, zoom); g.translate(-cx, -cy);
      clip.draw(g, t, { x: 0, y: 0, w: W, h: H });
      g.restore();
    };
    const edgeLight = (g, path, alpha) => {
      if (params.edge <= 0 || alpha <= 0.01) return;
      g.save();
      g.globalAlpha = params.edge * alpha;
      g.strokeStyle = P.ink;
      g.lineWidth = 1.6 * unit;
      g.stroke(path);
      g.restore();
    };
    // per-glyph slam path for the first entry (letters rise into place)
    const slamPath = (e, t, t0) => {
      const P2 = new Path2D();
      let k = 0;
      e.items.forEach((it) => {
        P2.addPath(K.runPath(it.run, it.x, it.y, {
          each: () => {
            const d = t - (t0 + (k++) * spb / 4);
            if (d <= 0) return { hidden: true };
            return { dy: (1 - K.springStep(d, 2.6, 0.62)) * H * 0.55 };
          },
        }));
      });
      return P2;
    };
    const scaled = (path, s, fx, fy) => K.transformPath(path, new DOMMatrix().translate(fx, fy).scale(s, s).translate(-fx, -fy));
    const flyScale = (u, end) => Math.exp(Math.log(end) * (0.22 * u + 0.78 * u * u * u));

    // labels: index + timecode, mono, only during window/full phases
    const labels = (g, t, i) => {
      if (!params.labels) return;
      const tq = K.frameQuant(t, fps);
      const a = K.clamp(K.springStep(t - 0.2, 2, 1));
      const l1 = mono(`${String(i + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}`, 18 * unit);
      const l2 = mono(`${tq.toFixed(2)}S`, 18 * unit);
      K.drawRun(g, l1, M, M + 18 * unit, { fill: P.mute, alpha: a });
      K.drawRun(g, l2, W - M - l2.advance, M + 18 * unit, { fill: P.mute, alpha: a });
    };

    // ── WINDOW MODE ──────────────────────────────────────────────────────────
    // shutter: vertical slats across the frame, each open by f (0..1)
    const slatPath = (open, count = 16) => {
      const P2 = new Path2D();
      const sw = W / count;
      for (let k = 0; k < count; k++) {
        const f = typeof open === 'function' ? open(k, count) : open;
        if (f <= 0.002) continue;
        // fully open slats overlap by a pixel so no hairline seams show at rest
        const w = f >= 0.995 ? sw + 1.5 : sw * f;
        P2.rect(k * sw + (sw - w) / 2, 0, w, H);
      }
      return P2;
    };
    // blinds: horizontal slats for full-bleed transitions
    const blinds = (open, count = 12) => {
      const P2 = new Path2D();
      const sh = H / count;
      for (let k = 0; k < count; k++) {
        const f = K.clamp(typeof open === 'function' ? open(k, count) : open);
        if (f <= 0.002) continue;
        P2.rect(0, k * sh, W, f >= 0.995 ? sh + 1.5 : sh * f);
      }
      return P2;
    };
    const click = (t, t0) => {
      // shutter click on each beat of the hold: slats snap to 70% and spring back open
      let v = 1;
      for (let b = 1; b < HOLD; b++) { const d = t - (t0 + b * spb); if (d >= 0 && d < 0.6) v = Math.min(v, 1 - 0.3 * Math.exp(-d * 9) * Math.cos(d * 26)); }
      return v;
    };
    function drawShutterLetters(g, t, e, t0) {
      g.fillStyle = P.bg; g.fillRect(0, 0, W, H);
      const c = click(t, t0);
      const slats = slatPath((k, N) => K.clamp(K.springStep(t - t0 - (k / N) * spb * 0.9, 3.2, 0.8)) * c, 18);
      g.save(); g.clip(e.path, 'nonzero'); g.clip(slats); drawFootage(g, t, 1.06); g.restore();
      // the letters' own outline stays printed on the paper, like a stencil
      g.save(); g.globalAlpha = 0.85; g.strokeStyle = P.ink; g.lineWidth = 2 * unit; g.stroke(e.path); g.restore();
    }
    function drawPrismLetters(g, t, e, path) {
      g.fillStyle = P.bg; g.fillRect(0, 0, W, H);
      const pulse = beat.pulse(t, 1, 5);
      const d = (18 + 34 * pulse) * unit;
      for (const [k, col] of [[2, P.b], [1, P.a]]) {
        const off = new DOMMatrix().translate(-d * k * 0.9, d * k * 0.55);
        const pk = K.transformPath(path, off);
        g.save(); g.clip(pk, 'nonzero');
        g.filter = 'grayscale(1)';
        drawFootage(g, t, 1.08);
        g.filter = 'none';
        g.globalCompositeOperation = 'multiply'; g.fillStyle = col; g.fillRect(0, 0, W, H);
        g.restore();
      }
      g.save(); g.clip(path, 'nonzero'); drawFootage(g, t, 1.08 + 0.02 * pulse); g.restore();
    }
    function drawWindow(g, t) {
      const i = Math.max(0, Math.min(n - 1, Math.floor(beat.b(t) / PER + 1e-9)));
      const e = E[i];
      const t0 = T0(i);
      const bl = (t - t0) / spb; // beats into the entry
      const last = i === n - 1;
      if (style === 'shutter') {
        if (!last && bl >= HOLD && bl < HOLD + FLY) {
          // blinds open from the letters onto the full frame
          const u = K.clamp((bl - HOLD) / FLY);
          drawShutterLetters(g, t, e, t0);
          g.save(); g.clip(blinds((k, N) => K.cubicOut(K.clamp(u * 1.6 - (k / N) * 0.6)))); drawFootage(g, t, 1.02); g.restore();
          return;
        }
        if (!last && bl >= HOLD + FLY) {
          const collapseAt = PER - 1;
          if (bl < collapseAt) { drawFootage(g, t, 1 + 0.02 * beat.pulse(t, 1, 6)); labels(g, t, i); return; }
          // blinds close down onto the paper, then the next word's slats take over
          const u = K.clamp(bl - collapseAt);
          g.fillStyle = P.bg; g.fillRect(0, 0, W, H);
          g.save(); g.clip(blinds((k, N) => 1 - K.cubicIn(K.clamp(u * 1.6 - (1 - k / N) * 0.6)))); drawFootage(g, t, 1.02); g.restore();
          return;
        }
        drawShutterLetters(g, t, e, t0);
        labels(g, t, i);
        if (last && subRun) {
          const a = K.clamp(K.springStep(t - (t0 + spb * 2), 3, 1));
          K.drawRun(g, subRun, cx - subRun.advance / 2, subY, { fill: P.ink, alpha: a });
        }
        return;
      }
      if (!last && bl >= HOLD && bl < HOLD + FLY) {
        // fly through the focal stem: footage floods the frame
        const u = K.clamp((bl - HOLD) / FLY);
        const s = flyScale(u, e.flyEnd);
        g.fillStyle = P.bg; g.fillRect(0, 0, W, H);
        g.save(); g.clip(scaled(e.path, s, e.focal.x, e.focal.y), 'nonzero');
        drawFootage(g, t, K.lerp(1.18, 1.0, K.cubicOut(u)));
        g.restore();
        edgeLight(g, scaled(e.path, s, e.focal.x, e.focal.y), 1 - u);
        return;
      }
      if (!last && bl >= HOLD + FLY) {
        // full bleed, then the next word collapses the frame back into letters
        const collapseAt = PER - 1;
        const nx = E[i + 1];
        if (bl < collapseAt) {
          drawFootage(g, t, 1 + 0.03 * beat.pulse(t, 1, 6));
          if (params.dim > 0) { g.fillStyle = P.bg; g.globalAlpha = params.dim; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
          labels(g, t, i);
          return;
        }
        const u = K.clamp(bl - collapseAt);
        const s = flyScale(1 - K.cubicInOut(u), nx.flyEnd);
        g.fillStyle = P.bg; g.fillRect(0, 0, W, H);
        g.save(); g.clip(scaled(nx.path, s, nx.focal.x, nx.focal.y), 'nonzero');
        drawFootage(g, t, K.lerp(1.0, 1.08, u));
        g.restore();
        edgeLight(g, scaled(nx.path, s, nx.focal.x, nx.focal.y), u);
        return;
      }
      // letters as windows
      const path = i === 0 ? slamPath(e, t, 0.05) : e.path;
      if (style === 'prism') drawPrismLetters(g, t, e, path);
      else {
        g.fillStyle = P.bg; g.fillRect(0, 0, W, H);
        g.save(); g.clip(path, 'nonzero');
        drawFootage(g, t, 1.08 + 0.02 * beat.pulse(t, 1, 6));
        g.restore();
      }
      edgeLight(g, path, 1);
      labels(g, t, i);
      if (last && subRun) {
        const a = K.clamp(K.springStep(t - (t0 + spb * 2), 3, 1));
        K.drawRun(g, subRun, cx - subRun.advance / 2, subY, { fill: P.ink, alpha: a });
        const rw = subRun.advance * K.clamp(K.springStep(t - (t0 + spb * 2), 2.4, 0.9));
        K.bar(g, cx - rw / 2, subY + 22 * unit, rw, 3 * unit, P.a);
      }
    }

    // ── KNOCKOUT MODE ────────────────────────────────────────────────────────
    const KB = 6; // beats per entry
    const plateOf = (e) => {
      const pad = Math.round(Math.max(30 * unit, (e.box.y1 - e.box.y0) * 0.08));
      return { x: 0, y: e.box.y0 - pad, w: W, h: e.box.y1 - e.box.y0 + pad * 2 };
    };
    function drawKnockout(g, t) {
      drawFootage(g, t, 1.04 + 0.03 * beat.pulse(t, 1, 5));
      if (params.dim > 0) { g.fillStyle = P.bg; g.globalAlpha = params.dim * 0.6; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
      const bi = beat.b(t);
      const i = Math.max(0, Math.min(n - 1, Math.floor((bi - 1) / KB)));
      for (const j of [i - 1, i]) {
        if (j < 0) continue;
        const e = E[j];
        const tin = B(1 + j * KB), tout = j < n - 1 ? B(1 + (j + 1) * KB) : Infinity;
        if (t < tin) continue;
        const pin = K.springStep(t - tin, 2.8, 0.86);
        const pout = K.springStep(t - tout, 3.2, 0.9);
        if (pout >= 1) continue;
        const pl = plateOf(e);
        // plate wipes in from the left and out to the right; the word is a hole
        const x0 = W * pout, x1 = W * K.clamp(pin, 0, 1.02);
        if (x1 - x0 <= 0.5) continue;
        g.save();
        g.beginPath(); g.rect(x0, 0, x1 - x0, H); g.clip();
        const plate = new Path2D();
        plate.rect(pl.x, pl.y, pl.w, pl.h);
        plate.addPath(e.path);
        g.fillStyle = P.a;
        g.fill(plate, 'evenodd');
        g.restore();
        // leading edge: a bright ink blade on the wipe
        const edge = pout > 0.001 ? x0 : x1;
        if (edge > 0.5 && edge < W - 0.5) K.bar(g, edge - 3 * unit, pl.y, 6 * unit, pl.h, P.ink);
      }
      labels(g, t, i);
      if (subRun && i === n - 1) {
        const a = K.clamp(K.springStep(t - B(1 + (n - 1) * KB + 2), 3, 1));
        const y = Math.min(H - M - 20 * unit, plateOf(E[n - 1]).y + plateOf(E[n - 1]).h + 60 * unit);
        K.drawRun(g, subRun, cx - subRun.advance / 2, y, { fill: P.ink, alpha: a });
      }
    }

    // ── QA + keyframes ───────────────────────────────────────────────────────
    const kf = [[0, 'open']];
    if (mode === 'window') {
      for (let i = 0; i < n; i++) {
        qa.hit(T0(i), `entry ${i + 1}`);
        kf.push([T0(i) + spb * (i === 0 ? 2 : 1.5), `${i + 1}: window`]);
        if (i < n - 1) {
          qa.hit(B(i * PER + HOLD), 'fly');
          qa.hit(B(i * PER + HOLD + FLY), 'full bleed');
          qa.hit(B(i * PER + PER - 1), 'collapse');
          kf.push([B(i * PER + HOLD + 0.55), `${i + 1}: fly-through`]);
          kf.push([B(i * PER + HOLD + FLY + 1.2), `${i + 1}: full bleed`]);
          kf.push([B(i * PER + PER - 0.45), `${i + 1}: collapse`]);
        }
      }
    } else {
      for (let i = 0; i < n; i++) {
        qa.hit(B(1 + i * KB), `plate ${i + 1}`);
        kf.push([B(1 + i * KB) + 0.12, `${i + 1}: wipe`]);
        kf.push([B(1 + i * KB) + spb * 3, `${i + 1}: hold`]);
      }
    }
    kf.push([duration - 1 / fps, 'last frame']);
    kf.forEach(([t, l]) => qa.keyframe(Math.min(t, duration - 1 / fps), l));
    qa.note(`mode ${mode}; ${n} entries; duration ${duration.toFixed(2)}s`);

    return {
      duration,
      samplesHint(t) {
        if (mode !== 'window') return 0;
        const bl = beat.b(t) % PER;
        if (style === 'shutter') return bl >= HOLD && bl < HOLD + FLY ? 12 : bl >= PER - 1 ? 12 : 0;
        return bl >= HOLD && bl < HOLD + FLY ? 32 : bl >= PER - 1 ? 24 : 0;
      },
      draw(g, t) {
        if (mode === 'knockout') drawKnockout(g, t);
        else drawWindow(g, t);
      },
    };
  },
};
