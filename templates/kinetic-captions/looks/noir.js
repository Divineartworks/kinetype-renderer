// NOIR EDITORIAL — the speaker as a long-read magazine feature.
// High-contrast serif captions in mixed case; stressed words turn italic (in a
// warm cream) as they are spoken — the roman form cross-dissolves into the
// italic in the same slot. Words arrive with a soft defocus + rise, never a
// bounce. Hero moment: the footage drains to black-and-white and dims, and the
// whole line is set as a pull quote — hanging quotation marks in the margin, a
// hairline rule drawn out from the centre, the key word italic, and a mono
// folio (the moment's timecode) underneath. Film grain + a quiet vignette sit
// on top once per frame.
export default {
  id: 'noir',
  summary: 'noir editorial: high-contrast serif, italic emphasis, black-and-white pull quotes',
  fonts: ['serif', 'italic', 'mono'],
  uppercase: false,
  palette: { bg: '#050505', ink: '#F4F4F2', a: '#E8DFCB', b: '#9A9A96', shade: '#000000' },
  // noir moves the camera barely and never flashes; placement is the core's
  // (auto: masthead behind the head, every few heroes a front pull quote)
  energy: {
    calm: { punch: 0, flash: 0, shake: 0 },
    signature: { punch: 0.035, flash: 0, shake: 0 },
    wild: { punch: 0.06, flash: 0, shake: 0 },
  },
  build(A) {
    const { K, P, W, H, unit, tall, split, capSmall, cxZone, IW, zoneY, safeBottom, sizeFor, flow, giant, grade, clip, phrases, seed, fps, q, readable } = A;
    const fS = A.font('serif'), fI = A.font('italic'), fM = A.font('mono');
    const heroes = phrases.filter((p) => p.hero);

    // ── captions ───────────────────────────────────────────────────────────
    const capCap = capSmall * (split ? 1.1 : 1.32);
    const space = capCap * 0.34;
    const shapeWord = (w) => K.shape(w.big ? fI : fS, w.text, { size: sizeFor(w.big ? fI : fS, capCap), tracking: w.big ? 0 : -6, kerning: 'optical' });

    // ── pull quote (front heroes) ──────────────────────────────────────────
    // A real magazine pull quote: the key word alone on its own line in
    // italic at ~2.3× the caption size, the words before it above and the
    // words after it below, every line centred; hanging marks on the outer
    // lines, a hairline rule above, the timecode folio below.
    const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    const qW = split ? IW : IW * (tall ? 1 : 0.8);
    const folioRun = (p, cap) => K.shape(fM, mmss(p.key.start), { size: sizeFor(fM, Math.max(16 * unit, cap)), tracking: 240 });
    // the hanging marks must stay inside the safe margin: shrink until they do
    function quoteLayout(p) {
      const lim = Math.round(Math.min(W, H) * 0.04);
      let r = null;
      for (let s = 1, i = 0; i < 6; i++, s *= 0.92) {
        r = quoteLayoutAt(p, s);
        if (r.box.x0 >= lim && r.box.x1 <= W - lim) break;
      }
      return r;
    }
    function quoteLayoutAt(p, sc) {
      const ki = p.words.indexOf(p.key);
      const kCap = sc * Math.min(capCap * (tall ? 2.35 : 2.2), H * (split ? 0.2 : tall ? 0.105 : 0.16));
      const key = K.shape(fI, p.key.text, { size: Math.min(sizeFor(fI, kCap), K.fitSize(fI, p.key.text, qW * 0.9 * sc, { tracking: -10 })), tracking: -10, kerning: 'optical' });
      const kc = key.capPx;
      let lCap = Math.max(capCap * 1.08, kc * 0.46);
      const lineOf = (ws) => {
        if (!ws.length) return null;
        const mk = (cap) => ws.map((w) => K.shape(fS, w.text, { size: sizeFor(fS, cap), tracking: -8, kerning: 'optical' }));
        let runs = mk(lCap);
        const gap = lCap * 0.34;
        let width = runs.reduce((a, r, i) => a + r.advance + (i ? gap : 0), 0);
        if (width > qW * 0.88 * sc) { runs = mk(lCap * (qW * 0.88 * sc) / width); width = qW * 0.88 * sc; }
        let x = cxZone - width / 2;
        return ws.map((w, i) => { const it = { w, run: runs[i], x }; x += runs[i].advance + gap * (runs[i].size / runs[0].size); return it; });
      };
      const pre = lineOf(p.words.slice(0, ki)), post = lineOf(p.words.slice(ki + 1));
      const keyIt = { w: p.key, run: key, x: cxZone - (key.inkLeft + key.inkRight) / 2 };
      // vertical rhythm, top → bottom: rule, pre, key, post, folio
      const g1 = kc * 0.36, g2 = kc * 0.4;
      const preCap = pre ? pre[0].run.capPx : 0, postCap = post ? post[0].run.capPx : 0;
      const blockH = (pre ? preCap + g1 : 0) + kc + (post ? g2 + postCap : 0);
      // vertical: the block sits below the chin; split: centred; else lower band
      let top = split ? H / 2 - blockH / 2 : tall ? H * 0.565 : H * 0.54;
      const folioCap = Math.max(15 * unit, kc * 0.12);
      const bottomFurn = kc * 0.45 + folioCap;
      if (top + blockH + bottomFurn > safeBottom) top = safeBottom - blockH - bottomFurn;
      let y = top;
      if (pre) { y += preCap; pre.forEach((it) => (it.y = y)); y += g1; }
      y += kc; keyIt.y = y;
      if (post) { y += g2 + postCap; post.forEach((it) => (it.y = y)); }
      const items = [...(pre || []), keyIt, ...(post || [])];
      const firstLine = pre || [keyIt], lastLine = post || [keyIt];
      const first = firstLine[0], last = lastLine[lastLine.length - 1];
      const mCap = first === keyIt ? kc : preCap;
      const open = K.shape(fI, '“', { size: sizeFor(fI, mCap) });
      const eCap = last === keyIt ? kc : postCap;
      const close = K.shape(fI, '”', { size: sizeFor(fI, eCap) });
      const x0 = Math.min(...items.map((it) => it.x + it.run.inkLeft)), x1 = Math.max(...items.map((it) => it.x + it.run.inkRight));
      const folio = folioRun(p, folioCap);
      p.q = {
        cap: kc, lineCap: lCap, items, open, close, keyIt,
        ruleY: top - kc * 0.34, ruleW: Math.min(qW, Math.max(x1 - x0, kc * 3)),
        folio, folioY: y + kc * 0.45 + folio.capPx,
        openX: first.x + first.run.inkLeft - open.inkRight - mCap * 0.1, openY: first.y,
        closeX: last.x + last.run.inkRight + eCap * 0.05, closeY: last.y,
      };
      const minCap = Math.min(...items.map((it) => it.run.capPx));
      return { box: { x0: Math.min(x0, p.q.openX + open.inkLeft), x1: Math.max(x1, p.q.closeX + close.inkRight), y0: p.q.ruleY, y1: p.q.folioY }, minCap };
    }

    // ── masthead (behind heroes: the key word huge behind the head) ────────
    function mastheadLayout(p) {
      const lay = flow(p, shapeWord, { space, leading: capCap * 0.52, reshape: (w, fit) => K.shape(w.run.face, w.run.text, { size: w.run.size * fit, tracking: w.big ? 0 : -6, kerning: 'optical' }) });
      const gi = giant(p, fI, { text: p.key.text, tracking: -20, capFrac: tall ? 0.26 : split ? 0.34 : 0.5, width: split ? IW : W * (tall ? 0.92 : 0.86) });
      // italic lowercase: sit the x-height band, not the cap, under the platform UI
      // decoration, not a caption: centred on the frame (it may pass under the UI rail)
      p.m = { run: gi.run, x: W / 2 - (gi.run.inkLeft + gi.run.inkRight) / 2, y: p.cover ? Math.max(gi.y, A.safeTop - gi.run.inkTop) : gi.y };
      const folio = folioRun(p, Math.max(15 * unit, capCap * 0.2));
      const top = lay.box.y0;
      p.m.ruleY = top - capCap * 0.7;
      p.m.ruleW = Math.min(IW, Math.max(lay.box.x1 - lay.box.x0, capCap * 4));
      p.m.folio = folio;
      p.m.folioY = lay.box.y1 + capCap * 0.62 + folio.capPx;
      return { box: { ...lay.box, y0: p.m.ruleY, y1: p.m.folioY }, minCap: lay.minCap };
    }

    function layout(p) {
      if (p.hero && p.front) return quoteLayout(p);
      if (p.hero) return mastheadLayout(p);
      return flow(p, shapeWord, {
        space, leading: capCap * 0.52,
        reshape: (w, fit) => K.shape(w.run.face, w.run.text, { size: w.run.size * fit, tracking: w.big ? 0 : -6, kerning: 'optical' }),
      });
    }

    // ── motion ─────────────────────────────────────────────────────────────
    // soft arrival: fade + small rise + defocus, eased (no spring overshoot)
    const arrive = (d, dur = 0.26) => { const u = K.clamp(d / dur); const e = 1 - Math.pow(1 - u, 3); return { a: K.clamp(d / (dur * 0.6)), dy: (1 - e), blur: (1 - e) }; };
    const outOf = (t, p, dur = 0.16) => K.clamp((t - (p.out - dur)) / dur);

    function drawCaption(g, t, p) {
      const o = 1 - outOf(t, p);
      for (const w of p.words) {
        const d = t - w.start;
        if (d < 0) continue;
        const ar = arrive(d);
        const a = ar.a * o;
        if (a <= 0.002) continue;
        const y = w.y + ar.dy * capCap * 0.28;
        const blur = ar.blur * 7 * unit + (1 - o) * 4 * unit;
        if (w.big) {
          // roman → italic: the spoken stress turns the word italic in place
          if (!w.roman) w.roman = K.shape(fS, w.text, { size: w.run.size, tracking: -6, kerning: 'optical' });
          const u = K.smoothstep(0.08, 0.3, d);
          const rx = w.x + (w.run.advance - w.roman.advance) / 2;
          if (u < 1) K.drawRun(g, w.roman, rx, y, { fill: P.ink, alpha: a * (1 - u), blur });
          if (u > 0) K.drawRun(g, w.run, w.x, y, { fill: K.mix(P.ink, P.a, u), alpha: a * u, blur });
        } else K.drawRun(g, w.run, w.x, y, { fill: P.ink, alpha: a, blur });
      }
    }

    function drawQuote(g, t, p) {
      const Q = p.q, o = 1 - outOf(t, p, 0.18);
      const d0 = t - p.start;
      if (d0 < -0.05) return;
      furniture(g, t, p, cxZone, Q.ruleY, Q.ruleW, Q.folio, Q.folioY, o);
      // the opening mark hangs in the margin as the line begins
      const ma = arrive(d0 + 0.05, 0.4);
      K.drawRun(g, Q.open, Q.openX, Q.openY + ma.dy * Q.cap * 0.2, { fill: P.a, alpha: ma.a * o, blur: ma.blur * 8 * unit });
      for (const it of Q.items) {
        const d = t - it.w.start;
        if (d < 0) continue;
        const key = it.w === p.key;
        const ar = arrive(d, key ? 0.3 : 0.24);
        const a = ar.a * o;
        const y = it.y + ar.dy * Q.cap * (key ? 0.16 : 0.1);
        K.drawRun(g, it.run, it.x, y, { fill: key ? P.a : P.ink, alpha: a, blur: ar.blur * (key ? 12 : 8) * unit + (1 - o) * 5 * unit });
      }
      const lastW = Q.items[Q.items.length - 1];
      const dl = t - lastW.w.start;
      if (dl >= 0) {
        const ca = arrive(dl - 0.05, 0.4);
        K.drawRun(g, Q.close, Q.closeX, Q.closeY + ca.dy * Q.cap * 0.2, { fill: P.a, alpha: ca.a * o, blur: ca.blur * 8 * unit });
      }
    }

    // the rule + folio furniture shared by both hero forms
    function furniture(g, t, p, cx, ruleY, ruleW, folio, folioY, o) {
      const d0 = t - p.start;
      const ru = K.smoothstep(0, 1, (d0 + 0.05) / 0.55);
      const rw = ruleW * (1 - Math.pow(1 - ru, 3));
      g.save(); g.globalAlpha = o * 0.9; g.fillStyle = P.b;
      g.fillRect(cx - rw / 2, ruleY, rw, Math.max(1, 1.5 * unit));
      g.restore();
      const fa = K.smoothstep(0.25, 0.7, d0) * o;
      if (fa > 0.002) K.drawRun(g, folio, cx - (folio.inkLeft + folio.inkRight) / 2, folioY, { fill: P.b, alpha: fa });
    }
    // masthead: the key word in huge cream italic behind the head; it rises
    // out of a soft defocus and settles from 104% — slow, like a title card
    function drawMasthead(g, t, p) {
      const M = p.m, d = t - p.key.start;
      if (d < -0.1) return;
      const u = K.clamp((d + 0.1) / 0.7), e = 1 - Math.pow(1 - u, 3);
      const o = 1 - outOf(t, p, 0.3);
      const a = K.clamp((d + 0.1) / 0.2) * o;
      if (a <= 0.002) return;
      const blur = (1 - e) * 18 * unit;
      K.drawRun(g, M.run, M.x, M.y + (1 - e) * M.run.capPx * 0.06, { fill: P.a, alpha: a, blur: blur > 0.3 ? blur : 0, group: { s: 1.04 - 0.04 * e } });
    }

    // ── footage: faint cool desaturation always; B&W + dim under a pull quote ──
    const heroMix = (t) => {
      let lo = 0, hi = heroes.length - 1, ans = -1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (heroes[m].start - 0.2 <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
      if (ans < 0) return 0;
      const p = heroes[ans];
      const inU = K.smoothstep(0, 1, (t - (p.start - 0.2)) / 0.45);
      const outU = K.smoothstep(0, 1, (t - (p.out - 0.1)) / 0.55);
      return inU * (1 - outU);
    };
    // readable (behind him, personClean): the background is black and grey for the WHOLE window, not only under a hero phrase (the owner's
    // "black and grey one"); background only - drawClean re-draws him in colour over it. It eases in over the first 0.3 s so a cut never pops.
    const winLen = A.ctx?.spec?.duration ?? 0;
    const bwMix = (t) => (readable ? K.smoothstep(0, 1, t / 0.3) * (winLen > 1 ? 1 - K.smoothstep(0, 1, (t - (winLen - 0.3)) / 0.3) : 1) : 0);
    const satBase = (t) => 0.82 * (1 - bwMix(t));
    const footageFilter = (m, t = 0) => `${grade || ''} saturate(${(satBase(t) * (1 - m)).toFixed(3)}) contrast(${(1.04 + 0.14 * m + (readable ? 0.06 * bwMix(t) : 0)).toFixed(3)}) brightness(${(1 - 0.4 * m - (readable ? 0.06 * bwMix(t) : 0)).toFixed(3)})`;
    const scrim = (g) => {
      // a quiet bottom scrim so serif hairlines read on any footage
      const top = split ? 0 : zoneY - H * 0.26;
      const gr = g.createLinearGradient(0, top, 0, H);
      gr.addColorStop(0, 'rgba(0,0,0,0)');
      gr.addColorStop(0.55, 'rgba(0,0,0,0.38)');
      gr.addColorStop(1, 'rgba(0,0,0,0.6)');
      g.fillStyle = gr;
      g.fillRect(0, top, W, H - top);
    };

    return {
      layout,
      footageFilter,   // exposed for the tests (the grade string at t)
      footage(g, t, frame) {
        const m = heroMix(t);
        g.save(); g.filter = footageFilter(m, t); clip.draw(g, t, frame); g.restore();
        if (!split) scrim(g);
      },
      hit() {}, // no flash: noir cuts with light, not white
      front(g, t, tq, p) {
        if (p.hero && p.front) drawQuote(g, tq, p);
        else if (p.hero) {
          const o = 1 - outOf(tq, p);
          furniture(g, tq, p, cxZone, p.m.ruleY, p.m.ruleW, p.m.folio, p.m.folioY, o);
          drawCaption(g, tq, p);
        } else drawCaption(g, tq, p);
      },
      behind(g, t, tq, p) { if (p && p.hero && !p.front) drawMasthead(g, tq, p); },
      // the cut-out speaker gets exactly the plate's black-and-white grade
      // noir lighting: the room falls away, the speaker stays lit (figure/ground)
      subjectFilter: (t) => { const m = heroMix(t); return `${grade || ''} saturate(${(0.82 * (1 - m)).toFixed(3)}) contrast(${(1.04 + 0.3 * m).toFixed(3)}) brightness(${(1 + 1.9 * m).toFixed(3)})`; },
      panelFrame(g) {
        const { panel } = A;
        g.save(); g.fillStyle = P.b; g.globalAlpha = 0.8;
        g.fillRect(panel.x, panel.y + panel.h + Math.round(12 * unit), panel.w, Math.max(1, 1.5 * unit));
        g.restore();
      },
      post(g, t) {
        // vignette + grain: frame-static, once per output frame
        const vg = g.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.35, W / 2, H * 0.45, Math.hypot(W, H) * 0.62);
        vg.addColorStop(0, 'rgba(0,0,0,0)');
        vg.addColorStop(1, 'rgba(0,0,0,0.42)');
        g.save(); g.fillStyle = vg; g.fillRect(0, 0, W, H); g.restore();
        K.grain(g, W, H, { seed, frame: Math.round(q(t) * fps), amount: 0.055, mode: 'overlay' });
      },
    };
  },
};
