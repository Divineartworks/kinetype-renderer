// `kinetype device-diag --serial S --base-url U [--out DIR]`: everything that decides where the page sits on
// the phone's screen, plus ONE annotated screencap of the FIXTURE's /calibration page — for diagnosing a calibration
// failure on a real device without this lane present. It refuses any page that is not the calibration fixture
// (HOLD: never a screenshot of a product).
import fs from 'node:fs';
import path from 'node:path';
import { createTransport } from './transport.js';

export async function deviceDiag({ serial, baseUrl, out, transport = 'adb', browser = 'chrome', log = () => {} } = {}) {
  if (!baseUrl) throw new Error('device-diag needs --base-url (the fixture server as the phone reaches it, e.g. http://localhost:8787 with adb reverse)');
  const dest = path.resolve(out || path.join('out', 'device', 'diag'));
  fs.mkdirSync(dest, { recursive: true });
  const report = { schema: 'kinetype.device.diag.v1', at: new Date().toISOString(), baseUrl, serial: serial || null, transport };
  const tr = await createTransport(transport, transport === 'adb' ? { serial, browser, baseUrl, log } : { log });
  try {
    report.open = await tr.open();
    if (tr.kind === 'adb') {
      const a = tr.adb;
      const sh = async (argv) => (await a.shell(tr.serial, argv, { timeoutMs: 20000 }).catch((e) => ({ stdout: `ERROR ${e.message}` }))).stdout.trim();
      report.device = {
        model: await sh(['getprop', 'ro.product.model']), android: await sh(['getprop', 'ro.build.version.release']), sdk: await sh(['getprop', 'ro.build.version.sdk']),
        wmSize: await sh(['wm', 'size']), wmDensity: await sh(['wm', 'density']),
        statusBarPx: await a.statusBarHeightPx(tr.serial), navigationMode: await sh(['settings', 'get', 'secure', 'navigation_mode']),
        fontScale: await sh(['settings', 'get', 'system', 'font_scale']), displayZoom: await sh(['wm', 'density']),
        chromeVersion: (await sh(['dumpsys', 'package', 'com.android.chrome'])).match(/versionName=(\S+)/)?.[1] || null,
      };
      if (!tr.devtools) await tr.attachCdp().catch(() => {});
      if (tr.devtools) {
        report.devtools = { version: await fetch(`http://127.0.0.1:${tr.devtools.port}/json/version`).then((r) => r.json()).catch((e) => ({ error: e.message })) };
        report.devtools.targets = (await a.devtoolsTargets(tr.devtools.port).catch(() => [])).map((t) => { let u = t.url; try { const x = new URL(t.url); u = x.origin + x.pathname; } catch {} return { type: t.type, url: u, title: t.title }; });
      }
    }
    const url = baseUrl.replace(/\/+$/, '') + '/calibration';
    await tr.navigate(url);
    await new Promise((r) => setTimeout(r, 800));
    const fixed = await tr.evaluate(`[...document.querySelectorAll('[data-cal]')].filter((e) => getComputedStyle(e).position === 'fixed').length`);
    if (fixed < 4) throw new Error(`${url} is not the calibration fixture (found ${fixed} fixed [data-cal] markers) — refusing to take a screencap`);
    report.dom = await tr.lib('diag');
    report.metrics = await tr.metrics();
    report.transportState = tr.describe();
    try {
      report.calibration = await tr.calibrate({ overlay: false, debugDir: dest, always: true });
    } catch (e) {
      report.calibration = { failed: true, error: e.message, suspects: e.calibration?.suspects || [] };
    }
    report.files = { screencap: path.join(dest, 'screencap.png'), annotated: path.join(dest, 'annotated.png'), debug: path.join(dest, 'calibration-debug.json') };
    fs.writeFileSync(path.join(dest, 'diag.json'), JSON.stringify(report, null, 2) + '\n');
    return {
      pass: !!report.calibration && !report.calibration.failed && report.calibration.modelErr <= 1,
      modelErr: report.calibration?.modelErr ?? null, fitErr: report.calibration?.fitErr ?? null, fit: report.calibration?.fit ?? null, model: report.calibration?.model ?? null, perAxis: report.calibration?.perAxis ?? null,
      suspects: report.calibration?.suspects || [], dpr: report.metrics.dpr, inner: [report.dom.innerWidth, report.dom.innerHeight], outer: [report.dom.outerWidth, report.dom.outerHeight],
      visualViewport: report.dom.visualViewport, screen: report.dom.screen, displayMode: report.dom.displayMode, video: report.transportState.screen, sizeSource: report.transportState.sizeSource,
      out: dest, files: report.files,
    };
  } finally { await tr.close(); }
}
