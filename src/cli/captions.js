// One command: a talking-head / podcast video → kinetic captions of the
// speaker's own words. Transcribes (whisper.cpp DTW), auto-grades from the
// footage's measured exposure, picks a layout for the frame, writes a spec
// next to the output and (optionally) renders it with the video's own audio.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { transcribeWords } from './lyrics.js';
import { ROOT } from './server.js';

function probe(file) {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate:format=duration', '-of', 'json', file], { cwd: ROOT }).toString());
  const v = j.streams.find((s) => s.codec_type === 'video');
  const [a, b] = (v?.r_frame_rate || '30/1').split('/').map(Number);
  return { w: v?.width, h: v?.height, fps: b ? a / b : a, duration: Number(j.format.duration), audio: j.streams.some((s) => s.codec_type === 'audio') };
}

/** Mean luma (0..1) of a few frames → an exposure lift that lands mid-grey faces around 0.42. */
export function autoExposure(file, duration) {
  const vals = [];
  for (const f of [0.15, 0.4, 0.65, 0.9]) {
    const out = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(duration * f), '-i', file, '-frames:v', '1', '-vf', 'scale=64:-2,format=gray', '-f', 'rawvideo', '-'], { cwd: ROOT, maxBuffer: 1 << 24 });
    vals.push(out.reduce((a, x) => a + x, 0) / out.length / 255);
  }
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.max(1, Math.min(2.2, 0.42 / Math.max(0.05, mean)));
}

/** Accept a transcript in any of the shapes the owner's tools produce:
 *  [{text,start,end}], {words:[…]} (kinetype-transcript/v2) or {segments:[{words}]}. */
export function loadWords(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = Array.isArray(j) ? j : j.words || (j.segments || []).flatMap((s) => s.words || []);
  const words = list
    .filter((w) => w && typeof w.text === 'string' && Number.isFinite(+w.start) && (!w.type || w.type === 'word'))
    .map((w) => ({ text: w.text.trim(), start: +(+w.start).toFixed(3), end: +(+(w.end ?? +w.start + 0.3)).toFixed(3) }))
    .filter((w) => w.text);
  if (!words.length) throw new Error(`${file}: no timed words found (expected [{text,start,end}], {words}, or {segments:[{words}]})`);
  return words;
}

export async function captionsSpec(video, { format, out, name, heroes, words: wordsFile, energy = 'signature', look = 'cover', render: doRender = false, onProgress, log = console.error } = {}) {
  if (!['calm', 'signature', 'wild'].includes(energy)) throw new Error(`--energy must be calm, signature or wild (got ${energy})`);
  const { LOOK_IDS } = await import('../../templates/kinetic-captions/looks/index.js');
  if (!LOOK_IDS.includes(look)) throw new Error(`--look must be one of ${LOOK_IDS.join(', ')} (got ${look})`);
  const abs = path.resolve(video);
  const p = probe(abs);
  const srcVertical = p.h > p.w;
  const fmt = format || (srcVertical ? 'vertical' : 'landscape');
  const base = name || path.basename(abs).replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '-') + '-captions-' + fmt;
  const dir = path.resolve(out || path.join(ROOT, 'out', base));
  fs.mkdirSync(dir, { recursive: true });
  let words;
  if (wordsFile) words = loadWords(path.resolve(wordsFile));
  else {
    log(`transcribing ${path.basename(abs)} (${p.duration.toFixed(1)}s)…`);
    words = transcribeWords(abs).map((w) => ({ text: w.text, start: +w.start.toFixed(3), end: +w.end.toFixed(3) }));
  }
  fs.writeFileSync(path.join(dir, 'words.json'), JSON.stringify(words));
  const exposure = +autoExposure(abs, p.duration).toFixed(2);
  const split = fmt === 'landscape' && srcVertical; // vertical phone footage in a 16:9 frame
  const spec = {
    template: 'kinetic-captions',
    name: base,
    format: fmt,
    fps: Math.min(60, Math.round(p.fps)) || 30,
    duration: +p.duration.toFixed(3),
    // full frame on macOS: person mattes let hero words go BEHIND the speaker
    media: { ep: { src: abs, ...(split ? { size: 'native' } : process.platform === 'darwin' ? { matte: true } : {}) } },
    ...(p.audio ? { audio: { src: abs, start: 0 } } : {}),
    params: {
      grade: { exposure, contrast: 1.06, saturation: 0.96 },
      look,
      energy,
      ...(split ? { layout: 'split' } : {}),
    },
    content: { wordsSrc: 'words.json', ...(heroes?.length ? { heroes } : {}) },
    rules: { beatCoverage: false, loopExact: false },
  };
  const specPath = path.join(dir, `${base}.json`);
  fs.writeFileSync(specPath, JSON.stringify(spec, null, 2));
  log(`spec → ${specPath}  (${words.length} words, exposure ×${exposure}, layout ${split ? 'split' : 'full'}, look ${look}, energy ${energy})`);
  let receipt = null;
  if (doRender) {
    const { render } = await import('./render.js');
    receipt = await render(spec, { specPath, specDir: dir, out: dir, log, onProgress });
  }
  return { specPath, dir, words: words.length, exposure, layout: split ? 'split' : 'full', look, energy, receipt };
}
