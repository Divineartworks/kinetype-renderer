// `kinetype edit`: a real-video ui-demo spec → pace report, sound
// design (procedural SFX placed from the very same film events the picture
// uses + the voice + the ducked music bed), mix at −16 LUFS / ≤ −1.5 dBTP,
// then the render with that mix as its audio. The plan is computed in Node
// with the same pure planners the template runs in the browser (x-real.js).
import fs from 'node:fs';
import path from 'node:path';
import { resolveFormat } from '../kit/layout.js';
import { planEdit, normalizeReal } from '../kit/x-real.js';
import { loadTemplate } from '../../templates/index.js';
import { placeSfx } from '../audio/sfx/place.js';
import { mix } from '../audio/sfx/mix.js';
import { outDirFor } from './render.js';

/** The edit plan of a spec (Node side): captures read from disk, normalised, planned like the template does. */
export async function editPlan(spec, { specDir }) {
  if (spec.template !== 'ui-demo') throw new Error(`kinetype edit: template must be ui-demo (got ${spec.template})`);
  const tpl = await loadTemplate('ui-demo');
  const fmt = resolveFormat(spec.format);
  const fps = spec.fps ?? fmt.fps; // the engine's own default (format fps)
  const C = spec.content || {};
  const params = { ...tpl.params, ...(spec.params || {}) };
  const devs = C.session?.devices || [{ id: 'main', capture: C.capture }];
  const caps = {};
  for (const d of devs) {
    const m = spec.media?.[d.capture];
    if (!m?.capture) throw new Error(`device ${d.id}: spec.media.${d.capture}.capture missing`);
    const cap = normalizeReal(JSON.parse(fs.readFileSync(path.resolve(specDir, m.capture), 'utf8')));
    if (d.sessionOffset != null) cap.sessionOffset = d.sessionOffset;
    caps[d.id] = cap;
  }
  const side = fmt.width > fmt.height && (C.captions || []).length && C.frame !== 'none' ? params.side ?? 0.36 : 0;
  return planEdit({ caps, content: C, W: fmt.width, H: fmt.height, fps, params: { ...params, side } });
}

/** Film events → sound events for placeSfx (taps, typing keys, swipes, payoff/notify/counter marks, shot cuts). */
export function soundEvents(plan, { marks = {} } = {}) {
  const out = [];
  for (const e of plan.events) {
    if (e.t < 0 || e.t > plan.duration) continue;
    if (e.type === 'click') out.push({ t: e.tDown ?? e.t, type: 'tap' }); // the tick sounds as the finger lands
    else if (e.type === 'type') out.push({ t: e.t, t1: e.t1, type: 'type', text: e.text, keys: e.keys });
    else if (e.type === 'scroll' || e.type === 'swipe' || e.type === 'fling') out.push({ t: e.t, t1: e.t1, type: 'swipe' });
    else if (e.type === 'mark') {
      const kind = marks[e.id] ?? marks[`${e.device}:${e.id}`] ?? e.kind;
      // the cold open sounds its notification only: counter ticks there would sit under the first spoken words
      if (kind && kind !== 'none' && !(e.open && kind === 'counter')) out.push({ t: e.t, type: 'mark', kind, count: e.count, t1: e.t1 });
    }
  }
  for (const s of plan.shots.slice(1)) out.push({ t: s.f0, type: 'cut' });
  return out.sort((a, b) => a.t - b.t);
}

/**
 * spec.sound = {voice?: {src, offset, gainDb}, music?: {src, gainDb, offset, licence, gapLufs},
 *   sfx: true | false, sfxLufs, duckDb, marks: {markId: 'notify'|'success'|'counter'|'none'}, cutSounds}
 */
export async function editSound(spec, { specDir, specPath, out, plan, log = console.error } = {}) {
  plan ||= await editPlan(spec, { specDir });
  const S = spec.sound || {};
  const { dir } = outDirFor(spec, specPath, out);
  const cues = S.sfx === false ? [] : placeSfx(soundEvents(plan, { marks: S.marks }), { seed: spec.seed ?? 1, cutSounds: !!S.cutSounds });
  const file = path.join(dir, 'sound.wav');
  const res = (p) => (p ? path.resolve(specDir, p) : null);
  const report = await mix({
    duration: plan.duration, cues,
    voice: S.voice?.src ? { file: res(S.voice.src), offset: S.voice.offset ?? 0, gainDb: S.voice.gainDb ?? 0 } : undefined,
    music: S.music?.src ? { file: res(S.music.src), offset: S.music.offset ?? 0, gainDb: S.music.gainDb ?? 0, gapLufs: S.music.gapLufs, licence: S.music.licence, fadeOut: S.music.fadeOut } : undefined,
    sfxLufs: S.sfxLufs ?? -21, duckDb: S.duckDb ?? -10, out: file,
  });
  report.cues = cues.map((c) => ({ t: +c.t.toFixed(3), sound: c.sound, ...(c.ch ? { ch: c.ch } : {}) }));
  fs.writeFileSync(`${file}.mix-report.json`, JSON.stringify(report, null, 2));
  log(`sound → ${file}  I ${report.final.I} LUFS, TP ${report.final.TP} dBTP, ${cues.length} cues${report.warnings.length ? '  warnings: ' + report.warnings.join('; ') : ''}`);
  return { file, report, cues };
}

/** Pace report → <out>/pace-report.json. */
export async function editPace(spec, { specDir, specPath, out } = {}) {
  const plan = await editPlan(spec, { specDir });
  const { dir } = outDirFor(spec, specPath, out);
  const file = path.join(dir, 'pace-report.json');
  const shots = plan.shots.map((s) => ({ index: s.index, kind: s.kind, devices: s.devices, f0: +s.f0.toFixed(3), f1: +s.f1.toFixed(3), pieces: s.map.pieces.map((p) => ({ kind: p.kind, c0: +p.c0.toFixed(3), c1: +p.c1.toFixed(3), speed: +p.speed.toFixed(3), f0: +(s.f0 + p.f0).toFixed(3), f1: +(s.f0 + p.f1).toFixed(3), ...(p.why ? { why: p.why } : {}) })), cuts: s.map.cuts.map((k) => ({ t: +(s.f0 + k.t).toFixed(3), from: +k.from.toFixed(3), to: +k.to.toFixed(3) })), camera: s.panels.flatMap((p) => p.keys.map((k) => ({ device: p.device, t: +(s.f0 + k.t).toFixed(3), z: +k.z.toFixed(3), why: k.why }))), notes: s.notes }));
  const doc = { kind: 'kinetype.pace_report.v1', spec: specPath || null, duration: +plan.duration.toFixed(3), status: plan.report.status, checks: plan.report.checks, metrics: plan.report.metrics, notes: plan.report.notes, shots };
  fs.writeFileSync(file, JSON.stringify(doc, null, 2));
  return { file, plan, report: doc };
}

/** pace → sound → render (draft or full); the render carries the mix as its audio. */
export async function edit(spec, { specDir, specPath, out, draft = false, workers, log = console.error } = {}) {
  const pace = await editPace(spec, { specDir, specPath, out });
  log(`pace ${pace.report.status}: ${pace.report.checks.map((c) => `${c.id} ${c.status}`).join(', ')}`);
  const snd = await editSound(spec, { specDir, specPath, out, plan: pace.plan, log });
  const { render } = await import('./render.js');
  const withAudio = { ...spec, audio: { src: snd.file } };
  const receipt = await render(withAudio, { specPath, specDir, out, draft, workers, log });
  const dir = path.dirname(receipt.outputs[0].file);
  receipt.edit = { pace: { file: pace.file, status: pace.report.status, metrics: pace.report.metrics }, sound: { file: snd.file, final: snd.report.final, stems: snd.report.stems, duck: snd.report.duck, sounds: snd.report.sounds, warnings: snd.report.warnings } };
  fs.writeFileSync(path.join(dir, 'receipt.json'), JSON.stringify(receipt, null, 2));
  return receipt;
}
