// The engine: turns (template, spec) into a pure seek(t) and motion-blurred
// frames. Shared verbatim by the headless renderer, the preview server and the
// single-file HTML export, so what an agent previews is what gets rendered.
import { FontBook } from './font.js';
import { BeatGrid } from './beat.js';
import { Grid, resolveFormat, aspectClass } from './layout.js';
import { mod, clamp } from './math.js';
import { MediaHub, drawFit } from './media.js';
import { createAccumulator } from './glaccum.js';

export const ENGINE_VERSION = '0.1.0';

/** Deep-merge plain objects (arrays and scalars replace). */
export function merge(a, b) {
  if (b === undefined) return a;
  if (Array.isArray(b) || typeof b !== 'object' || b === null) return b;
  const out = { ...(a && typeof a === 'object' && !Array.isArray(a) ? a : {}) };
  for (const [k, v] of Object.entries(b)) out[k] = merge(out[k], v);
  return out;
}

/**
 * Build one scene (template + spec) against a shared environment. Used for the
 * top-level scene and, through ctx.sub(), for shots nested by `sequence`.
 * env: { W, H, fps, fonts (role → Face lookup), qa sink, media, templates, transparent, at }
 */
export function buildScene(template, spec, env) {
  const { W, H, fps } = env;
  const palette = { ...(template.palette || {}), ...(spec.palette || {}) };
  const params = merge(template.params || {}, spec.params || {});
  // Content is exactly what the spec says. (Merging the template's EXAMPLE
  // copy here leaked demo text into real videos whenever an optional field
  // was omitted.) Templates declare real defaults in `defaults.content`.
  const content = merge(template.defaults?.content || {}, spec.content || {});
  const audio = spec.audio || null;
  const beat = new BeatGrid({
    bpm: spec.bpm ?? template.bpm ?? 120,
    offset: spec.beatOffset ?? 0,
    beatsPerBar: spec.beatsPerBar ?? 4,
    beats: audio?.beats,
  });
  const at = env.at ?? 0;
  const sink = env.qa;
  const pre = env.label ? env.label + '/' : '';
  const ctx = {
    spec, content, params, palette, beat, W, H, fps,
    fonts: env.fonts,
    seed: spec.seed ?? 1,
    loop: spec.loop ?? template.loop ?? false,
    duration: spec.duration ?? template.duration ?? 10,
    aspect: aspectClass(W, H),
    grid: new Grid({ width: W, height: H, ...(params.grid || {}) }),
    audio,
    transparent: env.transparent,
    /** Output pixels per design pixel (preview/draft renders < 1): size offscreen buffers by it. */
    renderScale: env.scale ?? 1,
    media: env.media,
    templates: env.templates || {},
    qa: {
      /** Register readable text for layout/contrast QA. box in design px. */
      text: (label, o) => sink.texts.push({ label: pre + label, ...o, ...(at ? { at } : {}) }),
      /** Something visibly lands at time t (beat-coverage QA). */
      hit: (t, label = '') => sink.hits.push({ t: t + at, label: pre + label }),
      /** A "major beat" still for the pre-pass contact sheet. */
      keyframe: (t, label = '') => { if (!env.noKeyframes) sink.keyframes.push({ t: t + at, label: pre + label }); },
      note: (msg) => sink.notes.push(pre + msg),
      warn: (msg) => sink.warnings.push(pre + msg),
      /** A template's own verdict on its output (status pass|warn|fail); a fail fails the render. */
      check: (id, status, detail, data) => sink.checks.push({ id: pre + id, status, detail, ...(data ? { data } : {}) }),
      /** A drawn overlay's exact geometry at time t (output px), for audits (e.g. highlight proof sheets). */
      overlay: (t, o) => sink.overlays.push({ ...o, t: t + at, label: pre + (o.label ?? '') }),
    },
    /**
     * Instantiate another template as a nested scene (used by `sequence`).
     * opts.at: where it starts on the parent timeline (QA times, beat phase);
     * opts.ns: font namespace the resolver loaded its roles under.
     */
    sub(templateId, childSpec, opts = {}) {
      const t = ctx.templates[templateId];
      if (!t) throw new Error(`template "${templateId}" was not loaded for this composition`);
      const ns = opts.ns ?? templateId;
      const book = env.book;
      const fontsView = {
        get: (role) => book.get(`${ns}:${role}`),
        has: (role) => book.has(`${ns}:${role}`),
        faces: book.faces,
      };
      // probe: build only to measure (e.g. natural duration) — record nothing
      const qaSink = opts.probe ? { texts: [], hits: [], keyframes: [], notes: [], warnings: [], checks: [], overlays: [] } : env.qa;
      return buildScene(t, childSpec, { ...env, qa: qaSink, fonts: fontsView, at: at + (opts.at ?? 0), label: pre + (opts.label ?? ns), noKeyframes: opts.keyframes === false || env.noKeyframes });
    },
  };
  const scene = template.build(ctx);
  return { scene, ctx, duration: scene.duration ?? ctx.duration, loop: scene.loop ?? ctx.loop, palette };
}

/**
 * @param {{canvas:HTMLCanvasElement, spec:object, template:object, fontBuffers:Record<string,ArrayBuffer>,
 *   templates?:Record<string,object>, media?:import('./media.js').MediaHub, scale?:number, readback?:boolean}} o
 */
export function createEngine({ canvas, spec, template, fontBuffers, scale = 1, readback = true, templates = {}, media = null, accel = null }) {
  const fmt = resolveFormat(spec.format);
  const W = fmt.width, H = fmt.height, fps = spec.fps ?? fmt.fps;
  const transparent = !!spec.render?.transparent;
  const fonts = new FontBook();
  for (const [role, buf] of Object.entries(fontBuffers)) fonts.addBuffer(role, buf, spec.fonts?.[role]);
  const qa = { texts: [], hits: [], keyframes: [], notes: [], warnings: [], checks: [], overlays: [] };
  const hub = media || new MediaHub({});
  const built = buildScene(template, spec, {
    W, H, fps, fonts, book: fonts, qa, media: hub, templates: { [template.id]: template, ...templates }, transparent, scale,
  });
  const { scene, palette } = built;
  const duration = built.duration;
  const loop = built.loop;
  const frames = Math.round(duration * fps);
  // Footage background: any template can run over a video/image (spec.background).
  const bg = spec.background || null;
  if (bg && !hub.src[bg.media]) throw new Error(`background.media "${bg.media}" is not declared in spec.media`);
  if (bg && bg.subjectFront && !hub.src[bg.media].matte) throw new Error(`background.subjectFront needs spec.media.${bg.media}.matte: true`);
  /** CSS filter for a footage grade: {exposure: 1.0 = unchanged, contrast, saturation}. */
  const gradeFilter = (gr) => (gr ? `brightness(${gr.exposure ?? 1}) contrast(${gr.contrast ?? 1}) saturate(${gr.saturation ?? 1})` : '');
  const bgGrade = gradeFilter(bg?.grade);

  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  // readback=true keeps the canvas on the CPU (fast getImageData for rendering);
  // players pass false to keep GPU-accelerated drawing for real-time playback.
  // accel 'gl' (default when WebGL2 float buffers exist): draw on a GPU canvas
  // and accumulate motion blur on the GPU. Probe BEFORE creating the 2D context
  // so a machine without it keeps the CPU-readback canvas.
  const glAcc = accel === 'gl' && !transparent ? createAccumulator(canvas.width, canvas.height) : null;
  const useGL = !!glAcc;
  const g = canvas.getContext('2d', { alpha: transparent, willReadFrequently: readback && !useGL });
  const cw = canvas.width, ch = canvas.height;
  let acc = null;
  let lastBytes = null;

  const wrap = (t) => (loop ? mod(t, duration) : clamp(t, 0, duration));

  function drawSample(t) {
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.filter = 'none';
    if (transparent) g.clearRect(0, 0, W, H);
    else {
      g.fillStyle = palette.bg ?? '#000';
      g.fillRect(0, 0, W, H);
    }
    if (bg) {
      const bmp = hub.frame(bg.media, wrap(t));
      if (bmp) {
        g.save();
        const fx = [bgGrade, bg.blur ? `blur(${bg.blur}px)` : ''].filter(Boolean).join(' ');
        if (fx) g.filter = fx;
        drawFit(g, bmp, { x: 0, y: 0, w: W, h: H }, bg.fit || 'cover', bg.focusX ?? 0.5, bg.focusY ?? 0.5);
        g.restore();
        // dim toward the template's ground so its type keeps contrast
        const dim = bg.dim ?? 0.45;
        if (dim > 0) { g.globalAlpha = dim; g.fillStyle = bg.color || palette.bg || '#000'; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
      }
    }
    scene.draw(g, wrap(t));
    // subject in front: the person is re-drawn over everything the template
    // drew, so all typography sits BEHIND them (needs media.<id>.matte)
    if (bg && bg.subjectFront) {
      g.save();
      g.setTransform(scale, 0, 0, scale, 0, 0);
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none';
      hub.get(bg.media).subject(g, wrap(t), { x: 0, y: 0, w: W, h: H }, { fit: bg.fit || 'cover', focusX: bg.focusX ?? 0.5, focusY: bg.focusY ?? 0.5, filter: bgGrade || null });
      g.restore();
    }
  }

  // Frame-static overlays (grain, vignette, letterbox) drawn ONCE per output
  // frame after motion-blur accumulation, instead of once per sub-sample.
  // Averaging N identical overlays equals drawing one, so only speed changes.
  function drawPost(t) {
    if (!scene.post) return;
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.filter = 'none';
    scene.post(g, wrap(t));
  }

  /**
   * Draw time t with motion blur: `samples` sub-frames spread over the
   * `shutter` fraction of a frame BEFORE t (trailing shutter), averaged in
   * premultiplied float space. samples=1 → exactly seek(t).
   */
  function drawBlurred(t, samples = 1, shutter = 1) {
    // Templates may ask for more sub-frames where motion outruns the base
    // sample count (whip pans, fly-throughs); never fewer.
    if (samples > 1 && scene.samplesHint) samples = Math.max(samples, Math.min(64, scene.samplesHint(wrap(t)) | 0));
    if (samples <= 1) {
      drawSample(t);
      drawPost(t);
      return;
    }
    const n = cw * ch * 4;
    const dt = shutter / fps / samples;
    if (glAcc) {
      glAcc.begin();
      for (let k = 0; k < samples; k++) { drawSample(t - k * dt); glAcc.add(canvas, 1 / samples); }
      const bytes = glAcc.finish();
      const out = new ImageData(new Uint8ClampedArray(bytes.buffer.slice(0)), cw, ch);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.putImageData(out, 0, 0);
      drawPost(t);
      lastBytes = scene.post ? null : out.data;
      return;
    }
    if (!acc || acc.length !== n) acc = new Float32Array(n);
    else acc.fill(0);
    // Static-frame shortcut: draw the two ends of the shutter interval first;
    // if they are byte-identical nothing moved inside this frame, so every
    // sub-sample is that same image and the average IS it. Holds cost 2
    // samples instead of N. Decided on pixels, so still deterministic.
    drawSample(t - (samples - 1) * dt);
    const first = g.getImageData(0, 0, cw, ch).data;
    drawSample(t);
    const lastImg = g.getImageData(0, 0, cw, ch);
    const last = lastImg.data;
    let same = first.length === last.length;
    if (same) {
      const a32 = new Uint32Array(first.buffer, first.byteOffset, first.length >> 2);
      const b32 = new Uint32Array(last.buffer, last.byteOffset, last.length >> 2);
      for (let i = 0; i < a32.length; i++) if (a32[i] !== b32[i]) { same = false; break; }
    }
    if (same) { g.setTransform(1, 0, 0, 1, 0, 0); g.putImageData(lastImg, 0, 0); drawPost(t); return; }
    for (let k = 0; k < samples; k++) {
      let d;
      if (k === 0) d = last;
      else if (k === samples - 1) d = first;
      else { drawSample(t - k * dt); d = g.getImageData(0, 0, cw, ch).data; }
      if (transparent) {
        for (let i = 0; i < n; i += 4) {
          const a = d[i + 3];
          acc[i] += d[i] * a; acc[i + 1] += d[i + 1] * a; acc[i + 2] += d[i + 2] * a; acc[i + 3] += a;
        }
      } else {
        for (let i = 0; i < n; i++) acc[i] += d[i];
      }
    }
    const out = g.createImageData(cw, ch);
    const o = out.data;
    if (transparent) {
      for (let i = 0; i < n; i += 4) {
        const a = acc[i + 3];
        if (a > 0) { o[i] = acc[i] / a; o[i + 1] = acc[i + 1] / a; o[i + 2] = acc[i + 2] / a; }
        o[i + 3] = a / samples; // Uint8ClampedArray rounds to nearest itself
      }
    } else {
      const inv = 1 / samples;
      // no +0.5: Uint8ClampedArray already rounds (ties-to-even); adding 0.5 double-rounded and
      // brightened every odd channel value by one (a static frame came out ≠ its own sample)
      for (let i = 0; i < n; i++) o[i] = acc[i] * inv;
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.putImageData(out, 0, 0);
    drawPost(t);
  }

  // Prime: draw a few samples before any real output so lazy first-use work
  // (glyph paths, grain tiles, pattern canvases, GPU→CPU canvas handoffs) never
  // lands inside a real frame. Measured: without this, riso-print's first draw
  // differed from a re-draw of the same t by 19 channel values.
  for (const pt of [0, duration * 0.37, duration * 0.73, 0]) drawSample(pt);

  /** Sub-sample times for frame time t (trailing shutter), as used by drawBlurred. */
  function sampleTimes(t, samples = 1, shutter = 1) {
    if (samples > 1 && scene.samplesHint) samples = Math.max(samples, Math.min(64, scene.samplesHint(wrap(t)) | 0));
    const out = [];
    const dt = shutter / fps / Math.max(1, samples);
    for (let k = 0; k < Math.max(1, samples); k++) out.push(wrap(t - k * dt));
    return out;
  }

  return {
    W, H, fps, duration, frames, loop, palette, accel: useGL ? 'gl' : 'cpu', params: built.ctx.params, content: built.ctx.content, fonts, scale, bpm: built.ctx.beat.bpm, transparent,
    media: hub,
    /** Fetch any media frames the given frame needs (call before frame/drawBlurred/seek). */
    // include the frame-quantised times too: templates that hold discrete state
    // per frame (frameQuant) read media at those times, which can sit past t
    // scene.mediaNeeds(times) → [{id, idx}]: exact capture frames a scene maps its own clock to (ui-demo)
    prepare: (t, samples = 1, shutter = 1, fresh = false) => {
      const ts = sampleTimes(t, samples, shutter);
      const all = [...ts, ...ts.map((x) => wrap(Math.ceil(x * fps - 1e-6) / fps))];
      return hub.prepare(all, { fresh, needs: scene.mediaNeeds ? scene.mediaNeeds(all) : null });
    },
    /**
     * Regions of frame t (render px) that show third-party pixels (a captured
     * UI, a logo) and are therefore exempt from palette QA. Null = none.
     */
    exempt(t) {
      if (!scene.qaExempt) return null;
      const r = scene.qaExempt(wrap(t)) || [];
      return r.map((b) => {
        const x0 = Math.max(0, Math.floor(b.x * scale)), y0 = Math.max(0, Math.floor(b.y * scale));
        const x1 = Math.min(cw, Math.ceil((b.x + b.w) * scale)), y1 = Math.min(ch, Math.ceil((b.y + b.h) * scale));
        return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : null;
      }).filter(Boolean);
    },
    sampleTimes,
    template: { id: template.id, version: template.version ?? '0' },
    qa,
    canvas,
    /** Pure seek: draw time t (no blur). */
    seek(t) { drawSample(t); drawPost(t); },
    drawBlurred,
    /** Per-render counters a template keeps about the frames it drew (null when it keeps none). */
    stats: () => (scene.stats ? scene.stats() : null),
    frameTime: (i) => i / fps,
    /** Render frame i and return its RGBA bytes. */
    frame(i, samples = 1, shutter = 1) {
      lastBytes = null;
      scene.beginFrame?.(i);
      try { drawBlurred(i / fps, samples, shutter); } finally { scene.endFrame?.(); }
      if (lastBytes) return lastBytes; // GPU path already has the bytes
      return g.getImageData(0, 0, cw, ch).data;
    },
    /**
     * Second build phase: a scene may ask for media at specific times
     * (scene.initTimes) and finish its layout from them (scene.init) — e.g.
     * reading the person matte at each hero word to decide where type fits.
     * Deterministic: the frames are fixed times, fetched before any drawing.
     */
    async init() {
      if (!scene.initTimes || !scene.init) return;
      const ts = scene.initTimes();
      if (ts.length) await hub.prepare(ts);
      scene.init();
    },
    info() {
      return {
        engine: ENGINE_VERSION,
        template: this.template,
        width: W, height: H, renderWidth: cw, renderHeight: ch, fps, duration, frames, loop,
        palette, qa,
        missingGlyphs: collectMissing(fonts),
        // the scene marks third-party pixels (captured UI, logos) per frame, so palette QA
        // can stay strict on everything the template itself draws
        paletteExempt: !!scene.qaExempt,
      };
    },
  };
}

function collectMissing(fonts) {
  const out = {};
  for (const [k, f] of fonts.faces) {
    const miss = [...f._glyphs.values()].filter((g) => g.missing).map((g) => g.ch);
    if (miss.length) out[k] = [...new Set(miss)];
  }
  return out;
}
