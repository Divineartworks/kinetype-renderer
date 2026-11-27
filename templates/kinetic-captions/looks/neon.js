// kinetype-capability: personClean/2  (neon cuts its glow, wash and haze off his silhouette via A.offHim; the app's bridge probes the marker)
// NEON NIGHT — the words are neon tubes.
// The whole phrase hangs as dark, unlit glass; each word flickers on (a
// deterministic power-on stutter) exactly when it is spoken, so reading along
// is a karaoke of light. Stressed words burn in the second gas. Hero moment:
// the key word is a giant neon sign behind the speaker's head. It shows as
// dark glass first, buzzes on at the word, washes the wall with its colour,
// and throws coloured rim light onto the speaker (person matte). Front heroes
// hang in the free lower band with a reflection under them.
export default {
  id: 'neon',
  summary: 'neon night: words as neon tubes that flicker on as spoken, giant sign behind the head lighting the speaker',
  fonts: ['neon'],
  uppercase: false,
  palette: { bg: '#07040B', ink: '#FFF4FA', a: '#FF2E8B', b: '#34E4FF', shade: '#0A0410' },
  build(A) {
    const { K, P, params, unit, tall, W, H, capBig, capSmall, cxZone, safeTop, safeBottom, sizeFor, flow, giant, flicker, clip, grade, hasMatte, seed } = A;
    const fN = A.font('neon');
    const space = capSmall * 0.62;
    const tube = (w) => K.shape(fN, w.text, { size: sizeFor(fN, w.big ? capBig * 0.78 : capSmall * 1.45), tracking: w.big ? 20 : 30, kerning: 'metric' });
    const glass = '#2C2233';
    // the gas colour of a word / a hero sign
    const gasOf = (w) => (w.big ? P.b : P.a);
    const signGas = (p) => (p.hn % 2 === 0 ? P.a : P.b);
    // mains hum: the glow breathes a little, per frame
    const hum = (tq, k) => 0.9 + 0.1 * K.noise1(seed, 'hum', k, Math.round(tq * 30));

    function layout(p) {
      const lay = flow(p, tube, { space, leading: capSmall * 0.55, reshape: (w, fit) => K.shape(fN, w.text, { size: w.run.size * fit, tracking: 20, kerning: 'metric' }) });
      if (p.hero) {
        // Tilt Neon ascenders rise well above cap height, and the glow needs air at the frame edge
        const gi = giant(p, fN, { text: p.key.text, tracking: 0, width: A.split ? A.IW * 0.9 : W * (tall ? 0.84 : 0.74), capFrac: p.front ? (tall ? A.E.frontCap * 0.85 : 0.2) : undefined });
        p.sign = gi.run; p.sx = gi.x; p.sy = gi.y;
        if (p.front) {
          // the rest of the phrase hangs around the sign in speaking order
          const ki = p.words.indexOf(p.key);
          const lineOf = (ws) => {
            if (!ws.length) return null;
            const mk = (f) => ws.map((w) => K.shape(fN, w.text, { size: sizeFor(fN, capSmall * 1.3 * f), tracking: 30, kerning: 'metric' }));
            let runs = mk(1), sp = space, width = runs.reduce((a, r, i) => a + r.advance + (i ? sp : 0), 0);
            if (width > A.IW) { const f = A.IW / width; runs = mk(f); sp = space * f; width = runs.reduce((a, r, i) => a + r.advance + (i ? sp : 0), 0); } // fits the column
            let x = cxZone - width / 2;
            return ws.map((w, i) => { const it = { w, run: runs[i], x }; x += runs[i].advance + sp; return it; });
          };
          const gap = capSmall * 0.9;
          p.pre = lineOf(p.words.slice(0, ki));
          p.post = lineOf(p.words.slice(ki + 1));
          const place = () => {
            if (p.pre) p.pre.forEach((it) => (it.y = p.sy - p.sign.capPx - gap));
            if (p.post) p.post.forEach((it) => (it.y = p.sy + p.sign.capPx * 0.8 + gap * 0.6 + it.run.capPx)); // below the reflection
          };
          place();
          const bottom = p.post ? p.post[0].y : p.sy + p.sign.capPx * 0.8; // leave room for the reflection
          if (bottom > safeBottom) { p.sy -= bottom - safeBottom; place(); }
          const top = p.pre ? p.pre[0].y - p.pre[0].run.capPx : p.sy - p.sign.capPx;
          if (top < safeTop) { p.sy += safeTop - top; place(); }
        }
      }
      return { ...lay, fg: P.ink, bg: P.shade };
    }

    // one neon tube: glass, then (lit) two glows + a hot core
    // `t` (the frame time) is passed by the layers drawn IN FRONT of him: under personClean their glow is cut off his silhouette
    // (the tube's core stays: that is the word itself, like cover's ink), so the light never tints his shirt or skin.
    function drawTube(g, run, x, y, gas, on, tq, k, { core = P.ink, glow = 1, glassAlpha = 0.55, big = 1, t } = {}) {
      if (glassAlpha > 0 && on < 0.99) K.drawRun(g, run, x, y, { fill: glass, alpha: glassAlpha * (1 - on * 0.9) });
      if (on <= 0.002) return;
      const h = hum(tq, k) * on * glow;
      const glows = (gg) => {
        gg.save();
        gg.globalCompositeOperation = 'lighter';
        K.drawRun(gg, run, x, y, { fill: gas, alpha: 0.55 * h, blur: 26 * unit * big });
        K.drawRun(gg, run, x, y, { fill: gas, alpha: 0.9 * h, blur: 7 * unit * big });
        gg.restore();
      };
      if (t === undefined) glows(g); else A.offHim(g, t, glows, { blend: 'lighter' });
      K.drawRun(g, run, x, y, { fill: core, alpha: Math.min(1, on * 1.05) });
    }
    const wordOn = (w, tq) => flicker(w.i, tq - w.start, 0.2) * K.clamp((tq - w.start) / 0.03);

    function caption(g, t, tq, p, items) {
      const outU = K.clamp((tq - (p.out - 0.14)) / 0.14);
      const inU = K.clamp((tq - p.start + 0.06) / 0.1);
      if (inU * (1 - outU) <= 0.001) return;
      // smoke behind the block, so the tubes read on any footage
      const b = p.box;
      if (b && !items) {
        // personClean: the haze is a dark scrim - it must not dim his body (A.offHim cuts his silhouette out of it)
        A.offHim(g, t, (hg) => {
        hg.save();
        // a soft elliptical haze, never a box: it must vanish into any grade
        const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, rx = (b.x1 - b.x0) / 2 + 70 * unit, ry = (b.y1 - b.y0) / 2 + 60 * unit;
        const hz = hg.createRadialGradient(cx, cy, 0, cx, cy, 1);
        // thicker on bright footage (the core measured the background under this caption)
        const lift = K.clamp(((p.bgLuma ?? 0.15) - 0.18) / 0.3);
        hz.addColorStop(0, K.rgba(P.shade, 0.5 + 0.42 * lift));
        hz.addColorStop(0.6, K.rgba(P.shade, 0.32 + 0.45 * lift));
        hz.addColorStop(1, K.rgba(P.shade, 0));
        hg.globalAlpha = inU * (1 - outU);
        hg.translate(cx, cy); hg.scale(rx, ry);
        hg.fillStyle = hz;
        hg.beginPath(); hg.arc(0, 0, 1, 0, Math.PI * 2); hg.fill();
        hg.restore();
        });
      }
      const list = items || p.words.map((w) => ({ w, run: w.run, x: w.x, y: w.y }));
      const edge = K.clamp(((p.bgLuma ?? 0.15) - 0.18) / 0.3);
      for (const it of list) {
        if (edge > 0.05) K.drawRun(g, it.run, it.x, it.y + 3 * unit, { fill: P.shade, alpha: 0.7 * edge * inU * (1 - outU), blur: 5 * unit });
        const w = it.w;
        const on = wordOn(w, tq) * (1 - outU);
        const lit = on > 0 ? on : 0;
        drawTube(g, it.run, it.x, it.y, gasOf(w), lit, tq, w.i, { core: w.big ? '#EFFFFF' : P.ink, glassAlpha: 0.55 * inU * (1 - outU), big: w.big ? 1.2 : 0.8, t });
      }
    }

    // the sign: glass fades in before the word, buzzes on at it
    const signState = (p, tq) => {
      const d = tq - p.key.start;
      const glassIn = K.clamp((d + 0.45) / 0.3);
      const outU = K.clamp((tq - (p.out - 0.2)) / 0.2);
      return { d, glassIn: glassIn * (1 - outU), on: flicker('sign' + p.k, d, 0.34, 24) * (d >= 0 ? 1 : 0) * (1 - outU) };
    };
    function drawSign(g, tq, p, t) {
      const st = signState(p, tq);
      if (st.glassIn <= 0.001) return st;
      const gas = signGas(p);
      drawTube(g, p.sign, p.sx, p.sy, gas, st.on, tq, 'sign' + p.k, { core: '#FFF8FC', glassAlpha: 0.7 * st.glassIn, big: 2.4, t });
      if (p.front && st.on > 0.01) {
        // reflection on the floor under a front sign
        const reflect = (gg) => {
          gg.save();
          gg.translate(0, p.sy * 2 + p.sign.capPx * 0.12);
          gg.scale(1, -1);
          gg.globalCompositeOperation = 'lighter';
          K.drawRun(gg, p.sign, p.sx, p.sy, { fill: gas, alpha: 0.22 * st.on, blur: 10 * unit });
          gg.restore();
        };
        if (t === undefined) reflect(g); else A.offHim(g, t, reflect, { blend: 'lighter' });
      }
      return st;
    }
    // colour wash of the lit sign on the wall behind the speaker
    function wash(g, p, on, cx, cy, r) {
      if (on <= 0.01) return;
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      gr.addColorStop(0, K.rgba(signGas(p), 0.42 * on));
      gr.addColorStop(1, K.rgba(signGas(p), 0));
      g.save(); g.globalCompositeOperation = 'screen'; g.fillStyle = gr; g.fillRect(0, 0, W, H); g.restore();
    }
    // the same wash for a sign drawn IN FRONT of him: under personClean it is cut off his silhouette (A.offHim)
    const washOff = (g, t, p, on, cx, cy, r) => A.offHim(g, t, (wg) => wash(wg, p, on, cx, cy, r), { blend: 'screen' });

    return {
      layout,
      footage(g, t, frame) {
        g.save(); if (grade) g.filter = grade; clip.draw(g, t, frame); g.restore();
        // night: violet shadows
        g.save(); g.globalCompositeOperation = 'soft-light'; g.globalAlpha = 0.55; g.fillStyle = '#3A1A66'; g.fillRect(0, 0, W, H); g.restore();
      },
      behind(g, t, tq, p) {
        if (!p || !p.hero || p.front) return;
        const st = signState(p, tq);
        wash(g, p, st.on, W / 2, p.sy - p.sign.capPx / 2, Math.max(W, H) * 0.6);
        drawSign(g, tq, p);
      },
      onSubject(g, t, tq, p, hit, frame) {
        if (!p || !p.hero || !hasMatte) return;
        const st = signState(p, tq);
        if (st.on <= 0.01) return;
        const gas = signGas(p);
        // rim light from the sign: from above for a sign behind the head, from below for a front sign
        // a light BAND, strongest nearest the sign, gone within ~a sign height:
        // it should read as light falling on him, never as paint
        clip.light(g, t, frame, (lg) => {
          const c = p.sy - p.sign.capPx * 0.5, r = p.sign.capPx * (p.front ? 1.6 : 2.2);
          const gr = lg.createLinearGradient(0, c - r, 0, c + r);
          gr.addColorStop(0, K.rgba(gas, 0));
          gr.addColorStop(0.5, K.rgba(gas, 0.5));
          gr.addColorStop(1, K.rgba(gas, 0));
          lg.fillStyle = gr; lg.fillRect(frame.x, c - r, frame.w, 2 * r);
        }, { blend: 'screen', alpha: 0.5 * st.on });
      },
      hit(g, t, hit) {
        if (!hit || hit.flash <= 0.002) return;
        g.save(); g.globalCompositeOperation = 'screen'; g.globalAlpha = Math.min(1, hit.flash * 1.6); g.fillStyle = signGas(hit.p); g.fillRect(0, 0, W, H); g.restore();
      },
      front(g, t, tq, p) {
        if (p.hero && p.front) {
          const st = signState(p, tq);
          washOff(g, t, p, st.on * 0.6, W / 2, p.sy, W * 0.7);
          drawSign(g, tq, p, t);
          caption(g, t, tq, p, [...(p.pre || []), ...(p.post || [])]);
        } else caption(g, t, tq, p);
      },
      post(g) {
        const gr = g.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.35, W / 2, H * 0.45, Math.max(W, H) * 0.75);
        gr.addColorStop(0, 'rgba(0,0,0,0)');
        gr.addColorStop(1, 'rgba(4,0,10,0.55)');
        g.fillStyle = gr; g.fillRect(0, 0, W, H);
      },
    };
  },
};
