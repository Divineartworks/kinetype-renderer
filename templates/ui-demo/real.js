// UI DEMO — real mode: native phone recordings (C2 v2) edited like a
// product ad. The recording is the picture: full-bleed in 9:16 (its own status
// bar kept), or a physically plausible phone on a calm ground in 16:9; a 2-up
// split on the shared session clock where cause meets effect across devices.
// Auto pace (dead air out, typing within budget, payoffs held, beats landed),
// a calm legibility camera, a refined press indicator exactly at each tap and
// fading swipe trails. All planning is pure (src/kit/x-real.js) and shared
// with the Node side (pace report, SFX placement, mix).
import * as K from '../../src/kit/index.js';
import * as X from '../../src/kit/x-ui.js';
import * as R from '../../src/kit/x-real.js';

const hms = (s) => { s = Math.max(0, Math.floor(s + 1e-6)); return [Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60].map((v) => String(v).padStart(2, '0')).join(':'); };
const parseClock = (c) => { const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(c || ''); return m ? +m[1] * 3600 + +m[2] * 60 + +(m[3] || 0) : null; };

export function buildReal(ctx) {
  const { W, H, fps, params, content: C, palette: P, qa, fonts } = ctx;
  const unit = Math.min(W, H) / 1080;
  const hub = ctx.media;
  // devices: content.session.devices [{id, capture (media id), label}] or the single content.capture
  const devList = C.session?.devices || [{ id: 'main', capture: C.capture, label: null }];
  const caps = {}, mediaOf = {}, labels = {};
  for (const d of devList) {
    const msrc = hub?.src?.[d.capture];
    if (!msrc || msrc.kind !== 'capture') throw new Error(`ui-demo: device "${d.id}" capture "${d.capture}" must name a spec.media entry with "capture": "…/capture.json"`);
    const cap = R.normalizeReal(msrc.capture);
    if (d.sessionOffset != null) cap.sessionOffset = d.sessionOffset;
    caps[d.id] = cap; mediaOf[d.id] = { id: d.capture, msrc }; labels[d.id] = d.label || null;
  }
  const side = W > H && (C.captions || []).length && C.frame !== 'none' ? params.side ?? 0.36 : 0;
  const plan = R.planEdit({ caps, content: C, W, H, fps, params: { ...params, side } });
  const duration = ctx.spec.duration ?? plan.duration;
  const phone = R.PHONES[params.phone] || R.PHONES.slab;
  for (const s of plan.shots) for (const n of s.notes) qa.note(`ui-demo real: ${n}`);
  qa.note(`ui-demo real: ${plan.shots.length} shot(s), ${duration.toFixed(2)} s, frame ${plan.frame}, phone ${params.phone || 'slab'}; pace ${plan.report.status}`);

  // ───────── per-panel camera + the ONE video-px → output-px map ─────────
  for (const s of plan.shots) {
    for (const p of s.panels) {
      p.cam = X.cameraTrack(p.keys, p.view, undefined, { breathe: params.breathe ?? 0.012, duration: s.f1 - s.f0, fps });
      const k = p.rect.s;
      p.map = {
        k: (c) => k * c.z,
        pt: (c, x, y) => ({ x: p.centre.x + (x - c.cx) * k * c.z, y: p.centre.y + (y - c.cy) * k * c.z }),
        box: (c, b) => ({ x: p.centre.x + (b.x - c.cx) * k * c.z, y: p.centre.y + (b.y - c.cy) * k * c.z, w: b.w * k * c.z, h: b.h * k * c.z }),
        apply: (g, c) => { g.translate(p.centre.x, p.centre.y); g.scale(k * c.z, k * c.z); g.translate(-c.cx, -c.cy); },
      };
      for (const key of p.keys) qa.note(`camera shot ${s.index + 1} ${p.device} ${(s.f0 + key.t).toFixed(2)}s → zoom ${key.z.toFixed(2)} @ (${Math.round(key.cx)}, ${Math.round(key.cy)}) ${key.why}`);
    }
  }
  // a frame's motion-blur sub-samples all belong to that frame's shot: a cut never blends two shots
  const shotOf = (t) => R.shotAt(plan, Math.min(K.frameQuant(t, fps), plan.duration - 1e-6));
  /** Capture time of device d's recording at film t inside shot s (a split runs on the session clock). */
  const devTime = (s, d, c) => (s.kind === 'split' ? c - caps[d].sessionOffset : c);
  const frameIdx = (d, c) => K.clamp(Math.floor(c * caps[d].fps + 1e-6), 0, mediaOf[d].msrc.frames - 1);
  /** [{idx, a}] — the capture frames (and dissolve weights) of device d at film t. */
  function framesOf(s, d, t) {
    return s.map.mixAt(K.frameQuant(t - s.f0, fps) - 0 * 1e-9, fps).map((m) => ({ idx: frameIdx(d, devTime(s, d, m.c)), a: m.a }));
  }

  // ───────── touch + swipe (film events, per device) ─────────
  const taps = plan.events.filter((e) => e.type === 'click' && e.point);
  const swipes = plan.events.filter((e) => (e.type === 'scroll' || e.type === 'swipe' || e.type === 'fling') && e.t1 != null);
  const r0Of = (d) => (params.touchR ?? 0.042) * caps[d].device.viewport.width;
  const trackVisible = (e) => {
    // fail-closed: a tap is drawn only when its tracked target is really there as the finger lands
    // (the frame before contact: a navigating tap's own frame already shows the next screen)
    if (!Array.isArray(e.track) || !e.track.length) return true;
    const tr = X.trackAt(e, Math.max(0, Math.round(e.devT * caps[e.device].fps) - 1), caps[e.device].fps);
    return !tr || tr.visible;
  };
  const tapOK = new Set(params.touch === false ? [] : taps.filter((e) => { const ok = trackVisible(e); if (!ok) qa.warn(`tap ${e.step} @ ${e.t.toFixed(2)}s: its target is covered/not visible on the tap frame — no indicator drawn`); return ok; }));

  // ───────── QA: pace (fails the render), legibility, touch accuracy ─────────
  for (const c of plan.report.checks) qa.check(`pace-${c.id}`, c.status, c.detail);
  qa.check('pace', plan.report.status === 'fail' ? 'fail' : plan.report.status === 'pass' ? 'pass' : 'warn', `pace report: ${plan.report.checks.filter((c) => c.status !== 'pass').map((c) => c.id + ' ' + c.status).join(', ') || 'all rules pass'}`, plan.report.metrics);
  {
    const bad = [], seen = [];
    for (const s of plan.shots) for (const p of s.panels) {
      const evs = plan.events.filter((e) => e.shot === s.index && (e.device === p.device) && (e.type === 'click' || e.type === 'type'));
      for (const e of evs) {
        const c = p.cam.at(e.t - s.f0);
        const px = p.textPx * p.rect.s * c.z;
        seen.push(px);
        if (px < (params.legibility ?? 18) - 0.01) bad.push(`${e.step} @ ${e.t.toFixed(2)}s ${px.toFixed(1)} px`);
      }
    }
    qa.check('legibility', bad.length ? 'fail' : 'pass', bad.length ? `UI body text under ${params.legibility ?? 18} px at: ${bad.join(', ')}` : `UI body text ≥ ${params.legibility ?? 18} px at every tap/typing moment (min ${seen.length ? Math.min(...seen).toFixed(1) : '—'} px)`);
  }
  {
    // independent re-derivation: output px of vpoint = rect centre + (vpoint − camera) · s · z
    const bad = [];
    let n = 0;
    for (const e of tapOK) {
      const s = plan.shots[e.shot], p = s.panels.find((q) => q.device === e.device);
      if (!p) continue;
      for (const dt of [0, R.TOUCH.press / 2]) {
        const t = e.t + dt, c = p.cam.at(t - s.f0);
        const st = R.touchAt(t, e, r0Of(e.device));
        if (!st) continue;
        const got = p.map.pt(c, st.x, st.y);
        const want = { x: p.centre.x + (e.point.x - c.cx) * p.rect.s * c.z, y: p.centre.y + (e.point.y - c.cy) * p.rect.s * c.z };
        const err = Math.hypot(got.x - want.x, got.y - want.y);
        n++;
        if (err > 1) bad.push({ step: e.step, t: +t.toFixed(3), err: +err.toFixed(3) });
        // the logged vpoint must be inside the logged target box (producer/mapping consistency), and on the shown screen
        if (e.box && (e.point.x < e.box.x - 1 || e.point.x > e.box.x + e.box.w + 1 || e.point.y < e.box.y - 1 || e.point.y > e.box.y + e.box.h + 1)) bad.push({ step: e.step, t: +t.toFixed(3), why: 'vpoint outside its vbox' });
        if (C.endCard && t >= C.endCard.at) continue;
        if (got.x < 0 || got.x > W || got.y < (p.rect.bleed ? p.rect.y : 0) || got.y > H) bad.push({ step: e.step, t: +t.toFixed(3), why: 'tap off the shown frame (camera crops the tapped point)' });
        qa.overlay(t, { kind: 'touch', step: e.step, device: e.device, vpoint: e.point, at: { x: +got.x.toFixed(2), y: +got.y.toFixed(2) }, errPx: +err.toFixed(3) });
      }
    }
    qa.check('touch-accuracy', bad.length ? 'fail' : 'pass', bad.length ? `${bad.length} press indicators off their vpoint by > 1 px` : `${n} press-indicator samples centred on their logged vpoint (≤ 1 px)`, bad.length ? bad.slice(0, 20) : undefined);
  }

  // ───────── keyframes (stills / contact sheet) ─────────
  qa.keyframe(0.05, 'open');
  for (const s of plan.shots) if (s.index) qa.keyframe(s.f0 + 0.1, `shot ${s.index + 1} ${s.kind}`);
  for (const e of plan.events) {
    if (e.t < 0 || e.t > duration) continue;
    if (e.type === 'click') { qa.hit(e.t, `tap ${e.step || ''}`); qa.keyframe(Math.min(duration - 1 / fps, e.t + 0.04), `tap ${e.step || ''}`); }
    else if (e.type === 'type') qa.keyframe(Math.min(duration - 1 / fps, (e.t + (e.t1 ?? e.t)) / 2), `typing ${e.step || ''}`);
    else if (e.type === 'mark' && e.payoff) qa.keyframe(Math.min(duration - 1 / fps, e.t + 0.45), `payoff ${e.id}`);
  }
  qa.keyframe(duration - 1 / fps, 'last frame');

  // ───────── captions (Norwegian; restrained; never over the named UI) ─────────
  const fL = fonts.get('label');
  const capSize = (face, c) => (c * face.upm) / face.capHeight;
  const filmOf = (at) => {
    if (typeof at === 'number') return at;
    const e = plan.events.find((x) => !x.open && (x.type === 'mark' && (x.id === at || `${x.device}:${x.id}` === at)) || ((x.step === at || `${x.device}:${x.step}` === at) && x.type !== 'mark'));
    if (!e) throw new Error(`ui-demo: caption at "${at}" is not a mark/step shown in the edit`);
    return e.t;
  };
  const sideCap = side > 0;
  const bandT = H > W && plan.frame === 'none' ? Math.round((params.bandTop ?? 0) * H) : 0;
  const cCap = (bandT ? 40 : sideCap ? 46 : W > H ? 30 : 40) * unit * (params.captionScale ?? 1);
  const maxW = bandT ? W * 0.86 : sideCap ? W * side - W * 0.07 : W * (W > H ? 0.5 : 0.8);
  const capOpts = { size: capSize(fL, cCap), tracking: -8 };
  const wrap = (text) => K.balanceLines(fL, text, maxW, capOpts).map((l) => Object.assign(K.shape(fL, l, capOpts), { line: l }));
  const captions = (C.captions || []).map((c, i) => {
    const t0 = filmOf(c.at) + (c.offset ?? 0);
    const runs = wrap(c.text);
    const dur = c.dur ?? Math.max(1.6, X.readTime(c.text));
    if (runs.length > 2) qa.warn(`caption ${i + 1} "${c.text}" wraps to ${runs.length} lines (keep ≤ 2)`);
    return { ...c, t0, t1: Math.min(duration, t0 + dur), runs, lh: cCap * (bandT ? 1.42 : 1.9) };
  });
  // one caption at a time, and a caption lives in the shot it starts in (a cut ends it; side captions never sit over a split)
  captions.sort((a, b) => a.t0 - b.t0).forEach((c, i) => {
    const nx = captions[i + 1];
    if (nx && c.t1 > nx.t0 - 0.35) c.t1 = Math.max(c.t0 + 0.6, nx.t0 - 0.35);
    const sh = R.shotAt(plan, Math.min(c.t0, plan.duration - 1e-6));
    // a band caption is not on the picture: a cut does not end it (it runs to its own end or the next caption)
    if (!bandT && c.t1 > sh.f1 - 0.3) c.t1 = Math.max(c.t0 + 0.6, sh.f1 - 0.3);
    if (sideCap && sh.kind === 'split') { c.skip = true; qa.warn(`caption "${c.text}" starts in a split shot: side captions are not drawn over two phones`); }
  });
  captions.forEach((c, i) => { qa.keyframe(Math.min(duration - 1 / fps, c.t0 + 0.5), `caption ${i + 1}`); qa.hit(c.t0, `caption ${i + 1}`); });

  // ───────── clock chip (shared session clock) ─────────
  const clock0 = parseClock(C.session?.clock);
  const chipMode = params.clockChip ?? (clock0 != null ? 'split' : 'never');
  const chipCap = 22 * unit;
  const chipRun = (txt) => K.shape(fonts.get('url'), txt, { size: capSize(fonts.get('url'), chipCap), tracking: 10, kerning: 'metric' });
  const chipW = chipRun('00:00:00').advance + chipCap * 2.4 + chipCap * 1.6;

  // ───────── drawing ─────────
  const night = params.ground ? params.ground === 'night' : K.luminance(P.night) < 0.18;
  const rr = (g, x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
  const shadowCache = new Map();
  function shadowSprite(p) {
    // one soft, physically plausible shadow per panel, built once at zoom 1 and scaled with the camera
    if (shadowCache.has(p)) return shadowCache.get(p);
    const rs = ctx.renderScale || 1, pad = Math.round(160 * unit);
    const ww = p.rect.w + 2 * p.rect.bezel, wh = p.rect.h + 2 * p.rect.bezel;
    const c = new OffscreenCanvas(Math.ceil((ww + pad * 2) * rs), Math.ceil((wh + pad * 2) * rs));
    const g = c.getContext('2d', { willReadFrequently: true });
    g.scale(rs, rs);
    const off = 10000;
    for (const [blur, dy, a] of [[90, 46, 0.2], [28, 14, 0.16], [5, 2, 0.14]]) {
      g.save();
      g.shadowColor = `rgba(0,0,0,${Math.min(0.9, a * (night ? 1.9 : 1))})`;
      g.shadowBlur = blur * unit * rs; g.shadowOffsetX = off * rs; g.shadowOffsetY = dy * unit * rs;
      g.fillStyle = '#000';
      rr(g, pad - off, pad, ww, wh, p.rect.r + p.rect.bezel);
      g.fill();
      g.restore();
    }
    const sp = { c, pad };
    shadowCache.set(p, sp);
    return sp;
  }
  function drawGround(g) {
    g.fillStyle = night ? P.night : P.bg;
    g.fillRect(0, 0, W, H);
    const gr = g.createRadialGradient(W * (side ? 0.32 : 0.5), H * 0.45, Math.min(W, H) * 0.1, W / 2, H / 2, Math.hypot(W, H) * 0.62);
    gr.addColorStop(0, K.rgba(night ? P.paper : '#FFFFFF', night ? 0.06 : 0.35));
    gr.addColorStop(1, K.rgba(night ? '#000000' : P.night, night ? 0.3 : 0.4));
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
  }
  function drawPanel(g, s, p, t, shadowOnly = false) {
    const tl = t - s.f0, c = p.cam.at(tl);
    const vw = caps[p.device].device.viewport.width, vh = caps[p.device].device.viewport.height;
    const k = p.map.k(c);
    const rS = p.rect.r / p.rect.s; // screen corner radius, video px
    const bz = p.rect.bezel / p.rect.s;
    if (shadowOnly && !p.rect.bleed) {
      const sh = shadowSprite(p), o = p.map.pt(c, -bz, -bz), kz = c.z;
      g.save();
      g.translate(o.x - sh.pad * kz, o.y - sh.pad * kz);
      g.scale(kz / (ctx.renderScale || 1), kz / (ctx.renderScale || 1));
      g.drawImage(sh.c, 0, 0);
      g.restore();
    }
    if (shadowOnly) return;
    g.save();
    p.map.apply(g, c);
    if (!p.rect.bleed && phone.body) {
      // body: graphite/aluminium slab, the screen's own radius + bezel, a soft rim light, side keys
      rr(g, -bz, -bz, vw + 2 * bz, vh + 2 * bz, rS + bz);
      g.fillStyle = phone.body; g.fill();
      g.lineWidth = Math.max(1, 2.2 / k); g.strokeStyle = phone.edge; g.stroke();
      rr(g, -bz + 3 / k, -bz + 3 / k, vw + 2 * bz - 6 / k, vh + 2 * bz - 6 / k, rS + bz - 3 / k);
      g.lineWidth = Math.max(0.8, 1.4 / k); g.strokeStyle = phone.rim; g.stroke();
      g.fillStyle = phone.edge;
      rr(g, vw + bz - 1, vh * 0.2, 7, vh * 0.07, 3); g.fill();
      rr(g, vw + bz - 1, vh * 0.3, 7, vh * 0.11, 3); g.fill();
    }
    g.save();
    if (!p.rect.bleed) { rr(g, 0, 0, vw, vh, rS); g.clip(); }
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    const frs = framesOf(s, p.device, t);
    for (const f of frs) {
      const bmp = hub.captureFrame(mediaOf[p.device].id, f.idx);
      if (!bmp) continue;
      g.globalAlpha = f === frs[0] ? 1 : f.a;
      g.drawImage(bmp, 0, 0, bmp.width, bmp.height, 0, 0, vw, vh);
    }
    g.globalAlpha = 1;
    if (!p.rect.bleed && phone.body) {
      // glass: the faintest top-left sheen, never over the content's legibility
      const gl = g.createLinearGradient(0, 0, vw * 0.6, vh * 0.35);
      gl.addColorStop(0, 'rgba(255,255,255,0.05)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gl; g.fillRect(0, 0, vw, vh);
    }
    // touch: press indicator + ripple exactly at vpoint (video px), swipe trails
    const r0 = r0Of(p.device);
    for (const e of tapOK) {
      if (e.device !== p.device || e.shot !== s.index) continue;
      const st = R.touchAt(t, e, r0);
      if (!st) continue;
      if (st.disc.a > 0.002) {
        // a light, brand-tinted fingertip with a thin dark edge: visible on any UI, including brand-coloured buttons
        const k = st.disc.a / 0.42;
        const gr = g.createRadialGradient(st.x, st.y, 0, st.x, st.y, st.disc.r);
        gr.addColorStop(0, K.rgba(K.mix('#FFFFFF', P.accent, 0.18), 0.62 * k));
        gr.addColorStop(0.75, K.rgba(K.mix('#FFFFFF', P.accent, 0.3), 0.5 * k));
        gr.addColorStop(1, K.rgba(K.mix('#FFFFFF', P.accent, 0.3), 0.42 * k));
        g.fillStyle = gr;
        g.beginPath(); g.arc(st.x, st.y, st.disc.r, 0, Math.PI * 2); g.fill();
        g.lineWidth = r0 * 0.06; g.strokeStyle = K.rgba(P.ink, 0.32 * k); g.stroke();
      }
      if (st.ring) {
        g.globalAlpha = st.ring.a;
        g.beginPath(); g.arc(st.x, st.y, st.ring.r, 0, Math.PI * 2);
        g.lineWidth = st.ring.w * 1.9; g.strokeStyle = K.rgba(P.ink, 0.22); g.stroke();
        g.lineWidth = st.ring.w; g.strokeStyle = '#FFFFFF'; g.stroke();
        g.globalAlpha = 1;
      }
    }
    for (const e of swipes) {
      if (e.device !== p.device || e.shot !== s.index) continue;
      const path = R.swipePath(e, p.view);
      const tr = R.swipeTrail(t, { t: e.t, t1: e.t1, ...path });
      if (!tr) continue;
      g.lineCap = 'round';
      for (let i = 0; i + 1 < tr.pts.length; i++) {
        const a = tr.pts[i], b = tr.pts[i + 1];
        g.globalAlpha = tr.a * 0.22 * a.w;
        g.lineWidth = r0 * 0.5 * (0.3 + 0.7 * a.w);
        g.strokeStyle = P.accent;
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      }
      const h = tr.pts[0];
      g.globalAlpha = tr.a * 0.3;
      g.fillStyle = P.accent;
      g.beginPath(); g.arc(h.x, h.y, r0 * 0.62, 0, Math.PI * 2); g.fill();
      g.globalAlpha = tr.a * 0.6; g.lineWidth = r0 * 0.06; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.stroke();
      g.globalAlpha = 1;
    }
    g.restore();
    g.restore();
    // device label (split): small, under the screen
    if (s.kind === 'split' && labels[p.device]) {
      const run = K.shape(fonts.get('url'), labels[p.device], { size: capSize(fonts.get('url'), 18 * unit), tracking: 30, kerning: 'metric' });
      const o = p.map.box(c, { x: 0, y: vh + bz, w: vw, h: 0 });
      if (o.y + 34 * unit <= H - 14 * unit) K.drawRun(g, run, o.x + o.w / 2, o.y + 34 * unit, { align: 'center', fill: night ? K.rgba(P.paper, 0.75) : K.rgba(P.ink, 0.7) });
      else {
        // the 2-up is zoomed and the screens run off the bottom: the label rides on the screen as a small plate
        const ph = Math.round(18 * unit * 2.3), pw = Math.round(run.advance + 18 * unit * 2), x = Math.round(o.x + o.w / 2 - pw / 2), y = Math.round(H - ph - 26 * unit);
        g.save(); rr(g, x, y, pw, ph, ph / 2); g.fillStyle = K.rgba(P.ink, 0.86); g.fill();
        K.drawRun(g, run, x + pw / 2, y + ph / 2 + run.capPx / 2, { align: 'center', fill: P.paper }); g.restore();
      }
    }
  }
  function drawChip(g, s, t) {
    if (clock0 == null || chipMode === 'never' || (chipMode === 'split' && s.kind !== 'split')) return;
    // a solo device shot shows the shared clock only right after a device switch (it says "same moment", then gets out of the way)
    const prevS = plan.shots[s.index - 1];
    const switched = s.kind === 'split' || (prevS && prevS.devices.join() !== s.devices.join());
    if (!switched && chipMode !== 'always') return;
    const showFor = s.kind === 'split' || chipMode === 'always' ? Infinity : 1.8;
    if (t - s.f0 > showFor + 0.3) return;
    const c = s.map.toCapture(K.frameQuant(t - s.f0, fps));
    const sess = s.kind === 'split' ? c : c + caps[s.devices[0]].sessionOffset;
    const txt = hms(clock0 + sess);
    const run = chipRun(txt);
    const h = Math.round(chipCap * 2.5), w = Math.round(chipW);
    const top = s.panels.reduce((m, p) => Math.min(m, p.rect.y - p.rect.bezel), H);
    const bleedShot = s.panels.length === 1 && s.panels[0].rect.bleed;
    // zoomed 2-up (no room above the phones): the chip sits in the bottom row, between the two device plates
    const zoomedSplit = s.kind === 'split' && top - h - 22 * unit < 18 * unit;
    let bx = null, by = null;
    if (bleedShot) {
      // full-bleed: ride on the browser toolbar's right side (chrome, not the app) while it is on screen
      const p = s.panels[0], tb = caps[p.device].device.chrome?.toolbar;
      if (tb) { const r = p.map.box(p.cam.at(t - s.f0), { x: 0, y: tb.y, w: caps[p.device].device.viewport.width, h: tb.h }); if (r.y >= 0 && r.y + r.h <= H) { bx = Math.round(r.x + r.w - w - 250 * unit); by = Math.round(r.y + (r.h - h) / 2); } }
    }
    const x = bx ?? Math.round(W / 2 - w / 2), y = by != null ? by : bleedShot ? Math.round(H - h - 64 * unit) : zoomedSplit ? Math.round(H - Math.round(18 * unit * 2.3) - 26 * unit + (Math.round(18 * unit * 2.3) - h) / 2) : Math.round(Math.max(18 * unit, top - h - 22 * unit));
    const a = K.clamp((t - s.f0) / 0.25) * (Number.isFinite(showFor) ? 1 - K.clamp((t - s.f0 - showFor) / 0.3) : 1);
    g.save();
    g.globalAlpha = a;
    rr(g, x, y, w, h, h / 2);
    g.fillStyle = night ? K.rgba(P.paper, 0.94) : P.ink; g.fill();
    // live dot
    g.fillStyle = P.accent;
    g.beginPath(); g.arc(x + chipCap * 1.25, y + h / 2, chipCap * 0.32, 0, Math.PI * 2); g.fill();
    K.drawRun(g, run, x + chipCap * 2.1 - run.inkLeft, y + h / 2 + run.capPx / 2, { fill: night ? P.ink : P.paper });
    g.restore();
  }
  /** Plate position of a caption, decided once (pure): the first band free of every UI target used during its window. */
  function captionSpot(c, s, w, h) {
    if (c.spot) return c.spot;
    const avoid = [];
    for (const e of plan.events) {
      if (e.shot !== s.index || !e.box || e.t < c.t0 - 0.4 || e.t > c.t1 + 0.6) continue;
      const p = s.panels.find((q) => q.device === e.device);
      if (!p) continue;
      for (const tt of [c.t0, (c.t0 + c.t1) / 2, c.t1, e.t]) avoid.push(p.map.box(p.cam.at(K.clamp(tt, s.f0, s.f1) - s.f0), e.box));
    }
    // bottom band first (the top of a native recording is the OS + browser chrome), then top, then middle
    const cands = [H * 0.865, H * 0.075, H * 0.5].map((cy) => ({ x: (W - w) / 2, y: cy - h / 2 }));
    c.spot = cands.find((b) => !avoid.some((q) => X.overlaps({ x: b.x, y: b.y, w, h }, q, 14 * unit))) || cands[0];
    return c.spot;
  }
  function drawCaptions(g, s, t) {
    for (const c of captions) {
      if (c.skip) continue;
      if (t < c.t0 - 0.02 || t > c.t1 + 0.3) continue;
      const inn = K.cubicOut(K.clamp((t - c.t0) / 0.32)), out = K.clamp((t - c.t1) / 0.3);
      const a = inn * (1 - out);
      if (a <= 0.002) continue;
      const lw = Math.max(...c.runs.map((r) => r.advance));
      if (bandT) { drawBandCaption(g, c, a, inn); continue; }
      if (sideCap) {
        // right of the phone at its widest push-in during the shot (the caption never touches the device)
        const pp = s.panels[s.panels.length - 1], pr = pp.rect, zTop = Math.max(1, ...pp.keys.map((q) => q.z));
        const x = Math.round(Math.min(W * (1 - side) + W * 0.01, pp.centre.x + (pr.w / 2 + pr.bezel) * zTop + W * 0.06)), blockH = c.lh * (c.runs.length - 1) + cCap;
        const y0 = Math.round(H / 2 - blockH / 2 + cCap + (1 - inn) * 14 * unit);
        g.save(); g.globalAlpha = a;
        c.runs.forEach((r, i) => K.drawRun(g, r, x - r.inkLeft, y0 + i * c.lh, { fill: night ? P.paper : P.ink }));
        g.restore();
        continue;
      }
      // a plate, top or bottom band, whichever keeps off the UI being used
      const padX = cCap * 1.0, padY = cCap * 0.95;
      const w = lw + padX * 2, h = c.lh * (c.runs.length - 1) + cCap + padY * 2;
      const pick = captionSpot(c, s, w, h);
      const y = Math.round(pick.y + (1 - inn) * 10 * unit), x = Math.round(pick.x);
      g.save(); g.globalAlpha = a;
      g.shadowColor = 'rgba(0,0,0,0.22)'; g.shadowBlur = 24 * unit; g.shadowOffsetY = 6 * unit;
      rr(g, x, y, w, h, Math.min(h / 2, cCap * 1.2));
      g.fillStyle = K.rgba(P.ink, 0.92); g.fill();
      g.shadowColor = 'rgba(0,0,0,0)';
      c.runs.forEach((r, i) => K.drawRun(g, r, x + (w - r.advance) / 2 - r.inkLeft + (r.inkLeft || 0), y + padY + cCap + i * c.lh, { fill: P.paper }));
      g.restore();
      qa.text(`caption ${c.text.slice(0, 20)}`, { box: { x0: x + padX, y0: y + padY, x1: x + padX + lw, y1: y + h - padY }, size: cCap, fg: P.paper, bg: P.ink });
    }
  }

  // caption plates: position decided once at setup from the shot the caption starts in (render-order independent)
  if (!sideCap && !bandT) for (const c of captions) {
    if (c.skip) continue;
    const lw = Math.max(...c.runs.map((r) => r.advance)), padX = cCap, padY = cCap * 0.95;
    captionSpot(c, R.shotAt(plan, Math.min(c.t0, plan.duration - 1e-6)), lw + padX * 2, c.lh * (c.runs.length - 1) + cCap + padY * 2);
  }

  // ───────── headline band (9:16 full-bleed, params.bandTop): captions + brand + qualifier, never over the UI ─────────
  const fU = fonts.get('url');
  const footCap = 17 * unit;
  const band = C.band || {};
  const footRun = (txt, f) => K.shape(f, txt, { size: capSize(f, footCap), tracking: f === fL ? -4 : 6, kerning: 'metric' });
  const brandRun = bandT && band.brand ? footRun(band.brand, fL) : null;
  const noteRun = bandT && band.note ? footRun(band.note, fU) : null;
  const footY = bandT - 30 * unit;
  if (bandT) {
    if (brandRun) qa.text('band brand', { box: { x0: W * 0.06, y0: footY - footCap, x1: W * 0.06 + brandRun.advance, y1: footY }, size: footCap, fg: P.ink, bg: P.bg });
    if (noteRun) qa.text('band note', { box: { x0: W * 0.94 - noteRun.advance, y0: footY - footCap, x1: W * 0.94, y1: footY }, size: footCap, fg: K.mix(P.bg, P.ink, 0.72), bg: P.bg });
  }
  function drawBand(g) {
    g.fillStyle = P.bg; g.fillRect(0, 0, W, bandT);
    g.fillStyle = K.rgba(P.ink, 0.14); g.fillRect(0, bandT - Math.max(1, unit), W, Math.max(1, unit));
    if (brandRun) K.drawRun(g, brandRun, W * 0.06 - brandRun.inkLeft, footY, { fill: P.ink });
    if (noteRun) { g.save(); g.globalAlpha = 0.72; K.drawRun(g, noteRun, W * 0.94 - noteRun.advance, footY, { fill: P.ink }); g.restore(); }
  }
  const bandCapTop = (c) => (footY - footCap - 18 * unit - (c.lh * (c.runs.length - 1) + cCap)) / 2 + 6 * unit;
  /** A band caption: centred in the band above the footer; `em` (a substring, e.g. the kr figure) in the accent. */
  function drawBandCaption(g, c, a, inn) {
    const top = bandCapTop(c);
    g.save(); g.globalAlpha = a;
    c.runs.forEach((r, i) => {
      const y = Math.round(top + cCap + i * c.lh + (1 - inn) * 12 * unit);
      const k = c.em ? r.line.indexOf(c.em) : -1;
      if (k < 0) { K.drawRun(g, r, (W - r.advance) / 2, y, { fill: P.ink }); return; }
      const parts = [r.line.slice(0, k), c.em, r.line.slice(k + c.em.length)].map((txt, j) => ({ run: txt ? K.shape(fL, txt, capOpts) : null, fill: j === 1 ? P.accent : P.ink }));
      let x = (W - parts.reduce((s, q) => s + (q.run?.advance || 0), 0)) / 2;
      for (const q of parts) if (q.run) { K.drawRun(g, q.run, x, y, { fill: q.fill }); x += q.run.advance; }
    });
    g.restore();
  }
  if (bandT) for (const c of captions) {
    const lw = Math.max(...c.runs.map((r) => r.advance));
    const y0 = bandCapTop(c);
    qa.text(`caption ${c.text.slice(0, 20)}`, { box: { x0: (W - lw) / 2, y0, x1: (W + lw) / 2, y1: y0 + c.lh * (c.runs.length - 1) + cCap * 1.25 }, size: cCap, fg: P.ink, bg: P.bg });
    if (c.em && !c.text.includes(c.em)) qa.warn(`caption "${c.text}": em "${c.em}" is not in the text`);
  }

  // ───────── end card (content.endCard): wipes up over the last shot, staggered type, a slow push so it never freezes ─────────
  const card = C.endCard ? (() => {
    const E = C.endCard, cw = W * (W > H ? 0.6 : 0.84);
    const sz = (c) => ({ size: capSize(fL, c * unit), tracking: -10 });
    const item = (txt, f, cap, fill, gapAfter) => (txt ? K.balanceLines(f, txt, cw, sz(cap)).map((l, i, all) => ({ run: K.shape(f, l, f === fL ? sz(cap) : { size: capSize(f, cap * unit), tracking: 4, kerning: 'metric' }), cap: cap * unit, fill, gap: i === all.length - 1 ? gapAfter * unit : cap * unit * 0.5 })) : []);
    // the URL is the action: a button-shaped accent pill (paper type), not plain text
    const urlItems = item(E.url, fL, 44, P.paper, 52).map((q) => ({ ...q, pill: { padX: 46 * unit, padY: 30 * unit } }));
    const items = [...item(E.title, fL, 88, P.ink, 46), ...item(E.line, fL, 40, P.ink, 70), ...urlItems, ...item(E.note, fU, 22, P.ink, 0)];
    const totalH = items.reduce((s, q) => s + q.cap + q.gap, 0);
    let y = H / 2 - totalH / 2 - 20 * unit;
    for (const q of items) { y += q.cap + (q.pill ? q.pill.padY : 0); q.y = y; y += q.gap + (q.pill ? q.pill.padY : 0); }
    for (const q of items) qa.text(`end card ${q.run.advance.toFixed(0)}`, { box: { x0: (W - q.run.advance) / 2, y0: q.y - q.cap, x1: (W + q.run.advance) / 2, y1: q.y }, size: q.cap, fg: q.fill, bg: q.pill ? P.accent : P.bg });
    qa.keyframe(Math.min(duration - 1 / fps, E.at + 1.2), 'end card');
    if (duration - E.at < 2) qa.warn(`end card at ${E.at} s holds only ${(duration - E.at).toFixed(2)} s (≥ 2 s to read the CTA)`);
    return { at: E.at, items, ruleY: items.length ? items[0].y - items[0].cap - 40 * unit : H / 2 };
  })() : null;
  function drawCard(g, t) {
    const u = t - card.at;
    if (u < 0) return;
    const a = K.cubicInOut(K.clamp(u / 0.45));
    const y0 = Math.round(H * (1 - a));
    g.fillStyle = P.bg; g.fillRect(0, y0, W, H - y0);
    g.save();
    const z = 1 + 0.03 * K.clamp((u - 0.45) / Math.max(0.5, duration - card.at - 0.45));
    g.translate(W / 2, H / 2); g.scale(z, z); g.translate(-W / 2, -H / 2);
    const ra = K.cubicOut(K.clamp((u - 0.3) / 0.35));
    if (ra > 0) { g.fillStyle = P.accent; g.fillRect(W / 2 - 36 * unit * ra, card.ruleY, 72 * unit * ra, 6 * unit); }
    card.items.forEach((q, i) => {
      const al = K.cubicOut(K.clamp((u - 0.36 - 0.1 * i) / 0.34));
      if (al <= 0.002) return;
      g.globalAlpha = al;
      const dy = (1 - al) * 22 * unit;
      if (q.pill) {
        const w = q.run.advance + q.pill.padX * 2, h = q.cap + q.pill.padY * 2;
        rr(g, (W - w) / 2, q.y - q.cap - q.pill.padY + dy, w, h, h / 2);
        g.fillStyle = P.accent; g.fill();
      }
      K.drawRun(g, q.run, (W - q.run.advance) / 2, q.y + dy, { fill: q.fill });
    });
    g.restore();
  }

  return {
    duration,
    plan,
    mediaNeeds(times) {
      const seen = new Set(), out = [];
      for (const t0 of times) {
        const t = K.clamp(t0, 0, duration), s = shotOf(t);
        for (const p of s.panels) for (const f of framesOf(s, p.device, t)) {
          const key = mediaOf[p.device].id + '#' + f.idx;
          if (!seen.has(key)) { seen.add(key); out.push({ id: mediaOf[p.device].id, idx: f.idx }); }
        }
      }
      return out;
    },
    qaExempt(t) {
      const s = shotOf(t);
      return s.panels.map((p) => {
        const c = p.cam.at(t - s.f0), d = caps[p.device].device.viewport;
        return p.map.box(c, { x: 0, y: 0, w: d.width, h: d.height });
      });
    },
    samplesHint(t) {
      const s = shotOf(t);
      const v = Math.max(...s.panels.map((p) => (p.cam.speed(t - s.f0) * p.rect.s) / fps));
      return v > 24 ? 16 : v > 7 ? 8 : 0;
    },
    draw(g, t) {
      const s = shotOf(t);
      const bleed = s.panels.length === 1 && s.panels[0].rect.bleed;
      if (card && t >= card.at + 0.45) { g.fillStyle = P.bg; g.fillRect(0, 0, W, H); drawCard(g, t); return; }
      if (!bleed) drawGround(g);
      else { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
      const clip = bleed && bandT > 0;
      if (clip) { g.save(); g.beginPath(); g.rect(0, bandT, W, H - bandT); g.clip(); }
      // every device's shadow first, then the devices: a shadow never lies over another phone
      for (const p of s.panels) drawPanel(g, s, p, t, true);
      for (const p of s.panels) drawPanel(g, s, p, t);
      if (clip) g.restore();
      if (bandT) drawBand(g);
      drawChip(g, s, t);
      drawCaptions(g, s, t);
      if (card) drawCard(g, t);
    },
  };
}
