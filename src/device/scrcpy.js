// scrcpy.js — our own Node client for the scrcpy server (no desktop client), so
// we get per-frame device PTS and can align injected input with video frames.
// Pure encoders/parsers + node:net sockets + an ffmpeg VFR->CFR bridge.
//
// PROTOCOL VERSION: the byte layouts below follow the scrcpy v2/v3 wire
// protocol (control message types 0..4 with the v2+ INJECT_TOUCH_EVENT layout
// of 32 bytes incl. u16 fixed-point pressure; video socket = [dummy byte]
// [64-byte device name] [codec id,w,h] then 12-byte packet headers with
// config/key flags in the top PTS bits). RISK: the lead MUST confirm these
// against the scrcpy-server v5.0 jar on the Mac mini — field layout/options
// may have drifted (server arg names, meta flags, new control types).
// Everything is isolated in this file so a fix is local.
//
// scrcpy 5.0 FACTS (observed on a test host,
// round 2): the server logs "Unknown server option: send_codec_meta", and the 12
// bytes after the 4-byte codec id are NOT width/height (observed "width" = 0x80000000). Read as a 5.0 session
// record = [u32 flags with bit 31 set][u32 width][u32 height]. The parser accepts both layouts: after the codec
// id it peeks the next u32 — bit 31 set → session record, else legacy w,h. A session record may also arrive
// between packets (display size change); it is told apart from a config packet header (exactly 1<<63, pts 0)
// by a non-zero low word. Touches must carry the VIDEO size (the server ignores mismatched ones).
import net from 'node:net';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { once } from 'node:events';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const CONTROL = { INJECT_KEYCODE: 0, INJECT_TEXT: 1, INJECT_TOUCH_EVENT: 2, INJECT_SCROLL_EVENT: 3, BACK_OR_SCREEN_ON: 4, SET_CLIPBOARD: 9 };
export const MOTION = { DOWN: 0, UP: 1, MOVE: 2 };
export const KEY = { DOWN: 0, UP: 1 };
export const KEYCODE = { BACK: 4, ENTER: 66, DEL: 67, TAB: 61, ESCAPE: 111 };
export const POINTER_ID_FINGER = 0n; // -1n = mouse, -2n = generic finger (avoid)

export function encodeTouch({ action, pointerId = POINTER_ID_FINGER, x, y, screenWidth, screenHeight, pressure = 1, actionButton = 0, buttons = 0 }) {
  const b = Buffer.alloc(32);
  b[0] = CONTROL.INJECT_TOUCH_EVENT;
  b[1] = action;
  b.writeBigInt64BE(BigInt(pointerId), 2);
  b.writeInt32BE(Math.round(x), 10);
  b.writeInt32BE(Math.round(y), 14);
  b.writeUInt16BE(screenWidth, 18);
  b.writeUInt16BE(screenHeight, 20);
  const p = Math.min(1, Math.max(0, pressure));
  b.writeUInt16BE(p >= 1 ? 0xffff : Math.round(p * 0xffff), 22);
  b.writeInt32BE(actionButton, 24);
  b.writeInt32BE(buttons, 28);
  return b;
}

export function encodeKeycode({ action, keycode, repeat = 0, metastate = 0 }) {
  const b = Buffer.alloc(14);
  b[0] = CONTROL.INJECT_KEYCODE;
  b[1] = action;
  b.writeInt32BE(keycode, 2);
  b.writeInt32BE(repeat, 6);
  b.writeInt32BE(metastate, 10);
  return b;
}

export function encodeText(text) {
  const t = Buffer.from(String(text), 'utf8');
  if (t.length > 300) throw new Error(`scrcpy INJECT_TEXT limit is 300 bytes (got ${t.length})`);
  const b = Buffer.alloc(5 + t.length);
  b[0] = CONTROL.INJECT_TEXT;
  b.writeUInt32BE(t.length, 1);
  t.copy(b, 5);
  return b;
}
export const asciiInjectable = (text) => /^[\x20-\x7e]*$/.test(String(text));

export const encodeBackOrScreenOn = (action) => Buffer.from([CONTROL.BACK_OR_SCREEN_ON, action]);
/** SET_CLIPBOARD (v2/v3 layout: [9][u64 sequence][u8 paste][u32 len][utf8]) with paste=1: types ANY text (æøå) into
 * the focused native field, which INJECT_TEXT cannot (it only maps chars of the virtual keyboard's keymap). */
export function encodeClipboard(text, { paste = true, sequence = 0n } = {}) {
  const b = Buffer.from(String(text), 'utf8');
  const h = Buffer.alloc(14);
  h[0] = CONTROL.SET_CLIPBOARD; h.writeBigUInt64BE(BigInt(sequence), 1); h[9] = paste ? 1 : 0; h.writeUInt32BE(b.length, 10);
  return Buffer.concat([h, b]);
}

// ---- server launch ----
export function serverArgs({ version, scid, video = true, audio = false, control = true, maxFps = 60, videoBitRate = 16000000, maxSize = 0, videoCodec = 'h264', videoCodecOptions, showTouches = false, stayAwake = true, logLevel = 'info' } = {}) {
  if (scid == null) throw new Error('serverArgs: scid required');
  const hex = Number(scid).toString(16).padStart(8, '0');
  const a = [
    `scid=${hex}`, `log_level=${logLevel}`,
    `video=${video}`, `audio=${audio}`, `control=${control}`,
    `video_codec=${videoCodec}`, `video_bit_rate=${videoBitRate}`, `max_fps=${maxFps}`, `max_size=${maxSize}`,
    'tunnel_forward=true', 'send_dummy_byte=true', 'send_device_meta=true', 'send_frame_meta=true',
    // 5.0 dropped this option (it logs "Unknown server option"); older servers need it
    ...(Number(String(version).split('.')[0]) >= 5 ? [] : ['send_codec_meta=true']),
    `show_touches=${showTouches}`, `stay_awake=${stayAwake}`,
    'cleanup=true', 'power_off_on_close=false', 'clipboard_autosync=false',
  ];
  if (videoCodecOptions) a.push(`video_codec_options=${videoCodecOptions}`);
  return a;
}
// the scrcpy server wants the version as the first positional arg
export function serverCommand({ jarPath = '/data/local/tmp/scrcpy-server.jar', ...args } = {}) {
  return ['CLASSPATH=' + jarPath, 'app_process', '/', 'com.genymobile.scrcpy.Server', args.version, ...serverArgs(args)];
}
export const socketName = (scid) => 'scrcpy_' + Number(scid).toString(16).padStart(8, '0');
export const randomScid = (rng = Math.random) => Math.floor(rng() * 0x7fffffff) & 0x7fffffff;

// ---- video socket parser ----
const CODECS = { 0x68323634: 'h264', 0x68323635: 'h265', 0x617631: 'av1' };
// media packet flags in the top bits of the PTS field. Legacy (<= 3.x): C K pts(62). Session layout (4.0+, scrcpy doc/develop.md):
// bit 63 = session packet (else media), then C K pts(61); measured on scrcpy 5.0: key frames carry bit 61, config bit 62.
const FLAGS = {
  legacy: { config: 1n << 63n, key: 1n << 62n, mask: (1n << 62n) - 1n },
  session: { config: 1n << 62n, key: 1n << 61n, mask: (1n << 61n) - 1n },
};
const now = () => performance.now() / 1000;

export class VideoStreamParser extends EventEmitter {
  constructor({ dummyByte = false, deviceMeta = true, codecMeta = true } = {}) {
    super();
    this.buf = Buffer.alloc(0);
    this.stage = dummyByte ? 'dummy' : deviceMeta ? 'name' : codecMeta ? 'codec' : 'header';
    this.deviceMeta = deviceMeta; this.codecMeta = codecMeta;
    this.meta = null; this.deviceName = '';
    this.hdr = null;
  }
  whenMeta() { return this.meta ? Promise.resolve(this.meta) : once(this, 'meta').then((a) => a[0]); }
  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    let off = 0;
    for (;;) {
      const rest = this.buf.length - off;
      if (this.stage === 'dummy') {
        if (rest < 1) break;
        off += 1; this.stage = this.deviceMeta ? 'name' : this.codecMeta ? 'codec' : 'header';
        this.emit('dummy');
      } else if (this.stage === 'name') {
        if (rest < 64) break;
        const raw = this.buf.subarray(off, off + 64); const z = raw.indexOf(0);
        this.deviceName = raw.subarray(0, z < 0 ? 64 : z).toString('utf8');
        off += 64; this.stage = this.codecMeta ? 'codec' : 'header';
      } else if (this.stage === 'codec') {
        if (rest < 8) break;
        const id = this.buf.readUInt32BE(off);
        const codec = CODECS[id] || `0x${id.toString(16)}`;
        if (this.buf.readUInt32BE(off + 4) & 0x80000000) { // scrcpy 5.0: codec id, then a session record
          if (rest < 16) break;
          this.meta = { deviceName: this.deviceName, codec, width: this.buf.readUInt32BE(off + 8), height: this.buf.readUInt32BE(off + 12), layout: 'session' };
          off += 16;
        } else {
          if (rest < 12) break;
          this.meta = { deviceName: this.deviceName, codec, width: this.buf.readUInt32BE(off + 4), height: this.buf.readUInt32BE(off + 8), layout: 'legacy' };
          off += 12;
        }
        this.stage = 'header';
        this.emit('meta', this.meta);
      } else if (this.stage === 'header') {
        if (rest < 12) break;
        const hi = this.buf.readUInt32BE(off), lo = this.buf.readUInt32BE(off + 4), sz = this.buf.readUInt32BE(off + 8);
        const layout = this.meta?.layout === 'session' ? 'session' : 'legacy';
        if (layout === 'session' && (hi & 0x80000000)) { // session record mid-stream (MSB set; low bit = client resize): new size
          off += 12;
          this.meta = { ...this.meta, width: lo, height: sz, layout: 'session' };
          this.emit('meta', this.meta); this.emit('resize', this.meta);
          continue;
        }
        const v = this.buf.readBigUInt64BE(off);
        const F = FLAGS[layout];
        this.hdr = { config: !!(v & F.config), key: !!(v & F.key), ptsUs: Number(v & F.mask), size: this.buf.readUInt32BE(off + 8) };
        off += 12; this.stage = 'body';
      } else { // body
        if (rest < this.hdr.size) break;
        const h = this.hdr;
        const data = Buffer.from(this.buf.subarray(off, off + h.size));
        off += h.size; this.stage = 'header';
        this.emit('packet', { config: h.config, key: h.key, ptsUs: h.config ? null : h.ptsUs, data, hostT: now() });
      }
    }
    this.buf = off >= this.buf.length ? Buffer.alloc(0) : this.buf.subarray(off);
  }
}

// ---- recording: raw Annex-B stream to disk + per-frame timing ----
export class Recording {
  constructor({ rawFile }) {
    this.rawFile = rawFile;
    this.ws = fs.createWriteStream(rawFile);
    this.frames = []; this.config = null;
  }
  add(p) {
    if (p.config) { this.config = p.data; this.ws.write(p.data); return; } // latest config precedes the frames after it
    this.ws.write(p.data);
    this.frames.push({ ptsUs: p.ptsUs, hostT: p.hostT, key: p.key });
  }
  async finish() {
    this.ws.end(); await once(this.ws, 'finish');
    return { rawFile: this.rawFile, frames: this.frames, firstPtsUs: this.frames.length ? this.frames[0].ptsUs : null };
  }
}

// hostT ≈ ptsUs/1e6 + offset; the MIN residual is the least-delayed frame (NTP-style).
export function estimateClockOffset(frames) {
  if (!frames.length) return { offset: 0, jitter: 0 };
  const r = frames.map((f) => f.hostT - f.ptsUs / 1e6).sort((a, b) => a - b);
  return { offset: r[0], jitter: r[Math.min(r.length - 1, Math.ceil(0.95 * r.length) - 1)] - r[0] };
}

// ---- VFR -> CFR ----
const exec = promisify(execFile);
async function probeSize(file) {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', '-f', 'h264', file]);
  const [w, h] = stdout.trim().split('x').map(Number);
  if (!w || !h) throw new Error('rawToCfr: cannot probe size of ' + file);
  return { width: w, height: h };
}

export async function rawToCfr({ rawFile, ptsUs, fps = 60, out, crf = 14, startUs = ptsUs[0], endUs = ptsUs[ptsUs.length - 1], preset = 'medium', width, height }) {
  if (!ptsUs.length) throw new Error('rawToCfr: no frames');
  if (!width || !height) ({ width, height } = await probeSize(rawFile));
  const N = Math.floor((endUs - startUs) * fps / 1e6 + 1e-9) + 1; // output frames: slots at startUs + i/fps, i in [0,N)
  const slot = (p) => Math.ceil((p - startUs) * fps / 1e6 - 1e-9); // first output slot with time >= p
  const fsz = width * height * 3 / 2;
  const dec = spawn('ffmpeg', ['-v', 'error', '-threads', '2', '-f', 'h264', '-i', rawFile, '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-fps_mode', 'passthrough', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const enc = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${width}x${height}`, '-r', String(fps), '-i', 'pipe:0',
    '-c:v', 'libx264', '-threads', '2', '-preset', preset, '-crf', String(crf), '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', out], { stdio: ['pipe', 'ignore', 'pipe'] });
  let errs = '';
  dec.stderr.on('data', (d) => { errs += d; }); enc.stderr.on('data', (d) => { errs += d; });
  const decExit = once(dec, 'close'), encExit = once(enc, 'close');
  enc.stdin.on('error', () => {});
  let j = 0, written = 0, duplicated = 0, dropped = 0, acc = [], accLen = 0, lastFb = null, padded = 0;
  try {
    for await (const chunk of dec.stdout) {
      acc.push(chunk); accLen += chunk.length;
      while (accLen >= fsz) {
        const all = acc.length === 1 ? acc[0] : Buffer.concat(acc);
        const frame = all.subarray(0, fsz); const rem = all.subarray(fsz);
        acc = rem.length ? [rem] : []; accLen = rem.length;
        if (j >= ptsUs.length) throw new Error('rawToCfr: decoded more frames than ptsUs.length');
        const lo = j === 0 ? 0 : Math.max(0, slot(ptsUs[j]));
        const hi = Math.min(N - 1, j + 1 < ptsUs.length ? slot(ptsUs[j + 1]) - 1 : N - 1);
        const n = hi - lo + 1;
        if (n <= 0) dropped++;
        else {
          duplicated += n - 1;
          const fb = Buffer.from(frame); // detach from the shared chunk
          lastFb = fb;
          for (let k = 0; k < n; k++) { written++; if (!enc.stdin.write(fb)) await once(enc.stdin, 'drain'); }
        }
        j++;
      }
    }
    // stopping the recorder can cut the final access unit mid-write: the decoder then yields 1–2 frames fewer than
    // the PTS log. Hold the last good frame to the end of the timeline instead of throwing away the whole take.
    if (j < ptsUs.length && ptsUs.length - j <= 2 && lastFb) {
      while (written < N) { written++; padded++; if (!enc.stdin.write(lastFb)) await once(enc.stdin, 'drain'); }
      j = ptsUs.length;
    }
    enc.stdin.end();
  } catch (e) { dec.kill('SIGKILL'); enc.kill('SIGKILL'); throw e; }
  const [dc] = await decExit; const [ec] = await encExit;
  if (dc !== 0) throw new Error('rawToCfr: decoder failed: ' + errs.trim());
  if (j !== ptsUs.length) throw new Error(`rawToCfr: decoded ${j} frames but ptsUs has ${ptsUs.length}`);
  if (ec !== 0) throw new Error('rawToCfr: encoder failed: ' + errs.trim());
  return { out, frames: written, duplicated, dropped, padded, width, height };
}

// ---- control socket ----
export class ScrcpyControl {
  constructor(socket, screen = null) {
    this.socket = socket; this.screen = screen;
    socket.setNoDelay(true);
    socket.on('data', () => {}); // device->client messages (clipboard etc.) are ignored
    socket.on('error', () => {});
  }
  send(buf) { return this.socket.write(buf); }
  touch(action, x, y, pressure = action === MOTION.UP ? 0 : 1, pointerId = POINTER_ID_FINGER) {
    if (!this.screen) throw new Error('ScrcpyControl.screen not set (wait for video meta)');
    return this.send(encodeTouch({ action, pointerId, x, y, screenWidth: this.screen.width, screenHeight: this.screen.height, pressure }));
  }
  key(action, keycode) { return this.send(encodeKeycode({ action, keycode })); }
  text(str) { return this.send(encodeText(str)); }
  backOrScreenOn(action) { return this.send(encodeBackOrScreenOn(action)); }
  paste(str) { return this.send(encodeClipboard(str)); }
}

function connectOnce(port, host) {
  return new Promise((resolve, reject) => {
    const s = net.connect({ port, host });
    s.once('connect', () => { s.removeListener('error', reject); resolve(s); });
    s.once('error', reject);
  });
}

// Forward-tunnel session. adb's forward port accepts TCP even when the server
// is not up yet (then closes at once), so each attempt = connect + wait for the
// dummy byte; failure before it -> retry every 100 ms.
export async function connectSession({ port, host = '127.0.0.1', video = true, control = true, dummyByte = true, timeoutMs = 10000, retry = 50 }) {
  const parser = new VideoStreamParser({ dummyByte, deviceMeta: video, codecMeta: video });
  let first = null, lastErr;
  for (let i = 0; i < retry && !first; i++) {
    let s;
    try { s = await connectOnce(port, host); } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 100)); continue; }
    if (!dummyByte) { first = s; break; }
    const ok = await new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), timeoutMs);
      const onDummy = () => done(true);
      const done = (v) => { clearTimeout(t); s.removeAllListeners('close'); s.removeAllListeners('error'); parser.removeListener('dummy', onDummy); resolve(v); };
      s.once('close', () => done(false)); s.once('error', () => done(false));
      if (video) { parser.once('dummy', onDummy); s.on('data', (d) => parser.push(d)); }
      else s.once('data', () => done(true)); // control-only: first byte is the dummy
    });
    if (ok) { first = s; if (!video) s.on('data', () => {}); }
    else { s.destroy(); lastErr = new Error('server closed before dummy byte'); parser.buf = Buffer.alloc(0); parser.stage = 'dummy'; await new Promise((r) => setTimeout(r, 100)); }
  }
  if (!first) throw new Error(`scrcpy connect failed on port ${port}: ${lastErr?.message || 'timeout'}`);
  if (video && !dummyByte) first.on('data', (d) => parser.push(d));
  first.on('error', () => {});
  let ctl = null, ctlSock = null;
  if (control) {
    ctlSock = video ? await connectOnce(port, host) : first;
    ctl = new ScrcpyControl(ctlSock);
    if (video) parser.whenMeta().then((m) => { ctl.screen = { width: m.width, height: m.height }; });
  }
  return {
    parser, videoSocket: video ? first : null, control: ctl,
    close() { for (const s of new Set([first, ctlSock])) if (s) s.destroy(); },
  };
}
