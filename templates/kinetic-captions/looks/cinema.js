// CINEMA — the episode as a film. The picture sits in a letterbox window
// (2.39:1 bars in landscape; in vertical a thin top bar and a deep bottom bar
// the subtitles live in, so the face is never cropped). Subtitles are mixed-case
// Cormorant Garamond: the whole line arrives dim and each word fills warm white
// with a feathered sweep as it is spoken; stressed words turn italic amber.
// Hero moment = a trailer title card: the bars close in, the room darkens while
// the speaker stays lit (person matte), the picture pushes in slowly, and the
// line re-sets as a title — lead-in in italic, the key word in widely tracked
// Cinzel caps drifting apart, cut by an anamorphic lens-flare streak.
// Teal/orange grade, vignette and grain are frame-static (post layer).
export default {
  id: 'cinema',
  summary: 'film: letterbox, serif subtitles that fill as spoken, trailer title card with lens flare',
  fonts: ['cinema', 'cinemaItalic', 'title'],
  palette: { bg: '#0A0806', ink: '#F3E7D3', a: '#E9A55B', b: '#5FB7C9', shade: '#000000' },
  uppercase: false,
  // the push-in is the look's own slow dolly, not the core's snap punch-in
  energy: { calm: { punch: 0, flash: 0 }, signature: { punch: 0, flash: 0 }, wild: { punch: 0, flash: 0, shake: 0 } },
  build(A) {
    const { K, P, W, H, unit, tall, land, split, panel, E, seed, fps, q, clip, grade, hasMatte, IW, cxZone, capSmall, safeTop, safeBottom, sizeFor, flow, wordIn } = A;
    const fC = A.font('cinema'), fI = A.font('cinemaItalic'), fT = A.font('title');
    const lvl = E.level ?? 1; // 0 calm · 1 signature · 2 wild
    const HERO = [
      { dim: 0.38, push: 0.035, bars: 0.5, flare: 0.7 },
      { dim: 0.58, push: 0.07, bars: 0.9, flare: 1 },
      { dim: 0.68, push: 0.11, bars: 1.15, flare: 1.2 },
    ][lvl];

    // ── letterbox geometry (design px) ──────────────────────────────────
    // vertical/square: thin top bar, deep bottom bar that holds the subtitles
    // landscape: classic 2.39:1 bars; split: none (the panel is the frame)
    const square = !tall && !land;
    // stage (no footage): thin film bars top and bottom, the type is the picture
    const stage = A.params.layout === 'stage';
    const topBar = split ? 0 : land ? Math.round((H - W / 2.39) / 2) : Math.round(H * (stage ? 0.05 : 0.045));
    const botTop = split ? H : land ? H - topBar : stage ? H - topBar : Math.round(H * (tall ? 0.72 : 0.76)); // top edge of the bottom bar
    const barClose = { top: split ? 0 : land ? H * 0.07 : H * 0.075, bot: split ? 0 : land ? H * 0.06 : H * 0.05 }; // extra bar on a hero (× HERO.bars)
    const subCy = split ? H / 2 : land ? H - topBar / 2 : tall ? H * 0.785 : H * 0.855;
    const cardCy = split ? H / 2 : land ? H * 0.66 : tall ? H * 0.745 : H * 0.8;

    const capSub = capSmall * (stage ? 1.3 : split ? 1.15 : land ? 1.2 : 1.05);
    const space = capSub * 0.34;
    const shapeWord = (w) => {
      const face = w.big ? fI : fC;
      return K.shape(face, w.text, { size: sizeFor(face, capSub * (w.big ? 1.06 : 1)), tracking: 0, kerning: 'metric' });
    };

    // ── hero envelope: slow in (anticipates the word), slow out ─────────
    const heroEnv = (hit) => {
      if (!hit) return 0;
      const inU = K.smoothstep(-0.05, 0.6, hit.d);
      const outU = 1 - K.smoothstep(hit.hold - 0.05, hit.hold + 0.5, hit.d);
      return inU * outU;
    };
    const dolly = (hit) => {
      if (!hit) return 0;
      // a slow push that keeps creeping for the whole hold (ease-out), then settles back
      const creep = K.clamp((hit.d + 0.3) / (hit.hold + 0.8));
      return HERO.push * (1 - (1 - creep) * (1 - creep)) * heroEnv(hit);
    };
    const pushRect = (r, z) => {
      const fx = r.x + r.w / 2, fy = r.y + r.h * (tall ? 0.3 : 0.4);
      return { x: fx - (fx - r.x) * (1 + z), y: fy - (fy - r.y) * (1 + z), w: r.w * (1 + z), h: r.h * (1 + z) };
    };

    // ── layout ────────────────────────────────────────────────────────────
    function layout(p) {
      // landscape: subtitles sit on the picture just above the bottom bar (film
      // style, with a soft shadow); vertical/square: inside the deep bottom bar
      const sceneCy = (p.scene?.cy ?? 0.5) * H;
      const lay = stage
        ? flow(p, shapeWord, { space, leading: capSub * 0.55 })
        : land && !split
          ? flow(p, shapeWord, { space, leading: capSub * 0.55, centerY: null, baseY: botTop - H * 0.05 })
          : flow(p, shapeWord, { space, leading: capSub * 0.55, centerY: subCy });
      if (!p.hero) return lay;
      // title card: lead-in (italic, small) · KEY (Cinzel caps, wide) · tail (italic, small)
      const ki = p.words.indexOf(p.key);
      const titleText = p.key.text.toUpperCase();
      const track = 260;
      const wmax = split ? IW : W * (tall ? 0.86 : 0.78);
      const capMax = split ? H * 0.14 : stage ? H * (tall ? 0.1 : 0.16) : tall ? H * 0.12 : land ? H * 0.17 : H * 0.13;
      const size = Math.min(sizeFor(fT, capMax), K.fitSize(fT, titleText, wmax / 1.06, { tracking: track }));
      const run = K.shape(fT, titleText, { size, tracking: track, kerning: 'metric' });
      const small = (ws) => {
        if (!ws.length) return null;
        const mk = (f) => ws.map((w) => K.shape(fI, w.text, { size: sizeFor(fI, capSub * 0.78 * f), tracking: 10, kerning: 'metric' }));
        let runs = mk(1), sp = capSub * 0.3;
        let width = runs.reduce((a, r, i) => a + r.advance + (i ? sp : 0), 0);
        if (width > IW) { const f = IW / width; runs = mk(f); sp *= f; width = runs.reduce((a, r, i) => a + r.advance + (i ? sp : 0), 0); } // fits the column
        let x = cxZone - width / 2;
        return ws.map((w, i) => { const it = { w, run: runs[i], x }; x += runs[i].advance + sp; return it; });
      };
      const pre = small(p.words.slice(0, ki)), post = small(p.words.slice(ki + 1));
      const gap = run.capPx * 0.55;
      const preH = pre ? pre[0].run.capPx + gap : 0, postH = post ? post[0].run.capPx + gap : 0;
      const blockH = preH + run.capPx + postH;
      let top = (stage ? sceneCy : cardCy) - blockH / 2;
      const floor = split ? H * 0.92 : safeBottom - 6 * unit;
      if (top + blockH > floor) top = floor - blockH;
      const ceil = stage ? safeTop : split ? H * 0.08 : land ? H * 0.42 : botTop - H * 0.07;
      if (top < ceil) top = ceil;
      const gy = top + preH + run.capPx;
      if (pre) pre.forEach((it) => (it.y = top + it.run.capPx));
      if (post) post.forEach((it) => (it.y = gy + gap + it.run.capPx));
      p.card = { run, x: cxZone - (run.inkLeft + run.inkRight) / 2, y: gy, pre, post };
      const items = [...(pre || []), ...(post || [])];
      const box = {
        x0: Math.min(p.card.x + run.inkLeft, ...items.map((it) => it.x + it.run.inkLeft)),
        x1: Math.max(p.card.x + run.inkRight, ...items.map((it) => it.x + it.run.inkRight)),
        y0: Math.min(gy + run.inkTop, ...items.map((it) => it.y + it.run.inkTop)),
        y1: Math.max(gy + run.inkBottom, ...items.map((it) => it.y + it.run.inkBottom)),
      };
      return { box, minCap: Math.min(run.capPx, ...items.map((it) => it.run.capPx)) };
    }

    // ── subtitles: whole line dim, each word fills with a feathered sweep ──
    function sweepWord(g, run, x, y, t, w, lit, dimA, A) {
      K.drawRun(g, run, x, y, { fill: P.ink, alpha: dimA * A });
      const prog = K.clamp((t - w.start) / Math.max(0.12, w.end - w.start));
      if (prog <= 0) return;
      if (prog >= 1) return K.drawRun(g, run, x, y, { fill: lit, alpha: A });
      const x0 = x + run.inkLeft, iw = run.inkWidth, F = run.size * 0.35;
      const edge = x0 + (iw + F) * prog;
      g.save(); g.beginPath(); g.rect(x0 - 4, y - run.size * 1.2, Math.max(0, edge - F - x0 + 4), run.size * 1.7); g.clip();
      K.drawRun(g, run, x, y, { fill: lit, alpha: A });
      g.restore();
      const N = 6;
      for (let k = 0; k < N; k++) {
        const sx = edge - F + (F * k) / N;
        g.save(); g.beginPath(); g.rect(sx, y - run.size * 1.2, F / N + 0.5, run.size * 1.7); g.clip();
        K.drawRun(g, run, x, y, { fill: lit, alpha: (1 - (k + 0.5) / N) * A });
        g.restore();
      }
    }
    function drawSubs(g, t, p) {
      const inU = K.clamp((t - p.start + 0.06) / 0.22);
      const outU = K.clamp((t - (p.out - 0.16)) / 0.16);
      const A = inU * (1 - outU);
      if (A <= 0.002) return;
      const rise = (1 - K.smoothstep(0, 1, inU)) * 8 * unit;
      const blur = (1 - inU) * 5 * unit;
      g.save();
      if (blur > 0.3) g.filter = `blur(${blur.toFixed(2)}px)`;
      if (land && !split) { g.shadowColor = 'rgba(0,0,0,0.85)'; g.shadowBlur = 10 * unit; g.shadowOffsetY = 2 * unit; }
      for (const w of p.words) sweepWord(g, w.run, w.x, w.y + rise, t, w, w.big ? P.a : P.ink, 0.34, A);
      g.restore();
    }

    // ── the title card ────────────────────────────────────────────────────
    function drawCard(g, t, p, hit) {
      const c = p.card;
      const outU = K.clamp((t - (p.out - 0.15)) / 0.15);
      // lead-in / tail: italic, fill as spoken (same voice as the subtitles)
      for (const it of [...(c.pre || []), ...(c.post || [])]) {
        const inU = K.clamp((t - Math.min(it.w.start, p.start + 0.05) + 0.06) / 0.25);
        const A = inU * (1 - outU);
        if (A > 0.002) sweepWord(g, it.run, it.x, it.y, t, it.w, P.ink, 0.3, A);
      }
      // the key: fades up out of a blur, letters drift apart for the whole hold
      const d = t - p.key.start;
      if (d < -0.12) return;
      const rev = K.smoothstep(-0.1, 0.32, d);
      const A = rev * (1 - outU);
      if (A <= 0.002) return;
      const drift = 1 + 0.07 * K.clamp((d + 0.12) / (hit ? hit.hold + 0.6 : 1.5));
      const blur = (1 - rev) * 14 * unit;
      const run = c.run;
      const mid = (run.inkLeft + run.inkRight) / 2;
      const each = (it) => ({ dx: ((it.ink.x0 + it.ink.x1) / 2 - mid) * (drift - 1), blur });
      // a warm glow under the letters, then the letters
      // (glow: one fill of the whole word, stretched by the drift — one blur pass, not one per letter)
      K.drawRun(g, run, c.x, c.y, { fill: P.a, alpha: A * 0.35, blur: 18 * unit + blur, group: { sx: drift } });
      K.drawRun(g, run, c.x, c.y, blur > 0.3 ? { fill: P.ink, alpha: A, each } : { fill: P.ink, alpha: A, each: (it) => ({ dx: each(it).dx }) });
      drawFlare(g, t, p, c, d, A);
    }
    // anamorphic streak: a thin horizontal line of teal light through the title,
    // a hot core that slides across the word, and a faint wide haze
    function drawFlare(g, t, p, c, d, A) {
      const run = c.run;
      const y = c.y - run.capPx * 0.5;
      const hold = Math.max(0.6, p.out - p.key.start);
      const burst = d < 0 ? 0 : Math.exp(-d / 0.35);
      const I = A * HERO.flare * (0.7 + 0.5 * burst);
      if (I <= 0.01) return;
      const x0 = c.x + run.inkLeft, x1 = c.x + run.inkRight;
      const hx = K.lerp(x0 - run.capPx * 0.3, x1 + run.capPx * 0.3, K.smoothstep(0, 1, (d + 0.1) / (hold + 0.3)));
      const [br, bg_, bb] = K.hexToRgb(P.b);
      const [ar, ag, ab] = K.hexToRgb(P.ink);
      g.save();
      g.globalCompositeOperation = 'screen';
      // streak: horizontal falloff from the hot core, vertical falloff by band
      const streak = (h, a) => {
        const gr = g.createLinearGradient(0, 0, W, 0);
        const u = K.clamp(hx / W);
        gr.addColorStop(0, `rgba(${br},${bg_},${bb},0)`);
        gr.addColorStop(K.clamp(u - 0.45), `rgba(${br},${bg_},${bb},${a * 0.15})`);
        gr.addColorStop(u, `rgba(${br},${bg_},${bb},${a})`);
        gr.addColorStop(K.clamp(u + 0.45), `rgba(${br},${bg_},${bb},${a * 0.15})`);
        gr.addColorStop(1, `rgba(${br},${bg_},${bb},0)`);
        g.fillStyle = gr;
        g.fillRect(0, y - h / 2, W, h);
      };
      // core line, then a soft band built from stacked bands (no blur filter: cheap per sample)
      for (const [h, a] of [[120, 0.06], [56, 0.12], [26, 0.26], [12, 0.5], [5, 0.9]]) streak(h * unit, K.clamp(I * a));
      // white-hot core line, short falloff around the hot spot
      const wl = g.createLinearGradient(hx - W * 0.35, 0, hx + W * 0.35, 0);
      wl.addColorStop(0, 'rgba(255,255,255,0)'); wl.addColorStop(0.5, `rgba(255,255,255,${K.clamp(I * 0.95)})`); wl.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = wl; g.fillRect(hx - W * 0.35, y - Math.max(1, 1.5 * unit), W * 0.7, Math.max(2, 3 * unit));
      // hot core
      const r = run.capPx * 1.4;
      const rg = g.createRadialGradient(hx, y, 0, hx, y, r);
      rg.addColorStop(0, `rgba(255,255,255,${K.clamp(I * 0.95)})`);
      rg.addColorStop(0.18, `rgba(${ar},${ag},${ab},${K.clamp(I * 0.45)})`); rg.addColorStop(0.45, `rgba(${br},${bg_},${bb},${K.clamp(I * 0.22)})`);
      rg.addColorStop(1, `rgba(${br},${bg_},${bb},0)`);
      g.fillStyle = rg;
      g.fillRect(hx - r, y - r, r * 2, r * 2);
      // two ghost discs mirrored through the frame centre (a lens, not a sticker)
      for (const [k, s, a] of [[-0.6, 0.35, 0.18], [-1.25, 0.2, 0.12]]) {
        const gx = W / 2 + (hx - W / 2) * k, gyy = H * 0.45 + (y - H * 0.45) * k;
        const rr = run.capPx * s * 2;
        const dg = g.createRadialGradient(gx, gyy, rr * 0.2, gx, gyy, rr);
        dg.addColorStop(0, `rgba(${br},${bg_},${bb},${I * a})`);
        dg.addColorStop(1, `rgba(${br},${bg_},${bb},0)`);
        g.fillStyle = dg;
        g.fillRect(gx - rr, gyy - rr, rr * 2, rr * 2);
      }
      g.restore();
    }

    // ── footage, the lit speaker, bars ──────────────────────────────────
    const fgrade = `${grade || ''} saturate(0.9) sepia(0.06)`.trim();
    function footage(g, t, frame, hit) {
      const z = dolly(hit);
      const r = z ? pushRect(frame, z) : frame;
      g.save(); g.filter = fgrade; clip.draw(g, t, r); g.restore();
      const env = heroEnv(hit);
      if (env > 0.002) { g.save(); g.globalAlpha = env * HERO.dim; g.fillStyle = '#000'; g.fillRect(frame.x - 50, frame.y - 50, frame.w + 100, frame.h + 100); g.restore(); }
    }
    function onSubject(g, t, tq, p, hit, frame) {
      const env = heroEnv(hit);
      // the room darkened; the speaker stays lit (drawn again, undimmed, on the dolly)
      if (env > 0.002 && hasMatte && !split) {
        const z = dolly(hit);
        g.save(); g.globalAlpha = K.clamp(env * 1.2); clip.subject(g, t, z ? pushRect(frame, z) : frame, { filter: fgrade }); g.restore();
      }
      if (split) return;
      const k = env * HERO.bars;
      const tb = topBar + barClose.top * k, bt = botTop - barClose.bot * k;
      g.fillStyle = '#000000';
      if (tb > 0.5) g.fillRect(0, 0, W, Math.round(tb));
      if (bt < H) g.fillRect(0, Math.round(bt), W, H - Math.round(bt));
    }
    function panelFrame(g) {
      // a hairline gate around the panel instead of the default accent bar
      g.save(); g.strokeStyle = P.ink; g.globalAlpha = 0.28; g.lineWidth = Math.max(1, unit * 1.5);
      g.strokeRect(panel.x - 0.5, panel.y - 0.5, panel.w + 1, panel.h + 1); g.restore();
    }

    // ── post: teal/orange grade, vignette, grain (once per output frame) ──
    const vr = Math.hypot(W, H) / 2;
    function post(g, t) {
      g.save();
      g.globalCompositeOperation = 'soft-light';
      g.globalAlpha = 0.22; g.fillStyle = '#1F5A66'; g.fillRect(0, 0, W, H); // cool shadows
      g.globalAlpha = 0.14; g.fillStyle = '#FFB36B'; g.fillRect(0, 0, W, H); // warm highlights
      g.restore();
      const cy = split ? H / 2 : (topBar + botTop) / 2;
      const grd = g.createRadialGradient(W / 2, cy, vr * 0.35, W / 2, cy, vr);
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(1, 'rgba(0,0,0,0.5)');
      g.fillStyle = grd; g.fillRect(0, 0, W, H);
      K.grain(g, W, H, { seed, frame: Math.round(q(t) * fps), amount: 0.065, mode: 'overlay' });
    }

    return {
      layout,
      ownSubject: true, // the cut-out follows this look's slow dolly (drawn in onSubject)
      footage: clip ? footage : undefined,
      onSubject,
      hit() {}, // no white flash: the hit is the bars, the dark room and the flare
      front(g, t, tq, p, hit) {
        if (p.hero && p.card) drawCard(g, tq, p, hit);
        else drawSubs(g, tq, p);
      },
      post,
      panelFrame: split ? panelFrame : undefined,
    };
  },
};
