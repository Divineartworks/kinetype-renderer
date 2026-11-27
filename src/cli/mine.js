// Clip mining: one long episode → a series of shorts.
//
// Finds the stretches (25–60 s by default) that work as stand-alone videos:
// they open on a line strong enough to be a hook, end on a payoff at a real
// pause, carry a dense idea in between and don't overlap. Each short is then
// produced with the director + compose (its own hook and spikes), and chained
// into a series: every short ends on a 2.5 s teaser of the NEXT short's
// strongest line ("PART n"), so a viewer who liked one follows to the next.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './server.js';
import { loadWords } from './captions.js';
import { prepareWords, sentencesOf, quotability, standsAlone, themesOf, pauseStats, isPunctuated, contentWord } from '../../templates/kinetic-captions/speech.js';

function probe(file) {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate:format=duration', '-of', 'json', file], { cwd: ROOT }).toString());
  const v = j.streams.find((s) => s.codec_type === 'video');
  const [a, b] = (v?.r_frame_rate || '30/1').split('/').map(Number);
  return { w: v?.width, h: v?.height, fps: b ? a / b : a, duration: Number(j.format.duration) };
}

/**
 * Score every candidate clip and pick the best non-overlapping set.
 * Pure (no I/O) so it can be tested: words must already carry pauses.
 */
export function pickClips(words, { count = 6, min = 25, max = 60, title = null, duration = Infinity } = {}) {
  const pauses = pauseStats(words), punctuated = isPunctuated(words);
  const themes = themesOf(words);
  const titleSet = title ? new Set(title.toLowerCase().split(/[^a-z0-9'’-]+/).filter((t) => t.length >= 3)) : null;
  const units = sentencesOf(words, { pause: punctuated ? 1.0 : Math.max(0.35, pauses.p80), maxDur: 12 });
  const prevWord = (u) => (u.words[0].i > 0 ? words[u.words[0].i - 1] : null);
  const q = units.map((u) => quotability(u, { themes, title: titleSet, pauses, punctuated, prevStop: prevWord(u) ? !!prevWord(u).stop : true }));
  const alone = units.map((u) => standsAlone(u, { pauses, punctuated, prevWord: prevWord(u) }));
  const cands = [];
  for (let i = 0; i < units.length; i++) {
    // a short must START on a line that can stand alone — it is the whole hook:
    // a real sentence start, no filler, and genuinely strong
    const pw = prevWord(units[i]);
    if (!alone[i] || q[i].filler || q[i].score < 8) continue;
    if (punctuated && pw && !pw.stop) continue;
    for (let j = i; j < units.length; j++) {
      const dur = units[j].end - units[i].start;
      if (dur > max) break;
      if (dur < min) continue;
      if (units[j].end > duration - 0.3) break;
      // …and END on a payoff at a real break
      // …and END on a payoff: a finished sentence, or a complete thought at a long pause
      const lastRaw = units[j].words[units[j].words.length - 1].raw;
      const endsSentence = /[.!?…]["”’)]*$/.test(lastRaw);
      const endsClean = endsSentence || (alone[j] && units[j].gapAfter >= Math.max(0.6, pauses.p80));
      if (!endsClean || q[j].filler || /[,;:—–-]["”’)]*$/.test(lastRaw)) continue;
      const inner = q.slice(i, j + 1).map((x) => x.score).sort((a, b) => b - a);
      const density = inner.slice(0, 4).reduce((a, b) => a + b, 0) / Math.min(4, inner.length);
      const ws = words.filter((w) => w.start >= units[i].start && w.end <= units[j].end + 0.01);
      const contentRate = ws.filter(contentWord).length / Math.max(1, dur);
      const hook = Math.max(q[i].score, i + 1 <= j ? (q[i].score + q[i + 1].score) / 2 : 0);
      const payoff = q[j].score;
      // sweet spot around 40 s; dead air costs
      const silence = ws.reduce((a, w) => a + Math.max(0, (w.pauseAfter || 0) - 0.8), 0);
      const score = hook * 1.4 + payoff * 1.0 + density * 1.2 + contentRate * 6 - Math.abs(dur - 40) * 0.05 - silence * 1.5;
      cands.push({ i, j, start: units[i].start, end: units[j].end, dur, score: +score.toFixed(2), hook: units[i].text, hookScore: q[i].score, payoff: units[j].text, payoffScore: q[j].score, density: +density.toFixed(2), units: [i, j] });
    }
  }
  // best non-overlapping set: highest scores first, with a small gap between clips
  cands.sort((a, b) => b.score - a.score);
  const chosen = [];
  for (const c of cands) {
    if (chosen.length >= count) break;
    if (chosen.some((x) => c.start < x.end + 2 && c.end > x.start - 2)) continue;
    chosen.push(c);
  }
  // each clip's strongest single line — its teaser for the previous part
  for (const c of chosen) {
    let best = null;
    for (let k = c.i; k <= c.j; k++) {
      const u = units[k], d = u.end - u.start;
      if (d < 1.2 || d > 4.5 || !alone[k]) continue;
      if (!best || q[k].score > best.score) best = { start: u.start, end: u.end, line: u.text, score: q[k].score };
    }
    c.teaserLine = best || { start: units[c.i].start, end: Math.min(units[c.i].end, units[c.i].start + 3.5), line: units[c.i].text, score: q[c.i].score };
  }
  return { clips: chosen, pauses, punctuated, candidates: cands.length };
}

/**
 * @param video clean source video
 * @param o {words, count, min, max, title, look, energy, out, render, series, brand, log}
 */
export async function mine(video, o = {}) {
  const log = o.log || console.error;
  const abs = path.resolve(video);
  const p = probe(abs);
  const outDir = path.resolve(o.out || path.join(ROOT, 'out', path.basename(abs).replace(/\.[^.]+$/, '') + '-shorts'));
  fs.mkdirSync(outDir, { recursive: true });
  const raw = o.words ? loadWords(path.resolve(o.words)) : null;
  if (!raw) throw new Error('mine needs --words (a word-timed transcript)');
  const words = prepareWords(raw);
  const { annotatePauses } = await import('./pauses.js');
  annotatePauses(abs, words);
  const { clips, candidates } = pickClips(words, { count: o.count ?? 6, min: o.min ?? 25, max: o.max ?? 60, title: o.title, duration: p.duration });
  // posting order = the order they happen in the episode (the story holds together)
  clips.sort((a, b) => a.start - b.start);
  clips.forEach((c, k) => { c.part = k + 1; c.id = `part-${String(k + 1).padStart(2, '0')}`; });
  log(`mined ${clips.length} shorts from ${candidates} candidates:`);
  for (const c of clips) log(`  ${c.id} ${c.start.toFixed(1)}–${c.end.toFixed(1)}s (${c.dur.toFixed(0)}s, score ${c.score}): "${c.hook.slice(0, 70)}" … "${c.payoff.slice(-50)}"`);
  const manifest = { schema: 'kinetype-shorts/v1', look: o.look && o.look !== 'auto' ? o.look : null, source: abs, created: new Date().toISOString(), clips: clips.map(({ i, j, units, ...c }) => c) };
  const mpath = path.join(outDir, 'shorts.json');
  fs.writeFileSync(mpath, JSON.stringify(manifest, null, 2));
  if (!o.render) return { manifest: mpath, clips: manifest.clips };

  // ── produce every short: segment → director → compose → teaser ─────────
  const { direct, pickLook } = await import('./direct.js');
  // one look for the whole series (a series should look like one show)
  const { footageLuma } = await import('./direct.js');
  const seriesLook = o.look && o.look !== 'auto' ? o.look : pickLook(words, { luma: footageLuma(abs, p.duration) }).look;
  const { compose } = await import('./compose.js');
  const { render } = await import('./render.js');
  const results = [];
  for (let k = 0; k < clips.length; k++) {
    const c = clips[k], next = clips[k + 1];
    const cdir = path.join(outDir, c.id);
    fs.mkdirSync(cdir, { recursive: true });
    // the clip: a short lead-in and tail inside the surrounding pauses
    const t0 = Math.max(0, c.start - 0.2), t1 = Math.min(p.duration, c.end + 0.45);
    const seg = path.join(cdir, 'segment.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', t0.toFixed(3), '-i', abs, '-t', (t1 - t0).toFixed(3), '-c:v', 'libx264', '-preset', 'fast', '-crf', '14', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', seg], { cwd: ROOT });
    const segWords = raw.filter((w) => w.start >= t0 - 0.01 && w.start < t1).map((w) => ({ text: w.text, start: +(w.start - t0).toFixed(3), end: +((w.end ?? w.start + 0.3) - t0).toFixed(3) }));
    const wpath = path.join(cdir, 'words.json');
    fs.writeFileSync(wpath, JSON.stringify(segWords));
    const d = await direct(seg, { words: wpath, look: seriesLook, plates: o.plates, energy: o.energy, title: o.title, brand: o.brand, out: path.join(cdir, 'plan.json'), log: () => {} });
    const body = await compose(d.plan, { out: path.join(cdir, 'body.mp4'), log: () => {} });
    let final = body.output;
    // ── the series teaser: the next part's strongest line, 2.5 s, dip in ──
    if (o.series !== false && next) {
      const tl = next.teaserLine;
      const ts0 = Math.max(0, tl.start - 0.15), ts1 = Math.min(p.duration, Math.max(tl.end + 0.35, ts0 + 2.2));
      const tw = raw.filter((w) => w.start >= ts0 - 0.01 && w.start < ts1).map((w) => ({ text: w.text, start: +(w.start - ts0).toFixed(3), end: +(Math.min(w.end ?? w.start + 0.3, ts1) - ts0).toFixed(3) }));
      const tpw = prepareWords(tw);
      const heroW = tpw.filter(contentWord).sort((a, b) => b.s - a.s)[0];
      const spec = {
        template: 'kinetic-captions', name: `${c.id}-teaser`, format: p.h > p.w ? 'vertical' : 'landscape', fps: Math.round(p.fps) || 30, duration: +(ts1 - ts0).toFixed(3), seed: 11,
        media: { ep: { src: abs, start: +ts0.toFixed(3), ...(process.platform === 'darwin' ? { matte: true } : {}) } },
        audio: { src: abs, start: +ts0.toFixed(3) },
        params: { look: d.look, energy: 'wild', heroEvery: 60, grade: JSON.parse(fs.readFileSync(d.plan, 'utf8')).grade || undefined },
        ...(o.brand ? { palette: JSON.parse(fs.readFileSync(path.resolve(o.brand), 'utf8')).palette } : {}),
        content: {
          words: tw, ...(heroW ? { heroes: [heroW.start] } : {}),
          overlays: [{ template: 'lower-third', at: 0.1, duration: Math.max(1.6, ts1 - ts0 - 0.2), content: { name: `Part ${next.part}`, ...(o.title ? { role: o.title } : {}), position: 'top-left' }, params: { style: 'kinetic' } }],
        },
        rules: { beatCoverage: false, loopExact: false },
        render: { crf: 14, preset: 'medium' },
      };
      if (!spec.params.grade) delete spec.params.grade;
      const tdir = path.join(cdir, 'teaser');
      fs.mkdirSync(tdir, { recursive: true });
      const tspec = path.join(tdir, 'teaser.json');
      fs.writeFileSync(tspec, JSON.stringify(spec, null, 2));
      const tr = await render(spec, { specPath: tspec, specDir: tdir, out: tdir, log: () => {} });
      const tclip = tr.outputs.find((x) => x.format === 'mp4').file;
      // body → 0.25 s dip → teaser (fades out at the end)
      const bd = probe(final).duration, td = probe(tclip).duration;
      const withTeaser = path.join(cdir, `${c.id}.mp4`);
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', final, '-i', tclip, '-filter_complex',
        `[0:v]fade=t=out:st=${(bd - 0.2).toFixed(3)}:d=0.2,format=yuv420p,setpts=PTS-STARTPTS[a];[1:v]scale=${p.w}:${p.h},fade=t=in:st=0:d=0.15,fade=t=out:st=${(td - 0.3).toFixed(3)}:d=0.3,format=yuv420p,setpts=PTS-STARTPTS[b];` +
        `[0:a]afade=t=out:st=${(bd - 0.2).toFixed(3)}:d=0.2,aresample=48000,asetpts=PTS-STARTPTS[aa];[1:a]afade=t=in:d=0.1,afade=t=out:st=${(td - 0.3).toFixed(3)}:d=0.3,aresample=48000,asetpts=PTS-STARTPTS[ba];[a][aa][b][ba]concat=n=2:v=1:a=1[v][o]`,
        '-map', '[v]', '-map', '[o]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', withTeaser], { cwd: ROOT });
      final = withTeaser;
    } else {
      const f = path.join(cdir, `${c.id}.mp4`);
      fs.renameSync(final, f);
      final = f;
    }
    // keep only the finished short
    for (const n of ['segment.mp4', 'body.mp4']) fs.rmSync(path.join(cdir, n), { force: true });
    fs.rmSync(path.join(cdir, '.kinetype-cache'), { recursive: true, force: true });
    fs.rmSync(path.join(cdir, 'teaser'), { recursive: true, force: true });
    log(`  ${c.id} → ${final} (${body.verdict})`);
    results.push({ id: c.id, part: c.part, file: final, verdict: body.verdict, look: d.look, hook: c.hook, teaser: next ? next.teaserLine.line : null });
  }
  manifest.rendered = results;
  fs.writeFileSync(mpath, JSON.stringify(manifest, null, 2));
  return { manifest: mpath, clips: results };
}
