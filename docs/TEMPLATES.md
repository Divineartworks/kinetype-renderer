# Template catalog


| template | what it is | formats | loops |
|---|---|---|---|
| [`ascii-cam`](#ascii-cam) | Your footage rendered as live typography: a glyph field that tracks the video, resolution punches on the beat, a scan band that reveals the real picture, and a headline carving through the field. | vertical, square, portrait, landscape | no |
| [`brand-card`](#brand-card) | Product-film glue shot: hook, benefit list, counting stat or call to action, with the brand logo and optionally a still of the real product UI (same frame as ui-demo) beside the type. | landscape, vertical, square, portrait | no |
| [`brutalist-terminal`](#brutalist-terminal) | Mono-grid command-line sequence: typed commands, sixteenth-note output, beat-filled ASCII progress bars, an inverted key line, and a heavy display statement that punches through the terminal. | landscape, square, vertical, portrait | no |
| [`countdown`](#countdown) | Top-N list sequence in three styles: slam (numerals fill through their own outline, titles slam, smash-pans), cinematic (dip-through-black, blur-in titles, letterbox, grain), stack (a leaderboard that builds: past entries drop into a growing ranked list). | landscape, square, vertical, portrait | no |
| [`echo-stack`](#echo-stack) | Loopable hype wall: one giant word tiled full-bleed into rows that ripple on every beat, solid/outline alternation, an accent band sweeping through the outlines, then a hard cut to a clean message lockup. | square, vertical, portrait, landscape | yes |
| [`editorial-serif`](#editorial-serif) | Magazine/documentary title card or pull-quote: high-contrast serif, a headline word that swaps to italic on the beat while its line reflows, hairline rules, mono section numbers, slow luxurious springs. | landscape, square, vertical, portrait | no |
| [`extrude-3d`](#extrude-3d) | Chunky extruded 3D type: solid letters with shaded side walls and a hard long shadow, swinging in space; words change with a staggered edge-on flip, letters nod on the beat and the card sways on bars. | square, landscape, vertical, portrait | no |
| [`glyph-morph`](#glyph-morph) | Words dissolve into their own luminous outlines, fling outward on curling paths and re-form as the next word; the solid type snaps back in with a flash, and every hold carries a sonar ripple through the letterforms on the beat. | square, landscape, vertical, portrait | no |
| [`kinetic-captions`](#kinetic-captions) | The speaker's own transcript as kinetic typography over talking-head/podcast footage. | vertical, landscape, square, portrait | no |
| [`liquid-type`](#liquid-type) | Hypnotic liquid typography: lines ripple as a displaced signal, beat shock waves travel down the frame, inks split into channels in motion and fuse back into perfectly crisp type at rest; lines melt out in viscous drips and condense in. | square, vertical, landscape, portrait | no |
| [`lower-third`](#lower-third) | Broadcast lower-third on a transparent background in three styles (broadcast plate system, editorial serif with scrim, kinetic skewed smash). | landscape, vertical, square, landscape-4k | no |
| [`lyric-cinema`](#lyric-cinema) | Cinematic lyric video for ballads/R&B: one serif line at a time with a feathered karaoke fill that follows each sung word, italic warm emphasis, next-line preview gliding into place, letterbox and film grain. | landscape, square, vertical, portrait | no |
| [`lyric-stack`](#lyric-stack) | High-energy kinetic lyric video: word-timed poster stacks (huge held/emphasised words, small connective words), sustain meters, beat punches, cut/smash-pan/wipe line changes. | vertical, square, portrait, landscape | no |
| [`marquee-bands`](#marquee-bands) | Loopable drop/event promo: 2–4 thick ticker bands cross at opposing angles, each text ticking on the beat with drawn separators; bands slam in, a title card punches in on bar 3 and holds, tickers brake to a freeze. | square, vertical, portrait, landscape | yes |
| [`riso-print`](#riso-print) | Two-colour risograph zine page that prints itself: halftone disc and hero word roll in, headline words stamp down like a press, per-beat print passes step the misregistration and grain. | square, portrait, vertical, landscape | no |
| [`sequence`](#sequence) | An edit: chain any templates as shots with designed transitions (cut, smash, push, zoom, dip, flash, iris, slice), beat-snapped boundaries, one song, per-shot footage backgrounds. | landscape, square, vertical, portrait | no |
| [`split-flap`](#split-flap) | Information board in three styles: terminal (Solari departures board, two-half flaps), arcade-led (glowing dot-matrix LED panel that scrambles into place), museum (warm light board, slow deliberate flaps). | landscape, square, vertical, portrait | no |
| [`street-poster`](#street-poster) | Loopable kinetic identity bumper: slam open, scramble-to-grid thesis, glyph-outline mask cut, typed prompt struck through into an underline, L-bracket handle lockup. | square, portrait, vertical, landscape | yes |
| [`swiss-grid`](#swiss-grid) | International Typographic Style chapter opener in three styles: classic (rolling red numeral, line-mask title, point modules on a flashing 12-column grid), brutal-grid (dark, thick rules, signal block numeral, slabs that drop), motion-poster (giant alternating-colour title, outline numeral that fills, overshooting reveals, slow push). | landscape, square, vertical, portrait | no |
| [`type-tunnel`](#type-tunnel) | Pseudo-3D flight down a tunnel of word rings: perspective glyph billboards with depth fog, beat-surging camera speed, bar rolls, counter-spinning rings, then a fly-through the finale word's own letterform into a hard lockup. | square, landscape, vertical, portrait | no |
| [`type-window`](#type-window) | Giant words as windows onto your footage: video plays only inside the letterforms, the camera flies through a stem into full-bleed footage, then collapses into the next word. | vertical, square, portrait, landscape | no |
| [`ui-demo`](#ui-demo) | A recorded product UI (kinetype capture) as a product-film shot: browser chrome or phone bezel on a calm ground, retimed, auto camera from events, human cursor, anchored callouts. | landscape, vertical, square, portrait | no |
| [`ui-stage`](#ui-stage) | Two or three recorded product UIs (kinetype captures) in one frame — phone + desktop + phone — each on its own clock, arranged solo/dual/triad/stack2/stack3 with animated focus, a story-clock chip, and cause→effect connectors between tracked elements of different devices. | landscape, vertical, square, portrait | no |

## ascii-cam

**ASCII Cam** — Your footage rendered as live typography: a glyph field that tracks the video, resolution punches on the beat, a scan band that reveals the real picture, and a headline carving through the field.


Tags: footage, music-video, glitch, type, social, intro · Default 16s @ 100 BPM · Palette tokens: `bg` #07080A, `ink` #EDEBE4, `a` #FF4D2E, `b` #3FD6C6, `mute` #7D7D7D · Font roles: `glyph` IBM Plex Mono 700, `display` Anton 400, `label` IBM Plex Mono 500

| content field | type | notes |
|---|---|---|
| `headline` | string ≤24 | 1–3 words that carve through the glyph field |
| `sub` | string ≤48 | Small mono line under the headline |
| `ramp` | string ≤40 | Glyphs to render with (any order: sorted by measured ink coverage). Default " .·:;-=+*x%#@" |
| `mode` | duotone \| mono | duotone: cool shadows, bright highlights; mono: one ink, tone by glyph density and alpha |

> Needs spec.media (id params.media, default "clip"). Best on footage with a clear subject and light: faces read at cell 11–14. Duration defaults to 16s (set spec.duration to match your clip).

Examples: `examples/ascii-cam-halftone.json`, `examples/ascii-cam-word-mosaic.json`, `examples/ascii-cam.json`

## brand-card

**Brand Card** — Product-film glue shot: hook, benefit list, counting stat or call to action, with the brand logo and optionally a still of the real product UI (same frame as ui-demo) beside the type. Light or brand-night ground.


Tags: product, brand, saas, hook, stat, cta, launch, film · Default 4s @ 120 BPM · Palette tokens: `bg` #F2F1ED, `night` #0F1626, `ink` #141518, `paper` #FFFFFF, `primary` #2F55E4, `accent` #E4572E, `mute` #5E6168 · Font roles: `display` Inter Tight 700, `text` Inter 500

| content field | type | notes |
|---|---|---|
| `mode` * | hook \| benefit \| stat \| cta |  |
| `logo` | string | spec.media id of the logo lockup (svg/png) |
| `logoNight` | string | logo for the night ground |
| `kicker` | string ≤28 |  |
| `headline` | string ≤48 |  |
| `lines` | array ≤3 items | benefit lines |
| `numerals` | boolean |  |
| `value` | string ≤12 | stat: "30", "2.5", "1 200" |
| `prefix` | string ≤4 |  |
| `suffix` | string ≤8 |  |
| `label` | string ≤60 |  |
| `footnote` | string ≤60 | small print, bottom-left (claims) |
| `cta` | string ≤24 | button label |
| `url` | string ≤40 |  |
| `product` | object | a still of the real product: {capture: media id, at: mark/step/s, frame?, crop? {x,y,w,h} CSS px} |

> Fields: hook {headline, kicker?}, benefit {lines, numerals?, headline?}, stat {value, label, prefix?, suffix?}, cta {headline, cta, url?}; any mode: logo, footnote, product. Product tile: right of the type (landscape) or below it (vertical/square). Logo and product pixels are exempt from palette QA. Last 0.9 s is a still hold. params.drift (default 0.012): the product tile (and a night ground's light) drift very slowly over the shot so no frame group is identical for > 5 s; the type never moves. QA static-hold (warn) when a settled type-only light card would hold > 5 s.

Examples: `examples/brand-card-benefit.json`, `examples/brand-card-cta-night-vertical.json`, `examples/brand-card-cta.json`, `examples/brand-card-hook-vertical.json`, `examples/brand-card-hook.json`, `examples/brand-card-stat.json`

## brutalist-terminal

**Brutalist Terminal** — Mono-grid command-line sequence: typed commands, sixteenth-note output, beat-filled ASCII progress bars, an inverted key line, and a heavy display statement that punches through the terminal. Dev/tech YouTube intros and explainers.


Tags: terminal, code, dev, tech, mono, explainer, intro · Default 16s @ 120 BPM · Palette tokens: `bg` #0A0A0A, `ink` #EDEDED, `dim` #6E6E6E, `a` #FF5A1F · Font roles: `mono` JetBrains Mono 500, `monoBold` JetBrains Mono 800, `display` Archivo Black 400, `crt` VT323 400, `typewriter` Courier Prime 400, `typewriterBold` Courier Prime 700

| content field | type | notes |
|---|---|---|
| `title` | string ≤40 | Header bar text (window title). |
| `prompt` | string ≤16 | Prompt before each command, e.g. "~/app $". |
| `steps` * | array ≤6 items |  |
| `statement` * | string ≤24 | Closing statement, 1–3 words, set huge. |
| `sub` | string ≤40 | Optional mono line under the statement. |

> ASCII is safest; any character missing from the mono font fails QA. Lines longer than the grid wrap. Duration is derived from the content unless the spec sets it.

Examples: `examples/brutalist-terminal-crt-phosphor.json`, `examples/brutalist-terminal-paper-teletype.json`, `examples/brutalist-terminal-vertical.json`, `examples/brutalist-terminal.json`

## countdown

**Countdown** — Top-N list sequence in three styles: slam (numerals fill through their own outline, titles slam, smash-pans), cinematic (dip-through-black, blur-in titles, letterbox, grain), stack (a leaderboard that builds: past entries drop into a growing ranked list). Rail, #1 hit, ranked recap. YouTube list videos, rankings, reveals.


Tags: list, ranking, top-n, youtube, reveal, sequence · Default 30s @ 120 BPM · Palette tokens: `bg` #0B0B0B, `ink` #F4F4F4, `dim` #9A9A9A, `a` #FFD400 · Font roles: `numeral` Anton 400, `title` Archivo Black 400, `mono` IBM Plex Mono 500

| content field | type | notes |
|---|---|---|
| `title` * | string ≤48 | Intro title, e.g. "5 EDITS THAT FEEL EXPENSIVE". |
| `kicker` | string ≤24 | Small mono label above the intro title. |
| `items` * | array ≤10 items | In RANK order: items[0] is #1. |
| `order` | desc \| asc | desc = count down N→1 (default), asc = 1→N. |

> items are given in rank order (#1 first). Duration = intro + items × beatsPerItem + recap, unless the spec sets duration.

Examples: `examples/countdown-cinematic.json`, `examples/countdown-stack.json`, `examples/countdown-vertical.json`, `examples/countdown.json`

## echo-stack

**Echo Stack** — Loopable hype wall: one giant word tiled full-bleed into rows that ripple on every beat, solid/outline alternation, an accent band sweeping through the outlines, then a hard cut to a clean message lockup. 24 beats (12s at 120 BPM).


Tags: hype, promo, music, sports, loop, bold, social · Default 12s @ 120 BPM · Palette tokens: `bg` #0B0B0B, `ink` #F2F2F2, `a` #FF3B1F · Font roles: `display` Anton 400, `mono` IBM Plex Mono 500

| content field | type | notes |
|---|---|---|
| `words` * | array ≤2 items | The word(s) tiled into the wall. Two words alternate by row. Short and loud: 3–8 letters is ideal. |
| `message` * | string ≤40 | The lockup line (auto-balanced over up to 3 lines). |
| `sub` | string ≤40 | Optional mono sub-label under the lockup (date, venue, handle). |

> Best with one 4–8 letter word. The wall bleeds off every edge by design (registered as bleed). Duration/bpm re-time all 24 beats proportionally.

Examples: `examples/echo-stack-arabic.json`, `examples/echo-stack-landscape.json`, `examples/echo-stack-outline-drift.json`, `examples/echo-stack-strobe.json`, `examples/echo-stack-vertical.json`, `examples/echo-stack.json`

## editorial-serif

**Editorial Serif** — Magazine/documentary title card or pull-quote: high-contrast serif, a headline word that swaps to italic on the beat while its line reflows, hairline rules, mono section numbers, slow luxurious springs. Modes: title | quote.


Tags: editorial, documentary, title, quote, serif, elegant, youtube, podcast · Default 10s @ 72 BPM · Palette tokens: `bg` #101010, `ink` #EDE6D6, `accent` #C8A15A, `muted` #9A9282 · Font roles: `serif` Instrument Serif 400, `italic` Instrument Serif 400, `mono` IBM Plex Mono 400

| content field | type | notes |
|---|---|---|
| `mode` | title \| quote | title: section number + headline + standfirst + byline. quote: hanging-mark pull quote + attribution. |
| `number` | string ≤8 | Section/issue number, e.g. "04" (rendered as N° 04). |
| `section` | string ≤32 | Section label, e.g. "THE LONG READ". |
| `headline` | string ≤80 | Title mode: 3–9 words, balanced into ≤3 lines. |
| `swap` | string ≤24 | Word of the headline that swaps to italic on the beat (default: the longest word). |
| `standfirst` | string ≤160 | Title mode: one or two sentences under the headline. |
| `byline` | string ≤60 | Title mode: credits line, e.g. "WORDS — S. LUND". |
| `quote` | string ≤220 | Quote mode: the quote, without quotation marks. Wrap words in *asterisks* to set them italic in the accent. |
| `attribution` | string ≤40 | Quote mode: who said it. |
| `role` | string ≤48 | Quote mode: their role / source. |

> Title mode wants 3–9 headline words; quote mode up to ~35 words (the size adapts). Mark quote emphasis with *asterisks*. Works on dark and light palettes (override bg/ink/accent/muted together).

Examples: `examples/editorial-serif-gallery.json`, `examples/editorial-serif-hindi.json`, `examples/editorial-serif-light-square.json`, `examples/editorial-serif-noir-quote-vertical.json`, `examples/editorial-serif-noir.json`, `examples/editorial-serif-quote-vertical.json`, `examples/editorial-serif.json`

## extrude-3d

**Extrude 3D** — Chunky extruded 3D type: solid letters with shaded side walls and a hard long shadow, swinging in space; words change with a staggered edge-on flip, letters nod on the beat and the card sways on bars.


Tags: 3d, bold, promo, intro, retro, social, loop · Default 12s @ 120 BPM · Palette tokens: `bg` #141414, `face` #F4EFE6, `side` #FF3B2F, `side2` #FFB400, `ink` #F4EFE6 · Font roles: `display` Archivo Black 400, `mono` IBM Plex Mono 500

| content field | type | notes |
|---|---|---|
| `cards` * | array ≤12 items | One card per entry, 1–3 words each (balanced over up to 2 lines). The last card holds to the end. |
| `sub` | string ≤40 | Optional flat mono line under the final card. |

> Chunky faces (Archivo Black, Anton) read best. Keep cards short: 1–2 words per line. The final card holds with a slow sway.

Examples: `examples/extrude-3d-landscape.json`, `examples/extrude-3d-neon-tube.json`, `examples/extrude-3d-stone.json`, `examples/extrude-3d-vertical.json`, `examples/extrude-3d.json`

## glyph-morph

**Glyph Morph** — Words dissolve into their own luminous outlines, fling outward on curling paths and re-form as the next word; the solid type snaps back in with a flash, and every hold carries a sonar ripple through the letterforms on the beat.


Tags: morph, outline, reveal, title, intro, wow, loop-friendly · Default 16s @ 100 BPM · Palette tokens: `bg` #08080A, `ink` #F4F1EA, `a` #FF4D2E, `dim` #8C8C8C · Font roles: `display` Archivo Black 400, `mono` IBM Plex Mono 500

| content field | type | notes |
|---|---|---|
| `words` * | array ≤8 items | Words (or short phrases) in order; each morphs into the next. |
| `final` | string ≤18 | Optional last word held at the end (appended after words). |
| `label` | string ≤40 | Optional mono label (bottom-left). |

> Duration is derived from the word count (intro + holds + morphs + outro) unless spec.duration is set. Short, heavy words morph best; 1–2 short words per entry in vertical.

Examples: `examples/glyph-morph-blueprint.json`, `examples/glyph-morph-ink-bleed.json`, `examples/glyph-morph-landscape.json`, `examples/glyph-morph-vertical.json`, `examples/glyph-morph.json`

## kinetic-captions

**Kinetic Captions** — The speaker's own transcript as kinetic typography over talking-head/podcast footage. Pick a LOOK (cover, neon, noir, poster, terminal, swiss, riso, cinema) and an ENERGY (calm, signature, wild): phrases cut at real pauses, words land as spoken, and every ~9 s a hero moment in that look's own style. Replaces plain subtitles.


Tags: captions, subtitles, podcast, talking-head, speech, transcript, footage, shorts · Default 30s @ 120 BPM · Palette tokens: `bg` #0B0B0B, `ink` #F4F1EA, `a` #E8B04A, `b` #E8B04A, `shade` #000000 · Font roles: `display` Anton 400, `text` Inter Tight 800, `textLight` Inter Tight 500, `mono` IBM Plex Mono 500, `monoBold` JetBrains Mono 800, `neon` Tilt Neon 400, `serif` Instrument Serif 400, `italic` Instrument Serif 400, `poster` Big Shoulders Display 900, `posterWide` Archivo Black 400, `stamp` Space Mono 700, `cinema` Cormorant Garamond 600, `cinemaItalic` Cormorant Garamond 600, `title` Cinzel 700, `riso` Syne 800, `hand` Kalam 700, `scrawl` Permanent Marker 400

| content field | type | notes |
|---|---|---|
| `words` * | array | Word-timed transcript (kinetype lyrics / transcribe output). Use wordsSrc to load from a file. |
| `heroes` | array | Times (s) whose phrase must be a hero line |
| `noHero` | array | Times (s) whose phrase must NOT be a hero line |
| `plates` | array | Background plates on hero words: the world BEHIND the speaker transforms (needs a person matte, or no footage at all). plate = a procedural id (fire, storm, rain, shatter, heartbeat, money, time, void, spotlight, bokeh) or {media: "<id>"} for b-roll declared in spec.media (use loop: true, duration: 8). |
| `loudness` | object | stage: the voice envelope {hop, values: 0..1} — drives a subtle pulse of the type (kinetype stage fills it) |
| `overlays` | array | Other templates embedded on the same timeline (e.g. lower-third name title, end card). Captions pause while an overlay has pauseCaptions. |

> Get words with `kinetype captions clip.mp4` (whisper.cpp word timing) or pass an existing transcript with --words. For hero words behind the speaker declare media.<id>.matte: true (Apple Vision, macOS; `kinetype captions` does it). Looks: cover (magazine cover: condensed gold type, giant word behind the head), neon (neon night: words as neon tubes that flicker on as spoken, giant sign behind the head lighting the speaker), noir (noir editorial: high-contrast serif, italic emphasis, black-and-white pull quotes), poster (street poster: torn paper strips, red stamped words, a wall of posters behind the head), terminal (terminal: phosphor mono captions typed as spoken, key words decrypt; hero = glitch hit, the speaker turns into live ASCII art), swiss (Swiss grid: paper plate on a rail, flush-left grotesk, one signal red, spoken numbers count in, hero splits the frame into grid panels), riso (riso zine: torn paper slips, two misregistered inks, the hero goes duotone halftone print), cinema (film: letterbox, serif subtitles that fill as spoken, trailer title card with lens flare), marker (handwritten marker: words write on as spoken, key words circled/underlined/highlighted, scrawled hero + arrow to the speaker). Overlays embed other templates (lower-third, editorial-serif…) on the same timeline.

Examples: `examples/kinetic-captions-cinema.json`, `examples/kinetic-captions-marker.json`, `examples/kinetic-captions-neon.json`, `examples/kinetic-captions-noir.json`, `examples/kinetic-captions-plates.json`, `examples/kinetic-captions-poster.json`, `examples/kinetic-captions-riso.json`, `examples/kinetic-captions-swiss.json`, `examples/kinetic-captions-terminal.json`, `examples/kinetic-captions.json`

## liquid-type

**Liquid Type** — Hypnotic liquid typography: lines ripple as a displaced signal, beat shock waves travel down the frame, inks split into channels in motion and fuse back into perfectly crisp type at rest; lines melt out in viscous drips and condense in.


Tags: liquid, distortion, signal, music, promo, intro, wow · Default 16s @ 110 BPM · Palette tokens: `bg` #0A0B0F, `ink` #F2F4F3, `a` #FF3D6E, `b` #3DE8E0, `dim` #8C8C8C · Font roles: `display` Unbounded 800, `mono` IBM Plex Mono 500

| content field | type | notes |
|---|---|---|
| `lines` * | array ≤8 items | Lines of 1–4 words, shown one at a time. |
| `final` | string ≤32 | Optional last line held crisp at the end. |
| `label` | string ≤40 | Optional mono label (top-left). |

> Each line: condense in (1 beat) → crisp (1) → liquid with beat shocks (4) → crisp (1) → melt out (1). Duration derives from the line count unless spec.duration is set.

Examples: `examples/liquid-type-heat-haze.json`, `examples/liquid-type-landscape.json`, `examples/liquid-type-mercury.json`, `examples/liquid-type-vertical.json`, `examples/liquid-type.json`

## lower-third

**Lower Third** — Broadcast lower-third on a transparent background in three styles (broadcast plate system, editorial serif with scrim, kinetic skewed smash). Name, role, handle; clean build-out. Safe-area aware for 16:9 and 9:16.


Tags: lower-third, overlay, alpha, broadcast, youtube, interview, name-super · Default 6s @ 120 BPM · Palette tokens: `bg` #5E6268, `plate` #0F0F10, `ink` #F7F7F5, `accent` #FFD23F, `accentInk` #111111, `chip` #F7F7F5, `chipInk` #111111 · Font roles: `name` Inter Tight 800, `role` Inter Tight 500, `mono` IBM Plex Mono 500, `serif` Instrument Serif 400

| content field | type | notes |
|---|---|---|
| `name` * | string ≤32 | Person / subject name (one line). |
| `role` | string ≤48 | Title or role (one line, typed in). |
| `handle` | string ≤24 | Social handle for the chip, e.g. "@techhalla". |
| `position` | bottom-left \| bottom-center \| top-left | Placement inside the title-safe area (9:16 avoids platform UI zones). |
| `uppercase` | boolean | Set the name in capitals (default false; kinetic defaults to true). |

> Render with render.transparent=true (formats mov-alpha / webm) to composite over footage. For a quick look without alpha, set render.transparent=false and params.preview="busy" or "dark". In 9:16 the group keeps clear of the bottom 20% and right 16% where platform UI sits. Styles change choreography, layout and palette defaults; spec.palette always wins.

Examples: `examples/lower-third-busy-preview.json`, `examples/lower-third-editorial.json`, `examples/lower-third-kinetic.json`, `examples/lower-third-vertical.json`, `examples/lower-third.json`

## lyric-cinema

**Lyric Cinema** — Cinematic lyric video for ballads/R&B: one serif line at a time with a feathered karaoke fill that follows each sung word, italic warm emphasis, next-line preview gliding into place, letterbox and film grain.


Tags: lyric, music, cinematic, elegant, ballad, karaoke, youtube · Default 24s @ 96 BPM · Palette tokens: `bg` #120E0B, `ink` #F3E6D3, `dim` #7A6B5D, `a` #E0A15E, `bar` #050403, `mute` #8F8577 · Font roles: `serif` Instrument Serif 400, `italic` Instrument Serif 400, `mono` IBM Plex Mono 500, `vhs` VT323 400

| content field | type | notes |
|---|---|---|
| `lyricsSrc` | string | Path (relative to the spec) of a word-timed lyrics JSON; inlined as content.lyrics |
| `lyrics` | object | Word-timed lyrics (docs/LYRICS_FORMAT.md). |
| `title` | string ≤48 |  |
| `artist` | string ≤48 |  |

> Duration defaults to last word end + params.tail. Word timing drives the fill sweep, so tight alignment matters more here than in lyric-stack.

Examples: `examples/lyric-cinema-silent-film.json`, `examples/lyric-cinema-vertical.json`, `examples/lyric-cinema-vhs.json`, `examples/lyric-cinema.json`

## lyric-stack

**Lyric Stack** — High-energy kinetic lyric video: word-timed poster stacks (huge held/emphasised words, small connective words), sustain meters, beat punches, cut/smash-pan/wipe line changes. Vertical-first, works in any format.


Tags: lyric, music, kinetic, poster, shorts, reels, youtube · Default 24s @ 96 BPM · Palette tokens: `bg` #0B0B0C, `ink` #F4F1EA, `a` #FF3B1F, `mute` #8C8C8C · Font roles: `display` Anton 400, `grotesk` Inter Tight 800, `mono` IBM Plex Mono 500

| content field | type | notes |
|---|---|---|
| `lyricsSrc` | string | Path (relative to the spec) of a word-timed lyrics JSON; inlined as content.lyrics |
| `lyrics` | object | Word-timed lyrics (docs/LYRICS_FORMAT.md). Use content.lyricsSrc to reference a JSON file instead. |
| `title` | string ≤40 | Song title (small corner label) |
| `artist` | string ≤40 | Artist (small corner label) |

> Duration defaults to the last word end + params.tail. With audio.analysis, punches follow the detected beats and scale with energy. Never more than one line block on screen except during a 0.3s transition.

Examples: `examples/lyric-stack-handbill.json`, `examples/lyric-stack-landscape.json`, `examples/lyric-stack-minimal.json`, `examples/lyric-stack-square.json`, `examples/lyric-stack.json`

## marquee-bands

**Marquee Bands** — Loopable drop/event promo: 2–4 thick ticker bands cross at opposing angles, each text ticking on the beat with drawn separators; bands slam in, a title card punches in on bar 3 and holds, tickers brake to a freeze. 32 beats (16s at 120 BPM).


Tags: promo, event, merch, drop, ticker, loop, bold · Default 16s @ 120 BPM · Palette tokens: `bg` #111111, `ink` #F2EFE8, `a` #FF4D00, `b` #FFE600 · Font roles: `display` Big Shoulders Display 900, `mono` IBM Plex Mono 500

| content field | type | notes |
|---|---|---|
| `bands` * | array ≤4 items | Ticker bands, top to bottom. Each repeats its text endlessly. |
| `title` * | string ≤24 | Card headline (1–3 words). |
| `subtitle` | string ≤36 | Mono line under the title (date, place, price). |

> Bands are ordered so the two accent colours never cross each other (they only ever cross ink/outline bands). Tickers stop dead from beat 30 so frame 0 equals the last frame.

Examples: `examples/marquee-bands-minimal.json`, `examples/marquee-bands-stack.json`, `examples/marquee-bands-vertical.json`, `examples/marquee-bands.json`

## riso-print

**Riso Print** — Two-colour risograph zine page that prints itself: halftone disc and hero word roll in, headline words stamp down like a press, per-beat print passes step the misregistration and grain. Paper ground, multiply overprint. 16 beats (10s at 96 BPM).


Tags: zine, print, editorial, poster, texture, music, event · Default 10s @ 96 BPM · Palette tokens: `bg` #F3EFE6, `a` #FF48B0, `b` #0078BF · Font roles: `display` Archivo Black 400, `stamp` Anton 400, `mono` Space Mono 700

| content field | type | notes |
|---|---|---|
| `headline` * | string ≤36 | 1–4 words, stamped one per beat, stacked flush-left. |
| `hero` | string ≤12 | The halftone hero word printed huge across the page (default: last headline word). 3–7 letters is ideal. |
| `subhead` | string ≤60 | One mono line under the stamps. |
| `labels` | array ≤4 items | Tiny mono labels along the foot of the page. |
| `issue` | string ≤4 | Issue number for the round stamp (e.g. "07"). |

> Readable text is printed as overprint (both drums), which is how riso gets a legible dark; pink alone never carries small text (contrast). Every beat is a print pass.

Examples: `examples/riso-print-botanical.json`, `examples/riso-print-gig-poster.json`, `examples/riso-print-landscape.json`, `examples/riso-print-vertical.json`, `examples/riso-print.json`

## sequence

**Sequence** — An edit: chain any templates as shots with designed transitions (cut, smash, push, zoom, dip, flash, iris, slice), beat-snapped boundaries, one song, per-shot footage backgrounds.


Tags: edit, sequence, youtube, intro, music, meta · Default 30s @ 120 BPM · Palette tokens: `bg` #0A0A0A, `flash` #F5F5F5 · Font roles: 

| content field | type | notes |
|---|---|---|
| `shots` * | array ≤24 items |  |


Examples: `examples/sequence.json`, `examples/ui-demo-sequence.json`

## split-flap

**Split-Flap Board** — Information board in three styles: terminal (Solari departures board, two-half flaps), arcade-led (glowing dot-matrix LED panel that scrambles into place), museum (warm light board, slow deliberate flaps). Rows ripple and land on beats, optional status column and a later update. Announcements, lists, stats, schedules.


Tags: board, list, announcement, mechanical, stats, schedule · Default 12s @ 120 BPM · Palette tokens: `bg` #0B0B0C, `housing` #131314, `card` #1C1C1D, `ink` #F2F2F0, `a` #FFB000, `b` #FF4130 · Font roles: `cell` Oswald 600, `label` IBM Plex Mono 500

| content field | type | notes |
|---|---|---|
| `title` | string ≤20 | Header row, flipped in the accent colour. |
| `columns` | object | Small mono column labels above the board. |
| `rows` * | array ≤6 items |  |
| `updateAt` | number | Beat at which rows with `then` flip again (default: 3 beats after the board settles). |

> Characters outside A–Z 0–9 . , : - / & ! ? ' # @ + % render as blanks. Text is upper-cased. Duration is derived from the content unless the spec sets it.

Examples: `examples/split-flap-led.json`, `examples/split-flap-museum.json`, `examples/split-flap-vertical.json`, `examples/split-flap.json`

## street-poster

**Street Poster** — Loopable kinetic identity bumper: slam open, scramble-to-grid thesis, glyph-outline mask cut, typed prompt struck through into an underline, L-bracket handle lockup. 40 beats (20s at 120 BPM).


Tags: bumper, identity, loop, poster, bold, social · Default 20s @ 120 BPM · Palette tokens: `bg` #0A0A0A, `a` #FF2BD6, `b` #B8FF00, `ink` #F5F5F5 · Font roles: `display` Archivo Black 400, `grotesk` Syne 800, `mono` IBM Plex Mono 500

| content field | type | notes |
|---|---|---|
| `open` * | string ≤28 | Cold-open slam, 1–3 words. First word is set huge. |
| `thesisA` * | string ≤40 | Thesis, up to 4 words; the LAST word is the scream line, a contraction/negation word is highlighted. |
| `thesisB` * | string ≤32 | Counter-thesis, 2–4 words; the last word lands alone in the accent colour. |
| `proof` * | string ≤32 | Rapid stack, "A > B" style; tokens stack one per beat. |
| `prompt` | array ≤3 items | Up to 3 mono lines typed in the terminal block. |
| `cta` * | string ≤28 | Call to action; last word is underlined by the rule. |
| `handle` * | string ≤18 | Brand handle for the lockup. |
| `crumbs` | array ≤8 items | Mono crumbs orbiting the terminal block and ticking in corners. |
| `highlight` | string | Word of thesisA to highlight (default: first word containing an apostrophe or NOT/NO) |


Examples: `examples/street-poster-acid-rave.json`, `examples/street-poster-brutal-mono.json`, `examples/techhalla-bumper-vertical.json`, `examples/techhalla-bumper.json`

## swiss-grid

**Swiss Grid** — International Typographic Style chapter opener in three styles: classic (rolling red numeral, line-mask title, point modules on a flashing 12-column grid), brutal-grid (dark, thick rules, signal block numeral, slabs that drop), motion-poster (giant alternating-colour title, outline numeral that fills, overshooting reveals, slow push). Landscape-first.


Tags: youtube, chapter, explainer, swiss, grid, light, editorial · Default 9.6s @ 100 BPM · Palette tokens: `bg` #F2F0EB, `ink` #111111, `signal` #E30613, `muted` #6E6C68 · Font roles: `display` Inter Tight 800, `text` Inter Tight 500

| content field | type | notes |
|---|---|---|
| `number` | string ≤3 | Chapter numeral, e.g. "03". Digits roll like a counter; other characters mask in. |
| `kicker` | string ≤32 | Small label above the grid, e.g. "CHAPTER THREE". |
| `title` * | string ≤60 | 1–6 words, set flush-left ragged, balanced into ≤3 lines. |
| `subtitle` | string ≤110 | One sentence under the title. |
| `points` | array ≤4 items | Up to 4 short points, one numbered module each. |
| `footer` | string ≤48 | Small footer label (source, series, URL). |

> Landscape is the reference layout (numeral left, text right, points in one row). Square and vertical stack numeral → title → points (2×2 / list). Keep the title to ≤6 words and points ≤ ~40 characters for the cleanest rag.

Examples: `examples/swiss-grid-brutal-grid-landscape.json`, `examples/swiss-grid-brutal-grid-square.json`, `examples/swiss-grid-brutal-grid-vertical.json`, `examples/swiss-grid-motion-poster-landscape.json`, `examples/swiss-grid-motion-poster-square.json`, `examples/swiss-grid-motion-poster-vertical.json`, `examples/swiss-grid-square.json`, `examples/swiss-grid-vertical.json`, `examples/swiss-grid.json`

## type-tunnel

**Type Tunnel** — Pseudo-3D flight down a tunnel of word rings: perspective glyph billboards with depth fog, beat-surging camera speed, bar rolls, counter-spinning rings, then a fly-through the finale word's own letterform into a hard lockup. 28 beats (14s at 120 BPM).


Tags: 3d, intro, hype, promo, music, tunnel, bold, social · Default 14s @ 120 BPM · Palette tokens: `bg` #07070A, `ink` #EDEDED, `a` #FF4A1C · Font roles: `ring` Anton 400, `display` Anton 400, `mono` IBM Plex Mono 500

| content field | type | notes |
|---|---|---|
| `words` * | array ≤12 items | Ring words, cycled ring by ring. Short uppercase words read best. |
| `finale` * | string ≤24 | The word(s) you fly through and land on (1–3 words). |
| `sub` | string ≤40 | Optional mono line typed under the lockup. |

> Best with 3–6 short ring words and a 1-word finale with at least one straight vertical stroke (I, T, H, L, E, N...) — the camera flies through its thickest stroke.

Examples: `examples/type-tunnel-corridor.json`, `examples/type-tunnel-helix.json`, `examples/type-tunnel-landscape.json`, `examples/type-tunnel-vertical.json`, `examples/type-tunnel.json`

## type-window

**Type Window** — Giant words as windows onto your footage: video plays only inside the letterforms, the camera flies through a stem into full-bleed footage, then collapses into the next word. Knockout mode cuts the word out of an accent plate over full-frame video.


Tags: footage, title, intro, music-video, mask, bold, social · Default 18s @ 100 BPM · Palette tokens: `bg` #0B0B0C, `ink` #F4F1EA, `a` #FF3B1F, `b` #2EC5FF, `mute` #8E8E8E · Font roles: `display` Anton 400, `mono` IBM Plex Mono 500

| content field | type | notes |
|---|---|---|
| `words` * | array ≤6 items | Each entry 1–3 words; each fills the frame as a window onto the footage |
| `sub` | string ≤48 | Small mono line under the final word |
| `mode` | window \| knockout | window (default): footage inside the letters on a solid ground, with fly-through; knockout: accent plate with the word cut out over full-frame footage |

> Needs spec.media with the footage id named by params.media (default "clip"). Short, fat words make the best windows; 1–3 words per entry. Vertical is the primary format for phone footage.

Examples: `examples/type-window-knockout.json`, `examples/type-window-prism.json`, `examples/type-window-shutter.json`, `examples/type-window.json`

## ui-demo

**UI Demo** — A recorded product UI (kinetype capture) as a product-film shot: browser chrome or phone bezel on a calm ground, retimed, auto camera from events, human cursor, anchored callouts.


Tags: product, demo, ui, screen-recording · Default 10s @ 120 BPM · Palette tokens: `bg` #E9E7E2, `night` #D9D6CF, `ink` #15161A, `paper` #FBFAF8, `chrome` #F3F2EF, `chromeInk` #5D6067, `accent` #2F55E4 · Font roles: `label` Inter Tight 600, `url` Inter 500

| content field | type | notes |
|---|---|---|
| `capture` * | string | spec.media id of the capture |
| `frame` | browser \| phone \| bare |  |
| `urlLabel` | string ≤48 |  |
| `range` | object |  |
| `retime` | array ≤32 items | {from,to,speed} \| {at,hold} (freeze just before at); capture clock |
| `camera` | any | auto \| wide \| [{at, zoom, focus}] |
| `callouts` | array ≤12 items |  |
| `footnote` | string ≤60 |  |
| `cursor` | object |  |

> spec.media.<id>.capture → capture.json (frames, else its video). Duration = range + retime (+ callout reading holds unless autoHold false). Auto camera from events; navigation/scroll go wide. Callouts ≤ 5 words, named before a click. Ground: night when palette.night is dark. Captured UI is exempt from palette QA. Use render.shutter 0.5. Focus (D20): a callout whose target is an `observe` step makes that element a camera focus (zoom frames the whole box with context; the shot and the ring stay for the callout's `duration`). params.drift (default 0.05) keeps any hold > 2.5 s alive with a slow push-in about the focus (never past zoomMax); the static-hold check fails a > 5 s frozen run. Camera edges snap to the capture's edge within 12 % and avoid slicing known cards; callout plates avoid other known elements and the window when possible (planning knows element boxes, not pixels); overlay-contrast checks callout, footnote and URL label at 4.5:1.

Examples: `examples/ui-demo-phone.json`, `examples/ui-demo-vertical.json`, `examples/ui-demo.json`

## ui-stage

**UI Stage** — Two or three recorded product UIs (kinetype captures) in one frame — phone + desktop + phone — each on its own clock, arranged solo/dual/triad/stack2/stack3 with animated focus, a story-clock chip, and cause→effect connectors between tracked elements of different devices.


Tags: product, demo, ui, screen-recording, multi-device, split-screen · Default 10s @ 120 BPM · Palette tokens: `bg` #E9E7E2, `night` #D9D6CF, `ink` #15161A, `paper` #FBFAF8, `chrome` #F3F2EF, `chromeInk` #5D6067, `accent` #2F55E4 · Font roles: `label` Inter Tight 600, `url` Inter 500

| content field | type | notes |
|---|---|---|
| `panels` * | array ≤3 items |  |
| `layout` | array ≤24 items |  |
| `clock` | object |  |
| `connectors` | array ≤6 items |  |
| `dimUnfocused` | number |  |
| `footnote` | string ≤60 |  |

> Panels = captures (spec.media.<id>.capture). Each panel: range/retime/callouts/cursor as ui-demo, plus start (film s), crop (CSS region), label. Times in layout/clock/connectors: seconds or "panel:mark[+s]". Arrangements: solo, dual, triad (row), stack2, stack3 (column; use with bandBottom for 9:16 captions). Panel camera = screen zoom; focus panels never show body text under params.legibility px. Connectors and highlights are fail-closed: an endpoint that is covered/off-screen is never drawn and FAILS the verdict. Use render.shutter 0.5.

Examples: `examples/ui-stage-vertical.json`, `examples/ui-stage.json`
