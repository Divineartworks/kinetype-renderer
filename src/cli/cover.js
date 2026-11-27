// cover: an episode's thumbnail — the speaker's best frame with the episode's
// key word set giant BEHIND his head (person matte), in the show's brand. Same
// system on every episode, so a profile grid reads as one show.
//   frame — Apple Vision capture quality + eye/mouth landmarks + sharpness +
//           exposure + framing, scored over ~40 samples, refined around the best
//   word  — --word, else the title's strongest content word, else the theme
//           word the speaker keeps coming back to
//   look  — --look, else the director's tone → look mapping
// Rendered by kinetype itself (a one-frame kinetic-captions hero), so the cover
// uses exactly the look's typography and passes its layout QA.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './server.js';
import { ensureNativeTool } from './media.js';
import { loadWords, autoExposure } from './captions.js';
import { pickLook } from './direct.js';
import { prepareWords, contentWord, sentencesOf, quotability, trimEdges, isPunctuated } from '../../templates/kinetic-captions/speech.js';
import { LOOK_IDS } from '../../templates/kinetic-captions/looks/index.js';

function probe(file) {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate:format=duration', '-of', 'json', file], { cwd: ROOT }).toString());
  const v = j.streams.find((s) => s.codec_type === 'video');
  return { w: v?.width, h: v?.height, duration: Number(j.format.duration) };
}

/** Sharpness (variance of a 3×3 Laplacian) and mean luma of a region of a JPEG. */
function regionStats(jpg, face) {
  const W = 160;
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', jpg, '-vf', `scale=${W}:-2,format=gray`, '-f', 'rawvideo', '-'], { cwd: ROOT, maxBuffer: 1 << 24 });
  const H = Math.floor(buf.length / W);
  const x0 = Math.max(1, Math.floor((face.x - face.w / 2) * W)), x1 = Math.min(W - 2, Math.ceil((face.x + face.w / 2) * W));
  const y0 = Math.max(1, Math.floor((face.y - face.h / 2) * H)), y1 = Math.min(H - 2, Math.ceil((face.y + face.h / 2) * H));
  let n = 0, sum = 0, sum2 = 0, lum = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const c = buf[y * W + x];
    const lap = 4 * c - buf[y * W + x - 1] - buf[y * W + x + 1] - buf[(y - 1) * W + x] - buf[(y + 1) * W + x];
    sum += lap; sum2 += lap * lap; lum += c; n++;
  }
  if (!n) return { sharp: 0, luma: 0 };
  const m = sum / n;
  return { sharp: sum2 / n - m * m, luma: lum / n / 255 };
}

/**
 * Score one candidate (pure; unit-tested). f: the main face {x,y,w,h,q,eyes,
 * mouth,yaw}; stats: {sharp, luma}; ref: {sharp} (median sharpness of all
 * candidates). Higher is better; reasons explain it.
 */
export function scoreFrame(f, stats, ref) {
  const reasons = [];
  let s = 0;
  if (f.q >= 0) { s += f.q * 4; reasons.push(`quality ${f.q.toFixed(2)}`); }
  // the more-closed eye decides (a half-shut eye ruins a cover even if the mean is fine)
  if ((f.eyeMin ?? -1) >= 0 && f.eyeMin < 0.17 && f.eyes >= 0.12) { s -= f.eyeMin < 0.12 ? 3 : 2; reasons.push('one eye closing'); }
  if (f.eyes >= 0) {
    if (f.eyes < 0.12) { s -= 3; reasons.push('eyes closed'); }
    else { s += Math.min(1, (f.eyes - 0.12) / 0.2); if (f.eyes > 0.25) reasons.push('eyes open'); }
  }
  if (f.mouth < 0.045) { s += 0.8; reasons.push('mouth closed'); }
  else if (f.mouth > 0.2) { s += 0.4; reasons.push('expressive'); }
  else { s -= 0.4; reasons.push('mid-word'); }
  if (f.h >= 0.25 && f.h <= 0.58) s += 1; else if (f.h > 0.62) { s -= 0.5; reasons.push('face cropped'); } else if (f.h < 0.18) { s -= 1; reasons.push('face small'); }
  s -= Math.abs(f.x - 0.5) * 2;
  if (Math.abs(f.yaw) > 0.35) { s -= 0.8; reasons.push('turned away'); }
  // calibrated on the owner's footage: looking into the lens = pupil offset
  // 0.03–0.045 eye widths and a level head; looking up = 0.06–0.08, pitch ≤ -0.18
  const pitch = f.pitch ?? 0;
  if (pitch < -0.12) { s -= Math.min(1.5, (-pitch - 0.12) * 6); reasons.push('looking up'); }
  else if (pitch > 0.25) { s -= Math.min(1.2, (pitch - 0.25) * 6); reasons.push('head down'); }
  if ((f.gaze ?? -1) >= 0) { if (f.gaze > 0.055) { s -= Math.min(1.5, (f.gaze - 0.055) * 30); reasons.push('looking away'); } else { s += 0.6; reasons.push('eye contact'); } }
  if (f.eyes > 0.38) s -= 0.4; // eye whites showing: usually rolled up
  const sharpRel = ref.sharp > 0 ? stats.sharp / ref.sharp : 1;
  s += Math.min(1.5, sharpRel) - 1;
  if (sharpRel < 0.6) reasons.push('soft');
  if (stats.luma < 0.18) { s -= (0.18 - stats.luma) * 8; reasons.push('dark'); }
  return { score: +s.toFixed(3), reasons };
}

/** Pick the best of scored candidates: [{t, face, stats}] → sorted with scores. */
export function rankFrames(cands) {
  const withFace = cands.filter((c) => c.face);
  if (!withFace.length) return [];
  const sharps = withFace.map((c) => c.stats.sharp).sort((a, b) => a - b);
  const ref = { sharp: sharps[Math.floor(sharps.length / 2)] };
  return withFace.map((c) => ({ ...c, ...scoreFrame(c.face, c.stats, ref) })).sort((a, b) => b.score - a.score);
}

function sampleAndScore(video, times) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-cover-'));
  try {
    times.forEach((t, k) => execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', t.toFixed(3), '-i', video, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '3', path.join(tmp, `${String(k + 1).padStart(6, '0')}.jpg`)], { cwd: ROOT }));
    const lines = execFileSync(ensureNativeTool('face_quality'), [tmp], { cwd: ROOT, maxBuffer: 1 << 24, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    return lines.map(({ i, faces }) => {
      const face = faces.sort((a, b) => b.w * b.h - a.w * a.h)[0] || null;
      const stats = face ? regionStats(path.join(tmp, `${String(i + 1).padStart(6, '0')}.jpg`), face) : null;
      return { t: times[i], face, stats };
    });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

/** The episode's key word + the line the cover reads (title words when given). */
export function coverWord(words, { word, title } = {}) {
  if (word) return { word, line: title || word, why: 'chosen by the caller' };
  const counts = new Map();
  const FILLERISH = /^(blah|yeah|yep|nope|okay|ok|stuff|thing|things|kinda|sorta|gotta|whatever|basically|literally|anyway|cause|'cause|dude|bro|man|guys|like|umm|uhh|hmm)$/i;
  for (const w of words) if (contentWord(w) && !FILLERISH.test(w.text)) { const k = w.text.toLowerCase(); counts.set(k, { n: (counts.get(k)?.n || 0) + 1, s: Math.max(counts.get(k)?.s || 0, w.s), text: w.text }); }
  if (title) {
    const tw = prepareWords(title.split(/\s+/).map((t, i) => ({ text: t, start: i, end: i + 0.5 })));
    const cand = tw.filter(contentWord).sort((a, b) => (counts.get(b.text.toLowerCase())?.n || 0) - (counts.get(a.text.toLowerCase())?.n || 0) || b.text.length - a.text.length);
    if (cand.length) return { word: cand[0].text, line: title, why: `title word "${cand[0].text}" (said ${counts.get(cand[0].text.toLowerCase())?.n || 0}×)` };
  }
  // a cover word is MEANINGFUL, not merely frequent: repetition with diminishing
  // returns, longer and more stressed words weigh more
  const val = (c) => Math.pow(c.n, 0.6) * (0.5 + Math.min(1.5, (c.text.length - 3) / 5)) * (1 + c.s / 6);
  const best = [...counts.values()].sort((a, b) => val(b) - val(a))[0];
  if (!best) throw new Error('no content word to put on the cover — pass --word');
  // no title: the line under the masthead is his strongest SHORT line that says the word
  let line = best.text;
  if (!title) {
    const key = best.text.toLowerCase();
    // the clause around the word (sentences split at commas, connectives trimmed)
    const clauses = [];
    for (const u of sentencesOf(words)) {
      if (!u.words.some((w) => w.text.toLowerCase() === key)) continue;
      let cur = [];
      const flush = () => { if (cur.some((w) => w.text.toLowerCase() === key)) clauses.push(cur); cur = []; };
      for (const w of u.words) { cur.push(w); if (/[,;:]["”’)]*$/.test(w.raw)) flush(); }
      flush();
    }
    // long clauses: windows of ≤ 8 words around the word, starting at the clause
    // start or a subject ("you want the relationship more than she does")
    const punct = isPunctuated(words);
    const SUBJ = /^(i|you|you're|we|they|he|she|it|there's|there|people|she's|he's|it's|that's)$/i;
    const windows = [];
    for (const ws of clauses) {
      const k = ws.findIndex((w) => w.text.toLowerCase() === key);
      for (let a = Math.max(0, k - 5); a <= k; a++) {
        const lead = ws[a].text, next = ws[a + 1]?.text || '';
        const commandy = /^(stop|never|don't|do|go|get|look|listen|think|remember|forget|quit|protect|trust|keep|let|let's)$/i.test(lead) || (/^(fuck|forget|screw)$/i.test(lead) && /^(her|him|them|that|this|you|your|the|it)$/i.test(next));
        // a clause start is a real line start only when the transcript is punctuated
        const sentenceStart = a === 0 && punct && (ws[0].i === 0 || words[ws[0].i - 1].stop);
        if (!sentenceStart && !SUBJ.test(lead) && !commandy) continue;
        for (let b = k; b < Math.min(ws.length, a + 8); b++) windows.push(ws.slice(a, b + 1));
      }
    }
    const lines = windows.map((ws) => trimEdges({ words: ws, start: ws[0].start, end: ws[ws.length - 1].end, text: '', gapBefore: 1, gapAfter: 1 }, words))
      .filter((u) => u && u.words.length >= 2 && u.words.length <= 8 && u.words.some((w) => w.text.toLowerCase() === key))
      // after trimming, the line must still open like a line
      .filter((u) => !u.trimmed || SUBJ.test(u.words[0].text) || /^(stop|never|don't|fuck|forget|trust|protect|keep|let's)$/i.test(u.words[0].text))
      .map((u) => ({ u, q: quotability(u).score - Math.max(0, u.words.length - 4) * 0.45 })).sort((a, b) => b.q - a.q);
    if (lines.length) line = lines[0].u.words.map((w) => w.raw.replace(/[.,;:!?…]+$/, '')).join(' ');
  }
  return { word: best.text, line: title || line, why: `theme word "${best.text}" (said ${best.n}×)${line !== best.text ? `; line "${line}"` : ''}` };
}

/**
 * @param video source video (the clean master)
 * @param o {words?, word?, title?, look?, energy?, brand?, format?, at?, out?, log?}
 */
export async function makeCover(video, o = {}) {
  const log = o.log || console.error;
  const abs = path.resolve(video);
  const p = probe(abs);
  const fmt = o.format || (p.h > p.w ? 'vertical' : 'landscape');
  const outJpg = path.resolve(o.out || path.join(ROOT, 'out', path.basename(abs).replace(/\.[^.]+$/, '') + '-cover.jpg'));
  fs.mkdirSync(path.dirname(outJpg), { recursive: true });

  // ── the frame ───────────────────────────────────────────────────────────
  let chosen, ranked = [];
  if (o.at != null) {
    // the caller picked the moment; still measure its face so the title block
    // stays below the chin and the face-clear QA runs (it skipped both before)
    const [s] = sampleAndScore(abs, [+o.at]);
    chosen = { t: +o.at, score: null, reasons: ['chosen by the caller'], face: s?.face || null, stats: s?.stats || null };
  }
  else {
    const n = 40, a = p.duration * 0.05, b = p.duration * 0.95;
    ranked = rankFrames(sampleAndScore(abs, Array.from({ length: n }, (_, k) => a + (b - a) * (k + 0.5) / n)));
    if (!ranked.length) throw new Error('no face found in the video — pass --at <seconds>');
    // refine: ±0.6 s around the three best coarse picks
    const fine = ranked.slice(0, 3).flatMap((c) => [-0.6, -0.4, -0.2, 0.2, 0.4, 0.6].map((d) => Math.min(b, Math.max(a, c.t + d))));
    ranked = rankFrames([...ranked.map(({ t, face, stats }) => ({ t, face, stats })), ...sampleAndScore(abs, fine)]);
    chosen = ranked[0];
    log(`cover frame: ${chosen.t.toFixed(2)}s (score ${chosen.score}: ${chosen.reasons.join(', ')})`);
  }

  // ── the word + look ─────────────────────────────────────────────────────
  let words = [];
  if (o.words) words = prepareWords(loadWords(path.resolve(o.words)));
  const cw = coverWord(words, { word: o.word, title: o.title });
  // a profile grid is recognisable only if every cover wears the SAME look: the
  // brand's look (brand.look, else Cover) unless the caller names one;
  // --look auto picks from the episode's tone instead
  const brand0 = o.brand ? (typeof o.brand === 'string' ? JSON.parse(fs.readFileSync(path.resolve(o.brand), 'utf8')) : o.brand) : null;
  const look = o.look === 'auto' ? (words.length ? pickLook(words).look : 'cover') : o.look || brand0?.look || 'cover';
  if (!LOOK_IDS.includes(look)) throw new Error(`look must be one of ${LOOK_IDS.join(', ')} (got ${look})`);
  log(`cover word: ${cw.word} (${cw.why}); look ${look}`);

  // ── render: a one-frame kinetic-captions hero at the chosen moment ──────
  const HOLD = 1.6;
  const start = Math.max(0, chosen.t - HOLD), ts = chosen.t - start;
  const line = cw.line.split(/\s+/).filter(Boolean);
  const t0 = Math.max(0.05, ts - 1.3), step = Math.min(0.2, 1.0 / Math.max(1, line.length));
  // every word stays spoken through the capture instant, so the line is fully on screen
  const lw = line.map((t, k) => ({ text: t, start: +(t0 + k * step).toFixed(3), end: +(k === line.length - 1 ? ts + 0.2 : t0 + k * step + step * 0.9).toFixed(3) }));
  const keyIdx = Math.max(0, line.findIndex((t) => t.replace(/[^\p{L}\p{N}'’-]/gu, '').toLowerCase() === cw.word.toLowerCase()));
  if (!line.some((t) => t.replace(/[^\p{L}\p{N}'’-]/gu, '').toLowerCase() === cw.word.toLowerCase())) { lw.push({ text: cw.word, start: +(t0 + line.length * step).toFixed(3), end: +(ts + 0.2).toFixed(3) }); }
  const hero = lw[line.some((t) => t.replace(/[^\p{L}\p{N}'’-]/gu, '').toLowerCase() === cw.word.toLowerCase()) ? keyIdx : lw.length - 1];
  const split = fmt === 'landscape' && p.h > p.w;
  const brand = brand0;
  const spec = {
    template: 'kinetic-captions', name: 'cover', format: fmt, fps: 30, duration: +(ts + 0.6).toFixed(3), seed: 11,
    media: { ep: { src: abs, start: +start.toFixed(3), ...(split ? { size: 'native' } : process.platform === 'darwin' ? { matte: true } : {}) } },
    // dark phone footage gets the same measured lift `kinetype captions` applies
    params: { look, energy: o.energy || 'signature', heroEvery: 60, punch: 0, flash: 0, textScale: o.textScale ?? 1.4, maxWords: 8, maxChars: 40, grade: o.grade || { exposure: +autoExposure(abs, p.duration).toFixed(2), contrast: 1.06, saturation: 0.96 }, ...(split ? { layout: 'split' } : {}) },
    ...(brand?.palette ? { palette: brand.palette } : {}),
    ...(brand?.fonts ? { fonts: brand.fonts } : {}),
    content: { words: lw, heroes: [hero.start] },
    rules: { beatCoverage: false, loopExact: false },
    render: { samples: 1 },
  };
  // the title block lives BELOW the chin (Vision face box of the chosen frame):
  // never on the face. If it does not fit the band, the type shrinks and the
  // cover is re-rendered; a cover that still overlaps the face fails QA.
  const face = chosen.face;
  const faceBox = face && !split ? { x0: (face.x - face.w / 2), x1: (face.x + face.w / 2), y0: (face.y - face.h / 2), y1: (face.y + face.h / 2) } : null;
  if (faceBox) spec.params.captionTop = Math.min(0.8, faceBox.y1 + 0.02);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-cover-render-'));
  try {
    const { stills } = await import('./render.js');
    let r = null, clear = null, attempt = 0;
    for (; attempt < 4; attempt++) {
      const specPath = path.join(work, 'cover.json');
      fs.writeFileSync(specPath, JSON.stringify(spec, null, 2));
      r = await stills(spec, { specPath, specDir: work, out: work, at: [+(ts - 1 / 60).toFixed(3)], samples: 1, log: () => {} });
      if (!faceBox) break;
      const W = r.info.width, H = r.info.height, safeBottom = H * 0.86;
      const boxes = (r.info.qa?.texts || []).map((x) => x.box).filter(Boolean);
      const fb = { x0: faceBox.x0 * W, x1: faceBox.x1 * W, y0: faceBox.y0 * H, y1: faceBox.y1 * H };
      const overlap = boxes.reduce((a, b) => a + Math.max(0, Math.min(b.x1, fb.x1) - Math.max(b.x0, fb.x0)) * Math.max(0, Math.min(b.y1, fb.y1) - Math.max(b.y0, fb.y0)), 0) / ((fb.x1 - fb.x0) * (fb.y1 - fb.y0));
      const bottom = Math.max(0, ...boxes.map((b) => b.y1));
      clear = { overlap: +overlap.toFixed(3), bottom: Math.round(bottom), safeBottom: Math.round(safeBottom), textScale: spec.params.textScale };
      if (overlap <= 0.01 && bottom <= safeBottom) break;
      // shrink to fit the band between the chin and the safe bottom
      const top = spec.params.captionTop * H, need = Math.max(1, bottom - Math.min(...boxes.map((b) => b.y0)));
      const fit = Math.max(0.55, Math.min(0.9, (safeBottom - top) / need));
      spec.params.textScale = +(spec.params.textScale * fit).toFixed(3);
      log(`cover: title block ${overlap > 0.01 ? 'touches the face' : 'runs past the safe bottom'} → text scale ${spec.params.textScale}`);
    }
    const png = path.join(r.sdir, fs.readdirSync(r.sdir).find((f) => /^01_.*\.png$/.test(f)));
    const outPng = outJpg.replace(/\.jpe?g$/i, '') + '.png';
    fs.copyFileSync(png, outPng);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', outPng, '-q:v', '2', outJpg], { cwd: ROOT });
    const qaFails = (r.layoutQA.checks || []).filter((c) => c.status === 'fail').map((c) => `${c.id}: ${c.detail}`);
    if (clear && (clear.overlap > 0.01 || clear.bottom > clear.safeBottom)) qaFails.push(`face-clear: title block overlaps the face by ${(clear.overlap * 100).toFixed(1)}% / bottom ${clear.bottom}px > ${clear.safeBottom}px`);
    if (qaFails.length) log(`cover layout QA: ${qaFails.join('; ')}`);
    return {
      cover: outJpg, png: outPng, format: fmt, look, word: cw.word, why: cw.why, line: cw.line,
      frame: { t: +chosen.t.toFixed(3), score: chosen.score, reasons: chosen.reasons },
      runnersUp: ranked.slice(1, 5).map((c) => ({ t: +c.t.toFixed(2), score: c.score, reasons: c.reasons })),
      faceClear: clear,
      qa: qaFails.length ? { status: 'fail', fails: qaFails } : { status: 'pass' },
    };
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}
