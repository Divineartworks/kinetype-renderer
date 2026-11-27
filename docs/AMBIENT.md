# Ambient: calm, seamless meditation loops

`kinetype ambient` renders long, silent, seamless video loops (sleep, breathing, contemplation) from GLSL
fragment shaders running on the GPU in headless Chrome. Every frame is a pure function of
`(preset, seed, frame index, frame count)`, so renders are reproducible byte for byte and the loop seam
is closed by construction. There is no audio anywhere in this module.

Code: `src/ambient/` (page, presets, render, calm QA, manifest, variation, cli). Depth maps for
living stills come from `scripts/ambient-depth.py`, which runs on another host.

## Loop by construction

The page passes `u_phase = (frame mod N) / N` and `u_frame = frame mod N`, so the wrapped sequence repeats exactly.
The seam check also renders frame N UNWRAPPED (`u_phase = 1.0`) to prove the shader itself is periodic. A shader stays closed if it follows these rules:

- **Integer harmonics.** Every time input is a point on a circle driven by `u_phase` with an integer number of
  cycles per loop (`osc(k, offset)`, `loopc(k, offset)` in `glsl/common.js`). Noise is 4D simplex, sampled on
  that circle in two of its dimensions, so it is periodic too.
- **Stateless particles.** Motes and stars are a function of `(index, u_phase)`; nothing accumulates. A particle
  rises an integer number of times per loop (`fract(h + u_phase * k)`).
- **Periodic star fields.** A panning layer repeats every P cells and pans exactly P cells per loop.
- **Breathing at a fixed rate.** Breath cycles per loop are rounded to a whole number (about 6 per minute).
- No `u_frame`-dependent branching that does not wrap, no accumulation buffers, no feedback.

`seamCheck` verifies it with `u_qa = 1` (a uniform that switches off the per-frame grain and dither in `finish()`,
so only motion is measured): (a) frame N rendered unwrapped (`u_phase = N/N = 1.0`) equals frame 0 within a max
absolute byte difference of 1 (float noise; the max is reported as `frameNmaxDiff`); (b) the mean frame-to-frame
difference across the real seam (wrapped frames N-1 to 0) is no bigger than inside the loop. A test-only preset whose
time is not loop-closed fails both.

## Preset authoring contract

A preset is `src/ambient/presets/<id>.js` exporting:

```js
export const FRAG = `...`;      // GLSL body appended to glsl/common.js; must write `o`
export const meta = {
  id, title,
  family: 'generative' | 'living-still',
  formats: ['16:9'], pillars: [...], mood: [...],
  loopSeconds: 600,
  params: { name: { default, min, max, uniform: 'u_p0.x', doc } },   // u_p0..u_p5, 24 floats
  images: 0 | 2,                 // 2 = still + depth (u_tex0, u_tex1, u_texres)
};
```

Keep `FRAG` as one template literal in exactly that form: tuned shaders are re-synced by copying the literal.
Register the module in `presets/index.js`. Uniforms available: `u_res`, `u_phase`, `u_frame`, `u_loop`, `u_seed`
(4 randoms from the seed), `u_p0..u_p5`, `u_stats` (still black/white point, linear luma), `u_avg` (still mean linear colour), `u_tex0/1`, `u_texres`. Finish with `finish(col, grain)` (sRGB, grain,
triangular IGN dither: no banding on dark gradients). Add the new preset to the GPU test loop (it picks up every
`generative` preset automatically). `glsl/common.js` carries the 4D simplex noise (Ian McEwan, Stefan Gustavson,
Ashima Arts, MIT licence); keep the attribution.

Presets: `aurora-veil`, `cosmos-drift` (generative, no params, the seed varies structure and palette),
`breath-mandala` (one param, `pulse`, below) and `living-still` (one generated still with depth parallax, mist, rays, motes; needs
`--images still.png,depth.png`).

Named params (`--params entry.json`, camelCase; 0 = the shader's built-in default unless noted):
- `breath-mandala`: `pulse` (u_p0.x) breathing amplitude, 1 = breathing guide, 0.001 = still variant for sleep/long-form.
- `living-still` u_p0..u_p3: `camAmp`, `focus`, `mist`, `motes`; `lightX`, `lightY`, `rays`, `warmth`; `horizonY`,
  `mistHeight`, `ripple`; `targetAPL`, `contrast`, `twinkle`.
- `living-still` u_p4 grade: `neutralize`, `split`, `clarity` (0-1, 0 = untouched), `coolWarm` (-1 cool .. 1 warm).
- `living-still` u_p5 breath light: `breath` (strength, 0 = off), `breathX`, `breathY` (centre, default 0.5), `breathRadius` (default 0.06).
- The page also measures the still (`u_stats`, `u_avg`) when texture 0 loads; the auto grade reads them.

## CLI

```
kinetype ambient list
kinetype ambient render <preset> [--seed N --loop 600 --fps 30 --res 1080|2160 --images still,depth
                                  --p0 a,b,c,d .. --p5 .. --params entry.json --out DIR]
kinetype ambient clip   <preset> --seconds S [--start T] [--step K]     K > 1 = time-lapse
kinetype ambient sheet  <preset> [--seeds 1-20]
kinetype ambient strip  <preset> [--seed N]
kinetype ambient qa     <file.mp4>
kinetype ambient bench  <preset>
kinetype ambient randomize [--count N --seed S --presets a,b]
kinetype ambient breed  <a.json> <b.json> [--seed S]
```

`render` produces, in `--out` (default `out/ambient/<preset>`):

- `<preset>-s<seed>-loop<S>s-<H>p.mp4`: the master. 10-bit HEVC (`hevc_videotoolbox` main10 when ffmpeg has it,
  else `libx265`), keyframe at frame 0, no audio.
  Colour: RGB to YUV with the BT.709 matrix, limited (tv) range (`scale=out_color_matrix=bt709:out_range=tv`), tagged
  `colorspace/primaries/trc = bt709`, `color_range = tv` (checked with ffprobe). `clip` review videos are tagged the same way.
- `....visual_loop.json` (`visual_loop/v1`: preset, seed, mode, file, sha256, frames, duration_s probed from the file,
  loop_s = frames / fps, size, fps, pix_fmt, codec, color_space/primaries/transfer/range, params, calm_qa, receipt;
  living stills add `still_sha256` and `depth_sha256`) and `....receipt.json` (kinetype git sha and dirty flag,
  sha256 of COMMON + FRAG as compiled, ffmpeg version line, Chrome version, sha256 of every input image, ffprobe facts,
  the analysed file sha and frame count, command args, timings, renderer, metrics, seam).
- Calm QA runs on the ENCODED MASTER itself (the whole loop decoded at 320x180; the master is real time, so the
  per-second metrics are per real-time second). The decoded frame count must equal `round(loop_s * fps)`.
- Atomic: the master is encoded to `<name>.partial.mp4` and renamed only after analysis; any failure deletes the
  partial and writes no manifest. The manifest is written last with the gate's status.
- Exit code 2 when calm QA fails or flags are invalid (a `--seed` that is not a non-negative integer is rejected
  before rendering). On a QA fail the master is kept and the manifest says `fail`.

`randomize` and `breed` print `{preset, seed, params}` entries; pass one back with `--params entry.json`.
Params are drawn inside each preset's `[min, max]`; the RNG is `src/kit/rng.js`, so the same seed gives the same list.
`breed` is uniform crossover plus a small mutation, same preset only.

## Calm QA

Decoded at 320x180; the gate runs on the metrics of the encoded master plus the seam check. The gate fails closed: missing
or non-finite metrics, fewer than 2 s of frames, a missing seam check or a decoded frame count that differs from
`round(loop_s * fps)` are failures. `lum_rate` is computed for any clip longer than 1 s.

| Rule | Limit | Why |
| --- | --- | --- |
| `flash_pairs` | 0 | WCAG 2.3.1 allows up to 3 flashes per second; for sleep content we allow none. See the formulas below. |
| `red_flash_pairs` | 0 | WCAG 2.x red flash, same count of zero, because red flashes are the worst case for photosensitivity. |
| `lum_rate_per_s` | <= 0.02 | Largest change of mean luminance over any 1 s window. Keeps the room from pulsing. Absolute units: mean sRGB-linear relative luminance, 0 to 1. |
| `motion_mean` | <= 2.0 | Mean absolute frame difference of the 8-bit luma (gamma-encoded) values; slow drift, never fast motion. Absolute, not relative to brightness. |
| seam | frame N (unwrapped) == frame 0 within 1 byte, `acrossSeam <= 1.5 * max(before, after) + 0.02` | No visible join when the video repeats. |

Exact formulas (all on 320x180 frames, 4x4 tiles, so a tile is 6.25 % of the frame; WCAG uses 25 % of a 10 degree field, so this is stricter):

- Linearisation: 8-bit sRGB to linear with the sRGB piecewise curve (as in the WCAG relative-luminance definition).
  `L = 0.2126 R + 0.7152 G + 0.0722 B`, tile value = mean `L` over the tile.
- General flash: opposing luminance changes (a rise and a fall, or the reverse) each of at least 0.10, which is 10 % of
  the maximum relative luminance (1.0), inside 1 s, where the darkest state of the pair is below 0.80.
- Red flash: a pixel counts when it is saturated red, `R/(R+G+B) >= 0.8` (linear), with value `max(0, R - G - B)`; the
  WCAG technical note scales that by 320 and calls a change of more than 20 units a transition, so in linear units the
  tile mean must swing by more than 20/320 = 0.0625, again as an opposing pair inside 1 s.

Everything is in `LIMITS` in `calmqa.js`. The swing detector is a zigzag with a 10 % threshold, so a slow breath
(seconds long) is never counted and a fast swing is. The tile test is stricter than WCAG (a tile is 6.25 % of the
frame, WCAG uses 25 %).

## Measured (prototype, M4 Pro)

- Readback and transfer without an encoder: 98.6 fps at 1080p, 28.9 fps at 4K.
- HEVC loop encode (videotoolbox): 36 fps at 1080p.
- GPU time per frame at 1080p: 2 to 12 ms depending on the preset.
- Transfer detail: frames are posted as `Blob` bodies, six in flight, with a periodic `window.gc()`. `Uint8Array`
  bodies were measured 25x slower, and without the `gc()` the renderer's blob quota fails with "Failed to fetch".
- Port check (this module, 20 s loop at 1080p, breath-mandala): loop encode 6.7 s, whole `render` 28 s
  (loop, seam, 20 s clip, QA, manifest).

## Known follow-ups

- The bt709 transfer tag follows the delivery spec; the shaders output sRGB (piecewise) while BT.709 camera gamma is
  slightly different. Players read it as bt709 either way, so it is a tag, not a conversion.
- `living-still` depth maps are made off-host (`scripts/ambient-depth.py`, Depth Anything V2 Small, onnxruntime).
