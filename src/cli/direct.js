// The director: a talking-head/podcast video + its transcript → a caption PLAN.
// It decides where kinetic typography takes over and where the normal caption
// system keeps running:
//   hook      — the opening seconds, cut on a real pause (never mid-sentence)
//   cold open — the most quotable line of the episode, replayed BEFORE the start
//   moments   — a few spikes on the strongest lines, spread through the episode
// Every choice carries its reasons; the plan is plain JSON an agent can edit
// before `kinetype compose` renders it.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { ROOT } from './server.js';
import { ensureNativeTool } from './media.js';
import { loadWords } from './captions.js';
import { prepareWords, sentencesOf, quotability, standsAlone, trimEdges, contentWord, themesOf, pauseStats, isPunctuated, PROFANE } from '../../templates/kinetic-captions/speech.js';
import { LOOK_IDS } from '../../templates/kinetic-captions/looks/index.js';

export const PLAN_SCHEMA = 'kinetype-plan/v1';

function probe(file) {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate:format=duration', '-of', 'json', file], { cwd: ROOT }).toString());
  const v = j.streams.find((s) => s.codec_type === 'video');
  const [a, b] = (v?.r_frame_rate || '30/1').split('/').map(Number);
  return { w: v?.width, h: v?.height, fps: b ? a / b : a, duration: Number(j.format.duration), audio: j.streams.some((s) => s.codec_type === 'audio') };
}

// ── tone → look ──────────────────────────────────────────────────────────
const TONE = {
  neon: 'love relationship relationships girlfriend boyfriend wife husband her him she breakup heart heartbreak night lonely alone divorce approval rejection rejected obsession obsessed attachment attached dating ex text texted chase chasing cheated cheating validation desire miss',
  cinema: 'story remember years life father mother dad mom died death dream journey moment childhood lost grew memory born family tears cried grief hope',
  terminal: 'ai code coding software startup startups tech data algorithm crypto bitcoin app apps build building product launch model models compute server automation robot internet online',
  swiss: 'step steps first second third reasons reason how strategy framework system process plan business market revenue percent number numbers money profit sales customers growth rule rules',
  poster: 'grind work hustle stop fight win winning discipline never quit war hard harder push pain weak strong beast pressure',
  noir: 'truth power society philosophy meaning moral justice history psychology human mind reality nature god soul sin fear control',
  riso: 'art design music create creative paint painting album band indie culture fashion artist draw photo film style',
};
const TONE_SETS = Object.fromEntries(Object.entries(TONE).map(([k, v]) => [k, new Set(v.split(' '))]));

/** Mean luma (0..1) of a video from a few frames — some looks need a dark room. */
export function footageLuma(file, duration) {
  const vals = [];
  for (const f of [0.15, 0.35, 0.55, 0.75, 0.9]) {
    try {
      const b = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(duration * f), '-i', file, '-frames:v', '1', '-vf', 'scale=32:-2,format=gray', '-f', 'rawvideo', '-'], { cwd: ROOT });
      vals.push(b.reduce((a, x) => a + x, 0) / b.length / 255);
    } catch {}
  }
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0.3;
}
const NEEDS_DARK = new Set(['neon']);

/**
 * Tone → look. `avoid` rotates away from recently used looks so a feed of
 * videos keeps its variety: the best-scoring look not in `avoid` wins, and
 * with no tone signal the fallback cycles through the general-purpose looks.
 */
export function pickLook(words, { luma = null, avoid = [] } = {}) {
  const skip = new Set(avoid);
  const score = Object.fromEntries(Object.keys(TONE).map((k) => [k, 0]));
  const hits = Object.fromEntries(Object.keys(TONE).map((k) => [k, new Map()]));
  for (const w of words) {
    const t = w.text.toLowerCase();
    for (const [k, set] of Object.entries(TONE_SETS)) if (set.has(t)) { score[k] += 1; hits[k].set(t, (hits[k].get(t) || 0) + 1); }
  }
  const prof = words.filter((w) => PROFANE.test(w.text)).length / Math.max(1, words.length);
  score.poster += prof * 60; // a heavy-profanity rant reads as a poster wall
  const all = Object.entries(score).sort((a, b) => b[1] - a[1]);
  const ranked = all.filter(([k]) => !skip.has(k));
  const rotated = skip.size && all[0] && skip.has(all[0][0]) ? [`rotating away from recent ${[...skip].join('/')}`] : [];
  if (!ranked.length || ranked[0][1] < 3) {
    const general = ['cover', 'poster', 'cinema', 'swiss', 'noir', 'marker'].filter((k) => LOOK_IDS.includes(k) && !skip.has(k));
    const look = general[0] || 'cover';
    return { look, reasons: [...rotated, `no strong tone signal → ${look} (general-purpose${skip.size ? ', not recently used' : ''})`] };
  }
  let [best] = ranked[0];
  // neon glows only in a dark room: on bright footage take the runner-up
  if (NEEDS_DARK.has(best) && luma != null && luma > 0.36) {
    const alt = ranked.find(([k, v]) => !NEEDS_DARK.has(k) && v >= 3);
    const was = best;
    best = alt ? alt[0] : (skip.has('cover') ? 'cinema' : 'cover');
    return { look: best, reasons: [`tone: ${was}, but the footage is bright (luma ${luma.toFixed(2)}) and ${was} needs a dark room → ${best}`] };
  }
  const top = [...hits[best].entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t, n]) => (n > 1 ? `${t}×${n}` : t));
  const why = [...top, ...(best === 'poster' && prof > 0.02 ? [`profanity ${(prof * 100).toFixed(1)}%`] : [])].join(', ');
  return { look: best, reasons: [...rotated, `tone: ${best} (${why})`, ...(ranked[1] ? [`runner-up: ${ranked[1][0]}`] : [])] };
}

/** Inter-word gaps as cut candidates: {t (midpoint), len, after (word index), sentence}. */
function gapsOf(words) {
  const gaps = [];
  for (let i = 1; i < words.length; i++) {
    const a = words[i - 1], b = words[i];
    // measured silence when available, else the transcript's own gap
    if (a.pauseAfter != null) {
      if (a.pauseAfter >= 0.12 && a.quietAt != null) gaps.push({ t: a.quietAt, len: a.pauseAfter, after: i - 1, from: a.quietFrom, to: a.quietTo, sentence: a.stop || a.pauseAfter >= 0.42 });
      continue;
    }
    const len = b.start - a.end;
    if (len > 0.12) gaps.push({ t: (a.end + b.start) / 2, len, after: i - 1, from: a.end, to: b.start, sentence: a.stop || len >= 0.42 });
  }
  return gaps;
}
const snap = (t, fps) => Math.round(t * fps) / fps;

/**
 * Who is talking in a wide shot — active-speaker detection. Apple Vision face
 * landmarks give each face's mouth opening per frame; the face whose mouth
 * follows the VOICE (audio loudness, allowing the audio to lead by ≤0.2 s) is
 * the speaker. Returns {x, r, faces} or null when there is one centred face or
 * the evidence is weak. First-party OS framework, offline.
 */
export function speakerFocus(file, s, e, { rate = 10, pad = 2.5 } = {}) {
  if (process.platform !== 'darwin') return null;
  const t0 = Math.max(0, s - pad), dur = e - s + 2 * pad;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-faces-'));
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t0), '-i', file, '-t', String(dur), '-vf', `fps=${rate},scale=640:-2`, '-q:v', '3', path.join(tmp, '%06d.jpg')], { cwd: ROOT });
    const out = execFileSync(ensureNativeTool('face_mouths'), [tmp], { cwd: ROOT, maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split('\n').map((l) => JSON.parse(l));
    const n = out.length;
    if (n < 8) return null;
    // track faces by horizontal position
    const tracks = [];
    out.forEach(({ i, faces }) => {
      for (const f of faces) {
        let tr = tracks.find((t) => Math.abs(t.x - f.x) < 0.12);
        if (!tr) { tr = { x: f.x, open: new Float64Array(n).fill(NaN), seen: 0 }; tracks.push(tr); }
        tr.x = tr.x * 0.9 + f.x * 0.1; tr.open[i] = f.open; tr.seen++;
      }
    });
    const real = tracks.filter((t) => t.seen >= n * 0.5);
    if (!real.length) return null;
    const pcm = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t0), '-i', file, '-t', String(dur), '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], { cwd: ROOT, maxBuffer: 1 << 26 });
    const a = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
    const per = Math.floor(8000 / rate), loud = new Float64Array(n);
    for (let f = 0; f < n; f++) { let acc = 0; for (let k = f * per; k < (f + 1) * per && k < a.length; k++) acc += a[k] * a[k]; loud[f] = Math.sqrt(acc / per); }
    const corr = (x, y, lag) => {
      const xs = [], ys = [];
      for (let i = 0; i < x.length; i++) { const j = i - lag; if (j >= 0 && j < y.length && !Number.isNaN(x[i])) { xs.push(x[i]); ys.push(y[j]); } }
      if (xs.length < 8) return 0;
      const m = (v) => v.reduce((p, q) => p + q, 0) / v.length, mx = m(xs), my = m(ys);
      let sxy = 0, sxx = 0, syy = 0;
      for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
      return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
    };
    const scored = real.map((t) => ({ x: +t.x.toFixed(3), r: Math.max(corr(t.open, loud, 0), corr(t.open, loud, 1), corr(t.open, loud, 2)) })).sort((p, q) => q.r - p.r);
    const best = scored[0], second = scored[1];
    const faces = scored.map((f) => `${f.x}:${f.r.toFixed(2)}`).join(' ');
    if (process.env.KT_DEBUG_SPEAKER) console.error('speaker', s.toFixed(1), e.toFixed(1), faces, `tracks ${tracks.length} real ${real.length}`);
    if (scored.length === 1) return null; // one face: the normal centred layout already fits
    if (best.r < 0.25 || (second && best.r - second.r < 0.12)) return null;
    return { x: best.x, r: +best.r.toFixed(3), faces };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

/** Heroes for a window: the strongest content words, spaced, never in the last `tail` seconds. */
function heroesIn(words, s, e, { max = 2, spacing = 2.2, tail = 1.1, first = null, land = false } = {}) {
  // strong nouns/adjectives over adverbs and gerunds ("eventually", "putting")
  const heroScore = (w) => w.s - (/ly$/i.test(w.text) ? 1.2 : 0) - (/ing$/i.test(w.text) ? 0.5 : 0);
  const cand = words.filter((w) => w.start >= s + 0.05 && w.start <= e - tail - 0.15 && contentWord(w)).sort((a, b) => heroScore(b) - heroScore(a));
  const out = [];
  // a line's payoff is its LAST content word ("rejection breeds … OBSESSION"):
  // spikes and cold opens always land their hero on it when it is strong enough
  if (land && cand.length) {
    const lastC = cand.reduce((a, b) => (b.start > a.start ? b : a));
    if (lastC.s >= cand[0].s * 0.7) out.push(lastC);
  }
  if (first) {
    const early = cand.filter((w) => w.start < s + first)[0];
    if (early) out.push(early);
  }
  for (const w of cand) {
    if (out.length >= max) break;
    if (out.some((o) => Math.abs(o.start - w.start) < spacing || o.text.toLowerCase() === w.text.toLowerCase())) continue;
    out.push(w);
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * @param video source video (captionless master)
 * @param o {words?, format?, look?, energy?, hookEnergy?, momentEnergy?, hook?, moments?, coldOpen?, brand?, out?, log?}
 */
export async function direct(video, o = {}) {
  const log = o.log || console.error;
  const abs = path.resolve(video);
  const p = probe(abs);
  const fps = Math.round(p.fps) || 30;
  const fmt = o.format || (!p.w ? 'vertical' : p.h > p.w ? 'vertical' : p.w === p.h ? 'square' : 'landscape');
  const outPath = path.resolve(o.out || path.join(ROOT, 'out', path.basename(abs).replace(/\.[^.]+$/, '') + '-plan', 'plan.json'));
  const dir = path.dirname(outPath);
  fs.mkdirSync(dir, { recursive: true });

  let raw;
  if (o.words) raw = loadWords(path.resolve(o.words));
  else {
    const { transcribeWords } = await import('./lyrics.js');
    log(`transcribing ${path.basename(abs)}…`);
    raw = transcribeWords(abs).map((w) => ({ text: w.text, start: +w.start.toFixed(3), end: +w.end.toFixed(3) }));
  }
  fs.writeFileSync(path.join(dir, 'words.json'), JSON.stringify(raw));
  const words = prepareWords(raw);
  if (!words.length) throw new Error('transcript has no words');
  // measured silences: every cut lands in one (see pauses.js)
  const { annotatePauses } = await import('./pauses.js');
  const acoustic = p.audio ? annotatePauses(abs, words) : null;
  // the transcript the windows render from ends each word where its silence
  // begins, so captions break at real pauses and stress is not inflated by
  // silence a word "absorbed"
  if (acoustic) {
    for (const w of words) if (w.pauseAfter >= 0.12 && w.quietFrom > w.start + 0.08 && w.quietFrom < w.end) w.end = +w.quietFrom.toFixed(3);
    fs.writeFileSync(path.join(dir, 'words.json'), JSON.stringify(words.map((w) => ({ text: w.raw, start: +w.start.toFixed(3), end: +w.end.toFixed(3) }))));
  }
  const D = p.duration;
  const lastSpeech = words[words.length - 1].end;
  const rationale = [];

  const lookPick = !o.look || o.look === 'auto' ? pickLook(words, { luma: footageLuma(abs, p.duration) }) : { look: o.look, reasons: ['chosen by the caller'] };
  if (!LOOK_IDS.includes(lookPick.look)) throw new Error(`look must be one of ${LOOK_IDS.join(', ')} or auto (got ${lookPick.look})`);
  rationale.push(`look ${lookPick.look}: ${lookPick.reasons.join('; ')}`);
  // the hook may wear a different look/energy from the moments and cold open
  const hookEnergy = o.hookEnergy || o.energy || 'wild';
  const hookLook = o.hookLook && o.hookLook !== 'auto' ? o.hookLook : lookPick.look;
  if (!LOOK_IDS.includes(hookLook)) throw new Error(`--hook-look must be one of ${LOOK_IDS.join(', ')} (got ${hookLook})`);
  const momentEnergy = o.momentEnergy || 'signature';
  const gaps = gapsOf(words);
  // what a real break is for THIS speaker, and whether the transcript marks sentences
  const pauses = pauseStats(words), punctuated = isPunctuated(words);
  rationale.push(`speaker rhythm: median pause ${pauses.p50.toFixed(2)}s, long pause ${pauses.p80.toFixed(2)}s${pauses.measured ? '' : ' (defaults)'}; ${punctuated ? 'punctuated transcript → whole sentences only' : 'unpunctuated transcript → pauses mark thoughts'}`);
  const sentences = sentencesOf(words, { pause: punctuated ? 1.0 : Math.max(0.35, pauses.p80) });
  const margin = (gap, cap) => Math.max(0, Math.min(cap, gap / 2 - 0.02));
  const windows = [];

  // ── full: one window over all speech (a fully kinetic episode, spliced) ─
  if (o.full) {
    const lead = Math.min(0.4, words[0].start), tail = Math.min(0.6, Math.max(0, D - lastSpeech - 0.05));
    windows.push({ id: 'full', role: 'full', start: snap(words[0].start - lead, fps), end: snap(lastSpeech + tail, fps), in: snap(Math.min(lead, 0.25), fps), out: snap(Math.min(tail, 0.35), fps), look: lookPick.look, energy: o.energy || 'signature', heroes: [], heroWords: [], line: '(whole episode)' });
    rationale.push(`full: one ${o.energy || 'signature'} window over all speech ${windows[0].start}–${windows[0].end}s (heroes chosen by the look's energy)`);
  }
  // ── hook: the opening, cut on the best pause near the target length ─────
  // defaults scale with the video: a 50 s reel gets a short hook and one spike,
  // a 12-minute episode gets a cold open and a spike roughly every 50 s
  const speechLen = lastSpeech - words[0].start;
  const hookSec = o.full ? 0 : o.hook ?? (speechLen < 40 ? 4 : speechLen < 90 ? 5 : 7);
  if (hookSec > 0) {
    const cands = gaps.filter((g) => g.t >= hookSec - 2 && g.t <= hookSec + 4);
    const scored = cands.map((g) => ({ g, v: Math.min(g.len, 0.8) * 2 + (g.sentence ? 0.8 : 0) - Math.abs(g.t - hookSec) * 0.35 }));
    const best = scored.sort((a, b) => b.v - a.v)[0]?.g || gaps.find((g) => g.t >= hookSec) || null;
    if (best) {
      const end = snap(best.t, fps), out = snap(margin(best.len, 0.35), fps);
      const hs = heroesIn(words, 0, end, { max: Math.max(1, Math.round(end / 3.2)), spacing: 2.4, first: 3.5 });
      windows.push({ id: 'hook', role: 'hook', start: 0, end, in: 0, out, look: hookLook, energy: hookEnergy, heroes: hs.map((w) => +w.start.toFixed(3)), heroWords: hs.map((w) => w.text), line: words.filter((w) => w.end <= end).map((w) => w.raw).join(' ') });
      rationale.push(`hook 0–${end.toFixed(2)}s: cut on a ${best.len.toFixed(2)}s pause${best.sentence ? ' (sentence end)' : ''}; heroes ${hs.map((w) => w.text).join(', ') || 'none'}`);
    } else rationale.push('hook: no usable pause near the target length — skipped');
  }
  const hookEnd = windows.find((w) => w.role === 'hook')?.end ?? 0; // --full has no hook (its one window is the whole video)

  // ── cold open: the most quotable line, replayed before the start ────────
  let coldOpen = null;
  const units = [];
  sentences.forEach((u, k) => {
    units.push(u);
    const nx = sentences[k + 1];
    if (nx && nx.start - u.end < 0.7 && nx.end - u.start <= 8) units.push({ words: [...u.words, ...nx.words], start: u.start, end: nx.end, text: u.text + ' ' + nx.text, gapBefore: u.gapBefore, gapAfter: nx.gapAfter });
  });
  const themes = themesOf(words);
  const title = o.title ? new Set(o.title.toLowerCase().split(/[^a-z0-9'’-]+/).filter((t) => t.length >= 3 && !['the', 'and', 'for', 'with'].includes(t))) : null;
  const qctx = { themes, title, pauses, punctuated };
  const prevStopOf = (u) => { const i = u.words[0].i; return i > 0 ? !!words[i - 1].stop : true; };
  const prevW = (u) => (u.words[0].i > 0 ? words[u.words[0].i - 1] : null);
  // cold open: strict — its AUDIO is cut, so both edges must be real silences
  const scoredUnits = units.map((u) => ({ u, q: quotability(u, { ...qctx, prevStop: prevStopOf(u) }), alone: standsAlone(u, { pauses, punctuated, prevWord: prevW(u) }) }));
  // spikes overlay the picture while the audio runs on, so they may start on
  // any word — but they must still be a complete thought: trim connectives
  const spikeUnits = [];
  for (const u0 of units) {
    const u = trimEdges(u0, words);
    if (!u) continue;
    if (!standsAlone(u, { pauses, punctuated, prevWord: prevW(u), needPauses: false })) continue;
    spikeUnits.push({ u, q: quotability(u, { ...qctx, prevStop: u.trimmed ? true : prevStopOf(u), pauses: { p50: 0, p80: pauses.p80 } }) });
  }
  if (themes.size) rationale.push(`themes: ${[...themes].slice(0, 10).join(', ')}${title ? `; title: ${[...title].join(', ')}` : ''}`);
  const coldAuto = o.coldOpen === undefined || o.coldOpen === 'auto' || o.coldOpen === true;
  if (coldAuto && speechLen < 90) rationale.push(`cold open: skipped for a ${speechLen.toFixed(0)}s video (a teaser needs an episode to tease)`);
  else if (o.coldOpen !== 'none' && o.coldOpen !== false && !(o.full && o.coldOpen === undefined)) {
    let pick = null;
    if (typeof o.coldOpen === 'string' && /^[\d.]+-[\d.]+$/.test(o.coldOpen)) {
      const [a, b] = o.coldOpen.split('-').map(Number);
      const ws = words.filter((w) => w.start >= a - 0.05 && w.end <= b + 0.05);
      if (!ws.length) throw new Error(`--cold-open ${o.coldOpen}: no words in that range`);
      const u = { words: ws, start: ws[0].start, end: ws[ws.length - 1].end, text: ws.map((w) => w.raw).join(' '), gapBefore: 0.3, gapAfter: 0.3 };
      const iw = words.indexOf(ws[0]), jw = words.indexOf(ws[ws.length - 1]);
      u.gapBefore = iw > 0 ? ws[0].start - words[iw - 1].end : ws[0].start;
      u.gapAfter = jw < words.length - 1 ? words[jw + 1].start - ws[ws.length - 1].end : 1;
      pick = { u, q: quotability(u, { ...qctx, prevStop: prevStopOf(u) }), forced: true };
    } else {
      // a cold open is a COMPLETE thought: it starts and ends on real pauses;
      // a title drop is the classic cold open, so title words weigh double here
      const coldScore = ({ u, q }) => q.score + (q.reasons.some((r) => r.startsWith('title words')) ? 1.5 : 0);
      const cleanIn = (u) => u.gapBefore >= pauses.p50 || (punctuated && prevStopOf(u));
      const cleanOut = (u) => u.gapAfter >= pauses.p80 || (punctuated && /[.!?…]["”’)]*$/.test(u.words[u.words.length - 1].raw) && u.gapAfter >= pauses.p50);
      pick = scoredUnits.filter(({ u, q, alone: ok }) => ok && u.words.length >= 5 && u.end - u.start >= 2.2 && u.end - u.start <= 8 && cleanIn(u) && cleanOut(u) && q.content >= 2 && !q.filler && u.start >= Math.max(hookEnd + 3, 10) && u.end <= lastSpeech - 1).sort((a, b) => coldScore(b) - coldScore(a))[0] || null;
    }
    if (pick) {
      const { u } = pick;
      const inM = snap(margin(u.gapBefore, 0.12), fps), outM = snap(margin(u.gapAfter, 0.3), fps);
      const hs = heroesIn(words, u.start, u.end + 0.01, { max: u.end - u.start > 4.5 ? 2 : 1, tail: 0.05, spacing: 2, land: true });
      coldOpen = { id: 'cold', role: 'coldOpen', from: +(u.start - inM).toFixed(3), to: +(u.end + outM).toFixed(3), start: +u.start.toFixed(3), end: +u.end.toFixed(3), look: lookPick.look, energy: hookEnergy, heroes: hs.map((w) => +w.start.toFixed(3)), heroWords: hs.map((w) => w.text), line: u.text, score: pick.q.score, reasons: pick.q.reasons, dip: 0.2 };
      rationale.push(`cold open ${u.start.toFixed(2)}–${u.end.toFixed(2)}s "${u.text}" (score ${pick.q.score}: ${pick.q.reasons.join(', ')})`);
    } else rationale.push('cold open: no line scored well enough — skipped');
  }

  // ── moments: spikes on the strongest lines, spread through the episode ──
  const nMom = o.full ? 0 : o.moments ?? Math.max(1, Math.min(6, Math.round((lastSpeech - hookEnd) / 50)));
  if (nMom > 0) {
    const spacing = Math.max(18, (lastSpeech - hookEnd) / (nMom + 1) * 0.7);
    const taken = windows.map((w) => [w.start - 4, w.end + 4]);
    if (coldOpen) taken.push([coldOpen.start - 3, coldOpen.end + 3]);
    const pool = spikeUnits.filter(({ u, q }) => u.words.length >= 3 && u.words.length <= 10 && u.end - u.start >= 1.1 && u.end - u.start <= 5.5 && u.start >= hookEnd + 5 && u.end <= Math.min(lastSpeech, D - 3) && q.content >= 2 && !q.filler && q.score >= 9).sort((a, b) => b.q.score - a.q.score);
    // the best SET of spikes (max total score under the spacing rule), not a
    // greedy walk — a greedy first pick can block the episode's best line
    const cands = pool.filter(({ u }) => !taken.some(([a, b]) => u.end > a && u.start < b)).slice(0, 24);
    let picks = [], bestSum = -Infinity;
    const walk = (from, chosen, sum) => {
      if (chosen.length === Math.min(nMom, cands.length) || from >= cands.length) {
        // prefer more spikes, then higher total
        const v = chosen.length * 1000 + sum;
        if (v > bestSum) { bestSum = v; picks = chosen.slice(); }
        if (from >= cands.length || chosen.length === nMom) return;
      }
      for (let i = from; i < cands.length; i++) {
        const c = cands[i];
        if (chosen.some((x) => Math.abs(x.u.start - c.u.start) < spacing)) continue;
        chosen.push(c); walk(i + 1, chosen, sum + c.q.score); chosen.pop();
      }
    };
    walk(0, [], 0);
    picks.sort((a, b) => a.u.start - b.u.start).forEach(({ u, q }, k) => {
      const inM = snap(margin(u.gapBefore, 0.25), fps), outM = snap(margin(u.gapAfter, 0.35), fps);
      const hs = heroesIn(words, u.start, u.end + 0.01, { max: u.end - u.start >= 3.4 ? 2 : 1, spacing: 1.7, tail: 0.05, land: true });
      windows.push({ id: `moment${k + 1}`, role: 'moment', start: snap(u.start - inM, fps), end: snap(u.end + outM, fps), in: inM, out: outM, look: lookPick.look, energy: momentEnergy, heroes: hs.map((w) => +w.start.toFixed(3)), heroWords: hs.map((w) => w.text), line: u.text, score: q.score, reasons: q.reasons });
      rationale.push(`moment ${k + 1} ${u.start.toFixed(2)}–${u.end.toFixed(2)}s "${u.text}" (score ${q.score}: ${q.reasons.join(', ')})`);
    });
  }
  // the hook's end margin lives inside its pause; its window covers it too
  windows.forEach((w) => { if (w.role === 'hook') { w.end = +(w.end + w.out).toFixed(3); } });
  windows.sort((a, b) => a.start - b.start);
  // wide shots: put each window's type over whoever is talking
  if (p.w > p.h * 1.2 && p.audio && !o.noSpeaker) {
    const seen = [];
    for (const w of [...windows, ...(coldOpen ? [coldOpen] : [])]) {
      const f = speakerFocus(abs, w.from ?? w.start, w.to ?? w.end);
      if (f) { w.focusX = f.x; seen.push(`${w.id} → speaker at x ${f.x} (lips↔voice r ${f.r}; faces ${f.faces})`); }
    }
    if (seen.length) rationale.push(`speaker focus: ${seen.join('; ')}`);
  }
  const captionGaps = windows.map((w) => [w.start, w.end]);

  let brand = null;
  if (o.brand) brand = typeof o.brand === 'string' ? JSON.parse(fs.readFileSync(path.resolve(o.brand), 'utf8')) : o.brand;
  const plan = {
    schema: PLAN_SCHEMA,
    created: new Date().toISOString(),
    video: abs,
    wordsSrc: 'words.json',
    duration: +D.toFixed(3),
    fps,
    size: { w: p.w, h: p.h },
    format: fmt,
    look: lookPick.look,
    brand,
    grade: o.grade || null,
    // reactive backgrounds: hero words that name a world get an animated plate behind the speaker
    plates: o.plates === true || o.plates === 'auto' ? 'auto' : null,
    body: { engine: 'base', look: lookPick.look, energy: 'calm' },
    coldOpen,
    windows,
    captionGaps,
    rationale,
    acoustic,
  };
  fs.writeFileSync(outPath, JSON.stringify(plan, null, 2));
  log(`plan → ${outPath}`);
  for (const r of rationale) log('  ' + r);
  return { plan: outPath, look: plan.look, windows: windows.map(({ id, role, start, end, look, energy, heroes, heroWords, line }) => ({ id, role, start, end, look, energy, heroes, heroWords, line })), coldOpen: coldOpen && { from: coldOpen.from, to: coldOpen.to, line: coldOpen.line, heroWords: coldOpen.heroWords }, captionGaps, rationale };
}
