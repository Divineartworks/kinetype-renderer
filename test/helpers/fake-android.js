// A fake Android phone for exercising the real AdbTransport on a host without an emulator.
//   - "Chrome on the phone": headless Chrome with a mobile context + a DevTools port (reached through the fake
//     `adb forward … localabstract:chrome_devtools_remote` as a raw TCP proxy)
//   - an executable fake `adb` (fake-adb-cli.js) that asks this process what to answer
//   - a fake scrcpy 5.0 server: video socket (synthetic H.264, device-clock PTS) + control socket (touch → CDP
//     Input.dispatchTouchEvent in the page, with the real server's "ignore a touch whose screen size != video" rule)
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { chromePath } from '../../src/cli/browser.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FAKE_ADB = path.join(HERE, 'fake-adb-cli.js');
const DEVICE_CLOCK_OFFSET_US = 5e9;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });

function ffmpeg(args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn('nice', ['-n', '10', 'ffmpeg', '-v', 'error', '-threads', '2', ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = []; let err = '';
    p.stdout.on('data', (d) => out.push(d)); p.stderr.on('data', (d) => { err += d; });
    p.stdin.on('error', () => {});
    p.on('close', (c) => (c === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg: ${err.trim()}`))));
    if (input) p.stdin.end(input); else p.stdin.end();
  });
}

/** Annex-B → access units (split at AUD) + SPS/PPS of the first one. */
export function splitAccessUnits(buf) {
  const starts = [];
  for (let i = 0; i + 4 < buf.length; i++) {
    if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1 && (buf[i + 3] & 0x1f) === 9) starts.push(i > 0 && buf[i - 1] === 0 ? i - 1 : i);
  }
  const aus = starts.map((s, k) => buf.subarray(s, k + 1 < starts.length ? starts[k + 1] : buf.length));
  const nals = (au) => { const r = []; for (let i = 0; i + 3 < au.length; i++) if (au[i] === 0 && au[i + 1] === 0 && au[i + 2] === 1) r.push({ at: i, type: au[i + 3] & 0x1f }); return r; };
  const isKey = (au) => nals(au).some((n) => n.type === 5);
  // config = the SPS + PPS NALs (with their start codes) of the first access unit
  const first = aus[0], ns = nals(first);
  const startOf = (n) => (n.at > 0 && first[n.at - 1] === 0 ? n.at - 1 : n.at);
  const parts = [];
  for (const [i, n] of ns.entries()) if (n.type === 7 || n.type === 8) parts.push(first.subarray(startOf(n), i + 1 < ns.length ? startOf(ns[i + 1]) : first.length));
  return { aus, config: Buffer.concat(parts), isKey };
}

async function synthStream(w, h, seconds = 3) {
  const raw = await ffmpeg(['-f', 'lavfi', '-i', `testsrc2=size=${w}x${h}:rate=30`, '-t', String(seconds), '-c:v', 'libx264', '-preset', 'ultrafast', '-bf', '0', '-pix_fmt', 'yuv420p', '-x264-params', 'aud=1:keyint=30:min-keyint=30:scenecut=0', '-f', 'h264', 'pipe:1']);
  const { aus, config, isKey } = splitAccessUnits(raw);
  return { frames: aus.map((data) => ({ data, key: isKey(data) })), config };
}

export async function startFakeAndroid({ serial = 'emulator-5554', screen = {}, locale = 'nb-NO', extraTab = true, settings = null } = {}) {
  const S = { width: 1080, height: 2400, dpr: 2.5, statusBar: 60, navBar: 120, ...screen };
  const viewport = { width: Math.round(S.width / S.dpr), height: Math.round((S.height - S.statusBar - S.navBar) / S.dpr) };
  const stats = { touches: { 0: 0, 1: 0, 2: 0 }, ignoredTouches: 0, lastTouchScreen: null, keys: [], texts: [], commands: [], serverKilled: 0, videoPackets: 0, scrcpyArgs: null, demo: [], settings: {}, appLocales: {}, files: {}, chromeStarts: [] };
  const closers = [];

  // ---- the phone's Chrome ----
  const dtPort = await freePort();
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true, timeout: 60000, args: ['--no-sandbox', `--remote-debugging-port=${dtPort}`, `--force-device-scale-factor=${S.dpr}`, '--hide-scrollbars', '--force-color-profile=srgb', '--font-render-hinting=none', '--no-first-run', '--disable-extensions'] });
  closers.push(() => browser.close().catch(() => {}));
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: S.dpr, isMobile: true, hasTouch: true, locale: 'nb-NO', timezoneId: 'Europe/Oslo', serviceWorkers: 'block' });
  // a stray background tab (the real emulator had 12): the stage must close it
  if (extraTab) { const t = await ctx.newPage(); await t.goto('about:blank'); }
  const page = await ctx.newPage();
  await page.goto('about:blank');
  const cdp = await ctx.newCDPSession(page);
  let inputChain = Promise.resolve();
  const input = (method, params) => { inputChain = inputChain.then(() => cdp.send(method, params)).catch(() => {}); return inputChain; };

  // ---- adb forward listeners ----
  const listeners = new Map(); // local port → server
  const scrcpyServers = new Map(); // scid → server state
  const listen = (port, onConn) => new Promise((resolve, reject) => {
    const srv = net.createServer(onConn);
    srv.on('error', reject);
    srv.listen(port, '127.0.0.1', () => { listeners.set(port, srv); resolve(); });
  });
  const forward = async (port, remote) => {
    if (remote === 'localabstract:chrome_devtools_remote') {
      await listen(port, (c) => { const u = net.connect(dtPort, '127.0.0.1'); c.pipe(u); u.pipe(c); c.on('error', () => u.destroy()); u.on('error', () => c.destroy()); c.on('close', () => u.destroy()); u.on('close', () => c.destroy()); });
    } else {
      const m = /^localabstract:scrcpy_([0-9a-f]{8})$/.exec(remote);
      if (!m) throw new Error(`fake adb: unsupported forward target ${remote}`);
      await listen(port, (c) => {
        const sv = scrcpyServers.get(m[1]);
        c.on('error', () => {});
        if (!sv || !sv.ready || sv.stopped) return c.destroy(); // adb forward accepts, then closes: the client retries
        sv.accept(c);
      });
    }
  };

  // ---- the phone screen ----
  async function screencap() {
    const shot = await page.screenshot({ type: 'png' });
    return ffmpeg(['-i', 'pipe:0', '-vf', `pad=${S.width}:${S.height}:0:${S.statusBar}:color=0x101114`, '-f', 'image2pipe', '-c:v', 'png', 'pipe:1'], { input: shot });
  }

  // ---- fake scrcpy server ----
  function scrcpyStart(scid, args) {
    const maxSize = Number((args.find((a) => a.startsWith('max_size=')) || '').slice(9)) || 0;
    let vw = S.width, vh = S.height;
    if (maxSize > 0 && Math.max(vw, vh) > maxSize) { const k = maxSize / Math.max(vw, vh); vw = Math.floor(vw * k) & ~7; vh = Math.floor(vh * k) & ~7; }
    const sv = { scid, vw, vh, ready: false, stopped: false, sockets: [] };
    sv.stream = synthStream(vw, vh).then((s) => { sv.data = s; sv.ready = !sv.stopped; });
    let n = 0;
    sv.accept = (sock) => {
      sv.sockets.push(sock);
      // like the real server (tunnel_forward): dummy byte on the first socket at once; device meta + video only
      // after the control socket is accepted (so the client's packet listener is attached by then)
      if (n++ === 0) { sock.write(Buffer.from([0])); sv.video = sock; } else { controlConn(sv, sock); setTimeout(() => videoConn(sv, sv.video), 50); }
    };
    sv.stop = () => { sv.stopped = true; for (const s of sv.sockets) s.destroy(); };
    scrcpyServers.set(scid, sv);
    closers.push(() => sv.stop());
    stats.scrcpyArgs = args;
    return sv;
  }

  function videoConn(sv, sock) {
    const { vw, vh } = sv, { frames, config } = sv.data;
    const head = Buffer.alloc(64 + 4 + 12);
    head.write('phone1', 0, 'utf8');
    head.writeUInt32BE(0x68323634, 64);
    head.writeUInt32BE(0x80000000, 68); head.writeUInt32BE(vw, 72); head.writeUInt32BE(vh, 76);
    // session layout (4.0+, as the header above announces): media flags C = bit 62, K = bit 61 (measured on scrcpy 5.0)
    const pkt = (flags, pts, data) => { const h = Buffer.alloc(12); h.writeBigUInt64BE(flags | BigInt(Math.round(pts)), 0); h.writeUInt32BE(data.length, 8); return Buffer.concat([h, data]); };
    sock.write(Buffer.concat([head, pkt(1n << 62n, 0, config)]));
    let i = 0, next = performance.now();
    const tick = () => {
      if (sv.stopped || sock.destroyed) return;
      const f = frames[i];
      sock.write(pkt(f.key ? 1n << 61n : 0n, performance.now() * 1000 + DEVICE_CLOCK_OFFSET_US, f.data));
      stats.videoPackets++;
      i = (i + 1) % frames.length; // the loop restarts at the IDR (frame 0)
      next += 1000 / 30;
      setTimeout(tick, Math.max(0, next - performance.now()));
    };
    tick();
    sock.on('close', () => { sv.stopped = true; });
  }

  // `uiautomator dump`: Chrome's accessibility nodes for the page's controls, in device px (as on a phone)
  async function uiDump() {
    const nodes = await page.evaluate(() => [...document.querySelectorAll('button, a, input, textarea, [role=link], [role=status], h1, h2')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[aria-hidden=true]'); }).map((e) => {
      const r = e.getBoundingClientRect();
      return { text: e.tagName === 'INPUT' ? e.value : (e.getAttribute('aria-label') || e.textContent).replace(/\s+/g, ' ').trim(), id: e.dataset.testid || '', edit: ['INPUT', 'TEXTAREA'].includes(e.tagName), focused: document.activeElement === e, r: [r.left, r.top, r.right, r.bottom] };
    }));
    const esc = (t) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const px = (v, i) => Math.round(i % 2 ? v * S.dpr + S.statusBar : v * S.dpr);
    const body = nodes.map((n) => `<node index="0" text="${esc(n.text)}" resource-id="${n.id ? 'com.android.chrome:id/' + n.id : ''}" class="${n.edit ? 'android.widget.EditText' : 'android.view.View'}" package="com.android.chrome" content-desc="" clickable="true" focused="${n.focused}" bounds="[${px(n.r[0], 0)},${px(n.r[1], 1)}][${px(n.r[2], 2)},${px(n.r[3], 3)}]" />`).join('');
    return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0"><node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.android.chrome" content-desc="" clickable="false" bounds="[0,0][${S.width},${S.height}]">${body}</node></hierarchy>UI hierchary dumped to: /dev/tty\n`;
  }

  function controlConn(sv, sock) {
    let buf = Buffer.alloc(0);
    const size = (b) => { switch (b[0]) { case 0: return 14; case 1: return b.length >= 5 ? 5 + b.readUInt32BE(1) : Infinity; case 2: return 32; case 3: return 21; case 4: return 2; case 9: return b.length >= 14 ? 14 + b.readUInt32BE(10) : Infinity; default: return -1; } };
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (!buf.length) break;
        const n = size(buf);
        if (n < 0) { buf = Buffer.alloc(0); break; }
        if (buf.length < n) break;
        handle(sv, buf.subarray(0, n));
        buf = buf.subarray(n);
      }
    });
  }

  function handle(sv, m) {
    const { vw, vh } = sv;
    if (m[0] === 2) {
      const action = m[1], x = m.readInt32BE(10), y = m.readInt32BE(14), sw = m.readUInt16BE(18), sh = m.readUInt16BE(20);
      stats.lastTouchScreen = { width: sw, height: sh };
      if (sw !== vw || sh !== vh) { stats.ignoredTouches++; return; }
      stats.touches[action] = (stats.touches[action] || 0) + 1;
      const k = vw / S.width; // video px → device px → CSS px of the page (below the status bar)
      const p = { x: x / k / S.dpr, y: (y / k - S.statusBar) / S.dpr };
      const type = action === 0 ? 'touchStart' : action === 2 ? 'touchMove' : 'touchEnd';
      input('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: p.x, y: p.y, radiusX: 6, radiusY: 6, force: 1, id: 0 }] });
    } else if (m[0] === 0) {
      const action = m[1], code = m.readInt32BE(2);
      stats.keys.push({ action, code });
      if (action !== 0) return;
      if (code === 4) inputChain = inputChain.then(() => page.evaluate('history.back()')).catch(() => {});
      else if (code === 66) { input('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }); input('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); }
    } else if (m[0] === 1) {
      const text = m.subarray(5, 5 + m.readUInt32BE(1)).toString('utf8');
      stats.texts.push(text);
      input('Input.insertText', { text });
    } else if (m[0] === 9) { // SET_CLIPBOARD with paste: the text lands in the focused field
      const text = m.subarray(14, 14 + m.readUInt32BE(10)).toString('utf8');
      (stats.pastes ||= []).push(text);
      if (m[9]) input('Input.insertText', { text });
    } else if (m[0] === 4 && m[1] === 0) inputChain = inputChain.then(() => page.evaluate('history.back()')).catch(() => {});
  }

  // ---- control server (the fake adb CLI talks to this) ----
  const answer = async (argvIn) => {
    let argv = [...argvIn];
    while (argv[0] === '-s' || argv[0] === '-L') argv = argv.slice(2);
    stats.commands.push(argv.join(' ').slice(0, 160));
    const ok = (s = '') => ({ stdout: Buffer.from(s).toString('base64'), code: 0 });
    const [a, b, c] = argv;
    if (a === 'devices') return ok(`List of devices attached\n${serial}\tdevice\n\n`);
    if (a === 'push') return ok('1 file pushed.\n');
    if (a === 'forward') {
      if (b === '--remove') { const port = Number(c.replace('tcp:', '')); const s = listeners.get(port); if (s) { s.close(); listeners.delete(port); } return ok(); }
      await forward(Number(b.replace('tcp:', '')), c);
      return ok();
    }
    if (a === 'exec-out' && b === 'screencap') return { stdout: (await screencap()).toString('base64'), code: 0 };
    if (a === 'exec-out' && b === 'uiautomator') return ok(settings && settings.state.screen !== 'home' ? (await settings.dump()) + 'UI hierchary dumped to: /dev/tty\n' : await uiDump());
    if (a === 'shell') {
      const rest = argv.slice(1);
      if (rest[0] === 'wm' && rest[1] === 'size') return ok(`Physical size: ${S.width}x${S.height}\n`);
      if (rest[0] === 'wm' && rest[1] === 'density') return ok(`Physical density: ${Math.round(S.dpr * 160)}\n`);
      if (rest[0] === 'dumpsys' && rest[1] === 'window') return ok(`  mStatusBarHeight=${S.statusBar}\n`);
      // the Settings app (device-locale): its simulator owns locale reads, the LOCALE_SETTINGS intent and input while open
      if (settings && ((rest[0] === 'settings' && rest[3] === 'system_locales') || (rest[0] === 'getprop' && rest[1] === 'persist.sys.locale') || (rest[0] === 'am' && rest.includes('android.settings.LOCALE_SETTINGS')) || (rest[0] === 'input' && settings.state.screen !== 'home'))) return ok(await settings.sh(rest));
      // ---- what the CLEAN STAGE preflight touches ----
      if (rest[0] === 'getprop') return ok(({ 'persist.sys.locale': locale, 'ro.product.locale': 'en-US', 'sys.boot_completed': '1', 'init.svc.bootanim': 'stopped' })[rest[1]] ?? '');
      if (rest[0] === 'service' && rest[1] === 'check') return ok(`Service ${rest[2]}: found\n`);
      if (rest[0] === 'pm' && rest[1] === 'path') return ok('package:/system/framework/framework-res.apk\n');
      if (rest[0] === 'settings' && rest[1] === 'get') return ok(rest[3] === 'system_locales' ? locale : String(stats.settings[rest[3]] ?? 'null'));
      if (rest[0] === 'settings' && rest[1] === 'put') { stats.settings[rest[3]] = rest[4]; return ok(); }
      if (rest[0] === 'cmd' && rest[1] === 'locale' && rest[2] === 'get-app-locales') return ok(`Locales for ${rest[3]} for user 0 are [${stats.appLocales[rest[3]] || ''}]`);
      if (rest[0] === 'cmd' && rest[1] === 'locale' && rest[2] === 'set-app-locales') { stats.appLocales[rest[3]] = rest[5]; return ok(); }
      if (rest[0] === 'cat') return stats.files[rest[1]] !== undefined ? ok(stats.files[rest[1]]) : { stdout: '', stderr: `cat: ${rest[1]}: No such file or directory\n`, code: 1 };
      if (rest[0] === 'sh' && rest[1] === '-c') { const m = /^echo '(.*)' > (\S+)$/.exec(rest[2]); if (m) { stats.files[m[2]] = m[1] + '\n'; return ok(); } }
      if (rest[0] === 'rm') { delete stats.files[rest[rest.length - 1]]; return ok(); }
      if (rest[0] === 'am' && rest[1] === 'broadcast' && rest.includes('com.android.systemui.demo')) { stats.demo.push(rest.slice(rest.indexOf('command') + 1).join(' ')); return ok('Broadcast completed: result=0\n'); }
      if (rest[0] === 'am' && rest[1] === 'force-stop') return ok();
      if (rest[0] === 'am' && rest[1] === 'start') { const d = rest[rest.indexOf('-d') + 1]; stats.chromeStarts.push(d); if (d) await page.goto(d).catch(() => {}); return ok('Starting: Intent\n'); }
      // smoothness sources (rehearse): a Chrome SurfaceView layer presenting at 60 Hz, HWUI counters
      if (rest[0] === 'dumpsys' && rest[1] === 'SurfaceFlinger' && rest[2] === '--list') return ok('Display 0\nStatusBar#45\nSurfaceView[com.android.chrome/org.chromium.chrome.browser.ChromeTabbedActivity]#131(BLAST)\n');
      if (rest[0] === 'dumpsys' && rest[1] === 'SurfaceFlinger' && rest[2] === '--latency-clear') { stats.sfClears = (stats.sfClears || 0) + 1; return ok(); }
      // like Android 15 + GuestAngle (rehearsal 5): --latency answers only its header; frames come from TimeStats
      if (rest[0] === 'dumpsys' && rest[1] === 'SurfaceFlinger' && rest[2] === '--latency') return ok('16666666\n');
      if (rest[0] === 'dumpsys' && rest[1] === 'SurfaceFlinger' && rest[2] === '--timestats') return ok(rest.includes('-dump') ? 'SurfaceFlinger TimeStats:\nlayerName = SurfaceView[com.android.chrome/org.chromium.chrome.browser.ChromeTabbedActivity]#131(BLAST)\npackageName = com.android.chrome\ntotalFrames = 48\ndroppedFrames = 0\naverageFPS = 60.0\npresentToPresent histogram is as below:\n16ms=40 17ms=8\n' : '');
      if (rest[0] === 'dumpsys' && rest[1] === 'gfxinfo') return ok(rest[3] === 'reset' ? '' : 'Total frames rendered: 48\nJanky frames: 1 (2.08%)\n90th percentile: 9ms\n95th percentile: 11ms\n99th percentile: 17ms\n');
      if (rest[0] === 'pm' && rest[1] === 'list') return ok('package:com.android.chrome\npackage:com.google.android.apps.messaging\n');
      const si = rest.indexOf('com.genymobile.scrcpy.Server');
      if (si >= 0) {
        const args = rest.slice(si + 2);
        const scid = (args.find((x) => x.startsWith('scid=')) || '').slice(5);
        scrcpyStart(scid, args);
        return { stdout: '', code: 0, block: true };
      }
    }
    return { stdout: '', stderr: `fake adb: unsupported: ${argv.join(' ')}\n`, code: 1 };
  };
  const ctl = http.createServer((req, res) => {
    const chunks = []; req.on('data', (d) => chunks.push(d));
    req.on('end', async () => {
      let out = {};
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        if (req.url === '/cmd') out = await answer(body.argv);
        else if (req.url === '/killed') { stats.serverKilled++; for (const sv of scrcpyServers.values()) sv.stop(); }
      } catch (e) { out = { stdout: '', stderr: `fake adb: ${e.message}\n`, code: 1 }; }
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(out));
    });
  });
  await new Promise((r) => ctl.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise((r) => ctl.close(r)));

  return {
    serial, screen: S, viewport, stats, page,
    env: { KINETYPE_ADB: FAKE_ADB, FAKE_ADB_CTL: `http://127.0.0.1:${ctl.address().port}`, KINETYPE_SCRCPY_VERSION: '5.0' },
    async close() {
      for (const s of listeners.values()) s.close();
      listeners.clear();
      ctl.closeAllConnections?.();
      for (const c of closers.reverse()) await Promise.race([c(), sleep(5000)]);
    },
  };
}
