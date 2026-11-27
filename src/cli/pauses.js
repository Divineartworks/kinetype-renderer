// Acoustic pauses: where the speaker is actually silent, measured from the
// audio. Transcript word timings are not enough — whisper/DTW words often run
// edge to edge (a word "ends" when the next begins), hiding the silence inside
// the word. Every cut the director makes is placed in a measured silence, so a
// splice can never land mid-word.
import { execFileSync } from 'node:child_process';
import { ROOT } from './server.js';

const RATE = 16000, HOP = 160, WIN = 320; // 10 ms hop, 20 ms window

/** RMS envelope in dBFS at 100 Hz for [t0, t1] of the file's first audio stream. */
export function envelope(file, { t0 = 0, t1 = null } = {}) {
  const args = ['-v', 'error', ...(t0 ? ['-ss', String(t0)] : []), '-i', file, ...(t1 != null ? ['-t', String(t1 - t0)] : []), '-vn', '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'];
  const buf = execFileSync('ffmpeg', args, { cwd: ROOT, maxBuffer: 1 << 30 });
  const pcm = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
  const n = Math.max(0, Math.floor((pcm.length - WIN) / HOP) + 1);
  const db = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let acc = 0;
    for (let j = k * HOP, e = j + WIN; j < e; j++) acc += pcm[j] * pcm[j];
    db[k] = 10 * Math.log10(acc / WIN / (32768 * 32768) + 1e-12);
  }
  return { db, hz: RATE / HOP, t0 };
}

const pct = (arr, q) => { const a = Float32Array.from(arr).sort(); return a[Math.min(a.length - 1, Math.max(0, Math.floor(q * (a.length - 1))))]; };

/**
 * Annotate words with the silence that follows each one:
 * w.pauseAfter (s, 0 = none), w.quietAt (centre of that silence),
 * w.quietFrom / w.quietTo. Returns {threshold, speechDb, floorDb}.
 */
export function annotatePauses(file, words) {
  if (!words.length) return null;
  const env = envelope(file);
  const { db, hz } = env;
  const at = (t) => Math.max(0, Math.min(db.length - 1, Math.round(t * hz)));
  const speech = [];
  for (const w of words) for (let k = at(w.start); k <= at(w.end); k++) speech.push(db[k]);
  const L = pct(speech, 0.7), N = pct(db, 0.08);
  const thr = N + 0.35 * (L - N);
  for (let i = 0; i < words.length; i++) {
    const w = words[i], nx = words[i + 1];
    const b = nx ? nx.start : Math.min(w.end + 1.5, db.length / hz);
    // the silence after word i sits between its speech and the next word's —
    // with edge-to-edge timings it hides INSIDE word i's span, so search there
    const lo = at(Math.max(w.start + 0.08, b - 1.6)), hi = at(nx ? b + 0.1 : b);
    let best = null, run = null;
    for (let k = lo; k <= hi; k++) {
      if (db[k] < thr) { if (!run) run = { a: k, b: k }; else run.b = k; }
      else if (run) { if (!best || run.b - run.a > best.b - best.a) best = run; run = null; }
    }
    if (run && (!best || run.b - run.a > best.b - best.a)) best = run;
    const len = best ? (best.b - best.a + 1) / hz : 0;
    if (best && len >= 0.1) {
      w.pauseAfter = +len.toFixed(3);
      w.quietFrom = +(best.a / hz).toFixed(3);
      w.quietTo = +((best.b + 1) / hz).toFixed(3);
      w.quietAt = +((w.quietFrom + w.quietTo) / 2).toFixed(3);
    } else { w.pauseAfter = 0; w.quietAt = null; }
  }
  return { threshold: +thr.toFixed(1), speechDb: +L.toFixed(1), floorDb: +N.toFixed(1) };
}
