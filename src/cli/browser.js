// System Chrome via playwright-core (no browser download).
// --disable-features=MacAppCodeSignClone: on macOS each headless launch
// otherwise leaves a code-sign clone behind; they have cost ~21 GiB before.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const CANDIDATES = [
  process.env.KINETYPE_CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

export function chromePath() {
  for (const p of CANDIDATES) if (fs.existsSync(p)) return p;
  return null;
}

/** Reject if `p` does not settle within `ms` — a hung Chrome must fail loudly, never wait forever. */
export function withTimeout(p, ms, what) {
  let timer;
  return Promise.race([p, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${what} timed out after ${ms} ms`)), ms); })]).finally(() => clearTimeout(timer));
}

export async function launch() {
  const executablePath = chromePath();
  if (!executablePath) throw new Error('no Chrome found; set KINETYPE_CHROME to a Chrome/Chromium binary');
  return chromium.launch({
    executablePath,
    headless: true,
    timeout: 60000,
    args: [
      '--disable-features=MacAppCodeSignClone',
      '--force-color-profile=srgb',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      ...(process.env.KINETYPE_GL !== '0' ? ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : []),
    ],
  });
}

/**
 * A browser shared across items that survives a Chrome crash: get() returns the
 * live browser, launching a fresh one when the last one disconnected. The item
 * whose browser died still fails with its own error; only later items relaunch.
 */
export function liveBrowser(launchFn = launch) {
  let browser = null;
  return {
    async get() {
      if (browser && browser.isConnected()) return browser;
      if (browser) await browser.close().catch(() => {});
      const b = await launchFn();
      b.on('disconnected', () => { if (browser === b) browser = null; });
      browser = b;
      return b;
    },
    async close() {
      const b = browser;
      browser = null;
      if (b) await b.close().catch(() => {});
    },
  };
}

/** Open a runtime page in its own context (own renderer process) and load the spec. */
export async function openRuntime(browser, baseUrl, resolved) {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${baseUrl}/src/runtime/page.html`);
  await page.waitForFunction(() => window.KT && window.KT.ready, null, { timeout: 30000 }).catch(() => {
    throw new Error('runtime failed to boot: ' + errors.join(' | '));
  });
  let info;
  try {
    info = await withTimeout(page.evaluate((r) => window.KT.load(r), resolved), 180000, 'template build');
  } catch (e) {
    throw new Error(`template failed to build: ${e.message}${errors.length ? ' | ' + errors.join(' | ') : ''}`);
  }
  return { context, page, info, errors };
}
