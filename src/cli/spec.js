// Spec loading, validation and resolution (template defaults, fonts, audio).
import fs from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import { loadTemplate, templateUrl } from '../../templates/index.js';
import { ensureFont, sha256 } from './fonts.js';
import { ROOT } from './server.js';
import { resolveMedia } from './media.js';
import { merge } from '../kit/engine.js';
import { resolveFormat } from '../kit/layout.js';

const HEX = { type: 'string', pattern: '^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$' };
export const BASE_SCHEMA = {
  type: 'object',
  required: ['template'],
  additionalProperties: false,
  properties: {
    $schema: { type: 'string' },
    template: { type: 'string', description: 'Template id (kinetype templates)' },
    name: { type: 'string', description: 'Output name (defaults to spec filename)' },
    format: {
      description: 'Preset name (square, landscape, vertical, portrait, landscape-4k) or {width,height,fps}',
      oneOf: [{ type: 'string' }, { type: 'object', properties: { width: { type: 'integer', minimum: 64, maximum: 7680 }, height: { type: 'integer', minimum: 64, maximum: 7680 }, fps: { type: 'number', minimum: 1, maximum: 240 }, name: { type: 'string' } }, additionalProperties: false }],
    },
    fps: { type: 'number', minimum: 1, maximum: 240 },
    duration: { type: 'number', minimum: 0.25, maximum: 3600 },
    loop: { type: 'boolean' },
    seed: { type: ['integer', 'string'] },
    bpm: { type: 'number', minimum: 20, maximum: 400 },
    beatOffset: { type: 'number' },
    beatsPerBar: { type: 'integer', minimum: 1, maximum: 16 },
    palette: { type: 'object', additionalProperties: HEX },
    fonts: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: { family: { type: 'string' }, weight: { type: 'integer' }, style: { enum: ['normal', 'italic'] }, file: { type: 'string' } },
        additionalProperties: false,
      },
    },
    content: { type: 'object' },
    params: { type: 'object' },
    audio: {
      type: 'object',
      properties: {
        src: { type: 'string', description: 'Audio file to mux (path relative to the spec)' },
        start: { type: 'number', description: 'Seconds into the audio file where the video starts' },
        analysis: { type: 'string', description: 'JSON from `kinetype audio analyze` (beats, downbeats, energy)' },
        gain: { type: 'number' },
      },
      additionalProperties: false,
    },
    sound: { type: 'object', description: '`kinetype edit`: {voice: {src, offset, gainDb}, music: {src, gainDb, licence}, sfx, sfxLufs, duckDb, marks} — mixed into the render audio' },
    render: {
      type: 'object',
      properties: {
        samples: { type: 'integer', minimum: 1, maximum: 64, description: 'Motion-blur sub-frames per frame' },
        shutter: { type: 'number', minimum: 0, maximum: 1, description: 'Fraction of the frame interval the shutter is open' },
        formats: { type: 'array', items: { enum: ['mp4', 'prores', 'webm', 'mov-alpha'] } },
        crf: { type: 'integer', minimum: 0, maximum: 51 },
        preset: { enum: ['ultrafast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower'], description: 'x264 preset for mp4 (default slow; fast/medium for drafts)' },
        transparent: { type: 'boolean' },
        workers: { type: 'integer', minimum: 1, maximum: 32 },
        scale: { type: 'number', minimum: 0.1, maximum: 4 },
      },
      additionalProperties: false,
    },
    rules: { type: 'object', description: 'QA rules, e.g. {"beatCoverage":{"dense":16,"then":2}, "loopExact":true}' },
    media: {
      type: 'object',
      description: 'Footage and images by id: {"clip": {"src": "shot.mp4", "start": 12.5}}. Templates read them via ctx.media; spec.background can put any template over one.',
      additionalProperties: {
        type: 'object', additionalProperties: false,
        anyOf: [{ required: ['src'] }, { required: ['capture'] }],
        properties: { src: { type: 'string' },
          capture: { type: 'string', description: 'A kinetype.capture.v1 capture.json (recorded product UI + events) — used by the ui-demo template' },
          start: { type: 'number', minimum: 0 }, speed: { type: 'number', exclusiveMinimum: 0 }, loop: { type: 'boolean' }, duration: { type: 'number' },
          matte: { type: 'boolean', description: 'Also compute a per-frame person matte (Apple Vision) so type can go BEHIND the subject' },
          matteQuality: { enum: ['accurate', 'balanced', 'fast'] },
          size: { enum: ['cover', 'native'], description: 'cover (default) = frames cover the output frame; native = keep source size (panels / contain fits)' },
          lut: { type: 'string', description: '.cube 3D LUT applied while decoding (grade match; kinetype compose writes one)' },
          frame: { type: 'object', additionalProperties: false, required: ['x', 'y', 'w', 'h'], properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } }, description: 'reframe: crop {x,y,w,h} as fractions of the source (compose matches a zoomed/cropped base)' } },
      },
    },
    background: {
      type: 'object', required: ['media'], additionalProperties: false,
      description: 'Run the template over footage: {"media":"clip","dim":0.45}',
      properties: { media: { type: 'string' }, dim: { type: 'number', minimum: 0, maximum: 1 }, blur: { type: 'number', minimum: 0 }, fit: { enum: ['cover', 'contain', 'fill'] }, focusX: { type: 'number' }, focusY: { type: 'number' }, color: HEX,
        subjectFront: { type: 'boolean', description: 'Re-draw the person over the template so all type sits BEHIND them (media needs matte: true)' },
        grade: { type: 'object', additionalProperties: false, properties: { exposure: { type: 'number', minimum: 0.2, maximum: 3 }, contrast: { type: 'number', minimum: 0.2, maximum: 3 }, saturation: { type: 'number', minimum: 0, maximum: 3 } } } },
    },
  },
};

const ajv = new Ajv({ allErrors: true, strict: false, useDefaults: false });

export const getTemplate = (id) => loadTemplate(id);

export function loadSpec(p) {
  const abs = path.resolve(p);
  const spec = JSON.parse(fs.readFileSync(abs, 'utf8'));
  return { spec, specPath: abs, specDir: path.dirname(abs) };
}

/** Validate a spec; returns a list of human-readable problems (empty = valid). */
export async function validate(spec, { specDir = null } = {}) {
  const problems = [];
  let resolvedContent = null;
  // inline content.<key>Src so the template schema sees what the engine will see
  if (spec.content && specDir) {
    const c = { ...spec.content };
    for (const [k, v] of Object.entries(spec.content)) {
      if (k.endsWith('Src') && typeof v === 'string') {
        try { c[k.slice(0, -3)] = JSON.parse(fs.readFileSync(path.resolve(specDir, v), 'utf8')); delete c[k]; }
        catch (e) { problems.push(`content.${k}: cannot read ${v} (${e.code || e.message})`); }
      }
    }
    resolvedContent = c;
  }
  const vBase = ajv.compile(BASE_SCHEMA);
  if (!vBase(spec)) for (const e of vBase.errors) problems.push(`spec${e.instancePath} ${e.message}${e.params?.additionalProperty ? ` (${e.params.additionalProperty})` : ''}`);
  let t;
  try { t = await getTemplate(spec.template); } catch (e) { problems.push(e.message); return problems; }
  try { resolveFormat(spec.format); } catch (e) { problems.push(e.message); }
  if (t.schema?.content) {
    const merged = merge(t.defaults?.content || {}, resolvedContent || spec.content || {});
    const v = ajv.compile(t.schema.content);
    if (!v(merged)) for (const e of v.errors) problems.push(`content${e.instancePath} ${e.message}${e.params?.additionalProperty ? ` (${e.params.additionalProperty})` : ''}`);
  }
  if (t.schema?.params && spec.params) {
    const v = ajv.compile(t.schema.params);
    if (!v(spec.params)) for (const e of v.errors) problems.push(`params${e.instancePath} ${e.message}${e.params?.additionalProperty ? ` (${e.params.additionalProperty})` : ''}`);
  }
  for (const key of ['shots', 'overlays']) {
    if (!Array.isArray(spec.content?.[key])) continue;
    for (const [i, sh] of spec.content[key].entries()) {
      if (!sh || typeof sh.template !== 'string') continue;
      if (sh.template === 'sequence') { problems.push(`content/${key}/${i}: a sequence cannot be nested`); continue; }
      const sub = await validate({ template: sh.template, content: sh.content || {}, ...(sh.params ? { params: sh.params } : {}), ...(sh.palette ? { palette: sh.palette } : {}), ...(sh.fonts ? { fonts: sh.fonts } : {}) }, { specDir });
      for (const p of sub) problems.push(`${key}[${i}] (${sh.template}): ${p}`);
    }
  }
  if (spec.palette && t.palette) {
    for (const k of Object.keys(spec.palette)) if (!(k in t.palette)) problems.push(`palette.${k} is not a token of template ${t.id} (tokens: ${Object.keys(t.palette).join(', ')})`);
  }
  if (spec.fonts && t.fonts) {
    for (const k of Object.keys(spec.fonts)) if (!(k in t.fonts)) problems.push(`fonts.${k} is not a role of template ${t.id} (roles: ${Object.keys(t.fonts).join(', ')})`);
  }
  return problems;
}

/**
 * Resolve a spec for the runtime: fonts → URLs on the local server, audio
 * analysis inlined. `roots` receives extra served directories.
 */
export async function resolve(spec, { specDir = process.cwd(), roots = {}, offline = false } = {}) {
  const t = await getTemplate(spec.template);
  let fonts = { ...(t.fonts || {}) };
  // a template with many looks loads only the roles the chosen look draws with
  if (typeof t.fontsFor === 'function') {
    const keep = new Set(t.fontsFor({ ...(t.params || {}), ...(spec.params || {}) }));
    fonts = Object.fromEntries(Object.entries(fonts).filter(([role]) => keep.has(role) || role in (spec.fonts || {})));
  }
  for (const [role, f] of Object.entries(spec.fonts || {})) fonts[role] = { ...(fonts[role] || {}), ...f };
  // Nested shots (sequence): each shot's template fonts load under "s<i>:<role>".
  const fontJobs = Object.entries(fonts);
  const templateUrls = {};
  const inlineSrc = (content) => {
    if (!content) return content;
    const c = { ...content };
    for (const [k, v] of Object.entries(content)) {
      if (k.endsWith('Src') && typeof v === 'string') { c[k.slice(0, -3)] = JSON.parse(fs.readFileSync(path.resolve(specDir, v), 'utf8')); delete c[k]; }
    }
    return c;
  };
  // nested templates: content.shots (sequence, fonts "s<i>:") and
  // content.overlays (embedded on a timeline, fonts "o<i>:")
  const nested = {};
  for (const [key, ns] of [['shots', 's'], ['overlays', 'o']]) {
    if (!Array.isArray(spec.content?.[key])) continue;
    nested[key] = [];
    for (const [i, sh] of spec.content[key].entries()) {
      const st = await getTemplate(sh.template);
      templateUrls[sh.template] = templateUrl(sh.template);
      const sf = { ...(st.fonts || {}) };
      for (const [role, f] of Object.entries(sh.fonts || {})) sf[role] = { ...(sf[role] || {}), ...f };
      for (const [role, f] of Object.entries(sf)) fontJobs.push([`${ns}${i}:${role}`, f]);
      nested[key].push({ ...sh, content: inlineSrc(sh.content) });
    }
  }
  const fontUrls = {};
  const fontFiles = {};
  for (const [role, f] of fontJobs) {
    const abs = await ensureFont(f.file ? { ...f, file: path.resolve(specDir, f.file) } : f, { offline });
    fontFiles[role] = { path: abs, sha256: sha256(fs.readFileSync(abs)), family: f.family, weight: f.weight ?? 400, style: f.style ?? 'normal' };
    if (abs.startsWith(ROOT + path.sep)) fontUrls[role] = '/' + path.relative(ROOT, abs).split(path.sep).join('/');
    else {
      const id = 'f' + Object.keys(roots).length;
      roots[id] = path.dirname(abs);
      fontUrls[role] = `/__root/${id}/${encodeURIComponent(path.basename(abs))}`;
    }
  }
  const out = { ...spec, fonts };
  // content.<key>Src (a JSON file relative to the spec) inlined as content.<key>,
  // THEN nested shots/overlays (already inlined above) replace their raw copies
  if (spec.content) out.content = { ...inlineSrc(spec.content), ...nested };
  if (spec.audio?.analysis) {
    const a = JSON.parse(fs.readFileSync(path.resolve(specDir, spec.audio.analysis), 'utf8'));
    const start = spec.audio.start ?? 0;
    const shift = (arr) => (arr || []).map((x) => x - start).filter((x) => x > -2);
    out.audio = { ...spec.audio, bpm: a.bpm, beats: shift(a.beats), downbeats: shift(a.downbeats), energy: a.energy ? { hop: a.energy.hop, t0: (a.energy.t0 ?? 0) - start, values: a.energy.values } : null, onsets: shift(a.onsets) };
  }
  if (spec.media) {
    const fmt = resolveFormat(spec.format);
    out.__media = await resolveMedia(spec.media, { specDir, roots, W: fmt.width, H: fmt.height, fps: spec.fps ?? fmt.fps, duration: spec.duration ?? t.duration ?? 60 });
  }
  const uiFontUrl = '/fonts/files/IBMPlexMono-500.ttf';
  const media = out.__media || null;
  delete out.__media;
  return { spec: out, fontUrls, fontFiles, uiFontUrl, templateUrl: templateUrl(spec.template), templateUrls, media, gpu: process.env.KINETYPE_GPU === '1', accel: process.env.KINETYPE_GL === '0' ? null : 'gl', scale: spec.render?.scale ?? 1 };
}
