// Word-timed lyrics (docs/LYRICS_FORMAT.md) from LRC / enhanced LRC / SRT /
// JSON / plain text. Where word times are missing and audio is given, the
// known words are force-aligned to a whisper.cpp transcript (prompted with the
// lyrics) by global sequence alignment; unmatched words are interpolated.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './server.js';

const ts = (m, s) => Number(m) * 60 + Number(s);
const norm = (w) => w.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9']/g, '').replace(/'/g, '');

/** Rough syllable weight so untimed words share a line's time like a singer would. */
export function syllables(w) {
  const s = norm(w);
  if (!s) return 0.5;
  const m = s.replace(/e$/, '').match(/[aeiouy]+/g);
  return Math.max(1, m ? m.length : 1) + (s.length > 7 ? 0.5 : 0);
}

export function parseLrc(text) {
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!tags.length) continue;
    const body = raw.replace(/\[[^\]]*\]/g, '').trim();
    if (!body) { for (const t of tags) lines.push({ start: ts(t[1], t[2]), text: '', words: [] }); continue; }
    const wordTags = [...body.matchAll(/<(\d+):(\d+(?:\.\d+)?)>\s*([^<]*)/g)];
    for (const t of tags) {
      const start = ts(t[1], t[2]);
      if (wordTags.length) {
        const words = wordTags.filter((w) => w[3].trim()).map((w) => ({ text: w[3].trim(), start: ts(w[1], w[2]) }));
        lines.push({ start, text: words.map((w) => w.text).join(' '), words });
      } else lines.push({ start, text: body, words: body.split(/\s+/).map((w) => ({ text: w })) });
    }
  }
  lines.sort((a, b) => a.start - b.start);
  for (let i = 0; i < lines.length; i++) lines[i].end = lines[i + 1] ? lines[i + 1].start : lines[i].start + 4;
  return lines.filter((l) => l.text);
}

export function parseSrt(text) {
  const out = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const m = block.match(/(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)\s*\r?\n([\s\S]+)/);
    if (!m) continue;
    const t = (h, mi, s, ms) => Number(h) * 3600 + Number(mi) * 60 + Number(s) + Number(ms) / 1000;
    const body = m[9].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    out.push({ start: t(m[1], m[2], m[3], m[4]), end: t(m[5], m[6], m[7], m[8]), text: body, words: body.split(' ').map((w) => ({ text: w })) });
  }
  return out;
}

/** Fill missing word times inside each line by syllable weight. */
export function distribute(lines) {
  for (const l of lines) {
    const ws = l.words;
    const known = ws.map((w, i) => (w.start != null ? i : -1)).filter((i) => i >= 0);
    const anchors = [{ i: -1, t: l.start }, ...known.map((i) => ({ i, t: ws[i].start })), { i: ws.length, t: l.end }];
    for (let a = 0; a < anchors.length - 1; a++) {
      const A = anchors[a], B = anchors[a + 1];
      const span = ws.slice(A.i + 1, B.i);
      if (!span.length) continue;
      const tStart = A.i >= 0 ? A.t + Math.min(0.35, (B.t - A.t) * 0.3) : A.t;
      const wsum = span.reduce((s, w) => s + syllables(w.text), 0);
      let acc = tStart;
      const avail = Math.max(0.05, B.t - tStart);
      for (const w of span) { w.start = acc; acc += (avail * syllables(w.text)) / wsum; }
    }
    for (let i = 0; i < ws.length; i++) ws[i].end = ws[i].end ?? Math.min(ws[i + 1]?.start ?? l.end, ws[i].start + Math.max(0.12, syllables(ws[i].text) * 0.42));
    l.start = ws[0]?.start ?? l.start;
  }
  return lines;
}

function whisperModel() {
  const cands = [process.env.KINETYPE_WHISPER_MODEL,
    path.join(os.homedir(), '.cache/whisper/ggml-base.en.bin')].filter(Boolean);
  return cands.find((p) => fs.existsSync(p)) || null;
}

// whisper.cpp DTW token timestamps land ~0.2 s after the word onset. Measured
// on a ground-truth song (27 words placed at known times over drums):
// raw DTW bias +0.216 s; corrected: median 16 ms, p90 56 ms, max 134 ms.
// Segment offsets were far worse (p90 0.61 s, max 2.41 s) and prompting with
// the lyrics made whisper echo the prompt with collapsed timestamps — never prompt.
export const DTW_LAG = 0.2;
const DTW_PRESETS = /ggml-(tiny|base|small|medium|large-v1|large-v2|large-v3|large-v3-turbo)(\.en)?\.bin$/;

/** whisper.cpp word-level transcript: [{text,start,end,timing}] */
export function transcribeWords(audio) {
  const model = whisperModel();
  if (!model) throw new Error('no whisper.cpp model found; set KINETYPE_WHISPER_MODEL to a ggml-*.bin');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-lyr-'));
  const wav = path.join(tmp, 'a.wav');
  // vocal band: drop kick/sub and air, where drums and hiss confuse the decoder
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', audio, '-af', 'highpass=f=120,lowpass=f=6000', '-ar', '16000', '-ac', '1', wav], { cwd: ROOT });
  const dtw = path.basename(model).match(DTW_PRESETS);
  const args = ['-m', model, '-f', wav, '-ojf', '-of', path.join(tmp, 'out'), '-np'];
  // no text context carried between segments: on long recordings the carried
  // context drifts into unpunctuated lowercase (measured: 0 → 41 sentence ends
  // on a 12-min episode) and loops; override with KINETYPE_WHISPER_MC=<n>
  args.push('-mc', process.env.KINETYPE_WHISPER_MC ?? '0');
  if (dtw) args.push('-dtw', dtw[1] + (dtw[2] || ''), '-nfa'); // DTW needs flash attention off
  execFileSync('whisper-cli', args, { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'], maxBuffer: 64 << 20 });
  const j = JSON.parse(fs.readFileSync(path.join(tmp, 'out.json'), 'utf8'));
  fs.rmSync(tmp, { recursive: true, force: true });
  const words = [];
  for (const seg of j.transcription) for (const t of seg.tokens || []) {
    if (t.text.startsWith('[_')) continue;
    const st = dtw && t.t_dtw >= 0 ? Math.max(0, t.t_dtw / 100 - DTW_LAG) : t.offsets.from / 1000;
    if (/^\s/.test(t.text) || !words.length) words.push({ text: t.text.trim(), start: st, timing: dtw && t.t_dtw >= 0 ? 'dtw' : 'segment' });
    else words[words.length - 1].text += t.text;
  }
  const out = words.filter((w) => norm(w.text));
  for (let i = 0; i < out.length; i++) out[i].end = Math.min(out[i + 1]?.start ?? out[i].start + 0.6, out[i].start + 1.5);
  return out;
}

/** Needleman–Wunsch between lyric words and recognised words. */
export function align(lyricWords, heard) {
  const a = lyricWords.map((w) => norm(w.text)), b = heard.map((w) => norm(w.text));
  const n = a.length, m = b.length;
  const sim = (x, y) => {
    if (x === y) return 2;
    if (!x || !y) return -1;
    const L = Math.max(x.length, y.length);
    let d = levenshtein(x, y);
    return 1 - d / L >= 0.7 ? 1 : -1;
  };
  const S = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  const P = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
  for (let i = 1; i <= n; i++) { S[i][0] = -i; P[i][0] = 1; }
  for (let j = 1; j <= m; j++) { S[0][j] = -j * 0.5; P[0][j] = 2; }
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const d = S[i - 1][j - 1] + sim(a[i - 1], b[j - 1]), u = S[i - 1][j] - 1, l = S[i][j - 1] - 0.5;
    if (d >= u && d >= l) { S[i][j] = d; P[i][j] = 0; } else if (u >= l) { S[i][j] = u; P[i][j] = 1; } else { S[i][j] = l; P[i][j] = 2; }
  }
  const map = new Array(n).fill(-1);
  let i = n, j = m;
  while (i > 0 && j > 0) {
    if (P[i][j] === 0) { if (sim(a[i - 1], b[j - 1]) > 0) map[i - 1] = j - 1; i--; j--; }
    else if (P[i][j] === 1) i--;
    else j--;
  }
  return map;
}

function levenshtein(x, y) {
  const d = Array.from({ length: x.length + 1 }, (_, i) => [i, ...new Array(y.length).fill(0)]);
  for (let j = 1; j <= y.length; j++) d[0][j] = j;
  for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
  return d[x.length][y.length];
}

/** Plain lyrics + audio → timed lines via alignment. */
export function alignPlain(text, audio) {
  const rawLines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^\[.*\]$/.test(l));
  const lines = rawLines.map((l) => ({ text: l, words: l.split(/\s+/).map((w) => ({ text: w })) }));
  const flat = lines.flatMap((l) => l.words);
  const heard = transcribeWords(audio);
  const map = align(flat, heard);
  flat.forEach((w, k) => { if (map[k] >= 0) { w.start = heard[map[k]].start; w.end = heard[map[k]].end; w.matched = true; } });
  // interpolate unmatched words between matched neighbours by syllable weight
  let k = 0;
  while (k < flat.length) {
    if (flat[k].matched) { k++; continue; }
    let e = k;
    while (e < flat.length && !flat[e].matched) e++;
    const t0 = k > 0 ? flat[k - 1].end : Math.max(0, (flat[e]?.start ?? 0) - 1.5);
    const t1 = e < flat.length ? flat[e].start : t0 + (e - k) * 0.4;
    const wsum = flat.slice(k, e).reduce((s, w) => s + syllables(w.text), 0);
    let acc = t0;
    for (let q = k; q < e; q++) { const d = ((t1 - t0) * syllables(flat[q].text)) / wsum; flat[q].start = acc; flat[q].end = acc + d; acc += d; }
    k = e;
  }
  const matched = flat.filter((w) => w.matched);
  for (const l of lines) { l.start = l.words[0].start; l.end = l.words[l.words.length - 1].end; }
  // Honest confidence: matched words only count if their timing is plausible —
  // monotonic, not collapsed onto one timestamp, and word-sized.
  let plausible = 0;
  for (let k = 0; k < matched.length; k++) {
    const w = matched[k], prev = matched[k - 1];
    const mono = !prev || w.start > prev.start + 0.02;
    const sized = w.end - w.start >= 0.04 && w.end - w.start <= 3;
    if (mono && sized) plausible++;
  }
  const segmentOnly = heard.every((w) => w.timing !== 'dtw');
  const confidence = flat.length ? (plausible / flat.length) * (segmentOnly ? 0.6 : 1) : 0;
  return { lines, confidence, heard: heard.length, matched: matched.length, timing: segmentOnly ? 'segment (no DTW preset for this model)' : 'dtw' };
}

export async function buildLyrics(input, { audio, out, offset = 0 } = {}) {
  const ext = path.extname(input).toLowerCase();
  const text = fs.readFileSync(input, 'utf8');
  let lines, source, confidence = null, detail = {};
  if (ext === '.json') { lines = JSON.parse(text).lines; source = 'json'; }
  else if (ext === '.lrc') { lines = distribute(parseLrc(text)); source = /<\d+:\d+/.test(text) ? 'lrc-enhanced' : 'lrc'; }
  else if (ext === '.srt') { lines = distribute(parseSrt(text)); source = 'srt'; }
  else {
    if (!audio) throw new Error('plain-text lyrics need --audio to align against (or supply .lrc/.srt with timing)');
    const r = alignPlain(text, audio);
    lines = r.lines; source = 'whisper-aligned'; confidence = r.confidence; detail = { heardWords: r.heard, matchedWords: r.matched, timing: r.timing };
  }
  const clean = lines.map((l) => ({
    start: +(l.start + offset).toFixed(3), end: +(l.end + offset).toFixed(3),
    words: l.words.map((w) => ({ text: w.text, start: +(w.start + offset).toFixed(3), end: +(w.end + offset).toFixed(3), ...(w.emph ? { emph: true } : {}) })),
  }));
  const doc = { lines: clean, source, ...(confidence != null ? { confidence: +confidence.toFixed(3) } : {}) };
  const dest = path.resolve(out || input.replace(/\.[^.]+$/, '') + '.timing.json');
  fs.writeFileSync(dest, JSON.stringify(doc, null, 2));
  const words = clean.reduce((s, l) => s + l.words.length, 0);
  return { doc, file: dest, summary: { file: dest, source, lines: clean.length, words, confidence: doc.confidence ?? null, ...detail, duration: clean.length ? clean[clean.length - 1].end : 0 } };
}
