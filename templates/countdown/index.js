// COUNTDOWN — "Top N" list sequence.
// Each entry arrives on a bar (alternating horizontal smash-pan / vertical
// push). Its giant numeral is first only an OUTLINE: the numeral's own glyph
// path is the window onto an accent fill that rises inside it, then it snaps
// solid on the beat. Title slams in, the one-line detail types. A rail counts
// N → 1; #1 gets an extra hit; the piece closes on a ranked recap.
import * as K from '../../src/kit/index.js';

const STYLES = ['slam', 'cinematic', 'stack'];
const STYLE_PALETTE = {
  slam: {},
  cinematic: { bg: '#0A0908', ink: '#F1ECE2', dim: '#A39C8F', a: '#E0B25A' },
  stack: { bg: '#0D0D12', ink: '#F4F4F6', dim: '#9C9CA8', a: '#7CFF4F' },
};

export default {
  id: 'countdown',
  version: '1.1.0',
  name: 'Countdown',
  description:
    'Top-N list sequence in three styles: slam (numerals fill through their own outline, titles slam, smash-pans), cinematic (dip-through-black, blur-in titles, letterbox, grain), stack (a leaderboard that builds: past entries drop into a growing ranked list). Rail, #1 hit, ranked recap. YouTube list videos, rankings, reveals.',
  tags: ['list', 'ranking', 'top-n', 'youtube', 'reveal', 'sequence'],
  formats: ['landscape', 'square', 'vertical', 'portrait'],
  bpm: 120,
  duration: 30,
  loop: false,
  palette: { bg: '#0B0B0B', ink: '#F4F4F4', dim: '#9A9A9A', a: '#FFD400' },
  paletteRoles: { bg: 'background', ink: 'titles', dim: 'details, rail, outlines (neutral)', a: 'numeral fill, rail marker, #1 hit' },
  fonts: {
    numeral: { family: 'Anton', weight: 400 },
    title: { family: 'Archivo Black', weight: 400 },
    mono: { family: 'IBM Plex Mono', weight: 500 },
  },
  params: {
    style: 'slam',
    beatsPerItem: 8,
    introBeats: 4,
    recapBeats: 8,
    tracking: { title: -30, mono: 20 },
    recap: true,
  },
  schema: {
    content: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'items'],
      properties: {
        title: { type: 'string', maxLength: 48, description: 'Intro title, e.g. "5 EDITS THAT FEEL EXPENSIVE".' },
        kicker: { type: 'string', maxLength: 24, description: 'Small mono label above the intro title.' },
        items: {
          type: 'array',
          minItems: 2,
          maxItems: 10,
          description: 'In RANK order: items[0] is #1.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['title'],
            properties: { title: { type: 'string', maxLength: 40 }, detail: { type: 'string', maxLength: 64 } },
          },
        },
        order: { enum: ['desc', 'asc'], description: 'desc = count down N→1 (default), asc = 1→N.' },
      },
    },
    params: {
      type: 'object',
      additionalProperties: false,
      properties: {
        style: { enum: STYLES, description: 'slam (smash-pans, slams) | cinematic (dip-through-black, blur-in, letterbox, grain) | stack (building leaderboard)' },
        beatsPerItem: { type: 'number', minimum: 2, maximum: 32 },
        introBeats: { type: 'number', minimum: 0, maximum: 16 },
        recapBeats: { type: 'number', minimum: 0, maximum: 32 },
        tracking: { type: 'object', properties: { title: { type: 'number' }, mono: { type: 'number' } }, additionalProperties: false },
        recap: { type: 'boolean' },
      },
    },
  },
  notes: 'items are given in rank order (#1 first). Duration = intro + items × beatsPerItem + recap, unless the spec sets duration.',
  example: {
    template: 'countdown',
    format: 'landscape',
    fps: 60,
    bpm: 120,
    seed: 3,
    content: {
      kicker: 'RANKED / 2026',
      title: '5 EDITS THAT FEEL EXPENSIVE',
      items: [
        { title: 'SOUND FIRST', detail: 'cut the picture to the music, never the reverse' },
        { title: 'MOTION BLUR', detail: 'real sub-frames, not a smear filter' },
        { title: 'ONE TYPEFACE', detail: 'two weights, strict tracking' },
        { title: 'HARD CUTS ON THE BEAT', detail: 'fades are where energy goes to die' },
        { title: 'NEGATIVE SPACE', detail: 'the frame breathes when you let it' },
      ],
    },
  },

  build(ctx) {
    const { W, H, params, fonts, beat, qa, fps, seed } = ctx;
    const style = STYLES.includes(params.style) ? params.style : 'slam';
    const cine = style === 'cinematic', stackS = style === 'stack';
    const userPal = ctx.spec.palette || {};
    for (const [k, v] of Object.entries(STYLE_PALETTE[style])) if (!(k in userPal)) ctx.palette[k] = v;
    const P = ctx.palette;
    const C = ctx.spec.content?.items ? { ...ctx.spec.content } : ctx.content;
    const fN = fonts.get('numeral'), fT = fonts.get('title'), fM = fonts.get('mono');
    const tr = params.tracking;
    const unit = Math.min(W, H) / 1080;
    const M = Math.round(Math.min(W, H) * 0.07);
    const IW = W - 2 * M, IH = H - 2 * M;
    const cx = W / 2, cy = H / 2;
    const q = (t) => K.frameQuant(t, fps);
    const B = (n) => beat.t(n);
    const aspect = ctx.aspect;
    const N = C.items.length;
    const order = C.order === 'asc' ? C.items.map((_, i) => i) : C.items.map((_, i) => N - 1 - i); // play order → item index
    const bpi = params.beatsPerItem, ib = params.introBeats;
    const itemStart = (k) => B(ib + k * bpi);
    const tRecap = itemStart(N);
    const duration = ctx.spec.duration ?? tRecap + (params.recap ? params.recapBeats : 2) * beat.spb;
    const mono = (s, size) => K.shape(fM, s, { size, tracking: tr.mono, kerning: 'metric' });

    // ── layout per entry
    const railH = 60 * unit;
    const barH = cine ? Math.round(H * (aspect === 'landscape' ? 0.1 : 0.06)) : 0; // letterbox
    const heroTop = M + barH * 0.6;
    // stack: the hero lives in the upper part; the growing list takes the rest
    const heroH = stackS ? (IH - railH) * (aspect === 'landscape' ? 0.58 : 0.5) : IH - railH - barH * 1.2;
    const rows = aspect === 'landscape' ? 'side' : 'stack';
    const numBox = rows === 'side' ? { x: M, y: heroTop, w: IW * 0.42, h: heroH } : { x: M, y: heroTop, w: IW, h: heroH * (aspect === 'vertical' ? 0.46 : 0.5) };
    const textBox = rows === 'side'
      ? { x: M + IW * 0.47, y: heroTop, w: IW * 0.53, h: heroH }
      : { x: M, y: numBox.y + numBox.h + 24 * unit, w: IW, h: heroH - numBox.h - 24 * unit };

    const entries = C.items.map((it, idx) => {
      const rank = idx + 1;
      const label = String(rank);
      // numeral: as tall as the box allows, bounded by width
      const byH = (numBox.h * 0.92 * fN.upm) / fN.capHeight;
      const byW = K.fitSize(fN, label, numBox.w * (label.length > 1 ? 0.98 : 0.8), { tracking: -20 });
      const nRun = K.shape(fN, label, { size: Math.min(byH, byW), tracking: -20 });
      const nx = rows === 'side' ? numBox.x - nRun.inkLeft : numBox.x - nRun.inkLeft;
      const nBase = rows === 'side' ? K.snap(numBox.y + numBox.h / 2 + nRun.capPx / 2, 8) : K.snap(numBox.y + numBox.h, 8);
      // side layout: the text column hugs the numeral (a narrow "1" no longer leaves a hole)
      const tx = rows === 'side' ? Math.min(textBox.x, nx + nRun.inkRight + Math.round(72 * unit)) : textBox.x;
      const tb = { ...textBox, x: tx, w: textBox.x + textBox.w - tx };
      // title: 1–3 balanced lines, biggest that fits the text box
      const words = it.title.toUpperCase().trim().split(/\s+/);
      let best = null;
      const maxCap = (rows === 'side' ? 0.16 : 0.1) * H;
      for (let n = 1; n <= Math.min(3, words.length); n++) {
        const ls = n === 1 ? [words.join(' ')] : splitBalanced(words, n);
        const sz = Math.min(...ls.map((l) => K.fitSize(fT, l, tb.w, { tracking: tr.title })), (maxCap * fT.upm) / fT.capHeight);
        const cap = fT.px(fT.capHeight, sz);
        const h = cap * n + cap * 0.28 * (n - 1);
        if (h > tb.h * 0.62) continue;
        const score = cap * (n === 1 ? 1 : 0.97);
        if (!best || score > best.score) best = { ls, sz, cap, score };
      }
      if (!best) best = { ls: splitBalanced(words, 3), sz: (tb.h * 0.15 * fT.upm) / fT.capHeight };
      const tRuns = best.ls.map((l) => K.shape(fT, l, { size: best.sz, tracking: tr.title }));
      const tGap = Math.round(tRuns[0].capPx * 0.28);
      const dSize = Math.max(30 * unit, Math.min(44 * unit, tRuns[0].capPx * 0.4));
      const dLines = it.detail ? wrapMono(it.detail, dSize, tb.w) : [];
      const dRuns = dLines.map((l) => mono(l, dSize));
      const dLead = dSize * 1.45;
      const blockH = K.stackHeight(tRuns, tGap) + (dRuns.length ? 36 * unit + dRuns.length * dLead : 0);
      const top = rows === 'side' ? tb.y + (tb.h - blockH) / 2 : tb.y + Math.min(40 * unit, (tb.h - blockH) / 2);
      const tBases = K.stackInk(tRuns, { top: K.snap(top, 8), gap: tGap });
      const dTop = tBases[tBases.length - 1] + 36 * unit + dRuns[0]?.capPx;
      let dBases = dRuns.map((_, i) => dTop + i * dLead);
      let nB = nBase, tB = tBases;
      if (rows === 'stack') {
        // centre numeral + text as one block in the space above the rail
        const blockTop = nBase - nRun.capPx;
        const blockBot = dBases.length ? dBases[dBases.length - 1] + 8 * unit : tBases[tBases.length - 1];
        const off = K.snap(heroTop + heroH / 2 - (blockTop + blockBot) / 2, 8);
        nB = nBase + off; tB = tBases.map((y) => y + off); dBases = dBases.map((y) => y + off);
      }
      // side layout: centre numeral + text as one block horizontally
      let dx = 0;
      if (rows === 'side') {
        const right = Math.max(...tRuns.map((r) => tx + r.inkWidth), ...dRuns.map((r) => tx + r.advance));
        dx = Math.max(0, Math.round((M + IW - right) / 2) - 0);
        dx = Math.min(dx, Math.round(IW * 0.06));
      }
      return { rank, idx, nRun, nx: nx + dx, tx: tx + dx, nBase: nB, nPath: K.runPath(nRun, nx + dx, nB), tRuns, tBases: tB, dRuns, dBases, detail: it.detail || '', dLines, dSize, cxN: nx + dx + (nRun.inkLeft + nRun.inkRight) / 2, cyN: nB - nRun.capPx / 2 };
    });

    function splitBalanced(ws, n) {
      const lines = K.balanceLines(fT, ws.join(' '), 1e9, { size: 100, tracking: tr.title });
      if (lines.length === n) return lines;
      // exhaustive: minimise the widest line
      let best = null;
      const rec = (s, left, acc) => {
        if (left === 1) {
          const all = [...acc, ws.slice(s).join(' ')];
          const w = Math.max(...all.map((l) => K.shape(fT, l, { size: 100, tracking: tr.title }).inkWidth));
          if (!best || w < best.w) best = { w, all };
          return;
        }
        for (let e = s + 1; e <= ws.length - (left - 1); e++) rec(e, left - 1, [...acc, ws.slice(s, e).join(' ')]);
      };
      rec(0, n, []);
      return best.all;
    }
    function wrapMono(s, size, maxW) {
      const out = [];
      let cur = '';
      for (const w of s.split(/\s+/)) {
        const tryL = cur ? cur + ' ' + w : w;
        if (cur && mono(tryL, size).advance > maxW) { out.push(cur); cur = w; } else cur = tryL;
      }
      if (cur) out.push(cur);
      return out.slice(0, 3);
    }

    // ── events
    const ev = order.map((idx, k) => {
      const t0 = itemStart(k);
      return {
        e: entries[idx], k, t0,
        tWipe: t0 + 0.12,
        tSnap: t0 + beat.spb * (cine ? 1.75 : 1),
        tTitle: t0 + beat.spb * (cine ? 2 : 1.5),
        tDetail: t0 + beat.spb * (cine ? 3 : 2),
        mode: cine ? 'dip' : stackS ? 'cut' : k % 2 === 0 ? 'pan' : 'push',
      };
    });
    ev.forEach((v) => {
      qa.hit(v.t0, `#${v.e.rank} arrives`);
      qa.hit(v.tSnap, `#${v.e.rank} snaps`);
      qa.hit(v.tDetail, `#${v.e.rank} detail`);
    });
    const one = ev.find((v) => v.e.rank === 1);
    const oneZoom = new K.Track(1).spring(one.tSnap, 1.07, 'slam').spring(one.tSnap + beat.spb * 2, 1, 'glide');
    qa.hit(one.tSnap + beat.spb * 2, '#1 settle');

    // intro
    const kick = C.kicker ? mono(C.kicker.toUpperCase(), 20 * unit) : null;
    const iWords = C.title.toUpperCase().split(/\s+/);
    let iBest = null;
    for (let n = 1; n <= Math.min(4, iWords.length); n++) {
      const ls = n === 1 ? [iWords.join(' ')] : splitBalanced(iWords, n);
      const sz = Math.min(...ls.map((l) => K.fitSize(fT, l, IW, { tracking: tr.title })), (H * (aspect === 'landscape' ? 0.2 : 0.12) * fT.upm) / fT.capHeight);
      const cap = fT.px(fT.capHeight, sz);
      if (cap * n * 1.3 > IH * 0.7) continue;
      if (!iBest || cap > iBest.cap * 1.15) iBest = { ls, sz, cap };
    }
    const iRuns = iBest.ls.map((l) => K.shape(fT, l, { size: iBest.sz, tracking: tr.title }));
    const iGap = Math.round(iRuns[0].capPx * 0.22);
    const iH = K.stackHeight(iRuns, iGap) + (kick ? 50 * unit : 0);
    const iBases = K.stackInk(iRuns, { top: K.snap(cy - iH / 2 + (kick ? 50 * unit : 0), 8), gap: iGap });
    const tIntro = B(0);
    if (ib > 0) {
      qa.hit(tIntro, 'intro title');
      for (let b = 1; b < ib; b++) qa.hit(B(b), 'intro beat');
    }

    // QA text registration
    entries.forEach((e) => {
      e.tRuns.forEach((r, i) => qa.text(`#${e.rank}-title-${i}`, { box: K.runBox(r, e.tx - r.inkLeft, e.tBases[i]), size: r.capPx, fg: P.ink, bg: P.bg }));
      e.dRuns.forEach((r, i) => qa.text(`#${e.rank}-detail-${i}`, { box: K.runBox(r, e.tx, e.dBases[i]), size: r.capPx * 1.4, fg: P.dim, bg: P.bg }));
      qa.text(`#${e.rank}-numeral`, { box: K.runBox(e.nRun, e.nx, e.nBase), size: e.nRun.capPx, fg: P.a, bg: P.bg });
    });
    iRuns.forEach((r, i) => qa.text('intro-' + i, { box: K.runBox(r, M - r.inkLeft, iBases[i]), size: r.capPx, fg: P.ink, bg: P.bg }));

    // ── drawing
    function drawEntry(g, v, t) {
      const e = v.e;
      // numeral: outline → rising accent fill inside its own glyph → solid
      if (t < v.tSnap) {
        g.save();
        g.lineWidth = Math.max(2, 3 * unit);
        g.strokeStyle = P.dim;
        g.stroke(e.nPath);
        g.clip(e.nPath, 'nonzero');
        const u = K.clamp((t - v.tWipe) / (v.tSnap - v.tWipe));
        const fill = K.quintInOut(u);
        const top = e.nBase - e.nRun.capPx * 1.02;
        const yEdge = e.nBase + 4 - (e.nBase + 4 - top) * fill;
        g.fillStyle = P.a;
        g.fillRect(0, yEdge, W, H);
        g.restore();
      } else {
        const pop = 1 + 0.06 * (1 - K.springStep(t - v.tSnap, 4, 0.55));
        K.drawRun(g, e.nRun, e.nx, e.nBase, { fill: P.a, group: { s: pop } });
      }
      // title slams in from the right, per glyph
      if (t >= v.tTitle) {
        let k0 = 0;
        e.tRuns.forEach((r, li) => {
          K.drawRun(g, r, e.tx - r.inkLeft, e.tBases[li], {
            fill: P.ink,
            each: (it, k) => {
              if (cine) {
                // cinematic: the line fades up out of focus, no slam
                const t0 = v.tTitle + li * 0.12;
                const p = K.springStep(t - t0, 1.2, 1);
                return { alpha: K.clamp(p), blur: (1 - p) * 10 * unit, dy: (1 - p) * 14 * unit };
              }
              const t0 = v.tTitle + (k0 + k) * 0.022;
              if (t < t0) return { hidden: true };
              const p = K.springStep(t - t0, 3.2, 0.7);
              return { dx: (1 - p) * W * 0.35, alpha: K.clamp(K.springStep(t - t0, 10, 1)) };
            },
          });
          k0 += r.inked.length;
        });
      }
      // detail types
      if (e.dLines.length && t >= v.tDetail) {
        let n = K.typed(e.dLines.join('\n'), q(t), v.tDetail, 45, seed + e.rank);
        e.dLines.forEach((l, i) => {
          const m = Math.min(l.length, Math.max(0, n));
          n -= l.length + 1;
          if (m <= 0) return;
          K.drawRun(g, mono(l.slice(0, m), e.dSize), e.tx, e.dBases[i], { fill: P.dim });
        });
      }
    }

    // stack style: entries leave the hero and drop into a growing ranked list
    const listTop = heroTop + heroH + Math.round(34 * unit);
    const listBottom = H - M - railH - 10 * unit;
    const lCap = Math.min(52 * unit, Math.max(20 * unit, (listBottom - listTop) / Math.max(1, N - 1) / 1.9));
    const lRow = lCap * 1.9;
    const lSize = (lCap * fT.upm) / fT.capHeight;
    const listRows = ev.map((v, k) => {
      const pos = new K.Track(-1);
      for (let j = k + 1; j < ev.length; j++) pos.spring(ev[j].t0, j - k - 1, j === k + 1 ? { f: 3.4, z: 0.72 } : 'snap');
      const lt = v.e.tRuns.map((r) => r.text).join(' ');
      const titleRun = K.shape(fT, lt, { size: Math.min(lSize, K.fitSize(fT, lt, IW - 160 * unit, { tracking: tr.title })), tracking: tr.title });
      return { v, pos, titleRun, num: mono('#' + String(v.e.rank).padStart(2, '0'), lCap * 1.1), tIn: ev[k + 1]?.t0 ?? Infinity };
    });
    function drawList(g, t) {
      if (!stackS) return;
      K.bar(g, M, listTop - 16 * unit, IW * K.clamp((t - itemStart(0)) / 0.5), Math.max(1, 2 * unit), P.dim);
      for (const row of listRows) {
        if (t < row.tIn) continue;
        const p = row.pos.at(t);
        const y = listTop + lCap + p * lRow;
        if (y > listBottom + lCap) continue;
        const a = K.clamp(K.springStep(t - row.tIn, 6, 1));
        const slide = (1 - K.springStep(t - row.tIn, 3.2, 0.75)) * -60 * unit;
        K.drawRun(g, row.num, M + slide, y, { fill: P.a, alpha: a });
        K.drawRun(g, row.titleRun, M + 150 * unit + slide - row.titleRun.inkLeft, y, { fill: P.ink, alpha: a });
      }
    }
    if (stackS) listRows.forEach((row) => qa.text(`list-${row.v.e.rank}`, { box: K.runBox(row.titleRun, M + 150 * unit - row.titleRun.inkLeft, listTop + lCap), size: lCap, fg: P.ink, bg: P.bg }));

    // progress rail: N ticks, current in an accent block
    const railSlot = Math.min(76 * unit, (IW * 0.6) / N);
    const railY = H - M;
    const railX = (k) => M + k * railSlot;
    const railPos = new K.Track(-1);
    ev.forEach((v) => railPos.spring(v.t0, v.k, { f: 3.6, z: 0.8 }));
    function drawRail(g, t) {
      if (t < itemStart(0) - 0.2) return;
      const a = K.clamp((t - itemStart(0) + 0.2) / 0.3);
      const pos = railPos.at(t);
      const mw = railSlot - 8 * unit, mh = 38 * unit;
      if (pos > -0.5) K.bar(g, railX(pos), railY - mh + 8 * unit, mw, mh, P.a);
      ev.forEach((v, k) => {
        const r = mono(String(v.e.rank).padStart(2, '0'), 22 * unit);
        const on = Math.abs(pos - k) < 0.5;
        K.drawRun(g, r, railX(k) + (mw - r.advance) / 2, railY - 3 * unit, { fill: on ? P.bg : k < pos ? P.ink : P.dim, alpha: a });
      });
    }
    qa.text('rail', { box: { x0: M, y0: railY - 34 * unit, x1: railX(N), y1: railY }, size: 22 * unit * 0.7, fg: P.dim, bg: P.bg, decorative: true });

    function drawIntro(g, t) {
      if (kick) K.drawRun(g, kick, M, iBases[0] - iRuns[0].capPx - 36 * unit, { fill: P.a, alpha: K.clamp((t - tIntro) / 0.2) });
      iRuns.forEach((r, i) => {
        const t0 = tIntro + i * beat.spb * 0.5;
        if (t < t0) return;
        K.drawRun(g, r, M - r.inkLeft, iBases[i], {
          fill: P.ink,
          each: (it, k) => {
            const p = K.springStep(t - t0 - k * 0.018, 2.8, 0.62);
            return t <= t0 + k * 0.018 ? { hidden: true } : { dy: (1 - p) * H * 1.1 };
          },
        });
      });
    }

    // recap: ranked list, #1 on an accent bar
    const recapRows = C.items.map((it, i) => ({ n: String(i + 1).padStart(2, '0'), t: it.title.toUpperCase() }));
    const numCol = 120 * unit;
    // recap: one size for every row (a list, not a ransom note); titles may wrap
    // to two lines, and the size is the largest at which the whole list fits
    const wrapT = (str, size, maxW) => {
      const out = [];
      let cur = '';
      for (const w of str.split(/\s+/)) {
        const tryL = cur ? cur + ' ' + w : w;
        if (cur && K.shape(fT, tryL, { size, tracking: tr.title }).inkWidth > maxW) { out.push(cur); cur = w; } else cur = tryL;
      }
      if (cur) out.push(cur);
      return out;
    };
    let rSize = (Math.min(IH * 0.1, 110 * unit) * fT.upm) / fT.capHeight, rLayout = null;
    for (let it = 0; it < 40; it++, rSize *= 0.94) {
      const cap = fT.px(fT.capHeight, rSize);
      const lay = recapRows.map((r) => wrapT(r.t, rSize, IW - numCol));
      if (lay.some((l) => l.length > (aspect === 'landscape' ? 2 : 3) || l.some((x) => K.shape(fT, x, { size: rSize, tracking: tr.title }).inkWidth > IW - numCol))) continue;
      const lines = lay.reduce((a, l) => a + l.length, 0);
      const hgt = lines * cap * 1.3 + (N - 1) * cap * 0.75;
      if (hgt > IH * 0.82) continue;
      rLayout = { lay, cap };
      break;
    }
    const rCap = rLayout.cap, rLine = rCap * 1.3, rGap = rCap * 0.75;
    const rRows = [];
    {
      const total = rLayout.lay.reduce((a, l) => a + l.length, 0) * rLine + (N - 1) * rGap - (rLine - rCap);
      let y = K.snap(cy - total / 2 + rCap, 4);
      rLayout.lay.forEach((ls) => {
        const runs = ls.map((l) => K.shape(fT, l, { size: rSize, tracking: tr.title }));
        rRows.push({ runs, ys: runs.map((_, k) => y + k * rLine) });
        y += ls.length * rLine + rGap;
      });
    }
    if (params.recap) {
      qa.hit(tRecap, 'recap');
      rRows.forEach((row, i) => row.runs.forEach((r, k) => qa.text(`recap-${i}-${k}`, { box: K.runBox(r, M + numCol - r.inkLeft, row.ys[k]), size: r.capPx, fg: i === 0 ? P.bg : P.ink, bg: i === 0 ? P.a : P.bg })));
    }
    function drawRecap(g, t) {
      rRows.forEach((row, i) => {
        const t0 = tRecap + 0.15 + (N - 1 - i) * 0.07;
        if (t < t0) return;
        const p = K.springStep(t - t0, 3.2, 0.75);
        g.save();
        g.translate((1 - p) * -W * 0.4, 0);
        const y0 = row.ys[0], y1 = row.ys[row.ys.length - 1];
        if (i === 0) {
          const bp = K.springStep(t - (tRecap + beat.spb * 2), 4, 0.85);
          if (bp > 0) K.bar(g, M - 16 * unit, y0 - rCap - 14 * unit, (IW + 32 * unit) * bp, y1 - y0 + rCap + 28 * unit, P.a);
        }
        const on = i === 0 && t >= tRecap + beat.spb * 2 + 0.05;
        K.drawRun(g, mono(recapRows[i].n, rCap * 0.9), M, y0, { fill: on ? P.bg : P.a });
        row.runs.forEach((r, k) => K.drawRun(g, r, M + numCol - r.inkLeft, row.ys[k], { fill: on ? P.bg : P.ink }));
        g.restore();
      });
    }
    if (params.recap) qa.hit(tRecap + beat.spb * 2, 'recap #1 bar');

    // keyframes
    const kf = [[0, 'start'], [B(0.6), 'intro slam'], [B(Math.max(0, ib - 0.5)), 'intro settled']];
    ev.forEach((v, k) => {
      if (k === 0 || k === 1) kf.push([v.t0 + 0.1, `#${v.e.rank} ${v.mode}`], [v.t0 + beat.spb * 0.6, `#${v.e.rank} wipe`]);
      kf.push([v.t0 + beat.spb * 4, `#${v.e.rank} settled`]);
    });
    kf.push([one.tSnap + 0.03, '#1 hit']);
    if (params.recap) kf.push([tRecap + beat.spb * 3, 'recap']);
    kf.push([duration - 1 / fps, 'last frame']);
    kf.sort((a, b) => a[0] - b[0]).slice(0, 18).forEach(([t, l]) => qa.keyframe(Math.min(duration - 1 / fps, t), l));

    const TRANS = 0.55;
    return {
      duration,
      samplesHint: (t) => (ev.some((v) => t > v.t0 && t < v.t0 + TRANS * 0.6) || (t > tRecap && t < tRecap + TRANS * 0.6) ? 24 : 0),
      draw(g, t) {
        // #1 flash: two frames of accent
        if (!cine && t >= one.tSnap && t < one.tSnap + 2 / fps) {
          g.fillStyle = P.a;
          g.fillRect(0, 0, W, H);
        }
        const k = ev.findLastIndex((v) => t >= v.t0);
        const recap = params.recap && t >= tRecap;
        const cur = recap ? 'recap' : k;
        const tIn = recap ? tRecap : k >= 0 ? ev[k].t0 : null;
        const prev = recap ? N - 1 : k - 1;
        const drawScene = (which, tt) => {
          if (which === 'recap') drawRecap(g, tt);
          else if (which === -1) drawIntro(g, tt);
          else {
            g.save();
            if (ev[which].e.rank === 1) {
              // punch in about the numeral itself so it never gets shoved off-frame
              const z = oneZoom.at(tt), e1 = ev[which].e;
              g.translate(e1.cxN, e1.cyN); g.scale(z, z); g.translate(-e1.cxN, -e1.cyN);
            }
            drawEntry(g, ev[which], tt);
            g.restore();
          }
        };
        const dipT = 0.7;
        if (tIn != null && ((recap ? 'push' : ev[k]?.mode) === 'dip') && t < tIn + dipT) {
          // cinematic dip: outgoing fades + drifts down to black, incoming rises from it
          const u = (t - tIn) / dipT;
          g.save();
          if (u < 0.45) {
            const a = 1 - K.cubicInOut(u / 0.45);
            g.globalAlpha = a;
            const z = 1 + 0.03 * (1 - a);
            g.translate(cx, cy); g.scale(z, z); g.translate(-cx, -cy);
            drawScene(prev, t);
          } else {
            const a = K.cubicInOut((u - 0.45) / 0.55);
            g.globalAlpha = a;
            const z = 1.04 - 0.04 * a;
            g.translate(cx, cy); g.scale(z, z); g.translate(-cx, -cy);
            drawScene(cur, t);
          }
          g.restore();
        } else if (tIn != null && t < tIn + TRANS && (recap || ev[k].mode !== 'cut')) {
          const mode = recap ? 'push' : ev[k].mode;
          const p = K.springStep(t - tIn, 3.4, 0.8);
          g.save();
          if (mode === 'pan') g.translate(-p * W, 0); else g.translate(0, -p * H);
          drawScene(prev, t);
          g.restore();
          g.save();
          if (mode === 'pan') g.translate((1 - p) * W, 0); else g.translate(0, (1 - p) * H);
          drawScene(cur, t);
          g.restore();
        } else drawScene(cur === null || k < 0 ? -1 : cur, t);
        if (!recap) { drawList(g, t); drawRail(g, t); }
        if (cine) {
          const bi = K.clamp(K.springStep(t, 0.8, 1));
          K.bar(g, 0, 0, W, barH * bi, '#000000');
          K.bar(g, 0, H - barH * bi, W, barH * bi, '#000000');
        }
      },
      post(g, t) {
        if (cine) K.grain(g, W, H, { seed, frame: Math.round(q(t) * fps), amount: 0.06, mode: 'overlay' });
      },
    };
  },
};
