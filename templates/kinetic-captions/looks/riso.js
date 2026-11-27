// RISO — a hand-made two-ink zine. Paper ground, two spot inks (fluorescent
// pink + blue) printed with 'multiply', so where the drums overlap they make
// the one dark a riso press can make (overprint navy). Every phrase is a torn
// paper slip slapped over the footage, a pink under-sheet peeking out; words
// are PRINTED as they are spoken — both drums, a hair misregistered — and
// stressed words are stamped big in blue over a knocked-off pink twin.
// Hero moment: the drum rolls down the frame and the footage becomes a
// two-ink print (pink flat tint + blue halftone screen, paper highlights); the
// key word is stamped huge across it (behind the head when there is a matte —
// the person is re-printed in the same two inks over it) or, in the free band,
// a big hero slip carries the word. Paper grain boils at 15 fps over it all.
function overprint(...inks) {
  const cs = inks.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255));
  const m = cs.reduce((a, c) => a.map((v, i) => v * c[i]));
  return '#' + m.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}
const PAPER = '#F3EFE6', PINK = '#FF48B0', BLUE = '#0078BF';

export default {
  id: 'riso',
  summary: 'riso zine: torn paper slips, two misregistered inks, the hero goes duotone halftone print',
  fonts: ['riso', 'stamp'],
  uppercase: true,
  palette: { bg: PAPER, ink: overprint(PAPER, PINK, BLUE), a: PINK, b: BLUE, shade: PAPER },
  zone: { vertical: 0.69 },
  build(A) {
    const { K, P, W, H, unit, tall, split, seed, capBig, capSmall, cxZone, IW, safeTop, safeBottom, sizeFor, up, flow, giant, clip, grade, hasMatte, fps } = A;
    const fR = A.font('riso'), fS = A.font('stamp');
    const space = capSmall * 0.52;
    const padX = capSmall * 0.62, padY = capSmall * 0.58;
    const misPx = 2.2 * unit;

    // ── type ──────────────────────────────────────────────────────────────
    const shapeBig = (text, cap) => K.shape(fR, text, { size: sizeFor(fR, cap), tracking: -10, kerning: 'optical' });
    const shapeSmall = (text, cap) => K.shape(fS, text, { size: sizeFor(fS, cap), tracking: 30, kerning: 'metric' });
    // connective words stay phone-readable (≥ 0.9 capSmall); a stressed word that
    // is too wide for the slip shrinks ON ITS OWN instead of shrinking the line
    const bigCap = capBig * 0.6, smallCap = capSmall * 0.9;
    const slipW = IW - capSmall * 1.24;
    const fitBig = (text, cap, width) => K.shape(fR, text, { size: Math.min(sizeFor(fR, cap), K.fitSize(fR, text, width, { tracking: -10 })), tracking: -10, kerning: 'optical' });
    const shapeWord = (w) => (w.big ? fitBig(up(w.text), bigCap, slipW) : shapeSmall(up(w.text), smallCap));
    const reshape = (w, fit) => (w.big ? fitBig(up(w.text), bigCap * fit, slipW) : shapeSmall(up(w.text), smallCap * Math.max(fit, 0.88)));

    // per-phrase print pass: drum offsets, slip angle, torn edge, twins
    function pass(p) {
      const r = K.rng(seed, 'riso-pass', p.k);
      const ang = () => r() * Math.PI * 2;
      const a0 = ang(), a1 = ang();
      const m0 = (0.5 + 0.5 * r()) * misPx, m1 = (0.5 + 0.5 * r()) * misPx;
      p.mis = { a: [Math.round(Math.cos(a0) * m0 * 2) / 2, Math.round(Math.sin(a0) * m0 * 2) / 2], b: [Math.round(Math.cos(a1) * m1 * 2) / 2, Math.round(Math.sin(a1) * m1 * 2) / 2] };
      p.slipAng = (r() - 0.5) * 0.05;
      p.underDx = (r() < 0.5 ? -1 : 1) * (8 + 6 * r()) * unit;
      p.underDy = (9 + 5 * r()) * unit;
      p.underAng = p.slipAng + (r() - 0.5) * 0.06;
      for (const w of p.words) {
        const q = K.rng(seed, 'riso-twin', p.k, w.j);
        w.twin = { dx: (q() - 0.5) * 9 * unit, dy: (2 + q() * 5) * unit, rot: (q() - 0.5) * 0.07 };
      }
    }
    /** A torn paper slip around a box (local coords centred on 0,0). */
    function slipPath(w, h, key) {
      const r = K.rng(seed, 'riso-slip', key);
      const path = new Path2D();
      const step = 26 * unit, jag = 2.6 * unit;
      const pts = [];
      const edge = (x0, y0, x1, y1, jx, jy) => {
        const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
        for (let i = 0; i < n; i++) { const u = i / n; pts.push([x0 + (x1 - x0) * u + (r() - 0.5) * 2 * jag * jx, y0 + (y1 - y0) * u + (r() - 0.5) * 2 * jag * jy]); }
      };
      const x0 = -w / 2, x1 = w / 2, y0 = -h / 2, y1 = h / 2;
      edge(x0, y0, x1, y0, 0.3, 1); edge(x1, y0, x1, y1, 1, 0.3); edge(x1, y1, x0, y1, 0.3, 1); edge(x0, y1, x0, y0, 1, 0.3);
      pts.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
      path.closePath();
      return path;
    }
    const boxOf = (items) => ({
      x0: Math.min(...items.map((it) => it.x + it.run.inkLeft)), x1: Math.max(...items.map((it) => it.x + it.run.inkRight)),
      y0: Math.min(...items.map((it) => it.y + it.run.inkTop)), y1: Math.max(...items.map((it) => it.y + it.run.inkBottom)),
    });
    function makeSlip(p, box, key, grow = false) {
      const w = box.x1 - box.x0 + padX * 2, h = box.y1 - box.y0 + padY * 2;
      p.slip = { cx: (box.x0 + box.x1) / 2, cy: (box.y0 + box.y1) / 2, w, h, path: slipPath(w, h, key) };
      // the slip GROWS with the phrase: it hugs the ink of the words spoken so far
      // (padded), stretching as each word lands — never a wide empty strip
      const steps = [];
      if (grow) {
        const seen = [];
        for (const it of [...p.items].sort((a, b) => a.w.start - b.w.start)) {
          seen.push(it);
          const b = boxOf(seen);
          steps.push({ t: it.w.start, cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, w: b.x1 - b.x0 + padX * 2, h: b.y1 - b.y0 + padY * 2 });
        }
      }
      if (!steps.length) steps.push({ t: -Infinity, cx: p.slip.cx, cy: p.slip.cy, w, h });
      p.slip.steps = steps;
    }
    /** The slip's box at t: the first word's box plus one spring per later word. */
    function slipAt(p, t) {
      const st = p.slip.steps;
      const cur = { ...st[0] };
      for (let j = 1; j < st.length; j++) {
        const d = t - st[j].t + 0.05;
        if (d <= 0) break;
        const u = K.springStep(d, 8, 0.82);
        for (const k of ['cx', 'cy', 'w', 'h']) cur[k] += (st[j][k] - st[j - 1][k]) * u;
      }
      return cur;
    }

    // ── layout ────────────────────────────────────────────────────────────
    function layout(p) {
      pass(p);
      if (p.hero && p.front) {
        // the HERO SLIP: a big poster slapped into the free band — the key word
        // printed huge, the rest of the phrase in small stamp lines around it
        const ki = p.words.indexOf(p.key);
        const gCap = Math.min(H * (tall ? 0.14 : split ? 0.24 : 0.2), capBig * 1.6);
        let gRun = shapeBig(up(p.key.text), gCap);
        const maxW = IW - padX * 2;
        if (gRun.advance > maxW) gRun = shapeBig(up(p.key.text), gCap * (maxW / gRun.advance));
        const lineOf = (ws) => {
          if (!ws.length) return null;
          let runs = ws.map((w) => shapeSmall(up(w.text), smallCap));
          const width = () => runs.reduce((a, r, i) => a + r.advance + (i ? space : 0), 0);
          if (width() > maxW) { const f = maxW / width(); runs = ws.map((w) => shapeSmall(up(w.text), smallCap * f)); }
          let x = cxZone - width() / 2;
          return ws.map((w, i) => { const it = { w, run: runs[i], x }; x += runs[i].advance + space; return it; });
        };
        const pre = lineOf(p.words.slice(0, ki)), post = lineOf(p.words.slice(ki + 1));
        const gap = smallCap * 0.75;
        const centerY = split ? H / 2 : (tall ? 0.68 : 0.7) * H;
        const blockH = (pre ? smallCap + gap : 0) + gRun.capPx + (post ? gap + smallCap : 0);
        let y = centerY - blockH / 2;
        if (pre) { y += smallCap; pre.forEach((it) => (it.y = y)); y += gap; }
        y += gRun.capPx;
        const gItem = { w: p.key, run: gRun, x: cxZone - (gRun.inkLeft + gRun.inkRight) / 2, y };
        if (post) { y += gap + smallCap; post.forEach((it) => (it.y = y)); }
        const items = [...(pre || []), gItem, ...(post || [])];
        // keep the slip inside the safe area
        let box = boxOf(items);
        const lim1 = safeBottom - padY, lim0 = Math.max(safeTop, tall ? H * 0.52 : safeTop) + padY;
        const dy = box.y1 > lim1 ? lim1 - box.y1 : box.y0 < lim0 ? lim0 - box.y0 : 0;
        if (dy) items.forEach((it) => (it.y += dy));
        box = boxOf(items);
        p.items = items;
        p.gItem = gItem;
        makeSlip(p, box, p.k);
        return { box, minCap: Math.min(...items.map((it) => it.run.capPx)), fg: P.ink, bg: P.shade };
      }
      const lay = flow(p, shapeWord, { space, leading: capSmall * 0.46, width: IW - padX * 2, reshape });
      p.items = p.words.map((w) => ({ w, run: w.run, x: w.x, y: w.y }));
      makeSlip(p, lay.box, p.k, true);
      if (p.hero) {
        // behind / cover: the giant is stamped across the print, the slip reads below
        const gi = giant(p, fR, { tracking: -20 });
        p.giant = gi.run; p.gx = gi.x; p.gy = gi.y;
      }
      return { box: lay.box, minCap: lay.minCap, fg: P.ink, bg: P.shade };
    }

    // ── the duotone print (hero) ──────────────────────────────────────────
    const HW = Math.ceil(W / 2), HH = Math.ceil(H / 2);
    const scratch = new OffscreenCanvas(HW, HH);
    const sg = scratch.getContext('2d');
    const print = new OffscreenCanvas(W, H);
    const pg = print.getContext('2d');
    const pitch = Math.max(6, Math.round(11 * unit));
    const cols = Math.ceil(W / pitch) * 2 + 4, rows = Math.ceil(H / pitch) * 2 + 4; // half-pitch tone map
    const tone = new OffscreenCanvas(cols, rows);
    const tg = tone.getContext('2d', { willReadFrequently: true });
    const dotCache = new WeakMap();
    const gray = `${grade || ''} grayscale(1)`;
    /**
     * The blue drum: a 15° halftone screen, dot area ∝ shadow density — and
     * the frame's print levels (3rd/97th luminance percentiles), so a dark
     * phone clip still prints paper highlights, pink mids and navy shadows.
     */
    function dotsFor(t, frame) {
      const bmp = clip.frame(t);
      if (!bmp) return null;
      const key = `${frame.x.toFixed(1)},${frame.y.toFixed(1)},${frame.w.toFixed(1)}`;
      let ent = dotCache.get(bmp);
      if (ent && ent.key === key) return ent;
      tg.setTransform(1, 0, 0, 1, 0, 0);
      tg.fillStyle = '#000'; tg.fillRect(0, 0, cols, rows);
      tg.filter = gray;
      const s = 2 / pitch;
      clip.draw(tg, t, { x: frame.x * s, y: frame.y * s, w: frame.w * s, h: frame.h * s });
      tg.filter = 'none';
      const px = tg.getImageData(0, 0, cols, rows).data;
      const hist = new Uint32Array(256);
      for (let i = 0; i < px.length; i += 4) hist[px[i]]++;
      const pct = (f) => { let acc = 0; const n = cols * rows * f; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n) return v / 255; } return 1; };
      const lo = pct(0.03), hi = Math.max(lo + 0.12, pct(0.97));
      const path = new Path2D();
      const ang = (15 * Math.PI) / 180, ca = Math.cos(ang), sa = Math.sin(ang);
      const cx = W / 2, cy = H / 2, R = Math.hypot(W, H) / 2 + pitch;
      const n = Math.ceil(R / pitch);
      for (let i = -n; i <= n; i++) {
        for (let j = -n; j <= n; j++) {
          const u = i * pitch, v = j * pitch;
          const x = cx + u * ca - v * sa, y = cy + u * sa + v * ca;
          if (x < -pitch || x > W + pitch || y < -pitch || y > H + pitch) continue;
          const tx = Math.min(cols - 1, Math.max(0, Math.round(x * s))), ty = Math.min(rows - 1, Math.max(0, Math.round(y * s)));
          const n = (px[(ty * cols + tx) * 4] / 255 - lo) / (hi - lo);
          const cov = Math.pow(K.clamp((0.5 - n) / 0.5), 1.1);
          if (cov < 0.03) continue;
          const r = Math.min(pitch * 0.74, pitch * Math.sqrt(cov / Math.PI));
          path.moveTo(x + r, y);
          path.arc(x, y, r, 0, Math.PI * 2);
        }
      }
      // the same levels as a CSS filter for the flat pink drum: n = (x - lo)/(hi - lo)
      const b = 1 / (lo + hi), c = (lo + hi) / (hi - lo);
      ent = { key, path, filter: `${gray} brightness(${b.toFixed(4)}) contrast(${c.toFixed(4)})` };
      dotCache.set(bmp, ent);
      return ent;
    }
    /** Print the frame as two inks into g (canvas coords), clipped to y < rollY. */
    /**
     * The two-ink print of this frame (canvas coords), rendered once per
     * (video frame, camera rect, pass) and reused for the ground and the
     * re-printed person: paper, the flat pink drum (half-res — a tint), and
     * the blue halftone screen, each drum knocked off by the pass offsets.
     */
    let memo = { bmp: null, key: '' };
    function printFor(t, frame, p) {
      const ent = dotsFor(t, frame);
      if (!ent) return null;
      const bmp = clip.frame(t);
      const key = ent.key + '|' + p.k;
      if (memo.bmp === bmp && memo.key === key) return print;
      pg.setTransform(1, 0, 0, 1, 0, 0);
      pg.globalCompositeOperation = 'source-over';
      pg.fillStyle = P.bg; pg.fillRect(0, 0, W, H);
      // pink drum: coverage = darkness (screen(gray, ink) is the ink layer)
      sg.setTransform(1, 0, 0, 1, 0, 0);
      sg.globalCompositeOperation = 'source-over';
      sg.fillStyle = '#000'; sg.fillRect(0, 0, HW, HH);
      sg.filter = ent.filter;
      clip.draw(sg, t, { x: frame.x / 2, y: frame.y / 2, w: frame.w / 2, h: frame.h / 2 });
      sg.filter = 'none';
      sg.globalCompositeOperation = 'screen';
      sg.fillStyle = P.a; sg.fillRect(0, 0, HW, HH);
      pg.globalCompositeOperation = 'multiply';
      pg.drawImage(scratch, 0, 0, HW, HH, p.mis.a[0] * 2, p.mis.a[1] * 2, HW * 2, HH * 2);
      // blue drum: the halftone screen
      pg.translate(p.mis.b[0] * 2, p.mis.b[1] * 2);
      pg.fillStyle = P.b; pg.fill(ent.path);
      pg.setTransform(1, 0, 0, 1, 0, 0);
      pg.globalCompositeOperation = 'source-over';
      memo = { bmp, key };
      return print;
    }
    /** Print the frame as two inks into g (canvas coords), clipped to y < rollY. */
    function duotone(g, t, frame, p, rollY) {
      const pr = printFor(t, frame, p);
      if (!pr) return;
      g.save();
      g.beginPath(); g.rect(0, 0, W, rollY); g.clip();
      g.drawImage(pr, 0, 0);
      g.restore();
    }
    // envelope of a hero: the drum rolls down in 0.3 s, lifts off at the end
    function duo(hit) {
      if (!hit || hit.d < -0.03) return null;
      const roll = K.smoothstep(0, 1, (hit.d + 0.03) / 0.3);
      const off = 1 - K.smoothstep(0, 1, (hit.d - hit.hold + 0.12) / 0.26);
      if (off <= 0.002) return null;
      return { roll, off, rollY: roll >= 1 ? H : H * roll };
    }

    const behindCut = (p) => p && p.hero && !p.front && hasMatte;
    // the drum's wet leading edge while it rolls
    const rollEdge = (g, e) => { if (e.roll < 1) { g.save(); g.globalCompositeOperation = 'multiply'; g.fillStyle = P.a; g.fillRect(0, e.rollY - 7 * unit, W, 7 * unit); g.restore(); } };

    // ── drawing ───────────────────────────────────────────────────────────
    // ink both drums, misregistered; stressed words stamped blue over a pink twin
    function inkItem(g, it, p, alpha, press) {
      const { w, run } = it;
      const grp = { s: press };
      if (w.big || it === p.gItem) {
        const tw = w.twin;
        K.drawRun(g, run, it.x + tw.dx, it.y + tw.dy, { fill: P.a, alpha, group: { ...grp, rot: tw.rot } });
        K.drawRun(g, run, it.x + p.mis.b[0], it.y + p.mis.b[1], { fill: P.b, alpha, group: grp });
      } else {
        K.drawRun(g, run, it.x + p.mis.a[0], it.y + p.mis.a[1], { fill: P.a, alpha, group: grp });
        K.drawRun(g, run, it.x + p.mis.b[0], it.y + p.mis.b[1], { fill: P.b, alpha, group: grp });
      }
    }
    function drawSlip(g, t, p) {
      const lead = 0.07;
      const d = t - p.start + lead;
      if (d < 0) return;
      const pop = K.springStep(d, 7.5, 0.72);
      // paper never goes see-through: the slip drops away in two frames
      const outU = K.clamp((t - (p.out - 0.075)) / 0.075);
      const a = K.clamp(d / 0.04) * (1 - outU);
      if (a <= 0.002) return;
      const S = p.slip, B = slipAt(p, t);
      const sx = B.w / S.w, sy = B.h / S.h;
      const sc = 1.1 - 0.1 * K.clamp(pop, 0, 1.15);
      g.save();
      g.globalAlpha = a;
      g.translate(B.cx, B.cy + outU * 26 * unit);
      g.rotate(p.slipAng * (0.4 + 0.6 * K.clamp(pop, 0, 1.1)) + outU * p.slipAng * 1.5);
      g.scale(sc, sc);
      // pink under-sheet, then the paper slip (the torn outline stretched to the current box)
      g.save(); g.translate(p.underDx, p.underDy); g.rotate(p.underAng - p.slipAng); g.scale(sx, sy); g.fillStyle = P.a; g.fill(S.path); g.restore();
      g.save(); g.scale(sx, sy); g.fillStyle = P.bg; g.fill(S.path); g.restore();
      g.translate(-B.cx, -B.cy);
      g.globalCompositeOperation = 'multiply';
      for (const it of p.items) {
        const wd = t - it.w.start;
        if (wd < 0) continue;
        const press = 1 + 0.16 * (1 - K.springStep(wd, 10, 0.9));
        inkItem(g, it, p, K.clamp(wd / 0.035), press);
      }
      g.restore();
    }
    function drawGiant(g, t, p, e) {
      const d = t - p.key.start;
      if (d < -0.02 || !p.giant) return;
      const press = 1.28 - 0.28 * K.clamp(K.springStep(d + 0.02, 8, 0.72), 0, 1.12);
      const a = K.clamp((d + 0.02) / 0.04) * (e ? e.off : 1);
      const tw = p.key.twin;
      g.save();
      g.globalCompositeOperation = 'multiply';
      K.drawRun(g, p.giant, p.gx - tw.dx * 1.6, p.gy - tw.dy * 1.4, { fill: P.b, alpha: a, group: { s: press, rot: -tw.rot * 0.6 } });
      K.drawRun(g, p.giant, p.gx, p.gy, { fill: P.a, alpha: a, group: { s: press, rot: tw.rot * 0.4 } });
      g.restore();
    }

    return {
      layout,
      footage(g, t, frame, hit) {
        g.save(); if (grade) g.filter = grade; clip.draw(g, t, frame); g.restore();
        const e = duo(hit);
        if (!e) return;
        // a behind-the-head hero prints everything over the cut-out instead (onSubject)
        if (behindCut(hit.p)) return rollEdge(g, e);
        if (e.off >= 1) duotone(g, t, frame, hit.p, e.rollY);
        else {
          // lift-off: the print fades back to the footage
          g.save(); g.globalAlpha = e.off;
          duotone(g, t, frame, hit.p, e.rollY);
          g.restore();
        }
        rollEdge(g, e);
      },
      behind(g, t, tq, p, hit) {
        if (p && p.hero && !p.front && !behindCut(p) && hit && hit.p === p) drawGiant(g, t, p, duo(hit));
      },
      onSubject(g, t, tq, p, hit, frame, cut) {
        // the whole print goes down OVER the natural cut-out (no colour fringe at
        // the matte's soft edge): paper + inks, the giant, then the speaker
        // re-printed in the same two inks — so the giant sits BEHIND a printed person
        const e = cut && hit && hit.p === p ? duo(hit) : null;
        if (!e) return;
        g.save(); g.globalAlpha = e.off; duotone(g, t, frame, p, e.rollY); g.restore();
        drawGiant(g, t, p, e);
        clip.light(g, t, frame, (lg) => duotone(lg, t, frame, p, e.rollY), { blend: 'source-over', alpha: e.off });
        rollEdge(g, e);
      },
      hit(g, t, hit) {
        // press flash: the sheet goes paper-white for a beat
        if (hit && hit.flash > 0.002) { g.save(); g.globalAlpha = Math.min(1, hit.flash * 1.4); g.fillStyle = P.bg; g.fillRect(0, 0, W, H); g.restore(); }
      },
      front(g, t, tq, p) {
        drawSlip(g, tq, p);
      },
      post(g, t, hit) {
        const e = duo(hit);
        K.grain(g, W, H, { seed, frame: Math.floor(t * 15 + 1e-6), amount: 0.07 + (e ? 0.07 * e.off : 0), mode: 'multiply', size: 256 });
      },
    };
  },
};
