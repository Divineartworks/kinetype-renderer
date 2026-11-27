// Cold-start verification: replay the compiled flow from a FRESH browser context (no cookies, no state) in a fast dry
// mode - no frames, no virtual clock - and report every step whose target does not resolve to exactly one visible
// element. This is NOT a capture path: capture stays the only renderer. The target lookup mirrors capture's
// locate()/resolve() (driver.js is not changed; exporting locate is filed in REQUESTS.md).
import { launch } from '../cli/browser.js';
import { resolveFlow, assertSameOrigin } from '../capture/flow.js';

function locate(page, t) {
  let loc;
  if (t.selector) loc = page.locator(t.selector);
  else if (t.role) loc = page.getByRole(t.role, { ...(t.name !== undefined ? { name: t.name } : {}), exact: t.exact ?? false });
  else loc = page.getByText(t.text, { exact: t.exact ?? false });
  return t.nth !== undefined ? loc.nth(t.nth) : loc;
}
export const contextOptions = (flow) => ({
  viewport: flow.device.viewport, deviceScaleFactor: 1, isMobile: flow.device.isMobile, hasTouch: flow.device.hasTouch,
  locale: flow.device.locale, timezoneId: flow.device.timezone, colorScheme: flow.device.colorScheme, serviceWorkers: 'block', acceptDownloads: false,
});

export async function coldStart(flowIn, { baseUrl, resolveTimeoutMs = 5000, settleMs = 700 } = {}) {
  const flow = resolveFlow(flowIn, { baseUrl });
  const t0 = Date.now();
  const failures = [], warnings = [], visited = [];
  const browser = await launch();
  try {
    const ctx = await browser.newContext(contextOptions(flow));
    for (const r of flow.setup) {   // same origin rule as capture; explore never emits setup, but a hand-edited flow may
      const res = await ctx.request.fetch(assertSameOrigin(flow.app.baseUrl, r.url), { method: r.method, data: r.body, headers: r.headers, failOnStatusCode: false, timeout: 30000 });
      if (!res.ok()) failures.push({ step: 'setup', error: `${r.method} ${r.url} -> HTTP ${res.status()}` });
    }
    const origin = new URL(flow.app.baseUrl).origin;
    const page = await ctx.newPage();
    page.setDefaultTimeout(10000);
    await page.route('**/*', (route) => {
      const req = route.request();
      if (req.isNavigationRequest() && req.frame() === page.mainFrame() && new URL(req.url()).origin !== origin) { failures.push({ step: '?', error: `navigation off-site to ${req.url()}` }); return route.abort(); }
      return route.continue();
    });
    for (const step of flow.steps) {
      const ts = Date.now();
      try {
        switch (step.action) {
          case 'goto': await page.goto(assertSameOrigin(flow.app.baseUrl, step.url), { waitUntil: 'load', timeout: 45000 }); await page.waitForTimeout(settleMs); break;
          case 'click': case 'hover': case 'scroll': {
            let loc = null;
            if (step.target) {
              loc = locate(page, step.target);
              let ok = false;
              for (let waited = 0; waited <= resolveTimeoutMs; waited += 250) {
                const n = await loc.count();
                if (n > 1) throw new Error(`target ${JSON.stringify(step.target)} is ambiguous (${n} matches)`);
                if (n === 1 && await loc.isVisible()) { ok = true; break; }
                await page.waitForTimeout(250);
              }
              if (!ok) throw new Error(`target ${JSON.stringify(step.target)} not found/visible after ${resolveTimeoutMs / 1000} s`);
            }
            if (step.action === 'click') await loc.click({ timeout: 5000 });
            else if (step.action === 'hover') await loc.hover({ timeout: 5000 });
            else if (loc) await loc.scrollIntoViewIfNeeded();
            else await page.mouse.wheel(0, step.by);
            await page.waitForLoadState('domcontentloaded').catch(() => {});
            await page.waitForTimeout(settleMs);
            if (new URL(page.url()).origin !== origin) throw new Error(`navigated off-site to ${page.url()}`);
            break;
          }
          case 'wait': case 'mark': break;
          default: warnings.push(`step ${step.id}: action ${step.action} is not replayed by the dry check`);
        }
      } catch (e) { failures.push({ step: step.id, error: String(e.message || e).split('\n')[0] }); }
      if (step.action === 'mark') visited.push({ mark: step.id, url: new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash });
      if (failures.length && failures[failures.length - 1].step === step.id) break;   // later steps depend on this one
    }
    return { ok: failures.length === 0, failures, warnings, visited, seconds: +((Date.now() - t0) / 1000).toFixed(1) };
  } finally { await browser.close().catch(() => {}); }
}
