# Real video: editing native phone recordings

`ui-demo` real mode turns NATIVE recordings of a real app (C2 v2: Android
emulator / phone via scrcpy, 60 fps, real keyboard, real scroll physics, real
OS chrome) into a product-ad edit: dead air out, typing at demo tempo, payoffs
held, narration beats landed on the action, a calm camera, refined touch
visuals, procedural sound design and a broadcast-clean mix. It replaces the
rejected "screenshots in fake device boards" look (ui-stage / hero r7–r8): the
recording IS the picture.

```
kinetype edit spec.json --pace-only     # pace report (fails on the LIVE pace rules)
kinetype edit spec.json --sound-only    # SFX + voice + ducked music → out/<name>/sound.wav (+ .mix-report.json)
kinetype edit spec.json --draft         # pace → sound → draft render (half size) with that audio
node bin/kinetype.js edit spec.json   # the full render
kinetype stills spec.json               # contact sheet: every tap, typing, payoff, caption, shot
```

## Input: C2 v2 (`kinetype.capture.v1` + fields)

| field | meaning |
|---|---|
| `clock: "wall"` | the video is real time (determinism = receipt hashes video + event log) |
| `video {src, fps, width, height}`, `device.video` | the native recording, constant 60 fps (e.g. 1080×2400) |
| `events[].vbox / vpoint` | geometry in VIDEO px (CSS `box`/`point` kept); else `box·s + (ox, oy)` via `mapping` |
| `events[].keys [{t, ch}]` | per-key times of a typed field (key-click SFX land on them) |
| `events[].track[].vbox` | the tracked target per frame — a tap whose target is covered draws nothing |
| `marks[].payoff`, `marks[].kind` | payoff moments (held, opened on) and their sound (`notify`, `success`, `counter`) |
| `idle [[t0,t1]]`, `busy [[t0,t1]]` | no meaningful pixel change / spinner-skeleton visible |
| `sessionOffset` | seconds from the session clock zero to video frame 0 (multi-device sync) |

`normalizeReal` (src/kit/x-real.js) maps all of it into VIDEO px and the v1
shape, so the existing x-ui planners (camera springs, tracks) run unchanged.
Until a device capture is available, `scripts/real-fixture.js` turns a
headless phone capture of `fixtures/real-app` (a fictional Norwegian trades
app) into C2 v2 fixtures (`fixtures/real/`).

## Spec

```json
{
  "template": "ui-demo", "format": "vertical", "fps": 30,
  "media": { "own": { "capture": "fixtures/real/owner/capture.json" }, "cust": { "capture": "fixtures/real/customer/capture.json" } },
  "content": {
    "session": { "devices": [{ "id": "owner", "capture": "own", "label": "Deg" }, { "id": "customer", "capture": "cust", "label": "Kunden" }], "clock": "14:02:05" },
    "retime": "auto",
    "open": { "at": "owner:approved", "dur": 1.2 },
    "edit": [
      { "device": "owner", "from": "owner:new-item", "to": "owner:sent" },
      { "split": ["customer", "owner"], "from": "customer:open", "to": "owner:approved+1" }
    ],
    "beats": [{ "at": "owner:send", "t": 6.4 }],
    "captions": [{ "at": "owner:new-item", "text": "Tillegg på sekunder" }]
  },
  "sound": { "voice": { "src": "vo.mp3" }, "music": { "src": "bed.mp3", "licence": "owner-supplied" }, "marks": { "approved": "notify" } },
  "render": { "shutter": 0.5 }
}
```

- `frame`: `"none"` (default in 9:16) = full-bleed: the screen fills the width, its own status bar
  kept, the camera pans vertically to the action (≤ 1.15× push — never past the source pixels).
  `"phone"` (default in 16:9) = a physically plausible phone on a calm ground; `params.phone`
  `slab` (default: thin graphite bezel, rim light, side keys) | `glass` (screen alone) | `silver`.
- `retime: "auto"` | `{mode: "auto", overrides: [...]}` | the classic list (`{from,to,speed}`, `{at,hold}`).
- `edit` (the shot list; `content.shots` is the engine's nested-template key): `{device, from, to}` or `{split: [a, b], from, to}` (a 2-up on the session clock);
  refs are mark/step ids or `"device:mark±s"`. Shots are joined by hard cuts.
- `beats`: narration beats `[{at: ref, t: film s}]` (from the voice's word timings).
- `open`: cold open on the payoff (`first payoff ≤ 3 s`).
- `captions`: Norwegian, ≤ 2 lines (balanced). 9:16: a plate in the bottom band (else top, else middle) that keeps off
  every UI target used during its window (decided once per caption, no jumping). 16:9: type on the
  ground right of the phone, beyond its widest push-in.
- `edit[].focus`: `{box: {x,y,w,h} (video px), at?: film s | ref, zoom?}` — a deliberate hold framing (e.g. end the
  ad held on the approved card instead of scrolling on).
- `params`: `focus` (16:9 push-in on the active region, default 2.0), `reveal` (16:9 working framing and payoff
  reveal, default 1.5, top-anchored; shots open on it as a cut), `splitZoom` (16:9 2-up, default 1.45, zoomed about
  the phones' top edge; device labels and the clock ride as plates in the bottom row), `tapPush` (full-bleed punch-in
  on a NARROW tapped target, ≤ 60 % of the width, default 1.1), `push` (payoff push in full-bleed, 1.08), `textCss`
  (16) + `legibility` (18 px), `touchR` (0.042 of the screen width), `touch` (false = no indicators), `clockChip`
  (`split` | `switch` (also 1.8 s after each device switch; on the browser toolbar in full-bleed) | `always` |
  `never`), `side` (0.36), `cameraGap` (2.2 s).

## Auto pace (LIVE_COMMON rules, machine-checked)

| rule | how |
|---|---|
| dead air (idle ∪ busy) ≤ 0.25 s | ≤ 0.25 s kept; ≤ 1 s sped to 0.25 s; > 1 s cut, keeping 0.12 s head + 0.10 s tail, 2-frame match dissolve (0.25/0.75) |
| no spinner > 0.3 s | busy is cut like idle → ≤ 0.22 s visible |
| typing ≤ 1.0 s per field | typing windows sped to 0.9 s (≤ 4×) |
| payoff held 0.6–1.2 s | payoff windows never sped; settled payoff frozen just before the next change if it would leave < 0.9 s |
| first payoff ≤ 3 s | `open` (cold open) — the report fails without it when the payoff is late |
| tap → visible change ≤ 2.5 s | measured from the idle ranges after each tap |
| 20 s ads: a change every 1.5–3 s | shot cuts + camera moves; fails in films ≤ 25 s |
| beats | a late mark → freeze on a frame that is static anyway (end of a dead stretch) or, failing that, a declared freeze; an early mark → plain play sped ≤ 2× |

`out/<name>/pace-report.json` lists every piece (kind, capture range, speed, film range, why),
cuts, camera keys and the metrics: first payoff, longest spinner, longest static picture,
per-field typing time, tap-feedback waits, payoff holds, cut cadence. The same checks are
template QA checks (`pace-*`), so a broken rule fails the render verdict.

## Picture

- **Camera** (`planRealCamera`): calm reframes on springs; each tap/typing target asks for
  max(legibility zoom, `focus`) and is never cropped (the zoom backs off to fit it); targets already
  framed need no move; payoffs reveal the whole screen (16:9) or push gently (9:16).
- **Legibility** (QA `legibility`, fail): UI body text (`textCss` × CSS→video × output scale × zoom)
  ≥ 18 px at every tap/typing moment.
- **Touch**: soft brand-tinted disc landing 40 ms before contact, 75 ms press, 380 ms ripple, centred
  exactly on `vpoint` (QA `touch-accuracy` re-derives the output point independently, ≤ 1 px; the
  pixel test measures the drawn disc's centroid). Swipes/scrolls: a short fading trail along the
  finger path. Never the OS "show taps" dots; no synthetic finger.
- **Multi-device**: a 2-up split on the session clock with device labels and a small clock chip
  (`HH:MM:SS` = `session.clock` + session time).

## Sound (src/audio/sfx/)

Procedural, original synthesis — no third-party samples, nothing to license: `tap`, `key` family
(per-key pitch/brightness/decay; space/backspace/enter variants), `swipe`, `notify`, `success`,
`tick`, `coin`, `whoosh-cut`. `placeSfx` places them from the film events the picture uses (taps,
each key at its key time, swipes, payoff/notify/counter marks). `mix`: voice first; music bed set to
−23 LUFS in the gaps and ducked −10 dB under speech (sidechain from the voice: 60 ms attack, 150 ms
hold, 350 ms release); SFX bus at −21 LUFS; master to −16 LUFS integrated, true peak ≤ −1.5 dBTP
(own limiter, measured with ffmpeg `ebur128`). The mix report lists every sound with its generator,
licence and count, the input files with sha256 (and the music licence), stems, duck depth.
