#!/usr/bin/env node
// kinetype CLI — the same verbs the MCP server exposes.
import fs from 'node:fs';
import path from 'node:path';
import { loadAll } from '../templates/index.js';
import { validate, loadSpec, getTemplate, BASE_SCHEMA } from '../src/cli/spec.js';

const argv = process.argv.slice(2);
const cmd = argv[0];
const pos = [];
const flags = {};
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const [k, v] = a.slice(2).split('=');
    if (v !== undefined) flags[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[k] = argv[++i];
    else flags[k] = true;
  } else pos.push(a);
}
const num = (v) => (v === undefined ? undefined : Number(v));
const out = (o) => process.stdout.write((typeof o === 'string' ? o : JSON.stringify(o, null, 2)) + '\n');

function templateSummary(t) {
  return { id: t.id, name: t.name, version: t.version, description: t.description, tags: t.tags, formats: t.formats, duration: t.duration, bpm: t.bpm, loop: !!t.loop, palette: t.palette, fonts: t.fonts };
}

const HELP = `kinetype — deterministic kinetic typography engine

  kinetype templates [--json]              list templates
  kinetype describe <template> [--base]    schema, defaults, palette/font roles, style presets, example
  kinetype example <template> > spec.json  write a starter spec
  kinetype validate <spec.json>            check a spec against its template
  kinetype stills <spec.json> [--at 1.2,4] [--samples N] [--out DIR]
                                           pre-pass: keyframe PNGs + contact sheet + layout QA
  kinetype render <spec.json> [--out DIR] [--formats mp4,prores,webm,mov-alpha] [--samples N]
                  [--shutter 0..1] [--workers N] [--draft] [--crf N] [--frames A:B]
                                           full render + receipt.json (QA verdict, hashes)
  kinetype html <spec.json> [--out FILE]   single self-contained HTML (window.seek(t))
  kinetype preview <spec.json> [--port N]  live scrubbable preview in your browser
  kinetype check [prefix]                  toolchain + every example: validate, boot, seek-purity
  kinetype fonts add "<Family>" <weight> [--italic]   fetch a Google Font (OFL) and pin it
  kinetype fonts list
  kinetype audio analyze <file> [--out analysis.json] [--clicks]  tempo, beats, downbeats, energy
                                           (--clicks: song + beat clicks, the listening test)
  kinetype captions <video> [--look cover|neon|noir|poster|terminal|swiss|riso|cinema|marker]
                  [--energy calm|signature|wild] [--format vertical|landscape]
                  [--words transcript.json] [--render] [--heroes 12.5,40]
                                           podcast/talking-head → kinetic captions of the speaker's own
                                           words (transcribe + auto-grade + layout + spec [+ render])
  kinetype direct <video> [--words t.json] [--look auto|cover|neon|…|marker] [--hook 7] [--moments 3]
                  [--cold-open auto|none|12.5-18] [--full] [--title "Episode title"] [--brand brand.json]
                  [--energy wild] [--moment-energy signature] [--hook-look L] [--hook-energy E]
                  [--plates auto] [--out plan.json]
                                           director: plan where kinetic captions take over (hook,
                                           cold open, spike moments), cut in measured silences
  kinetype mine <video> --words t.json [--count 6] [--min 25] [--max 60] [--title T] [--look L]
                  [--brand b.json] [--plates auto] [--render] [--no-series] [--out DIR]
                                           clip mining: the best stand-alone 25–60 s shorts of an
                                           episode (strong opening line, payoff ending), rendered
                                           as a series — each ends on a teaser of the next part
  kinetype cover <video> [--words t.json] [--title "…"] [--word W] [--look L] [--brand b.json]
                  [--format vertical|landscape] [--at 12.5] [--out cover.jpg]
                                           episode cover: best frame (Vision quality, eyes, gaze) +
                                           the key word giant behind the speaker, on-brand
  kinetype compose <plan.json> [--base captioned.mp4] [--out final.mp4] [--prerender]
                                           render the plan's windows and splice them into the base
                                           (auto time-align + grade match, crossfades, cold open,
                                           verification, review sheet); no --base = kinetype body
  kinetype stage <audio> [--words t.json] [--look auto|L] [--avoid L1,L2] [--energy auto|calm|signature|wild]
                  [--format vertical|square|landscape] [--title T] [--brand b.json] [--cold-open auto|none]
                  [--out stage.mp4] [--spec-out spec.json (plan only, no render)]
                                           voice recording → caption video where the type IS the
                                           picture: big phrases, scenes with ambient worlds, hero
                                           words, the voice's loudness in the type, cold open;
                                           --avoid rotates away from recently used looks
  kinetype relight <video> [--out out.mp4] [--strength 0..1]
                                           studio relight: soft key light on the speaker, room falls
                                           off, skin cast fixed; adaptive (bright footage ~unchanged)
  kinetype capture <flow.json> --out DIR [--base-url URL] [--font-dir D1,D2] [--quality 94] [--crf 10]
                                           run a flow (kinetype.flow.v1) against a LIVE app and record it
                                           frame-exactly (constant fps, independent of host load): frames,
                                           capture.mp4, capture.json (events/marks/steps in CSS px), receipt.json
  kinetype capture --validate DIR/capture.json    check a capture against kinetype.capture.v1
  kinetype capture --sheet DIR             DIR/contact-sheet.png: one labelled frame per step
  kinetype capture <flow.json> --device android [--serial S] [--transport adb|cdp-touch] [--out DIR] [--base-url URL]
                                           a REAL device (C1 v2, device.kind "android"): rehearse, then perform (= kinetype perform)
  kinetype rehearse <flow.json|session.json> [--transport adb|cdp-touch|cdp-desktop] [--serial S] [--base-url URL] [--out DIR]
                                           dry run on the device, no recording: every target resolves (one match, visible,
                                           unobstructed), every mark/sync reached; calibration error; per-step timings →
                                           DIR/rehearsal.json. Exit 1 when it fails (a failed flow is never performed)
  kinetype perform <flow.json|session.json> [same flags] [--rehearsal DIR/rehearsal.json] [--reset CMD]
                                           --reset CMD: host command that restores the app state, run before the rehearsal AND
                                           again before the take (a rehearsal really submits); its last stdout line may be
                                           {"vars":{"NAME":"v"}} filling {{NAME}} in step url/value (after hashing)
                                           native recording with the choreographed demo-artist tempo: capture.mp4 (CFR 60 fps,
                                           native resolution), capture.json (C2 v2: clock wall, vbox/vpoint, idle/busy,
                                           sessionOffset), receipt.json, contact-sheet.png; a session runs 2–3 devices on one
                                           clock. Runs against fixture apps and real devices
  kinetype device-diag --base-url URL [--serial S] [--browser chrome|pwa] [--transport adb|cdp-touch] [--out DIR]
                                           calibration diagnostics on a device: DOM metrics (inner/outer size, visualViewport,
                                           screen, DPR, display-mode), device facts, DevTools targets, and ONE annotated
                                           screencap of the FIXTURE's /calibration (refuses any other page) → DIR/diag.json,
                                           screencap.png, annotated.png, calibration-debug.json
  kinetype device-stage --base-url URL [--serial S] [--browser chrome|pwa] [--out DIR] | --undo
                                           CLEAN STAGE preflight on its own (rehearse/perform run it too): system locale
                                           nb-NO check + Chrome per-app locale, translate off, SystemUI demo mode 09:41 /
                                           full battery + signal / no notifications, one Chrome tab, PWA launch, and the
                                           overlay check (page rendering vs screencap); --undo leaves demo mode
  kinetype device-locale [--serial S] [--locale nb-NO] [--out DIR]
                                           set the SYSTEM language on a Play-image emulator (no root) by driving Settings
                                           (English or Norwegian UI): add Norsk bokmål (Norge), make it first; idempotent;
                                           verified with settings system_locales / persist.sys.locale; exit 1 unless nb first
  kinetype device-wait --serial S [--timeout 300]
                                           wait until Android is really usable (boot completed, boot animation stopped,
                                           window/activity/package services up, package manager answering) — for cold boots
  kinetype edit <spec.json> [--draft] [--pace-only] [--sound-only] [--out DIR] [--workers N]
                                           real-video ui-demo (native recordings): pace report (fails on
                                           LIVE pace rules), procedural SFX from the film events + voice + ducked
                                           music mixed to -16 LUFS / <= -1.5 dBTP, then the render with that audio
  kinetype explore <url> --goal "…" [--seconds 45] [--device desktop|phone] --out DIR [--base-url URL] [--font-dir D1,D2]
                                           an agent uses a LIVE app (same origin, never types/submits/deletes), plans the
                                           story act → look → narrate, then writes DIR/flow.json (kinetype.flow.v1),
                                           narration.json (director.narration.v1, lines anchored to flow marks) and
                                           explore.log.json (audit). Every number/price/name/superlative in the narration
                                           must be on a visited screen (EN + NO number words); the flow is replayed from
                                           a cold start (dry, no frames) before it is written. Needs the claude CLI
                                           (CLAUDE_BIN to override). Then: kinetype capture DIR/flow.json
  kinetype transcribe <video|audio> [--out words.json]  word-timed speech transcript (whisper.cpp DTW)
                                           → content.wordsSrc of kinetic-captions
  kinetype lyrics <lyrics.txt|.lrc|.srt> --audio <file> [--out timing.json]
                                           word-timed lyrics for lyric templates
  kinetype ambient <list|render|clip|sheet|strip|qa|bench|randomize|breed> ...   calm seamless loop videos (GPU shaders)
  (run \`kinetype ambient help\` for the ambient flags)
`;

async function main() {
  switch (cmd) {
    case 'templates': {
      const { templates, broken } = await loadAll();
      const list = templates.map(templateSummary);
      if (flags.json) return out({ templates: list, broken });
      for (const t of list) out(`${t.id.padEnd(22)} ${t.name} — ${t.description}`);
      for (const b of broken) out(`${b.id.padEnd(22)} BROKEN: ${b.error}`);
      return;
    }
    case 'describe': {
      const t = await getTemplate(pos[0]);
      const d = { ...templateSummary(t), paletteRoles: t.paletteRoles, params: t.params, schema: t.schema, example: t.example, notes: t.notes, ...(flags.base ? { baseSpecSchema: BASE_SCHEMA } : { baseSpecSchema: 'omitted — add --base to include the shared spec schema (format, audio, media, background, render, rules)' }) };
      return out(flags.json ? d : JSON.stringify(d, null, 2));
    }
    case 'example': {
      const t = await getTemplate(pos[0]);
      return out(t.example);
    }
    case 'validate': {
      const { spec, specDir } = loadSpec(pos[0]);
      const p = await validate(spec, { specDir });
      if (p.length) { out({ valid: false, problems: p }); process.exitCode = 1; }
      else out({ valid: true });
      return;
    }
    case 'stills': {
      const { stills } = await import('../src/cli/render.js');
      const { spec, specPath, specDir } = loadSpec(pos[0]);
      const at = flags.at ? String(flags.at).split(',').map(Number) : undefined;
      const r = await stills(spec, { specPath, specDir, out: flags.out, at, samples: num(flags.samples), shutter: num(flags.shutter) });
      return out({ dir: r.dir, sheet: r.sheet, stills: r.items.length, layoutQA: r.layoutQA.checks.map((c) => `${c.status.toUpperCase().padEnd(7)} ${c.id}: ${c.detail}`), errors: r.errors });
    }
    case 'render': {
      const { render } = await import('../src/cli/render.js');
      const { spec, specPath, specDir } = loadSpec(pos[0]);
      const frames = flags.frames ? String(flags.frames).split(':').map(Number) : undefined;
      const r = await render(spec, {
        specPath, specDir, out: flags.out, samples: num(flags.samples), shutter: num(flags.shutter), workers: num(flags.workers),
        formats: flags.formats ? String(flags.formats).split(',') : undefined, crf: num(flags.crf), frames, draft: !!flags.draft,
      });
      out({ verdict: r.verdict, outputs: r.outputs.map((o) => o.file), timing: r.timing, determinism: r.determinism, receipt: path.join(path.dirname(r.outputs[0].file), 'receipt.json') });
      if (r.verdict.status === 'fail') process.exitCode = 2;
      return;
    }
    case 'html': {
      const { buildHtml } = await import('../src/cli/html.js');
      const { spec, specPath, specDir } = loadSpec(pos[0]);
      const file = await buildHtml(spec, { specPath, specDir, out: flags.out });
      return out({ file });
    }
    case 'preview': {
      const { preview } = await import('../src/cli/preview.js');
      const { specPath } = loadSpec(pos[0]);
      return preview(specPath, { port: num(flags.port), open: !flags['no-open'] });
    }
    case 'fonts': {
      const { ensureFont, registry } = await import('../src/cli/fonts.js');
      if (pos[0] === 'add') {
        const p = await ensureFont({ family: pos[1], weight: Number(pos[2] || 400), style: flags.italic ? 'italic' : 'normal' });
        return out({ installed: p });
      }
      return out(registry());
    }
    case 'audio': {
      const { analyzeAudio } = await import('../src/cli/audio.js');
      const r = await analyzeAudio(pos[1], { out: flags.out, clicks: !!flags.clicks });
      return out({ file: r.file, bpm: r.bpm, grid: r.grid, confidence: r.confidence, clicks: r.clicks, beats: r.beats.length, downbeats: r.downbeats.length, duration: r.duration, method: r.method });
    }
    case 'captions': {
      // talking-head / podcast video → kinetic captions of the speaker's own words
      const { captionsSpec } = await import('../src/cli/captions.js');
      const r = await captionsSpec(pos[0], { format: flags.format, out: flags.out, name: flags.name, render: !!flags.render, energy: flags.energy, look: flags.look, words: flags.words, heroes: flags.heroes ? String(flags.heroes).split(',').map(Number) : undefined });
      out({ spec: r.specPath, words: r.words, exposure: r.exposure, layout: r.layout, ...(r.receipt ? { verdict: r.receipt.verdict.status, video: r.receipt.outputs[0].file } : { next: `kinetype stills "${r.specPath}"  then  kinetype render "${r.specPath}"` }) });
      return;
    }
    case 'direct': {
      // talking-head video + transcript → a caption PLAN (hook, cold open, spike moments)
      const { direct } = await import('../src/cli/direct.js');
      const r = await direct(pos[0], { words: flags.words, format: flags.format, look: flags.look, energy: flags.energy, hookEnergy: flags['hook-energy'], hookLook: flags['hook-look'], momentEnergy: flags['moment-energy'], hook: num(flags.hook), moments: num(flags.moments), coldOpen: flags['cold-open'] === true ? 'auto' : flags['cold-open'], full: !!flags.full, plates: flags.plates, title: flags.title, brand: flags.brand, out: flags.out });
      return out(r);
    }
    case 'mine': {
      // one long episode → a series of shorts (hook, spikes, next-part teasers)
      const { mine } = await import('../src/cli/mine.js');
      const r = await mine(pos[0], { words: flags.words, count: num(flags.count), min: num(flags.min), max: num(flags.max), title: flags.title, look: flags.look, energy: flags.energy, brand: flags.brand, out: flags.out, render: !!flags.render, series: !flags['no-series'], plates: flags.plates });
      return out(r);
    }
    case 'cover': {
      // episode thumbnail: best frame + the key word giant behind the speaker, in the show's brand
      const { makeCover } = await import('../src/cli/cover.js');
      const r = await makeCover(pos[0], { words: flags.words, word: flags.word, title: flags.title, look: flags.look, energy: flags.energy, brand: flags.brand, format: flags.format, at: flags.at != null ? Number(flags.at) : undefined, textScale: flags['text-scale'] != null ? Number(flags['text-scale']) : undefined, out: flags.out });
      if (r.qa.status !== 'pass') process.exitCode = 2;
      return out(r);
    }
    case 'compose': {
      // plan → rendered windows spliced into the base video (or kinetype's own body)
      const { compose } = await import('../src/cli/compose.js');
      const r = await compose(pos[0], { base: flags.base, out: flags.out, prerender: !!flags.prerender, offset: flags.offset != null ? Number(flags.offset) : null, gradeMatch: !flags['no-grade-match'] });
      if (r.verdict !== 'pass') process.exitCode = 2;
      return out(r);
    }
    case 'stage': {
      // voice only → a finished caption video (no footage: typography is the picture)
      const { stage } = await import('../src/cli/stage.js');
      const avoid = typeof flags.avoid === 'string' ? flags.avoid.split(',').map((x) => x.trim()).filter(Boolean) : [];
      const r = await stage(pos[0], { words: flags.words, look: flags.look, avoid, energy: flags.energy, format: flags.format, title: flags.title, brand: flags.brand, coldOpen: flags['cold-open'] === true ? 'auto' : flags['cold-open'], out: flags.out, specOut: flags['spec-out'] });
      if (r.verdict && r.verdict !== 'pass') process.exitCode = 2;
      return out(r);
    }
    case 'relight': {
      // dark phone footage → a lit look with a clear subject (Vision matte + Core Image)
      const { relight } = await import('../src/cli/relight.js');
      const r = await relight(pos[0], { out: flags.out, strength: flags.strength != null ? Number(flags.strength) : undefined, onlyDark: !!flags['only-dark'] });
      return out({ output: r.output, changed: r.changed, reason: r.reason, analysis: r.analysis ? { faceLuma: r.analysis.faceLuma ?? null, sceneLuma: r.analysis.sceneLuma ?? null, faceShare: r.analysis.faceShare ?? null } : null, plan: r.plan, frames: r.frames, seconds: r.seconds, fps: r.fps });
    }
    case 'edit': {
      // real-video edit: pace report → sound design + mix → render
      const E = await import('../src/cli/edit.js');
      const { spec, specPath, specDir } = loadSpec(pos[0]);
      if (flags['pace-only']) { const r = await E.editPace(spec, { specDir, specPath, out: flags.out }); if (r.report.status === 'fail') process.exitCode = 2; return out({ pace: r.file, status: r.report.status, checks: r.report.checks }); }
      if (flags['sound-only']) { const r = await E.editSound(spec, { specDir, specPath, out: flags.out }); return out({ sound: r.file, final: r.report.final, stems: r.report.stems, duck: r.report.duck, cues: r.cues.length, warnings: r.report.warnings }); }
      const r = await E.edit(spec, { specDir, specPath, out: flags.out, draft: !!flags.draft, workers: num(flags.workers) });
      if (r.verdict.status === 'fail') process.exitCode = 2;
      return out({ video: r.outputs[0].file, verdict: r.verdict, pace: r.edit.pace, sound: r.edit.sound.final });
    }
    case 'capture': {
      const cap = await import('../src/capture/index.js');
      const fontDirs = typeof flags['font-dir'] === 'string' ? flags['font-dir'].split(',').filter(Boolean) : [];
      if (flags.validate) {
        const r = cap.validateCaptureFile(typeof flags.validate === 'string' ? flags.validate : pos[0]);
        out({ valid: r.problems.length === 0, file: r.file, problems: r.problems });
        if (r.problems.length) process.exitCode = 1;
        return;
      }
      if (flags.sheet) {
        const r = await cap.contactSheet(typeof flags.sheet === 'string' ? flags.sheet : pos[0], { fontDirs });
        return out(r);
      }
      if (!pos[0]) throw new Error('usage: kinetype capture <flow.json> --out DIR');
      if (flags.device === 'android' && JSON.parse(fs.readFileSync(pos[0], 'utf8')).device?.kind !== 'android') throw new Error('--device android needs a flow with device.kind "android" (C1 v2)');
      const r = await cap.captureFlow(pos[0], { out: flags.out, baseUrl: flags['base-url'], fontDirs, quality: num(flags.quality), crf: num(flags.crf), headed: !!flags.headed, transport: typeof flags.transport === 'string' ? flags.transport : undefined, serial: typeof flags.serial === 'string' ? flags.serial : undefined, log: flags.verbose ? (m) => console.error(m) : undefined });
      return out(r);
    }
    case 'device-diag': {
      const { deviceDiag } = await import('../src/device/diag.js');
      const r = await deviceDiag({ serial: typeof flags.serial === 'string' ? flags.serial : undefined, baseUrl: flags['base-url'], out: flags.out, transport: typeof flags.transport === 'string' ? flags.transport : 'adb', browser: typeof flags.browser === 'string' ? flags.browser : 'chrome', log: (m) => console.error(m) });
      if (!r.pass) process.exitCode = 1;
      return out(r);
    }
    case 'device-wait': {
      const { waitForDeviceReady } = await import('../src/device/adb.js');
      const serial = typeof flags.serial === 'string' ? flags.serial : undefined;
      if (!serial) throw new Error('usage: kinetype device-wait --serial S [--timeout 300]');
      return out(await waitForDeviceReady(serial, { timeoutMs: (num(flags.timeout) ?? 300) * 1000, log: (m) => console.error(m) }));
    }
    case 'device-locale': {
      const { deviceLocale } = await import('../src/device/locale.js');
      const r = await deviceLocale({ serial: typeof flags.serial === 'string' ? flags.serial : undefined, locale: typeof flags.locale === 'string' ? flags.locale : 'nb-NO', out: flags.out, log: (m) => console.error(m) });
      if (!r.ok) process.exitCode = 1;
      return out(r);
    }
    case 'device-stage': {
      const { deviceStage } = await import('../src/device/stage.js');
      const r = await deviceStage({ serial: typeof flags.serial === 'string' ? flags.serial : undefined, baseUrl: flags['base-url'], browser: typeof flags.browser === 'string' ? flags.browser : 'chrome', transport: typeof flags.transport === 'string' ? flags.transport : 'adb', undo: !!flags.undo, out: flags.out, log: (m) => console.error(m) });
      if (r.clean === false) process.exitCode = 1;
      return out(r);
    }
    case 'rehearse':
    case 'perform': {
      // native device capture: src/device
      const dev = await import('../src/device/index.js');
      if (!pos[0]) throw new Error(`usage: kinetype ${cmd} <flow.json|session.json> [--transport adb|cdp-touch] [--serial S]`);
      const isSession = JSON.parse(fs.readFileSync(pos[0], 'utf8')).schema === 'kinetype.session.v1';
      const o = { out: flags.out, baseUrl: flags['base-url'], transport: typeof flags.transport === 'string' ? flags.transport : undefined, serial: typeof flags.serial === 'string' ? flags.serial : undefined, reset: typeof flags.reset === 'string' ? flags.reset : undefined, log: (m) => console.error(m) };
      let r;
      if (isSession) r = await dev.performSession(pos[0], { ...o, rehearseOnly: cmd === 'rehearse' });
      else if (cmd === 'rehearse') r = await dev.rehearseFlow(pos[0], o);
      else r = await dev.performFlow(pos[0], { ...o, rehearsalFile: typeof flags.rehearsal === 'string' ? flags.rehearsal : undefined });
      if (cmd === 'rehearse' && !isSession) {
        for (const s of r.steps) console.error(`  ${s.id.padEnd(22)} ${s.action.padEnd(9)} ${String(s.seconds).padStart(7)} s${s.settle !== undefined ? `  settle ${s.settle} s` : ''}${s.typing ? `  typing ${s.typing} s` : ''}`);
        if (!r.pass) process.exitCode = 1;
      }
      if (isSession) delete r.results;
      return out(r);
    }
    case 'explore': {
      if (flags.help || pos[0] === 'help') { const L = HELP.split('\n'); const k = L.findIndex((x) => x.startsWith('  kinetype explore')); let e = k + 1; while (e < L.length && !L[e].startsWith('  kinetype ')) e++; return out(L.slice(k, e).join('\n')); }
      const { explore } = await import('../src/explore/index.js');
      const fontDirs = typeof flags['font-dir'] === 'string' ? flags['font-dir'].split(',').filter(Boolean) : [];
      const r = await explore({ url: pos[0], goal: typeof flags.goal === 'string' ? flags.goal : undefined, seconds: num(flags.seconds) ?? 45, device: typeof flags.device === 'string' ? flags.device : 'desktop', out: flags.out, baseUrl: flags['base-url'], fontDirs, log: (m) => console.error(m) });
      return out(r);
    }
    case 'transcribe': {
      // speech → word-timed transcript for kinetic-captions (content.wordsSrc)
      const { transcribeWords } = await import('../src/cli/lyrics.js');
      const words = transcribeWords(path.resolve(pos[0])).map((w) => ({ text: w.text, start: +w.start.toFixed(3), end: +w.end.toFixed(3) }));
      const dest = path.resolve(flags.out || pos[0].replace(/\.[^.]+$/, '') + '.words.json');
      fs.writeFileSync(dest, JSON.stringify(words, null, 1));
      return out({ file: dest, words: words.length, duration: words.length ? words[words.length - 1].end : 0 });
    }
    case 'lyrics': {
      const { buildLyrics } = await import('../src/cli/lyrics.js');
      const r = await buildLyrics(pos[0], { audio: flags.audio, out: flags.out, offset: num(flags.offset) });
      return out(r.summary);
    }
    case 'check': {
      const { check } = await import('../src/cli/check.js');
      const r = await check({ only: pos[0] });
      out({ ok: r.ok, env: r.env, failures: r.results.filter((x) => !x.ok) });
      if (!r.ok) process.exitCode = 1;
      return;
    }
    case 'ambient': {
      const { ambientCommand } = await import('../src/ambient/cli.js');
      return ambientCommand(pos, flags, out);
    }
    default:
      out(HELP);
      if (cmd && cmd !== 'help' && cmd !== '--help') process.exitCode = 1;
  }
}
main().catch((e) => {
  console.error(e.stack || String(e));
  process.exitCode = e?.exitCode || 1;
});
