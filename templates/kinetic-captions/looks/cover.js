// COVER — the magazine-cover look (the original kinetic captions).
// Condensed display type in one accent; stressed words set big. Hero moment:
// the key word goes giant BEHIND the speaker's head in the top band (the head
// occludes its middle, like a magazine masthead) or slams into the free lower
// band. params.style: poster (default) | clean (karaoke, no giants) | punch
// (one huge word at a time).
export default {
  id: 'cover',
  summary: 'magazine cover: condensed gold type, giant word behind the head',
  fonts: ['display', 'text'],
  palette: { bg: '#0B0B0B', ink: '#F4F1EA', a: '#E8B04A', b: '#E8B04A', shade: '#000000' },
  build(A) {
    const { K, P, params, unit, tall, H, capBig, capSmall, cxZone, IW, safeTop, safeBottom, sizeFor, up, flow, giant, wordIn } = A;
    const fD = A.font('display'), fT = A.font('text');
    const style = params.style || 'poster';
    const space = capSmall * 0.55;
    const shadowBlur = 14 * unit;
    const shapeWord = (w) => {
      const big = w.big && style !== 'clean';
      const face = big ? fD : fT;
      const cap = style === 'clean' ? capSmall * 1.35 : big ? capBig : capSmall;
      return K.shape(face, style === 'clean' ? w.text : up(w.text), { size: sizeFor(face, cap), tracking: big ? 10 : style === 'clean' ? 0 : 20, kerning: big ? 'optical' : 'metric' });
    };
    const punchRun = (w) => {
      const t = up(w.text);
      const cap = (w.s >= 2.2 ? 1.25 : 1) * capBig * (tall ? 1.15 : 1);
      const size = Math.min(sizeFor(fD, cap), K.fitSize(fD, t, IW, { tracking: 0 }));
      return K.shape(fD, t, { size, tracking: 0 });
    };

    function layout(p) {
      if (style === 'clean') p.words.forEach((w) => (w.stressed = w.big));
      // single-word fix (opt-in, params.singleKey): the giant behind the head IS the key word, so the caption row
      // reads the rest of the phrase instead of repeating it. Off by default: output is unchanged without the flag.
      if (params.singleKey && p.hero && p.cover && p.words.length > 1) p.words = p.words.filter((w) => w !== p.key);
      const lay = flow(p, shapeWord, { space, reshape: (w, fit) => K.shape(w.run.face, w.run.text, { size: w.run.size * fit, tracking: w.big ? 10 : 20, kerning: w.big ? 'optical' : 'metric' }) });
      if (p.hero) {
        const gi = giant(p, fD);
        p.giant = gi.run; p.gx = gi.x; p.gy = gi.y;
        if (!p.cover) {
          // the rest of the phrase reads AROUND the giant in speaking order:
          // words before the key above it, words after it below — no duplicate
          const ki = p.words.indexOf(p.key);
          const lineOf = (ws) => {
            if (!ws.length) return null;
            const mk = (f) => ws.map((w) => K.shape(fT, up(w.text), { size: sizeFor(fT, capSmall * 1.25 * f), tracking: 30, kerning: 'metric' }));
            let runs = mk(1), sp = space, width = runs.reduce((a, r, i) => a + r.advance + (i ? sp : 0), 0);
            if (width > IW) { const f = IW / width; runs = mk(f); sp = space * f; width = runs.reduce((a, r, i) => a + r.advance + (i ? sp : 0), 0); } // fits the column
            let x = cxZone - width / 2;
            return ws.map((w, i) => { const it = { w, run: runs[i], x }; x += runs[i].advance + sp; return it; });
          };
          const gap = capSmall * 0.7;
          p.pre = lineOf(p.words.slice(0, ki));
          p.post = lineOf(p.words.slice(ki + 1));
          if (p.pre) p.pre.forEach((it) => (it.y = p.gy - p.giant.capPx - gap));
          if (p.post) p.post.forEach((it) => (it.y = p.gy + gap + it.run.capPx));
          // keep the whole group (pre line + giant + post line) inside the safe area
          const bottom = p.post ? p.post[0].y : p.gy;
          if (bottom > safeBottom) {
            const dy = bottom - safeBottom;
            p.gy -= dy;
            for (const it of [...(p.pre || []), ...(p.post || [])]) it.y -= dy;
          }
          const top = p.pre ? p.pre[0].y - p.pre[0].run.capPx : p.gy - p.giant.capPx;
          if (top < safeTop) {
            const dy = safeTop - top;
            p.gy += dy;
            for (const it of [...(p.pre || []), ...(p.post || [])]) it.y += dy;
          }
        }
      }
      return lay;
    }

    const wordState = (w, t, p) => {
      const st = wordIn(w, t, p, { f: w.big ? 4.2 : 6, z: w.big ? 0.62 : 0.85 });
      if (st.d < 0) return null;
      return { dy: (1 - st.pop) * (w.big ? capBig * 0.35 : capSmall * 0.4), s: w.big ? 1 + (1 - K.clamp(st.pop, 0, 1.2)) * 0.12 : 1, alpha: st.alpha };
    };
    function drawCaption(g, t, p) {
      for (const w of p.words) {
        const st = wordState(w, t, p);
        if (!st) continue;
        const fill = (w.big && w.s >= 3) || (p.cover && w === p.key) ? P.a : P.ink;
        // bright footage: a denser, wider shadow so the type holds
        const lift = K.clamp(((p.bgLuma ?? 0.2) - 0.3) / 0.4);
        if (params.shadow > 0) K.drawRun(g, w.run, w.x, w.y + st.dy + 4 * unit, { fill: P.shade, alpha: Math.min(1, st.alpha * params.shadow * (1 + 0.4 * lift)), blur: shadowBlur * (1 + lift), group: { s: st.s } });
        K.drawRun(g, w.run, w.x, w.y + st.dy, { fill, alpha: st.alpha, group: { s: st.s } });
      }
    }
    // clean: the whole phrase is there (dim); each word lights up as it is spoken
    function drawClean(g, t, p) {
      const outU = K.clamp((t - (p.out - 0.14)) / 0.14);
      const inU = K.clamp((t - p.start + 0.02) / 0.12);
      for (const w of p.words) {
        const lit = K.clamp((t - w.start) / 0.07);
        const a = inU * (1 - outU);
        if (a <= 0.001) continue;
        const fill = lit > 0.5 && w.stressed ? P.a : P.ink;
        if (params.shadow > 0) K.drawRun(g, w.run, w.x, w.y + 3 * unit, { fill: P.shade, alpha: a * params.shadow * 0.8, blur: shadowBlur });
        K.drawRun(g, w.run, w.x, w.y, { fill, alpha: a * (0.38 + 0.62 * lit) });
      }
    }
    // punch: one word at a time, huge, popping on its own onset
    const punchY = (tall ? 0.7 : 0.72) * H;
    function drawPunch(g, t, p) {
      let cur = null;
      for (const w of p.words) if (t >= w.start - 0.01) cur = w;
      if (!cur) return;
      if (!cur.prun) cur.prun = punchRun(cur);
      const r = cur.prun;
      const pop = K.springStep(t - cur.start, 5, 0.5);
      const outU = K.clamp((t - (p.out - 0.1)) / 0.1);
      const x = cxZone - (r.inkLeft + r.inkRight) / 2, y = punchY + r.capPx / 2;
      const grp = { s: 0.7 + 0.3 * pop };
      const fill = cur.s >= 2.2 ? P.a : P.ink;
      if (params.shadow > 0) K.drawRun(g, r, x, y + 6 * unit, { fill: P.shade, alpha: (1 - outU) * params.shadow, blur: shadowBlur * 1.4, group: grp });
      K.drawRun(g, r, x, y, { fill, alpha: 1 - outU, group: grp });
    }
    function drawAround(g, t, p) {
      for (const it of [...(p.pre || []), ...(p.post || [])]) {
        const st = wordState(it.w, t, p);
        if (!st) continue;
        if (params.shadow > 0) K.drawRun(g, it.run, it.x, it.y + st.dy + 4 * unit, { fill: P.shade, alpha: st.alpha * params.shadow, blur: shadowBlur });
        K.drawRun(g, it.run, it.x, it.y + st.dy, { fill: P.ink, alpha: st.alpha });
      }
    }
    function drawGiant(g, t, p) {
      const d = t - p.key.start;
      if (d < -0.04) return;
      const pop = K.springStep(d + 0.04, 2.6, 0.7);
      const outU = K.clamp((t - (p.out - 0.18)) / 0.18);
      const a = K.clamp((d + 0.04) / 0.08) * (1 - outU);
      const grp = { s: 1.22 - 0.22 * K.clamp(pop, 0, 1.1), dy: (1 - K.clamp(pop, 0, 1)) * 40 * unit };
      if (p.front && params.shadow > 0) K.drawRun(g, p.giant, p.gx, p.gy + 8 * unit, { fill: P.shade, alpha: a * params.shadow * 0.8, blur: 22 * unit, group: grp });
      K.drawRun(g, p.giant, p.gx, p.gy, { fill: P.a, alpha: a * 0.96, group: grp });
    }

    return {
      layout,
      behind(g, t, tq, p) { if (p && p.hero && !p.front) drawGiant(g, t, p); },
      front(g, t, tq, p) {
        if (p.hero && p.front) drawGiant(g, t, p);
        if (p.hero && !p.cover) drawAround(g, tq, p);
        else if (p.cover) drawCaption(g, tq, p);
        else if (style === 'clean') drawClean(g, tq, p);
        else if (style === 'punch') drawPunch(g, tq, p);
        else drawCaption(g, tq, p);
      },
    };
  },
};
