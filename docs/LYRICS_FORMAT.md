# Word-timed lyrics (`content.lyrics`)

Lyric templates read `content.lyrics` (inline) or `content.lyricsSrc` (a JSON
file relative to the spec, inlined at resolve time):

```json
{
  "lines": [
    { "start": 12.40, "end": 15.10,
      "words": [ {"text": "Hold", "start": 12.40, "end": 12.71},
                 {"text": "the",  "start": 12.71, "end": 12.85},
                 {"text": "line", "start": 12.85, "end": 13.60, "emph": true} ] }
  ],
  "source": "lrc|srt|whisper|manual", "confidence": 0.0-1.0
}
```

Times are seconds on the VIDEO timeline (already shifted by `audio.start`).
`emph` is optional (templates may also infer emphasis from duration/energy).
Produce it with `kinetype lyrics <lyrics.txt|song.lrc|song.srt> --audio song.mp3`.
If `audio.analysis` is given, `ctx.audio` carries `beats`, `downbeats`,
`onsets` and `energy {hop, t0, values[0..1]}` on the same timeline.
