# Authoring a kinetype template

A template is one folder, `templates/<id>/index.js`, default-exporting a
self-describing object. Adding the folder registers it; nothing else to edit.

```js
import * as K from '../../src/kit/index.js';
export default {
  id: 'my-template', version: '1.0.0', name: 'My Template',
  description: 'One sentence an agent can choose by.',
  tags: ['lyric', 'loop', ...], formats: ['square', 'landscape', 'vertical'],
  bpm: 120, duration: 12, loop: false,
  palette: { bg: '#0A0A0A', ink: '#F5F5F5', a: '#FF2BD6' },   // tokens only; spec may override values, not add keys
  paletteRoles: { bg: 'background', ... },
  fonts: { display: { family: 'Archivo Black', weight: 400 }, ... }, // roles; any Google Font auto-fetches
  params: { ...tunable defaults },
  schema: { content: <JSON Schema>, params: <JSON Schema> },
  example: { template: 'my-template', format: 'square', content: {...}, ... }, // a complete, valid spec
  notes: 'Anything an agent must know (limits, best formats).',
  build(ctx) { ...precompute...; return { draw(g, t) { ... }, samplesHint?(t), duration?, loop? } },
};
```

## The contract (enforced by review and QA)

1. **`draw(g, t)` is a pure function of `t`.** No `Math.random`, `Date`,
   `performance`, timers, CSS, DOM text, or state carried between calls. Use
   `K.rng(seed, ...keys)`, `K.noise1`, `K.hash` for randomness. Frames render
   out of order on different workers and are hashed; a repeat must be identical.
2. **Motion = Tracks and springs.** `new K.Track(v).spring(t0, v1, 'slam')`,
   `.ease(t0, dur, v, K.expoOut)`, `.cut(t0, v)`; `K.springStep(t - t0, f, z)`.
   Author times in beats: `ctx.beat.t(n)`; sixteenths `ctx.beat.s16(n)`.
3. **All text is outlines.** `K.shape(face, text, {size, tracking, kerning})` →
   Run; `K.fitSize` to fit width by INK; `K.drawRun(g, run, x, y, {align, fill,
   each(it,k) → {dx,dy,s,sx,sy,rot,alpha,blur,fill,ch,hidden}, group})`;
   `K.runPath` for clip masks; `K.stackInk` / `K.stackHeight` for stacks.
   Tracking is in 1/1000 em. `capSymbols: true` sizes @ # & to cap height.
4. **Discrete state on frame boundaries.** Scramble glyphs, typed characters,
   counters, timecodes: evaluate at `K.frameQuant(t, ctx.fps)` so all
   motion-blur sub-samples of one frame agree (no double exposures).
5. **Register what QA needs** in `build`:
   `ctx.qa.text(label, {box, size (cap px), fg, bg, lines?, decorative?, bleed?})`
   for every readable text; `ctx.qa.hit(t, label)` for every beat landing;
   `ctx.qa.keyframe(t, label)` for 8–18 pre-pass stills (include t=0 and last frame).
6. **Palette discipline.** Only palette tokens (plus neutral greys). Overlapping
   accent layers use `globalCompositeOperation = 'lighten'` (or 'multiply' on
   light grounds) so inks never mix into a third hue.
7. **Adapt to format.** Derive every size from `ctx.W/ctx.H` (`unit =
   min(W,H)/1080`), margins from `ctx.grid`. Test square, landscape, vertical.
8. **Loops.** If `loop: true`, frame 0 must equal the last frame byte-for-byte:
   make the tail a static hold identical to t=0 (springs settle exactly).
9. **Fast motion** (whip pans, fly-throughs): return `samplesHint(t)` (e.g. 32)
   for those windows rather than faking blur.
10. **Content comes from the spec.** Never hard-code copy; everything readable
    is in `content` with a schema (maxLength etc.) so agents get clear errors.
    The engine passes `spec.content` merged only with `defaults.content` (if
    the template declares one) — never with `example.content`, so an omitted
    optional field is simply absent. Handle absence explicitly.
11. **Derived palette tokens.** If the look legitimately creates new colours
    (riso-print's ink overprints), add them to `ctx.palette` in `build` under
    new keys so palette QA checks the real inks instead of being disabled.
12. **Kit extensions** a template needs go in a new `src/kit/x-<name>.js`
    imported directly; promote into the kit only when a second template needs it.

## The loop you must run

```
kinetype validate examples/<id>.json
kinetype stills examples/<id>.json      # LOOK at out/<name>/stills/contact-sheet.png
# fix cramped type, collisions, orphans, low contrast, weak hierarchy — repeat
kinetype render examples/<id>.json --workers 3
# verdict must be "pass"; watch filmstrips: ffmpeg ... tile=6x5
```

Design bar: poster-grade hierarchy, ink-aligned edges, baseline grid, one idea
per beat, springs with honest damping (no cartoon bounce), no clichés (brains,
robots, particles, sparkles, neon HUD, glassmorphism, soft gradients unless the
template's identity is built on them).
