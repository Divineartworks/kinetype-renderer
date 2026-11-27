// Validate a capture document / directory against contract C2 (kinetype.capture.v1).
import fs from 'node:fs';
import path from 'node:path';

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const EVENT_TYPES = new Set(['click', 'hover', 'move', 'type', 'fill', 'press', 'scroll', 'navigate', 'observe']);
// C2 v2: native device recordings — clock "wall", video only (no frames/ dir), vbox/vpoint in video px.
const DEVICE_EVENT_TYPES = new Set([...EVENT_TYPES, 'swipe', 'fling', 'back', 'keyboard', 'sync', 'refresh']);
const vboxOk = (b, W, H) => b && num(b.x) && num(b.y) && b.w >= 0 && b.h >= 0 && b.x >= -2 && b.y >= -2 && b.x + b.w <= W + 2 && b.y + b.h <= H + 2;
// a tracked element that is scrolling off (or onto) the screen is partly outside the video: it only has to overlap it
const vboxOverlaps = (b, W, H) => b && num(b.x) && num(b.y) && b.w >= 0 && b.h >= 0 && b.x < W && b.y < H && b.x + b.w > 0 && b.y + b.h > 0;
const ranges = (a) => Array.isArray(a) && a.every((r) => (Array.isArray(r) ? num(r[0]) && num(r[1]) && r[1] >= r[0] : r && num(r.t0) && num(r.t1) && r.t1 >= r.t0));

export function validateCaptureDoc(c, { dir = null } = {}) {
  const p = [];
  const need = (cond, msg) => { if (!cond) p.push(msg); };
  need(c && c.schema === 'kinetype.capture.v1', 'schema must be "kinetype.capture.v1"');
  if (!c || typeof c !== 'object') return p;
  if (c.clock === 'wall') return validateWallCapture(c, { dir, p, need });
  need(typeof c.flow === 'string' && c.flow, 'flow (name) missing');
  need(c.app && c.app.name && c.app.baseUrl, 'app.name/app.baseUrl missing');
  need(c.device && ['desktop', 'phone'].includes(c.device.kind) && c.device.viewport && num(c.device.viewport.width) && num(c.device.viewport.height) && num(c.device.deviceScaleFactor), 'device.kind/viewport/deviceScaleFactor invalid');
  need(Number.isInteger(c.fps) && c.fps > 0, 'fps must be a positive integer');
  need(num(c.duration) && c.duration > 0, 'duration missing');
  const f = c.frames || {};
  need(f.dir && f.pattern && Number.isInteger(f.count) && f.count > 0 && f.width > 0 && f.height > 0, 'frames{dir,pattern,count,width,height} invalid');
  if (num(c.duration) && Number.isInteger(f.count) && c.fps) need(Math.abs(f.count / c.fps - c.duration) < 1 / c.fps + 1e-6, `duration ${c.duration} != frames.count/fps (${(f.count / c.fps).toFixed(4)})`);
  if (c.device?.viewport && f.width) need(f.width === Math.round(c.device.viewport.width * c.device.deviceScaleFactor) && f.height === Math.round(c.device.viewport.height * c.device.deviceScaleFactor), 'frames width/height must equal viewport * deviceScaleFactor');
  need(c.video && c.video.src && c.video.codec === 'h264', 'video{src,codec:h264} missing');
  need(Array.isArray(c.events) && Array.isArray(c.marks) && Array.isArray(c.steps), 'events/marks/steps must be arrays');
  if (p.length) return p;
  const stepIds = new Set();
  let prevT = -1;
  for (const [i, s] of c.steps.entries()) {
    need(s.id && num(s.t0) && num(s.t1) && s.t1 >= s.t0 && s.t0 >= 0 && s.t1 <= c.duration + 1e-6, `steps[${i}] needs id and 0<=t0<=t1<=duration`);
    need(!stepIds.has(s.id), `steps[${i}] duplicate id ${s.id}`);
    stepIds.add(s.id);
  }
  for (const [i, m] of c.marks.entries()) {
    need(m.id && num(m.t) && m.t >= 0 && m.t <= c.duration + 1e-6, `marks[${i}] needs id and t within duration`);
    need(stepIds.has(m.id), `marks[${i}] "${m.id}" has no matching step`);
  }
  const vw = c.device.viewport.width, vh = c.device.viewport.height;
  for (const [i, e] of c.events.entries()) {
    need(EVENT_TYPES.has(e.type), `events[${i}] unknown type ${e.type}`);
    need(num(e.t) && e.t >= prevT - 1e-9 && e.t <= c.duration + 1e-6, `events[${i}] t out of order/range`);
    prevT = Math.max(prevT, e.t);
    if (e.step) need(stepIds.has(e.step), `events[${i}] step "${e.step}" unknown`);
    if (e.point) need(num(e.point.x) && num(e.point.y) && e.point.x >= -1 && e.point.x <= vw + 1 && e.point.y >= -1 && e.point.y <= vh + 1, `events[${i}] point outside the viewport (CSS px)`);
    if (e.box) need(num(e.box.x) && num(e.box.y) && e.box.w >= 0 && e.box.h >= 0, `events[${i}] box invalid`);
    if (e.type === 'click') need(e.point && e.box, `events[${i}] click needs point and box`);
    if (e.type === 'type') need(num(e.t1) && e.t1 >= e.t && typeof e.text === 'string', `events[${i}] type needs text and t1>=t`);
    if (e.type === 'scroll') need(num(e.from) && num(e.to), `events[${i}] scroll needs from/to`);
    if (e.type === 'navigate') need(typeof e.url === 'string', `events[${i}] navigate needs url`);
    if (e.type === 'observe') need(e.box, `events[${i}] observe needs box`);
    if (e.track !== undefined) {
      // target track (additive to C2): [{t, box?, visible}] on change, closed by trackEnd
      const tr = e.track;
      need(Array.isArray(tr) && tr.length > 0 && e.box, `events[${i}] track must be a non-empty array on a boxed event`);
      need(num(e.trackEnd) && e.trackEnd <= c.duration + 1e-6, `events[${i}] track needs trackEnd within duration`);
      if (Array.isArray(tr)) {
        let pt = -1;
        for (const [k, x] of tr.entries()) {
          need(x && num(x.t) && x.t > pt - 1e-9 && x.t >= 0 && (!num(e.trackEnd) || x.t <= e.trackEnd + 1e-6), `events[${i}].track[${k}] t out of order/range`);
          need(typeof x?.visible === 'boolean', `events[${i}].track[${k}] visible must be boolean`);
          if (x?.visible) need(x.box, `events[${i}].track[${k}] a visible entry needs its box`);
          if (x?.box) need(num(x.box.x) && num(x.box.y) && x.box.w >= 0 && x.box.h >= 0, `events[${i}].track[${k}] box invalid`);
          pt = x?.t ?? pt;
        }
      }
    }
  }
  if (dir) {
    const first = path.join(dir, f.dir, f.pattern.replace('%06d', '000000'));
    const last = path.join(dir, f.dir, f.pattern.replace('%06d', String(f.count - 1).padStart(6, '0')));
    need(fs.existsSync(first), `first frame missing (${first})`);
    need(fs.existsSync(last), `last frame missing (${last})`);
    need(!fs.existsSync(path.join(dir, f.dir, f.pattern.replace('%06d', String(f.count).padStart(6, '0')))), 'more frames on disk than frames.count');
    need(fs.existsSync(path.join(dir, c.video.src)), `video missing (${c.video.src})`);
    need(fs.existsSync(path.join(dir, 'receipt.json')), 'receipt.json missing');
  }
  return p;
}

function validateWallCapture(c, { dir, p, need }) {
  need(typeof c.flow === 'string' && c.flow, 'flow (name) missing');
  need(c.app && c.app.name && (c.app.baseUrl || c.app.native === true), 'app.name and app.baseUrl (or app.native: true for a native-only flow) missing');
  need(c.device && c.device.kind === 'android' && c.device.screen && num(c.device.screen.width) && num(c.device.screen.height), 'device.kind must be "android" with screen{width,height} (video px)');
  need(Number.isInteger(c.fps) && c.fps > 0, 'fps must be a positive integer');
  need(num(c.duration) && c.duration > 0, 'duration missing');
  const v = c.video || {};
  need(v.src && v.codec === 'h264' && v.fps === c.fps && num(v.width) && num(v.height), 'video{src,codec:h264,fps,width,height} invalid');
  need(c.device?.screen && v.width === c.device.screen.width && v.height === c.device.screen.height, 'video size must equal device.screen (native resolution)');
  need(num(c.sessionOffset), 'sessionOffset (s from the session clock zero to video frame 0) missing');
  need(ranges(c.idle) && ranges(c.busy), 'idle/busy must be arrays of [t0,t1] or {t0,t1}');
  need(Array.isArray(c.events) && Array.isArray(c.marks) && Array.isArray(c.steps), 'events/marks/steps must be arrays');
  if (p.length) return p;
  const W = v.width, H = v.height;
  const stepIds = new Set();
  for (const [i, s] of c.steps.entries()) {
    need(s.id && num(s.t0) && num(s.t1) && s.t1 >= s.t0 && s.t0 >= 0 && s.t1 <= c.duration + 1e-6, `steps[${i}] needs id and 0<=t0<=t1<=duration`);
    need(!stepIds.has(s.id), `steps[${i}] duplicate id ${s.id}`);
    stepIds.add(s.id);
  }
  for (const [i, m] of c.marks.entries()) need(m.id && num(m.t) && m.t >= 0 && m.t <= c.duration + 1e-6 && stepIds.has(m.id), `marks[${i}] needs a step id and t within duration`);
  let prevT = -1;
  for (const [i, e] of c.events.entries()) {
    need(DEVICE_EVENT_TYPES.has(e.type), `events[${i}] unknown type ${e.type}`);
    need(num(e.t) && e.t >= prevT - 1e-9 && e.t <= c.duration + 1e-6, `events[${i}] t out of order/range`);
    prevT = Math.max(prevT, e.t);
    if (e.step) need(stepIds.has(e.step), `events[${i}] step "${e.step}" unknown`);
    // every located event carries both spaces: CSS px of the page and video px of the recording
    if (e.box) need(e.vbox && num(e.vbox.x) && num(e.vbox.y) && e.vbox.w >= 0 && e.vbox.h >= 0 && e.mapping && num(e.mapping.s) && num(e.mapping.ox) && num(e.mapping.oy), `events[${i}] box needs vbox and mapping{s,ox,oy}`);
    if (e.point) need(e.vpoint && num(e.vpoint.x) && num(e.vpoint.y) && e.vpoint.x >= -1 && e.vpoint.x <= W + 1 && e.vpoint.y >= -1 && e.vpoint.y <= H + 1, `events[${i}] point needs vpoint inside the video`);
    if (e.type === 'click') need(e.space === 'os' ? e.vpoint && e.vbox : e.point && e.box, `events[${i}] click needs point and box (native: vpoint and vbox)`);
    if (e.space === 'os') need(vboxOk(e.vbox, W, H), `events[${i}] native (os) event needs a vbox inside the video`);
    if (e.type === 'type') need(num(e.t1) && e.t1 >= e.t && typeof e.text === 'string', `events[${i}] type needs text and t1>=t`);
    if (e.type === 'scroll') need(num(e.from) && num(e.to), `events[${i}] scroll needs from/to`);
    if (e.type === 'swipe' || e.type === 'fling') need(Array.isArray(e.vpath) && e.vpath.length >= 2 && e.scroll && num(e.scroll.from) && num(e.scroll.to), `events[${i}] ${e.type} needs vpath and scroll{from,to}`);
    if (e.type === 'navigate') need(typeof e.url === 'string', `events[${i}] navigate needs url`);
    if (e.track !== undefined) {
      need(Array.isArray(e.track) && e.track.length > 0 && num(e.trackEnd) && e.trackEnd <= c.duration + 1e-6, `events[${i}] track needs entries and trackEnd within duration`);
      let pt = -1;
      for (const [k, x] of (e.track || []).entries()) {
        need(x && num(x.t) && x.t >= pt - 1e-9 && typeof x.visible === 'boolean' && (!x.visible || (x.box && vboxOverlaps(x.vbox, W, H))), `events[${i}].track[${k}] needs t (ordered), visible, and box+vbox when visible`);
        pt = x?.t ?? pt;
      }
    }
  }
  if (dir) {
    need(fs.existsSync(path.join(dir, v.src)), `video missing (${v.src})`);
    need(fs.existsSync(path.join(dir, 'receipt.json')), 'receipt.json missing');
  }
  return p;
}

export function validateCaptureFile(file) {
  const abs = path.resolve(file);
  const doc = JSON.parse(fs.readFileSync(abs, 'utf8'));
  return { file: abs, problems: validateCaptureDoc(doc, { dir: path.dirname(abs) }), doc };
}
