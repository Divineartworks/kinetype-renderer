// SWISS — International Typographic Style captions.
// A paper plate rides a rail in the lower zone: flush-left ragged grotesk,
// words rise through row masks as they are spoken, the plate grows along the
// rail behind them, one signal red for the stressed word, a red square and a
// mono phrase index as furniture. Spoken numbers ("three reasons", "20%")
// count in as a big red numeral beside the line. Hero moment: the frame splits
// on the grid — the speaker slides into one panel, the paper panel locks the
// giant key word flush-left on its grid lines with a red block — then the
// grid closes back to full frame. Hard mechanical easing throughout.
const NUM = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100, thousand: 1000, million: 1000000,
  first: 1, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
};
const numberOf = (text) => {
  const k = text.toLowerCase().replace(/[’']/g, '');
  if (k in NUM) return { n: NUM[k], suffix: '' };
  const m = k.match(/^(\d{1,7})(%|k)?$/);
  return m ? { n: +m[1], suffix: m[2] ? m[2].toUpperCase().replace('K', 'K') : '' } : null;
};

export default {
  id: 'swiss',
  summary: 'Swiss grid: paper plate on a rail, flush-left grotesk, one signal red, spoken numbers count in, hero splits the frame into grid panels',
  fonts: ['text', 'textLight', 'mono'],
  palette: { bg: '#F2F0EB', ink: '#111111', a: '#E30613', b: '#6E6C68', shade: '#F2F0EB' },
  uppercase: false,
  // the hero is a grid split, never a word behind the head
  energy: { calm: { placement: 'front' }, signature: { placement: 'front' }, wild: { placement: 'front' } },
  build(A) {
    const { K, P, W, H, unit, tall, land, split, M, IW, colX0, zoneY, safeBottom, capSmall, sizeFor, up, flow, clip, grade, qa, E, raw, phrases, q } = A;
    const fB = A.font('text'), fL = A.font('textLight'), fM = A.font('mono');
    const vsplit = land && !split; // landscape: panels side by side; vertical/square: stacked
    const cap = (split ? 1.2 : tall ? 1.05 : 1.04) * capSmall;
    const pad = Math.round(cap * 0.46);
    const lead = Math.round(cap * 0.52);
    const space = cap * 0.34;
    const hair = Math.max(2, Math.round(2 * unit));
    const expo = K.expoOut, mech = K.expoInOut;
    const flashAmt = raw.flash ?? E.flash;
    const pad3 = (n) => String(n).padStart(3, '0');
    const shape = (face, text, c, tracking = -10) => K.shape(face, text, { size: sizeFor(face, c), tracking, kerning: 'metric' });
    const x0 = split ? colX0 : M;

    // ── hero spans: the grid split holds past the key word (the following
    //    phrases run in the panel) and closes on a phrase boundary ─────────
    const HOLD = { calm: 1.3, signature: 1.4, wild: 1.0 }[A.params.energy] ?? 1.4;
    const heroes = phrases.filter((p) => p.hero);
    const spans = heroes.map((h) => {
      const target = h.key.start + HOLD;
      let close = h.out;
      if (target > h.out) {
        const began = phrases.filter((q) => q.k > h.k && q.start < target);
        const last = began[began.length - 1];
        close = last ? Math.min(last.out, target + 0.7) : Math.min(target, h.end + 1.0);
      }
      return { h, start: h.start, close: Math.max(close, h.out) };
    });
    for (let i = 0; i + 1 < spans.length; i++) {
      const a = spans[i], b = spans[i + 1];
      if (b.start <= a.close + 0.05) { a.close = b.start; a.chainOut = true; b.chainIn = true; }
    }
    const spanOf = (p) => spans.find((sp) => p.start >= sp.start - 0.001 && p.start < sp.close);

    // ── per-phrase layout ────────────────────────────────────────────────
    function layout(p) {
      p.num = null;
      for (const w of p.words) { const n = numberOf(w.text); if (n) { p.num = { w, ...n }; break; } }
      // the counted numeral sits left of the line, flush to the plate's inner margin
      let numW = 0;
      if (p.num) {
        p.num.cap = cap * 2.05;
        p.num.run = shape(fB, p.num.n.toLocaleString('en-US') + p.num.suffix, p.num.cap, -20);
        numW = p.num.run.advance + cap * 0.5;
      }
      const tx = x0 + pad + numW;
      const lay = flow(p, (w) => shape(fB, up(w.text), cap), {
        space, leading: lead, align: 'left', x0: tx, width: (split ? IW : IW) - pad * 2 - numW,
        baseY: Math.min(zoneY, safeBottom - pad), centerY: split ? H / 2 : null,
        reshape: (w, fit) => shape(fB, up(w.text), cap * fit),
      });
      // a spoken digit IS the numeral: it leaves the line and the rest closes up
      if (p.num && /^\d/.test(p.num.w.text)) {
        const w = p.num.w;
        w.hidden = true;
        for (const v of p.words) if (v !== w && v.row === w.row && v.x > w.x) v.x -= w.run.advance + space;
        const vis = p.words.filter((v) => !v.hidden);
        if (vis.length) lay.box = { x0: Math.min(...vis.map((v) => v.x + v.run.inkLeft)), x1: Math.max(...vis.map((v) => v.x + v.run.inkRight)), y0: Math.min(...vis.map((v) => v.y + v.run.inkTop)), y1: Math.max(...vis.map((v) => v.y + v.run.inkBottom)) };
      }
      const top = lay.box.y0 - pad, bottom = Math.max(...p.words.map((w) => w.y)) + Math.max(pad, cap * 0.38);
      if (p.num) {
        const r = p.num.run;
        p.num.x = x0 + pad - r.inkLeft;
        p.num.y = Math.min(bottom - pad * 0.6, top + pad + r.capPx);
      }
      p.plate = { x: x0, y: Math.min(top, p.num ? p.num.y - p.num.run.capPx - pad : top), b: Math.max(bottom, p.num ? p.num.y + pad * 0.6 : bottom) };
      p.idx = shape(fM, pad3(p.k + 1), Math.max(cap * 0.3, 17 * unit), 60);
      const sp = split ? (p.hero ? spans.find((x) => x.h === p) : null) : spanOf(p);
      if (sp) {
        if (sp.h === p) heroLayout(p);
        p.pl = panelLine(p, sp.h.sw);
      }
      return { box: lay.box, minCap: cap, fg: P.ink, bg: P.bg };
    }

    // hero: the paper panel of the grid split
    function heroLayout(p) {
      const h = {};
      if (vsplit) {
        h.cut = Math.round(W * 0.5);
        h.px = h.cut + M; h.pw = W - M - h.px;
        h.gTop = H * 0.2;
      } else if (split) {
        h.px = colX0; h.pw = IW;
        h.gTop = H * 0.22;
      } else {
        h.cut = Math.round(H * (tall ? 0.54 : 0.52));
        h.px = M; h.pw = IW;
        h.gTop = h.cut + H * (tall ? 0.07 : 0.08);
      }
      const t = up(p.key.text);
      const gcap = H * (vsplit ? 0.2 : split ? 0.2 : tall ? 0.12 : 0.15);
      const size = Math.min(K.fitSize(fB, t, h.pw, { tracking: -25 }), sizeFor(fB, gcap));
      h.giant = K.shape(fB, t, { size, tracking: -25 });
      h.gx = h.px - h.giant.inkLeft;
      h.gy = h.gTop + h.giant.capPx;
      h.label = shape(fM, pad3(p.hn + 1), Math.max(cap * 0.34, 17 * unit), 60);
      p.sw = h;
      qa.text(`hero-${p.k}`, { box: { x0: h.gx + h.giant.inkLeft, x1: h.gx + h.giant.inkRight, y0: h.gy + h.giant.inkTop, y1: h.gy + h.giant.inkBottom }, size: h.giant.capPx, fg: P.ink, bg: P.bg, lines: [p.key.text], orphanOk: true });
    }

    // a phrase as the panel's light line under the giant: lit word by word as spoken
    function panelLine(p, h) {
      const pc = cap * (vsplit ? 0.62 : 0.68);
      const items = [];
      let x = h.px, y = h.gy + pc * 2.9;
      for (const w of p.words) {
        const run = shape(fL, up(w.text), pc, 0);
        if (x > h.px && x + run.advance > h.px + h.pw) { x = h.px; y += pc * 1.55; }
        items.push({ w, run, x, y });
        x += run.advance + pc * 0.34;
      }
      const lastY = items[items.length - 1].y;
      if (!vsplit && !split && lastY > safeBottom) { const dy = lastY - safeBottom; for (const it of items) it.y -= dy; }
      qa.text(`panel-line-${p.k}`, { box: { x0: h.px, x1: Math.max(...items.map((it) => it.x + it.run.inkRight)), y0: Math.min(...items.map((it) => it.y + it.run.inkTop)), y1: Math.max(...items.map((it) => it.y + it.run.inkBottom)) }, size: pc, fg: P.ink, bg: P.bg, lines: [p.words.map((w) => w.text).join(' ')], orphanOk: true });
      return items;
    }

    // ── time → state ─────────────────────────────────────────────────────
    const OPEN = 0.3;
    // how far the grid split is open (0 full frame … 1 split) for span sp at t
    const openOf = (sp, t) => (sp.chainIn ? 1 : mech(K.clamp((t - sp.start + 0.04) / OPEN))) * (sp.chainOut ? 1 : 1 - mech(K.clamp((t - (sp.close - OPEN)) / OPEN)));
    // captions pause under overlays that ask for it: the grid stays closed then
    const pausers = (A.ctx.content.overlays || []).filter((o) => o.pauseCaptions);
    const heroAt = (t) => {
      if (pausers.some((o) => t >= o.at && t < o.at + (o.duration ?? 0))) return null;
      for (const sp of spans) if (t >= sp.start - 0.05 && t < sp.close) return sp;
      return null;
    };

    // a word rising through its row mask
    function drawRisen(g, run, x, y, d, fill, alpha = 1, rise = 1.15) {
      if (d < 0) return;
      const e = expo(K.clamp(d / 0.24));
      g.save();
      g.beginPath();
      g.rect(x + run.inkLeft - 4, y + run.inkTop - 3, run.inkRight - run.inkLeft + 8, run.inkBottom - run.inkTop + 6 + run.capPx * 0.08);
      g.clip();
      K.drawRun(g, run, x, y + (1 - e) * run.capPx * rise, { fill, alpha });
      g.restore();
    }

    function drawPlate(g, t, p) {
      const d0 = t - p.start;
      const outU = K.clamp((t - (p.out - 0.14)) / 0.14);
      // the plate grows along the rail behind the revealed words
      let right = x0 + pad * 2;
      for (const w of p.words) {
        const d = t - w.start;
        if (d < 0 || w.hidden) continue;
        const e = expo(K.clamp(d / 0.22));
        const prev = p.words.slice(0, p.words.indexOf(w)).filter((v) => v.row === w.row && !v.hidden);
        const from = prev.length ? prev[prev.length - 1].x + prev[prev.length - 1].run.advance : w.x;
        right = Math.max(right, K.lerp(from, w.x + w.run.advance, e) + pad);
      }
      if (p.num) right = Math.max(right, p.num.x + p.num.run.inkRight + pad);
      const pl = p.plate;
      const wipeIn = mech(K.clamp(d0 / 0.16));
      const L0 = pl.x + (right - pl.x) * mech(outU); // exit: the plate wipes off to the right
      const R0 = pl.x + (right - pl.x) * wipeIn;
      if (R0 - L0 < 1) return;
      // rail: a hairline from the plate to the right margin
      g.save();
      g.globalAlpha = (split ? 0.25 : 0.55) * wipeIn * (1 - outU);
      g.fillStyle = split ? P.ink : P.bg;
      g.fillRect(R0, pl.b - hair, Math.max(0, W - M - R0), hair);
      g.restore();
      g.save();
      g.globalAlpha = 0.97;
      g.fillStyle = P.bg;
      g.fillRect(L0, pl.y, R0 - L0, pl.b - pl.y);
      g.restore();
      // furniture above the plate: red square + phrase index
      const sq = Math.round(cap * 0.3);
      g.save();
      g.globalAlpha = wipeIn * (1 - outU);
      g.fillStyle = P.a;
      g.fillRect(pl.x, pl.y - sq - Math.round(cap * 0.22), sq, sq);
      g.restore();
      K.drawRun(g, p.idx, pl.x + sq * 1.6, pl.y - Math.round(cap * 0.22), { fill: split ? P.ink : P.bg, alpha: 0.85 * wipeIn * (1 - outU) });
      g.save();
      g.beginPath();
      g.rect(L0, pl.y, R0 - L0, pl.b - pl.y);
      g.clip();
      for (const w of p.words) {
        if (w.hidden) continue;
        const red = w === p.key && w.s >= 2.2 && !(p.num && p.num.w === w);
        drawRisen(g, w.run, w.x, w.y, t - w.start, red || (p.num && p.num.w === w) ? P.a : P.ink);
      }
      if (p.num) drawNumeral(g, t, p.num);
      g.restore();
    }

    // a spoken number counts in (slot-machine) and slams in red
    function drawNumeral(g, t, nm) {
      const d = t - nm.w.start;
      if (d < 0) return;
      const e = K.clamp(d / 0.42);
      const v = Math.round(nm.n * K.cubicOut(e));
      const run = e >= 1 ? nm.run : shape(fB, v.toLocaleString('en-US') + nm.suffix, nm.cap, -20);
      drawRisen(g, run, nm.x, nm.y, d, P.a, 1, 0.9);
    }

    function drawHeroPanel(g, t, tq, sp, open) {
      const p = sp.h, h = p.sw;
      // the paper panel slides in over the footage along the cut
      g.save();
      g.fillStyle = P.bg;
      if (vsplit) g.fillRect(W - (W - h.cut) * open, 0, W, H);
      else g.fillRect(0, H - (H - h.cut) * open, W, H);
      g.restore();
      if (open < 0.02) return;
      // everything on the panel is laid out on the panel and travels with it
      const off = vsplit ? { x: (W - h.cut) * (1 - open), y: 0 } : { x: 0, y: (H - h.cut) * (1 - open) };
      g.save();
      g.translate(off.x, off.y);
      // grid: hairline at the cut, four column guides, red block in the last column
      g.fillStyle = P.ink;
      if (vsplit) g.fillRect(h.cut, 0, hair, H);
      else g.fillRect(0, h.cut, W, hair);
      g.globalAlpha = 0.14;
      const cols = 4;
      if (vsplit) for (let c = 1; c < cols; c++) g.fillRect(h.cut + ((W - h.cut) * c) / cols, 0, 1, H);
      else for (let c = 1; c < cols; c++) g.fillRect(M + ((W - 2 * M) * c) / cols, h.cut, 1, H - h.cut);
      g.globalAlpha = 1;
      const dk = t - p.key.start;
      const blockU = mech(K.clamp((dk + 0.06) / 0.28));
      g.fillStyle = P.a;
      if (vsplit) { const bw = (W - h.cut) / cols, bh = H * 0.12; g.fillRect(W - bw, 0, bw, bh * blockU); }
      else { const bw = (W - 2 * M) / cols, bh = (H - h.cut) * 0.1; g.fillRect(W - M - bw * blockU, h.cut + hair, bw * blockU, bh); }
      // index label: red square + hero number
      const sq = Math.round(cap * 0.32);
      const ly = (vsplit ? H * 0.09 : h.cut + (H - h.cut) * 0.1) + sq;
      g.fillRect(h.px, ly - sq, sq, sq);
      K.drawRun(g, h.label, h.px + sq * 1.6, ly, { fill: P.ink });
      // the giant key word: a hairline ghost on the grid, then it locks in as spoken
      if (dk < 0.3) K.drawRun(g, h.giant, h.gx, h.gy, { stroke: P.ink, strokeWidth: Math.max(1.5, 2 * unit), alpha: 0.2 * (sp.chainIn ? 1 : K.clamp((t - p.start) / 0.3)) });
      drawRisen(g, h.giant, h.gx, h.gy, dk + 0.02, P.ink, 1, 1.05);
      // the phrase being spoken, light: grey until spoken, ink once spoken,
      // the hero key in red (the following phrases take over the same line)
      let owner = p;
      for (let k = p.k + 1; k < phrases.length && phrases[k].start <= tq + 1e-6 && phrases[k].start < sp.close; k++) owner = phrases[k];
      const lineIn = owner === p ? 1 : expo(K.clamp((tq - owner.start + 0.02) / 0.2));
      for (const it of owner.pl || []) {
        const d = tq - it.w.start;
        const fill = d < 0 ? P.b : it.w === p.key ? P.a : P.ink;
        K.drawRun(g, it.run, it.x, it.y + (1 - lineIn) * it.run.capPx * 0.6, { fill, alpha: (d < 0 ? 0.55 : 1) * lineIn });
      }
      g.restore();
    }

    // ── footage: full frame, or the speaker's panel during a grid split ──
    const gradeF = `${grade || ''} saturate(0.86)`;
    function footage(g, t, frame, hit) {
      const sp = split ? null : heroAt(t);
      const open = sp ? openOf(sp, t) : 0;
      g.save();
      g.filter = gradeF;
      if (open <= 0.001) clip.draw(g, t, frame);
      else {
        const h = sp.h.sw;
        const z = hit ? hit.zoom : 0;
        // the speaker's panel: the frame shrinks toward its grid cell, face kept in it
        const box = vsplit ? { x: 0, y: 0, w: K.lerp(W, h.cut, open), h: H } : { x: 0, y: 0, w: W, h: K.lerp(H, h.cut, open) };
        g.beginPath(); g.rect(box.x, box.y, box.w, box.h); g.clip();
        const zb = { x: box.x - box.w * z * 0.5, y: box.y - box.h * z * 0.35, w: box.w * (1 + z), h: box.h * (1 + z) };
        clip.draw(g, t, zb, vsplit ? { focusX: 0.5, focusY: 0.4 } : { focusX: 0.5, focusY: 0.3 });
      }
      g.restore();
    }

    return {
      layout,
      footage,
      // the grid panel is drawn whether or not a phrase is on (it holds through pauses)
      behind(g, t, tq) {
        if (split) {
          // split: the column is a Swiss paper page around the speaker's panel
          const pn = A.panel;
          g.save();
          g.fillStyle = P.bg;
          g.fillRect(0, 0, W, pn.y); g.fillRect(0, pn.y + pn.h, W, H - pn.y - pn.h);
          g.fillRect(0, pn.y, pn.x, pn.h); g.fillRect(pn.x + pn.w, pn.y, W - pn.x - pn.w, pn.h);
          g.fillStyle = P.ink;
          g.globalAlpha = 0.1;
          const cols = 4;
          for (let c = 0; c <= cols; c++) g.fillRect(Math.round(colX0 + (IW * c) / cols), pn.y, 1, pn.h);
          g.globalAlpha = 1;
          g.fillRect(colX0, pn.y, IW, hair);
          g.restore();
          return;
        }
        const sp = heroAt(t);
        if (sp) drawHeroPanel(g, t, tq, sp, openOf(sp, t));
      },
      front(g, t, tq, p) {
        if (!split && heroAt(t)) return;
        if (p.hero && split) {
          const h = p.sw;
          if (t - p.key.start < 0.3) K.drawRun(g, h.giant, h.gx, h.gy, { stroke: P.ink, strokeWidth: Math.max(1.5, 2 * unit), alpha: 0.2 * K.clamp((t - p.start) / 0.3) });
          drawRisen(g, h.giant, h.gx, h.gy, t - p.key.start + 0.02, P.ink, 1, 1.05);
          for (const it of p.pl) { const d = tq - it.w.start; K.drawRun(g, it.run, it.x, it.y, { fill: d < 0 ? P.b : it.w === p.key ? P.a : P.ink, alpha: d < 0 ? 0.55 : 1 }); }
          return;
        }
        drawPlate(g, tq, p);
      },
      // the hit: the column guides flash across the whole frame
      hit(g, t, hit) {
        if (!hit || !(flashAmt > 0) || hit.d < 0) return;
        const a = K.clamp(hit.flash / flashAmt) * 0.7;
        if (a < 0.01) return;
        g.save();
        g.globalAlpha = a;
        g.fillStyle = P.a;
        const cols = 4;
        for (let c = 0; c <= cols; c++) g.fillRect(Math.round(M + ((W - 2 * M) * c) / cols) - 1, 0, Math.max(2, Math.round(2 * unit)), H);
        g.restore();
      },
      panelFrame(g) {
        const sq = Math.round(cap * 0.3);
        g.fillStyle = P.a;
        g.fillRect(A.panel.x, A.panel.y + A.panel.h + Math.round(12 * unit), sq, sq);
      },
      // grid splits are fast mechanical moves: more shutter samples while they run
      samplesHint(t) {
        for (const sp of spans) {
          if ((!sp.chainIn && t > sp.start - 0.05 && t < sp.start + OPEN + 0.05) || (!sp.chainOut && t > sp.close - OPEN - 0.05 && t < sp.close + 0.05)) return 24;
        }
        return 0;
      },
    };
  },
};
