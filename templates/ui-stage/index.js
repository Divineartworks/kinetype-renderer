// UI STAGE — 2–3 recorded product UIs (kinetype.capture.v1) in ONE frame, so a
// film can show cause → effect across devices with a visible story clock: the
// fitter's phone sends, the owner's desktop receives. Each panel is a full
// ui-demo-grade render of its capture (device frame, range + retime, its own
// camera, cursor/tap, callouts, tracked fail-closed highlights) running on
// its own clock (start offset; holds its first frame before, its last after).
// The stage arranges devices by layout keyframes (solo / dual / triad in a row,
// stack2 / stack3 in a column) and animates between them; the focus device is
// big and bright, the others smaller and dimmed. The panel camera is a SCREEN
// zoom: the device stays put while the UI inside it is framed, never below the
// legibility floor when focused. ONE composed capture-CSS → output map per
// panel (src/kit/x-stage.js composeMap) is used by the frames, highlights,
// cursor, callouts and connectors, and QA re-derives it independently.
import * as K from '../../src/kit/index.js';
import * as X from '../../src/kit/x-ui.js';
import * as S from '../../src/kit/x-stage.js';

const FRAMES = ['browser', 'phone', 'bare'];
const REF = ['string', 'number']; // a mark id, step id or capture seconds
const FILM = ['string', 'number']; // film seconds or "panel:mark[+s]"
const CHROME_H = X.FRAME.chromeH;
const BOX = { type: 'object', additionalProperties: false, required: ['x', 'y', 'w', 'h'], properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number', exclusiveMinimum: 0 }, h: { type: 'number', exclusiveMinimum: 0 } } };
const END = { type: 'object', additionalProperties: false, required: ['panel', 'target'], properties: { panel: { type: 'string' }, target: { description: 'a step id of that panel\'s capture with a tracked target (click / observe …), or a fixed {x,y,w,h} in its CSS px' } } };

export default {
  id: 'ui-stage',
  version: '1.0.0',
  name: 'UI Stage',
  description: 'Two or three recorded product UIs (kinetype captures) in one frame — phone + desktop + phone — each on its own clock, arranged solo/dual/triad/stack2/stack3 with animated focus, a story-clock chip, and cause→effect connectors between tracked elements of different devices.',
  tags: ['product', 'demo', 'ui', 'screen-recording', 'multi-device', 'split-screen'],
  formats: ['landscape', 'vertical', 'square', 'portrait'],
  bpm: 120,
  duration: 10,
  loop: false,
  palette: {
    bg: '#E9E7E2', night: '#D9D6CF', ink: '#15161A', paper: '#FBFAF8', chrome: '#F3F2EF', chromeInk: '#5D6067', accent: '#2F55E4',
  },
  paletteRoles: { bg: 'ground', night: 'ground falloff / night ground', ink: 'labels, clock plate, cursor, bezel', paper: 'plate text', chrome: 'title bar', chromeInk: 'title bar marks', accent: 'rings, connectors, ripples' },
  fonts: {
    label: { family: 'Inter Tight', weight: 600 },
    url: { family: 'Inter', weight: 500 },
  },
  params: {
    transition: 0.6, unfocusScale: 0.68, focusBoost: null, dimUnfocused: 0.3, blurUnfocused: 0, connectorLabels: 'caption', gap: 64,
    zoomMax: null, fill: 0.6, padding: 44, lead: 0.42, linger: 0.75, returnGap: 2.5, breathe: 0.012,
    legibility: 14, cssText: 14, autoHold: true, tail: 0.5,
    bandBottom: 0, grain: 0.03, falloff: 0.55, radius: 12, calloutScale: 1, clockScale: 1, ground: null,
  },
  schema: {
    content: {
      type: 'object',
      required: ['panels'],
      additionalProperties: false,
      properties: {
        panels: {
          type: 'array', minItems: 1, maxItems: 3,
          items: {
            type: 'object', additionalProperties: false, required: ['id', 'capture'],
            properties: {
              id: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,24}$' },
              capture: { type: 'string', description: 'spec.media id of the capture' },
              frame: { enum: FRAMES },
              urlLabel: { type: 'string', maxLength: 48 },
              label: { type: 'string', maxLength: 32, description: 'small device label under the device, e.g. "Erik · montør"' },
              crop: { ...BOX, description: 'show only this region of the captured viewport (CSS px), e.g. one card of a desktop in 9:16' },
              range: { type: 'object', additionalProperties: false, properties: { from: { type: REF }, to: { type: REF } } },
              retime: {
                type: 'array', maxItems: 32, description: '{from,to,speed} | {at,hold}; capture clock (as ui-demo)',
                items: { type: 'object', additionalProperties: false, properties: { from: { type: REF }, to: { type: REF }, speed: { type: 'number', minimum: 0.25, maximum: 8 }, at: { type: REF }, hold: { type: 'number', minimum: 0, maximum: 10 } } },
              },
              start: { type: 'number', minimum: 0, maximum: 120, description: 'film seconds at which this panel\'s retimed capture starts (it holds its first frame before)' },
              holdBefore: { enum: ['first'] },
              holdAfter: { enum: ['last'] },
              camera: {
                description: 'auto | wide | [{at, zoom, focus}] — the screen zoom inside the device',
                oneOf: [{ enum: ['auto', 'wide'] }, { type: 'array', maxItems: 32, items: { type: 'object', additionalProperties: false, required: ['at'], properties: { at: { type: REF }, zoom: { type: 'number', minimum: 1, maximum: 4 }, focus: {} } } }],
              },
              masks: {
                type: 'array', maxItems: 8, description: 'redact regions (capture CSS px) while the capture clock is in [from, to]: a heavy blur, e.g. a receipt timestamp that contradicts the story clock, or a share-link token',
                items: { type: 'object', additionalProperties: false, required: ['x', 'y', 'w', 'h'], properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number', exclusiveMinimum: 0 }, h: { type: 'number', exclusiveMinimum: 0 }, from: { type: REF }, to: { type: REF }, fill: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', description: 'a plain bar in the surface colour (quieter than the blur)' } } },
              },
              cssText: { type: 'number', minimum: 8, maximum: 24, description: 'this capture\'s body text size in CSS px (default params.cssText = 14); the legibility floor is measured on it' },
              legible: { type: 'boolean', description: 'false: no legibility zoom floor for this panel (default true when it is ever the focus)' },
              callouts: {
                type: 'array', maxItems: 8,
                items: {
                  type: 'object', additionalProperties: false, required: ['at', 'text'],
                  properties: {
                    at: { type: REF }, text: { type: 'string', minLength: 1, maxLength: 44 },
                    target: { description: '"event" | "<step id>" | {x,y,w,h} (as ui-demo)' },
                    duration: { type: 'number', minimum: 0.8, maximum: 8 }, side: { enum: ['right', 'left', 'above', 'below'] },
                    when: { enum: ['before', 'after'] },
                  },
                },
              },
              cursor: { type: 'object', additionalProperties: false, properties: { show: { type: 'boolean' }, style: { enum: ['mac', 'touch'] }, size: { type: 'number' } } },
            },
          },
        },
        layout: {
          type: 'array', minItems: 1, maxItems: 24,
          items: {
            type: 'object', additionalProperties: false, required: ['at', 'arrangement'],
            properties: {
              at: { type: FILM },
              arrangement: { enum: Object.keys(S.ARRANGEMENTS) },
              focus: { type: 'string' },
              panels: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3, description: 'which panels, in order (left→right / top→bottom); default the first N' },
              transition: { type: 'number', minimum: 0, maximum: 0.8 },
            },
          },
        },
        clock: {
          type: 'object', additionalProperties: false, required: ['keys'],
          properties: {
            style: { enum: ['chip'] },
            keys: { type: 'array', minItems: 1, maxItems: 24, items: { type: 'object', additionalProperties: false, required: ['at', 'time'], properties: { at: { type: FILM }, time: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }, roll: { type: 'boolean' } } } },
          },
        },
        connectors: {
          type: 'array', maxItems: 6,
          items: {
            type: 'object', additionalProperties: false, required: ['from', 'to', 'at'],
            properties: {
              from: END, to: END, at: { type: FILM },
              dur: { type: 'number', minimum: 0.3, maximum: 3 }, hold: { type: 'number', minimum: 0, maximum: 8 },
              fit: { type: 'boolean', description: 'find the window: start at the first moment ≥ at (within 3 s) when both endpoints are drawable, and trim hold so the arc and its fade stay inside that visible window (still fails closed when even hold 0.3 s does not fit)' },
              label: { type: 'string', maxLength: 40 },
            },
          },
        },
        dimUnfocused: { type: 'number', minimum: 0, maximum: 0.8 },
        footnote: { type: 'string', maxLength: 120 },
      },
    },
    params: {
      type: 'object', additionalProperties: false,
      properties: {
        transition: { type: 'number', minimum: 0, maximum: 0.8 },
        unfocusScale: { type: 'number', minimum: 0.4, maximum: 1 },
        focusBoost: { type: ['number', 'null'], minimum: 1, maximum: 3, description: 'the focus device may grow to this × its equal-share size (default 1.6 in a row, 1.25 when devices stack in rows)' },
        dimUnfocused: { type: 'number', minimum: 0, maximum: 0.8 },
        blurUnfocused: { type: 'number', minimum: 0, maximum: 4 },
        connectorLabels: { enum: ['caption', 'arc'], description: 'caption (default): a connector\'s label is a story caption beside the clock chip, never over a device; arc: on the arc' },
        gap: { type: 'number', minimum: 0 },
        zoomMax: { type: ['number', 'null'] },
        fill: { type: 'number' }, padding: { type: 'number' }, lead: { type: 'number' }, linger: { type: 'number' }, returnGap: { type: 'number' }, breathe: { type: 'number' },
        legibility: { type: 'number', minimum: 0, maximum: 40, description: 'focus panel body text ≥ this many px (at a 1080-px short side); 0 disables' },
        cssText: { type: 'number', minimum: 8, maximum: 24, description: 'the captured app\'s body text size, CSS px' },
        autoHold: { type: 'boolean' }, tail: { type: 'number', minimum: 0, maximum: 4 },
        bandBottom: { type: 'number', minimum: 0, maximum: 0.4, description: 'fraction of the frame height kept free at the bottom for a caption band (9:16)' },
        grain: { type: 'number' }, falloff: { type: 'number' }, radius: { type: 'number' }, calloutScale: { type: 'number' }, clockScale: { type: 'number' },
        ground: { enum: ['light', 'night', null] },
      },
    },
  },
  example: {
    template: 'ui-stage',
    name: 'ui-stage',
    format: 'landscape',
    fps: 30,
    media: {
      phone: { capture: '../fixtures/captures/demo-app-phone/capture.json' },
      desk: { capture: '../fixtures/captures/demo-app-desktop/capture.json' },
    },
    content: {
      panels: [
        { id: 'field', capture: 'phone', frame: 'phone', label: 'Ana · on site', range: { from: 'open', to: 'created' } },
        { id: 'office', capture: 'desk', frame: 'browser', urlLabel: 'app.fieldnote.dev', label: 'Sam · office', start: 0.6, range: { from: 'open', to: 'done' }, callouts: [{ at: 'invite', text: 'Invite the crew' }] },
      ],
      layout: [
        { at: 0, arrangement: 'dual', focus: 'field' },
        { at: 'office:priority', arrangement: 'dual', focus: 'office' },
      ],
      clock: { keys: [{ at: 0, time: '09:41' }, { at: 'office:priority', time: '09:42', roll: true }] },
      connectors: [{ from: { panel: 'field', target: 'name' }, to: { panel: 'office', target: 'name' }, at: 2.5, dur: 0.8, hold: 0.8, label: 'Same project' }],
      footnote: 'Demo data',
    },
  },
  notes: 'Panels = captures (spec.media.<id>.capture). Each panel: range/retime/callouts/cursor as ui-demo, plus start (film s), crop (CSS region), label. Times in layout/clock/connectors: seconds or "panel:mark[+s]". Arrangements: solo, dual, triad (row), stack2, stack3 (column; use with bandBottom for 9:16 captions). Panel camera = screen zoom; focus panels never show body text under params.legibility px. Connectors and highlights are fail-closed: an endpoint that is covered/off-screen is never drawn and FAILS the verdict. Use render.shutter 0.5.',

  build(ctx) {
    const { W, H, fps, params, content: C, palette: P, qa, fonts } = ctx;
    const unit = Math.min(W, H) / 1080;
    const vert = ctx.aspect === 'vertical';
    const hub = ctx.media;
    const dimAmt = C.dimUnfocused ?? params.dimUnfocused;

    // ───────── fonts / plates ─────────
    const fL = fonts.get('label'), fU = fonts.get('url');
    const capSize = (face, c) => (c * face.upm) / face.capHeight;
    const night = params.ground ? params.ground === 'night' : K.luminance(P.night) < 0.18;
    const plate = night ? P.paper : P.ink, plateInk = night ? P.ink : P.paper;
    const groundInk = night ? P.paper : P.ink;

    // ───────── zones: clock (top), devices, footnote (bottom), caption band ─────────
    const m = Math.round(Math.min(W, H) * 0.045);
    const top = vert ? Math.max(m, Math.round(H * 0.055)) : m;
    const bandPx = Math.round(H * K.clamp(params.bandBottom ?? 0, 0, 0.4)), Hs = H - bandPx;
    let chip = null;
    if (C.clock) {
      const cc = Math.round(30 * unit * K.clamp(params.clockScale, 0.8, 2));
      const size = capSize(fL, cc);
      const cells = '0123456789'.split('').map((d) => K.shape(fL, d, { size, tracking: 0 }));
      const cellW = Math.max(...cells.map((r) => r.advance));
      const colon = K.shape(fL, ':', { size, tracking: 0 });
      const h = Math.round(cc * 2.25), padX = Math.round(cc * 0.75), icon = Math.round(cc * 1.05);
      const textW = cellW * 4 + colon.advance;
      chip = { cap: cc, size, cellW, colon, h, padX, icon, w: Math.round(padX + icon + cc * 0.5 + textW + padX), x: m, y: top };
    }
    let foot = null;
    if (C.footnote) {
      // qualifiers are claims' small print: ≥ 22 px cap at 1080 (legible at play speed), on their
      // own plate; a long one (≤ 120 chars, e.g. demo-data + legal source) wraps to two balanced lines,
      // breaking after a sentence when that is nearly as balanced
      const fCap = Math.round(22 * unit), size = capSize(fU, fCap);
      const shape = (tx) => K.shape(fU, tx, { size, tracking: 0, kerning: 'metric' });
      const maxW = W - 2 * m - fCap * 1.8;
      let lines = [C.footnote];
      const one = shape(C.footnote);
      if (one.advance > Math.min(maxW, W * (vert ? 0.9 : 0.62))) {
        const words = C.footnote.split(' ');
        let best = null;
        for (let i = 1; i < words.length; i++) {
          const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
          const wa = shape(a).advance, wb = shape(b).advance, wmax = Math.max(wa, wb);
          const cost = wmax - (/[.:;]$/.test(a) ? 0.12 * one.advance : 0) + (wmax > maxW ? 1e6 : 0);
          if (!best || cost < best.cost) best = { cost, lines: [a, b] };
        }
        lines = best.lines;
      }
      const runs = lines.map(shape), lead = Math.round(fCap * 1.75);
      const padX = fCap * 0.9, h = Math.round(fCap * 2.4 + lead * (runs.length - 1));
      const w = Math.round(Math.max(...runs.map((r) => r.advance)) + padX * 2);
      if (w > W - 2 * m + 1) qa.warn(`footnote is wider than the frame even on two lines (${w}px)`);
      foot = { runs, x: m, y: Hs - m - h, w, h, padX, cap: fCap, lead, r: runs.length > 1 ? Math.round(fCap * 0.9) : h / 2 };
    }
    const lblCap = Math.round((vert ? 21 : 19) * unit);
    const lblGap = Math.round(lblCap * 1.5);
    const anyLabel = C.panels.some((p) => p.label);
    const labelH = anyLabel ? lblGap + lblCap : 0;
    // story caption (connector labels): beside the clock chip, or under it when the row is too narrow
    let cap0 = null;
    const capLabels = params.connectorLabels !== 'arc' ? (C.connectors || []).map((c) => c.label).filter(Boolean) : [];
    if (capLabels.length) {
      const cc = Math.round((vert ? 24 : 21) * unit), size = capSize(fL, cc);
      const runs = capLabels.map((tx) => K.shape(fL, tx, { size, tracking: -4 }));
      const padX = Math.round(cc * 0.8), dot = Math.round(cc * 0.42), h = chip ? chip.h : Math.round(cc * 2.3);
      const wMax = Math.round(padX * 2 + dot * 2 + cc * 0.55 + Math.max(...runs.map((r) => r.advance)));
      let x = chip ? chip.x + chip.w + Math.round(12 * unit) : m, y = chip ? chip.y : top;
      if (x + wMax > W - m) { x = chip ? chip.x : m; y = chip ? chip.y + chip.h + Math.round(10 * unit) : top; }
      cap0 = { cc, size, padX, dot, h, x, y, wMax };
    }
    // the device area: as tall as possible; the clock chip (top-left) and the footnote
    // (bottom-left) only take a band when a device would otherwise run into them
    const areaTop = Math.max(chip ? chip.y + chip.h + Math.round(m * 0.8) : top, cap0 ? cap0.y + cap0.h + Math.round(m * 0.8) : top), areaBottom = foot ? foot.y - Math.round(m * 0.45) : Hs - m;
    // candidates: full height; below the clock band; above the footnote band; both; and a column
    // beside the clock/caption (alone or above the footnote band). The clear-test below decides.
    const colL = Math.round(Math.max(chip ? chip.x + chip.w : 0, cap0 && cap0.y === (chip ? chip.y : top) && !chip ? cap0.x + cap0.wMax : 0) + m * 0.5);
    const footTop = foot ? foot.y - Math.round(m * 0.45) : Hs - m;
    const areas = [
      { x: m, y: top, w: W - 2 * m, h: Hs - m - top },
      ...(chip || cap0 ? [{ x: m, y: areaTop, w: W - 2 * m, h: Hs - m - areaTop }] : []),
      ...(foot ? [{ x: m, y: top, w: W - 2 * m, h: footTop - top }] : []),
      ...((chip || cap0) && foot ? [{ x: m, y: areaTop, w: W - 2 * m, h: footTop - areaTop }] : []),
      ...(chip ? [{ x: colL, y: top, w: W - m - colL, h: Hs - m - top }] : []),
      ...(chip && foot ? [{ x: colL, y: top, w: W - m - colL, h: footTop - top }] : []),
    ];
    const keepOut = [...(chip ? [{ x: chip.x, y: chip.y, w: chip.w, h: chip.h }] : []), ...(foot ? [{ x: foot.x, y: foot.y, w: foot.w, h: foot.h }] : []), ...(cap0 ? [{ x: cap0.x, y: cap0.y, w: cap0.wMax, h: cap0.h }] : [])];

    // ───────── panels ─────────
    const ids = C.panels.map((p) => p.id);
    if (new Set(ids).size !== ids.length) throw new Error(`ui-stage: panel ids must be unique (${ids.join(', ')})`);
    const PN = new Map();
    for (const [pi, pc] of C.panels.entries()) {
      const msrc = hub?.src?.[pc.capture];
      if (!msrc || msrc.kind !== 'capture') throw new Error(`ui-stage: panel "${pc.id}" capture "${pc.capture}" must name a spec.media entry with "capture": "…/capture.json" (have: ${Object.keys(hub?.src || {}).join(', ') || 'none'})`);
      const cap = msrc.capture;
      const vw = cap.device.viewport.width, vh = cap.device.viewport.height;
      const dsf = msrc.w / vw;
      const crop = pc.crop || { x: 0, y: 0, w: vw, h: vh };
      if (crop.x < 0 || crop.y < 0 || crop.x + crop.w > vw + 1e-6 || crop.y + crop.h > vh + 1e-6) throw new Error(`ui-stage: panel "${pc.id}" crop ${JSON.stringify(crop)} leaves the ${vw}×${vh} viewport`);
      const phoneCap = cap.device.kind === 'phone';
      const kind = pc.frame || (phoneCap ? 'phone' : 'browser');
      const fr = X.frameRect(kind, crop.w, crop.h);
      const touch = (pc.cursor?.style ?? (phoneCap ? 'touch' : 'mac')) === 'touch';
      // clocks: retime + callout reading holds (exactly as ui-demo)
      const rt0 = X.buildRetime(cap, { range: pc.range, retime: pc.retime });
      const coIn = (pc.callouts || []).map((co, i) => {
        const ev = typeof co.at === 'string' ? X.stepEvent(cap, co.at) : null;
        const ct = ev ? ev.t : X.captureTime(cap, co.at);
        const named = typeof co.target === 'string' && co.target !== 'event';
        const tev = named ? X.stepEvent(cap, co.target) : co.target && typeof co.target === 'object' ? null : ev;
        if (named && !tev?.box) throw new Error(`ui-stage: panel "${pc.id}" callout ${i + 1} ("${co.text}") target "${co.target}" is not a step with a boxed event`);
        const fixed = co.target && typeof co.target === 'object' ? co.target : null;
        const box = fixed || tev?.box;
        if (!box) throw new Error(`ui-stage: panel "${pc.id}" callout ${i + 1} ("${co.text}") has no target box`);
        if (!fixed && !tev.track) qa.warn(`${pc.id}: callout "${co.text}": capture has no target track for step ${tev.step} — not drawn (fail-closed)`);
        return { co, ev, tev, fixed, ct, box, text: co.text, when: co.when ?? (ev?.type === 'click' ? 'before' : 'after') };
      });
      const coPlan = X.calloutPlan(cap, rt0, coIn, { lead: params.lead, autoHold: params.autoHold });
      const holds = X.planHolds(coPlan);
      const rt = holds.length ? X.buildRetime(cap, { range: pc.range, retime: [...(pc.retime || []), ...holds] }) : rt0;
      if (holds.length) qa.note(`${pc.id}: reading holds ${holds.map((h) => `${h.hold.toFixed(2)}s @ capture ${h.at.toFixed(2)}s`).join(', ')}`);
      const start = pc.start ?? 0;
      const clock = S.panelClock({ start, duration: rt.duration });
      const evs = X.filmEvents(cap, rt); // panel-local film time
      PN.set(pc.id, { pi, pc, id: pc.id, msrc, cap, vw, vh, dsf, crop, sw: crop.w, sh: crop.h, kind, fr, touch, showCursor: pc.cursor?.show !== false, rt, coIn, coPlan, start, clock, evs, mid: pc.capture });
    }
    const panel = (id, what) => {
      const p = PN.get(id);
      if (!p) throw new Error(`ui-stage: ${what} names panel "${id}" (have: ${ids.join(', ')})`);
      return p;
    };
    /** "panel:mark" → stage film time (through that panel's clock: the frame where the mark shows). */
    const resolve = (pid, ref) => {
      const p = panel(pid, `time "${pid}:${ref}"`), ct = X.captureTime(p.cap, ref);
      if (ct < p.rt.c0 - 1e-6 || ct > p.rt.c1 + 1e-6) throw new Error(`ui-stage: time "${pid}:${ref}" (capture ${ct.toFixed(2)}s) is outside panel "${pid}"'s range (${p.rt.c0.toFixed(2)}–${p.rt.c1.toFixed(2)}s)`);
      return p.start + p.rt.toFilm(ct);
    };
    const ft = (at) => S.filmRef(at, resolve);

    // ───────── layout ─────────
    const N = ids.length;
    const defArr = N === 1 ? 'solo' : vert ? (N === 2 ? 'stack2' : 'split3') : N === 2 ? 'dual' : 'triad';
    const lkeys = (C.layout || [{ at: 0, arrangement: defArr, focus: ids[0] }]).map((k, i) => {
      const need = S.ARRANGEMENTS[k.arrangement].n;
      const pids = k.panels || (k.arrangement === 'solo' && k.focus ? [k.focus] : ids.slice(0, need));
      if (pids.length !== need) throw new Error(`ui-stage: layout ${i + 1} "${k.arrangement}" shows ${need} panel(s), got ${pids.length} (${pids.join(', ')}) — list them in "panels"`);
      for (const id of pids) panel(id, `layout ${i + 1}`);
      const focus = k.focus ?? pids[0];
      if (!pids.includes(focus)) throw new Error(`ui-stage: layout ${i + 1} focus "${focus}" is not among its panels (${pids.join(', ')})`);
      return { t: i === 0 ? Math.max(0, ft(k.at)) : ft(k.at), arrangement: k.arrangement, focus, panels: pids, dur: i === 0 ? 0 : K.clamp(k.transition ?? params.transition, 0, 0.8) };
    });
    if (lkeys[0].t > 1e-6) { qa.note(`layout 1 at ${lkeys[0].t.toFixed(2)}s is the opening state (shown from 0)`); lkeys[0].t = 0; }
    const frames = Object.fromEntries([...PN.values()].map((p) => [p.id, p.fr]));
    const placeCache = new Map();
    const place = (k) => {
      const key = `${k.arrangement}|${k.focus}|${k.panels.join(',')}`;
      if (!placeCache.has(key)) {
        const items = k.panels.map((id) => ({ id, frame: frames[id], labelH, maxK: 1.15 * PN.get(id).dsf }));
        // a single row: the others give way to the focus (down to half their fit); stacked rows
        // share the height, so there the others keep their rho and everything scales together
        const multi = S.ARRANGEMENTS[k.arrangement].rows.length > 1, rho = K.clamp(params.unfocusScale, 0.4, 1);
        const opts = { gap: params.gap * unit, rho, minRho: multi ? rho : 0.5, boost: params.focusBoost != null ? K.clamp(params.focusBoost, 1, 3) : multi ? 1.25 : 1.6 };
        // the candidate area that keeps everything clear and gives the FOCUS device the most size
        let best = null, bestK = -1;
        for (const a of areas) {
          if (a.w < 200 * unit || a.h < 200 * unit) continue; // a candidate squeezed out by a wide footnote/caption
          let pl;
          try { pl = S.arrange(k.arrangement, items, k.focus, a, opts); } catch { continue; }
          const clear = [...pl.entries()].every(([id, T]) => { const r = S.frameOut(T, frames[id]); const rl = { x: r.x, y: r.y, w: r.w, h: r.h + labelH }; return keepOut.every((z) => !S.rectsOverlap(rl, X.pad(z, m * 0.4))); });
          // size of the focus device, discounted for an off-centre composition (a centred frame is
          // worth ~ a quarter of the offset fraction in focus size)
          const rs = [...pl.entries()].map(([id, T]) => S.frameOut(T, frames[id]));
          const cx = (Math.min(...rs.map((r) => r.x)) + Math.max(...rs.map((r) => r.x + r.w))) / 2;
          const score = pl.get(k.focus).k * (1 - 0.25 * Math.abs(cx - W / 2) / (W / 2));
          if (clear && score > bestK + 1e-9) { best = pl; bestK = score; }
        }
        best = best || areas.length && S.arrange(k.arrangement, items, k.focus, areas[areas.length - 1], opts);
        placeCache.set(key, best);
      }
      return placeCache.get(key);
    };
    const LT = S.layoutTrack(lkeys, ids, place, frames);
    for (const [i, k] of lkeys.entries()) qa.note(`layout ${i + 1} @ ${k.t.toFixed(2)}s ${k.arrangement} focus ${k.focus}: ${k.panels.map((id) => { const T = LT.settled[i][id]; const r = S.frameOut(T, frames[id]); return `${id} ${Math.round(r.w)}×${Math.round(r.h)} @ (${Math.round(r.x)}, ${Math.round(r.y)}) k=${T.k.toFixed(3)}`; }).join(' · ')}`);

    // ───────── timeline ─────────
    const clockT = C.clock ? S.clockTrack(C.clock.keys.map((k) => ({ t: ft(k.at), time: k.time, roll: !!k.roll }))) : null;
    const conIn = (C.connectors || []).map((c, i) => {
      const t0 = ft(c.at), dur = c.dur ?? 0.9, hold = c.hold ?? 1.6;
      const end = (e, which) => {
        const p = panel(e.panel, `connector ${i + 1} ${which}`);
        if (e.target && typeof e.target === 'object') return { p, fixed: e.target, ev: null };
        const ev = X.stepEvent(p.cap, e.target);
        if (!ev?.box) throw new Error(`ui-stage: connector ${i + 1} ${which} target "${e.target}" is not a step with a boxed event in panel "${p.id}"`);
        if (!ev.track) throw new Error(`ui-stage: connector ${i + 1} ${which} target "${e.target}" (panel "${p.id}") has no track — re-capture (fail-closed: its visibility is unknown)`);
        return { p, fixed: null, ev };
      };
      const A = end(c.from, 'from'), B = end(c.to, 'to');
      if (A.p === B.p) throw new Error(`ui-stage: connector ${i + 1} joins panel "${A.p.id}" to itself — connectors are for cause → effect ACROSS devices`);
      return { i, c, A, B, t0, dur, t1: t0 + dur + hold, label: c.label };
    });
    const ends = [...[...PN.values()].map((p) => p.clock.end), ...lkeys.map((k) => k.t + k.dur), ...(clockT ? clockT.keys.map((k) => k.t + clockT.rollDur) : []), ...conIn.map((c) => c.t1 + 0.35)];
    let duration = ctx.spec.duration ?? Math.max(...ends) + params.tail;
    for (const k of lkeys) if (k.t > duration) qa.warn(`layout key at ${k.t.toFixed(2)}s is after the end (${duration.toFixed(2)}s)`);

    // ───────── per-panel camera (screen zoom) with the legibility floor ─────────
    for (const p of PN.values()) {
      let kMax = 0, kFocus = Infinity;
      for (const [i, k] of lkeys.entries()) {
        const s = LT.settled[i][p.id];
        if (k.panels.includes(p.id)) { kMax = Math.max(kMax, s.k); if (k.focus === p.id) kFocus = Math.min(kFocus, s.k); }
      }
      kMax = kMax || 1;
      if (!Number.isFinite(kFocus)) kFocus = 0; // never the focus: no legibility floor
      p.kMax = kMax; p.kFocus = kFocus; // the floor must hold at the SMALLEST focused size
      const zRes = (1.15 * p.dsf) / kMax; // never more than 1.15 output px per captured device px
      let zMin = 1;
      if (params.legibility > 0 && p.pc.legible !== false && kFocus > 0) zMin = Math.max(1, (params.legibility * unit) / ((p.pc.cssText ?? params.cssText) * kFocus));
      if (zMin > zRes) { qa.warn(`${p.id}: the legibility floor needs screen zoom ${zMin.toFixed(2)} but the source allows ${zRes.toFixed(2)} — capped (consider crop or a larger focus scale)`); zMin = Math.max(1, zRes); }
      p.zMin = zMin;
      const zMax = Math.max(1, Math.min(params.zoomMax != null ? K.clamp(params.zoomMax, 1, 4) : 2.2, zRes / zMin));
      p.view = X.makeView({ content: p.crop, viewW: p.sw / zMin, viewH: p.sh / zMin, zMax, fill: K.clamp(params.fill, 0.3, 0.9), padding: params.padding });
      // a desktop UI under a legibility zoom: the wide shot keeps its top-left (navigation and
      // headings read; only the right/bottom margin goes), never a centre crop through the sidebar
      if (zMin > 1.001 && p.kind === 'browser') p.view.wide = p.view.clampCam({ cx: p.crop.x, cy: p.crop.y, z: 1 });
      const dur = p.rt.duration;
      let keys;
      if (p.pc.camera === 'wide') keys = [];
      else if (Array.isArray(p.pc.camera)) {
        keys = X.manualCamera(p.pc.camera.map((k) => {
          const ct = X.captureTime(p.cap, k.at);
          let focus = k.focus;
          if (focus === 'event' || (focus == null && typeof k.at === 'string')) {
            const e = typeof k.at === 'string' ? X.stepEvent(p.cap, k.at) : null;
            focus = e?.box || (e?.point ? { x: e.point.x, y: e.point.y } : undefined);
          }
          return { t: p.rt.toFilm(ct) - (k.zoom > 1 ? params.lead : 0), zoom: k.zoom ?? 1, focus };
        }), p.view);
      } else keys = X.planCamera(p.evs, p.view, { lead: params.lead, linger: params.linger, returnGap: params.returnGap, duration: dur });
      p.cam = X.cameraTrack(keys, p.view, undefined, { breathe: params.breathe, duration: dur, fps });
      p.camAt = (t) => p.cam.at(p.clock.localT(t));
      p.capIdx = (t) => K.clamp(Math.floor(p.rt.toCapture(p.clock.localT(K.frameQuant(t, fps))) * p.cap.fps + 1e-6), 0, p.msrc.frames - 1);
      p.cursor = X.planCursor(p.evs, { seed: K.hash(ctx.seed, 'cursor', p.pi), bounds: { x: p.crop.x, y: p.crop.y, w: p.sw, h: p.sh }, start: (() => { const f = p.evs.find((e) => e.type === 'click' && e.point)?.point; return f ? { x: K.clamp(f.x - 0.2 * p.sw, p.crop.x + 0.14 * p.sw, p.crop.x + 0.86 * p.sw), y: K.clamp(f.y + 0.24 * p.sh, p.crop.y + 0.18 * p.sh, p.crop.y + 0.84 * p.sh) } : { x: p.crop.x + p.sw * 0.6, y: p.crop.y + p.sh * 0.66 }; })() });
      p.cursorSize = K.clamp(p.pc.cursor?.size ?? 1, 0.6, 2) * 24;
      p.masks = (p.pc.masks || []).map((mk) => ({ fill: mk.fill || null, box: { x: mk.x, y: mk.y, w: mk.w, h: mk.h }, f0: mk.from != null ? Math.round(X.captureTime(p.cap, mk.from) * p.cap.fps) : -Infinity, f1: mk.to != null ? Math.round(X.captureTime(p.cap, mk.to) * p.cap.fps) : Infinity }));
      if (p.masks.length) qa.note(`${p.id}: ${p.masks.length} redaction mask(s): ${p.masks.map((mk) => `${JSON.stringify(mk.box)} frames ${mk.f0}–${mk.f1}`).join('; ')}`);
      p.urlRun = p.kind === 'browser' && p.pc.urlLabel ? K.shape(fU, p.pc.urlLabel, { size: 13.5, tracking: 0, kerning: 'metric' }) : null;
      p.labelRun = p.pc.label ? K.shape(fL, p.pc.label, { size: capSize(fL, lblCap), tracking: -4 }) : null;
      qa.note(`${p.id}: ${p.cap.flow} ${p.vw}×${p.vh}@${p.dsf}x crop ${p.sw}×${p.sh}, start ${p.start.toFixed(2)}s, film ${p.rt.duration.toFixed(2)}s from capture ${p.rt.c0.toFixed(2)}–${p.rt.c1.toFixed(2)}s, k ≤ ${kMax.toFixed(3)}, focus k ${kFocus.toFixed(3)}, screen zoom ${zMin.toFixed(2)}–${(zMin * zMax).toFixed(2)} (source limit ${zRes.toFixed(2)})`);
    }

    // ───────── the composed map (one per panel per instant) ─────────
    const stateAt = (t) => LT.state(t);
    const mapOf = (p, t, st = stateAt(t)) => S.composeMap(st[p.id], p.camAt(t), { sw: p.sw, sh: p.sh, zMin: p.zMin });
    const visibleAlpha = 0.5; // below this a panel is fading: nothing anchors to it (fail-closed)
    /** Panels drawn at t, back to front (unfocused first, focus last; ties keep spec order). */
    const order = (st) => [...PN.values()].filter((p) => st[p.id].alpha > 0.002).sort((a, b) => st[a.id].focus - st[b.id].focus || a.pi - b.pi);
    /** Frame rects (output) of the panels drawn ABOVE p at t. */
    const above = (p, st) => { const o = order(st), i = o.indexOf(p); return o.slice(i + 1).map((q) => S.frameOut(st[q.id], q.fr)); };
    const stage = { x: 0, y: 0, w: W, h: Hs };
    /** Is a ring (output px) wholly on p's screen, on the stage, and not under another device? */
    // The TARGET box must be wholly on its device's screen (and the stage); its ring (box + pad) may
    // overhang the screen edge by the pad — a full-width phone card is ringed hugging the bezel.
    const ringOk = (p, mp, st, r) => {
      const scr = mp.screen, pd = X.HIGHLIGHT_PAD * mp.K;
      const clip = { x: Math.max(scr.x, 0), y: Math.max(scr.y, 0), w: Math.min(scr.x + scr.w, W) - Math.max(scr.x, 0), h: Math.min(scr.y + scr.h, Hs) - Math.max(scr.y, 0) };
      const box = { x: r.x + pd, y: r.y + pd, w: r.w - 2 * pd, h: r.h - 2 * pd };
      if (!S.rectInside(box, clip) || !S.rectInside(r, { x: 0, y: 0, w: W, h: Hs })) return false;
      return !above(p, st).some((q) => S.rectsOverlap(r, q));
    };
    /** Tracked box (CSS px) of an event on the capture frame panel p shows at t, or null (fail-closed). */
    const trackBox = (p, ev, t) => { const tr = X.trackAt(ev, p.capIdx(t), p.cap.fps); return tr && tr.visible ? tr.box : null; };

    // ───────── connectors with fit: true — choose a window where both ends are visible ─────────
    {
      const step = 1 / fps, FADE = 0.35, MINHOLD = 0.3, SEARCH = 3;
      const ok = (cn, t) => connectorState(cn, t, stateAt(t)).ok;
      let moved = false;
      for (const cn of conIn) {
        if (!cn.c.fit) continue;
        const at0 = cn.t0, want = cn.t1 - cn.t0 - cn.dur;
        let found = null;
        for (let f = Math.ceil(at0 * fps - 1e-6); f / fps <= at0 + SEARCH && !found; f++) {
          const t0 = f / fps;
          // the longest run of drawable frames from t0 (up to the requested length + fade)
          let n = 0;
          while (n * step <= cn.dur + want + FADE + 1e-9 && ok(cn, t0 + n * step)) n++;
          const avail = n * step - step; // last drawable instant, relative to t0
          if (avail + 1e-9 >= cn.dur + MINHOLD + FADE) found = { t0, hold: Math.min(want, avail - cn.dur - FADE) };
        }
        if (found) {
          qa.note(`connector ${cn.i + 1} fit: ${at0.toFixed(2)}s → ${found.t0.toFixed(2)}s, hold ${want.toFixed(2)} → ${found.hold.toFixed(2)}s`);
          cn.t0 = found.t0; cn.t1 = found.t0 + cn.dur + found.hold; moved = true;
        } else qa.note(`connector ${cn.i + 1} fit: no window of ${(cn.dur + MINHOLD + FADE).toFixed(2)}s with both ends visible within ${SEARCH}s of ${at0.toFixed(2)}s — left as asked (fails closed)`);
      }
      if (moved && ctx.spec.duration == null) duration = Math.max(duration, ...conIn.map((c) => c.t1 + FADE + params.tail));
    }

    // ───────── callouts (per panel, on the stage clock) ─────────
    const cCap = (vert ? 28 : 22) * unit * K.clamp(params.calloutScale, 0.6, 1.6);
    const safe = { x: m * 0.75, y: m * 0.75, w: W - m * 1.5, h: Hs - m * 1.5 };
    const callouts = [];
    for (const p of PN.values()) {
      p.coIn.forEach((ci, i) => {
        const pl0 = p.coPlan[i];
        const t0 = p.start + (ci.when === 'before' ? p.rt.toFilmFirst(pl0.at) + 0.02 : p.rt.toFilm(ci.ct) + 0.18);
        const tEnd0 = ci.when === 'before' ? p.start + p.rt.toFilm(ci.ct) + 0.35 : t0 + (ci.co.duration ?? Math.max(2.4, X.readTime(ci.text)));
        const tEnd = ci.co.duration && ci.when === 'before' ? Math.max(tEnd0, t0 + ci.co.duration) : tEnd0;
        const t1 = Math.min(duration - 0.1, tEnd);
        const run = K.shape(fL, ci.text, { size: capSize(fL, cCap), tracking: -6 });
        const padX = cCap * 1.05, h = Math.round(cCap * 2.7), w = Math.round(run.advance + padX * 2);
        const co = { ...ci, p, t0, t1, run, w, h, padX };
        const fr0 = Math.max(0, Math.ceil((t0 - 0.05) * fps - 1e-6)), fr1 = Math.min(Math.round(duration * fps) - 1, Math.floor((t1 + 0.4) * fps + 1e-6));
        const shown = [];
        for (let f = fr0; f <= fr1; f++) {
          const t = f / fps, st = stateAt(t);
          if (st[p.id].alpha < visibleAlpha) continue;
          const b = ci.fixed || trackBox(p, ci.tev, t);
          if (!b) continue;
          const mp = mapOf(p, t, st);
          if (ringOk(p, mp, st, mp.box(X.pad(b, X.HIGHLIGHT_PAD)))) shown.push(f);
        }
        if (!shown.length) { qa.warn(`${p.id}: callout "${ci.text}": its target is not visible at any moment of its window (${t0.toFixed(2)}–${t1.toFixed(2)}s) — not drawn`); return; }
        const vis = shown.filter((f) => f / fps <= t1).length / fps;
        if (vis < X.readTime(ci.text) - 0.05) qa.warn(`${p.id}: callout "${ci.text}" is on screen ${vis.toFixed(2)}s, under its reading time ${X.readTime(ci.text).toFixed(2)}s`);
        // side decided once, where the target is visible and the stage has settled, then held
        const want = Math.min(t1 - 0.1, t0 + 0.6);
        const tm = shown.map((f) => f / fps).reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a));
        const st = stateAt(tm), mp = mapOf(p, tm, st);
        const tb = mp.box(X.pad(ci.fixed || trackBox(p, ci.tev, tm), X.HIGHLIGHT_PAD));
        const avoid = [...[...PN.values()].filter((q) => q !== p && st[q.id].alpha > 0.1).map((q) => S.frameOut(st[q.id], q.fr)), ...(chip ? [{ x: chip.x, y: chip.y, w: chip.w, h: chip.h }] : []), ...(foot ? [{ x: foot.x, y: foot.y, w: foot.w, h: foot.h }] : [])];
        const pl = X.placeCallout(tb, w, h, safe, { gap: 40 * unit, avoid, prefer: ci.co.side, rank: vert ? { below: 0, above: 1, right: 2, left: 3 } : undefined });
        Object.assign(pl, X.clearEdges(pl, w, h, S.frameOut(st[p.id], p.fr), safe, 16 * unit));
        if (pl.covered) qa.warn(`${p.id}: callout "${ci.text}" could not avoid its target or another device at ${tm.toFixed(2)}s`);
        qa.text(`${p.id} callout ${i + 1}`, { box: { x0: pl.x + padX, y0: pl.y + (h - cCap) / 2, x1: pl.x + padX + run.inkWidth, y1: pl.y + (h + cCap) / 2 }, size: cCap, fg: plateInk, bg: plate });
        qa.hit(t0, `${p.id} callout ${i + 1}`);
        qa.keyframe(tm, `${p.id} · ${ci.text}`);
        callouts.push({ ...co, side: pl.side, dist: pl.dist, shown: new Set(shown) });
      });
    }

    /** What a callout draws at t: null or {ring (output), a, inn, out, mp}. */
    function calloutState(co, t, st) {
      if (t < co.t0 - 0.05 || t > co.t1 + 0.4) return null;
      const p = co.p, pa = st[p.id].alpha;
      if (pa < visibleAlpha) return null;
      const box = co.fixed || trackBox(p, co.tev, t);
      if (!box) return null;
      const inn = K.springStep(t - co.t0, 3.4, 0.86), out = K.clamp((t - co.t1) / 0.3);
      const a = K.clamp(K.clamp((t - co.t0) / 0.14) * (1 - K.cubicIn(out))) * K.clamp((pa - visibleAlpha) / (1 - visibleAlpha));
      if (a <= 0.002) return null;
      const mp = mapOf(p, t, st);
      const ring = mp.box(X.pad(box, X.HIGHLIGHT_PAD));
      if (!ringOk(p, mp, st, ring)) return null;
      return { box, ring, a, inn, out, mp };
    }

    // ───────── connectors ─────────
    /** A connector's endpoints at t: null (not drawable: fail-closed) or {a, b, ra, rb, why}. */
    function connectorState(cn, t, st) {
      const ep = (E) => {
        const p = E.p;
        if (st[p.id].alpha < visibleAlpha) return { why: `${p.id} is not on stage` };
        const box = E.fixed || trackBox(p, E.ev, t);
        if (!box) return { why: `${p.id} target not visible on capture frame ${p.capIdx(t)}` };
        const mp = mapOf(p, t, st), r = mp.box(X.pad(box, X.HIGHLIGHT_PAD));
        if (!ringOk(p, mp, st, r)) return { why: `${p.id} target off its screen or under another device (ring ${[r.x, r.y, r.w, r.h].map((v) => Math.round(v)).join(',')} vs screen ${[mp.screen.x, mp.screen.y, mp.screen.w, mp.screen.h].map((v) => Math.round(v)).join(',')})` };
        return { r, box, mp };
      };
      const A = ep(cn.A), B = ep(cn.B);
      if (!A.r || !B.r) return { ok: false, why: A.why || B.why };
      // route around devices: the arc that runs least over any device's UI, then the shortest
      const frs = [...PN.values()].filter((q) => st[q.id].alpha > 0.002).map((q) => S.frameOut(st[q.id], q.fr));
      const rt = S.routeConnector(A.r, S.frameOut(st[cn.A.p.id], cn.A.p.fr), B.r, S.frameOut(st[cn.B.p.id], cn.B.p.fr), frs, { bow: 0.16, margin: 36 * unit, maxReach: 170 * unit, bounds: { x: m * 0.5, y: m * 0.5, w: W - m, h: Hs - m }, sides: cn.sides });
      return { ok: true, a: rt.a, b: rt.b, arc: rt.arc, ra: A.r, rb: B.r, boxA: A.box, boxB: B.box, frs };
    }
    const lblCapC = Math.round(17 * unit);
    for (const cn of conIn) {
      if (cn.label && !cap0) cn.run = K.shape(fL, cn.label, { size: capSize(fL, lblCapC), tracking: -4 });
      if (cn.label && cap0) { cn.capRun = K.shape(fL, cn.label, { size: cap0.size, tracking: -4 }); cn.capW = Math.round(cap0.padX * 2 + cap0.dot * 2 + cap0.cc * 0.55 + cn.capRun.advance); qa.text(`connector ${cn.i + 1} caption`, { box: { x0: cap0.x + cap0.padX + cap0.dot * 2 + cap0.cc * 0.55, y0: cap0.y + (cap0.h - cap0.cc) / 2, x1: cap0.x + cn.capW - cap0.padX, y1: cap0.y + (cap0.h + cap0.cc) / 2 }, size: cap0.cc, fg: P.ink, bg: P.paper }); }
      // the route (sides) and the label's place on it are decided ONCE, where the arc has just
      // arrived (first drawable frame at/after t0 + dur), then held: nothing flips while the stage moves
      for (let f = Math.ceil((cn.t0 + cn.dur) * fps - 1e-6), f1 = Math.floor(cn.t1 * fps + 1e-6); f <= f1 && !cn.sides; f++) {
        const t = f / fps, s = connectorState(cn, t, stateAt(t));
        if (!s.ok) continue;
        cn.sides = { a: s.a.side, b: s.b.side };
        if (cn.run) {
          // the label may cover a dimmed device before the focus device, and never the clock / footnote
          const st0 = stateAt(t);
          const obs = [...[...PN.values()].filter((q) => st0[q.id].alpha > 0.002).map((q) => ({ ...S.frameOut(st0[q.id], q.fr), weight: 1 + 3 * st0[q.id].focus })), ...keepOut.map((z) => ({ ...X.pad(z, 8 * unit), weight: 8 })), { ...X.pad(s.ra, 6 * unit), weight: 12 }, { ...X.pad(s.rb, 6 * unit), weight: 12 }]; // never over its own endpoints
          cn.label0 = S.labelSpot(s.arc, cn.run.advance + lblCapC * 1.8, lblCapC * 2.3, obs, { bounds: { x: m * 0.5, y: m * 0.5, w: W - m, h: Hs - m } });
          cn.labelU = cn.label0.u;
        }
      }
      if (cn.sides) qa.note(`connector ${cn.i + 1}: ${cn.A.p.id} ${cn.sides.a} → ${cn.B.p.id} ${cn.sides.b}${cn.labelU != null ? `, label at u=${cn.labelU} dy=${cn.label0.dy.toFixed(0)}` : ''}`);
      if (cn.A.fixed || cn.B.fixed) qa.note(`connector ${cn.i + 1}: ${[cn.A.fixed && 'from', cn.B.fixed && 'to'].filter(Boolean).join(' + ')} endpoint is a spec-owned fixed region (not a tracked target: its visibility under covers is not verified)`);
      qa.hit(cn.t0, `connector ${cn.i + 1}`);
      qa.keyframe(Math.min(duration - 1 / fps, cn.t0 + cn.dur * 0.55), `connector ${cn.i + 1} drawing`);
      qa.keyframe(Math.min(duration - 1 / fps, cn.t0 + cn.dur + Math.min(0.8, (cn.t1 - cn.t0 - cn.dur) / 2)), `connector ${cn.i + 1}${cn.label ? ' · ' + cn.label : ''}`);
    }

    // ───────── QA (analytic, every frame; fails the render) ─────────
    const nFrames = Math.round(duration * fps);
    {
      // highlights: an INDEPENDENT dense track lookup + the matrix-product map; every ring drawn
      // equals the composed image of the tracked box (+ pad) within 1 px, only while visible
      const dense = new Map();
      const denseOf = (p, ev) => {
        if (!dense.has(ev)) {
          const n = p.msrc.frames, arr = new Array(n).fill(null);
          const end = ev.trackEnd != null ? Math.round(ev.trackEnd * p.cap.fps) : n;
          for (const [k, e] of (ev.track || []).entries()) {
            const a = Math.round(e.t * p.cap.fps), b = k + 1 < ev.track.length ? Math.round(ev.track[k + 1].t * p.cap.fps) : end;
            for (let f = Math.max(0, a); f < Math.min(b, end, n); f++) arr[f] = e;
          }
          dense.set(ev, arr);
        }
        return dense.get(ev);
      };
      const expect = (p, ev, fixed, t, st) => {
        if (fixed) return { box: fixed };
        const e = denseOf(p, ev)[p.capIdx(t)];
        return e && e.visible && e.box ? { box: e.box } : null;
      };
      const matBox = (p, t, st, box) => S.matrixBox(S.composeMatrix(st[p.id], p.camAt(t), { sw: p.sw, sh: p.sh, zMin: p.zMin }), X.pad(box, X.HIGHLIGHT_PAD));
      const err = (r, w) => Math.max(Math.abs(r.x - w.x), Math.abs(r.y - w.y), Math.abs(r.x + r.w - w.x - w.w), Math.abs(r.y + r.h - w.y - w.h));
      const bad = [], cbad = [], hidden = [];
      let drawn = 0, cdrawn = 0;
      for (let i = 0; i < nFrames; i++) {
        const t = i / fps, st = stateAt(t);
        for (const co of callouts) {
          const s = calloutState(co, t, st);
          if (!s) continue;
          drawn++;
          const p = co.p, ex = expect(p, co.tev, co.fixed, t, st);
          if (!ex) { bad.push({ t: +t.toFixed(4), panel: p.id, callout: co.text, why: 'highlight drawn while the target is not visible', captureFrame: p.capIdx(t) }); continue; }
          const want = matBox(p, t, st, ex.box), e = err(s.ring, want);
          if (e > 1) bad.push({ t: +t.toFixed(4), panel: p.id, callout: co.text, why: `ring off by ${e.toFixed(2)} px`, captureFrame: p.capIdx(t) });
          const T = st[p.id], scr = { x: T.x, y: T.y, w: T.k * p.sw, h: T.k * p.sh }; // the device screen on the stage (camera-independent)
          const wantBox = matBox(p, t, st, { x: ex.box.x + X.HIGHLIGHT_PAD, y: ex.box.y + X.HIGHLIGHT_PAD, w: ex.box.w - 2 * X.HIGHLIGHT_PAD, h: ex.box.h - 2 * X.HIGHLIGHT_PAD }); // = the target box itself
          if (!S.rectInside(wantBox, scr, 0.5)) bad.push({ t: +t.toFixed(4), panel: p.id, callout: co.text, why: 'highlight drawn while its target box is (partly) outside its device screen', captureFrame: p.capIdx(t) });
          qa.overlay(t, { kind: 'highlight', panel: p.id, label: co.text, captureFrame: p.capIdx(t), captureT: +(p.capIdx(t) / p.cap.fps).toFixed(4), box: ex.box, ring: { x: +s.ring.x.toFixed(2), y: +s.ring.y.toFixed(2), w: +s.ring.w.toFixed(2), h: +s.ring.h.toFixed(2) }, screen: { x: +scr.x.toFixed(2), y: +scr.y.toFixed(2), w: +scr.w.toFixed(2), h: +scr.h.toFixed(2) }, errPx: +e.toFixed(3), alpha: +s.a.toFixed(3), visible: true, fixed: !!co.fixed });
        }
        for (const cn of conIn) {
          if (t < cn.t0 || t > cn.t1 + 0.35) continue; // incl. the fade-out
          const s = connectorState(cn, t, st);
          if (!s.ok) { hidden.push({ t: +t.toFixed(4), connector: cn.i + 1, why: s.why }); continue; }
          cdrawn++;
          for (const [E, r, nm] of [[cn.A, s.ra, 'from'], [cn.B, s.rb, 'to']]) {
            const ex = expect(E.p, E.ev, E.fixed, t, st);
            if (!ex) { cbad.push({ t: +t.toFixed(4), connector: cn.i + 1, end: nm, why: 'endpoint drawn while its target is not visible' }); continue; }
            const e = err(r, matBox(E.p, t, st, ex.box));
            if (e > 1) cbad.push({ t: +t.toFixed(4), connector: cn.i + 1, end: nm, why: `endpoint box off by ${e.toFixed(2)} px` });
          }
          qa.overlay(t, { kind: 'connector', index: cn.i + 1, u: +K.clamp((t - cn.t0) / cn.dur).toFixed(4), alpha: +(1 - K.cubicIn(K.clamp((t - cn.t1) / 0.35))).toFixed(3), label: cn.label || `connector ${cn.i + 1}`, a: { x: +s.a.x.toFixed(2), y: +s.a.y.toFixed(2), side: s.a.side }, b: { x: +s.b.x.toFixed(2), y: +s.b.y.toFixed(2), side: s.b.side }, from: { panel: cn.A.p.id, box: s.boxA, ring: s.ra }, to: { panel: cn.B.p.id, box: s.boxB, ring: s.rb } });
        }
      }
      // cursor tip on every click point (desktop panels)
      for (const p of PN.values()) {
        if (!p.showCursor || p.touch) continue;
        for (const e of p.evs.filter((x) => x.type === 'click' && x.point)) {
          const t = p.start + e.t;
          if (t > duration) continue;
          const st = stateAt(t), q = p.cursor.at(e.t);
          const d = Math.hypot(q.x - e.point.x, q.y - e.point.y) * mapOf(p, t, st).K;
          if (d > 1) bad.push({ t: +t.toFixed(4), panel: p.id, callout: null, why: `cursor tip ${d.toFixed(2)} px from the click point of ${e.step}` });
        }
      }
      qa.check('highlight-accuracy', bad.length ? 'fail' : 'pass',
        bad.length ? `${bad.length} highlight/cursor violations across panels (ring ≠ composed map of the tracked target ± ${X.HIGHLIGHT_PAD} CSS px within 1 px, or drawn while covered)` : `${drawn} highlight frames across ${PN.size} panels match their tracked, visible targets within 1 px (independent matrix map); cursor on every click point`,
        bad.length ? bad.slice(0, 40) : undefined);
      if (conIn.length) {
        const fail = cbad.length || hidden.length;
        qa.check('connector-endpoints', fail ? 'fail' : 'pass',
          fail ? `${hidden.length} connector frames with a hidden endpoint (not drawn; fail-closed) and ${cbad.length} endpoint errors — re-time the connector (at/dur/hold) to a window where both targets are on screen` : `${cdrawn} connector frames: both endpoints on visible tracked targets, within 1 px of the composed map`,
          fail ? [...hidden.slice(0, 20), ...cbad.slice(0, 20)] : undefined);
      }
    }

    // ───────── QA: stage geometry at rest (overlap, zones), legibility, clock ─────────
    {
      const bad = [];
      const zones = [...(chip ? [{ id: 'clock', r: { x: chip.x, y: chip.y, w: chip.w, h: chip.h } }] : []), ...(foot ? [{ id: 'footnote', r: { x: foot.x, y: foot.y, w: foot.w, h: foot.h } }] : []), ...(bandPx ? [{ id: 'caption band', r: { x: 0, y: Hs, w: W, h: bandPx } }] : [])];
      for (const [i, k] of lkeys.entries()) {
        const st = LT.settled[i];
        const rects = k.panels.map((id) => ({ id, r: S.frameOut(st[id], frames[id]), lab: PN.get(id).labelRun ? { x: st[id].x, y: S.frameOut(st[id], frames[id]).y + S.frameOut(st[id], frames[id]).h, w: 1, h: labelH } : null }));
        for (let a = 0; a < rects.length; a++) {
          const A = rects[a];
          if (!S.rectInside(A.r, { x: 0, y: 0, w: W, h: Hs }, 0.5)) bad.push({ layout: i + 1, panel: A.id, why: 'device leaves the frame / enters the caption band' });
          for (const z of zones) if (S.rectsOverlap(A.r, z.r)) bad.push({ layout: i + 1, panel: A.id, why: `device covers the ${z.id}` });
          for (let b = a + 1; b < rects.length; b++) if (S.rectsOverlap(A.r, rects[b].r, -4 * unit)) bad.push({ layout: i + 1, panel: `${A.id}+${rects[b].id}`, why: 'devices overlap at rest' });
        }
      }
      qa.check('stage-layout', bad.length ? 'fail' : 'pass', bad.length ? `${bad.length} layout violations at rest` : `${lkeys.length} layouts at rest: devices inside the frame, apart, clear of the clock, footnote and caption band`, bad.length ? bad : undefined);
      // legibility: the focus panel's body text (params.cssText CSS px) on every settled frame
      if (params.legibility > 0) {
        const low = [];
        let n = 0, minPx = Infinity;
        for (let i = 0; i < nFrames; i++) {
          const t = i / fps;
          if (LT.moving(t)) continue;
          let ki = 0;
          while (ki + 1 < lkeys.length && t >= lkeys[ki + 1].t) ki++;
          const p = PN.get(lkeys[ki].focus);
          if (p.pc.legible === false) continue;
          const px = S.textPx(mapOf(p, t).K, p.pc.cssText ?? params.cssText, unit);
          n++; minPx = Math.min(minPx, px);
          if (px < params.legibility - 0.05) low.push({ t: +t.toFixed(3), panel: p.id, textPx: +px.toFixed(2) });
        }
        qa.check('legibility', low.length ? 'fail' : 'pass', low.length ? `${low.length} settled frames show the focus panel's body text (cssText CSS px) under ${params.legibility}px (min ${minPx.toFixed(1)}px)` : `focus panel body text ≥ ${params.legibility}px on all ${n} settled frames (min ${Number.isFinite(minPx) ? minPx.toFixed(1) : '–'}px at a 1080-px short side)`, low.length ? low.slice(0, 20) : undefined);
      }
      if (clockT) qa.check('story-clock', 'pass', `${clockT.keys.length} keys, monotonic (${clockT.keys.map((k) => `${k.time}@${k.t.toFixed(2)}s`).join(' → ')}), cap ${chip.cap}px`);
    }

    // ───────── QA: text registration, hits, keyframes ─────────
    if (chip) {
      qa.text('clock', { box: { x0: chip.x + chip.padX + chip.icon + chip.cap * 0.5, y0: chip.y + (chip.h - chip.cap) / 2, x1: chip.x + chip.w - chip.padX, y1: chip.y + (chip.h + chip.cap) / 2 }, size: chip.cap, fg: plateInk, bg: plate });
      for (const k of clockT.keys.slice(1)) { qa.hit(k.t, `clock ${k.time}`); if (k.roll) qa.keyframe(Math.min(duration - 1 / fps, k.t + clockT.rollDur * 0.45), `clock rolls to ${k.time}`); }
    }
    if (foot) foot.runs.forEach((r, i) => { const y1 = foot.y + (foot.h - foot.lead * (foot.runs.length - 1) + foot.cap) / 2 + i * foot.lead; qa.text(`footnote${foot.runs.length > 1 ? ` line ${i + 1}` : ''}`, { box: { x0: foot.x + foot.padX, y0: y1 - foot.cap, x1: foot.x + foot.padX + r.inkWidth, y1 }, size: foot.cap, fg: P.paper, bg: P.ink }); });
    const labelBox = (p, T) => { const r = S.frameOut(T, p.fr); const x = r.x + r.w / 2; return { x, y: r.y + r.h + lblGap + lblCap, r }; };
    for (const [i, k] of lkeys.entries()) {
      for (const id of k.panels) {
        const p = PN.get(id);
        if (!p.labelRun) continue;
        const lb = labelBox(p, LT.settled[i][id]);
        qa.text(`label ${id} (layout ${i + 1})`, { box: { x0: lb.x - p.labelRun.inkWidth / 2, y0: lb.y - lblCap, x1: lb.x + p.labelRun.inkWidth / 2, y1: lb.y }, size: lblCap, fg: groundInk, bg: night ? P.night : P.bg });
      }
      qa.hit(k.t, `layout ${i + 1} ${k.arrangement}`);
      qa.keyframe(Math.min(duration - 1 / fps, k.t + k.dur + 0.25), `layout ${i + 1} ${k.arrangement} · ${k.focus}`);
      if (k.dur > 0) qa.keyframe(k.t + k.dur * 0.5, `→ layout ${i + 1}`);
    }
    for (const p of PN.values()) for (const e of p.evs.filter((x) => x.type === 'click' || x.type === 'navigate')) if (p.start + e.t <= duration) qa.hit(p.start + e.t, `${p.id} ${e.type} ${e.step || ''}`.trim());
    qa.keyframe(0.05, 'open');
    qa.keyframe(duration - 1 / fps, 'last frame');

    // ───────── drawing ─────────
    const rr = (g, x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
    const frameColors = { body: P.ink, rim: K.rgba(P.paper, 0.14), chrome: P.chrome, chromeLine: K.rgba(P.chromeInk, 0.16), empty: P.paper };
    const radiusOf = (p) => (p.kind === 'phone' ? X.FRAME.phoneR : params.radius);
    const shadows = new Map();
    function shadowOf(p) {
      // one soft shadow per device, built once at its largest scale, scaled down with it
      if (shadows.has(p)) return shadows.get(p);
      const rs = ctx.renderScale || 1, pad = 150 * unit, k = p.kMax;
      const ww = p.fr.w * k, wh = p.fr.h * k;
      const c = new OffscreenCanvas(Math.ceil((ww + pad * 2) * rs), Math.ceil((wh + pad * 2) * rs));
      const g = c.getContext('2d', { willReadFrequently: true });
      g.scale(rs, rs);
      const off = 10000;
      for (const [blur, dy, a] of X.SHADOW_LAYERS) {
        g.save();
        g.shadowColor = `rgba(0,0,0,${Math.min(0.9, a * (night ? 1.8 : 1))})`;
        g.shadowBlur = blur * unit * rs; g.shadowOffsetX = off * rs; g.shadowOffsetY = dy * unit * rs;
        g.fillStyle = '#000';
        rr(g, pad - off, pad, ww, wh, radiusOf(p) * k);
        g.fill();
        g.restore();
      }
      const sh = { c, pad, k };
      shadows.set(p, sh);
      return sh;
    }
    function drawGround(g) {
      if (night) {
        g.fillStyle = P.night; g.fillRect(0, 0, W, H);
        const gr = g.createRadialGradient(W / 2, H * 0.42, Math.min(W, H) * 0.1, W / 2, H * 0.5, Math.hypot(W, H) * 0.6);
        gr.addColorStop(0, K.rgba(P.paper, 0.07)); gr.addColorStop(0.6, K.rgba(P.paper, 0)); gr.addColorStop(1, 'rgba(0,0,0,0.28)');
        g.fillStyle = gr; g.fillRect(0, 0, W, H);
        return;
      }
      g.fillStyle = P.bg; g.fillRect(0, 0, W, H);
      if (params.falloff > 0) {
        const gr = g.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.25, W / 2, H * 0.5, Math.hypot(W, H) * 0.62);
        gr.addColorStop(0, K.rgba(P.night, 0)); gr.addColorStop(1, K.rgba(P.night, params.falloff));
        g.fillStyle = gr; g.fillRect(0, 0, W, H);
      }
    }
    function drawPanel(g, p, t, st) {
      const T = st[p.id], a = T.alpha;
      if (a <= 0.002) return;
      const dim = dimAmt * (1 - T.focus);
      const mp = mapOf(p, t, st), fo = S.frameOut(T, p.fr);
      g.save();
      g.globalAlpha = a;
      // shadow
      const sh = shadowOf(p), q = T.k / sh.k, rs = ctx.renderScale || 1;
      g.save();
      g.translate(fo.x - sh.pad * q, fo.y - sh.pad * q);
      g.scale(q / rs, q / rs);
      g.drawImage(sh.c, 0, 0);
      g.restore();
      // device + screen (device-local px under T; the screen shows the camera's region)
      g.save();
      g.translate(T.x, T.y); g.scale(T.k, T.k);
      const bmp = hub.captureFrame(p.mid, p.capIdx(t));
      const sx = (p.msrc.w / p.vw), sy = (p.msrc.h / p.vh);
      const blur = params.blurUnfocused * (1 - T.focus) * unit;
      if (blur > 0.05) g.filter = `blur(${(blur / T.k).toFixed(3)}px)`;
      // redacted regions are cut OUT of the sharp frame (a fading panel must not leak them under the blur)
      const liveMasks = bmp ? p.masks.filter((mk) => { const fi = p.capIdx(t); return fi >= mk.f0 && fi <= mk.f1; }) : [];
      if (liveMasks.length) {
        const inv = 1 / T.k;
        g.beginPath(); g.rect(-1e5, -1e5, 2e5, 2e5);
        for (const mk of liveMasks) { const r = mp.box(mk.box); g.rect((r.x - T.x) * inv, (r.y - T.y) * inv, r.w * inv, r.h * inv); }
        g.clip('evenodd');
      }
      X.drawFrame(g, {
        kind: p.kind, vw: p.sw, vh: p.sh,
        src: bmp ? { bmp, sx: mp.src.x * sx, sy: mp.src.y * sy, sw: mp.src.w * sx, sh: mp.src.h * sy } : null,
        colors: frameColors, radius: params.radius, scale: T.k,
        chrome: (gg) => {
          gg.fillStyle = K.rgba(P.chromeInk, 0.32);
          for (let k = 0; k < 3; k++) { gg.beginPath(); gg.arc(20 + k * 19, -CHROME_H / 2, 6, 0, Math.PI * 2); gg.fill(); }
          if (p.urlRun) {
            const fw = Math.min(p.sw * 0.42, Math.max(260, p.urlRun.advance + 64));
            gg.beginPath(); gg.roundRect(p.sw / 2 - fw / 2, -CHROME_H + 7, fw, CHROME_H - 14, 8);
            gg.fillStyle = K.rgba(P.chromeInk, 0.09); gg.fill();
            K.drawRun(gg, p.urlRun, p.sw / 2, -CHROME_H / 2 + p.urlRun.capPx / 2, { align: 'center', fill: P.chromeInk });
          }
        },
      });
      g.filter = 'none';
      g.restore();
      // redactions: the masked capture region, blurred past legibility, clipped to it (and the screen)
      if (liveMasks.length) {
        for (const mk of liveMasks) {
          const r = mp.box(mk.box), sr = mp.screen;
          g.save();
          g.beginPath(); g.rect(sr.x, sr.y, sr.w, sr.h); g.clip();
          g.beginPath(); g.rect(r.x - 1.5, r.y - 1.5, r.w + 3, r.h + 3); g.clip();
          if (mk.fill) { g.fillStyle = mk.fill; g.fillRect(r.x - 1.5, r.y - 1.5, r.w + 3, r.h + 3); g.restore(); continue; } // a plain bar (covers the hole's anti-aliased edge)
          g.filter = `blur(${(7 * mp.K).toFixed(2)}px)`;
          const e = 16; // sample a margin around it so the blur has no hard edge
          g.drawImage(bmp, (mk.box.x - e) * sx, (mk.box.y - e) * sy, (mk.box.w + 2 * e) * sx, (mk.box.h + 2 * e) * sy, r.x - e * mp.K, r.y - e * mp.K, r.w + 2 * e * mp.K, r.h + 2 * e * mp.K);
          g.filter = 'none';
          g.restore();
        }
      }
      // cursor / touch / ripples (capture CSS px through the composed map, clipped to the screen)
      // pointer feedback belongs to the device in focus (on the others it is noise)
      if (p.showCursor && p.clock.running(t) && T.focus > 0.01) {
        const lt = p.clock.localT(t), z = mp.K / (T.k * p.zMin);
        const k = 1 / Math.sqrt(z);
        g.save();
        g.globalAlpha = a * T.focus;
        const sr = mp.screen;
        rr(g, sr.x, sr.y, sr.w, sr.h, p.kind === 'phone' ? (X.FRAME.phoneR - X.FRAME.bezel + 2) * T.k : params.radius * T.k); g.clip();
        mp.apply(g);
        if (p.touch) X.drawTouch(g, lt, k, p.cursor, p.evs, { ink: P.ink, paper: P.paper });
        X.drawRipples(g, lt, k, p.cursor, p.evs, { accent: P.accent, touch: p.touch });
        if (!p.touch) {
          const c = p.cursor.at(lt);
          if (c.alpha > 0.001) { g.globalAlpha = a * T.focus * c.alpha; X.drawCursorArrow(g, c.x, c.y, p.cursorSize * k, p.cursor.at(p.clock.localT(K.frameQuant(t, fps))).press, { ink: P.ink, paper: P.paper, s: T.k * p.zMin }); }
        }
        g.restore();
      }
      // dim the unfocused device toward the ground (a quiet "not now")
      if (dim > 0.002) {
        g.globalAlpha = a * dim;
        rr(g, fo.x, fo.y, fo.w, fo.h, radiusOf(p) * T.k);
        g.fillStyle = night ? P.night : P.bg; g.fill();
      }
      g.restore();
      // label under the device
      if (p.labelRun) {
        const lb = labelBox(p, T);
        g.save();
        g.globalAlpha = a * (0.62 + 0.38 * T.focus);
        K.drawRun(g, p.labelRun, lb.x, lb.y, { align: 'center', fill: groundInk });
        g.restore();
      }
    }
    function drawCallouts(g, t, st) {
      for (const co of callouts) {
        const s = calloutState(co, t, st);
        if (!s) continue;
        const { inn, out, a } = s, tb = s.ring;
        const pl = X.placeCallout(tb, co.w, co.h, safe, { gap: co.dist, only: co.side });
        Object.assign(pl, X.clearEdges(pl, co.w, co.h, S.frameOut(st[co.p.id], co.p.fr), safe, 16 * unit));
        pl.from = co.side === 'below' ? { x: pl.x + co.w / 2, y: pl.y } : co.side === 'above' ? { x: pl.x + co.w / 2, y: pl.y + co.h } : co.side === 'right' ? { x: pl.x, y: pl.y + co.h / 2 } : { x: pl.x + co.w, y: pl.y + co.h / 2 };
        const dy = (1 - inn) * 12 * unit - out * 6 * unit;
        const x = Math.round(pl.x), y = Math.round(pl.y + dy);
        g.save();
        g.globalAlpha = a;
        g.strokeStyle = P.accent; g.lineWidth = 2.5 * unit;
        rr(g, tb.x, tb.y, tb.w, tb.h, Math.min(14 * unit, tb.h / 2)); g.stroke();
        const from = { x: pl.from.x, y: pl.from.y + dy };
        const lu = K.cubicOut(K.clamp((t - co.t0) / 0.22));
        g.strokeStyle = plate; g.lineWidth = 2 * unit;
        g.beginPath(); g.moveTo(pl.anchor.x, pl.anchor.y); g.lineTo(K.lerp(pl.anchor.x, from.x, lu), K.lerp(pl.anchor.y, from.y, lu)); g.stroke();
        g.fillStyle = P.accent; g.beginPath(); g.arc(pl.anchor.x, pl.anchor.y, 4.5 * unit, 0, Math.PI * 2); g.fill();
        const sc = 0.94 + 0.06 * inn;
        g.translate(x + co.w / 2, y + co.h / 2); g.scale(sc, sc); g.translate(-co.w / 2, -co.h / 2);
        g.shadowColor = 'rgba(0,0,0,0.18)'; g.shadowBlur = 18 * unit; g.shadowOffsetY = 6 * unit;
        rr(g, 0, 0, co.w, co.h, co.h / 2); g.fillStyle = plate; g.fill();
        g.shadowColor = 'rgba(0,0,0,0)';
        K.drawRun(g, co.run, co.padX - co.run.inkLeft, co.h / 2 + co.run.capPx / 2, { fill: plateInk });
        g.restore();
      }
    }
    function drawConnectors(g, t, st) {
      for (const cn of conIn) {
        if (t < cn.t0 || t > cn.t1 + 0.35) continue;
        const s = connectorState(cn, t, st);
        if (!s.ok) continue; // fail-closed: an endpoint we cannot see is never pointed at
        const fade = 1 - K.cubicIn(K.clamp((t - cn.t1) / 0.35));
        const u = K.cubicInOut(K.clamp((t - cn.t0) / cn.dur));
        const arc = s.arc;
        const head = arc.at(u);
        g.save();
        g.globalAlpha = fade;
        // endpoint rings (the same highlight language as callouts)
        g.strokeStyle = P.accent; g.lineWidth = 2.5 * unit;
        rr(g, s.ra.x, s.ra.y, s.ra.w, s.ra.h, Math.min(14 * unit, s.ra.h / 2)); g.stroke();
        if (u > 0.98) { g.globalAlpha = fade * K.clamp((u - 0.98) / 0.02); rr(g, s.rb.x, s.rb.y, s.rb.w, s.rb.h, Math.min(14 * unit, s.rb.h / 2)); g.stroke(); g.globalAlpha = fade; }
        // the arc draws on, a travelling dot at its head
        g.lineCap = 'round'; g.lineJoin = 'round';
        g.strokeStyle = P.accent; g.lineWidth = 3 * unit;
        g.beginPath(); g.moveTo(arc.pts[0].x, arc.pts[0].y);
        for (let i = 1; i < head.i; i++) g.lineTo(arc.pts[i].x, arc.pts[i].y);
        g.lineTo(head.x, head.y); g.stroke();
        g.fillStyle = P.accent;
        g.beginPath(); g.arc(s.a.x, s.a.y, 5 * unit, 0, Math.PI * 2); g.fill();
        if (u < 1) {
          g.beginPath(); g.arc(head.x, head.y, 7 * unit, 0, Math.PI * 2); g.fill();
          g.strokeStyle = night ? P.night : P.paper; g.lineWidth = 2 * unit; g.stroke();
        } else {
          // arrival: the effect's ring is the payoff (an expanding pulse read as a stray ring on stills)
          g.beginPath(); g.arc(s.b.x, s.b.y, 5 * unit, 0, Math.PI * 2); g.fill();
        }
        // label on the arc, at the spot chosen to sit over the ground rather than a device
        if (cn.run && u > 0.35) {
          const la = K.clamp((u - 0.35) / 0.3);
          const mid0 = arc.at(cn.labelU ?? 0.5), mid = { x: mid0.x, y: mid0.y + (cn.label0?.dy ?? 0) }, padX = lblCapC * 0.9, h = Math.round(lblCapC * 2.3), w = Math.round(cn.run.advance + padX * 2);
          g.globalAlpha = fade * la;
          g.shadowColor = 'rgba(0,0,0,0.16)'; g.shadowBlur = 14 * unit; g.shadowOffsetY = 4 * unit;
          rr(g, mid.x - w / 2, mid.y - h / 2, w, h, h / 2); g.fillStyle = plate; g.fill();
          g.shadowColor = 'rgba(0,0,0,0)';
          K.drawRun(g, cn.run, mid.x - w / 2 + padX - cn.run.inkLeft, mid.y + cn.run.capPx / 2, { fill: plateInk });
        }
        g.restore();
      }
    }
    function drawCaptions(g, t) {
      // the story caption: what just happened between the devices, next to the clock that says when
      for (const cn of conIn) {
        if (!cn.capRun || t < cn.t0 || t > cn.t1 + 0.35) continue;
        const a = K.clamp((t - cn.t0) / 0.3) * (1 - K.cubicIn(K.clamp((t - cn.t1) / 0.35)));
        if (a <= 0.002) continue;
        const { x, y, h, padX, dot, cc } = cap0, w = cn.capW, dx = (1 - K.springStep(t - cn.t0, 3.4, 0.86)) * -14 * unit;
        g.save();
        g.globalAlpha = a;
        g.shadowColor = 'rgba(0,0,0,0.10)'; g.shadowBlur = 12 * unit; g.shadowOffsetY = 3 * unit;
        rr(g, x + dx, y, w, h, h / 2); g.fillStyle = P.paper; g.fill();
        g.shadowColor = 'rgba(0,0,0,0)';
        g.fillStyle = P.accent;
        g.beginPath(); g.arc(x + dx + padX + dot, y + h / 2, dot * 0.62, 0, Math.PI * 2); g.fill();
        K.drawRun(g, cn.capRun, x + dx + padX + dot * 2 + cc * 0.55 - cn.capRun.inkLeft, y + h / 2 + cn.capRun.capPx / 2, { fill: P.ink });
        g.restore();
      }
    }
    function drawClockIcon(g, cx, cy, r, col) {
      g.save();
      g.strokeStyle = col; g.lineWidth = Math.max(1.5, r * 0.17); g.lineCap = 'round';
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx, cy - r * 0.55); g.moveTo(cx, cy); g.lineTo(cx + r * 0.42, cy + r * 0.12); g.stroke();
      g.restore();
    }
    const digitRuns = new Map();
    const runOf = (ch) => { if (!digitRuns.has(ch)) digitRuns.set(ch, K.shape(fL, ch, { size: chip.size, tracking: 0 })); return digitRuns.get(ch); };
    function drawClock(g, t) {
      const st = clockT.at(K.frameQuant(t, fps));
      const a = K.clamp((t - 0.1) / 0.35);
      if (a <= 0) return;
      g.save();
      g.globalAlpha = a;
      rr(g, chip.x, chip.y, chip.w, chip.h, chip.h / 2);
      g.fillStyle = plate; g.fill();
      drawClockIcon(g, chip.x + chip.padX + chip.icon / 2, chip.y + chip.h / 2, chip.icon * 0.42, plateInk);
      const cells = S.rollDigits(st.from, st.to, st.u);
      let x = chip.x + chip.padX + chip.icon + chip.cap * 0.5;
      const base = chip.y + chip.h / 2 + chip.cap / 2, travel = chip.cap * 1.45;
      g.save();
      // odometer window: just the digit line (a rolling digit never pokes out of the chip)
      g.beginPath(); g.rect(chip.x, base - chip.cap * 1.22, chip.w, chip.cap * 1.44); g.clip();
      for (const c of cells) {
        const cw = c.to === ':' ? chip.colon.advance : chip.cellW;
        const cx = x + cw / 2;
        if (c.u >= 1) K.drawRun(g, runOf(c.to), cx, base, { align: 'center', fill: plateInk });
        else {
          g.globalAlpha = a * (1 - c.u);
          K.drawRun(g, runOf(c.from), cx, base - travel * c.u, { align: 'center', fill: plateInk });
          g.globalAlpha = a * c.u;
          K.drawRun(g, runOf(c.to), cx, base + travel * (1 - c.u), { align: 'center', fill: plateInk });
          g.globalAlpha = a;
        }
        x += cw;
      }
      g.restore();
      g.restore();
    }

    return {
      duration,
      mediaNeeds(times) {
        const seen = new Set(), out = [];
        for (const t0 of times) {
          const t = Math.max(0, Math.min(duration, t0)), st = stateAt(t);
          for (const p of PN.values()) {
            if (st[p.id].alpha <= 0.002) continue;
            const idx = p.capIdx(t), key = p.mid + '#' + idx;
            if (!seen.has(key)) { seen.add(key); out.push({ id: p.mid, idx }); }
          }
        }
        return out;
      },
      qaExempt(t) {
        const st = stateAt(t);
        return [...PN.values()].filter((p) => st[p.id].alpha > 0.002).map((p) => mapOf(p, t, st).screen);
      },
      samplesHint(t) {
        const st = stateAt(t);
        let v = 0;
        for (const p of PN.values()) if (st[p.id].alpha > 0.002) v = Math.max(v, (p.cam.speed(p.clock.localT(t)) * st[p.id].k * p.zMin) / fps);
        if (LT.moving(t)) {
          const a = stateAt(t - 1 / fps);
          for (const id of ids) v = Math.max(v, Math.hypot(st[id].x - a[id].x, st[id].y - a[id].y) + Math.abs(Math.log(st[id].k / a[id].k)) * W * 0.4);
        }
        return v > 24 ? 24 : v > 7 ? 12 : 0;
      },
      draw(g, t) {
        const st = stateAt(t);
        drawGround(g);
        for (const p of order(st)) drawPanel(g, p, t, st);
        drawConnectors(g, t, st);
        drawCallouts(g, t, st);
        if (chip) drawClock(g, t);
        if (cap0) drawCaptions(g, t);
        if (foot) {
          const a = K.clamp((t - 0.25) / 0.35);
          if (a > 0) {
            g.save(); g.globalAlpha = a;
            rr(g, foot.x, foot.y, foot.w, foot.h, foot.r); g.fillStyle = P.ink; g.fill();
            foot.runs.forEach((r, i) => K.drawRun(g, r, foot.x + foot.padX - r.inkLeft, foot.y + (foot.h - foot.lead * (foot.runs.length - 1) + foot.cap) / 2 + i * foot.lead, { fill: P.paper }));
            g.restore();
          }
        }
      },
      post(g, t) {
        if (params.grain <= 0) return;
        // grain on the ground only — never over a captured UI
        const st = stateAt(t);
        g.save();
        g.beginPath(); g.rect(0, 0, W, H);
        for (const p of PN.values()) if (st[p.id].alpha > 0.002) { const fo = S.frameOut(st[p.id], p.fr); g.roundRect(fo.x, fo.y, fo.w, fo.h, radiusOf(p) * st[p.id].k); }
        g.clip('evenodd');
        K.grain(g, W, H, { seed: ctx.seed, frame: Math.round(t * fps), amount: params.grain, mode: 'overlay' });
        g.restore();
      },
    };
  },
};
