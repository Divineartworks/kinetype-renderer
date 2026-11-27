// adb.js — thin adb wrapper for the device driver. argv arrays only (never a
// shell string on the host); KINETYPE_ADB overrides the binary, and
// ADB_SERVER_SOCKET=tcp:HOST:PORT routes through a remote adb server (-L).
// Pure parse helpers (parseDevices/parseWmSize/parseDensity/...) are exported
// so they can be tested without a device.
import { spawn } from 'node:child_process';
import net from 'node:net';

export const chromeSocketName = 'chrome_devtools_remote';
export const adbBin = () => process.env.KINETYPE_ADB || 'adb';

export function adbBase({ serial } = {}) {
  const a = [];
  const s = process.env.ADB_SERVER_SOCKET;
  if (s && /^tcp:[^:]+:\d+$/.test(s)) a.push('-L', s);
  if (serial) a.push('-s', serial);
  return a;
}

export function adb(args, { serial, input, timeoutMs = 30000, encoding = 'utf8' } = {}) {
  return new Promise((resolve, reject) => {
    const argv = [...adbBase({ serial }), ...args];
    const p = spawn(adbBin(), argv, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [], err = [];
    let done = false;
    const fin = (e, r) => { if (done) return; done = true; clearTimeout(timer); e ? reject(e) : resolve(r); };
    const timer = setTimeout(() => { p.kill('SIGKILL'); fin(new Error(`adb ${args.join(' ')} timed out after ${timeoutMs}ms`)); }, timeoutMs);
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => err.push(d));
    p.stdin.on('error', () => {});
    p.on('error', (e) => fin(e.code === 'ENOENT' ? new Error(`adb not found (${adbBin()}): install Android platform-tools or set KINETYPE_ADB; for a remote adb server set ADB_SERVER_SOCKET=tcp:HOST:5037`) : e));
    p.on('close', (code) => {
      const so = Buffer.concat(out), se = Buffer.concat(err).toString('utf8');
      const stdout = encoding === 'buffer' ? so : so.toString(encoding);
      if (code !== 0) { const e = new Error(`adb ${args.join(' ')} exited ${code}: ${se.trim()}`); e.code = code; e.stderr = se; e.stdout = stdout; return fin(e); }
      fin(null, { stdout, stderr: se, code });
    });
    if (input != null) p.stdin.end(input); else p.stdin.end();
  });
}

export function parseDevices(text) {
  return String(text).split('\n').map((l) => l.trim())
    .filter((l) => l && !l.startsWith('List of devices') && !l.startsWith('*'))
    .map((l) => { const [serial, state] = l.split(/\s+/); return { serial, state }; });
}
export async function devices() { return parseDevices((await adb(['devices'])).stdout); }

export const forward = (serial, local, remote) => adb(['forward', local, remote], { serial });
export const removeForward = (serial, local) => adb(['forward', '--remove', local], { serial });
export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}
export const push = (serial, src, dst) => adb(['push', src, dst], { serial, timeoutMs: 120000 });
export const shell = (serial, argv, opts = {}) => adb(['shell', ...argv], { serial, ...opts });
export function spawnShell(serial, argv) {
  return spawn(adbBin(), [...adbBase({ serial }), 'shell', ...argv], { stdio: ['ignore', 'pipe', 'pipe'] });
}
export async function screencap(serial) {
  return (await adb(['exec-out', 'screencap', '-p'], { serial, encoding: 'buffer' })).stdout;
}

// "Physical size: 1080x2400" / "Override size: 720x1600" — override wins.
export function parseWmSize(text) {
  const t = String(text);
  const pick = (re) => { const m = re.exec(t); return m ? { width: +m[1], height: +m[2] } : null; };
  const physical = pick(/Physical size:\s*(\d+)x(\d+)/), override = pick(/Override size:\s*(\d+)x(\d+)/);
  const r = override || physical;
  return r ? { ...r, physical, override } : null;
}
export function parseDensity(text) {
  const t = String(text);
  const o = /Override density:\s*(\d+)/.exec(t), p = /Physical density:\s*(\d+)/.exec(t);
  return o ? +o[1] : p ? +p[1] : null;
}
export function parseStatusBarHeight(text) {
  const t = String(text);
  const m = /type=statusBars[^\n]*?frame=\[\s*\d+\s*,\s*\d+\s*\]\[\s*\d+\s*,\s*(\d+)\s*\]/.exec(t)
    || /mStatusBarHeight=(\d+)/.exec(t) || /statusBarHeight=(\d+)/.exec(t);
  return m ? +m[1] : null;
}
export async function wmSize(serial) {
  const r = parseWmSize((await shell(serial, ['wm', 'size'])).stdout);
  if (!r) throw new Error('could not parse `wm size`');
  return { width: r.width, height: r.height };
}
export async function wmDensity(serial) {
  const d = parseDensity((await shell(serial, ['wm', 'density'])).stdout);
  if (d == null) throw new Error('could not parse `wm density`');
  return d;
}
export async function statusBarHeightPx(serial) {
  try { return parseStatusBarHeight((await shell(serial, ['dumpsys', 'window'], { timeoutMs: 20000 })).stdout); } catch { return null; }
}

export async function devtoolsTargets(port) {
  const r = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!r.ok) throw new Error(`devtools /json/list ${r.status}`);
  return (await r.json()).map(({ id, type, url, title, webSocketDebuggerUrl }) => ({ id, type, url, title, webSocketDebuggerUrl }));
}
export async function openDevtools(serial, { socket = chromeSocketName } = {}) {
  const port = await freePort();
  await forward(serial, `tcp:${port}`, `localabstract:${socket}`);
  try {
    const targets = await devtoolsTargets(port);
    return { port, targets, close: () => removeForward(serial, `tcp:${port}`).catch(() => {}) };
  } catch (e) { await removeForward(serial, `tcp:${port}`).catch(() => {}); throw e; }
}

// `adb shell input` fallbacks (argv for shell(); the device shell re-parses, so escape).
const esc = (s) => String(s).replace(/ /g, '%s').replace(/([\\"'`$&|;<>()*?!#~{}[\]^])/g, '\\$1');
const r = (v) => String(Math.round(v));
export const tapArgs = (x, y) => ['input', 'tap', r(x), r(y)];
export const swipeArgs = (x1, y1, x2, y2, ms) => ['input', 'swipe', r(x1), r(y1), r(x2), r(y2), r(ms)];
export const textArgs = (text) => ['input', 'text', esc(text)];
export const keyeventArgs = (code) => ['input', 'keyevent', String(code)];
export const motionArgs = (action, x, y) => ['input', 'motionevent', String(action), r(x), r(y)];
export const inputFallback = { tapArgs, swipeArgs, textArgs, keyeventArgs, motionArgs };

/** Wait until Android is really usable (boot_completed fires before system services): boot completed, boot animation
 * stopped, window/activity/package services up, package manager answering. Throws a clear error naming what is not. */
export async function waitForDeviceReady(serial, { timeoutMs = 180000, pollMs = 2000, log = () => {} } = {}) {
  const t0 = Date.now();
  let last = {};
  for (;;) {
    const q = async (argv) => (await adb(['shell', ...argv], { serial, timeoutMs: 15000 }).then((r) => r.stdout.trim()).catch((e) => `ERR ${e.message.split('\n')[0]}`));
    last = {
      boot_completed: await q(['getprop', 'sys.boot_completed']),
      bootanim: await q(['getprop', 'init.svc.bootanim']),
      window: await q(['service', 'check', 'window']),
      activity: await q(['service', 'check', 'activity']),
      package: await q(['service', 'check', 'package']),
      pm: await q(['pm', 'path', 'android']),
    };
    const ok = last.boot_completed === '1' && /stopped|^$/.test(last.bootanim) && /found/.test(last.window) && !/not found/.test(last.window)
      && /found/.test(last.activity) && !/not found/.test(last.activity) && /found/.test(last.package) && !/not found/.test(last.package) && /package:/.test(last.pm);
    if (ok) return { readyMs: Date.now() - t0, ...last };
    if (Date.now() - t0 > timeoutMs) throw new Error(`adb: ${serial} not ready after ${Math.round(timeoutMs / 1000)} s — ${Object.entries(last).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')} (a cold boot, e.g. -gpu host without a matching snapshot, takes minutes; see the device-capture notes (not shipped))`);
    log(`waiting for ${serial}: ${Object.entries(last).filter(([k, v]) => !(k === 'boot_completed' ? v === '1' : k === 'bootanim' ? /stopped|^$/.test(v) : k === 'pm' ? /package:/.test(v) : /found/.test(v) && !/not found/.test(v))).map(([k]) => k).join(', ')}`);
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
