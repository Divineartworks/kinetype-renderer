# kinetype

A deterministic, template-driven kinetic typography engine. You write a JSON
spec: template, copy, format, palette, tempo, optional song and lyrics. kinetype
renders a frame-exact, motion-blurred video with a QA verdict and a receipt.
Humans use the CLI and live preview. Agents use the same verbs through MCP.

```
kinetype templates                         # what can I make?
kinetype example street-poster > my.json   # start from a working spec
kinetype stills my.json                    # pre-pass: keyframes + contact sheet + layout QA
kinetype render my.json                    # mp4 (+ prores / webm / alpha mov) + receipt.json
kinetype render my.json --draft            # fast iteration render (half size, out/<name>/draft/), never a delivery
kinetype preview my.json                   # live, scrubbable, hot-reloading
kinetype html my.json                      # one self-contained HTML with window.seek(t)
```

Catalog with previews: [docs/TEMPLATES.md](docs/TEMPLATES.md).

| template | use it for |
|---|---|
| `kinetic-captions` | **podcasts / talking heads**: the speaker's own transcript as kinetic typography in 9 looks (cover, neon, noir, poster, terminal, swiss, riso, cinema, marker) × 3 energies, hero words behind the speaker, 16:9 split layout |
| `sequence` | **an edit**: chain any templates as shots with 8 designed transitions, beat-snapped cuts, one song, per-shot footage |
| `street-poster` | loopable identity bumper: slam open, scramble-to-grid thesis, fly-through-the-letter cut, prompt struck into an underline, L-bracket lockup |
| `type-tunnel` | pseudo-3D flight down a tunnel of word rings, fly through the finale word, hard lockup |
| `glyph-morph` | words dissolve into their own outlines and re-draw themselves as the next word |
| `liquid-type` | type as liquid signal: flow-field slices, beat shock waves, melt/condense between lines |
| `extrude-3d` | chunky extruded 3D letters that flip between words, long shadows |
| `type-window` | your footage playing inside giant letterforms, flying through to full-bleed (or a knockout plate) |
| `ascii-cam` | your footage rendered AS typography (glyph density field) with a scan band revealing the real video |
| `lyric-stack` | high-energy lyric video: word-timed poster stacks, held-note ripples, beat punches |
| `lyric-cinema` | ballad/R&B lyric video: one serif line, karaoke fill-sweep per sung word, letterbox, grain |
| `swiss-grid` | YouTube chapter opener in the International Typographic Style (styles: classic, brutal-grid, motion-poster) |
| `editorial-serif` | documentary title card or pull-quote with hanging punctuation and an italic word swap |
| `lower-third` | name super with real alpha for overlays (styles: broadcast, editorial, kinetic) |
| `countdown` | Top-N list: numerals filled through their own outline (styles: slam, cinematic, stack) |
| `split-flap` | departures board with real two-half flaps (styles: terminal, arcade-led, museum) |
| `brutalist-terminal` | dev/tech intro: typed commands, beat-filled progress bars, a statement punching through |
| `echo-stack` | loopable hype wall of a giant word rippling on the beat, cut to lockup |
| `marquee-bands` | loopable drop/event promo: crossing ticker bands locked to tempo |
| `riso-print` | risograph zine: halftone drums, true overprint third colour, press-stamped type |

## Product UI: record a real app, frame-exact

    kinetype capture flow.json --out DIR --base-url http://127.0.0.1:PORT --font-dir fonts/
    kinetype capture --validate DIR/capture.json
    kinetype capture --sheet DIR        # labelled contact sheet, one frame per step
    kinetype explore <url> --goal "..." --out DIR [--seconds 45] [--device desktop|phone] [--base-url URL]
                                        # an agent uses the live app, narrates what it SEES, writes DIR/flow.json +
                                        # narration.json + explore.log.json (claim-guarded, cold-start verified)

A `kinetype.flow.v1` file (goto / click / type / fill / press / hover / scroll / wait / waitFor / mark,
targets by role+name, selector or text) is run against a LIVE app in headless Chrome. Every frame is
a compositor `beginFrame` on a virtual clock, so the capture is the same on a loaded host as on an
idle one. Output: `frames/` (JPEG), `capture.mp4`, `capture.json` (`kinetype.capture.v1`: events
with CSS-px points/boxes, marks, per-step start/end), `receipt.json` (frame hashes, dropped-frame QA,
console/HTTP errors). A `click` step may carry `files` (paths relative to the flow file): the click opens
the page's native file chooser (camera/photo inputs) and the capture answers it with those files; the receipt
lists each upload's sha256. The OS cursor is never in the frames. Point it at an isolated demo instance,
never production. MCP: `capture_flow`.

## Why it looks the way it does

- **Every frame is `seek(t)`.** Compositions are pure functions of time on a
  canvas. There are no CSS transitions, timers or carried state. Frames render
  out of order on parallel workers, and each is hashed. A determinism probe
  re-renders frames on another worker and requires identical bytes. For loops,
  frame 0 must equal the last frame byte for byte.
- **Type is drawn from outlines.** Fonts are parsed with opentype.js, and each
  glyph is a path. That gives optical kerning with a no-collision guarantee at
  -80 tracking, and ink-edge alignment. Symbols such as @ # & are sized to cap
  height. Letterforms can also act as masks. The street-poster cut flies the
  camera through the I of the outgoing word into the next poster.
- **Motion is closed-form springs, stacked.** Each retarget adds one exact
  step response, so motion is identical at any seek order and settles to the
  exact value. Moves are authored in beats (BPM grid or a song's measured beats).
- **Motion blur is real.** Frames are rendered as sub-frames with a trailing
  shutter and averaged in float space. Templates request more samples on whip
  pans and fly-throughs, rather than faking the blur.
- **QA is part of the render.** It covers safe areas, WCAG contrast, minimum
  size, orphans, and whether every required beat has a registered hit. It also
  checks the loop seam and palette discipline: saturated pixels must stay near
  the palette's hues. The verdict and the evidence are written to
  `receipt.json`.

## Podcasts: kinetic captions of the speaker's own words

    kinetype captions episode.mp4 --energy signature --render

turns a talking-head or podcast video into an episode whose subtitles ARE the
kinetic typography. Every word is the speaker's own, landing as spoken, with
stressed words set big and hero lines going giant (behind the speaker via Apple
Vision person mattes, or in front, clear of the face). A `split` layout puts
vertical phone footage in a 16:9 frame with a live typographic column.
`--look` picks the visual identity: cover (default), neon, noir, poster,
terminal, swiss, riso, cinema or marker. Each has its own type, colours, footage
treatment and hero moment. `--energy calm|signature|wild` sets how loud it is. `signature` is the default:
clean captions, plus a hero moment every ~9 s with a giant word behind the
head, a camera punch-in and a flash. `--words` reuses an existing transcript.
Agents call the same thing as the MCP tool `caption_video`.

### Hook + cold open + spike moments, then the normal captions roll

    kinetype direct clean.mp4 --words transcript.json --title "Her Approval" --out plan.json
    kinetype compose plan.json --base the-normal-captioned-episode.mp4

The director picks the moments where kinetic typography takes over:
- a hook in the opening seconds
- a cold open of the best line (title drops win)
- a few spikes on the strongest lines

Every cut lands in a measured silence. compose renders only those windows and
splices them into the existing video. It matches the base's timing and colour
grade automatically and verifies that untouched frames are unchanged, then
writes a receipt and a review sheet. Agents use `direct_captions` and
`compose_captions`.

### Series, covers, relight

    kinetype mine episode.mp4 --words t.json --render      # best shorts, each ending on a "Part n" teaser
    kinetype cover episode.mp4 --words t.json --title "…"  # best frame + key word giant behind the head
    kinetype relight episode.mp4 --out lit.mp4             # soft key light on the speaker, room falls off

Add `--plates auto` to `direct` or `mine` so that hero words like "fire" or
"storm" turn the room behind the speaker into that world.

## Edits, footage, styles

- `sequence` chains any templates as shots (8 designed transitions, beat-snapped
  cuts, one song) — a whole intro/edit from one spec.
- `media` + `background` put any template over your footage; `type-window` and
  `ascii-cam` are built on footage.
- `params.style` presets give several templates different choreographies for the
  same copy.

## Music and lyrics

```
kinetype audio analyze song.mp3            # tempo grid, beats, downbeats, energy (librosa; beat_this if installed)
kinetype lyrics lyrics.txt --audio song.mp3  # word-timed lyrics via whisper.cpp force-alignment (.lrc/.srt too)
```

Reference them from the spec (`audio.src`, `audio.analysis`, `audio.start`,
`content.lyricsSrc`). The song is muxed into the output, and templates lock to
its real beats.

## For agents

- MCP server: `node /path/to/kinetype/src/mcp/server.js`. Tools:
  `list_templates`, `describe_template`, `validate_spec`, `render_stills`
  (returns the contact sheet as an image), `render_video` (with progress),
  `build_html`, `analyze_audio`, `build_lyrics`.
  - Claude Code: `claude mcp add kinetype -- node /path/to/kinetype/src/mcp/server.js`
- New templates: [docs/TEMPLATE_AUTHORING.md](docs/TEMPLATE_AUTHORING.md). Add a
  folder and it is registered. `kinetype check` verifies seek-purity for every
  example.

## Install

1. Node 20 or newer, and ffmpeg on your PATH.
2. `npm install` in this folder.
3. A headless Chrome. kinetype uses `playwright-core` with a system Chrome and
   never downloads one itself. Either install Google Chrome or Chromium (found
   automatically in the usual places) or fetch the Playwright build and point
   at it:

       npx playwright-core install chromium-headless-shell
       export KINETYPE_CHROME="$(ls -d ~/.cache/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell | tail -1)"

   On a Linux server without a GPU also `export KINETYPE_GL=0`.
4. Check: `node bin/kinetype.js check`.

### Use it from egentix-studio

    export EGENTIX_KINETYPE=/path/to/kinetype/bin/kinetype.js

The title-card skill then runs
`kinetype render spec.json --out DIR --formats mp4 [--draft]` with the
`editorial-serif` template.

## Requirements

Node >= 20, Chrome or Chromium (or set `KINETYPE_CHROME`), ffmpeg. Audio
analysis needs Python with librosa (`KINETYPE_PYTHON`). Lyrics alignment needs
whisper.cpp (`whisper-cli`) and a ggml model (`KINETYPE_WHISPER_MODEL`). The
Google Fonts it uses ship in `fonts/files`, pinned by SHA-256 in
`fonts/fonts.json`.

Tests: `npm test` and `node bin/kinetype.js check`. Design notes are in `docs/`.

## Licence

MIT, see [LICENSE](LICENSE). Copyright (c) 2026 BLACKFORGE AS.

### Third-party

Direct npm dependencies (full licence texts ship inside `node_modules`):

| Package | Licence |
|---|---|
| @modelcontextprotocol/sdk 1.32.2 | MIT |
| ajv 8.20.0 | MIT |
| esbuild 0.28.2 | MIT |
| harfbuzzjs 1.6.2 | MIT |
| opentype.js 2.0.0 | MIT |
| playwright-core 1.63.0 | Apache-2.0 |
| zod 4.6.7 | MIT |

Fonts: 34 files under SIL OFL 1.1 and 1 (Permanent Marker) under Apache-2.0.
See [fonts/LICENSES.md](fonts/LICENSES.md), [fonts/OFL.txt](fonts/OFL.txt) and
[fonts/APACHE-2.0.txt](fonts/APACHE-2.0.txt).
