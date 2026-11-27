import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import {
  CONTROL, MOTION, KEY, KEYCODE, encodeTouch, encodeKeycode, encodeText, asciiInjectable, encodeBackOrScreenOn,
  serverArgs, serverCommand, socketName, randomScid, VideoStreamParser, Recording, estimateClockOffset, rawToCfr, connectSession,
} from '../src/device/scrcpy.js';
import * as A from '../src/device/adb.js';

const TMP = '/tmp/device-scrcpy';
fs.mkdirSync(TMP, { recursive: true });
const hex = (b) => b.toString('hex');
const has = (bin) => { try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } };

test('encodeTouch byte-exact', () => {
  assert.equal(hex(encodeTouch({ action: MOTION.DOWN, x: 540, y: 1200, screenWidth: 1080, screenHeight: 2400, pressure: 1 })),
    '02' + '00' + '0000000000000000' + '0000021c' + '000004b0' + '0438' + '0960' + 'ffff' + '00000000' + '00000000');
  assert.equal(hex(encodeTouch({ action: MOTION.UP, x: 540, y: 1200, screenWidth: 1080, screenHeight: 2400, pressure: 0 })),
    '02' + '01' + '0000000000000000' + '0000021c' + '000004b0' + '0438' + '0960' + '0000' + '00000000' + '00000000');
  assert.equal(encodeTouch({ action: 2, x: 1.4, y: 2.6, screenWidth: 10, screenHeight: 10, pressure: 0.5, pointerId: -2n }).readBigInt64BE(2), -2n);
  assert.equal(encodeTouch({ action: 2, x: 1, y: 2, screenWidth: 10, screenHeight: 10, pressure: 0.5 }).readUInt16BE(22), 0x8000);
  assert.equal(encodeTouch({ action: 2, x: 1.4, y: 2.6, screenWidth: 10, screenHeight: 10 }).readInt32BE(14), 3);
  assert.equal(CONTROL.INJECT_TOUCH_EVENT, 2);
});

test('keycode / text / back-or-screen-on encoders', () => {
  assert.equal(hex(encodeKeycode({ action: KEY.DOWN, keycode: KEYCODE.BACK })), '0000' + '00000004' + '00000000' + '00000000');
  assert.equal(encodeKeycode({ action: KEY.UP, keycode: KEYCODE.ENTER, repeat: 1, metastate: 0x1000 }).readInt32BE(10), 0x1000);
  assert.equal(hex(encodeText('Hei')), '01' + '00000003' + '486569');
  assert.throws(() => encodeText('x'.repeat(301)), /300/);
  assert.equal(encodeText('x'.repeat(300)).length, 305);
  assert.equal(hex(encodeBackOrScreenOn(0)), '0400');
  assert.equal(asciiInjectable('Hansen VVS'), true);
  assert.equal(asciiInjectable('Bjørn'), false);
});

test('serverArgs / serverCommand / socketName', () => {
  const a = serverArgs({ version: '5.0', scid: 0x1a2b });
  for (const s of ['scid=00001a2b', 'tunnel_forward=true', 'send_dummy_byte=true', 'send_device_meta=true', 'send_frame_meta=true',
    'cleanup=true', 'power_off_on_close=false', 'clipboard_autosync=false', 'max_fps=60', 'video_bit_rate=16000000', 'audio=false', 'control=true', 'video_codec=h264', 'max_size=0'])
    assert.ok(a.includes(s), s);
  assert.ok(!a.some((s) => s.startsWith('video_codec_options')));
  assert.ok(!a.includes('send_codec_meta=true'), '5.0 dropped send_codec_meta');
  assert.ok(serverArgs({ version: '3.3.1', scid: 1 }).includes('send_codec_meta=true'));
  assert.ok(serverArgs({ version: '5.0', scid: 1, videoCodecOptions: 'a=b' }).includes('video_codec_options=a=b'));
  const c = serverCommand({ version: '5.0', scid: 1 });
  assert.deepEqual(c.slice(0, 5), ['CLASSPATH=/data/local/tmp/scrcpy-server.jar', 'app_process', '/', 'com.genymobile.scrcpy.Server', '5.0']);
  assert.equal(c[5], 'scid=00000001');
  assert.equal(socketName(0xabc), 'scrcpy_00000abc');
  const s1 = randomScid(() => 0.5);
  assert.equal(s1, randomScid(() => 0.5));
  assert.ok(s1 > 0 && s1 < 0x80000000);
});

function lcg(seed) { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32; }
function pkt(ptsUs, data, { config = false, key = false, session = false } = {}) {
  const h = Buffer.alloc(12);
  // legacy: C=63 K=62; session layout (scrcpy 4.0+): bit 63 = session packet, C=62 K=61
  let v = BigInt(ptsUs); if (config) v |= session ? 1n << 62n : 1n << 63n; if (key) v |= session ? 1n << 61n : 1n << 62n;
  h.writeBigUInt64BE(v, 0); h.writeUInt32BE(data.length, 8);
  return Buffer.concat([h, data]);
}
function metaBytes(w, h, name = 'Pixel_8_API_35') {
  const n = Buffer.alloc(64); n.write(name);
  const c = Buffer.alloc(12); c.writeUInt32BE(0x68323634, 0); c.writeUInt32BE(w, 4); c.writeUInt32BE(h, 8);
  return Buffer.concat([n, c]);
}

test('VideoStreamParser handles arbitrary chunk boundaries', () => {
  const frames = [[0, true], [16667, false], [33400, false], [50100, false], [400000, true]];
  const stream = Buffer.concat([Buffer.from([0]), metaBytes(1080, 2400), pkt(0, Buffer.from('SPSPPS'), { config: true }),
    ...frames.map(([p, k], i) => pkt(p, Buffer.from(`frame${i}`), { key: k }))]);
  for (const step of [1, 2, 3, 5, 7, 1000]) {
    const ps = new VideoStreamParser({ dummyByte: true }); const metas = [], pk = []; let dummy = 0;
    ps.on('meta', (m) => metas.push(m)); ps.on('packet', (p) => pk.push(p)); ps.on('dummy', () => dummy++);
    for (let i = 0; i < stream.length; i += step) ps.push(stream.subarray(i, i + step));
    assert.equal(dummy, 1);
    assert.deepEqual(metas, [{ deviceName: 'Pixel_8_API_35', codec: 'h264', width: 1080, height: 2400, layout: 'legacy' }]);
    assert.equal(pk.length, 6);
    assert.equal(pk[0].config, true); assert.equal(pk[0].ptsUs, null); assert.equal(pk[0].data.toString(), 'SPSPPS');
    pk.slice(1).forEach((p, i) => {
      assert.equal(p.config, false); assert.equal(p.ptsUs, frames[i][0]); assert.equal(p.key, frames[i][1]);
      assert.equal(p.data.toString(), `frame${i}`); assert.equal(typeof p.hostT, 'number');
    });
  }
  // random chunking
  const r = lcg(7); const ps = new VideoStreamParser({ dummyByte: true }); let n = 0;
  ps.on('packet', () => n++);
  for (let i = 0; i < stream.length;) { const k = 1 + Math.floor(r() * 7); ps.push(stream.subarray(i, i + k)); i += k; }
  assert.equal(n, 6);
});

test('VideoStreamParser: scrcpy 5.0 layout — codec id + session record, and a mid-stream resize', () => {
  const u32 = (...v) => { const b = Buffer.alloc(4 * v.length); v.forEach((x, i) => b.writeUInt32BE(x >>> 0, 4 * i)); return b; };
  const name = Buffer.alloc(64); name.write('phone1');
  const stream = Buffer.concat([Buffer.from([0]), name, u32(0x68323634), u32(0x80000000, 1080, 2400), pkt(0, Buffer.from('SPSPPS'), { config: true, session: true }),
    pkt(1000, Buffer.from('f0'), { key: true, session: true }), u32(0x80000001, 2400, 1080), pkt(2000, Buffer.from('f1'), { session: true }),
    pkt(4503599627370495, Buffer.from('f2'), { session: true })]);
  for (const step of [1, 3, 1000]) {
    const ps = new VideoStreamParser({ dummyByte: true }); const metas = [], pk = [], rs = [];
    ps.on('meta', (m) => metas.push(m)); ps.on('packet', (p) => pk.push(p)); ps.on('resize', (m) => rs.push(m));
    for (let i = 0; i < stream.length; i += step) ps.push(stream.subarray(i, i + step));
    assert.deepEqual(metas[0], { deviceName: 'phone1', codec: 'h264', width: 1080, height: 2400, layout: 'session' });
    assert.deepEqual(rs.map((m) => [m.width, m.height]), [[2400, 1080]]);
    assert.deepEqual(pk.map((p) => [p.config, p.key, p.ptsUs, p.data.toString()]), [[true, false, null, 'SPSPPS'], [false, true, 1000, 'f0'], [false, false, 2000, 'f1'], [false, false, 4503599627370495, 'f2']]);
  }
});

test('estimateClockOffset recovers offset within jitter', () => {
  const r = lcg(3); const off = 1234.5;
  const frames = Array.from({ length: 200 }, (_, i) => ({ ptsUs: i * 16667, hostT: i * 16667 / 1e6 + off + (i === 50 ? 0 : 0.002 + r() * 0.01), key: false }));
  frames[50].hostT = 50 * 16667 / 1e6 + off; // least delayed
  const { offset, jitter } = estimateClockOffset(frames);
  assert.ok(Math.abs(offset - off) < 1e-9);
  assert.ok(jitter > 0.005 && jitter < 0.012, String(jitter));
  assert.deepEqual(estimateClockOffset([]), { offset: 0, jitter: 0 });
});

const ffOk = has('ffmpeg') && has('ffprobe');
function splitAUs(raw) {
  const aud = Buffer.from([0, 0, 0, 1, 9]); const idx = [];
  for (let i = raw.indexOf(aud); i >= 0; i = raw.indexOf(aud, i + 1)) idx.push(i);
  return idx.map((s, k) => raw.subarray(s, idx[k + 1] ?? raw.length));
}
function headLen(au) { // bytes before the first slice NAL (AUD/SPS/PPS/SEI) = what scrcpy sends as the config packet
  const sc = Buffer.from([0, 0, 0, 1]);
  for (let i = au.indexOf(sc); i >= 0; i = au.indexOf(sc, i + 1)) if ([1, 5].includes(au[i + 4] & 31)) return i;
  return 0;
}

test('end-to-end: scrcpy packets -> Recording -> CFR 60 mp4', { skip: !ffOk && 'ffmpeg missing' }, async () => {
  const raw = `${TMP}/src.h264`;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-threads', '2', '-f', 'lavfi', '-i', 'testsrc2=size=320x640:rate=30', '-t', '2', '-c:v', 'libx264', '-bf', '0',
    '-x264-params', 'aud=1:keyint=30', '-f', 'h264', raw]);
  const aus = splitAUs(fs.readFileSync(raw));
  assert.equal(aus.length, 60);
  let t = 5_000_000; const pts = []; // irregular 25..40 ms, plus a 300 ms gap
  aus.forEach((_, i) => { pts.push(t); t += i === 30 ? 300000 : 25000 + ((i * 7) % 16) * 1000; });
  const stream = Buffer.concat([Buffer.from([0]), metaBytes(320, 640), pkt(0, aus[0].subarray(0, headLen(aus[0])), { config: true }),
    ...aus.map((au, i) => pkt(pts[i], i ? au : au.subarray(headLen(au)), { key: i % 30 === 0 }))]);
  const rec = new Recording({ rawFile: `${TMP}/rec.h264` }); const ps = new VideoStreamParser({ dummyByte: true });
  ps.on('packet', (p) => rec.add(p));
  for (let i = 0; i < stream.length; i += 997) ps.push(stream.subarray(i, i + 997));
  const { rawFile, frames, firstPtsUs } = await rec.finish();
  assert.equal(frames.length, 60); assert.equal(firstPtsUs, pts[0]);
  const out = `${TMP}/cfr.mp4`;
  const r = await rawToCfr({ rawFile, ptsUs: frames.map((f) => f.ptsUs), fps: 60, out, crf: 20, preset: 'ultrafast' });
  assert.equal(r.width, 320); assert.equal(r.height, 640);
  const dur = pts[59] - pts[0];
  const expected = Math.floor(dur * 60 / 1e6) + 1;
  assert.equal(r.frames, expected);
  assert.equal(r.frames, 60 - r.dropped + r.duplicated);
  assert.ok(r.duplicated >= 15, `gap should be filled by duplicates (${r.duplicated})`);
  const pr = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames,width,height,r_frame_rate,pix_fmt,color_space', '-of', 'json', out]));
  const s = pr.streams[0];
  assert.equal(+s.nb_read_frames, expected);
  assert.equal(s.r_frame_rate, '60/1'); assert.equal(s.width, 320); assert.equal(s.height, 640); assert.equal(s.pix_fmt, 'yuv420p');
  assert.equal(s.color_space, 'bt709');
  // wrong pts count must be detected
  await assert.rejects(rawToCfr({ rawFile, ptsUs: frames.slice(1).map((f) => f.ptsUs), out: `${TMP}/bad.mp4`, preset: 'ultrafast' }), /decoded|ptsUs/);
});

test('connectSession over a loopback fake scrcpy server', async () => {
  const got = []; let conns = 0; let resolveCtl;
  const ctlBytes = new Promise((r) => { resolveCtl = r; });
  const srv = net.createServer((s) => {
    conns++;
    if (conns === 1) {
      s.write(Buffer.from([0]));
      s.write(Buffer.concat([metaBytes(1080, 2400), pkt(0, Buffer.from('cfg'), { config: true }), pkt(1000, Buffer.from('f0'), { key: true })]));
    } else s.on('data', (d) => { got.push(d); if (Buffer.concat(got).length >= 32) resolveCtl(Buffer.concat(got)); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const sess = await connectSession({ port: srv.address().port, timeoutMs: 3000 });
  try {
    const pk = []; sess.parser.on('packet', (p) => pk.push(p));
    const meta = await sess.parser.whenMeta();
    assert.equal(meta.width, 1080);
    sess.control.touch(MOTION.DOWN, 540, 1200, 1);
    const bytes = await ctlBytes;
    assert.equal(hex(bytes), hex(encodeTouch({ action: 0, x: 540, y: 1200, screenWidth: 1080, screenHeight: 2400, pressure: 1 })));
    assert.equal(bytes.length, 32);
  } finally { sess.close(); srv.close(); }
});

test('adb argv building and parsers', () => {
  const save = { ...process.env };
  try {
    delete process.env.ADB_SERVER_SOCKET; delete process.env.KINETYPE_ADB;
    assert.equal(A.adbBin(), 'adb'); assert.deepEqual(A.adbBase({}), []);
    assert.deepEqual(A.adbBase({ serial: 'emulator-5554' }), ['-s', 'emulator-5554']);
    process.env.ADB_SERVER_SOCKET = 'tcp:10.0.0.5:5037'; process.env.KINETYPE_ADB = '/x/adb';
    assert.equal(A.adbBin(), '/x/adb');
    assert.deepEqual(A.adbBase({ serial: 'S1' }), ['-L', 'tcp:10.0.0.5:5037', '-s', 'S1']);
  } finally { process.env = save; }
  assert.deepEqual(A.textArgs('a b'), ['input', 'text', 'a%sb']);
  assert.deepEqual(A.textArgs('x&y;(z)'), ['input', 'text', 'x\\&y\\;\\(z\\)']);
  assert.deepEqual(A.tapArgs(10.4, 20.6), ['input', 'tap', '10', '21']);
  assert.deepEqual(A.swipeArgs(1, 2, 3, 4, 250), ['input', 'swipe', '1', '2', '3', '4', '250']);
  assert.deepEqual(A.keyeventArgs(4), ['input', 'keyevent', '4']);
  assert.deepEqual(A.motionArgs('MOVE', 5, 6), ['input', 'motionevent', 'MOVE', '5', '6']);
  assert.deepEqual(A.parseDevices('List of devices attached\nemulator-5554\tdevice\nABC123\tunauthorized\n\n'), [{ serial: 'emulator-5554', state: 'device' }, { serial: 'ABC123', state: 'unauthorized' }]);
  assert.deepEqual(A.parseDevices('* daemon started successfully\nList of devices attached\n'), []);
  assert.deepEqual(A.parseWmSize('Physical size: 1080x2400\n'), { width: 1080, height: 2400, physical: { width: 1080, height: 2400 }, override: null });
  assert.equal(A.parseWmSize('Physical size: 1080x2400\nOverride size: 720x1600\n').width, 720);
  assert.equal(A.parseWmSize('nope'), null);
  assert.equal(A.parseDensity('Physical density: 420\n'), 420);
  assert.equal(A.parseDensity('Physical density: 420\nOverride density: 320\n'), 320);
  assert.equal(A.parseStatusBarHeight('InsetsSource: type=statusBars frame=[0,0][1080,118] visible=true'), 118);
  assert.equal(A.parseStatusBarHeight('nothing'), null);
});

test('adb() against a fake adb script', async () => {
  const fake = `${TMP}/fake-adb.mjs`;
  fs.writeFileSync(fake, `#!/usr/bin/env node
const a = process.argv.slice(2);
if (a.includes('fail')) { process.stderr.write('boom'); process.exit(3); }
if (a.includes('bin')) { process.stdout.write(Buffer.from([0x89, 0x50, 0x4e, 0x47])); process.exit(0); }
let inp = ''; process.stdin.on('data', (d) => inp += d);
process.stdin.on('end', () => process.stdout.write(JSON.stringify({ argv: a, input: inp })));
`);
  fs.chmodSync(fake, 0o755);
  const save = { ...process.env };
  process.env.KINETYPE_ADB = fake; process.env.ADB_SERVER_SOCKET = 'tcp:h:5037';
  try {
    const r = await A.adb(['shell', 'echo', 'hi'], { serial: 'S1', input: 'in' });
    assert.equal(r.code, 0);
    assert.deepEqual(JSON.parse(r.stdout), { argv: ['-L', 'tcp:h:5037', '-s', 'S1', 'shell', 'echo', 'hi'], input: 'in' });
    await assert.rejects(A.adb(['fail']), /boom/);
    assert.deepEqual((await A.adb(['bin'], { encoding: 'buffer' })).stdout, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    assert.deepEqual(JSON.parse((await A.shell('S2', ['wm', 'size'])).stdout).argv, ['-L', 'tcp:h:5037', '-s', 'S2', 'shell', 'wm', 'size']);
    assert.deepEqual(JSON.parse((await A.forward('S2', 'tcp:1234', 'localabstract:x')).stdout).argv.slice(-3), ['forward', 'tcp:1234', 'localabstract:x']);
    assert.ok((await A.freePort()) > 0);
  } finally { process.env = save; }
});

test('encodeClipboard: SET_CLIPBOARD with paste (types æøå into native fields)', async () => {
  const { encodeClipboard } = await import('../src/device/scrcpy.js');
  assert.equal(encodeClipboard('ø').toString('hex'), '09' + '0000000000000000' + '01' + '00000002' + 'c3b8');
});
