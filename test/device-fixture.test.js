import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startFixtureServer } from '../fixtures/device/server.js';
import { chromePath } from '../src/cli/browser.js';

const get = (base, p, init) => fetch(base + p, init);
const post = (base, p, body) => get(base, p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

test('fixture server: routes and content types', async () => {
  const s = await startFixtureServer();
  try {
    const want = {
      '/': 'text/html', '/office': 'text/html', '/calibration': 'text/html',
      '/manifest.webmanifest': 'application/manifest+json', '/icon.svg': 'image/svg+xml', '/sw.js': 'text/javascript',
    };
    for (const [p, type] of Object.entries(want)) {
      const r = await get(s.url, p);
      assert.equal(r.status, 200, p);
      assert.ok(r.headers.get('content-type').startsWith(type), `${p}: ${r.headers.get('content-type')}`);
      assert.equal(r.headers.get('cache-control'), 'no-store');
      assert.equal(r.headers.get('access-control-allow-origin'), null);
    }
    assert.equal((await get(s.url, '/nope')).status, 404);
    const m = await (await get(s.url, '/manifest.webmanifest')).json();
    assert.equal(m.display, 'standalone');
    assert.equal(m.start_url, '/');
    const office = await (await get(s.url, '/office?poll=750')).text();
    assert.match(office, /window\.POLL_MS=750/);
  } finally { await s.close(); }
});

test('fixture server: jobs API, extra, reset', async () => {
  const s = await startFixtureServer();
  try {
    const d = await (await get(s.url, '/api/jobs')).json();
    assert.equal(d.jobs.length, 25);
    assert.equal(d.jobs[16].id, 17);
    assert.equal(d.jobs[16].title, 'Takrenne – Solberg');
    for (const k of ['id', 'title', 'customer', 'address', 'status', 'amount']) assert.ok(k in d.jobs[0], k);
    const v0 = d.version;
    const r = await (await post(s.url, '/api/jobs/17/extra', { text: 'Ekstra beslag', amount: 2500 })).json();
    assert.equal(r.version, v0 + 1);
    const st = await (await get(s.url, '/api/state')).json();
    assert.equal(st.version, v0 + 1);
    assert.match(st.lastEvent.text, /Takrenne/);
    const d2 = await (await get(s.url, '/api/jobs')).json();
    assert.equal(d2.jobs[16].status, 'pending-approval');
    assert.equal(d2.jobs[16].extras[0].amount, 2500);
    await post(s.url, '/api/reset');
    const d3 = await (await get(s.url, '/api/jobs')).json();
    assert.deepEqual(d3, d);
    assert.equal((await post(s.url, '/api/jobs/999/extra', {})).status, 404);
  } finally { await s.close(); }
});

test('fixture server: latencyMs delays /api only', async () => {
  const s = await startFixtureServer({ latencyMs: 300 });
  try {
    let t = Date.now();
    await get(s.url, '/api/state');
    assert.ok(Date.now() - t >= 290, 'api delayed');
    t = Date.now();
    await get(s.url, '/icon.svg');
    assert.ok(Date.now() - t < 250, 'static not delayed');
  } finally { await s.close(); }
});

const chrome = chromePath();
test('fixture in headless Chrome: role targets and flow', { skip: chrome ? false : 'no Chrome (set KINETYPE_CHROME)', timeout: 90000 }, async () => {
  const { chromium } = await import('playwright-core');
  const s = await startFixtureServer({ latencyMs: 250 });
  const browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(s.url + '/');
    await page.evaluate(() => window.__fixture.ready);
    await page.getByRole('searchbox', { name: 'Søk i jobber' }).waitFor();
    const card = page.getByRole('link', { name: 'Takrenne – Solberg' });
    assert.equal(await card.count(), 1);
    assert.equal(await card.isVisible(), true);
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    assert.ok(await card.evaluate((el) => el.getBoundingClientRect().top) > 915, 'job 17 is below the fold');
    await card.click();
    await page.waitForFunction(() => location.hash === '#/job/17');
    const open = page.getByRole('button', { name: 'Legg til ekstraarbeid' });
    assert.ok((await open.boundingBox()).height >= 44);
    await open.click();
    const dlg = page.getByRole('dialog', { name: 'Ekstraarbeid' });
    await dlg.waitFor();
    await dlg.getByRole('textbox', { name: 'Beskrivelse' }).fill('Ekstra beslag');
    await dlg.getByRole('textbox', { name: 'Beløp' }).fill('2500');
    await dlg.getByRole('button', { name: 'Avbryt' }).waitFor();
    await dlg.getByRole('button', { name: 'Send til kunden' }).click();
    assert.equal(await dlg.getAttribute('aria-busy'), 'true');
    await page.waitForFunction(() => location.hash === '#/done');
    const status = page.getByRole('status');
    assert.equal(await status.textContent(), 'Sendt til kunden');
    await page.getByRole('button', { name: 'Tilbake til jobber' }).click();
    await page.waitForFunction(() => location.hash === '#/');
    const d = await (await fetch(s.url + '/api/jobs')).json();
    assert.equal(d.jobs[16].status, 'pending-approval');
    assert.equal(d.jobs[16].extras[0].text, 'Ekstra beslag');
    // search filters live
    await page.getByRole('searchbox', { name: 'Søk i jobber' }).fill('berg');
    assert.equal(await page.getByRole('link', { name: 'Varmepumpe – Berg' }).count(), 1);
    assert.equal(await page.getByRole('link', { name: 'Bad – Hansen' }).count(), 0);
    // office picks the item up by polling
    const office = await ctx.newPage();
    await office.goto(s.url + '/office?poll=300');
    await office.getByText('Takrenne – Solberg').first().waitFor();
    await office.getByRole('tab', { name: /Alle jobber/ }).click();
    assert.equal(await office.getByRole('tab', { name: /Alle jobber/ }).getAttribute('aria-selected'), 'true');
  } finally { await browser.close(); await s.close(); }
});

test('calibration markers sit at stated CSS positions', { skip: chrome ? false : 'no Chrome (set KINETYPE_CHROME)', timeout: 60000 }, async () => {
  const { chromium } = await import('playwright-core');
  const s = await startFixtureServer();
  const browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(s.url + '/calibration');
    const r = await page.evaluate(() => {
      const out = {};
      for (const k of ['tl', 'tr', 'bl', 'br', 'doc']) { const b = document.querySelector(`[data-cal="${k}"]`).getBoundingClientRect(); out[k] = [b.x, b.y, b.width, b.height]; }
      return { out, w: innerWidth, h: innerHeight, sh: document.documentElement.scrollHeight };
    });
    const near = (a, b, what) => assert.ok(Math.abs(a - b) <= 0.5, `${what}: ${a} vs ${b}`);
    const { out, w, h } = r;
    const X0 = Math.round(w * 0.12), X1 = Math.round(w * 0.88) - 24, Y0 = Math.round(h * 0.2), Y1 = Math.round(h * 0.8) - 24;
    const exp = { tl: [X0, Y0], tr: [X1, Y0], bl: [X0, Y1], br: [X1, Y1], doc: [16, 1200] };
    for (const k of Object.keys(exp)) {
      near(out[k][0], exp[k][0], k + '.x'); near(out[k][1], exp[k][1], k + '.y');
      near(out[k][2], 24, k + '.w'); near(out[k][3], 24, k + '.h');
    }
    assert.ok(r.sh >= 3000);
    await page.evaluate(() => window.scrollTo(0, 1000));
    near(await page.evaluate(() => document.querySelector('[data-cal="doc"]').getBoundingClientRect().y), 200, 'doc after scroll');
    // flash bar on pointerdown
    await page.touchscreen.tap(200, 400);
    assert.ok(await page.evaluate(() => window.__lastTouch) > 0);
  } finally { await browser.close(); await s.close(); }
});
