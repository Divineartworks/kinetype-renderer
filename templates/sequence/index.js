// SEQUENCE — an edit. Chains any templates as shots on one timeline with
// designed transitions, one song and one beat grid. Each shot is a full
// template (its own palette, fonts, params, optional footage background);
// boundaries can snap to the beat and every shot's beat grid is phase-locked
// to the song, so a cut lands where the kick lands.
import * as K from '../../src/kit/index.js';
import { drawFit } from '../../src/kit/media.js';

const TYPES = ['cut', 'smash', 'push', 'zoom', 'dip', 'crossfade', 'flash', 'iris', 'slice'];
export const DIP_DEPTH = 0.35; // a dip never goes darker than this (UI shots stay readable through it)
export const DIP_MAX = 0.25;   // ... and never lasts longer than this (s)

/** The transition into a shot: explicit type wins; ui-demo -> ui-demo defaults to a crossfade; a dip is capped in depth and time. */
export function resolveTransition({ i, prev, tpl, type, duration, params, fps }) {
  let t = i === 0 ? 'cut' : type ?? (prev === 'ui-demo' && tpl === 'ui-demo' ? 'crossfade' : params.transition);
  let d = t === 'cut' ? 0 : t === 'flash' ? 2 / fps : duration ?? params.transitionDuration;
  if (t === 'dip') d = Math.min(d, DIP_MAX);
  return { type: t, duration: d };
}

export default {
  id: 'sequence',
  version: '1.0.0',
  name: 'Sequence',
  description: 'An edit: chain any templates as shots with designed transitions (cut, smash, push, zoom, dip, flash, iris, slice), beat-snapped boundaries, one song, per-shot footage backgrounds.',
  tags: ['edit', 'sequence', 'youtube', 'intro', 'music', 'meta'],
  formats: ['landscape', 'square', 'vertical', 'portrait'],
  bpm: 120,
  duration: 30,
  loop: false,
  palette: { bg: '#0A0A0A', flash: '#F5F5F5' },
  paletteRoles: { bg: 'gap colour behind shots', flash: 'flash transition colour' },
  fonts: {},
  params: { transition: 'smash', transitionDuration: 0.45, snapToBeats: true },
  schema: {
    content: {
      type: 'object',
      required: ['shots'],
      additionalProperties: false,
      properties: {
        shots: {
          type: 'array', minItems: 1, maxItems: 24,
          items: {
            type: 'object', required: ['template'], additionalProperties: false,
            properties: {
              template: { type: 'string', description: 'Any kinetype template id except sequence' },
              content: { type: 'object', description: "That template's content (see describe_template)" },
              params: { type: 'object' },
              palette: { type: 'object' },
              fonts: { type: 'object' },
              duration: { type: 'number', minimum: 0.5, description: 'Seconds on the timeline (default: the template\'s own duration)' },
              start: { type: 'number', minimum: 0, description: 'Start INSIDE the shot (skip its intro), seconds' },
              trim: { type: 'boolean', description: 'Acknowledge that duration deliberately cuts the template\'s own ending (silences the QA warning)' },
              transition: {
                type: 'object', additionalProperties: false,
                properties: { type: { enum: TYPES }, duration: { type: 'number', minimum: 0, maximum: 3 } },
                description: 'How this shot comes in',
              },
              background: {
                type: 'object', required: ['media'], additionalProperties: false,
                properties: { media: { type: 'string' }, dim: { type: 'number', minimum: 0, maximum: 1 }, blur: { type: 'number', minimum: 0 } },
              },
            },
          },
        },
      },
    },
    params: {
      type: 'object', additionalProperties: false,
      properties: {
        transition: { enum: TYPES },
        transitionDuration: { type: 'number', minimum: 0, maximum: 3 },
        snapToBeats: { type: 'boolean', description: 'Round each shot boundary to the nearest beat' },
      },
    },
  },
  example: {
    template: 'sequence',
    name: 'sequence-chapter-edit',
    format: 'landscape',
    bpm: 100,
    seed: 5,
    content: {
      shots: [
        { template: 'swiss-grid', content: { number: '01', kicker: 'CHAPTER ONE', title: 'The workflow is the product', subtitle: 'Same model, same budget — a repeatable pipeline wins.', points: ['Lock the reference', 'Write the shot as JSON', 'Upscale last'] } },
        { template: 'editorial-serif', transition: { type: 'dip' }, content: { mode: 'quote', number: 'Nº 12', section: 'In conversation', quote: 'The model is not the artist. The *workflow* is.', attribution: 'TechHalla', role: 'AI creator' } },
        { template: 'split-flap', transition: { type: 'push' }, content: { title: 'RESULTS', columns: { main: 'METRIC', status: 'CHANGE' }, rows: [{ text: 'RENDER TIME', status: '-71%' }, { text: 'KEYFRAMES', status: 'ZERO' }, { text: 'RETENTION', status: '+38%' }] } },
        { template: 'echo-stack', transition: { type: 'smash' }, content: { words: ['STEAL IT'], message: 'STEAL THE WORKFLOW', sub: 'LINK IN BIO' } },
      ],
    },
  },

  build(ctx) {
    const { W, H, fps, params, content, palette: P, seed } = ctx;
    const spec = ctx.spec;
    const shots = content.shots;
    const spb = 60 / ctx.beat.bpm;
    const snap = params.snapToBeats && (spec.bpm || ctx.audio?.beats);
    // A shot's local timeline starts at 0. Measured beats before the shot are
    // dropped (not shifted negative), so the shot's beat 0 is the first song
    // beat at/after its start — its choreography starts on the grid, on time.
    const shift = (arr, at) => (arr || []).map((b) => b - at).filter((b) => b >= -1e-3);
    const shiftAudio = (a, at) => (a ? { ...a, beats: shift(a.beats, at), downbeats: shift(a.downbeats, at), onsets: shift(a.onsets, at), energy: a.energy ? { ...a.energy, t0: (a.energy.t0 ?? 0) - at } : null } : null);
    const L = [];
    let at = 0;
    shots.forEach((sh, i) => {
      if (sh.template === 'sequence') throw new Error('a sequence cannot nest a sequence');
      const { type: trType, duration: trDur } = resolveTransition({ i, prev: shots[i - 1]?.template, tpl: sh.template, type: sh.transition?.type, duration: sh.transition?.duration, params, fps });
      const skip = sh.start ?? 0;
      const childSpec = {
        template: sh.template, format: spec.format, fps, seed: K.hash(seed, 'shot', i) % 100000,
        bpm: sh.bpm ?? spec.bpm ?? ctx.beat.bpm, beatsPerBar: spec.beatsPerBar,
        // phase-lock: the shot's beat 0 = the first global beat at/after its start
        beatOffset: K.mod((spec.beatOffset ?? 0) - (at - skip), 60 / (sh.bpm ?? spec.bpm ?? ctx.beat.bpm)),
        content: sh.content || {}, params: sh.params, palette: sh.palette, fonts: sh.fonts,
        audio: shiftAudio(ctx.audio, at - skip), loop: false, render: spec.render,
        ...(sh.duration && !skip ? { duration: sh.duration } : {}),
      };
      const built = ctx.sub(sh.template, childSpec, { at: at - skip, ns: `s${i}`, label: `${i + 1}:${sh.template}`, keyframes: false });
      let dur = sh.duration ?? Math.max(0.5, built.duration - skip);
      let end = at + dur;
      if (snap && i < shots.length - 1) end = Math.max(at + 0.5, Math.round(end / spb) * spb);
      dur = end - at;
      L.push({ i, sh, built, at, dur, skip, trType, trDur });
      ctx.qa.hit(at, `shot ${i + 1} ${trType}`);
      // three looks per shot (early / middle / just before the cut)
      for (const [f, lab] of [[0.2, 'in'], [0.55, 'mid'], [0.94, 'out']]) ctx.qa.keyframe(at + Math.max(trDur + 0.05, Math.min(dur * f, dur - 0.05)), `shot ${i + 1} ${sh.template} · ${lab}`);
      // The shot's natural length = what the template needs with NO duration
      // override (probe build, records nothing). A shorter shot cuts its ending.
      let natural = null;
      if (sh.duration) {
        const { duration: _d, ...free } = childSpec;
        natural = ctx.sub(sh.template, free, { at: at - skip, ns: `s${i}`, probe: true }).duration - skip;
      }
      if (sh.duration && !sh.trim && natural != null && sh.duration < natural - 0.25) ctx.qa.warn(`shot ${i + 1} (${sh.template}) runs ${sh.duration.toFixed(2)}s but its choreography needs ${natural.toFixed(2)}s — its ending is cut. Raise duration or set start to skip the intro instead.`);
      // palette QA must know every shot's inks, not just the sequence's own tokens
      for (const [k, v] of Object.entries(built.palette || {})) if (typeof v === 'string' && /^#/.test(v)) P[`s${i}_${k}`] = v;
      if (i > 0 && trDur > 0) ctx.qa.keyframe(at + trDur * 0.5, `→ ${trType}`);
      at = end;
    });
    const duration = at;
    ctx.qa.keyframe(0.05, 'open');
    ctx.qa.keyframe(duration - 1 / fps, 'last frame');
    ctx.qa.note(`${L.length} shots: ${L.map((l) => `${l.sh.template} ${l.dur.toFixed(2)}s`).join(' · ')}`);

    // one CPU-backed layer for alpha transitions (dip/zoom)
    let layer = null;
    const getLayer = () => {
      if (!layer) {
        const c = new OffscreenCanvas(W, H);
        layer = { c, g: c.getContext('2d', { willReadFrequently: true }) };
      }
      return layer;
    };
    const reset = (g) => { g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none'; };
    function drawShot(g, l, tLocal) {
      g.save();
      reset(g);
      const ground = l.built.palette.bg;
      if (!ctx.transparent && !spec.background && ground) { g.fillStyle = ground; g.fillRect(0, 0, W, H); }
      if (l.sh.background && ctx.media) {
        const bmp = ctx.media.frame(l.sh.background.media, l.at + tLocal);
        if (bmp) {
          if (l.sh.background.blur) g.filter = `blur(${l.sh.background.blur}px)`;
          drawFit(g, bmp, { x: 0, y: 0, w: W, h: H });
          g.filter = 'none';
          const dim = l.sh.background.dim ?? 0.45;
          if (dim > 0) { g.globalAlpha = dim; g.fillStyle = ground || '#000'; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
        }
      }
      l.built.scene.draw(g, Math.min(tLocal + l.skip, l.built.duration));
      g.restore();
      reset(g);
    }
    const onLayer = (l, tLocal) => {
      const { c, g } = getLayer();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, W, H);
      drawShot(g, l, tLocal);
      return c;
    };
    const shotAt = (t) => {
      let i = 0;
      while (i + 1 < L.length && t >= L[i + 1].at) i++;
      return i;
    };
    // deterministic slice pattern per boundary
    const slices = (i) => Array.from({ length: 14 }, (_, k) => K.noise1(seed, 'slice', i, k));

    // shots that show third-party pixels (ui-demo's captured UI, a logo, footage
    // backgrounds) keep palette QA honest: forward their exempt regions
    const exemptShots = L.some((l) => l.built.scene.qaExempt || l.sh.background);
    const local = (l, t) => Math.max(0, Math.min(t - l.at + l.skip, l.built.duration));
    const live = (t) => L.filter((l, k) => t >= l.at - 1e-9 && t <= l.at + l.dur + (L[k + 1]?.trDur ?? 0) + 1e-6);
    return {
      duration,
      // capture frames a shot maps its own clock to (ui-demo), at each live shot's local time
      ...(L.some((l) => l.built.scene.mediaNeeds) ? {
        mediaNeeds(times) {
          const out = [];
          for (const t of times) for (const l of live(t)) if (l.built.scene.mediaNeeds) out.push(...l.built.scene.mediaNeeds([local(l, t)]));
          return out;
        },
      } : {}),
      ...(exemptShots ? {
        qaExempt(t) {
          const i = shotAt(t), l = L[i], lt = t - l.at;
          const full = [{ x: 0, y: 0, w: W, h: H }];
          // inside a designed transition the regions move/blend: exempt the frame only if a shot needs it
          if (i > 0 && lt < l.trDur && l.trType !== 'cut') return (l.built.scene.qaExempt || l.sh.background || L[i - 1].built.scene.qaExempt || L[i - 1].sh.background) ? full : [];
          if (l.sh.background) return full;
          return l.built.scene.qaExempt ? l.built.scene.qaExempt(local(l, t)) : [];
        },
      } : {}),
      samplesHint(t) {
        const l = L[shotAt(t)];
        const local = t - l.at;
        if (['smash', 'push', 'zoom', 'slice', 'crossfade'].includes(l.trType) && local < l.trDur) return 24;
        return l.built.scene.samplesHint ? l.built.scene.samplesHint(local + l.skip) : 0;
      },
      post(g, t) {
        const l = L[shotAt(t)];
        if (l.built.scene.post) l.built.scene.post(g, t - l.at + l.skip);
      },
      draw(g, t) {
        const i = shotAt(t);
        const l = L[i];
        const local = t - l.at;
        if (i === 0 || local >= l.trDur || l.trType === 'cut') return drawShot(g, l, local);
        const p = L[i - 1];
        const pLocal = p.dur + local; // the outgoing shot keeps moving through the transition
        const u = K.clamp(local / l.trDur);
        switch (l.trType) {
          case 'smash': {
            const pan = K.springStep(local, 3.8, 0.74) * W;
            g.save(); g.translate(-pan, 0); drawShot(g, p, pLocal); g.restore();
            g.save(); g.translate(W - pan, 0); drawShot(g, l, local); g.restore();
            return;
          }
          case 'push': {
            const y = K.springStep(local, 3.4, 0.82) * H;
            g.save(); g.translate(0, -y); drawShot(g, p, pLocal); g.restore();
            g.save(); g.translate(0, H - y); drawShot(g, l, local); g.restore();
            return;
          }
          case 'iris': {
            drawShot(g, p, pLocal);
            const r = K.expoInOut(u) * Math.hypot(W, H) * 0.55;
            g.save(); g.beginPath(); g.arc(W / 2, H / 2, Math.max(0.1, r), 0, Math.PI * 2); g.clip(); drawShot(g, l, local); g.restore();
            return;
          }
          case 'slice': {
            const sl = slices(i), n = sl.length, h = H / n;
            for (let k = 0; k < n; k++) {
              const d = K.clamp((u - sl[k] * 0.45) / 0.55);
              const e = K.expoInOut(d);
              const dir = k % 2 ? 1 : -1;
              g.save(); g.beginPath(); g.rect(0, k * h, W, h + 1); g.clip();
              g.save(); g.translate(dir * e * W, 0); drawShot(g, p, pLocal); g.restore();
              g.save(); g.translate(dir * (e - 1) * W, 0); drawShot(g, l, local); g.restore();
              g.restore();
            }
            return;
          }
          case 'flash': {
            g.fillStyle = P.flash; g.fillRect(0, 0, W, H);
            return;
          }
          case 'zoom': {
            const e = K.expoIn(u);
            const a = onLayer(p, pLocal);
            drawShot(g, l, local);
            g.save();
            g.globalAlpha = 1 - K.cubicIn(u);
            g.translate(W / 2, H / 2); g.scale(1 + e * 0.9, 1 + e * 0.9); g.translate(-W / 2, -H / 2);
            g.drawImage(a, 0, 0, W, H);
            g.restore();
            return;
          }
          case 'crossfade': {
            drawShot(g, p, pLocal);
            const b = onLayer(l, local);
            g.save(); g.globalAlpha = K.cubicInOut(u); g.drawImage(b, 0, 0, W, H); g.restore();
            return;
          }
          case 'dip': {
            const half = u < 0.5;
            if (half) {
              drawShot(g, p, pLocal);
              g.fillStyle = P.bg; g.globalAlpha = DIP_DEPTH * K.cubicInOut(u * 2); g.fillRect(0, 0, W, H); g.globalAlpha = 1;
            } else {
              drawShot(g, l, local);
              g.fillStyle = P.bg; g.globalAlpha = DIP_DEPTH * (1 - K.cubicInOut((u - 0.5) * 2)); g.fillRect(0, 0, W, H); g.globalAlpha = 1;
            }
            return;
          }
          default:
            return drawShot(g, l, local);
        }
      },
    };
  },
};
