// UI DEMO — a recorded product UI (kinetype.capture.v1) as a product-film shot.
// The capture sits in a quiet frame (minimal browser chrome, a generic device
// bezel, or a bare card) on a calm tonal ground. The film clock maps to the
// capture clock through range + retime; an automatic camera plans its shots
// from the capture's events (anticipating each one, critically damped, never
// cropping the active target, never upscaling the UI past its source pixels);
// a synthetic cursor travels minimum-jerk paths and lands just before each
// click; callouts anchor to the event they explain. All planning lives in
// src/kit/x-ui.js as pure, unit-tested functions.
import * as K from '../../src/kit/index.js';
import * as X from '../../src/kit/x-ui.js';
import { isReal } from '../../src/kit/x-real.js';
import { buildReal } from './real.js';

const FRAMES = ['browser', 'phone', 'bare', 'none'];
const CHROME_H = X.FRAME.chromeH; // browser title bar, CSS px of the capture
const BEZEL = X.FRAME.bezel; // phone bezel, CSS px
const REF = ['string', 'number']; // a mark id, step id or capture seconds
const RETIME_LIST = {
  type: 'array', maxItems: 32,
  items: { type: 'object', additionalProperties: false, properties: { from: { type: REF }, to: { type: REF }, speed: { type: 'number', minimum: 0.25, maximum: 8 }, at: { type: REF }, hold: { type: 'number', minimum: 0, maximum: 10 } } },
};

export default {
  id: 'ui-demo',
  version: '1.0.0',
  name: 'UI Demo',
  description: 'A recorded product UI (kinetype capture) as a product-film shot: browser chrome or phone bezel on a calm ground, retimed, auto camera from events, human cursor, anchored callouts.',
  tags: ['product', 'demo', 'ui', 'screen-recording'],
  formats: ['landscape', 'vertical', 'square', 'portrait'],
  bpm: 120,
  duration: 10,
  loop: false,
  palette: {
    bg: '#E9E7E2', night: '#D9D6CF', ink: '#15161A', paper: '#FBFAF8', chrome: '#F3F2EF', chromeInk: '#5D6067', accent: '#2F55E4',
  },
  paletteRoles: { night: 'night ground / falloff', ink: 'labels, cursor, bezel', chrome: 'title bar', accent: 'ripple, ring' },
  fonts: {
    label: { family: 'Inter Tight', weight: 600 },
    url: { family: 'Inter', weight: 500 },
  },
  params: {
    zoomMax: null, fill: 0.6, padding: 44, lead: 0.42, linger: 0.75, returnGap: 2.5,
    windowScale: null, bandBottom: 0, footnoteBand: null, grain: 0.03, falloff: 0.55, radius: 12, calloutScale: 1, autoHold: true, ground: null, breathe: 0, drift: 0.05,
  },
  schema: {
    content: {
      type: 'object',
      additionalProperties: false,
      properties: {
        capture: { type: 'string', description: 'spec.media id of the capture (or content.session for several devices)' },
        session: {
          type: 'object', additionalProperties: false, required: ['devices'], description: 'real mode: several native recordings on one session clock',
          properties: {
            devices: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'object', additionalProperties: false, required: ['id', 'capture'], properties: { id: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]*$' }, capture: { type: 'string' }, label: { type: 'string', maxLength: 24 }, sessionOffset: { type: 'number' }, cropTop: { type: 'number', minimum: 0, description: 'full-bleed: video px from the top never shown (OS status bar + browser toolbar)' } } } },
            clock: { type: 'string', pattern: '^\\d{1,2}:\\d{2}(:\\d{2})?$', description: 'wall time at session second 0 (shared clock chip)' },
          },
        },
        edit: {
          type: 'array', maxItems: 24, description: 'real mode: the edit as shots — {device, from, to} or {split: [a, b], from, to} (refs: mark/step ids or "device:mark±s")',
          items: { type: 'object', additionalProperties: false, properties: { device: { type: 'string' }, focus: { type: 'object', description: 'a deliberate hold framing {box: {x,y,w,h} video px, at?: film s of the shot | ref, zoom?}' }, split: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'string' } }, from: { type: REF }, to: { type: REF }, retime: {}, open: { type: 'object' } } },
        },
        beats: { type: 'array', maxItems: 64, description: 'real mode: narration beats [{at: mark/step ref, t: film s}] — auto pace lands each mark on its beat', items: { type: 'object', additionalProperties: false, required: ['at', 't'], properties: { at: { type: REF }, t: { type: 'number', minimum: 0 } } } },
        minDuration: { type: 'number', minimum: 1, maximum: 600, description: 'real mode: hold the last frame so the film is at least this long (never end under the voice)' },
        open: { type: 'object', additionalProperties: false, required: ['at'], description: 'real mode: cold open on a payoff {at, dur}', properties: { at: { type: REF }, dur: { type: 'number', minimum: 0.4, maximum: 3 } } },
        captions: { type: 'array', maxItems: 24, description: 'real mode: Norwegian captions [{at (film s | ref), text, dur?, offset?}]', items: { type: 'object', additionalProperties: false, required: ['at', 'text'], properties: { at: { type: REF }, text: { type: 'string', minLength: 1, maxLength: 64 }, dur: { type: 'number' }, offset: { type: 'number' }, em: { type: 'string', maxLength: 32, description: 'band captions: this substring (e.g. the kr figure) in the accent' } } } },
        payoffs: { type: 'array', maxItems: 16, items: { type: 'string' }, description: 'real mode: marks to treat as payoffs ("device:mark" or "mark") — auto pace holds them, the pace report measures the holds' },
        band: { type: 'object', additionalProperties: false, description: 'real mode 9:16 with params.bandTop: the band footer', properties: { brand: { type: 'string', maxLength: 24 }, note: { type: 'string', maxLength: 48, description: 'the qualifier, e.g. "Produktskjerm · demodata"' } } },
        endCard: { type: 'object', additionalProperties: false, required: ['at', 'title'], description: 'real mode: an end card that wipes up over the last shot at film second `at` (hold ≥ 2 s)', properties: { at: { type: 'number', minimum: 0 }, title: { type: 'string', maxLength: 24 }, line: { type: 'string', maxLength: 80 }, url: { type: 'string', maxLength: 40 }, note: { type: 'string', maxLength: 60 } } },
        frame: { enum: FRAMES },
        urlLabel: { type: 'string', maxLength: 48 },
        range: { type: 'object', additionalProperties: false, properties: { from: { type: REF }, to: { type: REF } } },
        retime: {
          description: '"auto" (real mode: auto pace) | {mode: "auto", overrides: [...]} | [{from,to,speed} | {at,hold}] (freeze just before at); capture clock',
          oneOf: [
            { const: 'auto' },
            { type: 'object', additionalProperties: false, properties: { mode: { const: 'auto' }, overrides: RETIME_LIST } },
            RETIME_LIST,
          ],
        },
        camera: {
          description: 'auto | wide | [{at, zoom, focus}]',
          oneOf: [{ enum: ['auto', 'wide'] }, { type: 'array', maxItems: 32, items: { type: 'object', additionalProperties: false, required: ['at'], properties: { at: { type: REF }, zoom: { type: 'number', minimum: 1, maximum: 4 }, focus: {} } } }],
        },
        callouts: {
          type: 'array', maxItems: 12,
          items: {
            type: 'object', additionalProperties: false, required: ['at', 'text'],
            properties: {
              at: { type: REF }, text: { type: 'string', minLength: 1, maxLength: 44 },
              target: { description: '"event" (default: the at-step\'s tracked target) | "<step id>" (another tracked element, e.g. an observe step: the auto camera then FOCUSES it and holds the shot for the callout duration) | {x,y,w,h} (a fixed region, untracked)' },
              duration: { type: 'number', minimum: 0.8, maximum: 8 }, side: { enum: ['right', 'left', 'above', 'below'] },
              when: { enum: ['before', 'after'], description: 'before (default for clicks) | after the action' },
            },
          },
        },
        footnote: { type: 'string', maxLength: 60 },
        cursor: { type: 'object', additionalProperties: false, properties: { show: { type: 'boolean' }, style: { enum: ['mac', 'touch'] }, size: { type: 'number' } } },
      },
    },
    params: {
      type: 'object', additionalProperties: false,
      properties: {
        zoomMax: { type: ['number', 'null'], description: '≤ 1.15 output px per source px anyway' },
        lead: { type: 'number' },
        autoHold: { type: 'boolean', },
        fill: { type: 'number' }, padding: { type: 'number' }, linger: { type: 'number' }, returnGap: { type: 'number' },
        windowScale: { type: ['number', 'null'] }, bandBottom: { type: 'number', minimum: 0, maximum: 0.4, description: 'Fraction of the frame height kept free at the bottom for an external caption band: the stage (window, camera, callouts) is laid out in the remaining height, centred in it. Default 0.' }, footnoteBand: { type: ['boolean', 'null'], description: 'Default null = auto: a footnote reserves its own band under the stage so the chip never covers captured content; false = overlay bottom-left; true = ' + 'With bandBottom > 0: place the footnote chip inside that free band (vertically centred, same left margin) so it never covers the captured UI. Default false: chip bottom-left over the stage.' }, grain: { type: 'number' }, falloff: { type: 'number' }, radius: { type: 'number' }, calloutScale: { type: 'number' }, breathe: { type: 'number', description: 'legacy; the larger of breathe and drift applies' }, drift: { type: 'number', minimum: 0, maximum: 0.2, description: 'Slow ease push-in kept during any camera hold longer than ~2.5 s: up to this fraction of the shot zoom (default 0.05), about the focus/ring centre, never past zoomMax. 0 = off (a hold longer than 5 s then fails the static-hold check).' },
        ground: { enum: ['light', 'night', null] },
        phone: { enum: ['slab', 'glass', 'silver'], description: 'real mode, 16:9 / split: the device look' },
        side: { type: 'number', minimum: 0, maximum: 0.5, description: 'real mode 16:9: width fraction kept for captions right of the phone (default 0.36 when captions exist)' },
        textCss: { type: 'number', description: 'real mode: CSS px of the UI body text the narration refers to (legibility, default 16)' },
        legibility: { type: 'number', description: 'real mode: min rendered UI text px (default 18)' },
        focus: { type: 'number', description: 'real mode framed (16:9): push-in zoom on the active region (default 2.0)' },
        splitZoom: { type: 'number', description: 'real mode 16:9 split: stage zoom about the phones\' top edge (default 1.45)' },
        tapPush: { type: 'number', description: 'real mode full-bleed: gentle punch-in on a tapped target that fits (default 1.1)' },
        reveal: { type: 'number', description: 'real mode framed: zoom of the payoff reveal (default 1.5, top-anchored: header + result in view, legible)' },
        push: { type: 'number', description: 'real mode: gentle push-in on payoffs (default 1.08, capped by source resolution)' },
        touch: { type: 'boolean', description: 'real mode: draw press indicators (default true)' },
        touchR: { type: 'number', description: 'real mode: press disc radius as a fraction of the screen width (default 0.03)' },
        bandTop: { type: 'number', minimum: 0, maximum: 0.3, description: 'real mode 9:16 full-bleed: headline band height as a fraction of the frame; captions, content.band brand + qualifier live there, never over the UI' },
        clockChip: { enum: ['split', 'switch', 'always', 'never'], description: 'real mode: shared session clock chip — split shots only, also briefly after each device switch, always, never' },
        captionScale: { type: 'number' }, top: { type: 'number' }, bottom: { type: 'number' },
      },
    },
  },
  example: {
    template: 'ui-demo',
    format: 'landscape',
    fps: 30,
    media: { cap: { capture: '../fixtures/captures/demo-app-desktop/capture.json' } },
    content: {
      capture: 'cap', frame: 'browser', urlLabel: 'app.fieldnote.dev',
      retime: [{ from: 'client', to: 'priority', speed: 1.8 }],
      callouts: [{ at: 'new-project', text: 'One click to start' }],
    },
  },
  notes: 'spec.media.<id>.capture → capture.json (frames, else its video). Duration = range + retime (+ callout reading holds unless autoHold false). Auto camera from events; navigation/scroll go wide. Callouts ≤ 5 words, named before a click. Ground: night when palette.night is dark. Captured UI is exempt from palette QA. Use render.shutter 0.5. footnoteBand (default false): with params.bandBottom > 0 the footnote chip sits in the free band below the stage instead of over the captured UI (bandBottom 0: falls back to the overlay and warns); in the band the chip uses the label plate roles (paper plate on night, ink plate on light) so it reads on the ground. Focus (D20): a callout whose target is an `observe` step makes that element a camera focus (zoom frames the whole box with context; the shot and the ring stay for the callout\'s `duration`). params.drift (default 0.05) keeps any hold > 2.5 s alive with a slow push-in about the focus (never past zoomMax); the static-hold check fails a > 5 s frozen run. Camera edges snap to the capture\'s edge within 12 % and avoid slicing known cards; callout plates avoid other known elements and the window when possible (planning knows element boxes, not pixels); overlay-contrast checks callout, footnote and URL label at 4.5:1.',

  build(ctx) {
    const { W, H, fps, params, content: C, palette: P, qa, fonts } = ctx;
    const unit = Math.min(W, H) / 1080;
    const vert = ctx.aspect === 'vertical';
    const hub = ctx.media;
    // real mode: native recordings (C2 v2) or a multi-device session
    if (C.session || C.edit || C.frame === 'none' || C.retime === 'auto' || C.retime?.mode === 'auto' || (C.capture && hub?.src?.[C.capture]?.kind === 'capture' && isReal(hub.src[C.capture].capture))) return buildReal(ctx);
    const id = C.capture;
    if (!id) throw new Error('ui-demo: content.capture (one recording) or content.session (several devices) is required');
    const msrc = hub?.src?.[id];
    if (!msrc || msrc.kind !== 'capture') throw new Error(`ui-demo: content.capture "${id}" must name a spec.media entry with "capture": "…/capture.json" (have: ${Object.keys(hub?.src || {}).join(', ') || 'none'})`);
    const cap = msrc.capture;
    const dsf = cap.device.deviceScaleFactor || msrc.w / cap.device.viewport.width;
    const vw = cap.device.viewport.width, vh = cap.device.viewport.height;
    const phoneCap = cap.device.kind === 'phone';
    const frameKind = C.frame || (phoneCap ? 'phone' : 'browser');
    const touch = (C.cursor?.style ?? (phoneCap ? 'touch' : 'mac')) === 'touch';
    const showCursor = C.cursor?.show !== false;

    // ───────── clocks ─────────
    const rt0 = X.buildRetime(cap, { range: C.range, retime: C.retime });
    // callouts: anchored event, when they land ('before' a click names the control
    // before its result covers it), and the freezes that give them reading time
    // The highlighted element is the event's TRACKED target (C2 events[].track): its box on every
    // captured frame and whether it is really visible there. target "event" (default) = the
    // at-step's own target; target "<step id>" names another tracked element explicitly (e.g. an
    // `observe` step on the sheet a click opened); target {x,y,w,h} = a fixed region the spec owns.
    const coIn = (C.callouts || []).map((co, i) => {
      const ev = typeof co.at === 'string' ? X.stepEvent(cap, co.at) : null;
      const ct = ev ? ev.t : X.captureTime(cap, co.at);
      const named = typeof co.target === 'string' && co.target !== 'event';
      const tev = named ? X.stepEvent(cap, co.target) : co.target && typeof co.target === 'object' ? null : ev;
      if (named && !tev?.box) throw new Error(`ui-demo: callout ${i + 1} ("${co.text}") target "${co.target}" is not a step with a boxed event`);
      const fixed = co.target && typeof co.target === 'object' ? co.target : null;
      const box = fixed || tev?.box;
      if (!box) throw new Error(`ui-demo: callout ${i + 1} ("${co.text}") has no target box — give target {x,y,w,h}, a step id, or an "at" step with a boxed event`);
      if (!fixed && !tev.track) qa.warn(`callout "${co.text}": capture has no target track for step ${tev.step} (made before tracks) — not drawn; re-capture (fail-closed: its visibility is unknown)`);
      return { co, ev, tev, fixed, ct, box, text: co.text, when: co.when ?? (ev?.type === 'click' ? 'before' : 'after') };
    });
    const coPlan = X.calloutPlan(cap, rt0, coIn, { lead: params.lead, autoHold: params.autoHold });
    const holds = X.planHolds(coPlan);
    const rt = holds.length ? X.buildRetime(cap, { range: C.range, retime: [...(C.retime || []), ...holds] }) : rt0;
    if (holds.length) qa.note(`ui-demo: reading holds for callouts ${holds.map((h) => `${h.hold.toFixed(2)}s @ capture ${h.at.toFixed(2)}s`).join(', ')} (params.autoHold=false to disable)`);
    const duration = ctx.spec.duration ?? rt.duration;
    const evs = X.filmEvents(cap, rt).filter((e) => e.t <= duration);
    const coTimes = coIn.map((c, i) => {
      const p = coPlan[i];
      const t0 = c.when === 'before' ? rt.toFilmFirst(p.at) + 0.02 : rt.toFilm(c.ct) + 0.18;
      const tEnd = c.when === 'before' ? rt.toFilm(c.ct) + 0.35 : t0 + (c.co.duration ?? Math.max(2.4, X.readTime(c.text)));
      // the camera must have framed the target by the time its label lands
      const fe = c.ev && evs.find((e) => e.step === c.ev.step && e.type === c.ev.type && Math.abs(e.ct - c.ev.t) < 1e-9);
      if (fe) { fe.attend = Math.min(fe.attend ?? Infinity, t0 - 0.08); if (c.when === 'before') fe.arriveBy = t0 + 0.3; }
      const tEndF = c.co.duration && c.when === 'before' ? Math.max(tEnd, t0 + c.co.duration) : tEnd;
      // an `observe` named by a callout is the narrated element: the auto camera focuses it and keeps the shot until the callout ends
      const te = !c.fixed && c.tev?.type === 'observe' && c.tev.box ? evs.find((e) => e.step === c.tev.step && e.type === 'observe' && Math.abs(e.ct - c.tev.t) < 1e-9) : null;
      if (te) { te.focus = true; te.attend = Math.min(te.attend ?? Infinity, t0 - 0.08); te.holdUntil = Math.max(te.holdUntil ?? 0, tEndF); }
      return { t0, tEnd: tEndF };
    });
    const capIdx = (t) => K.clamp(Math.floor(rt.toCapture(K.frameQuant(t, fps)) * cap.fps + 1e-6), 0, msrc.frames - 1);

    // ───────── stage geometry (CSS px of the capture → screen px) ─────────
    const win = X.frameRect(frameKind, vw, vh);
    // the wide shot is big: the window fills the frame up to the safe margins
    // (a 16:10 window + chrome in 16:9 is height-bound at ~82 % of the width);
    // params.windowScale sets the width fraction directly (the window may then bleed)
    // The footnote chip must never sit on captured content: unless params.footnoteBand is set explicitly (false = overlay, true = your band),
    // a footnote reserves its own solid-chip band under the stage (at least what the chip needs) and the stage moves up.
    const fnCap = Math.max(16 * unit, Math.round(Math.min(W, H) * 0.0148)), fnH = Math.round(fnCap * 2.4);
    const autoBand = !!C.footnote && params.footnoteBand == null;
    const bandPx = Math.max(Math.round(H * K.clamp(params.bandBottom ?? 0, 0, 0.4)), autoBand ? fnH + 2 * Math.round(0.012 * H) : 0), Hs = H - bandPx; // stage height (above any caption band)
    const edge = Math.round(Math.min(W, H) * 0.028);
    const deskLand = !phoneCap && !vert && params.windowScale == null;
    // desktop in landscape: ~87 % of the width, title bar at the safe edge, the window's
    // bottom may bleed off the frame (≤ 4 % of its height) — big enough to read at wide
    const s = params.windowScale != null ? (W * K.clamp(params.windowScale, 0.4, 1)) / win.w
      : deskLand ? Math.min((W * 0.87) / win.w, (Hs - edge) / (win.h * 0.96))
      : Math.min((W * (phoneCap ? (vert ? 0.86 : 0.9) : vert ? 0.92 : 0.9)) / win.w, (Hs * (vert && !phoneCap ? 0.6 : phoneCap && vert ? (bandPx ? 0.9 : 0.84) : 1) - (phoneCap && vert ? 0 : 2 * edge)) / win.h);
    const bleeds = win.h * s > Hs - 2 * edge + 0.5;
    const camContent = bleeds ? { ...win, y: win.y - edge / s, h: win.h + edge / s } : win;
    const zRes = (1.15 * dsf) / s; // never more than 1.15 output px per captured device px
    const zMax = Math.max(1, Math.min(params.zoomMax != null ? K.clamp(params.zoomMax, 1, 4) : vert && !phoneCap ? 3.2 : 2.4, zRes));
    const context = (cap.events || []).map((e) => e.box).filter(Boolean);
    const view = X.makeView({ context, content: camContent, wideTop: bleeds, viewW: W / s, viewH: Hs / s, zMax, fill: vert && !phoneCap ? 0.92 : K.clamp(params.fill, 0.3, 0.9), padding: params.padding });
    qa.note(`ui-demo: ${cap.flow} ${vw}×${vh}@${dsf}x (${msrc.source}), window scale ${s.toFixed(3)} screen px per CSS px, zoom ≤ ${zMax.toFixed(2)} (source limit ${zRes.toFixed(2)}), film ${duration.toFixed(2)}s from capture ${rt.c0.toFixed(2)}–${rt.c1.toFixed(2)}s`);

    // ───────── camera ─────────
    let keys;
    if (C.camera === 'wide') keys = [];
    else if (Array.isArray(C.camera)) {
      keys = X.manualCamera(C.camera.map((k) => {
        const ct = X.captureTime(cap, k.at);
        let focus = k.focus;
        if (focus === 'event' || (focus == null && typeof k.at === 'string')) {
          const e = typeof k.at === 'string' ? X.stepEvent(cap, k.at) : null;
          focus = e?.box || (e?.point ? { x: e.point.x, y: e.point.y } : undefined);
        }
        return { t: rt.toFilm(ct) - (k.zoom > 1 ? params.lead : 0), zoom: k.zoom ?? 1, focus };
      }), view);
    } else keys = X.planCamera(evs, view, { lead: params.lead, linger: params.linger, returnGap: params.returnGap, duration });
    const cam = X.cameraTrack(keys, view, undefined, { drift: K.clamp(Math.max(params.drift ?? 0, params.breathe ?? 0), 0, 0.2), duration, fps });
    for (const k of keys) qa.note(`camera ${k.t.toFixed(2)}s → zoom ${k.z.toFixed(2)} @ (${Math.round(k.cx)}, ${Math.round(k.cy)}) ${k.why}`);
    // the ONE capture → output map: the frames and every overlay go through it
    const map = X.stageMap({ W, H: Hs, s });
    const toScreen = map.pt, boxScreen = map.box;
    const capFrame = (t) => capIdx(t);
    /** The highlighted box of callout co on the capture frame shown at film time t (CSS px), or null when it must not be drawn. */
    const targetAt = (co, t) => {
      if (co.fixed) return co.fixed;
      const tr = X.trackAt(co.tev, capFrame(t), cap.fps);
      return tr && tr.visible ? tr.box : null;
    };
    /** Highlight ring (output px): the target box + HIGHLIGHT_PAD CSS px, through the shared map. */
    const ringOf = (c, box) => boxScreen(c, X.pad(box, X.HIGHLIGHT_PAD));
    /** Is a ring (output px) wholly on the stage and over the captured viewport (not off-frame, not on the chrome)? */
    const inView = (c, r) => {
      const v = boxScreen(c, { x: -X.HIGHLIGHT_PAD, y: -X.HIGHLIGHT_PAD, w: vw + 2 * X.HIGHLIGHT_PAD, h: vh + 2 * X.HIGHLIGHT_PAD });
      const x0 = Math.max(0, v.x), y0 = Math.max(0, v.y), x1 = Math.min(W, v.x + v.w), y1 = Math.min(Hs, v.y + v.h);
      return r.x >= x0 - 0.5 && r.y >= y0 - 0.5 && r.x + r.w <= x1 + 0.5 && r.y + r.h <= y1 + 0.5;
    };

    // ───────── cursor ─────────
    const firstPt = evs.find((e) => e.type === 'click' && e.point)?.point;
    const start = firstPt ? { x: K.clamp(firstPt.x - 0.2 * vw, 0.14 * vw, 0.86 * vw), y: K.clamp(firstPt.y + 0.24 * vh, 0.18 * vh, 0.84 * vh) } : { x: vw * 0.6, y: vh * 0.66 };
    const cursor = X.planCursor(evs, { seed: ctx.seed, bounds: { x: 0, y: 0, w: vw, h: vh }, start });
    const cursorSize = K.clamp(C.cursor?.size ?? 1, 0.6, 2) * 24; // CSS px of the capture at zoom 1

    // ───────── callouts ─────────
    const overlayInk = []; // {label, fg, bg} of every overlay text role, for the overlay-contrast check
    const fL = fonts.get('label'), fU = fonts.get('url');
    const capSize = (face, cap_) => (cap_ * face.upm) / face.capHeight;
    // ground: light (bg → night falloff) or the brand's night; labels invert on night
    const night = params.ground ? params.ground === 'night' : K.luminance(P.night) < 0.18;
    const plate = night ? P.paper : P.ink, plateInk = night ? P.ink : P.paper;
    const cCap = (vert ? 30 : 23) * unit * K.clamp(params.calloutScale, 0.6, 1.6);
    const safe = { x: ctx.grid.margin * 0.75, y: ctx.grid.margin * 0.75, w: W - ctx.grid.margin * 1.5, h: Hs - ctx.grid.margin * 1.5 };
    const callouts = coIn.map((ci, i) => {
      const { co, box: box0 } = ci;
      const { t0, tEnd } = coTimes[i];
      const t1 = Math.min(duration - 0.1, X.calloutEnd(t0, tEnd - t0, box0, keys, view, evs, { tracked: !ci.fixed }));
      const run = K.shape(fL, co.text, { size: capSize(fL, cCap), tracking: -6 });
      const padX = cCap * 1.05, h = Math.round(cCap * 2.7), w = Math.round(run.advance + padX * 2);
      // frames on which the target is really there (fail-closed: covered, off-screen, gone → not drawn)
      const fr0 = Math.max(0, Math.ceil((t0 - 0.05) * fps - 1e-6)), fr1 = Math.min(Math.round(duration * fps) - 1, Math.floor((t1 + 0.4) * fps + 1e-6));
      const shown = [];
      for (let f = fr0; f <= fr1; f++) { const b = targetAt(ci, f / fps); if (b && inView(cam.at(f / fps), ringOf(cam.at(f / fps), b))) shown.push(f); }
      const vis = shown.filter((f) => f / fps <= t1).length / fps;
      if (!shown.length) {
        qa.warn(`callout "${co.text}": its target is not visible at any moment of its window (${t0.toFixed(2)}–${t1.toFixed(2)}s: covered, off-screen or untracked) — not drawn`);
        return null;
      }
      if (vis < X.readTime(co.text) - 0.05) qa.warn(`callout "${co.text}" is on screen ${vis.toFixed(2)}s, under its reading time ${X.readTime(co.text).toFixed(2)}s (the target is covered, or the camera or page moves on)`);
      // the side is decided once, where the shot has settled and the target is visible, then held (no flipping mid-move)
      const want = Math.min(t1 - 0.1, t0 + 0.6);
      const tm = shown.map((f) => f / fps).reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a));
      const box = targetAt(ci, tm);
      const c = cam.at(tm);
      const tb = ringOf(c, box);
      const cp = cursor.at(tm), cs = toScreen(c, cp.x, cp.y);
      // keep clear of the cursor and of every other control acted on around this moment
      const avoid = [{ x: cs.x - 4, y: cs.y - 4, w: 36 * unit, h: 48 * unit },
        ...evs.filter((e) => e.box && Math.abs(e.t - tm) < 2.5 && e.step !== ci.tev?.step && !(e.box.x === box0.x && e.box.y === box0.y)).map((e) => boxScreen(c, e.box))];
      // clutter: every other boxed element of the capture is a label/control the plate should not sit on; ground beats the window
      const soft = context.filter((b) => !(b.x === box.x && b.y === box.y && b.w === box.w && b.h === box.h) && !(b.w > 0.6 * vw)).map((b) => boxScreen(c, b));
      const pl = X.placeCallout(tb, w, h, safe, { gap: 46 * unit, avoid, soft, ui: boxScreen(c, win), prefer: co.side, rank: vert ? { below: 0, above: 1, right: 2, left: 3 } : undefined });
      Object.assign(pl, X.clearEdges(pl, w, h, boxScreen(c, win), safe, 18 * unit));
      if (pl.covered) qa.warn(`callout "${co.text}" could not avoid its target at ${tm.toFixed(2)}s`);
      // the plate's final spot (after the edge clearing) over other known elements of the captured UI
      const over = soft.filter((b) => X.overlaps({ x: pl.x, y: pl.y, w, h }, b, 0));
      if (over.length) qa.warn(`callout "${co.text}": its plate covers ${over.length} other element${over.length > 1 ? 's' : ''} of the captured UI at ${tm.toFixed(2)}s (pixels are not known at planning time: only recorded element boxes are checked) — set callouts[].side or target a roomier element`);
      qa.text(`callout ${i + 1}`, { box: { x0: pl.x + padX, y0: pl.y + (h - cCap) / 2, x1: pl.x + padX + run.inkWidth, y1: pl.y + (h + cCap) / 2 }, size: cCap, fg: plateInk, bg: plate });
      overlayInk.push({ label: `callout ${i + 1}`, fg: plateInk, bg: plate });
      qa.hit(t0, `callout ${i + 1}`);
      qa.keyframe(tm, `callout · ${co.text}`);
      return { ...ci, t0, t1, run, w, h, padX, side: pl.side, dist: pl.dist, text: co.text, ringOnly: X.sameText(co.text, ci.tev?.text ?? ci.tev?.label), shown: new Set(shown) };
    }).filter(Boolean);

    // ───────── QA: highlight accuracy (analytic, every frame; fails the render) ─────────
    // Independent of calloutState's lookup: each track is expanded to one entry per capture
    // frame here, and every highlight drawn must equal the shared-map image of the tracked box
    // (+ padding) within 1 output px, and only on frames where the target is visible.
    {
      const dense = new Map();
      const denseOf = (ev) => {
        if (!dense.has(ev)) {
          const arr = new Array(msrc.frames).fill(null);
          const end = ev.trackEnd != null ? Math.round(ev.trackEnd * cap.fps) : msrc.frames;
          for (const [k, e] of (ev.track || []).entries()) {
            const a = Math.round(e.t * cap.fps), b = k + 1 < ev.track.length ? Math.round(ev.track[k + 1].t * cap.fps) : end;
            for (let f = Math.max(0, a); f < Math.min(b, end, msrc.frames); f++) arr[f] = e;
          }
          dense.set(ev, arr);
        }
        return dense.get(ev);
      };
      const bad = [], nFrames = Math.round(duration * fps);
      let drawn = 0;
      for (let i = 0; i < nFrames; i++) {
        const t = i / fps, c = cam.at(t), ci = capIdx(t);
        for (const co of callouts) {
          const st = calloutState(co, t, c);
          if (!st) continue;
          drawn++;
          let exp = co.fixed;
          if (!co.fixed) {
            const e = denseOf(co.tev)[ci];
            if (!e || !e.visible || !e.box) { bad.push({ t: +t.toFixed(4), callout: co.text, why: 'highlight drawn while the target is not visible', captureFrame: ci }); continue; }
            exp = e.box;
          }
          const want = boxScreen(c, X.pad(exp, X.HIGHLIGHT_PAD)), r = st.ring;
          if (!inView(c, want)) bad.push({ t: +t.toFixed(4), callout: co.text, why: 'highlight drawn while its target is (partly) outside the shown frame', captureFrame: ci });
          const err = Math.max(Math.abs(r.x - want.x), Math.abs(r.y - want.y), Math.abs(r.x + r.w - want.x - want.w), Math.abs(r.y + r.h - want.y - want.h));
          if (err > 1) bad.push({ t: +t.toFixed(4), callout: co.text, why: `ring off by ${err.toFixed(2)} px`, captureFrame: ci });
          qa.overlay(t, { kind: 'highlight', label: co.text, captureFrame: ci, captureT: +(ci / cap.fps).toFixed(4), box: exp, ring: { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.w.toFixed(2), h: +r.h.toFixed(2) }, errPx: +err.toFixed(3), alpha: +st.a.toFixed(3), visible: true, fixed: !!co.fixed });
        }
      }
      // the cursor tip is ON the click point at the click, the ripple centred on it (output px)
      for (const e of evs.filter((x) => x.type === 'click' && x.point && x.t >= 0 && x.t <= duration)) {
        if (!showCursor || touch) break;
        const c = cam.at(e.t), p = cursor.at(e.t);
        const d = Math.hypot(p.x - e.point.x, p.y - e.point.y) * map.k(c);
        if (d > 1) bad.push({ t: +e.t.toFixed(4), callout: null, why: `cursor tip ${d.toFixed(2)} px from the click point of ${e.step}` });
      }
      qa.check('highlight-accuracy', bad.length ? 'fail' : 'pass',
        bad.length ? `${bad.length} highlight/cursor violations (ring ≠ tracked target ± ${X.HIGHLIGHT_PAD} CSS px within 1 px, or drawn while covered)` : `${drawn} highlight frames match their tracked, visible targets within 1 px; cursor on every click point`,
        bad.length ? bad.slice(0, 40) : undefined);
    }

    // ───────── QA: static hold (a run > 5 s in which nothing changes; analytic, every frame) ─────────
    // "Nothing changes" = same captured frame, camera within 1.5 output px (two window corners),
    // cursor and callout state unchanged. Frames of a live capture that differ count as change, so
    // this can only fire on a truly frozen picture (retime holds, a still capture) — no false positive.
    {
      const nF = Math.round(duration * fps);
      const d = [];
      for (let i = 0; i < nF; i++) {
        const t = i / fps, c = cam.at(t), cp = cursor.at(t);
        const a = toScreen(c, 0, 0), b = toScreen(c, vw, vh), cs = toScreen(c, cp.x, cp.y);
        d.push({ idx: capIdx(t), a, b, cur: showCursor ? { x: cs.x, y: cs.y, al: cp.alpha } : null, co: callouts.map((co) => calloutState(co, t, c)?.a ?? 0) });
      }
      const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
      const runs = X.staticRuns(nF, fps, (i, a) => {
        const p = d[i], q = d[a];
        return p.idx !== q.idx || dist(p.a, q.a) > 1.5 || dist(p.b, q.b) > 1.5
          || (p.cur && (dist(p.cur, q.cur) > 1 || Math.abs(p.cur.al - q.cur.al) > 0.02)) || p.co.some((v, k) => Math.abs(v - q.co[k]) > 0.02);
      });
      qa.check('static-hold', runs.length ? 'fail' : 'pass',
        runs.length ? `${runs.length} run(s) longer than 5 s with no camera, capture or overlay change: ${runs.map((r) => `${r.t0.toFixed(1)}–${r.t1.toFixed(1)}s`).join(', ')} — raise params.drift or shorten the hold` : `no frame group is identical for more than 5 s (params.drift ${params.drift})`,
        runs.length ? runs : undefined);
    }

    // ───────── QA: hits + keyframes at the events ─────────
    qa.keyframe(0.05, 'open');
    const kfEvents = evs.filter((e) => e.type === 'click' || e.type === 'navigate' || e.type === 'scroll' || e.type === 'hover');
    for (const e of kfEvents) {
      qa.hit(e.t, `${e.type} ${e.step || ''}`.trim());
      const lab = e.type === 'click' ? `${e.step || 'click'}` : e.type;
      if (callouts.some((co) => e.t >= co.t0 - 0.05 && e.t <= co.t1)) continue; // its callout still is the look
      qa.keyframe(Math.min(duration - 1 / fps, e.t + (e.type === 'navigate' ? 0.7 : e.type === 'scroll' ? 0.5 : 0.02)), lab);
    }
    for (const e of evs.filter((x) => x.type === 'type')) qa.keyframe(Math.min(duration - 1 / fps, (e.t + (e.t1 ?? e.t)) / 2), `typing · ${e.step}`);
    qa.keyframe(duration - 1 / fps, 'last frame');

    // ───────── footnote (claims small print): bottom-left, on its own plate ─────────
    let foot = null;
    if (C.footnote) {
      const fCap = fnCap;
      const run = K.shape(fonts.get('url'), C.footnote, { size: capSize(fonts.get('url'), fCap), tracking: 0, kerning: 'metric' });
      const m = Math.round(Math.min(W, H) * 0.045), padX = fCap * 0.9, h = Math.round(fCap * 2.4);
      let inBand = !!params.footnoteBand || autoBand;
      if (inBand && bandPx <= 0) { qa.warn('ui-demo: params.footnoteBand needs params.bandBottom > 0 — footnote stays bottom-left over the stage'); inBand = false; }
      else if (inBand && bandPx < h) { qa.warn(`ui-demo: footnote chip (${h} px) is taller than the ${bandPx} px band — raise params.bandBottom`); }
      const fy = inBand ? Hs + Math.round((bandPx - h) / 2) : H - m - h;
      // in the band the chip sits on the bare ground: use the label plate roles so it reads there
      const fPlate = inBand ? plate : P.ink, fInk = inBand ? plateInk : P.paper;
      foot = { run, x: m, y: fy, w: Math.round(run.advance + padX * 2), h, padX, cap: fCap, plate: fPlate, ink: fInk, inBand };
      overlayInk.push({ label: 'footnote', fg: fInk, bg: fPlate });
      qa.text('footnote', { box: { x0: foot.x + padX, y0: foot.y + (h - fCap) / 2, x1: foot.x + padX + run.inkWidth, y1: foot.y + (h + fCap) / 2 }, size: fCap, fg: fInk, bg: fPlate });
    }

    // ───────── url label ─────────
    const urlRun = frameKind === 'browser' && C.urlLabel ? K.shape(fU, C.urlLabel, { size: 13.5, tracking: 0, kerning: 'metric' }) : null;
    // the URL text is ours (the captured UI is not): chromeInk on its field (chrome + 9 % chromeInk)
    if (urlRun) overlayInk.push({ label: 'url label', fg: P.chromeInk, bg: K.mix(P.chrome, P.chromeInk, 0.09) });
    {
      // every text WE draw over or around the product (callout plates, footnote chip, URL label) reads at WCAG AA, any size
      const low = overlayInk.map((o) => ({ ...o, ratio: +K.contrast(o.fg, o.bg).toFixed(2) })).filter((o) => o.ratio < 4.5);
      qa.check('overlay-contrast', low.length ? 'fail' : 'pass', low.length ? `${low.length} overlay text role(s) under 4.5:1: ${low.map((o) => `${o.label} ${o.ratio}`).join(', ')}` : `${overlayInk.length} overlay text roles (${overlayInk.map((o) => o.label).join(', ')}) are at least 4.5:1 on their plates`, low.length ? low : undefined);
    }

    // ───────── drawing helpers ─────────
    const rr = (g, x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
    const R = frameKind === 'phone' ? X.FRAME.phoneR : params.radius;
    const screenR = frameKind === 'phone' ? R - BEZEL + 2 : params.radius;
    let shadowSprite = null;
    function shadow() {
      // one soft, physically plausible shadow (wide ambient + tight contact), built
      // once on a CPU canvas at zoom 1 and scaled with the camera
      if (shadowSprite) return shadowSprite;
      const rs = ctx.renderScale || 1;
      const pad = 140;
      const ww = win.w * s, wh = win.h * s;
      const c = new OffscreenCanvas(Math.ceil((ww + pad * 2) * rs), Math.ceil((wh + pad * 2) * rs));
      const g = c.getContext('2d', { willReadFrequently: true });
      g.scale(rs, rs);
      const off = 10000; // draw the shape off-canvas; only its shadow lands
      for (const [blur, dy, a] of X.SHADOW_LAYERS) {
        g.save();
        g.shadowColor = `rgba(0,0,0,${Math.min(0.9, a * (night ? 1.8 : 1))})`;
        g.shadowBlur = blur * unit * rs;
        g.shadowOffsetX = off * rs;
        g.shadowOffsetY = dy * unit * rs;
        g.fillStyle = '#000';
        rr(g, pad - off, pad, ww, wh, R * s);
        g.fill();
        g.restore();
      }
      shadowSprite = { c, pad };
      return shadowSprite;
    }

    function drawGround(g) {
      if (night) {
        // the brand's night: a deep tonal ground, a breath of light behind the window
        g.fillStyle = P.night;
        g.fillRect(0, 0, W, H);
        const gr = g.createRadialGradient(W / 2, H * 0.42, Math.min(W, H) * 0.1, W / 2, H * 0.5, Math.hypot(W, H) * 0.6);
        gr.addColorStop(0, K.rgba(P.paper, 0.07));
        gr.addColorStop(0.6, K.rgba(P.paper, 0));
        gr.addColorStop(1, 'rgba(0,0,0,0.28)');
        g.fillStyle = gr;
        g.fillRect(0, 0, W, H);
        return;
      }
      g.fillStyle = P.bg;
      g.fillRect(0, 0, W, H);
      if (params.falloff > 0) {
        const gr = g.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.25, W / 2, H * 0.5, Math.hypot(W, H) * 0.62);
        gr.addColorStop(0, K.rgba(P.night, 0));
        gr.addColorStop(1, K.rgba(P.night, params.falloff));
        g.fillStyle = gr;
        g.fillRect(0, 0, W, H);
      }
    }

    function drawChrome(g) {
      // minimal, generic browser chrome: three neutral dots and a URL field
      g.fillStyle = K.rgba(P.chromeInk, 0.32);
      for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(20 + k * 19, -CHROME_H / 2, 6, 0, Math.PI * 2); g.fill(); }
      if (urlRun) {
        const fw = Math.min(vw * 0.42, Math.max(260, urlRun.advance + 64));
        rr(g, vw / 2 - fw / 2, -CHROME_H + 7, fw, CHROME_H - 14, 8);
        g.fillStyle = K.rgba(P.chromeInk, 0.09);
        g.fill();
        K.drawRun(g, urlRun, vw / 2, -CHROME_H / 2 + urlRun.capPx / 2, { align: 'center', fill: P.chromeInk });
      }
    }
    const frameColors = { body: P.ink, rim: K.rgba(P.paper, 0.14), chrome: P.chrome, chromeLine: K.rgba(P.chromeInk, 0.16), empty: P.paper };

    /** What a callout draws at film time t under camera c: null (nothing) or {box (CSS px), ring (output px), a, inn, out}. */
    function calloutState(co, t, c) {
      if (t < co.t0 - 0.05 || t > co.t1 + 0.4) return null;
      const box = targetAt(co, t);
      if (!box) return null; // the instant the target is covered / off-screen / gone, the whole callout is gone
      const inn = K.springStep(t - co.t0, 3.4, 0.86), out = K.clamp((t - co.t1) / 0.3);
      const a = K.clamp(K.clamp((t - co.t0) / 0.14) * (1 - K.cubicIn(out)));
      if (a <= 0.002) return null;
      const ring = ringOf(c, box);
      if (!inView(c, ring)) return null; // the camera has (partly) left it: a cropped ring reads as a wrong one
      return { box, ring, a, inn, out };
    }

    function drawCallouts(g, t, c) {
      for (const co of callouts) {
        const st = calloutState(co, t, c);
        if (!st) continue;
        const { inn, out, a } = st;
        const tb = st.ring;
        // plates avoid every other recorded element on screen now (the camera may have moved since planning)
        const same = (b) => b.x === st.box.x && b.y === st.box.y && b.w === st.box.w && b.h === st.box.h;
        const soft = context.filter((b) => !same(b) && !(b.w > 0.6 * vw)).map((b) => boxScreen(c, b));
        const pl = X.placeBeside(tb, co.w, co.h, safe, { gap: co.dist, side: co.side, soft });
        Object.assign(pl, X.clearEdges(pl, co.w, co.h, boxScreen(c, win), safe, 18 * unit));
        // the leader starts where the (possibly moved) pill now sits
        pl.from = pl.side === 'below' ? { x: pl.x + co.w / 2, y: pl.y } : pl.side === 'above' ? { x: pl.x + co.w / 2, y: pl.y + co.h } : pl.side === 'right' ? { x: pl.x, y: pl.y + co.h / 2 } : { x: pl.x + co.w, y: pl.y + co.h / 2 };
        const dy = (1 - inn) * 12 * unit - out * 6 * unit;
        const x = Math.round(pl.x), y = Math.round(pl.y + dy);
        g.save();
        g.globalAlpha = a;
        // target ring
        g.strokeStyle = P.accent;
        g.lineWidth = 2.5 * unit;
        rr(g, tb.x, tb.y, tb.w, tb.h, Math.min(14 * unit, tb.h / 2)); // stroke centred on the padded box
        g.stroke();
        if (co.ringOnly) { g.restore(); continue; } // the callout would only repeat the target's own text: ring only
        // leader: drawn from the target out to the pill
        const from = { x: pl.from.x, y: pl.from.y + dy };
        const lu = K.cubicOut(K.clamp((t - co.t0) / 0.22));
        g.strokeStyle = plate;
        g.lineWidth = 2 * unit;
        g.beginPath();
        g.moveTo(pl.anchor.x, pl.anchor.y);
        g.lineTo(K.lerp(pl.anchor.x, from.x, lu), K.lerp(pl.anchor.y, from.y, lu));
        g.stroke();
        g.fillStyle = P.accent;
        g.beginPath(); g.arc(pl.anchor.x, pl.anchor.y, 4.5 * unit, 0, Math.PI * 2); g.fill();
        // pill
        const sc = 0.94 + 0.06 * inn;
        g.translate(x + co.w / 2, y + co.h / 2);
        g.scale(sc, sc);
        g.translate(-co.w / 2, -co.h / 2);
        g.shadowColor = 'rgba(0,0,0,0.18)'; g.shadowBlur = 18 * unit; g.shadowOffsetY = 6 * unit;
        rr(g, 0, 0, co.w, co.h, co.h / 2);
        g.fillStyle = plate;
        g.fill();
        g.shadowColor = 'rgba(0,0,0,0)';
        K.drawRun(g, co.run, co.padX - co.run.inkLeft, co.h / 2 + co.run.capPx / 2, { fill: plateInk });
        g.restore();
      }
    }

    const frameRect = (c) => boxScreen(c, { x: 0, y: 0, w: vw, h: vh });

    return {
      duration,
      mediaNeeds(times) {
        const seen = new Set(), out = [];
        for (const t of times) { const idx = capIdx(Math.max(0, Math.min(duration, t))); if (!seen.has(idx)) { seen.add(idx); out.push({ id, idx }); } }
        return out;
      },
      qaExempt(t) {
        const r = frameRect(cam.at(t));
        return [r];
      },
      samplesHint(t) {
        const v = (cam.speed(t) * s) / fps; // screen px per frame
        return v > 24 ? 24 : v > 7 ? 12 : 0;
      },
      draw(g, t) {
        const c = cam.at(t);
        drawGround(g);
        // a free caption band (bandPx) belongs to the ground: a zoomed window must never spill into it, or the footnote chip sits on rows
        if (bandPx > 0) { g.save(); g.beginPath(); g.rect(0, 0, W, Hs); g.clip(); }
        // window shadow (screen space, follows the camera)
        const sh = shadow();
        const wr = boxScreen(c, win);
        const k0 = c.z;
        g.save();
        g.translate(wr.x - sh.pad * k0, wr.y - sh.pad * k0);
        g.scale(k0 / (ctx.renderScale || 1), k0 / (ctx.renderScale || 1));
        g.drawImage(sh.c, 0, 0);
        g.restore();
        // the window, in capture CSS px under the camera
        g.save();
        map.apply(g, c);
        X.drawFrame(g, { kind: frameKind, vw, vh, src: { bmp: hub.captureFrame(id, capIdx(t)) }, colors: frameColors, chrome: drawChrome, radius: params.radius, scale: s * c.z });
        // cursor + click feedback (CSS px; grows only √zoom so it never turns cartoonish)
        const k = 1 / Math.sqrt(c.z);
        if (showCursor) {
          g.save();
          rr(g, 0, 0, vw, vh, screenR); g.clip();
          if (touch) X.drawTouch(g, t, k, cursor, evs, { ink: P.ink, paper: P.paper });
          X.drawRipples(g, t, k, cursor, evs, { accent: P.accent, touch });
          g.restore();
          if (!touch) {
            const p = cursor.at(t);
            if (p.alpha > 0.001) {
              g.save();
              g.globalAlpha = p.alpha;
              X.drawCursorArrow(g, p.x, p.y, cursorSize * k, cursor.at(K.frameQuant(t, fps)).press, { ink: P.ink, paper: P.paper, s });
              g.restore();
            }
          }
        }
        g.restore();
        drawCallouts(g, t, c);
        if (bandPx > 0) g.restore();
        if (foot) {
          const a = K.clamp((t - 0.25) / 0.35);
          if (a > 0) {
            g.save();
            g.globalAlpha = a;
            rr(g, foot.x, foot.y, foot.w, foot.h, foot.h / 2);
            g.fillStyle = foot.plate; g.fill();
            g.globalAlpha = a;
            K.drawRun(g, foot.run, foot.x + foot.padX - foot.run.inkLeft, foot.y + foot.h / 2 + foot.cap / 2, { fill: foot.ink });
            g.restore();
          }
        }
      },
      post(g, t) {
        if (params.grain <= 0) return;
        // grain on the ground only — never over the captured UI
        const c = cam.at(t);
        const wr = boxScreen(c, win);
        g.save();
        g.beginPath();
        g.rect(0, 0, W, H);
        g.roundRect(wr.x, wr.y, wr.w, wr.h, R * s * c.z);
        g.clip('evenodd');
        K.grain(g, W, H, { seed: ctx.seed, frame: Math.round(t * fps), amount: params.grain, mode: 'overlay' });
        g.restore();
      },
    };
  },
};
