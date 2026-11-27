// readable looks behind him (plan.readable, a caller opt-in): absent = the spec is exactly what it always was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windowSpec } from '../src/cli/compose.js';
import kc from '../templates/kinetic-captions/index.js';
import { wallGeometry, readableWanted, READABLE_LOOKS } from '../templates/kinetic-captions/looks/readable.js';

const words = [{ text: 'woman', start: 0.5, end: 1 }, { text: 'worth', start: 1.2, end: 1.9 }];
const win = (look) => ({ id: 'm1', role: 'moment', start: 0, end: 4, in: 0, out: 0, look, energy: 'signature', heroes: [0.5] });
const spec = (plan, look = 'neon', extra = {}) => windowSpec({ video: 'v.mp4', look, ...plan }, win(look), words, { fps: 30, format: { width: 1080, height: 1920, fps: 30 }, name: 'm', ...extra });

test('readable is off unless the plan asks, and only with personClean in noir / neon / terminal', () => {
  assert.equal(spec({ personClean: true }).params.readable, undefined);
  assert.equal(spec({ personClean: true, readable: true }).params.readable, true);
  assert.equal(spec({ readable: true }).params.readable, undefined, 'no personClean, no readable');
  for (const look of ['cover', 'poster', 'marker', 'riso']) assert.equal(spec({ personClean: true, readable: true }, look).params.readable, undefined, look);
  assert.deepEqual(spec({ personClean: true }), spec({ personClean: true, readable: false }));
});

test('a letterboxed picture strip is rendered with canvas: picture (type sized to the strip width)', () => {
  const pic = { y0: 700, y1: 1180, h: 480 };
  const s = spec({ personClean: true, readable: true }, 'noir', { pic, baseH: 1920, format: { width: 1080, height: 480, fps: 30 } });
  assert.equal(s.params.canvas, 'picture');
  assert.equal(spec({ personClean: true }, 'noir', { pic, baseH: 1920 }).params.canvas, undefined);
});

test('the template declares readable and canvas, and loads the house fonts only for a readable window', () => {
  assert.ok(kc.schema.params.properties.readable && kc.schema.params.properties.canvas);
  assert.ok(!kc.fontsFor({ look: 'neon' }).includes('display'));
  assert.ok(kc.fontsFor({ look: 'neon', readable: true }).includes('display'));
  assert.ok(readableWanted({ readable: true }, 'terminal') && !readableWanted({ readable: true }, 'cover') && READABLE_LOOKS.size === 3);
});

// the wall of the hero word behind him must be poster-sized: the old neon sign was ~0.1 of the height with a thin tube face
test('the wall behind him is big: rows of cap height >= 9% of a vertical frame, >= 30% of a picture strip', () => {
  const tall = wallGeometry({ W: 1080, H: 1920, tall: true, canvasPic: false });
  assert.ok(tall.cap / 1920 >= 0.09, `vertical cap ${tall.cap}`);
  assert.ok(tall.rows * tall.cap * 1.16 >= 0.4 * 1920);
  const strip = wallGeometry({ W: 1080, H: 480, tall: false, canvasPic: true });
  assert.ok(strip.cap / 480 >= 0.3, `strip cap ${strip.cap}`);
  assert.ok(strip.cap >= 140, 'a strip sign is as big in pixels as a vertical frame\'s caption block');
});

import { cleanVerdictOfRender } from '../templates/kinetic-captions/personclean.js';
import { cleanFields } from '../src/cli/compose.js';
test('the receipt says a window was drawn readable only when the template noted it AND personClean applied', () => {
  const notes = (...n) => ({ qa: { layout: { notes: n } } });
  assert.deepEqual(cleanVerdictOfRender(notes('personClean: applied', 'readable: house caption')), { applied: true, readable: true });
  assert.deepEqual(cleanVerdictOfRender(notes('personClean: applied')), { applied: true });
  assert.deepEqual(cleanVerdictOfRender(notes('personClean: not applied - no person matte', 'readable: x')), { applied: false, why: 'no person matte' });
  assert.deepEqual(cleanFields({ look: 'neon', clean: { applied: true, readable: true } }, { personClean: true }), { personClean: true, readable: true });
});

// ── review fixes (Opus reviewer, 2026-10-28) ────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import * as K from '../src/kit/index.js';
import noir from '../templates/kinetic-captions/looks/noir.js';
import cover from '../templates/kinetic-captions/looks/cover.js';
import { HOUSE_OUTLINE, withHouseOutline, buildReadable } from '../templates/kinetic-captions/looks/readable.js';

const rd = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const fbuf = (f) => { const b = fs.readFileSync(new URL(`../fonts/files/${f}`, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

test('the checkout carries the readable/1 capability marker the app probes, in all three files', () => {
  for (const f of ['templates/kinetic-captions/looks/readable.js', 'templates/kinetic-captions/index.js', 'src/cli/compose.js']) {
    assert.match(rd(f), /kinetype-capability: readable\/1/, f);
  }
});

// a fake template argument: real fonts, real kit, a recording canvas
function fakeA(look, { readable = true, duration = 6 } = {}) {
  const fb = new K.FontBook();
  const faces = {
    display: fb.addBuffer('display', fbuf('ArchivoBlack-400.ttf')), text: fb.addBuffer('text', fbuf('InterTight-800.ttf')),
    serif: fb.addBuffer('serif', fbuf('InstrumentSerif-400.ttf')), italic: fb.addBuffer('italic', fbuf('InstrumentSerif-400i.ttf')), mono: fb.addBuffer('mono', fbuf('IBMPlexMono-500.ttf')),
  };
  const sizeFor = (face, cap) => (cap * face.upm) / face.capHeight;
  const W = 1080, H = 1920;
  return {
    K, W, H, unit: 1, tall: true, split: false, land: false, fps: 30, seed: 7, q: (t) => t, P: look.palette, params: { shadow: 1 }, readable, canvasPic: false,
    ctx: { spec: { duration, palette: {} } }, font: (r) => faces[r], sizeFor, grade: '', clip: null, hasMatte: true, personClean: true,
    capBig: 150, capSmall: 52, cxZone: W / 2, IW: W * 0.86, zoneY: H * 0.7, safeTop: 120, safeBottom: 1700, phrases: [], seed_: 7,
    flicker: () => 1, up: (s) => s.toUpperCase(), look, offHim: (g, t, fn) => fn(g),
    wordIn: (w, t) => ({ d: t - w.start, pop: 1, alpha: 1 }),
  };
}
const rec = () => {
  const calls = [];
  const g = new Proxy({}, { get: (_, k) => (k === 'calls' ? calls : (...a) => { calls.push(String(k)); return k === 'createLinearGradient' ? { addColorStop() {} } : undefined; }), set: () => true });
  return { g, calls };
};

test('noir readable: the background is black and grey for the WHOLE window (saturate 0), eased in and out; the old grade keeps 0.82', () => {
  const sat = (f, t) => Number(/saturate\(([\d.]+)\)/.exec(f.footageFilter(0, t))[1]);
  const on = noir.build(fakeA({ ...noir, id: 'noir' })), off = noir.build(fakeA({ ...noir, id: 'noir' }, { readable: false }));
  for (const t of [0.5, 1.5, 3, 4.5]) { assert.equal(sat(on, t), 0, `t=${t}`); assert.equal(sat(off, t), 0.82); }
  assert.ok(sat(on, 0) > 0.8 && sat(on, 0.15) > 0 && sat(on, 0.15) < 0.82, 'eases in, no pop');
  assert.ok(sat(on, 5.9) > 0.5 && sat(on, 5.85) < sat(on, 5.95), 'eases out into the next colour window');
});

test('the wall and its scrim are drawn only in the behind pass, which runs before he is re-drawn clean; the front pass never draws them', () => {
  const tpl = rd('templates/kinetic-captions/index.js');
  const draw = tpl.slice(tpl.indexOf('// 1) behind the speaker'));
  assert.ok(draw.indexOf('L.behind(g, t, tq, p, hit, frame)') >= 0 && draw.indexOf('L.behind(') < draw.indexOf('drawClean(g, t, frame)'), 'behind before drawClean');
  assert.ok(draw.indexOf('drawClean(g, t, frame)') < draw.indexOf('L.front(g, t, tq, p, hit)'), 'the caption is in front of him');
  const A = fakeA({ ...noir, id: 'noir' });
  const L = buildReadable(A, noir.build(A));
  const fD = A.font('display');
  const run = K.shape(fD, 'WORTH', { size: A.sizeFor(fD, 150), tracking: 6 });
  const p = { hero: true, front: false, k: 0, start: 0.5, out: 5, key: { text: 'worth', start: 1 }, words: [], bgLuma: 0.2,
              wall: { run, ink: run.inkRight - run.inkLeft, cap: 150, gapX: 75, rowH: 174, top: 120, rows: 4, y0: 120, y1: 816, text: 'WORTH' } };
  const b = rec(); L.behind(b.g, 2, 2, p);
  assert.ok(b.calls.includes('createLinearGradient') && b.calls.includes('fillRect'), 'the behind pass draws the scrim and the wall');
  const f = rec(); L.front(f.g, 2, 2, p);
  assert.ok(!f.calls.includes('createLinearGradient') && !f.calls.includes('fillRect'), 'the front pass draws no scrim and no wall');
  const none = rec(); L.behind(none.g, 2, 2, { ...p, front: true }); L.behind(none.g, 2, 2, { ...p, hero: false });
  assert.equal(none.calls.length, 0, 'no wall for a front hero or a plain phrase');
});

test('the house caption has a hard dark outline: >= 4.5:1 against both ink colours, so gold reads on a black shirt and white on a white shirt', () => {
  const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  for (const ink of [cover.palette.ink, cover.palette.a]) assert.ok(cr(ink, HOUSE_OUTLINE.color) >= 4.5, `${ink} vs outline`);
  assert.ok(cr('#FFFFFF', HOUSE_OUTLINE.color) >= 4.5 && HOUSE_OUTLINE.width >= 4, 'the outline separates white type from a white shirt');
  // every type pass is preceded by its stroke-only pass; shadow passes (blurred) are untouched
  const seen = [];
  const KK = { ...K, drawRun: (g, run, x, y, o) => seen.push(o) };
  const W = withHouseOutline(KK, 1);
  W.drawRun(null, null, 0, 0, { fill: '#F4F1EA', alpha: 1 });
  W.drawRun(null, null, 0, 0, { fill: '#000000', alpha: 0.8, blur: 14 });
  assert.equal(seen.length, 4, 'tight halo + outline + fill, then the untouched shadow pass');
  assert.equal(seen[1].stroke, HOUSE_OUTLINE.color); assert.ok(!seen[1].fill && seen[1].strokeWidth >= 4);
  assert.equal(seen[2].fill, '#F4F1EA'); assert.equal(seen[3].blur, 14);
  // and the readable house caption really draws through it
  const A = fakeA({ ...noir, id: 'noir' });
  const L = buildReadable(A, noir.build(A));
  const run = K.shape(A.font('text'), 'HELLO', { size: 60, tracking: 0 });
  const g = rec();
  L.front(g.g, 2, 2, { hero: false, words: [{ text: 'HELLO', run, x: 100, y: 1400, start: 1, end: 1.5, s: 1 }], start: 0.5, out: 5, bgLuma: 0.2, key: null });
  assert.ok(g.calls.filter((c) => c === 'stroke').length >= 1, 'the house caption strokes its words');
});

// ── blind-judge fixes 2026-10-28 (v3: Opus 75 / Fable 78) ───────────────────────────────────────────────────────────────
import { chokeAlpha, chokeImageData, decontaminateEdge } from '../src/kit/media.js';
import { READABLE_CHOKE, houseOutlineWidth, SMALL_WORD_OUTLINE } from '../templates/kinetic-captions/looks/readable.js';

test('no ghost word: the house caption draws a word at full strength from its onset (was a 50 ms fade: dim grey "SHE" on a dark shirt)', () => {
  const A = fakeA({ ...noir, id: 'noir' });
  const seenFade = [];
  A.wordIn = (w, t, p, o = {}) => { seenFade.push(o.fade ?? 0.05); const d = t - w.start; return { d, pop: 1, alpha: d < 0 ? 0 : Math.min(1, d / (o.fade ?? 0.05)), out: 0 }; };
  const L = buildReadable(A, noir.build(A));
  const run = K.shape(A.font('text'), 'SHE', { size: 60, tracking: 0 });
  const alphas = [];
  const g = new Proxy({}, { get: (_, k) => (...a) => (k === 'createLinearGradient' ? { addColorStop() {} } : undefined), set: (_, k, v) => { if (k === 'globalAlpha') alphas.push(v); return true; } });
  L.front(g, 9.8, 9.8, { hero: false, words: [{ text: 'SHE', run, x: 100, y: 1400, start: 9.793, end: 9.99, s: 1 }], start: 9.0, out: 10.1, bgLuma: 0.2, key: null });
  assert.ok(seenFade.length && seenFade.every((f) => f <= 0.005), `fades ${seenFade}`);
  assert.ok(alphas.length && Math.max(...alphas) >= 0.99, `7 ms after its onset the word is drawn at ${Math.max(...alphas)}`);
  const clean = buildReadable({ ...A, params: { ...A.params, style: 'clean' } }, noir.build(A));
  assert.ok(clean, 'style clean (dimmed preview of the whole phrase) falls back to the poster style');
  assert.match(rd('templates/kinetic-captions/looks/readable.js'), /style === 'clean' \? 'poster'/);
});

test('matte choke: the faint fringe goes to 0, the body stays 1, a hair wisp is thinned not cut, and it is monotone', () => {
  const { lo, hi } = READABLE_CHOKE;
  assert.equal(chokeAlpha(255, READABLE_CHOKE), 255);
  assert.equal(chokeAlpha(0, READABLE_CHOKE), 0);
  assert.equal(chokeAlpha(Math.floor(lo * 255) - 2, READABLE_CHOKE), 0, 'the halo fringe (alpha under lo) is dropped');
  assert.equal(chokeAlpha(Math.ceil(hi * 255) + 1, READABLE_CHOKE), 255);
  const wisp = chokeAlpha(0.6 * 255, READABLE_CHOKE);
  assert.ok(wisp > 0.3 * 255 && wisp < 0.6 * 255 + 40, `a 60 % hair wisp survives (${wisp})`);
  let prev = -1; for (let a = 0; a <= 255; a++) { const v = chokeAlpha(a, READABLE_CHOKE); assert.ok(v >= prev); prev = v; }
  // the soft edge gets narrower: the number of partial-alpha pixels across a 24 px linear ramp falls by at least a third
  const ramp = { data: new Uint8ClampedArray(24 * 4).map((_, i) => (i % 4 === 3 ? Math.round(255 * (Math.floor(i / 4) / 23)) : 0)) };
  const partial = (d) => { let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 5 && d[i] < 250) n++; return n; };
  const before = partial(ramp.data);
  const after = partial(chokeImageData({ data: Uint8ClampedArray.from(ramp.data) }, READABLE_CHOKE).data);
  assert.ok(after <= before * 2 / 3, `partial-alpha width ${before} -> ${after}`);
});

test('a readable window cuts him out with the choke, a plain one does not (the cut cache key carries it)', () => {
  const tpl = rd('templates/kinetic-captions/index.js');
  assert.equal((tpl.match(/choke: readableChoke/g) || []).length, 3, 'drawClean, the post silhouette and the offHim cut (neon wash / haze) all use the same choked alpha');
  const media = rd('src/kit/media.js');
  assert.match(media, /choke \? `\$\{choke\.lo\},\$\{choke\.hi\},/);
  assert.match(media, /choke \? chokedMatte\(mt/);
});

// ── his colour: no auto exposure on a personClean compose without a base (the eval prerender relit his face: skin L +17) ──
import { fallbackGrade } from '../src/cli/compose.js';
test('a personClean plan without a base grade gets the identity grade, never the auto exposure that relights him', () => {
  const auto = () => 1.4;
  assert.deepEqual(fallbackGrade({ personClean: true }, auto), { exposure: 1, contrast: 1, saturation: 1 });
  assert.deepEqual(fallbackGrade({ personClean: true, readable: true }, () => { throw new Error('auto must not even be measured'); }), { exposure: 1, contrast: 1, saturation: 1 });
  assert.deepEqual(fallbackGrade({}, auto), { exposure: 1.4, contrast: 1.06, saturation: 0.96 }, 'plans without personClean are exactly what they were');
  assert.deepEqual(fallbackGrade({ personClean: false }, auto), { exposure: 1.4, contrast: 1.06, saturation: 0.96 });
  assert.match(rd('src/cli/compose.js'), /grade = fallbackGrade\(plan,/);
});

// ── blind-judge fixes 2026-10-28 (v5: Opus 75 / Fable 80) ──────────────────────────────────────────────────────────────
test('v5 fault 2: the small secondary caption words get an outline as heavy (relative to size) as the hero words, plus a tight dark halo', () => {
  const calls = [];
  const W = withHouseOutline({ ...K, drawRun: (g, run, x, y, o) => calls.push({ cap: run.capPx, ...o }) }, 1);
  const small = { capPx: 38 }, hero = { capPx: 120 };
  W.drawRun(null, small, 0, 0, { fill: '#F4F1EA' }); W.drawRun(null, hero, 0, 0, { fill: '#E8B04A' });
  const strokeOf = (cap) => calls.find((c) => c.cap === cap && c.stroke);
  assert.ok(strokeOf(38).strokeWidth / 38 >= strokeOf(120).strokeWidth / 120 - 1e-9, 'relative outline of a small word >= the hero word');
  assert.ok(strokeOf(38).strokeWidth >= SMALL_WORD_OUTLINE * 38 - 1e-9 && strokeOf(38).strokeWidth >= 5);
  assert.ok(calls.some((c) => c.cap === 38 && c.fill === HOUSE_OUTLINE.color && c.blur >= 3), 'a tight dark halo under the small word');
  assert.equal(houseOutlineWidth(38, 1), Math.max(5, SMALL_WORD_OUTLINE * 38));
});

test('v5 fault 1: noir greys the BACKGROUND on every frame of a readable window, never only on hero frames; he is drawn clean on every frame', () => {
  const A = fakeA({ ...noir, id: 'noir' }, { readable: true, spec: { duration: 10.1 } });
  const L = noir.build({ ...A, readable: true, ctx: { ...(A.ctx || {}), spec: { duration: 10.1 } } });
  for (const t of [0.4, 2.6, 5.0, 7.4]) assert.match(L.footageFilter(0, t), /saturate\(0\.000\)/, `background fully grey at ${t}s, no hero needed`);
  const tpl = rd('templates/kinetic-captions/index.js');
  const dc = tpl.slice(tpl.indexOf('const drawClean = '), tpl.indexOf('let postLayer'));
  assert.ok(!/hero|heroes/.test(dc), 'drawClean is not gated on a hero span');
});

test('v5 hair: flyaway hair (alpha 0.35-0.6 strands) survives the choke thinned, the halo fringe (<= 0.3) goes, and the offHim cut uses the same alpha', () => {
  const strand = chokeImageData({ data: Uint8ClampedArray.from([0, 0, 0, 0.35 * 255, 0, 0, 0, 0.45 * 255, 0, 0, 0, 0.6 * 255, 0, 0, 0, 0.25 * 255]) }, READABLE_CHOKE).data;
  assert.ok(strand[3] > 0 && strand[7] > strand[3] && strand[11] > strand[7], `strands survive in order ${[strand[3], strand[7], strand[11]]}`);
  assert.equal(strand[15], 0, 'a 25 % fringe pixel is dropped');
  assert.match(rd('templates/kinetic-captions/index.js'), /filter: grade, choke: readableChoke \}\);\s+\/\/ the same choked alpha/);
});

test('review (a): a window-level personClean also blocks the auto exposure', () => {
  const boom = () => { throw new Error('auto must not be measured'); };
  assert.deepEqual(fallbackGrade({}, boom, [{ id: 'hook', personClean: true }]), { exposure: 1, contrast: 1, saturation: 1 });
  assert.deepEqual(fallbackGrade({}, () => 1.2, [{ id: 'hook' }]), { exposure: 1.2, contrast: 1.06, saturation: 0.96 });
  assert.match(rd('src/cli/compose.js'), /fallbackGrade\(plan, \(\) => [^\n]*plan\.windows/);
});

test('v9 edge decontamination: an edge pixel keeps its alpha but takes his colour, not the old room\'s warm / dark fringe', () => {
  const w = 24, h = 8, d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const j = (y * w + x) * 4;
    if (x < 12) { d.set([200, 150, 130, 255], j); }                 // his skin, opaque
    else if (x < 15) { d.set([90, 40, 10, 100], j); }               // the edge band: dark warm room colour at partial alpha
  }
  const out = decontaminateEdge({ data: Uint8ClampedArray.from(d), width: w, height: h });
  for (let x = 12; x < 15; x++) {
    const j = (4 * w + x) * 4;
    assert.equal(out.data[j + 3], 100, 'alpha untouched (hair coverage stays)');
    assert.ok(Math.abs(out.data[j] - 200) < 3 && Math.abs(out.data[j + 2] - 130) < 3, `edge colour ${[...out.data.slice(j, j + 3)]} is his`);
  }
  assert.equal(out.data[(4 * w + 5) * 4], 200, 'core pixels untouched');
  // the choke maps alpha >= hi to 1, so the first px of "opaque" matte still carries the old room: it is recoloured too
  const d2 = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < 16; x++) d2.set(x < 14 ? [200, 150, 130, 255] : [0, 0, 0, 0], (y * w + x) * 4);
  for (let y = 0; y < h; y++) for (const x of [12, 13]) d2.set([60, 30, 10, 255], (y * w + x) * 4);   // opaque but warm-dark (room colour)
  const o2 = decontaminateEdge({ data: d2, width: w, height: h });
  for (const x of [12, 13]) assert.ok(o2.data[(4 * w + x) * 4] > 190, `opaque rim pixel ${x} lost its room colour`);
  assert.equal(o2.data[(4 * w + 13) * 4 + 3], 255, 'rim alpha untouched');
  assert.equal(out.data[(4 * w + 20) * 4 + 3], 0, 'empty stays empty');
  assert.match(rd('templates/kinetic-captions/index.js'), /params\.decontam === false \? \{ \.\.\.READABLE_CHOKE, decontam: false \}/, 'kill switch');
  assert.match(rd('src/kit/media.js'), /choke && choke\.decontam !== false/);
});
