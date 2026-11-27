// MARKER — the words are handwritten on the screen as he says them.
// Every word writes on left to right behind a wobbly marker edge, with a
// touch of ink bleed. Stressed words get the coach's pen: a yellow
// highlighter swipe, a red underline or a loose red circle, each a real
// stroke that draws itself (pressure-varying width, two passes like a felt
// tip). Hero moment: the key word scrawled huge in marker caps, then circled,
// then (in the free lower band) an arrow scribbled up toward the speaker —
// stopping short of his face. A top-band hero is written on the wall BEHIND
// him, circle and all, so his head sits in front of the ink.
export default {
  id: 'marker',
  summary: 'handwritten marker: words write on as spoken, key words circled/underlined/highlighted, scrawled hero + arrow to the speaker',
  fonts: ['hand', 'scrawl'],
  uppercase: false,
  palette: { bg: '#0E0E0E', ink: '#FFFFFF', a: '#FFE14D', b: '#FF3B30', shade: '#0A0A0A' },
  energy: { signature: { flash: 0.05 }, wild: { flash: 0.1 } },
  build(A) {
    const { K, P, unit, tall, W, H, capBig, capSmall, cxZone, safeTop, safeBottom, sizeFor, flow, giant, seed } = A;
    const fH = A.font('hand'), fS = A.font('scrawl');
    const space = capSmall * 0.5;
    const ease = (x) => K.smoothstep(0, 1, x);
    const nz = (...k) => K.noise1(seed, 'mk', ...k) * 2 - 1; // −1..1, deterministic
    // stressed words wear one of three pen marks, chosen per word
    const markOf = (w) => ['highlight', 'underline', 'circle'][Math.floor(K.noise1(seed, 'mark', w.i) * 3)];

    const shapeWord = (w) => (w.big
      ? K.shape(fS, w.text, { size: sizeFor(fS, capBig * 0.8), tracking: 10, kerning: 'metric' })
      : K.shape(fH, w.text, { size: sizeFor(fH, capSmall * 1.4), tracking: 0, kerning: 'metric' }));

    function layout(p) {
      const lay = flow(p, shapeWord, { space, leading: capSmall * 0.62, reshape: (w, fit) => K.shape(w.run.face, w.run.text, { size: w.run.size * fit, tracking: 0, kerning: 'metric' }) });
      for (const w of p.words) if (w.big) w.mark = markOf(w);
      if (p.hero) {
        const text = p.key.text.toUpperCase();
        const gi = giant(p, fS, { text, tracking: 0, width: A.split ? A.IW * 0.86 : W * (tall ? 0.8 : 0.66), capFrac: p.front ? (tall ? A.E.frontCap * 0.95 : 0.2) : undefined });
        p.scrawl = gi.run; p.gx = gi.x; p.gy = gi.y;
        // a slight hand tilt, per hero
        p.tilt = nz('tilt', p.k) * 0.05;
        if (p.front) {
          // the rest of the phrase is written around the scrawl in speaking order
          const ki = p.words.indexOf(p.key);
          const lineOf = (ws) => {
            if (!ws.length) return null;
            const mk = (f) => ws.map((w) => K.shape(fH, w.text, { size: sizeFor(fH, capSmall * 1.45 * f), tracking: 0, kerning: 'metric' }));
            let runs = mk(1), sp = space, width = runs.reduce((a, r, i) => a + r.advance + (i ? sp : 0), 0);
            if (width > A.IW) { const f = A.IW / width; runs = mk(f); sp = space * f; width = runs.reduce((a, r, i) => a + r.advance + (i ? sp : 0), 0); } // fits the column
            let x = cxZone - width / 2;
            return ws.map((w, i) => { const it = { w, run: runs[i], x }; x += runs[i].advance + sp; return it; });
          };
          const gap = capSmall * 1.05; // room for the circle
          p.pre = lineOf(p.words.slice(0, ki));
          p.post = lineOf(p.words.slice(ki + 1));
          const place = () => {
            if (p.pre) p.pre.forEach((it) => (it.y = p.gy - p.scrawl.capPx - gap));
            if (p.post) p.post.forEach((it) => (it.y = p.gy + gap + it.run.capPx));
          };
          place();
          const bottom = p.post ? p.post[0].y + p.post[0].run.inkBottom : p.gy + gap * 0.6;
          if (bottom > safeBottom) { p.gy -= bottom - safeBottom; place(); }
          const top = p.pre ? p.pre[0].y - p.pre[0].run.capPx : p.gy - p.scrawl.capPx - gap * 0.6;
          if (top < safeTop) { p.gy += safeTop - top; place(); }
        }
      }
      return { ...lay, fg: P.ink, bg: P.shade };
    }

    // ── strokes: a felt-tip ribbon with pressure, revealed along its length ──
    function ribbon(g, pts, f, { width, color, alpha = 1, key, taper = 0.45 }) {
      if (f <= 0.001 || pts.length < 2) return;
      const L = [0];
      for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const total = L[L.length - 1], cut = total * Math.min(1, f);
      const left = [], right = [];
      for (let i = 0; i < pts.length; i++) {
        let [x, y] = pts[i];
        let s = L[i];
        if (s > cut) {
          // interpolate the final point exactly at the cut
          const r = (cut - L[i - 1]) / Math.max(1e-6, L[i] - L[i - 1]);
          x = pts[i - 1][0] + (x - pts[i - 1][0]) * r; y = pts[i - 1][1] + (y - pts[i - 1][1]) * r; s = cut;
        }
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        let nx = -(b[1] - a[1]), ny = b[0] - a[0];
        const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
        const u = s / total;
        const press = 1 - taper + taper * Math.sin(Math.PI * Math.min(1, Math.max(0, u)));
        const wv = width * press * (0.9 + 0.2 * K.noise1(seed, 'press', key, i)) / 2;
        left.push([x + nx * wv, y + ny * wv]); right.push([x - nx * wv, y - ny * wv]);
        if (s >= cut) break;
      }
      g.save();
      g.globalAlpha = alpha;
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(left[0][0], left[0][1]);
      for (const q of left) g.lineTo(q[0], q[1]);
      for (let i = right.length - 1; i >= 0; i--) g.lineTo(right[i][0], right[i][1]);
      g.closePath();
      g.fill();
      g.restore();
    }
    // two passes, like a real marker going over its own line
    const stroke2 = (g, pts, f, o) => {
      ribbon(g, pts, f, o);
      const off = pts.map(([x, y], i) => [x + nz(o.key, 'p2x', i >> 2) * o.width * 0.18, y + nz(o.key, 'p2y', i >> 2) * o.width * 0.18]);
      ribbon(g, off, f * 0.97, { ...o, width: o.width * 0.7, alpha: (o.alpha ?? 1) * 0.55, key: o.key + '2' });
    };
    // a loose hand circle round a box: 1.1 turns, starting top-left, slightly spiralling
    const circlePts = (b, key, pad = 1) => {
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      // loose, but the whole ring stays on screen (it is a mark, not a crop)
      const room = Math.max(20 * unit, Math.min(cx, W - cx) - 18 * unit) / 1.09;
      const rx = Math.min(((b.x1 - b.x0) / 2) * 1.14 + 16 * unit * pad, room), ry = ((b.y1 - b.y0) / 2) * 1.35 + 14 * unit * pad;
      const a0 = -2.5 + nz(key, 'a0') * 0.35, sweep = Math.PI * 2 * 1.1, n = 72;
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const u = i / n, th = a0 + sweep * u;
        const wob = 1 + 0.035 * Math.sin(3 * th + nz(key, 'ph') * 3) + 0.02 * nz(key, 'j', i >> 3) + 0.05 * u;
        pts.push([cx + Math.cos(th) * rx * wob, cy + Math.sin(th) * ry * wob]);
      }
      return pts;
    };
    const underlinePts = (b, key) => {
      const n = 24, x0 = b.x0 - (b.x1 - b.x0) * 0.04, x1 = b.x1 + (b.x1 - b.x0) * 0.07;
      const y0 = b.y1 + 9 * unit, tilt = nz(key, 'tilt') * 6 * unit, sag = (5 + 4 * nz(key, 'sag')) * unit;
      const pts = [];
      for (let i = 0; i <= n; i++) { const u = i / n; pts.push([x0 + (x1 - x0) * u, y0 + tilt * u + Math.sin(Math.PI * u) * sag + nz(key, 'j', i >> 2) * 1.5 * unit]); }
      // the little flick at the end of a fast underline
      pts.push([x1 + 10 * unit, y0 + tilt - 8 * unit]);
      return pts;
    };
    const highlightPts = (b, key) => {
      const n = 16, x0 = b.x0 - 8 * unit, x1 = b.x1 + 8 * unit, y = (b.y0 + b.y1) / 2 + 2 * unit;
      const pts = [];
      for (let i = 0; i <= n; i++) { const u = i / n; pts.push([x0 + (x1 - x0) * u, y + nz(key, 'hy', i >> 2) * 3 * unit + (u - 0.5) * nz(key, 'tilt') * 8 * unit]); }
      return pts;
    };
    // an arrow scribbled from a to b (a curved shaft, then the two head strokes)
    function arrow(g, a, b, f, key) {
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
      const bend = 0.22 * (nz(key, 'bend') > 0 ? 1 : -1);
      const c = [mx - dy * bend, my + dx * bend];
      const shaft = [];
      for (let i = 0; i <= 28; i++) { const u = i / 28; shaft.push([(1 - u) * (1 - u) * a[0] + 2 * (1 - u) * u * c[0] + u * u * b[0], (1 - u) * (1 - u) * a[1] + 2 * (1 - u) * u * c[1] + u * u * b[1]]); }
      const w = 9 * unit;
      stroke2(g, shaft, ease(f / 0.7), { width: w, color: P.b, key: key + 'sh' });
      if (f <= 0.7) return;
      const hf = ease((f - 0.7) / 0.3);
      const tx = b[0] - c[0], ty = b[1] - c[1], tl = Math.hypot(tx, ty) || 1;
      const back = [-tx / tl, -ty / tl], hl = Math.min(70 * unit, len * 0.3);
      for (const s of [-1, 1]) {
        const ang = 0.5 * s, ca = Math.cos(ang), sa = Math.sin(ang);
        const d = [back[0] * ca - back[1] * sa, back[0] * sa + back[1] * ca];
        ribbon(g, [b, [b[0] + d[0] * hl * 0.5, b[1] + d[1] * hl * 0.5], [b[0] + d[0] * hl, b[1] + d[1] * hl]], hf, { width: w, color: P.b, key: key + 'h' + s, taper: 0.3 });
      }
    }

    // ── writing a word on: a wobbly marker edge sweeps left to right ─────────
    function writeRun(g, run, x, y, prog, { fill, key, bleed = true }) {
      if (prog <= 0.001) return;
      const x0 = x + run.inkLeft - 6 * unit, x1 = x + run.inkRight + 6 * unit;
      const top = y + run.inkTop - 12 * unit, bot = y + Math.max(run.inkBottom, 0) + 14 * unit;
      const clipped = prog < 0.999;
      g.save();
      if (clipped) {
        const xr = x0 + (x1 - x0) * prog;
        g.beginPath();
        g.moveTo(x0, top);
        const n = 6;
        for (let k = 0; k <= n; k++) g.lineTo(xr + nz(key, 'edge', k) * 7 * unit, top + (bot - top) * k / n);
        g.lineTo(x0, bot);
        g.closePath();
        g.clip();
      }
      if (bleed) K.drawRun(g, run, x, y, { fill, alpha: 0.3, blur: 2.2 * unit });
      K.drawRun(g, run, x, y, { fill });
      g.restore();
    }
    const writeDur = (w) => Math.min(0.32, Math.max(0.12, (w.end - w.start) * 0.7));
    const outOf = (tq, p, d = 0.16) => K.clamp((tq - (p.out - d)) / d);

    // a soft dark haze behind the block (never a box), so white ink reads on any footage
    function haze(g, b, a, luma = null) {
      if (!b || a <= 0.001) return;
      // bright footage (p.bgLuma, measured by the core) needs a denser backing
      const k = luma == null ? 1 : 1 + Math.max(0, luma - 0.35) * 1.8;
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, rx = (b.x1 - b.x0) / 2 + 80 * unit, ry = (b.y1 - b.y0) / 2 + 70 * unit;
      const hz = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      hz.addColorStop(0, K.rgba(P.shade, Math.min(0.85, 0.5 * k)));
      hz.addColorStop(0.6, K.rgba(P.shade, Math.min(0.6, 0.3 * k)));
      hz.addColorStop(1, K.rgba(P.shade, 0));
      g.save(); g.globalAlpha = a; g.translate(cx, cy); g.scale(rx, ry); g.fillStyle = hz; g.beginPath(); g.arc(0, 0, 1, 0, Math.PI * 2); g.fill(); g.restore();
    }

    const boxOf = (run, x, y) => ({ x0: x + run.inkLeft, x1: x + run.inkRight, y0: y + run.inkTop, y1: y + Math.max(run.inkBottom, run.inkTop * 0.05) });
    function drawWords(g, tq, p, items) {
      const o = 1 - outOf(tq, p);
      if (o <= 0.001) return;
      g.save(); g.globalAlpha = o;
      for (const it of items) {
        const w = it.w, d = tq - w.start;
        if (d < 0) continue;
        const prog = ease(d / writeDur(w));
        const bx = boxOf(it.run, it.x, it.y);
        const key = 'w' + w.i;
        const mark = it.markOverride ?? w.mark;
        // the pen mark follows the word: it starts as the word finishes
        const mf = K.clamp((d - writeDur(w) * 0.8) / 0.28);
        if (mark === 'highlight') ribbon(g, highlightPts(bx, key), ease(K.clamp(d / (writeDur(w) * 0.9))), { width: (bx.y1 - bx.y0) * 1.25, color: P.a, alpha: 0.92, key, taper: 0.12 });
        const fill = mark === 'highlight' ? '#141414' : w.big ? P.a : P.ink;
        if (mark !== 'highlight') K.drawRun(g, it.run, it.x + 2 * unit, it.y + 3 * unit, { fill: P.shade, alpha: 0.55 * prog, blur: 5 * unit });
        writeRun(g, it.run, it.x, it.y, prog, { fill, key, bleed: mark !== 'highlight' });
        if (mark === 'underline') stroke2(g, underlinePts(bx, key), ease(mf), { width: 7 * unit, color: P.b, key });
        else if (mark === 'circle') stroke2(g, circlePts(bx, key, 0.6), ease(mf * 0.85), { width: 6 * unit, color: P.b, key });
      }
      g.restore();
    }
    const itemsOf = (p) => p.words.map((w) => ({ w, run: w.run, x: w.x, y: w.y }));

    // the hero: scrawl the word, circle it, (front) an arrow toward him
    function drawHero(g, tq, p, { arrowToo }) {
      const d = tq - p.key.start;
      if (d < 0) return;
      const o = 1 - outOf(tq, p, 0.2);
      if (o <= 0.001) return;
      const run = p.scrawl;
      const cx = p.gx + (run.inkLeft + run.inkRight) / 2, cy = p.gy + (run.inkTop + run.inkBottom) / 2;
      g.save();
      g.globalAlpha = o;
      g.translate(cx, cy); g.rotate(p.tilt); g.translate(-cx, -cy);
      const prog = ease(d / 0.34);
      // a soft ink shadow keeps the scrawl readable on any wall (bright windows too)
      K.drawRun(g, run, p.gx + 4 * unit, p.gy + 6 * unit, { fill: P.shade, alpha: (p.front ? 0.6 : 0.7) * prog, blur: (p.front ? 10 : 12) * unit });
      if (!p.front) K.drawRun(g, run, p.gx, p.gy, { fill: P.shade, alpha: 0.45 * prog, blur: 22 * unit });
      writeRun(g, run, p.gx, p.gy, prog, { fill: p.front ? P.ink : P.a, key: 'hero' + p.k });
      const bx = boxOf(run, p.gx, p.gy);
      const cf = ease(K.clamp((d - 0.28) / 0.45));
      stroke2(g, circlePts(bx, 'hc' + p.k, 1.4), cf, { width: 11 * unit, color: P.b, key: 'hc' + p.k });
      g.restore();
      if (arrowToo) {
        // from the circle's upper corner toward the speaker, stopping short of the face
        const side = cx < W / 2 ? 1 : nz('side', p.k) > 0 ? 1 : -1;
        const a = [cx + side * (bx.x1 - bx.x0) * 0.42, bx.y0 - 26 * unit];
        const b = [W / 2 + side * W * 0.37, (tall ? 0.5 : 0.52) * H];
        if (b[1] < a[1] - 40 * unit) arrow(g, a, b, K.clamp((d - 0.6) / 0.35), 'ar' + p.k);
      }
    }

    return {
      layout,
      behind(g, t, tq, p) { if (p && p.hero && !p.front) drawHero(g, tq, p, { arrowToo: false }); },
      front(g, t, tq, p) {
        if (p.hero && p.front) {
          // around the circled hero, the other words stay plain (one mark per moment)
          const items = [...(p.pre || []), ...(p.post || [])].map((it) => ({ ...it, markOverride: 'none' }));
          haze(g, { x0: p.gx + p.scrawl.inkLeft, x1: p.gx + p.scrawl.inkRight, y0: (p.pre ? p.pre[0].y - p.pre[0].run.capPx : p.gy - p.scrawl.capPx), y1: p.post ? p.post[0].y : p.gy }, 1 - outOf(tq, p), p.bgLuma);
          drawHero(g, tq, p, { arrowToo: true });
          drawWords(g, tq, p, items);
          return;
        }
        haze(g, p.box, K.clamp((tq - p.start + 0.05) / 0.1) * (1 - outOf(tq, p)), p.bgLuma);
        // a top-band hero's word is circled in the caption too
        drawWords(g, tq, p, itemsOf(p).map((it) => (p.cover && it.w === p.key ? { ...it, markOverride: 'underline' } : it)));
      },
    };
  },
};
