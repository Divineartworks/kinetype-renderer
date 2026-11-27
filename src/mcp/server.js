#!/usr/bin/env node
// kinetype MCP server (stdio). The same verbs as the CLI, for any agent.
// Nothing here writes to stdout except the protocol; logs go to stderr.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadAll, loadTemplate } from '../../templates/index.js';
import { validate, BASE_SCHEMA } from '../cli/spec.js';
import { ROOT } from '../cli/server.js';

const log = (...a) => console.error('[kinetype-mcp]', ...a);
const text = (o) => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o, null, 2) }] });
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: String(e?.message || e) }] });

const specInput = {
  spec: z.record(z.string(), z.any()).optional().describe('The spec object (see describe_template for its schema and an example)'),
  spec_path: z.string().optional().describe('Or: absolute path to a spec JSON file'),
  base_dir: z.string().optional().describe('Directory relative paths in the spec (audio, lyricsSrc, font files) resolve against; defaults to the spec file dir or the server cwd'),
  out_dir: z.string().optional().describe('Output directory (default: <kinetype>/out/<name>)'),
};
function getSpec({ spec, spec_path, base_dir }) {
  if (spec_path) {
    const p = path.resolve(spec_path);
    return { spec: JSON.parse(fs.readFileSync(p, 'utf8')), specPath: p, specDir: base_dir ? path.resolve(base_dir) : path.dirname(p) };
  }
  if (!spec) throw new Error('give either spec or spec_path');
  return { spec, specPath: null, specDir: path.resolve(base_dir || process.cwd()) };
}

const server = new McpServer({ name: 'kinetype', version: '0.1.0' }, {
  instructions: 'Deterministic kinetic-typography video engine. Workflow: list_templates → describe_template(id) → write a spec (start from its example; change content/palette/fonts/format) → validate_spec → render_stills (LOOK at the returned contact sheet; fix copy/format if anything is cramped) → render_video (check verdict in the receipt). Specs are JSON; all copy lives in spec.content. Formats: square, landscape, vertical, portrait, landscape-4k or {width,height,fps}. Fonts: any Google Font family/weight by name.',
});

server.registerTool('list_templates', {
  title: 'List templates',
  description: 'All kinetype templates with id, description, tags, formats, default duration/bpm, loopability.',
  inputSchema: {},
}, async () => {
  const { templates, broken } = await loadAll();
  return text({ templates: templates.map((t) => ({ id: t.id, name: t.name, description: t.description, tags: t.tags, formats: t.formats, duration: t.duration, bpm: t.bpm, loop: !!t.loop })), broken });
});

server.registerTool('describe_template', {
  title: 'Describe a template',
  description: 'Content/params JSON schema, palette tokens and roles, font roles, notes, and a complete valid example spec to start from.',
  inputSchema: { id: z.string(), include_base_schema: z.boolean().optional().describe('Also return the shared spec schema (format/audio/media/background/render/rules). Off by default: it is large and identical for every template.') },
}, async ({ id, include_base_schema }) => {
  try {
    const t = await loadTemplate(id);
    return text({ id: t.id, name: t.name, description: t.description, tags: t.tags, formats: t.formats, duration: t.duration, bpm: t.bpm, palette: t.palette, paletteRoles: t.paletteRoles, fonts: t.fonts, params: t.params, schema: t.schema, notes: t.notes, example: t.example, ...(include_base_schema ? { specSchema: BASE_SCHEMA } : {}) });
  } catch (e) { return fail(e); }
});

server.registerTool('validate_spec', {
  title: 'Validate a spec',
  description: 'Check a spec against the base schema and its template schema. Returns {valid, problems[]}.',
  inputSchema: { spec: specInput.spec, spec_path: specInput.spec_path, base_dir: specInput.base_dir },
}, async (a) => {
  try {
    const { spec, specDir } = getSpec(a);
    const problems = await validate(spec, { specDir });
    return text({ valid: !problems.length, problems });
  } catch (e) { return fail(e); }
});

server.registerTool('render_stills', {
  title: 'Render pre-pass stills',
  description: 'Render the template\'s keyframes (or given times) with motion blur, plus a labelled contact sheet and layout QA. Returns the contact sheet IMAGE so you can judge the design before a full render.',
  inputSchema: { ...specInput, at: z.array(z.number()).optional().describe('Specific times (s) instead of the template keyframes') },
}, async (a) => {
  try {
    const { stills } = await import('../cli/render.js');
    const { spec, specPath, specDir } = getSpec(a);
    const r = await stills(spec, { specPath, specDir, out: a.out_dir, at: a.at, log });
    const png = fs.readFileSync(r.sheet).toString('base64');
    return {
      content: [
        { type: 'text', text: JSON.stringify({ dir: r.sdir, sheet: r.sheet, stills: r.items, layoutQA: r.layoutQA.checks, errors: r.errors }, null, 2) },
        { type: 'image', data: png, mimeType: 'image/png' },
      ],
    };
  } catch (e) { return fail(e); }
});

server.registerTool('render_video', {
  title: 'Render video',
  description: 'Full frame-exact render (parallel headless Chrome → ffmpeg). Writes the media plus receipt.json (QA verdict, per-frame hashes, determinism probe, font hashes). Returns the verdict and output paths.',
  inputSchema: {
    ...specInput,
    formats: z.array(z.enum(['mp4', 'prores', 'webm', 'mov-alpha'])).optional(),
    samples: z.number().int().min(1).max(64).optional().describe('motion-blur sub-frames (default 4)'),
    workers: z.number().int().min(1).max(16).optional(),
    draft: z.boolean().optional().describe('fast iteration render: half size, 1 blur sample, ultrafast x264, no pixel QA; written to <out>/draft/ and marked draft:true in the receipt'),
  },
}, async (a, extra) => {
  try {
    const { render } = await import('../cli/render.js');
    const { spec, specPath, specDir } = getSpec(a);
    const token = extra?._meta?.progressToken;
    const onProgress = token === undefined ? undefined : (progress, total) =>
      extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress, total, message: `frame ${progress}/${total}` } }).catch(() => {});
    const r = await render(spec, { specPath, specDir, out: a.out_dir, formats: a.formats, samples: a.samples, workers: a.workers, draft: a.draft, log, onProgress });
    return text({ verdict: r.verdict, outputs: r.outputs.map((o) => ({ file: o.file, format: o.format, bytes: o.bytes })), timing: r.timing, determinism: r.determinism, receipt: path.join(path.dirname(r.outputs[0].file), 'receipt.json') });
  } catch (e) { return fail(e); }
});

server.registerTool('build_html', {
  title: 'Build single-file HTML',
  description: 'One self-contained HTML (engine, template, fonts, spec, optional audio) with a player and window.seek(t). Good for sharing a live, scrubbable composition.',
  inputSchema: specInput,
}, async (a) => {
  try {
    const { buildHtml } = await import('../cli/html.js');
    const { spec, specPath, specDir } = getSpec(a);
    return text({ file: await buildHtml(spec, { specPath, specDir, out: a.out_dir && path.join(a.out_dir, (spec.name || spec.template) + '.html') }) });
  } catch (e) { return fail(e); }
});

server.registerTool('analyze_audio', {
  title: 'Analyze audio',
  description: 'Tempo, beat grid, downbeats, onsets and a 0..1 energy envelope → JSON usable as spec.audio.analysis.',
  inputSchema: { file: z.string().describe('absolute path to an audio file'), out: z.string().optional() },
}, async ({ file, out }) => {
  try {
    const { analyzeAudio } = await import('../cli/audio.js');
    const r = await analyzeAudio(file, { out });
    return text({ file: r.file, bpm: r.bpm, grid: r.grid, beats: r.beats.length, downbeats: r.downbeats.length, duration: r.duration, method: r.method });
  } catch (e) { return fail(e); }
});

server.registerTool('build_lyrics', {
  title: 'Build word-timed lyrics',
  description: 'From .lrc/.srt/.json (timed) or plain .txt + audio (force-aligned with whisper.cpp) → word-timed lyrics JSON for lyric templates (content.lyricsSrc).',
  inputSchema: { input: z.string(), audio: z.string().optional(), out: z.string().optional(), offset: z.number().optional() },
}, async ({ input, audio, out, offset }) => {
  try {
    const { buildLyrics } = await import('../cli/lyrics.js');
    return text((await buildLyrics(input, { audio, out, offset })).summary);
  } catch (e) { return fail(e); }
});

server.registerTool('caption_video', {
  title: 'Kinetic captions for a talking-head / podcast video',
  description: 'One call: a video (+ optional word-timed transcript) → the speaker\'s own words as kinetic typography burned in, replacing plain subtitles. energy: calm (premium subtitles) | signature (default: clean captions + a hero moment every ~9 s — giant word behind the head, camera punch-in, flash) | wild (poster/music-video). Without words it transcribes with whisper.cpp. Writes a spec you can refine (content.heroes, overlays) and, with render:true, the mp4 + receipt.',
  inputSchema: {
    video: z.string().describe('absolute path to the source video'),
    words: z.string().optional().describe('transcript JSON: [{text,start,end}], {words:[…]} (kinetype-transcript/v2) or {segments:[{words}]}'),
    look: z.enum(['cover', 'neon', 'noir', 'poster', 'terminal', 'swiss', 'riso', 'cinema', 'marker']).optional().describe('the visual identity (default cover). cover = magazine cover gold; neon = neon tubes + sign lighting the speaker; noir = serif editorial, pull quotes; poster = street posters; terminal = mono/decrypt/ASCII; swiss = grid/red/numbers; riso = two-ink zine; cinema = letterbox film subtitles + title card; marker = handwritten marker, circles/arrows drawn on'),
    energy: z.enum(['calm', 'signature', 'wild']).optional(),
    format: z.enum(['vertical', 'landscape']).optional().describe('default: the source orientation; vertical footage → landscape uses a split layout'),
    heroes: z.array(z.number()).optional().describe('times (s) whose spoken word must go giant'),
    out_dir: z.string().optional(),
    render: z.boolean().optional().describe('render the mp4 now (default false: spec + stills-ready)'),
  },
}, async (a, extra) => {
  try {
    const { captionsSpec } = await import('../cli/captions.js');
    const token = extra?._meta?.progressToken;
    const onProgress = token === undefined ? undefined : (progress, total) =>
      extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress, total, message: `frame ${progress}/${total}` } }).catch(() => {});
    const r = await captionsSpec(a.video, { words: a.words, look: a.look, energy: a.energy, format: a.format, heroes: a.heroes, out: a.out_dir, render: !!a.render, onProgress, log });
    const rc = r.receipt;
    return text({ spec: r.specPath, dir: r.dir, words: r.words, layout: r.layout, look: r.look, energy: r.energy, exposure: r.exposure, ...(rc ? { verdict: rc.verdict, outputs: rc.outputs.map((o) => o.file) } : { next: 'render_stills with spec_path to review, then render_video' }) });
  } catch (e) { return fail(e); }
});

const LOOKS = ['cover', 'neon', 'noir', 'poster', 'terminal', 'swiss', 'riso', 'cinema', 'marker'];
server.registerTool('direct_captions', {
  title: 'Plan where kinetic captions take over (hook, cold open, spike moments)',
  description: 'The director. A talking-head/podcast video + transcript → an editable PLAN: a hook (the opening seconds, cut on a measured silence), a cold open (the most quotable line of the episode — title drops win — replayed before the start) and N spike moments on the strongest lines, each with its hero words and reasons. Everything else stays with the normal caption system. look "auto" picks the look from the transcript\'s tone. Returns windows, the cold open and captionGaps (ranges where the normal captions must be off). Then call compose_captions.',
  inputSchema: {
    video: z.string().describe('absolute path to the clean (captionless) source video'),
    words: z.string().optional().describe('transcript JSON ([{text,start,end}] | {words} | {segments:[{words}]}); omitted = transcribe'),
    look: z.enum([...LOOKS, 'auto']).optional().describe('look for moments + cold open (and the hook by default); default auto'),
    hook_look: z.enum(LOOKS).optional(),
    energy: z.enum(['calm', 'signature', 'wild']).optional().describe('hook + cold-open energy (default wild)'),
    hook_energy: z.enum(['calm', 'signature', 'wild']).optional(),
    moment_energy: z.enum(['calm', 'signature', 'wild']).optional().describe('default signature'),
    hook: z.number().min(0).max(30).optional().describe('hook length target in seconds (0 = none, default 7)'),
    moments: z.number().int().min(0).max(12).optional().describe('spike moments (default 3)'),
    cold_open: z.string().optional().describe('auto (default) | none | "t0-t1" to force a line'),
    full: z.boolean().optional().describe('one window over the whole episode (fully kinetic)'),
    plates: z.enum(['auto']).optional().describe('reactive backgrounds: hero words that name a world (fire, storm, rain, shatter, money, time…) get an animated plate behind the speaker'),
    title: z.string().optional().describe('episode title — lines that say it make the best cold opens'),
    brand: z.string().optional().describe('brand JSON {palette:{bg,ink,a,b,shade}, fonts:{role:{family,weight}}}'),
    out: z.string().optional().describe('plan.json path'),
  },
}, async (a) => {
  try {
    const { direct } = await import('../cli/direct.js');
    return text(await direct(a.video, { words: a.words, look: a.look, hookLook: a.hook_look, energy: a.energy, hookEnergy: a.hook_energy, momentEnergy: a.moment_energy, hook: a.hook, moments: a.moments, coldOpen: a.cold_open, full: a.full, plates: a.plates, title: a.title, brand: a.brand, out: a.out, log }));
  } catch (e) { return fail(e); }
});
server.registerTool('make_cover', {
  title: 'Episode cover / thumbnail',
  description: 'The speaker\'s best frame (Apple Vision capture quality, eyes open, eye contact, sharp, well framed — scored over ~40 samples) with the episode\'s key word set giant BEHIND his head (person matte) in a kinetype look and the show\'s brand, plus the title (or his strongest short line with that word) in front. Same system on every episode → a recognisable profile grid. Returns the JPG/PNG, the chosen frame + reasons, the word + why.',
  inputSchema: {
    video: z.string().describe('absolute path to the clean source video'),
    words: z.string().optional().describe('transcript JSON (for the key word, line and look)'),
    title: z.string().optional().describe('episode title — its strongest word becomes the masthead'),
    word: z.string().optional().describe('force the masthead word'),
    look: z.string().optional().describe('kinetype look (default: from the transcript\'s tone)'),
    brand: z.string().optional().describe('brand JSON {palette:{a,…}, fonts}'),
    format: z.enum(['vertical', 'landscape', 'square']).optional(),
    at: z.number().optional().describe('force the frame time (s)'),
    out: z.string().optional().describe('output .jpg path (a .png is written next to it)'),
  },
}, async (a) => {
  try {
    const { makeCover } = await import('../cli/cover.js');
    return text(await makeCover(a.video, { ...a, log }));
  } catch (e) { return fail(e); }
});
server.registerTool('compose_captions', {
  title: 'Render a caption plan and splice it into the base video',
  description: 'Renders the plan\'s kinetic windows + cold open from the clean source and splices them into `base` (the video with the normal captions, gapped at captionGaps): auto time-alignment, colour-grade match (3D LUT), alpha crossfades inside the speaker\'s pauses, cold open with a dip and audio from the base mix. Verifies untouched frames equal the base and writes a receipt + review sheet (look at it). Without base, kinetype renders the body itself in the plan\'s look at calm energy. prerender:true only renders and caches the windows.',
  inputSchema: {
    plan: z.string().describe('plan.json from direct_captions'),
    base: z.string().optional().describe('the body video (normal captions) to splice into'),
    out: z.string().optional(),
    prerender: z.boolean().optional(),
  },
}, async (a, extra) => {
  try {
    const { compose } = await import('../cli/compose.js');
    const token = extra?._meta?.progressToken;
    const onProgress = token === undefined ? undefined : (progress, total) =>
      extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress, total, message: `frame ${progress}/${total}` } }).catch(() => {});
    return text(await compose(a.plan, { base: a.base, out: a.out, prerender: !!a.prerender, onProgress, log }));
  } catch (e) { return fail(e); }
});

server.registerTool('mine_shorts', {
  title: 'Mine a long episode into a series of shorts',
  description: 'Finds the best stand-alone 25–60 s shorts in an episode: each opens on a line strong enough to be a hook (a real sentence start, no filler) and ends on a payoff at a real break; picks the best non-overlapping set (fewer rather than weak ones). With render:true each short is produced with its own kinetic hook + spikes (one look for the whole series) and ends on a 2.5 s "Part n" teaser of the next short\'s strongest line. Punctuated transcripts (e.g. Scribe) give the best picks.',
  inputSchema: {
    video: z.string(), words: z.string().describe('word-timed transcript JSON'),
    count: z.number().int().min(1).max(12).optional(), min: z.number().optional(), max: z.number().optional(),
    title: z.string().optional(), look: z.string().optional(), brand: z.string().optional(),
    render: z.boolean().optional(), series: z.boolean().optional().describe('append next-part teasers (default true)'), out: z.string().optional(),
  },
}, async (a, extra) => {
  try {
    const { mine } = await import('../cli/mine.js');
    return text(await mine(a.video, { ...a, log }));
  } catch (e) { return fail(e); }
});

server.registerTool('relight_video', {
  title: 'Studio relight (dark phone footage → lit subject)',
  description: 'A soft key light on the speaker, the room falls off a little, skin cast corrected — adaptive and constant per video (bright footage is left nearly unchanged; no person = exact copy). Apple Vision matte + Core Image, audio copied, colour encoding kept.',
  inputSchema: { video: z.string(), out: z.string().optional(), strength: z.number().min(0).max(1).optional(), only_dark: z.boolean().optional().describe('leave a face already at a healthy mid-tone (luma ≥ 0.42) untouched: exact copy, no re-encode') },
}, async (a, extra) => {
  try {
    const { relight } = await import('../cli/relight.js');
    const token = extra?._meta?.progressToken;
    const onProgress = token === undefined ? undefined : (progress, total) =>
      extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress, total, message: `frame ${progress}/${total}` } }).catch(() => {});
    const r = await relight(a.video, { out: a.out, strength: a.strength, onlyDark: !!a.only_dark, onProgress, log });
    return text({ output: r.output, changed: r.changed, reason: r.reason, plan: r.plan, frames: r.frames, seconds: r.seconds, fps: r.fps });
  } catch (e) { return fail(e); }
});

server.registerTool('voice_stage', {
  title: 'Voice recording → caption video (the type is the picture)',
  description: 'For a voice recording with no footage (voice notes, podcast audio). Renders a finished vertical caption video: one phrase at a time, big and centred, landing as spoken; scenes every ~15–25 s at the speaker\'s pauses move the type and change the ambient world; hero words take the whole screen with a reactive world behind them; the voice\'s loudness pulses the type; on recordings over a minute the director\'s best complete line plays first as a cold open. look auto picks by tone (pass avoid = the looks of the last few videos so a feed never repeats); energy auto goes wild for rants. Writes <out>.receipt.json (look + why, energy + why, cold open, clockOffset = seconds the cold open adds before the body). spec_out only plans (writes the body spec, no render) — preview it with stills.',
  inputSchema: {
    audio: z.string().describe('the voice recording (audio or video file)'),
    words: z.string().optional().describe('word-timed transcript JSON (else whisper transcribes)'),
    look: z.string().optional().describe('auto (default) or a look id'),
    avoid: z.array(z.string()).optional().describe('look ids used recently — auto skips them'),
    energy: z.enum(['auto', 'calm', 'signature', 'wild']).optional(),
    format: z.enum(['vertical', 'square', 'landscape']).optional(),
    title: z.string().optional(), brand: z.string().optional().describe('brand.json (palette/fonts)'),
    cold_open: z.enum(['auto', 'none']).optional(),
    out: z.string().optional(), spec_out: z.string().optional(),
  },
}, async (a, extra) => {
  try {
    const { stage } = await import('../cli/stage.js');
    const token = extra?._meta?.progressToken;
    const onProgress = token === undefined ? undefined : (progress, total) =>
      extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress, total, message: `frame ${progress}/${total}` } }).catch(() => {});
    return text(await stage(a.audio, { words: a.words, look: a.look, avoid: a.avoid, energy: a.energy, format: a.format, title: a.title, brand: a.brand, coldOpen: a.cold_open, out: a.out, specOut: a.spec_out, onProgress, log }));
  } catch (e) { return fail(e); }
});

server.registerTool('capture_flow', {
  title: 'Record a live app flow (frame-exact product-UI capture)',
  description: 'Runs a kinetype.flow.v1 flow (goto/click/type/fill/press/hover/scroll/wait/waitFor/mark steps, real UI labels as role+name targets) against a LIVE app in headless Chrome and records it frame-exactly at a constant fps, independent of host load. Writes <out>/capture.json (kinetype.capture.v1: events with CSS-px points/boxes, marks, per-step [t0,t1]), frames/, capture.mp4 and receipt.json (frame hashes, qa.droppedFrames). The OS cursor is never in the frames: the ui-demo template draws a synthetic one from the events. Only point it at an isolated demo instance, never production. With validate_path it only validates an existing capture.json; with sheet_dir it writes a labelled contact sheet of every step (LOOK at it).',
  inputSchema: {
    flow_path: z.string().optional().describe('absolute path to the flow JSON'),
    flow: z.record(z.string(), z.any()).optional().describe('or the flow object itself'),
    out_dir: z.string().optional(),
    base_url: z.string().optional().describe('override app.baseUrl (e.g. the port of the demo instance)'),
    font_dirs: z.array(z.string()).optional().describe('extra font directories (the app\'s own fonts, e.g. Inter + an emoji font)'),
    quality: z.number().optional().describe('JPEG quality of frames, default 94'),
    validate_path: z.string().optional().describe('validate this capture.json against kinetype.capture.v1 and stop'),
    sheet_dir: z.string().optional().describe('write <dir>/contact-sheet.png for this capture dir and stop'),
  },
}, async (a) => {
  try {
    const cap = await import('../capture/index.js');
    if (a.validate_path) { const r = cap.validateCaptureFile(a.validate_path); return text({ valid: r.problems.length === 0, problems: r.problems }); }
    if (a.sheet_dir) return text(await cap.contactSheet(a.sheet_dir, { fontDirs: a.font_dirs || [] }));
    let flowPath = a.flow_path;
    if (!flowPath) {
      if (!a.flow) throw new Error('give flow_path or flow');
      flowPath = path.join(fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'kt-flow-')), 'flow.json');
      fs.writeFileSync(flowPath, JSON.stringify(a.flow));
    }
    return text(await cap.captureFlow(flowPath, { out: a.out_dir, baseUrl: a.base_url, fontDirs: a.font_dirs || [], quality: a.quality, log }));
  } catch (e) { return fail(e); }
});

const deviceArgs = {
  path: z.string().describe('absolute path to a kinetype.flow.v1 (device.kind "android") or kinetype.session.v1 file'),
  transport: z.enum(['adb', 'cdp-touch', 'cdp-desktop']).optional().describe('override device.target.transport (cdp-touch = the headless stand-in)'),
  serial: z.string().optional().describe('adb serial, e.g. emulator-5554'),
  base_url: z.string().optional().describe('override app.baseUrl (an emulator reaches the host as http://10.0.2.2:PORT)'),
  out_dir: z.string().optional(),
};
const deviceRun = (mode) => async (a) => {
  try {
    const dev = await import('../device/index.js');
    const o = { out: a.out_dir, baseUrl: a.base_url, transport: a.transport, serial: a.serial, log };
    const isSession = JSON.parse(fs.readFileSync(a.path, 'utf8')).schema === 'kinetype.session.v1';
    if (isSession) { const r = await dev.performSession(a.path, { ...o, rehearseOnly: mode === 'rehearse' }); delete r.results; return text(r); }
    return text(mode === 'rehearse' ? await dev.rehearseFlow(a.path, o) : await dev.performFlow(a.path, { ...o, rehearsalFile: a.rehearsal_path }));
  } catch (e) { return fail(e); }
};
server.registerTool('device_rehearse', {
  title: 'Rehearse a device flow (no recording)',
  description: 'Runs a kinetype.flow.v1 flow with device.kind "android" (or a kinetype.session.v1 of 2–3 devices) on a real Android device via adb (CDP for targets, scrcpy for OS-level touch) or the headless stand-in, WITHOUT recording: asserts every target resolves to exactly one visible, unobstructed element, every mark/sync is reached, the CSS→video mapping error is ≤ 1 px; returns per-step timings, fling gain and pace warnings (rehearsal.json). A flow that fails rehearsal is never performed. HOLD: fixtures only until LEAD_NOTES says RECORDING_UNLOCKED.',
  inputSchema: deviceArgs,
}, deviceRun('rehearse'));
server.registerTool('device_perform', {
  title: 'Perform + natively record a device flow (demo-artist tempo)',
  description: 'Rehearses (unless a passing rehearsal of the same flow bytes on the same device exists), then records the device natively while a seeded choreographer drives OS-level input at a human "demo-artist" tempo. Writes capture.mp4 (constant 60 fps, native resolution), capture.json (kinetype.capture.v1 with clock "wall": events in CSS px AND video px vbox/vpoint + mapping, marks, steps, idle/busy ranges, sessionOffset), receipt.json (hashes, calibration, input jitter, recording stats, mapping/latency QA on the calibration fixture) and contact-sheet.png (LOOK at it). Sessions record every device on one host clock. HOLD: fixtures only until RECORDING_UNLOCKED.',
  inputSchema: { ...deviceArgs, rehearsal_path: z.string().optional().describe('a passing rehearsal.json to reuse') },
}, deviceRun('perform'));
server.registerTool('device_capture', {
  title: 'Capture a flow on a real device (rehearse → perform)',
  description: 'Same as device_perform for a single flow file: the capture verb for device.kind "android" flows (kinetype capture flow.json --device android).',
  inputSchema: deviceArgs,
}, deviceRun('perform'));

server.registerTool('explore_flow', {
  title: 'Explore a live app and write a grounded flow + narration (front door of capture)',
  description: 'An agent uses a LIVE app (same origin only; it never types, submits, sends or deletes; one-click demo/role buttons the page offers are allowed), looking at each screen before it narrates it: act → look → narrate. Writes <out_dir>/flow.json (kinetype.flow.v1, validated), narration.json (director.narration.v1, lines anchored to flow mark ids) and explore.log.json (every snapshot hash, prompt, reply, action, timing; secrets redacted). Claim guard: every number, price, name and superlative in the narration must appear on a visited screen (English + Norwegian number words), else nothing is written. The flow is replayed from a cold start (dry, no frames) and must resolve every step. Uses the claude CLI subscription (CLAUDE_BIN). Does not render: run capture_flow on the result. Point it at a demo instance, never production.',
  inputSchema: {
    url: z.string().describe('start URL of the app'),
    goal: z.string().describe('what the film should show, e.g. "45 second tour for a contractor: quote to invoice"'),
    out_dir: z.string(),
    seconds: z.number().optional().describe('narration length target, default 45'),
    device: z.enum(['desktop', 'phone']).optional(),
    base_url: z.string().optional().describe('run against this origin instead (the url path is kept), e.g. the port of the demo instance'),
    font_dirs: z.array(z.string()).optional(),
  },
}, async (a) => {
  try {
    const { explore } = await import('../explore/index.js');
    return text(await explore({ url: a.url, goal: a.goal, out: a.out_dir, seconds: a.seconds ?? 45, device: a.device ?? 'desktop', baseUrl: a.base_url, fontDirs: a.font_dirs || [], log }));
  } catch (e) { return fail(e); }
});

await server.connect(new StdioServerTransport());
log(`ready (root ${ROOT})`);
