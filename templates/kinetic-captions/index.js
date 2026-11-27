// kinetype-capability: readable/1  (this file builds the readable look (buildReadable); the app's bridge probes the marker before it stamps plan.readable)
// kinetype-capability: personClean/2  (this file masks the look off him: drawClean / cleanPost; the app's bridge probes the marker)
// KINETIC CAPTIONS — the speaker's own words, as kinetic typography.
// Replaces ordinary subtitles on talking-head / podcast footage. Every word on
// screen is a transcript word and lands exactly when it is spoken.
//
// This file is the CORE, shared by every look: words → phrases cut at the
// speaker's own pauses, stress scoring, hero selection, the energy dial, the
// camera hit (punch-in / flash / shake), overlays and the draw order around
// the person cut-out. A LOOK (./looks/*.js) owns everything visual: fonts,
// palette, footage treatment, how captions move and what a hero moment is.
import * as K from '../../src/kit/index.js';
import { LOOKS, LOOK_IDS } from './looks/index.js';
import { PROFANE, prepareWords, phrasesOf, contentWord, isStop } from './speech.js';
import { createMatteCounter, personCleanVerdict, PERSON_CLEAN_APPLIED, PERSON_CLEAN_SKIPPED, READABLE_NOTE } from './personclean.js';
import { READABLE_LOOKS, READABLE_FONTS, READABLE_CHOKE, readableWanted, buildReadable } from './looks/readable.js';
import { PLATES, PLATE_IDS, plateFor, drawPlate } from './plates/index.js';

// ENERGY — how loud the design is. Readable captions are ALWAYS on screen; energy
// only decides how often a hero moment interrupts them and how hard it hits.
//   calm      — premium subtitles: rare heroes, small, no camera moves
//   signature — the default sweet spot: ~every 9 s a hero moment (giant word behind
//               the speaker's head or slammed into the free lower band), a camera
//               punch-in and a flash hit on the word; the rest stays clean
//   wild      — the poster/music-video version: frequent, huge, shaking giants
const ENERGY = {
  calm: { level: 0, heroEvery: 16, placement: 'front', frontCap: 0.13, behindCap: 0.2, punch: 0, flash: 0, shake: 0, frontEvery: 1 },
  signature: { level: 1, heroEvery: 9, placement: 'auto', frontCap: 0.2, behindCap: 0.2, punch: 0.075, flash: 0.13, shake: 0, frontEvery: 3 },
  wild: { level: 2, heroEvery: 5, placement: 'auto', frontCap: 0.25, behindCap: 0.3, punch: 0.13, flash: 0.22, shake: 1, frontEvery: 2 },
};

// every font role any look draws with; fontsFor() loads only the chosen look's
const FONTS = {
  display: { family: 'Anton', weight: 400 },
  text: { family: 'Inter Tight', weight: 800 },
  textLight: { family: 'Inter Tight', weight: 500 },
  mono: { family: 'IBM Plex Mono', weight: 500 },
  monoBold: { family: 'JetBrains Mono', weight: 800 },
  neon: { family: 'Tilt Neon', weight: 400 },
  serif: { family: 'Instrument Serif', weight: 400 },
  italic: { family: 'Instrument Serif', weight: 400, style: 'italic' },
  poster: { family: 'Big Shoulders Display', weight: 900 },
  posterWide: { family: 'Archivo Black', weight: 400 },
  stamp: { family: 'Space Mono', weight: 700 },
  cinema: { family: 'Cormorant Garamond', weight: 600 },
  cinemaItalic: { family: 'Cormorant Garamond', weight: 600, style: 'italic' },
  title: { family: 'Cinzel', weight: 700 },
  riso: { family: 'Syne', weight: 800 },
  hand: { family: 'Kalam', weight: 700 },
  scrawl: { family: 'Permanent Marker', weight: 400 },
};

export { personCleanVerdict, PERSON_CLEAN_APPLIED, PERSON_CLEAN_SKIPPED };

export default {
  id: 'kinetic-captions',
  version: '2.0.0',
  name: 'Kinetic Captions',
  description: 'The speaker\'s own transcript as kinetic typography over talking-head/podcast footage. Pick a LOOK (cover, neon, noir, poster, terminal, swiss, riso, cinema) and an ENERGY (calm, signature, wild): phrases cut at real pauses, words land as spoken, and every ~9 s a hero moment in that look\'s own style. Replaces plain subtitles.',
  tags: ['captions', 'subtitles', 'podcast', 'talking-head', 'speech', 'transcript', 'footage', 'shorts'],
  formats: ['vertical', 'landscape', 'square', 'portrait'],
  bpm: 120,
  duration: 30,
  loop: false,
  palette: { bg: '#0B0B0B', ink: '#F4F1EA', a: '#E8B04A', b: '#E8B04A', shade: '#000000' },
  paletteRoles: { bg: 'ground behind footage', ink: 'caption words', a: 'accent: stressed and hero words', b: 'second accent (looks with two inks)', shade: 'caption shadow / plate' },
  fonts: FONTS,
  fontsFor: (params) => { const f = (LOOKS[params.look] || LOOKS.cover).fonts; return readableWanted(params, params.look) ? [...new Set([...f, ...READABLE_FONTS])] : f; },
  params: {
    look: 'cover',
    media: 'ep',
    grade: { exposure: 1, contrast: 1, saturation: 1 },
    maxWords: 4,
    maxChars: 22,
    pause: 0.32,
    energy: 'signature',
    heroMin: 0.9,
    layout: 'full',
    style: 'poster',
    zone: null,
    shadow: 0.7,
    uppercase: true,
  },
  schema: {
    content: {
      type: 'object',
      additionalProperties: false,
      required: ['words'],
      properties: {
        words: { type: 'array', minItems: 1, items: { type: 'object', required: ['text', 'start'], properties: { text: { type: 'string' }, start: { type: 'number' }, end: { type: 'number' }, emph: { type: 'boolean' }, hero: { type: 'boolean' } } }, description: 'Word-timed transcript (kinetype lyrics / transcribe output). Use wordsSrc to load from a file.' },
        heroes: { type: 'array', items: { type: 'number' }, description: 'Times (s) whose phrase must be a hero line' },
        noHero: { type: 'array', items: { type: 'number' }, description: 'Times (s) whose phrase must NOT be a hero line' },
        plates: {
          type: 'array',
          description: 'Background plates on hero words: the world BEHIND the speaker transforms (needs a person matte, or no footage at all). plate = a procedural id (' + PLATE_IDS.join(', ') + ') or {media: "<id>"} for b-roll declared in spec.media (use loop: true, duration: 8).',
          items: { type: 'object', required: ['t', 'plate'], additionalProperties: false, properties: { t: { type: 'number' }, plate: { oneOf: [{ enum: PLATE_IDS }, { type: 'object', required: ['media'], additionalProperties: false, properties: { media: { type: 'string' } } }] }, dur: { type: 'number', minimum: 0.4 } } },
        },
        loudness: { type: 'object', description: 'stage: the voice envelope {hop, values: 0..1} — drives a subtle pulse of the type (kinetype stage fills it)', properties: { hop: { type: 'number' }, t0: { type: 'number' }, values: { type: 'array', items: { type: 'number' } } } },
        overlays: {
          type: 'array',
          description: 'Other templates embedded on the same timeline (e.g. lower-third name title, end card). Captions pause while an overlay has pauseCaptions.',
          items: {
            type: 'object', required: ['template', 'at'], additionalProperties: false,
            properties: { template: { type: 'string' }, at: { type: 'number' }, duration: { type: 'number' }, content: { type: 'object' }, params: { type: 'object' }, palette: { type: 'object' }, fonts: { type: 'object' }, dim: { type: 'number', minimum: 0, maximum: 1 }, pauseCaptions: { type: 'boolean' }, above: { type: 'boolean', description: 'Draw above the speaker cut-out (default true)' } },
          },
        },
      },
    },
    params: {
      type: 'object', additionalProperties: false,
      properties: {
        look: { enum: LOOK_IDS, description: LOOK_IDS.map((id) => `${id} = ${LOOKS[id].summary}`).join('; ') },
        media: { type: 'string' },
        grade: { type: 'object', properties: { exposure: { type: 'number' }, contrast: { type: 'number' }, saturation: { type: 'number' } }, additionalProperties: false },
        maxWords: { type: 'integer', minimum: 1, maximum: 8 },
        maxChars: { type: 'integer', minimum: 6, maximum: 40 },
        pause: { type: 'number', minimum: 0.1, maximum: 1.5, description: 'Silence (s) that ends a phrase' },
        energy: { enum: ['calm', 'signature', 'wild'], description: 'How loud the design is. calm = premium subtitles, rare small heroes; signature (default) = clean captions plus a hero moment every ~9 s (in the look\'s own style, camera punch-in, hit); wild = frequent huge giants. Captions stay readable at every level.' },
        heroEvery: { type: 'number', minimum: 2, maximum: 60, description: 'Aim for one hero line per this many seconds (default from energy)' },
        heroMin: { type: 'number', minimum: 0.3, maximum: 3, description: 'A hero line stays at least this long (s)' },
        behind: { type: 'boolean', description: 'false = never put hero words behind the speaker' },
        heroPlacement: { enum: ['auto', 'behind', 'front'], description: 'auto (default) = mostly behind the head (needs a matte), every few heroes in the free lower band; behind = always behind the speaker; front = always in the lower band, clear of the face' },
        punch: { type: 'number', minimum: 0, maximum: 0.3, description: 'Camera punch-in on hero words (zoom amount, default from energy)' },
        flash: { type: 'number', minimum: 0, maximum: 0.5, description: 'Hit strength on hero words (default from energy)' },
        captionTop: { type: 'number', minimum: 0, maximum: 1, description: 'Keep caption blocks below this line (fraction of the height) — covers pass the chin line so type never sits on the face' },
        textScale: { type: 'number', minimum: 0.5, maximum: 2, description: 'Scale all caption type (default 1). Covers/thumbnails use ~1.4 so the line reads at grid size.' },
        plates: { enum: ['off', 'auto'], description: 'auto = hero words that name a world (fire, storm, divorce, money, time, love…) transform the background behind the speaker into a matching plate' },
        focusX: { type: 'number', minimum: 0, maximum: 1, description: 'Wide shots: centre captions and hero words over the speaker at this x (0..1). kinetype direct sets it from motion↔voice correlation.' },
        window: { type: 'object', additionalProperties: false, properties: { in: { type: 'number', minimum: 0 }, out: { type: 'number', minimum: 0 } }, description: 'This render is a window spliced into another video (kinetype compose): the first `in` and last `out` seconds are crossfade margins, so camera moves settle to neutral there' },
        zone: { type: ['number', 'null'], description: 'Caption baseline zone as fraction of height (default by format)' },
        style: { enum: ['poster', 'clean', 'punch'], description: 'cover look only: poster = mixed weights, stressed words big, hero lines; clean = whole phrase dimmed, each word lights as spoken (karaoke), one voice; punch = one word at a time, huge, popping' },
        layout: { enum: ['full', 'split', 'stage'], description: 'full = captions over full-frame footage; split = speaker panel left + typographic column right (vertical footage in a landscape frame); stage = no footage: the type IS the picture — big centred phrases, scenes with ambient backdrops, hero words take the screen, the voice pulses the type (caption/voice videos)' },
        zones: { type: 'object', additionalProperties: false, properties: { top: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, bottom: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 } }, description: 'Letterboxed footage (a sideways take between black bars), vertical only: {top:[y0,y1], bottom:[y0,y1]} as fractions of the height. Giant hero words are set in the top zone (never behind the head, as big as the zone allows), caption blocks in the bottom zone; no camera punch, shake or flash, so the picture itself never moves. Absent = nothing changes.' },
        decontam: { type: 'boolean', description: 'readable windows: recolour the matte edge band from his nearby solid pixels (default on; false = the plain choked cut-out)' },
        readable: { type: 'boolean', description: 'noir / neon / terminal windows with personClean applied (a caller opt-in, absent = nothing changes): the spoken caption is the house caption (the cover look\'s caption, full size and weight), the hero word behind him is a big bold wall of the word on a dark scrim, no whole-frame flash, no front sign. Not applied (and the look unchanged) when personClean is not applied.' },
        canvas: { enum: ['picture'], description: 'readable looks only: this render is the PICTURE strip of a letterboxed take (compose renders it at the strip size and overlays it); type is sized to the strip width, not its height' },
        personClean: { type: 'boolean', description: 'Looks behind him (a caller opt-in, absent = nothing changes): the look\'s footage grade, scrims, glow, vignette, grain and hero effects reach only the background. The speaker is re-drawn from the ungraded footage through his person matte over the look (never L.subjectFilter / L.onSubject, which relight or re-draw him), the look\'s hit and post layers are masked off him, and a frame without a matte shows the plain footage. Needs a matte (macOS); cover, poster and marker are already safe and ignore it.' },
        heroOnce: { type: 'boolean', description: 'any look: a hero word drawn giant behind the head is not drawn a second time in the caption block of its phrase (default false: the block reads the whole phrase); a one-word phrase shows the giant alone' },
        singleKey: { type: 'boolean', description: 'cover look only: the giant hero word behind the head is not repeated in the caption row (default false: the row reads the whole phrase)' },
        shadow: { type: 'number', minimum: 0, maximum: 1 },
        uppercase: { type: 'boolean' },
      },
    },
  },
  example: {
    template: 'kinetic-captions',
    name: 'kinetic-captions',
    format: 'vertical',
    fps: 30,
    duration: 9,
    media: { ep: { src: '../fixtures/footage-abstract.mp4' } },
    content: {
      words: [
        { text: 'why', start: 0.22, end: 0.4 }, { text: 'do', start: 0.42, end: 0.5 }, { text: 'you', start: 0.52, end: 0.7 }, { text: 'chase', start: 1.0, end: 1.5 },
        { text: 'when', start: 2.0, end: 2.2 }, { text: 'you', start: 2.2, end: 2.35 }, { text: 'know', start: 2.35, end: 2.6 }, { text: 'it', start: 2.6, end: 2.7 }, { text: 'will', start: 2.7, end: 2.85 }, { text: 'devastate', start: 2.9, end: 3.6 }, { text: 'you', start: 3.6, end: 3.8 },
        { text: 'rejection', start: 4.6, end: 5.2 }, { text: 'breeds', start: 5.25, end: 5.6 }, { text: 'obsession', start: 5.7, end: 6.5 },
        { text: 'protect', start: 7.2, end: 7.6 }, { text: 'yourself', start: 7.65, end: 8.3 },
      ],
    },
  },
  notes: 'Get words with `kinetype captions clip.mp4` (whisper.cpp word timing) or pass an existing transcript with --words. For hero words behind the speaker declare media.<id>.matte: true (Apple Vision, macOS; `kinetype captions` does it). Looks: ' + LOOK_IDS.map((id) => `${id} (${LOOKS[id].summary})`).join(', ') + '. Overlays embed other templates (lower-third, editorial-serif…) on the same timeline.',

  build(ctx) {
    const { W, H, fps, params, content: C, seed, qa } = ctx;
    const look = LOOKS[params.look] || LOOKS.cover;
    // the look's palette fills every token the spec did not set
    const userPal = ctx.spec.palette || {};
    for (const [k, v] of Object.entries(look.palette || {})) if (!(k in userPal)) ctx.palette[k] = v;
    const P = ctx.palette;
    const unit = (params.canvas === 'picture' && readableWanted(params, params.look) ? W : Math.min(W, H)) / 1080;
    const tall = ctx.aspect === 'vertical', land = ctx.aspect === 'landscape';
    const up = (s) => (params.uppercase && look.uppercase !== false ? s.toUpperCase() : s);
    const clip = ctx.media && ctx.media.src[params.media] ? ctx.media.get(params.media) : null;
    const grade = params.grade ? `brightness(${params.grade.exposure ?? 1}) contrast(${params.grade.contrast ?? 1}) saturate(${params.grade.saturation ?? 1})` : null;
    const raw = ctx.spec.params || {};
    const E = { ...(ENERGY[params.energy] || ENERGY.signature), ...((look.energy || {})[params.energy] || {}) };
    const placement = raw.heroPlacement ?? (raw.behind === false ? 'front' : E.placement);
    const split = params.layout === 'split' && !!clip;
    // stage: a voice video with no footage — the type is the picture
    const stage = params.layout === 'stage';
    // zones (caller opt-in, letterboxed footage): see the schema. Absent: every line below behaves exactly as before.
    const zones = (() => {
      const z = params.zones;
      if (!z || !tall || split || stage || !Array.isArray(z.top) || !Array.isArray(z.bottom)) return null;
      const ok = (a) => a.every((v) => Number.isFinite(v) && v >= 0 && v <= 1) && a[1] > a[0];
      return ok(z.top) && ok(z.bottom) && z.top[1] <= z.bottom[0] ? { top: z.top, bottom: z.bottom } : null;
    })();
    if (zones) E.shake = 0;
    const hasMatte = !split && raw.behind !== false && !!clip && clip.hasMatte;
    // looks behind him: see the personClean schema entry. Only the looks that grade or re-draw the whole frame use it.
    // The verdict is receipted (qa note) so the caller learns whether it was REALLY applied, never from the plan.
    const cleanV = personCleanVerdict({ raw, clip, lookId: look.id, stage, split, zones, hasMatte });
    const personClean = cleanV.applied;
    // readable looks (see looks/readable.js): only where personClean was really applied; else the look is exactly what it was
    const readable = personClean && readableWanted(params, look.id);
    const readableChoke = readable ? (params.decontam === false ? { ...READABLE_CHOKE, decontam: false } : READABLE_CHOKE) : null;   // kill switch: params.decontam=false restores the plain choked cut-out
    const canvasPic = readable && params.canvas === 'picture';
    if (readable) qa.note(`${READABLE_NOTE} house caption + big wall of the hero word behind him`);
    if (cleanV.asked && !cleanV.safe) {
      qa.note(personClean ? PERSON_CLEAN_APPLIED : `${PERSON_CLEAN_SKIPPED} ${cleanV.why}`);
      if (!personClean) qa.warn(`personClean: not applied (${cleanV.why}) - the look draws on the whole frame, the caller must not ship it`);
    }
    const punchAmt = zones ? 0 : raw.punch ?? E.punch, flashAmt = zones ? 0 : raw.flash ?? E.flash;
    const q = (t) => K.frameQuant(t, fps);

    // ── words → phrases (shared speech model: ./speech.js) ────────────────
    const words = prepareWords(C.words);
    const phrases = phrasesOf(words, params);
    phrases.forEach((p, k) => {
      p.k = k;
      p.start = p.words[0].start;
      p.end = p.words[p.words.length - 1].end;
      p.words.forEach((w, j) => { w.p = p; w.j = j; });
      p.key = p.words.reduce((a, b) => (b.s > a.s ? b : a));
      // the hero word must be a CONTENT word (never an intensifier or stopword)
      const content = p.words.filter(contentWord);
      p.heroKey = content.length ? content.reduce((a, b) => (b.s > a.s ? b : a)) : null;
      p.hero = false;
    });
    // hero lines: forced ones, then the strongest phrase in each window
    // the word being spoken at t: the latest onset at or before t. (Never
    // "t within [start, end]": edge-to-edge transcripts make a word's end the
    // next word's start, so containment picks the word BEFORE the pinned one.)
    const wordAtT = (t) => {
      let best = null;
      for (const w of words) { if (w.start <= t + 0.03) best = w; else break; }
      return best && t <= Math.max(best.end, best.start + 0.3) + 0.35 ? best : null;
    };
    const phraseAtT = (t) => { const w = wordAtT(t); return w && w.p ? w.p.k : -1; };
    const banned = new Set((C.noHero || []).map(phraseAtT).filter((k) => k >= 0));
    for (const t of C.heroes || []) {
      const k = phraseAtT(t);
      if (k < 0) continue;
      const p = phrases[k];
      p.hero = true;
      // a pinned hero uses the word spoken at the pinned time, if it is a content word
      const w = wordAtT(t);
      if (w && !isStop(w) && !PROFANE.test(w.text) && !/['’]/.test(w.text)) p.heroKey = w;
    }
    for (const p of phrases) if (p.words.some((w) => w.hero)) p.hero = true;
    for (const p of phrases) if (p.hero && !p.heroKey) p.hero = false; // nothing worth going giant
    const win = raw.heroEvery ?? E.heroEvery;
    const totalT = phrases.length ? phrases[phrases.length - 1].end : 0;
    for (let w0 = 0; w0 < totalT; w0 += win) {
      const inWin = phrases.filter((p) => p.start >= w0 && p.start < w0 + win && !banned.has(p.k));
      if (inWin.some((p) => p.hero)) continue;
      const best = inWin.filter((p) => p.heroKey && p.heroKey.s >= 2.2).sort((a, b) => b.heroKey.s - a.heroKey.s)[0];
      if (best) best.hero = true;
    }
    if (look.heroes === false || (look.id === 'cover' && params.style === 'clean')) for (const p of phrases) p.hero = false;
    // placement per hero: behind the head when a matte exists, every Nth one
    // in the free band instead (variety; never over the face)
    let hn = 0;
    for (const p of phrases) {
      if (!p.hero) continue;
      p.key = p.heroKey;
      p.hn = hn;
      p.front = placement === 'front' || !hasMatte || (placement === 'auto' && E.frontEvery > 1 && hn % E.frontEvery === E.frontEvery - 1);
      p.cover = !p.front && tall && !split; // behind, top band: the head occludes its middle
      if (readable) { p.front = false; p.cover = (tall || canvasPic) && !split; } // readable: only ever behind him (the wall), never a front sign / pull quote
      if (zones) { p.front = false; p.cover = true; } // letterboxed: the giant lives in the top bar, never behind the head
      hn++;
    }
    // background plates (optional): which hero words transform the world behind him
    if (stage && raw.plates === undefined) params.plates = 'auto';
    if (params.plates === 'auto' || (C.plates && C.plates.length)) {
      const chosen = [];
      // auto: a word that names a world gets that world — but the same world
      // never twice within 20 s (a speaker who keeps saying "fire" gets one fire)
      if (params.plates === 'auto') {
        const last = {};
        for (const p of phrases) if (p.hero && p.key) {
          const id = plateFor(p.key.text);
          if (!id || (last[id] != null && p.key.start - last[id] < 20)) continue;
          p.plate = { id }; last[id] = p.key.start;
        }
      }
      for (const e of C.plates || []) {
        const k = phraseAtT(e.t), p = k >= 0 ? phrases[k] : null;
        if (!p || !p.hero) { qa.warn(`plate at ${e.t}s: that phrase is not a hero line — skipped`); continue; }
        if (typeof e.plate === 'string' && !PLATES[e.plate]) { qa.warn(`plate "${e.plate}" does not exist (have: ${PLATE_IDS.join(', ')})`); continue; }
        if (e.plate.media && !(ctx.media && ctx.media.src[e.plate.media])) { qa.warn(`plate media "${e.plate.media}" is not declared in spec.media`); continue; }
        p.plate = typeof e.plate === 'string' ? { id: e.plate } : { media: e.plate.media };
        if (e.dur) p.plate.dur = e.dur;
      }
      for (const p of phrases) if (p.plate) chosen.push(`${p.key.text}→${p.plate.id || p.plate.media}`);
      qa.note(`background plates: ${chosen.join(', ') || 'none (no hero word names a world)'}`);
    }
    // show window: from first word to next phrase start (holds the line through short pauses)
    phrases.forEach((p, k) => {
      const next = phrases[k + 1];
      const holdTo = p.end + (p.hero ? 0.35 : 0.5);
      p.out = next ? Math.min(Math.max(holdTo, p.start + (p.hero ? params.heroMin : 0.4)), next.start) : holdTo + 0.4;
    });

    // ── stage scenes: the voice video is cut into scenes at its own pauses
    // (~15–25 s); each scene moves the type to a new height and sets its own
    // ambient world, so a 90 s monologue never sits on one static frame
    const scenes = [];
    if (stage && phrases.length) {
      const gaps = phrases.slice(1).map((p, k) => p.start - phrases[k].end).sort((a, b) => a - b);
      const sceneGap = Math.max(0.35, gaps[Math.floor(gaps.length * 0.6)] || 0.35);
      const CY = tall ? [0.5, 0.42, 0.57, 0.46, 0.54] : [0.5, 0.44, 0.56];
      const AMBIENT = ['void', 'bokeh', 'spotlight', 'rain', 'time'];
      let cur = null;
      phrases.forEach((p, k) => {
        const gap = k ? p.start - phrases[k - 1].end : 0;
        if (!cur || (p.start - cur.start >= 14 && gap >= sceneGap) || p.start - cur.start >= 26) { cur = { k: scenes.length, start: k ? p.start - Math.min(0.3, gap / 2) : 0, phrases: [] }; scenes.push(cur); }
        cur.phrases.push(p); p.scene = cur;
      });
      scenes.forEach((sc, i) => {
        sc.end = scenes[i + 1] ? scenes[i + 1].start : Infinity;
        sc.cy = CY[i % CY.length];
        // the scene's world: what it talks about, else a calm rotation
        const votes = new Map();
        for (const p of sc.phrases) for (const w of p.words) { const id = contentWord(w) ? plateFor(w.text) : null; if (id) votes.set(id, (votes.get(id) || 0) + 1); }
        const top = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
        sc.ambient = top ? top[0] : AMBIENT[(i + (seed % AMBIENT.length)) % AMBIENT.length];
      });
      qa.note(`stage: ${scenes.length} scenes — ${scenes.map((sc) => `${sc.start.toFixed(1)}s ${sc.ambient}`).join(', ')}`);
    }
    const paperBg = stage && (() => { const m = /^#?([0-9a-f]{6})$/i.exec(P.bg || ''); if (!m) return false; const n = parseInt(m[1], 16); return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255 > 0.55; })();
    const sceneAt = (t) => { let sc = null; for (const x of scenes) { if (x.start <= t) sc = x; else break; } return sc; };
    // the voice envelope (0..1) that makes the type breathe
    const loudV = C.loudness?.values || null, loudHop = C.loudness?.hop || 0.1, loudT0 = C.loudness?.t0 || 0;
    const loud = (t) => {
      if (!loudV) return 0;
      const f = (t - loudT0) / loudHop, i = Math.floor(f);
      if (i < 0 || i >= loudV.length - 1) return 0;
      return loudV[i] + (loudV[i + 1] - loudV[i]) * (f - i);
    };

    // plate windows: a world needs time to land — at least 1.4 s from the key
    // word (or its own dur), carrying past a short phrase, never into the next plate
    const plateWins = phrases.filter((p) => p.plate).map((p) => ({ p, k0: p.key.start - 0.05, end: p.plate.dur ? p.key.start + p.plate.dur : Math.max(p.out, p.key.start + 1.4) }));
    plateWins.forEach((w, i) => { const nx = plateWins[i + 1]; if (nx) w.end = Math.min(w.end, nx.k0 - 0.1); });
    const plateAt = (t) => plateWins.find((w) => t >= w.k0 && t < w.end) || null;

    // ── geometry shared by every look ─────────────────────────────────────
    const panel = split ? (() => { const h = Math.round(H * 0.86), w = Math.round(h * (clip.w / clip.h)); return { x: Math.round(W * 0.065), y: Math.round((H - h) / 2), w, h }; })() : null;
    // stage: symmetric margins — the centred type is the picture (the action rail
    // sits low right; scene centres stay above most of it)
    const M = Math.round(Math.min(W, H) * (stage ? 0.09 : 0.07));
    const MR = tall && !stage ? Math.round(W * 0.14) : M; // clear of the Shorts/Reels action rail
    const colX0 = split ? panel.x + panel.w + Math.round(W * 0.055) : M;
    let IW = split ? W - Math.round(W * 0.065) - colX0 : W - M - MR;
    let cxZone = colX0 + IW / 2;
    // speaker focus (wide shots): a narrower column centred over the speaker
    if (params.focusX != null && !split && !tall) {
      const half = W * 0.2;
      cxZone = Math.max(M + half, Math.min(W - MR - half, params.focusX * W));
      IW = Math.round(2 * Math.min(cxZone - M, W - MR - cxZone));
    }
    const zoneY = zones ? (zones.bottom[1] - 0.02) * H : (params.zone ?? look.zone?.[ctx.aspect] ?? (tall ? 0.7 : land ? 0.83 : 0.8)) * H; // baseline of the LAST caption row
    const safeTop = Math.round(H * (tall ? 0.06 : 0.07));
    const safeBottom = H - Math.round(H * (tall ? 0.16 : 0.08)); // above the Shorts/Reels caption band
    const capBig = (split ? 118 : tall || canvasPic ? 150 : land ? 104 : 124) * unit * (params.textScale ?? 1) * (stage ? (tall ? 1.7 : 1.45) : 1), capSmall = capBig * 0.44;
    const sizeFor = (face, cap) => (cap * face.upm) / face.capHeight;

    /**
     * Flow a phrase's words into centred rows that fit the zone. shapeFn(w)
     * returns the word's run; rows stack upward from the zone baseline (or
     * centre on `centerY`). Sets w.run, w.x, w.y; returns {rows, box, minCap}.
     */
    function flow(p, shapeFn, { space = capSmall * 0.55, leading = capSmall * 0.42, width = IW, cx = cxZone, baseY = zoneY, centerY = split ? H / 2 : stage ? (p.scene?.cy ?? 0.5) * H : null, align = 'center', x0 = null, reshape = null } = {}) {
      p.words.forEach((w) => (w.run = shapeFn(w)));
      const rowsOf = () => {
        const rows = [];
        let row = [], rw = 0;
        for (const w of p.words) {
          const ww = w.run.advance;
          if (row.length && rw + space + ww > width) { rows.push(row); row = []; rw = 0; }
          rw += (row.length ? space : 0) + ww;
          row.push(w);
        }
        if (row.length) rows.push(row);
        return rows;
      };
      let rows = rowsOf();
      const widest = Math.max(...rows.map((r) => r.reduce((a, w, i) => a + w.run.advance + (i ? space : 0), 0)));
      let sp = space;
      if (widest > width) {
        const fit = width / widest;
        p.words.forEach((w) => (w.run = reshape ? reshape(w, fit) : K.shape(w.run.face, w.run.text, { size: w.run.size * fit, tracking: 0, kerning: 'metric' })));
        sp = space * fit;
        rows = rowsOf();
      }
      const rowCap = rows.map((r) => Math.max(...r.map((w) => w.run.capPx)));
      const blockH = rowCap.reduce((a, c) => a + c, 0) + leading * (rows.length - 1);
      let y = centerY != null ? centerY + blockH / 2 : baseY;
      const bases = [];
      for (let r = rows.length - 1; r >= 0; r--) { bases[r] = y; y -= rowCap[r] + leading; }
      rows.forEach((r, ri) => {
        const width2 = r.reduce((a, w, i) => a + w.run.advance + (i ? sp : 0), 0);
        let x = align === 'left' ? (x0 ?? colX0) : cx - width2 / 2;
        r.forEach((w, i) => { w.x = x; w.y = bases[ri]; w.row = ri; w.col = i; x += w.run.advance + sp; });
      });
      const box = { x0: Math.min(...p.words.map((w) => w.x + w.run.inkLeft)), x1: Math.max(...p.words.map((w) => w.x + w.run.inkRight)), y0: Math.min(...p.words.map((w) => w.y + w.run.inkTop)), y1: Math.max(...p.words.map((w) => w.y + w.run.inkBottom)) };
      return { rows, box, minCap: Math.min(...p.words.map((w) => w.run.capPx)), bases, blockH };
    }

    /**
     * The giant hero word, sized and placed for this hero's placement:
     * cover (behind, vertical) → top band under the platform UI; behind
     * (landscape/square) → centred on the head zone; front → the free lower
     * band, capped in height so the face stays clear. opts.capFrac overrides.
     */
    function giant(p, face, { text = up(p.key.text), tracking = -10, width = null, capFrac = null, wild = E.behindCap >= 0.28 } = {}) {
      const cap = capFrac ?? (stage ? (tall ? 0.2 : 0.28) : split ? 0.34 : p.front ? (tall ? E.frontCap : 0.22) : tall ? E.behindCap : p.cover ? 0.26 : 0.5);
      // with a speaker focus the giant stays inside the speaker's column
      let wmax = Math.min(width ?? (split || stage ? IW : W * (tall ? 0.94 : 0.8)), params.focusX != null && !split && !tall ? IW : Infinity);
      let capH = cap;
      // letterboxed: as big as the top bar allows (the circle/underline a look adds needs ~1.7x the ink height)
      const bar = zones && p.cover ? { y0: Math.max(safeTop, zones.top[0] * H), y1: zones.top[1] * H } : null;
      if (bar) { wmax = Math.min(wmax * 1.12, W * 0.9); capH = Math.min(cap, (bar.y1 - bar.y0) / 1.7 / H); }
      const size = Math.min(K.fitSize(face, text, wmax, { tracking }), sizeFor(face, H * capH));
      const run = K.shape(face, text, { size, tracking });
      const gx = cxZone - (run.inkLeft + run.inkRight) / 2;
      let gy = (split ? 0.5 : p.front ? (tall ? 0.7 : 0.68) : tall ? 0.36 : 0.5) * H + run.capPx / 2;
      if (p.cover) gy = wild && tall ? 0.36 * H + run.capPx / 2 : H * 0.075 + run.capPx;
      if (stage) gy = (p.scene?.cy ?? 0.5) * H + run.capPx / 2; // the hero takes the centre of the stage
      if (bar) gy = (bar.y0 + bar.y1) / 2 - (run.inkTop + run.inkBottom) / 2;
      return { run, x: gx, y: gy };
    }

    /** Spring-in of a word at its onset: {d, pop, alpha, out} (d < 0 → not yet). */
    const wordIn = (w, t, p, { f = 6, z = 0.85, fade = 0.05, outDur = 0.12 } = {}) => {
      const d = t - w.start;
      const outU = K.clamp((t - (p.out - outDur)) / outDur);
      return { d, pop: d < 0 ? 0 : K.springStep(d, f, z), alpha: d < 0 ? 0 : K.clamp(d / fade) * (1 - outU), out: outU };
    };
    /** Deterministic flicker (neon power-on, bad bulbs): 0/1-ish per frame bucket. */
    const flicker = (key, d, dur = 0.3, rate = 30) => {
      if (d < 0) return 0;
      if (d >= dur) return 1;
      const b = Math.floor(d * rate);
      const r = K.noise1(seed, 'flick', key, b);
      return r < 0.35 + 0.6 * (d / dur) ? 1 : r < 0.8 ? 0.15 : 0.55;
    };

    const api = {
      ctx, K, W, H, fps, unit, tall, land, split, panel, P, params, E, seed, qa, look,
      font: (role) => ctx.fonts.get(role), up, clip, grade, hasMatte, personClean, raw,
      readable, canvasPic,
      M, MR, IW, colX0, cxZone, zoneY, safeTop, safeBottom, capBig, capSmall, sizeFor,
      phrases, words, isStop, PROFANE, flow, giant, wordIn, flicker, q,
    };
    api.offHim = (g, t, fn) => fn(g);   // replaced below once the frame geometry exists
    const L0 = look.build(api);
    const L = readable ? buildReadable(api, L0) : L0;

    // heroOnce (opt-in, params.heroOnce): the giant word behind the head (top band, or the middle on a wide canvas) IS the key word, so the caption block of that phrase
    // reads the rest of it (a one-word phrase has no caption block). Re-run on every (re)layout: a hero the smart
    // placement later moves to the front gets its whole phrase back. Absent: L.layout(p), exactly as before.
    const HERO_IN_PHRASE = new Set(['cinema', 'swiss']);
    const layoutPhrase = (p) => {
      if (params.heroOnce === true && p.hero) {
        if (!p.allWords) p.allWords = p.words;
        // only a giant drawn apart from the block (p.cover: top band / top bar); cinema's title card and swiss's grid panel lay the key
        // out inside the phrase itself (cinema indexes p.words by p.key), and front/wide heroes already read around the giant
        const apart = p.cover && !HERO_IN_PHRASE.has(look.id) && !readable; // readable: the house caption keeps the whole phrase, the wall is extra
        const rest = apart ? p.allWords.filter((w) => w !== p.key) : p.allWords;
        p.captionless = apart && rest.length === 0;
        p.words = rest.length ? rest : p.allWords;
      }
      return L.layout(p);
    };

    // ── per-phrase layout (by the look) + QA ─────────────────────────────
    for (const p of phrases) {
      for (const w of p.words) w.big = false;
      const maxS = Math.max(...p.words.map((w) => w.s));
      // big = the stressed words (and anything ≥ 70% of the phrase's peak), small = connective words
      p.words.forEach((w) => (w.big = w.s >= Math.max(2.2, maxS * 0.7)));
      if (!p.words.some((w) => w.big)) p.key.big = true;
      if (p.hero && p.heroKey) p.heroKey.big = true; // the hero word always reads big in the caption too
      const lay = layoutPhrase(p) || {};
      p.box = lay.box || p.box;
      if (p.captionless) p.box = null;
      // captionTop: push the whole caption block below a line (e.g. the chin)
      const capTop = zones ? Math.max(params.captionTop ?? 0, zones.bottom[0]) : params.captionTop;
      if (capTop != null && p.box && p.box.y0 < capTop * H) {
        const dy = capTop * H - p.box.y0;
        for (const w of p.words) if (w.y != null) w.y += dy;
        for (const it of [...(p.pre || []), ...(p.post || [])]) it.y += dy;
        p.box = { ...p.box, y0: p.box.y0 + dy, y1: p.box.y1 + dy };
      }
      if (p.box) qa.text(`phrase-${p.k}`, { box: p.box, size: lay.minCap ?? Math.min(...p.words.map((w) => (w.run ? w.run.capPx : capSmall))), fg: lay.fg || P.ink, bg: lay.bg || P.shade, lines: [p.words.map((w) => w.text).join(' ')], orphanOk: true });
      for (const w of p.words) qa.hit(w.start, w.text);
    }
    qa.note(`look ${look.id}, energy ${params.energy}: ${phrases.length} phrases, ${phrases.filter((p) => p.hero).length} hero lines, ${words.length} words`);

    // ── overlays: other templates on the same timeline ────────────────────
    const overlays = (C.overlays || []).map((o, i) => {
      const built = ctx.sub(o.template, { template: o.template, format: ctx.spec.format, fps, seed: K.hash(seed, 'ov', i) % 99999, content: o.content || {}, params: o.params, palette: o.palette, fonts: o.fonts, render: { transparent: true }, ...(o.duration ? { duration: o.duration } : {}) }, { at: o.at, ns: `o${i}`, label: `overlay ${i + 1}:${o.template}`, keyframes: false });
      return { ...o, built, dur: o.duration ?? built.duration };
    });
    const paused = (t) => overlays.some((o) => o.pauseCaptions && t >= o.at && t < o.at + o.dur);

    // ── keyframes: hero lines + a spread of normal phrases ────────────────
    // (inside the video, and never on the frame the next phrase replaces this one)
    const duration = ctx.spec.duration ?? (clip ? Math.min(clip.duration, totalT + 1.5) : totalT + 1.5);
    const inside = (p) => phrases.filter((x) => x.start < duration - 0.3 && p(x));
    const kf = (p, t, label) => qa.keyframe(Math.min(t, p.out - 1.5 / fps, duration - 1 / fps), label);
    const heroes = phrases.filter((p) => p.hero);
    inside((p) => p.hero).slice(0, 8).forEach((p) => kf(p, Math.max(p.key.start + 0.12, Math.min(p.out - 0.2, p.key.end + 0.1)), `hero: ${p.key.text}`));
    const normals = inside((p) => !p.hero);
    for (let k = 0; k < 6 && normals.length; k++) { const p = normals[Math.floor((k + 0.5) * normals.length / 6)]; kf(p, Math.max(p.words[p.words.length - 1].start + 0.1, Math.min(p.out - 0.2, p.end)), `line: ${p.words.map((w) => w.text).join(' ')}`); }
    overlays.filter((o) => o.at < duration).forEach((o, i) => qa.keyframe(Math.min(duration - 1 / fps, o.at + Math.min(o.dur * 0.5, 2.5)), `overlay ${i + 1}: ${o.template}`));
    qa.keyframe(0.05, 'open');
    qa.keyframe(duration - 1 / fps, 'last frame');

    // ── the hit: camera punch-in on the key word, a flash, (wild) a shake ──
    const phraseAt = (t) => {
      let lo = 0, hi = phrases.length - 1, ans = -1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (phrases[m].start - 0.001 <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
      return ans >= 0 && t < phrases[ans].out ? phrases[ans] : null;
    };
    // spliced windows: camera moves are neutral inside the crossfade margins
    const splice = params.window || null;
    const edge = (t) => {
      if (!splice) return 1;
      const a = splice.in > 0 ? K.smoothstep(0, 1, (t - splice.in) / 0.25) : 1;
      const b = splice.out > 0 ? 1 - K.smoothstep(0, 1, (t - (duration - splice.out - 0.35)) / 0.35) : 1;
      return a * b;
    };
    // the look's footage treatment eases in/out at spliced edges, so at the
    // splice the picture already matches the base and only the type crossfades
    const footageEdge = (t) => {
      if (!splice) return 1;
      const a = splice.in > 0 ? K.smoothstep(0, 1, (t - splice.in * 0.5) / 0.45) : 1;
      const b = splice.out > 0 ? 1 - K.smoothstep(0, 1, (t - (duration - splice.out - 0.45)) / 0.45) : 1;
      return Math.min(a, b);
    };
    const hitAt = (t) => {
      let lo = 0, hi = heroes.length - 1, ans = -1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (heroes[m].key.start - 0.05 <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
      if (ans < 0) return null;
      const p = heroes[ans], d = t - p.key.start, hold = p.out - p.key.start;
      if (d > hold + 0.5) return null;
      const rise = K.clamp(K.springStep(Math.max(0, d), 7, 0.8), 0, 1.15);
      const fall = 1 - K.smoothstep(0, 1, (d - hold + 0.05) / 0.45);
      const e = edge(t);
      return { p, d, hold, env: rise * fall * e, zoom: punchAmt * rise * fall * e, flash: d >= 0 ? flashAmt * Math.exp(-d / 0.07) * e : 0, shake: E.shake && d >= 0 ? Math.exp(-d / 0.14) * e : 0 };
    };
    const zoomRect = (r, z, fx, fy) => ({ x: fx - (fx - r.x) * (1 + z), y: fy - (fy - r.y) * (1 + z), w: r.w * (1 + z), h: r.h * (1 + z) });
    const full = { x: 0, y: 0, w: W, h: H };
    const drawFootage = L.footage || ((g, t, frame) => { g.save(); if (grade) g.filter = grade; clip.draw(g, t, frame); g.restore(); });

    // ── looks behind him (personClean): his ungraded pixels over the look, the look's post layers kept off him ──
    // The frame geometry of draw(): the camera punch-in and shake of the hit at t (post() needs the same box).
    const frameAt = (t) => {
      const hit = paused(t) ? null : hitAt(t);
      const z = hit ? hit.zoom : 0;
      const sx = hit && hit.shake ? Math.sin(hit.d * 71) * 9 * unit * hit.shake : 0, sy = hit && hit.shake ? Math.cos(hit.d * 57) * 7 * unit * hit.shake : 0;
      return { hit, frame: z || sx ? zoomRect({ x: sx, y: sy, w: W, h: H }, z, W / 2, H * (tall ? 0.3 : 0.4)) : full };
    };
    // He, cut out of the footage with the base grade only. A frame without a matte (a dropout) shows the plain footage over
    // everything: no look effect on that frame rather than one frame of a recoloured speaker.
    // Frames counted while a frame is being rendered (engine beginFrame / endFrame): those where the matte was missing in ANY sample are
    // receipted (stats()) so the caller can re-look a window that spent a fifth of its frames without the look.
    const counter = createMatteCounter((t) => clip.matte(t));
    const matteAt = counter.matteAt;
    const drawClean = (g, t, frame) => {
      if (matteAt(t)) return clip.subject(g, t, frame, { filter: grade, choke: readableChoke });
      g.save(); if (grade) g.filter = grade; clip.draw(g, t, frame); g.restore();
      return false;
    };
    let postLayer = null;
    const cleanPost = (g, t) => {
      if (!matteAt(t)) return;                      // a frame without a matte shows the plain footage: no post layer on it
      const cw = g.canvas.width, ch = g.canvas.height;
      if (!postLayer || postLayer.width !== cw || postLayer.height !== ch) postLayer = new OffscreenCanvas(cw, ch);
      const pg = postLayer.getContext('2d', { willReadFrequently: true });
      const tr = g.getTransform();
      pg.setTransform(1, 0, 0, 1, 0, 0); pg.globalCompositeOperation = 'source-over'; pg.globalAlpha = 1; pg.filter = 'none';
      pg.clearRect(0, 0, cw, ch);
      pg.drawImage(g.canvas, 0, 0);                 // the frame before the look's post layers
      pg.globalCompositeOperation = 'destination-in';   // ... kept only inside his silhouette
      pg.setTransform(tr);
      clip.subject(pg, t, frameAt(t).frame, { filter: grade, choke: readableChoke });
      pg.globalCompositeOperation = 'source-over';
      pg.setTransform(1, 0, 0, 1, 0, 0);
      L.post(g, t, frameAt(t).hit);
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none';
      g.drawImage(postLayer, 0, 0);
      g.restore();
    };

    // A layer of the look that must stay off him (neon's wall wash, its caption haze): drawn on its own canvas, his silhouette cut
    // out of it, then laid over the frame. Without personClean it is just fn(g). A frame without a matte skips the layer.
    let offLayer = null;
    api.offHim = (g, t, fn, { blend = 'source-over' } = {}) => {
      if (!personClean) { fn(g); return; }
      if (!matteAt(t)) return;
      const cw = g.canvas.width, ch = g.canvas.height;
      if (!offLayer || offLayer.width !== cw || offLayer.height !== ch) offLayer = new OffscreenCanvas(cw, ch);
      const pg = offLayer.getContext('2d', { willReadFrequently: true });
      const tr = g.getTransform();
      pg.setTransform(1, 0, 0, 1, 0, 0); pg.globalCompositeOperation = 'source-over'; pg.globalAlpha = 1; pg.filter = 'none';
      pg.clearRect(0, 0, cw, ch);
      pg.setTransform(tr);
      fn(pg);
      pg.setTransform(tr); pg.globalCompositeOperation = 'destination-out'; pg.globalAlpha = 1; pg.filter = 'none';
      clip.subject(pg, t, frameAt(t).frame, { filter: grade, choke: readableChoke });   // the same choked alpha as the redraw of him: no soft ring between the wash cut and his edge
      pg.globalCompositeOperation = 'source-over';
      pg.setTransform(1, 0, 0, 1, 0, 0);
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = blend; g.filter = 'none';
      g.drawImage(offLayer, 0, 0);
      g.restore();
    };

    // ── smart placement (engine init phase): read the person matte at each
    // hero word and put the giant where the picture actually has room —
    // behind the person when enough background shows, else the top band,
    // else the free lower band. Deterministic: fixed times, fetched up front.
    const smart = hasMatte && placement === 'auto' && !raw.heroPlacement && !zones && !readable;
    const behindHeroes = () => heroes.filter((p) => !p.front);
    const coverage = (t) => {
      const m = clip.matte(t);
      if (!m) return null;
      const cw = 24, chh = Math.max(8, Math.round(24 * H / W));
      const c = new OffscreenCanvas(cw, chh), cg = c.getContext('2d', { willReadFrequently: true });
      const sc = Math.max(cw / m.width, chh / m.height), dw = m.width * sc, dh = m.height * sc;
      cg.drawImage(m, (cw - dw) / 2, (chh - dh) / 2, dw, dh);
      const d = cg.getImageData(0, 0, cw, chh).data;
      // fraction of a rectangle (fractions of the frame) that is FREE background
      return (y0, y1, x0 = 0.08, x1 = 0.92) => {
        let free = 0, n = 0;
        for (let r = Math.floor(y0 * chh); r < Math.min(chh, Math.ceil(y1 * chh)); r++) for (let x = Math.floor(x0 * cw); x < Math.ceil(x1 * cw); x++) { n++; if (d[(r * cw + x) * 4 + 3] < 96) free++; }
        return n ? free / n : 1;
      };
    };

    return {
      duration,
      samplesHint: L.samplesHint,
      ...(personClean ? {
        beginFrame: counter.beginFrame,
        endFrame: counter.endFrame,
        stats: counter.stats,
      } : {}),
      // init: fetch the footage at each phrase (background brightness under the
      // caption) and, for smart placement, the matte at each hero word
      initTimes: clip ? () => [...phrases.map((p) => p.start + 0.15), ...(smart ? behindHeroes().map((p) => p.key.start + 0.1) : [])] : undefined,
      init: clip ? () => {
        // how bright the footage is behind each caption (0..1): looks thicken
        // their haze/shadow on bright shots so type never washes out
        const lc = new OffscreenCanvas(32, Math.max(8, Math.round(32 * H / W))), lg = lc.getContext('2d', { willReadFrequently: true });
        let bright = 0;
        for (const p of phrases) {
          const bmp = clip.frame(p.start + 0.15);
          if (!bmp || !p.box) continue;
          const sc = Math.max(lc.width / bmp.width, lc.height / bmp.height), dw = bmp.width * sc, dh = bmp.height * sc;
          lg.drawImage(bmp, (lc.width - dw) / 2, (lc.height - dh) / 2, dw, dh);
          const x0 = Math.max(0, Math.floor(p.box.x0 / W * lc.width)), x1 = Math.min(lc.width, Math.ceil(p.box.x1 / W * lc.width));
          const y0 = Math.max(0, Math.floor(p.box.y0 / H * lc.height)), y1 = Math.min(lc.height, Math.ceil(p.box.y1 / H * lc.height));
          if (x1 <= x0 || y1 <= y0) continue;
          const d = lg.getImageData(x0, y0, x1 - x0, y1 - y0).data;
          let acc = 0;
          for (let i = 0; i < d.length; i += 4) acc += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
          p.bgLuma = acc / (d.length / 4);
          if (p.bgLuma > 0.5) bright++;
        }
        if (bright) qa.note(`${bright} of ${phrases.length} captions sit on bright footage (backing strengthened)`);
        if (!smart) return;
        const moved = [], seen = [];
        for (const p of behindHeroes()) {
          const cov = coverage(p.key.start + 0.1);
          if (!cov) continue;
          // where the giant would sit: the top band (vertical cover), or the middle band (wide shots)
          const top = cov(0.07, 0.3), mid = cov(0.3, 0.7);
          let place = tall ? (top >= 0.28 ? 'cover' : 'front') : mid >= 0.38 ? 'behind' : top >= 0.35 ? 'cover' : 'front';
          p.placeInfo = { top: +top.toFixed(2), mid: +mid.toFixed(2), place };
          seen.push(`${p.key.text}: free top ${Math.round(top * 100)}% / middle ${Math.round(mid * 100)}% → ${place}`);
          const was = p.cover ? 'cover' : 'behind';
          if (place === was) continue;
          p.front = place === 'front';
          p.cover = place === 'cover';
          const was2 = p.captionless;
          const lay2 = layoutPhrase(p) || {};
          if (p.captionless) p.box = null; else if (was2) p.box = lay2.box || p.box;
          moved.push(`${p.key.text}→${place}`);
        }
        qa.note(`smart placement (person matte): ${seen.join('; ')}${moved.length ? ` — moved ${moved.join(', ')}` : ''}`);
      } : undefined,
      draw(g, t) {
        const tq = q(t);
        const hit = paused(t) ? null : hitAt(t);
        const z = hit ? hit.zoom : 0;
        const sx = hit && hit.shake ? Math.sin(hit.d * 71) * 9 * unit * hit.shake : 0, sy = hit && hit.shake ? Math.cos(hit.d * 57) * 7 * unit * hit.shake : 0;
        const frame = z || sx ? zoomRect({ x: sx, y: sy, w: W, h: H }, z, W / 2, H * (tall ? 0.3 : 0.4)) : full;
        if (!clip) { g.fillStyle = P.bg; g.fillRect(0, 0, W, H); }
        else if (split) {
          g.save(); g.filter = `${grade || ''} blur(${Math.round(38 * unit)}px)`; clip.draw(g, t, { x: -40, y: -40, w: W + 80, h: H + 80 }); g.restore();
          g.save(); g.globalAlpha = 0.62; g.fillStyle = P.bg; g.fillRect(0, 0, W, H); g.restore();
          g.save(); g.beginPath(); g.rect(panel.x, panel.y, panel.w, panel.h); g.clip();
          drawFootage(g, t, z ? zoomRect(panel, z, panel.x + panel.w / 2, panel.y + panel.h * 0.32) : panel, hit);
          g.restore();
          if (L.panelFrame) L.panelFrame(g, t, hit); else K.bar(g, panel.x, panel.y + panel.h + Math.round(10 * unit), panel.w * 0.18, Math.max(3, Math.round(4 * unit)), P.a);
        } else {
          drawFootage(g, t, frame, hit);
          const fe = L.footage ? footageEdge(t) : 1;
          if (fe < 0.999) { g.save(); g.globalAlpha = 1 - fe; if (grade) g.filter = grade; clip.draw(g, t, frame); g.restore(); }
        }
        const p = paused(t) ? null : phraseAt(tq);
        // stage: the scene's ambient world, cross-faded at scene changes
        if (stage && scenes.length) {
          const sc = sceneAt(t) || scenes[0];
          const prev = sc.k > 0 ? scenes[sc.k - 1] : null;
          const mix = prev ? K.smoothstep(0, 1, (t - sc.start) / 0.9) : 1;
          const drawAmb = (x, a) => { if (a <= 0.002) return; g.save(); g.globalAlpha = a; if (paperBg) g.globalCompositeOperation = 'multiply'; drawPlate(g, x.ambient, t, K.clamp((t - x.start) / 20), { W, H, P, seed: seed + x.k, K, alpha: a }); g.restore(); };
          // a paper look (swiss, riso) keeps its paper: the world is only a faint texture
          const amb = paperBg ? 0.13 : 0.42;
          if (prev && mix < 1) drawAmb(prev, amb * (1 - mix));
          drawAmb(sc, amb * mix);
        }
        // 0) a background plate: the world behind him transforms on the hero word
        const pw = plateWins.length && !paused(t) ? plateAt(t) : null;
        // a look that draws its own cut-out (cinema) only does so during its hero
        // phrase, so its plate must end with that phrase
        const pwEnd = pw ? (L.ownSubject ? Math.min(pw.end, pw.p.out) : pw.end) : 0;
        const plateOn = pw && t < pwEnd && ((hasMatte && !pw.p.front) || !clip);
        if (plateOn) {
          const k0 = pw.k0, end = pwEnd, pp = pw.p;
          const a = K.smoothstep(0, 1, (t - k0) / 0.25) * (1 - K.smoothstep(0, 1, (t - (end - 0.3)) / 0.3));
          if (a > 0.002) {
            const u = K.clamp((t - k0) / Math.max(0.6, end - k0));
            const s = 1.06 - 0.06 * (1 - Math.pow(1 - u, 3)); // the new world settles in
            g.save();
            g.globalAlpha = a;
            g.translate(W / 2, H * 0.4); g.scale(s, s); g.translate(-W / 2, -H * 0.4);
            if (pp.plate.media) {
              ctx.media.get(pp.plate.media).draw(g, t, full);
              g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, W, H);
            } else drawPlate(g, pp.plate.id, t, u, { W, H, P, seed, K, alpha: a });
            g.restore();
          }
        }
        // 1) behind the speaker
        if (L.behind) L.behind(g, t, tq, p, hit, frame);
        for (const o of overlays) if (o.above === false && t >= o.at && t < o.at + o.dur) o.built.scene.draw(g, t - o.at);
        // 2) the speaker, cut out and re-drawn over whatever the look put behind
        // a look may draw its own cut-out (L.ownSubject) or grade it (L.subjectFilter)
        const cut = (p && p.hero && !p.front && hasMatte && !L.ownSubject && (!L.wantsSubject || L.wantsSubject(p, t, hit))) || (plateOn && hasMatte && !L.ownSubject);
        if (personClean) {
          // looks behind him: his clean pixels over everything the look drew so far; the hit (a whole-frame flash) is background too
          if (L.hit) L.hit(g, t, hit, frame);
          else if (hit && hit.flash > 0.002) { g.save(); g.globalAlpha = hit.flash; g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, W, H); g.restore(); }
          drawClean(g, t, frame);
        } else {
        if (cut) clip.subject(g, t, frame, { filter: L.subjectFilter ? L.subjectFilter(t, p, hit) : grade });
        if (L.onSubject) L.onSubject(g, t, tq, p, hit, frame, cut);
        // 3) the hit, then everything in front of the speaker
        if (L.hit) L.hit(g, t, hit, frame);
        else if (hit && hit.flash > 0.002) { g.save(); g.globalAlpha = hit.flash; g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, W, H); g.restore(); }
        }
        if (p && stage && loudV) {
          // the voice breathes into the type: a small pulse with loudness
          const cy = (p.scene?.cy ?? 0.5) * H, sc = 1 + 0.035 * K.clamp(loud(t));
          g.save(); g.translate(W / 2, cy); g.scale(sc, sc); g.translate(-W / 2, -cy);
          L.front(g, t, tq, p, hit);
          g.restore();
        } else if (p && !p.captionless) L.front(g, t, tq, p, hit);
        for (const o of overlays) {
          if (o.above === false || t < o.at || t >= o.at + o.dur) continue;
          if (o.dim) { g.save(); g.globalAlpha = o.dim; g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.restore(); }
          g.save(); o.built.scene.draw(g, t - o.at); g.restore();
        }
      },
      post: L.post ? (g, t) => (personClean ? cleanPost(g, t) : L.post(g, t, paused(t) ? null : hitAt(t))) : undefined,
    };
  },
};
