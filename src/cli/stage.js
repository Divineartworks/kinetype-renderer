// kinetype stage: a voice recording (no footage) → a finished caption video in
// which the type IS the picture. Big centred phrases landing as spoken, scenes
// with ambient worlds, hero words taking the screen with a reactive world
// behind them, the voice's loudness breathing into the type, a cold open of
// the best line on longer recordings. Look and energy are chosen by the
// director (tone + intensity) and can rotate away from recently used looks.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './server.js';
import { loadWords } from './captions.js';
import { prepareWords, PROFANE } from '../../templates/kinetic-captions/speech.js';
import { LOOK_IDS } from '../../templates/kinetic-captions/looks/index.js';

function probe(file) {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', file], { cwd: ROOT }).toString());
  return { duration: Number(j.format.duration), audio: j.streams.some((s) => s.codec_type === 'audio') };
}

/** Voice envelope at 10 Hz, normalised 0..1 between the quiet floor and the loud peaks. */
export async function loudnessOf(file) {
  const { envelope } = await import('./pauses.js');
  const env = envelope(file); // 100 Hz dB
  const step = 10, vals = [];
  for (let k = 0; k + step <= env.db.length; k += step) { let m = -120; for (let j = k; j < k + step; j++) m = Math.max(m, env.db[j]); vals.push(m); }
  const sorted = [...vals].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.2)], hi = sorted[Math.floor(sorted.length * 0.97)];
  const norm = vals.map((v) => +Math.max(0, Math.min(1, (v - lo) / Math.max(3, hi - lo))).toFixed(3));
  return { hop: 0.1, t0: 0, values: norm, spread: +(hi - lo).toFixed(1) };
}

/**
 * How intense the recording is → energy. Swearing density and loud-peak share
 * (enhanced voice is compressed, so even calm takes sit high: calibrated on the
 * owner's takes — a calm poem 0.24, talks 0.34/0.46, a rant 0.58 peaks share;
 * swearing 0–13.7%).
 */
export function energyFor(words, loud) {
  const prof = words.filter((w) => PROFANE.test(w.text)).length / Math.max(1, words.length);
  const peaks = loud.values.filter((v) => v > 0.8).length / Math.max(1, loud.values.length);
  const wild = prof >= 0.06 || peaks >= 0.5;
  return { energy: wild ? 'wild' : 'signature', why: `profanity ${(prof * 100).toFixed(1)}%, loud peaks ${(peaks * 100).toFixed(0)}% → ${wild ? 'wild' : 'signature'}` };
}

/**
 * @param input audio (or video) of the voice
 * @param o {words, look ('auto'), avoid ([look ids]), energy ('auto'), format, title, brand, coldOpen ('auto'|'none'), out, specOut (plan only), log}
 */
export async function stage(input, o = {}) {
  const log = o.log || console.error;
  const abs = path.resolve(input);
  const p = probe(abs);
  if (!p.audio) throw new Error(`${input}: no audio stream`);
  const outFile = path.resolve(o.out || path.join(ROOT, 'out', path.basename(abs).replace(/\.[^.]+$/, '') + '-stage.mp4'));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-stage-'));
  try {
    const raw = o.words ? loadWords(path.resolve(o.words)) : (await import('./lyrics.js')).transcribeWords(abs).map((w) => ({ text: w.text, start: +w.start.toFixed(3), end: +w.end.toFixed(3) }));
    const wordsPath = path.join(work, 'words.json');
    fs.writeFileSync(wordsPath, JSON.stringify(raw));
    const words = prepareWords(raw);
    const loud = await loudnessOf(abs);
    // look: tone → look, rotating away from recently used ones (variety across the feed)
    const { pickLook, direct } = await import('./direct.js');
    let look = o.look && o.look !== 'auto' ? o.look : null, lookWhy = look ? 'chosen by the caller' : '';
    if (!look) {
      const pick = pickLook(words, { luma: 0.05, avoid: o.avoid || [] });
      look = pick.look; lookWhy = pick.reasons.join('; ');
    }
    if (!LOOK_IDS.includes(look)) throw new Error(`look must be one of ${LOOK_IDS.join(', ')} or auto`);
    const en = o.energy && o.energy !== 'auto' ? { energy: o.energy, why: 'chosen by the caller' } : energyFor(words, loud);
    const fmt = o.format || 'vertical';
    const brand = o.brand ? (typeof o.brand === 'string' ? JSON.parse(fs.readFileSync(path.resolve(o.brand), 'utf8')) : o.brand) : null;
    // cold open: the director's best complete line, on recordings over a minute
    let cold = null;
    if (o.coldOpen !== 'none' && p.duration >= 60) {
      const d = await direct(abs, { words: wordsPath, format: fmt, look, full: true, coldOpen: 'auto', title: o.title, out: path.join(work, 'plan.json'), log: () => {} });
      cold = d.coldOpen;
    }
    const specOf = (name, t0, t1, ws, energy, extra = {}) => ({
      template: 'kinetic-captions', name, format: fmt, fps: 30, duration: +(t1 - t0).toFixed(3), seed: 7,
      audio: { src: abs, start: +t0.toFixed(3) },
      params: { look, energy, layout: 'stage', ...extra },
      ...(brand?.palette ? { palette: brand.palette } : {}),
      ...(brand?.fonts ? { fonts: brand.fonts } : {}),
      content: { words: ws, loudness: { hop: loud.hop, t0: -t0, values: loud.values } },
      rules: { beatCoverage: false, loopExact: false },
      render: { crf: 16, preset: 'medium' },
    });
    const { render } = await import('./render.js');
    const renderSpec = async (spec) => {
      const specPath = path.join(work, `${spec.name}.json`);
      fs.writeFileSync(specPath, JSON.stringify(spec, null, 2));
      const r = await render(spec, { specPath, specDir: work, out: path.join(work, spec.name), log: () => {}, onProgress: o.onProgress });
      return { file: r.outputs.find((x) => x.format === 'mp4').file, verdict: r.verdict };
    };
    log(`stage: look ${look} (${lookWhy}); energy ${en.energy} (${en.why})${cold ? `; cold open "${cold.line}"` : ''}`);
    if (o.specOut) {
      // plan only: the body spec (with absolute paths) for stills/preview; nothing rendered
      const spec = specOf('body', 0, p.duration, raw, en.energy);
      fs.writeFileSync(path.resolve(o.specOut), JSON.stringify(spec, null, 2));
      return { kind: 'kinetype.stage_plan.v1', spec: path.resolve(o.specOut), look, lookWhy, energy: en.energy, energyWhy: en.why, coldOpen: cold };
    }
    const body = await renderSpec(specOf('body', 0, p.duration, raw, en.energy));
    let final = body.file;
    if (cold) {
      const cws = raw.filter((w) => w.start >= cold.from - 0.01 && w.start < cold.to).map((w) => ({ text: w.text, start: +(w.start - cold.from).toFixed(3), end: +(Math.min(w.end ?? w.start + 0.3, cold.to) - cold.from).toFixed(3) }));
      const cspec = specOf('cold', cold.from, cold.to, cws, 'wild');
      const c = await renderSpec(cspec);
      const cd = probe(c.file).duration;
      const joined = path.join(work, 'joined.mp4');
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', c.file, '-i', body.file, '-filter_complex',
        `[0:v]fade=t=out:st=${(cd - 0.2).toFixed(3)}:d=0.2,format=yuv420p,setpts=PTS-STARTPTS[a];[1:v]format=yuv420p,setpts=PTS-STARTPTS[b];` +
        `[0:a]afade=t=in:d=0.03,afade=t=out:st=${Math.max(0, cd - 0.18).toFixed(3)}:d=0.18,aresample=48000,asetpts=PTS-STARTPTS[ca];[1:a]aresample=48000,asetpts=PTS-STARTPTS[ba];[a][ca][b][ba]concat=n=2:v=1:a=1[v][o]`,
        '-map', '[v]', '-map', '[o]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', joined], { cwd: ROOT });
      final = joined;
    }
    fs.copyFileSync(final, outFile);
    const receipt = { kind: 'kinetype.stage_receipt.v1', created: new Date().toISOString(), input: abs, output: outFile, look, lookWhy, energy: en.energy, energyWhy: en.why, coldOpen: cold, clockOffset: cold ? +(cold.to - cold.from).toFixed(3) : 0, verdict: body.verdict.status === 'fail' ? 'fail' : 'pass', bodyVerdict: body.verdict };
    fs.writeFileSync(outFile.replace(/\.mp4$/, '') + '.receipt.json', JSON.stringify(receipt, null, 2));
    log(`stage → ${outFile} (${receipt.verdict})`);
    return receipt;
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}
