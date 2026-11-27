// POSTER — wheatpaste street poster. Every caption row is printed in black on
// a torn strip of paper that SLAPS onto the frame (overshoot, settle, a hair
// of rotation); each word is stamped on as it is spoken, stressed words in
// signal red with an off-register black ghost. Hero moment, behind the head:
// a whole wall of posters slams onto the background — every sheet printed with
// the key word and the spoken line — while the speaker stays cut out in front.
// Front heroes: one big poster slapped into the free lower band, the spoken
// line typed across its head, the key word stamped huge. Loudest look that
// still reads: every word on paper, black on off-white.
export default {
  id: 'poster',
  summary: 'street poster: torn paper strips, red stamped words, a wall of posters behind the head',
  fonts: ['poster', 'posterWide', 'stamp'],
  palette: { bg: '#141210', ink: '#16130F', a: '#E3242B', b: '#F1EBDD', shade: '#000000' },
  build(A) {
    const { K, P, params, unit, tall, W, H, E, seed, capBig, capSmall, cxZone, IW, safeTop, safeBottom, sizeFor, up, flow, giant, wordIn, hasMatte } = A;
    const fP = A.font('poster'), fW = A.font('posterWide'), fS = A.font('stamp');
    const wild = E.level >= 2;
    const stage = params.layout === 'stage';
    const PAPER = P.b, INK = P.ink, RED = P.a;
    const padX = capSmall * 0.42, padY = capSmall * 0.3;
    const space = capSmall * 0.42;

    // ── paper ────────────────────────────────────────────────────────────
    /** A torn sheet w×h centred on (0,0): ragged top/bottom (torn), mostly straight sides. */
    function torn(w, h, key, { amp = 3.2 * unit, step = 11 * unit, side = 0.9 * unit } = {}) {
      const path = new Path2D();
      const nx = Math.max(2, Math.round(w / step)), ny = Math.max(2, Math.round(h / (step * 1.6)));
      const j = (i, e, a) => (K.noise1(seed, 'torn', key, e, i) - 0.5) * 2 * a;
      path.moveTo(-w / 2, -h / 2 + j(0, 't', amp));
      for (let i = 1; i <= nx; i++) path.lineTo(-w / 2 + (w * i) / nx, -h / 2 + j(i, 't', amp) + (i % 3 === 0 ? j(i, 'tt', amp * 0.8) : 0));
      for (let i = 1; i <= ny; i++) path.lineTo(w / 2 + j(i, 'r', side), -h / 2 + (h * i) / ny);
      for (let i = nx - 1; i >= 0; i--) path.lineTo(-w / 2 + (w * i) / nx, h / 2 + j(i, 'b', amp * 1.3));
      for (let i = ny - 1; i >= 1; i--) path.lineTo(-w / 2 + j(i, 'l', side), -h / 2 + (h * i) / ny);
      path.closePath();
      return path;
    }
    /** Paper plate: soft contact shadow, the sheet, a faint fold crease. */
    function drawSheet(g, sheet, fill, alpha) {
      g.save();
      g.globalAlpha = alpha * 0.42;
      g.translate(5 * unit, 8 * unit);
      g.fillStyle = '#000';
      g.fill(sheet.path);
      g.restore();
      g.save();
      g.globalAlpha = alpha;
      g.fillStyle = fill;
      g.fill(sheet.path);
      if (sheet.crease) {
        g.globalAlpha = alpha * 0.07;
        g.strokeStyle = '#000';
        g.lineWidth = 2 * unit;
        g.beginPath(); g.moveTo(sheet.crease[0], sheet.crease[1]); g.lineTo(sheet.crease[2], sheet.crease[3]); g.stroke();
      }
      g.restore();
    }
    /** Stamped red word: an off-register black ghost under the red key plate. */
    function stamp(g, run, x, y, alpha, grp, mis) {
      const o = (wild ? 6 : 3.5) * unit * mis;
      // (plain alpha, not 'multiply': on paper the ghost reads the same and
      // skips the blend-mode path per sub-sample)
      if (o > 0.2) K.drawRun(g, run, x + o, y + o * 0.6, { fill: INK, alpha: alpha * 0.32, group: grp });
      K.drawRun(g, run, x, y, { fill: RED, alpha, group: grp });
    }

    // ── caption strips ──────────────────────────────────────────────────
    // classic poster contrast: stressed words tall and condensed, connective
    // words small, wide and heavy
    const shapeWord = (w) => w.big
      ? K.shape(fP, up(w.text), { size: sizeFor(fP, capBig * 0.9), tracking: 0, kerning: 'optical' })
      : K.shape(fW, up(w.text), { size: sizeFor(fW, capSmall * 0.92), tracking: 10, kerning: 'metric' });
    function stripsFor(p, rows, key) {
      return rows.map((r, ri) => {
        const x0 = Math.min(...r.map((w) => w.x + w.run.inkLeft)), x1 = Math.max(...r.map((w) => w.x + w.run.inkRight));
        const cap = Math.max(...r.map((w) => w.run.capPx));
        const base = r[0].y;
        const w = x1 - x0 + padX * 2, h = cap + padY * 2;
        const cx = (x0 + x1) / 2, cy = base - cap / 2;
        const rot = (K.noise1(seed, 'strot', key, ri) - 0.5) * (wild ? 0.09 : 0.05);
        return { r, cx, cy, w, h, rot, path: torn(w, h, `${key}:${ri}`), crease: K.noise1(seed, 'crease', key, ri) < 0.5 ? [-w * 0.1, -h / 2, -w * 0.05, h / 2] : null, first: r[0] };
      });
    }

    function layout(p) {
      const lay = flow(p, shapeWord, { space, leading: padY * 2 + capSmall * 0.3, width: IW - padX * 2, reshape: (w, fit) => K.shape(w.run.face, w.run.text, { size: w.run.size * fit, tracking: w.big ? 0 : 10, kerning: w.big ? 'optical' : 'metric' }) });
      p.strips = stripsFor(p, lay.rows, `p${p.k}`);
      const box = { x0: Math.min(...p.strips.map((s) => s.cx - s.w / 2)), x1: Math.max(...p.strips.map((s) => s.cx + s.w / 2)), y0: Math.min(...p.strips.map((s) => s.cy - s.h / 2)), y1: Math.max(...p.strips.map((s) => s.cy + s.h / 2)) };
      if (p.hero && p.front) layoutFrontPoster(p);
      if (p.hero && !p.front) layoutWall(p);
      if (p.fp) return { box: p.fp.textBox, minCap: p.fp.line.minCap, fg: INK, bg: PAPER };
      return { box, minCap: lay.minCap, fg: INK, bg: PAPER };
    }

    // ── front hero: one big poster in the free lower band ────────────────
    function layoutFrontPoster(p) {
      // the key word fits INSIDE the sheet, and the sheet inside the safe zone
      const gi = giant(p, fP, { tracking: 0, width: IW - padX * 2 });
      const run = gi.run;
      // the spoken line types across the head of the poster (stamp mono)
      const lineCap = Math.max(capSmall * 0.5, run.capPx * 0.16);
      // a one-word phrase IS the key word: no line across the head (it would stutter)
      const lineWords = p.words.length === 1 ? [] : p.words;
      const lineRuns = lineWords.map((w) => K.shape(fS, up(w.text), { size: sizeFor(fS, lineCap), tracking: 20, kerning: 'metric' }));
      const sp = lineCap * 0.7;
      let lineW = lineRuns.reduce((a, r, i) => a + r.advance + (i ? sp : 0), 0);
      const inner = Math.max(run.inkRight - run.inkLeft, lineW);
      const pw = Math.min(inner + padX * 2.6, IW + padX * 1.6);
      let lr = lineRuns, s2 = sp;
      if (lineW > pw - padX * 2) { const f = (pw - padX * 2) / lineW; lr = lineWords.map((w) => K.shape(fS, up(w.text), { size: sizeFor(fS, lineCap * f), tracking: 20, kerning: 'metric' })); s2 = sp * f; lineW = lr.reduce((a, r, i) => a + r.advance + (i ? s2 : 0), 0); }
      const lcap = lr.length ? lr[0].capPx : 0;
      const gap = lr.length ? padY * 1.1 : 0;
      const ph = padY * 1.6 + lcap + gap + run.capPx + padY * 1.8;
      let top = gi.y - run.capPx - gap - lcap - padY * 1.6;
      // clamp into the safe lower band (never up over the face)
      const bottom = top + ph;
      if (bottom > safeBottom) top -= bottom - safeBottom;
      if (top < safeTop) top = safeTop;
      const cx = cxZone, cy = top + ph / 2;
      const lineBase = top + padY * 1.6 + lcap;
      let x = cx - lineW / 2;
      const items = lr.map((r, i) => { const it = { w: lineWords[i], run: r, x, y: lineBase }; x += r.advance + s2; return it; });
      const gy = lineBase + gap + run.capPx;
      const gx = cx - (run.inkLeft + run.inkRight) / 2;
      p.fp = {
        cx, cy, w: pw, h: ph, rot: (K.noise1(seed, 'fprot', p.k) - 0.5) * 0.07,
        sheet: { path: torn(pw, ph, `fp${p.k}`, { amp: 5 * unit, step: 14 * unit }), crease: [pw * 0.18, -ph / 2, pw * 0.22, ph / 2] },
        red: p.hn % 2 === 1, run, gx, gy, items,
        line: { minCap: lcap || run.capPx },
        textBox: items.length
          ? { x0: Math.min(gx + run.inkLeft, items[0].x), x1: Math.max(gx + run.inkRight, items[items.length - 1].x + items[items.length - 1].run.advance), y0: lineBase - lcap, y1: gy }
          : { x0: gx + run.inkLeft, x1: gx + run.inkRight, y0: gy - run.capPx, y1: gy },
      };
    }
    // stage (no footage): the phrase reads as strips until the key word, then
    // the poster slaps on with it — no empty sheet waiting for its word
    const slamAt = (p) => (stage ? Math.max(p.start, p.key.start - 0.03) : p.start);
    function drawFrontPoster(g, t, p) {
      const fp = p.fp;
      const d = t - slamAt(p);
      if (d < 0) return;
      const pop = K.springStep(d, 5.5, 0.55);
      const outU = K.clamp((t - (p.out - 0.14)) / 0.14);
      const a = K.clamp(d / 0.05) * (1 - outU);
      g.save();
      g.translate(fp.cx, fp.cy + outU * 30 * unit);
      g.rotate(fp.rot + (1 - K.clamp(pop, 0, 1.2)) * 0.1);
      const s = 1 + (1 - K.clamp(pop, 0, 1.25)) * 0.28;
      g.scale(s, s);
      drawSheet(g, fp.sheet, fp.red ? RED : PAPER, a);
      g.translate(-fp.cx, -fp.cy);
      const lineInk = fp.red ? PAPER : INK;
      for (const it of fp.items) {
        const st = wordIn(it.w, t, p, { f: 9, z: 0.7, fade: 0.03, outDur: 0.14 });
        if (st.d < 0) continue;
        K.drawRun(g, it.run, it.x, it.y, { fill: lineInk, alpha: a * K.clamp(st.d / 0.03), group: { s: 1 + (1 - K.clamp(st.pop, 0, 1.2)) * 0.35 } });
      }
      const dk = t - p.key.start;
      if (dk >= -0.02) {
        const kp = K.springStep(dk + 0.02, 5, 0.5);
        const grp = { s: 1 + (1 - K.clamp(kp, 0, 1.3)) * 0.45, rot: (1 - K.clamp(kp, 0, 1)) * -0.06 };
        const ka = a * K.clamp((dk + 0.02) / 0.04);
        if (fp.red) K.drawRun(g, fp.run, fp.gx, fp.gy, { fill: PAPER, alpha: ka, group: grp });
        else stamp(g, fp.run, fp.gx, fp.gy, ka, grp, 1 - K.clamp(dk / 0.4) * 0.5);
      }
      g.restore();
    }

    // ── behind hero: a wall of posters slams onto the background ─────────
    function layoutWall(p) {
      const cols = tall ? 3 : 5;
      const pw = (W / cols) * 1.06, ph = pw * (tall ? 1.36 : 1.3);
      const rows = Math.ceil(H / (ph * 0.94)) + 1;
      const key = up(p.key.text);
      // one shaped word + one spoken line, reused by every sheet
      const size = Math.min(K.fitSize(fP, key, pw * 0.8, { tracking: 0 }), sizeFor(fP, ph * 0.42));
      const run = K.shape(fP, key, { size, tracking: 0 });
      const lineTxt = up(p.words.map((w) => w.text).join(' '));
      const lsize = Math.min(K.fitSize(fS, lineTxt, pw * 0.74, { tracking: 20 }), sizeFor(fS, capSmall * 0.34));
      const line = K.shape(fS, lineTxt, { size: lsize, tracking: 20 });
      const headX = W / 2, headY = H * (tall ? 0.3 : 0.4);
      const sheets = [];
      for (let r = 0; r < rows; r++) {
        for (let c = -1; c <= cols; c++) {
          const n = (x) => K.noise1(seed, 'wall', p.k, r, c, x) - 0.5;
          const cx = (c + 0.5 + (r % 2) * 0.5) * (W / cols) + n('x') * pw * 0.12;
          const cy = (r + 0.5) * ph * 0.94 - ph * 0.12 + n('y') * ph * 0.08;
          if (cx + pw / 2 < 0 || cx - pw / 2 > W) continue;
          const red = K.noise1(seed, 'wallred', p.k, r, c) < 0.3;
          sheets.push({
            cx, cy, rot: n('r') * (wild ? 0.16 : 0.09), red,
            sheet: { path: torn(pw, ph, `w${p.k}:${r}:${c}`, { amp: 4 * unit, step: 16 * unit }), crease: n('k') > 0 ? [-pw / 2, n('c') * ph * 0.3, pw / 2, n('d') * ph * 0.3] : null },
            // ripple outward from the head: nearest sheets land first
            delay: Math.hypot(cx - headX, (cy - headY) * 0.8) / Math.hypot(W, H) * 0.34 + (n('dl') + 0.5) * 0.04,
            z: K.noise1(seed, 'wallz', p.k, r, c),
          });
        }
      }
      sheets.sort((a, b) => a.z - b.z);
      p.wall = { sheets, run, line, pw, ph };
    }
    function drawWall(g, t, p) {
      const wl = p.wall;
      drawWallSheets(g, t, p, wl);
      // the wall falls into shadow toward the caption zone: paper strips must
      // read against dark, not against more paper
      const t0 = p.key.start - 0.06;
      const vis = K.clamp((t - t0) / 0.2) * (1 - K.clamp((t - (p.out - 0.2)) / 0.2));
      if (vis <= 0.002) return;
      const y0 = H * (tall ? 0.3 : 0.45), y1 = H * (tall ? 0.56 : 0.72);
      const gr = g.createLinearGradient(0, y0, 0, y1);
      gr.addColorStop(0, 'rgba(0,0,0,0)');
      gr.addColorStop(1, 'rgba(0,0,0,0.86)');
      g.save(); g.globalAlpha = vis; g.fillStyle = gr; g.fillRect(0, y0, W, H - y0); g.restore();
    }
    function drawWallSheets(g, t, p, wl) {
      const t0 = p.key.start - 0.06;
      const outU = K.clamp((t - (p.out - 0.2)) / 0.2);
      if (t < t0 || outU >= 1) return;
      for (const s of wl.sheets) {
        const d = t - t0 - s.delay;
        if (d < 0) continue;
        const pop = K.springStep(d, 4.8, 0.6);
        const a = K.clamp(d / 0.035) * (1 - outU);
        if (a <= 0.002) continue;
        const sc = 1 + (1 - K.clamp(pop, 0, 1.25)) * 0.4;
        g.save();
        g.translate(s.cx, s.cy - outU * 60 * unit);
        g.rotate(s.rot + (1 - K.clamp(pop, 0, 1)) * 0.12);
        g.scale(sc, sc);
        drawSheet(g, s.sheet, s.red ? RED : PAPER, a);
        const ink = s.red ? PAPER : INK;
        K.drawRun(g, wl.run, -(wl.run.inkLeft + wl.run.inkRight) / 2, wl.run.capPx / 2 - wl.ph * 0.04, { fill: ink, alpha: a });
        K.drawRun(g, wl.line, -(wl.line.inkLeft + wl.line.inkRight) / 2, wl.ph * 0.36, { fill: ink, alpha: a * 0.85 });
        g.restore();
      }
    }

    // ── captions ─────────────────────────────────────────────────────────
    function drawStrips(g, t, p) {
      for (const s of p.strips) {
        const st = wordIn(s.first, t, p, { f: 5.5, z: 0.55, fade: 0.04, outDur: 0.12 });
        if (st.d < 0) continue;
        const pop = K.clamp(st.pop, 0, 1.25);
        g.save();
        g.translate(s.cx, s.cy + st.out * 24 * unit);
        g.rotate(s.rot + (1 - K.clamp(st.pop, 0, 1)) * (s.rot >= 0 ? 0.07 : -0.07));
        const sc = 1 + (1 - pop) * 0.22;
        g.scale(sc, sc);
        drawSheet(g, s, PAPER, st.alpha);
        g.translate(-s.cx, -s.cy);
        for (const w of s.r) {
          const ws = wordIn(w, t, p, { f: 9, z: 0.65, fade: 0.03, outDur: 0.12 });
          if (ws.d < 0) continue;
          const grp = { s: 1 + (1 - K.clamp(ws.pop, 0, 1.3)) * (w.big ? 0.5 : 0.3) };
          const red = (w.big && w.s >= 3) || (p.cover && w === p.key);
          if (red) stamp(g, w.run, w.x, w.y, ws.alpha, grp, 1 - K.clamp(ws.d / 0.5) * 0.45);
          else K.drawRun(g, w.run, w.x, w.y, { fill: INK, alpha: ws.alpha, group: grp });
        }
        g.restore();
      }
    }

    return {
      layout,
      behind(g, t, tq, p) { if (p && p.hero && !p.front) drawWall(g, t, p); },
      front(g, t, tq, p) {
        if (p.hero && p.front && tq >= slamAt(p)) drawFrontPoster(g, tq, p);
        else drawStrips(g, tq, p);
      },
      // the hit is a paper-white press flash (no hue: keeps the two inks pure)
      hit(g, t, hit) {
        if (!hit || hit.flash <= 0.002) return;
        g.save(); g.globalAlpha = hit.flash * 0.9; g.fillStyle = PAPER; g.fillRect(0, 0, W, H); g.restore();
      },
    };
  },
};
