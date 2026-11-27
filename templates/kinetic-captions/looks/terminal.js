// TERMINAL — phosphor monospace on a dark terminal plate.
// Each word TYPES as it is spoken (a block caret rides the last typed glyph and
// blinks while he pauses); stressed words DECRYPT from random glyphs into the
// real word, left to right. Hero moment: the frame glitches (RGB split + torn
// horizontal slices + scanline burst), then for about a second the speaker IS
// live ASCII art of himself (the real video frame, sampled into a density ramp)
// with the key word in an inverse-video selection block — then a scan band
// sweeps him back to video, top to bottom. The key word stays behind his head
// as a green selection bar (person matte) or, in front placement, in the free
// lower band with the rest of the phrase typed above and below it.
// Only transcript words are readable text; the ASCII ramp is texture.
const RAMP = ' .:-=+*#%@';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*';
const LOWER = 'abcdefghijklmnopqrstuvwxyz0123456789#$%&*';

export default {
  id: 'terminal',
  summary: 'terminal: phosphor mono captions typed as spoken, key words decrypt; hero = glitch hit, the speaker turns into live ASCII art',
  fonts: ['monoBold', 'mono'],
  palette: { bg: '#020604', ink: '#E6FFEE', a: '#3DFF86', b: '#FFB23E', shade: '#010403' },
  uppercase: false,
  zone: { vertical: 0.71, landscape: 0.84, square: 0.8 },
  build(A) {
    const { K, P, W, H, unit, tall, split, panel, capSmall, colX0, IW, cxZone, zoneY, safeTop, safeBottom, sizeFor, flow, clip, grade, seed, E } = A;
    const fB = A.font('monoBold'), fM = A.font('mono');
    const cap = capSmall * (tall ? 1.02 : split ? 1.3 : 1.08);
    const size = sizeFor(fB, cap);
    const mono = (face, text, sz) => K.shape(face, text, { size: sz, tracking: 0, kerning: 'none', minClear: null });
    const charW = (fB.glyph('M').adv * size) / fB.upm;
    const promptW = charW * 1.5;
    const pad = cap * 0.42;
    const promptRun = mono(fB, '>', size);
    const len = (w) => [...w.text].length;

    // ── typing + decrypt clocks (all on the frame grid: tq) ─────────────────
    const typeDur = (w) => K.clamp(len(w) * 0.028, 0.05, Math.max(0.05, Math.min(0.28, (w.end - w.start) * 0.85)));
    const typedN = (w, tq) => {
      const u = (tq - w.start) / typeDur(w);
      return u < 0 ? 0 : Math.min(len(w), Math.floor(u * len(w)) + 1);
    };
    const pool = (ch) => (ch === ch.toLowerCase() && ch !== ch.toUpperCase() ? LOWER : UPPER);
    // a stressed word scrambles while it types and locks left→right just after
    const lockAt = (w, i) => w.start + typeDur(w) * 0.6 + 0.03 + 0.014 * i;
    const scr = (key, i, ch, tq, t0, lock) => (/[A-Za-z0-9]/.test(ch) ? K.scrambleChar(seed, `${key}:${i}`, ch, tq, lock, { charset: pool(ch), step: 1 / 30, startAt: t0 }) : ch);

    // ── hero timing: glitch in, ASCII window, scan back ─────────────────────
    // the ASCII speaker re-draws him as glyphs and puts the giant word in front of his face: not in personClean (looks behind him), where the giant sits behind him
    const asciiOn = E.level >= 1 && !!clip && !A.personClean; // the ASCII speaker needs footage
    const win = (p) => {
      const t0 = p.key.start + 0.1, dur = K.clamp(p.out - p.key.start - 0.25, 0.55, 1.1);
      return { t0, t1: t0 + dur, back: 0.2 };
    };
    const inAscii = (p, t) => { if (!asciiOn || !p || !p.hero) return false; const w = win(p); return t >= w.t0 && t < w.t1; };
    const glitchAt = (hit, tq) => {
      if (!hit || E.level < 1) return 0;
      const d = tq - hit.p.key.start;
      let g = d >= 0 && d < 0.2 ? 1 - d / 0.2 : 0;
      if (asciiOn) { const w = win(hit.p); const e = tq - w.t1; if (e >= -0.04 && e < 0.1) g = Math.max(g, 0.7 * (1 - Math.max(0, e) / 0.1)); }
      return g * (E.level >= 2 ? 1.3 : 1);
    };

    // ── layout ─────────────────────────────────────────────────────────────
    function layout(p) {
      const x0 = colX0 + promptW;
      const lay = flow(p, (w) => mono(fB, w.text, size), { space: charW, leading: cap * 0.66, width: IW - promptW, align: 'left', x0, reshape: (w, fit) => mono(fB, w.text, size * fit) });
      p.caretW = charW * (lay.rows && p.words[0].run.size < size ? p.words[0].run.size / size : 1);
      const plate = (b, withPrompt = true) => ({ x: (withPrompt ? colX0 : b.x0) - pad, y: b.y0 - pad * 1.15, w: Math.min(W - colX0 * 0.5, b.x1 + charW * 1.1 + pad) - ((withPrompt ? colX0 : b.x0) - pad), h: b.y1 - b.y0 + pad * 2.1 });
      p.plate = plate(lay.box);
      if (p.hero) {
        const T = p.key.text.toUpperCase();
        const front = p.front;
        const gcap = front ? (tall ? 0.085 : split ? 0.2 : 0.15) : tall ? (E.level >= 2 ? 0.14 : 0.1) : 0.24;
        // front: inside the caption column (clear of the Shorts/Reels rail);
        // behind: the top band, centred on the frame (no rail up there)
        const gi = A.giant(p, fB, { text: T, tracking: 0, capFrac: gcap, width: split || front ? IW : W * (tall ? 0.88 : 0.72) });
        p.giant = mono(fB, T, gi.run.size);
        p.gx = front || split ? gi.x : W / 2 - (p.giant.inkLeft + p.giant.inkRight) / 2;
        p.gy = gi.y;
        if (front) {
          // the rest of the phrase types around the block: before-words above, after-words below
          const ki = p.words.indexOf(p.key);
          const small = size * 0.86;
          const lineOf = (ws) => {
            if (!ws.length) return null;
            const runs = ws.map((w) => mono(fB, w.text, small));
            const cw = (fB.glyph('M').adv * small) / fB.upm;
            const width = runs.reduce((a, r, i) => a + r.advance + (i ? cw : 0), 0);
            let x = cxZone - width / 2;
            return ws.map((w, i) => { const it = { w, run: runs[i], x }; x += runs[i].advance + cw; return it; });
          };
          const gap = cap * 0.95;
          if (!split && tall) p.gy = zoneY - cap * 0.2;
          p.pre = lineOf(p.words.slice(0, ki));
          p.post = lineOf(p.words.slice(ki + 1));
          const place = () => {
            if (p.pre) p.pre.forEach((it) => (it.y = p.gy - p.giant.capPx - gap));
            if (p.post) p.post.forEach((it) => (it.y = p.gy + gap + it.run.capPx));
          };
          place();
          const bottom = p.post ? p.post[0].y : p.gy + pad;
          if (bottom > safeBottom) { p.gy -= bottom - safeBottom; place(); }
          const top = p.pre ? p.pre[0].y - p.pre[0].run.capPx : p.gy - p.giant.capPx;
          if (top < safeTop) { p.gy += safeTop - top; place(); }
          const items = [...(p.pre || []), ...(p.post || [])];
          const gb = { x0: p.gx + p.giant.inkLeft, x1: p.gx + p.giant.inkRight, y0: p.gy + p.giant.inkTop, y1: p.gy + p.giant.inkBottom };
          const box = items.reduce((b, it) => ({ x0: Math.min(b.x0, it.x + it.run.inkLeft), x1: Math.max(b.x1, it.x + it.run.inkRight), y0: Math.min(b.y0, it.y + it.run.inkTop), y1: Math.max(b.y1, it.y + it.run.inkBottom) }), gb);
          p.plate = plate(box, false);
          return { box, minCap: Math.min(p.giant.capPx, ...items.map((it) => it.run.capPx)) };
        }
      }
      return lay;
    }

    // ── drawing helpers ────────────────────────────────────────────────────
    const plateOpen = (p, tq) => K.clamp((tq - p.start + 0.03) / 0.08);
    function drawPlate(g, p, tq, rect = p.plate) {
      const u = plateOpen(p, tq);
      if (u <= 0) return;
      const h = rect.h * K.cubicOut(u);
      const y = rect.y + (rect.h - h) / 2;
      g.save();
      g.globalAlpha = 0.74;
      g.fillStyle = P.shade;
      g.fillRect(rect.x, y, rect.w, h);
      g.globalAlpha = 0.9;
      g.fillStyle = P.a;
      g.fillRect(rect.x, y, rect.w, Math.max(2, Math.round(3 * unit)));
      g.fillRect(rect.x, y, Math.max(2, Math.round(3 * unit)), Math.min(h, cap * 0.7));
      g.restore();
    }
    // a word as typed so far; stressed words decrypt; `inv` = selection block
    function drawWord(g, w, run, x, y, tq, { fill, inv = false, scramble = false, t0 = w.start, lock = (i) => lockAt(w, i), n = typedN(w, tq) } = {}) {
      if (n <= 0) return;
      const L = len(w);
      if (inv) {
        const it = run.items[Math.min(n, run.items.length) - 1];
        const right = n >= L ? run.advance : it.x + it.adv;
        g.save(); g.fillStyle = P.a;
        g.fillRect(x - charW * 0.22, y - run.capPx - cap * 0.3, right + charW * 0.44, run.capPx + cap * 0.58);
        g.restore();
      }
      const busy = n < L || (scramble && tq < lock(L - 1));
      if (!busy) { K.drawRun(g, run, x, y, { fill }); return; }
      K.drawRun(g, run, x, y, { fill, each: (it) => (it.i >= n ? { hidden: true } : scramble ? { ch: scr(w.i, it.i, it.ch, tq, t0, lock(it.i)) } : null) });
    }
    function caret(g, x, y, c, tq, solid) {
      if (!solid && !K.caretOn(tq, 1.0)) return;
      g.save(); g.fillStyle = P.a; g.globalAlpha = 0.95;
      g.fillRect(x + c * 0.12, y - cap * 1.02, c * 0.62, cap * 1.12);
      g.restore();
    }
    function drawRows(g, tq, p) {
      drawPlate(g, p, tq);
      const r0 = p.words[0];
      K.drawRun(g, promptRun, colX0, r0.y, { fill: P.a, alpha: plateOpen(p, tq) });
      let last = null;
      for (const w of p.words) {
        const n = typedN(w, tq);
        if (n <= 0) continue;
        last = { w, n };
        const key = p.hero && w === p.key;
        drawWord(g, w, w.run, w.x, w.y, tq, { fill: key ? P.bg : w.big ? P.a : P.ink, inv: key, scramble: w.big || key, n });
      }
      if (last) {
        const { w, n } = last;
        const typing = n < len(w);
        const cx = typing ? w.x + w.run.items[n].x : w.x + w.run.advance + charW * 0.1;
        caret(g, cx, w.y, charW * (w.run.size / size), tq, typing);
      }
    }
    // the hero word: an inverse-video selection block that sweeps open, the
    // letters decrypting inside it
    function drawGiant(g, tq, p, { alpha = 1 } = {}) {
      const d = tq - p.key.start;
      if (d < 0 || tq >= p.out) return;
      const r = p.giant;
      const px = r.capPx * 0.2, py = r.capPx * 0.24;
      const x0 = p.gx + r.inkLeft - px, full = r.inkWidth + px * 2;
      const u = K.clamp(d / 0.09);
      const bw = full * K.cubicOut(u);
      const y0 = p.gy - r.capPx - py, bh = r.capPx + py * 2;
      g.save();
      g.globalAlpha = alpha;
      g.fillStyle = P.a;
      g.fillRect(x0, y0, bw, bh);
      g.beginPath(); g.rect(x0, y0, bw, bh); g.clip();
      const n = Math.ceil(len({ text: r.text }) * u);
      K.drawRun(g, r, p.gx, p.gy, { fill: P.bg, each: (it) => (it.i >= n ? { hidden: true } : { ch: scr(`g${p.k}`, it.i, it.ch, tq, p.key.start, p.key.start + 0.1 + 0.022 * it.i) }) });
      g.restore();
    }
    function drawAround(g, tq, p) {
      drawPlate(g, p, tq);
      let last = null;
      for (const it of [...(p.pre || []), ...(p.post || [])]) {
        const n = typedN(it.w, tq);
        if (n <= 0) continue;
        last = { it, n };
        drawWord(g, it.w, it.run, it.x, it.y, tq, { fill: it.w.big ? P.a : P.ink, scramble: it.w.big, n });
      }
      drawGiant(g, tq, p);
      if (last && last.it.w.start > p.key.start - 1e-6) {
        const { it, n } = last;
        const typing = n < len(it.w);
        caret(g, typing ? it.x + it.run.items[n].x : it.x + it.run.advance + charW * 0.1, it.y, charW * (it.run.size / size), tq, typing);
      }
    }

    // ── ASCII field of the live frame (one tiny CPU canvas, memo per frame) ──
    const R = split ? { x: 0, y: 0, w: panel.w, h: panel.h } : { x: 0, y: 0, w: W, h: H };
    const cellW = Math.max(7, Math.round((tall ? 12.5 : split ? 9 : 11) * unit));
    const cellH = Math.round(cellW * 1.85);
    const sampler = new OffscreenCanvas(8, 8);
    const sg = sampler.getContext('2d', { willReadFrequently: true });
    const rampGl = (() => {
      const S = 40, c = new OffscreenCanvas(S, S), cg = c.getContext('2d', { willReadFrequently: true });
      return [...RAMP].map((ch) => {
        const gl = fM.glyph(ch);
        cg.setTransform(1, 0, 0, 1, 0, 0); cg.clearRect(0, 0, S, S);
        if (gl.hasInk) { const s = S / fM.upm; cg.setTransform(s, 0, 0, s, 2, S * 0.8); cg.fillStyle = '#fff'; cg.fill(gl.path2d); }
        const dd = cg.getImageData(0, 0, S, S).data; let a = 0;
        for (let i = 3; i < dd.length; i += 4) a += dd[i];
        return { gl, a };
      }).sort((x, y) => x.a - y.a).map((r) => r.gl);
    })();
    const gs = cellW / (fM.glyph('M').adv || fM.upm * 0.6);
    const NB = 4;
    const inks = [[0.32, 'a'], [0.62, 'a'], [0.92, 'a'], [1, 'ink']];
    let memo = { key: null, bmp: null, buckets: null, img: null, half: null };
    // glyph atlas: one cell per (ramp glyph × tone bucket), drawn once
    let _atlas = null;
    const atlas = () => {
      if (_atlas) return _atlas;
      _atlas = new OffscreenCanvas(cellW * rampGl.length, cellH * NB);
      const ag = _atlas.getContext('2d');
      rampGl.forEach((gl, gi) => {
        if (!gl.hasInk) return;
        for (let b = 0; b < NB; b++) {
          ag.setTransform(gs, 0, 0, gs, gi * cellW, b * cellH + cellH * 0.78);
          ag.globalAlpha = inks[b][0]; ag.fillStyle = P[inks[b][1]];
          ag.fill(gl.path2d);
        }
      });
      return _atlas;
    };
    function field(tq, t) {
      const bmp = clip.frame(tq) || clip.frame(t);
      if (memo.key === tq && memo.bmp === bmp) return memo;
      const cols = Math.ceil(R.w / cellW) + 1, rows = Math.ceil(R.h / cellH) + 1;
      sampler.width = cols; sampler.height = rows;
      if (!bmp) { memo = { key: tq, bmp, buckets: null, img: memo.img, half: memo.half }; return memo; }
      sg.imageSmoothingEnabled = true; sg.imageSmoothingQuality = 'high';
      const s = Math.max(R.w / bmp.width, R.h / bmp.height);
      const dw = (bmp.width * s) / cellW, dh = (bmp.height * s) / cellH;
      sg.clearRect(0, 0, cols, rows);
      sg.drawImage(bmp, (R.w / cellW - dw) / 2, (R.h / cellH - dh) / 2, dw, dh);
      const d = sg.getImageData(0, 0, cols, rows).data;
      const N = cols * rows, Lm = new Float32Array(N);
      for (let k = 0; k < N; k++) Lm[k] = (0.2126 * d[k * 4] + 0.7152 * d[k * 4 + 1] + 0.0722 * d[k * 4 + 2]) / 255;
      // auto-levels: the frame's own 3rd–99th percentile spans the ramp (dark footage still reads)
      const sorted = Float32Array.from(Lm).sort();
      const lo = sorted[Math.floor(N * 0.03)], hi = sorted[Math.floor(N * 0.99)], range = Math.max(0.06, hi - lo);
      // bake the frame's ASCII (with its phosphor bloom) ONCE per output frame;
      // motion-blur sub-samples only blit it. Cells are blits from a glyph atlas.
      if (!memo.img) memo.img = new OffscreenCanvas(R.w, R.h);
      const img = memo.img, ig = img.getContext('2d');
      const at = atlas();
      ig.setTransform(1, 0, 0, 1, 0, 0);
      ig.globalCompositeOperation = 'source-over'; ig.filter = 'none'; ig.globalAlpha = 1;
      ig.fillStyle = P.bg; ig.fillRect(0, 0, R.w, R.h);
      const nG = rampGl.length;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const l = Math.pow(K.clamp((Lm[r * cols + c] - lo) / range), 0.8);
          const gi = Math.min(nG - 1, Math.floor(l * nG));
          if (!rampGl[gi].hasInk) continue;
          ig.drawImage(at, gi * cellW, Math.min(NB - 1, Math.floor(l * NB)) * cellH, cellW, cellH, c * cellW, r * cellH, cellW, cellH);
        }
      }
      // bloom at half resolution (4× cheaper than a full-size blur)
      if (!memo.half) memo.half = new OffscreenCanvas(Math.ceil(R.w / 2), Math.ceil(R.h / 2));
      const hg = memo.half.getContext('2d');
      hg.setTransform(1, 0, 0, 1, 0, 0); hg.filter = 'none'; hg.clearRect(0, 0, memo.half.width, memo.half.height);
      hg.filter = `blur(${(2.5 * unit).toFixed(1)}px)`;
      hg.drawImage(img, 0, 0, memo.half.width, memo.half.height);
      hg.filter = 'none';
      ig.globalAlpha = 0.45; ig.globalCompositeOperation = 'lighter';
      ig.drawImage(memo.half, 0, 0, R.w, R.h);
      ig.globalAlpha = 1; ig.globalCompositeOperation = 'source-over';
      memo = { key: tq, bmp, buckets: true, img, half: memo.half };
      return memo;
    }
    function drawAscii(g, t, tq, p, frame) {
      const f = field(tq, t);
      const w = win(p);
      // scan back: video returns from the top, a bright scan band leads the edge
      const back = K.clamp((tq - (w.t1 - w.back)) / w.back);
      const B = split ? panel : { x: 0, y: 0, w: W, h: H };
      const edge = B.y + K.cubicInOut(back) * (B.h + cap) - cap * 0.5;
      g.save();
      g.beginPath(); g.rect(B.x, Math.max(B.y, edge), B.w, B.y + B.h - Math.max(B.y, edge) + 2); g.clip();
      g.fillStyle = P.bg; g.fillRect(B.x, B.y, B.w, B.h);
      // zoom punch continues on the ASCII by transform (sampling stays per frame)
      let T = frame;
      if (split) {
        // the core punches the panel in about its upper third; follow it
        const z = frame.w / W - 1, fx = panel.x + panel.w / 2, fy = panel.y + panel.h * 0.32;
        T = { x: fx - (fx - panel.x) * (1 + z), y: fy - (fy - panel.y) * (1 + z), w: panel.w * (1 + z), h: panel.h * (1 + z) };
      }
      if (f.buckets) g.drawImage(f.img, T.x, T.y, T.w, T.h);
      g.restore();
      if (back > 0 && back < 1) {
        g.save(); g.globalCompositeOperation = 'screen';
        const band = g.createLinearGradient(0, edge - cap * 1.4, 0, edge + 4);
        band.addColorStop(0, 'rgba(61,255,134,0)'); band.addColorStop(1, 'rgba(61,255,134,0.55)');
        g.beginPath(); g.rect(B.x, B.y, B.w, B.h); g.clip();
        g.fillStyle = band; g.fillRect(B.x, edge - cap * 1.4, B.w, cap * 1.4 + 4);
        g.restore();
      }
    }

    // ── footage: phosphor grade; glitch = torn slices + red/cyan split ──────
    let scratch = null;
    function footage(g, t, frame, hit) {
      const tq = A.q(t);
      g.save(); if (grade) g.filter = grade; clip.draw(g, t, frame); g.restore();
      g.save(); g.globalCompositeOperation = 'multiply'; g.globalAlpha = 0.3; g.fillStyle = '#B8FFD2'; g.fillRect(0, 0, W, H); g.restore();
      const gl = glitchAt(hit, tq);
      if (gl <= 0) return;
      const fb = Math.floor(tq * 30);
      const bands = 14;
      for (let i = 0; i < bands; i++) {
        const r = K.noise1(seed, 'tear', fb, i);
        if (r < 0.55) continue;
        const y0 = (H * i) / bands, bh = H / bands;
        const off = (K.noise1(seed, 'tearx', fb, i) - 0.5) * 2 * 110 * unit * gl;
        g.save(); g.beginPath(); g.rect(0, y0, W, bh); g.clip();
        if (grade) g.filter = grade;
        clip.draw(g, t, { ...frame, x: frame.x + off });
        g.restore();
      }
      // RGB split: take the red channel out of the plate, add it back shifted
      const dx = (16 + 10 * K.noise1(seed, 'rgb', fb)) * unit * gl;
      if (!scratch) scratch = new OffscreenCanvas(W, H);
      const sc = scratch.getContext('2d');
      sc.setTransform(1, 0, 0, 1, 0, 0);
      sc.globalCompositeOperation = 'source-over';
      sc.filter = grade || 'none';
      sc.clearRect(0, 0, W, H);
      clip.draw(sc, t, { ...frame, x: frame.x + dx });
      sc.filter = 'none';
      sc.globalCompositeOperation = 'multiply'; sc.fillStyle = '#FF0000'; sc.fillRect(0, 0, W, H);
      g.save(); g.globalCompositeOperation = 'multiply'; g.fillStyle = '#00FFFF'; g.fillRect(0, 0, W, H); g.restore();
      g.save(); g.globalCompositeOperation = 'lighter'; g.drawImage(scratch, 0, 0); g.restore();
    }

    return {
      layout,
      footage,
      behind(g, t, tq, p) { if (p && p.hero && !p.front && !inAscii(p, tq)) drawGiant(g, tq, p); },
      onSubject(g, t, tq, p, hit, frame) { if (inAscii(p, tq)) drawAscii(g, t, tq, p, frame); },
      hit(g, t, hit) {
        if (!hit) return;
        const tq = A.q(t);
        const gl = glitchAt(hit, tq);
        if (hit.flash > 0.002) { g.save(); g.globalCompositeOperation = 'screen'; g.globalAlpha = hit.flash * 0.9; g.fillStyle = P.a; g.fillRect(0, 0, W, H); g.restore(); }
        if (gl > 0) {
          // tear lines: a few bright one-pixel-high scan tears
          const fb = Math.floor(tq * 30);
          g.save(); g.globalCompositeOperation = 'screen'; g.fillStyle = P.ink;
          for (let i = 0; i < 5; i++) {
            const y = K.noise1(seed, 'line', fb, i) * H;
            g.globalAlpha = 0.25 * gl + 0.35 * gl * K.noise1(seed, 'la', fb, i);
            if (split) { if (y > panel.y && y < panel.y + panel.h) g.fillRect(panel.x, Math.round(y), panel.w, Math.max(1, Math.round(2 * unit))); }
            else g.fillRect(0, Math.round(y), W, Math.max(1, Math.round(2 * unit)));
          }
          g.restore();
        }
      },
      front(g, t, tq, p) {
        if (p.hero && !p.front && inAscii(p, tq)) drawGiant(g, tq, p);
        if (p.hero && p.front) drawAround(g, tq, p);
        else drawRows(g, tq, p);
      },
      post(g, t, hit) {
        const tq = A.q(t);
        const gl = glitchAt(hit, tq);
        const hot = hit && inAscii(hit.p, tq);
        g.save();
        g.fillStyle = '#000000';
        g.globalAlpha = 0.16 + 0.2 * Math.min(1, gl) + (hot ? 0.12 : 0);
        const sl = Math.max(3, Math.round(4 * unit));
        for (let y = 0; y < H; y += sl) g.fillRect(0, y, W, Math.max(1, Math.round(sl / 2.6)));
        g.globalAlpha = 1;
        const r = Math.hypot(W, H) / 2;
        const v = g.createRadialGradient(W / 2, H / 2, r * 0.5, W / 2, H / 2, r * 1.05);
        v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.6)');
        g.fillStyle = v; g.fillRect(0, 0, W, H);
        g.restore();
      },
    };
  },
};
