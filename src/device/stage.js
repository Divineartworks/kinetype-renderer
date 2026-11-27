// CLEAN STAGE preflight: what would ruin a film is fixed or refused BEFORE the camera rolls — the lead's first
// real-emulator diag showed a "Translate page? Norwegian to English" bubble over the page, 12 open tabs, an update
// badge, a random clock and a charging battery. Every action is idempotent, logged ({name, ok, detail}) and, where it
// changes the device, undoable (`undo()` restores what it changed). Part of rehearse; perform refuses if not clean.
//
//   locale     system locale must be nb-NO (Norwegian keyboard æøå, Norwegian system strings, no translate offer).
//              Chrome's per-app locale is set to nb-NO (`cmd locale set-app-locales`, no root). The SYSTEM locale has
//              no rootless switch on a Play image: one-time `emulator -avd phone1 -change-locale nb-NO` (then re-save
//              the snapshot) — the preflight checks it and says exactly that when it is not.
//   translate  three guards: Chrome command line `--disable-features=Translate,TranslateUI` (needs chrome://flags
//              "Enable command line on non-rooted devices"; verified via chrome://version), a `notranslate` meta added
//              at document start through CDP (invisible, honoured by Chrome's translate), and the overlay check.
//   demo       SystemUI demo mode: clock 09:41, battery 100 % not charging, full wifi, mobile hidden, no notifications.
//   chrome     close every other tab (DevTools /json/close), first-run/sign-in promos off via the command line;
//              PWA: launch the installed WebAPK when `browser: "pwa"` (install = one-time, see the runbook).
//   overlay    Chrome's own rendering of the page (CDP screenshot — never contains native UI) vs the phone's screencap
//              of the viewport: any block that differs is a non-page overlay (bubble, prompt, toast, dialog) → fail,
//              with an annotated image.
import fs from 'node:fs';
import path from 'node:path';
import { decodeImage, writeAnnotated } from './media.js';
import { parseUiDump } from './uia.js';

/** The launcher icon of a home-screen web app: exact label match, clickable, on screen (ambiguity → none, never a guess). */
export function pwaLauncherIcon(nodes, name) {
  const n = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const hits = nodes.filter((x) => x.clickable && x.visibleToUser && /launcher/.test(x.package) && (n(x.text) === n(name) || n(x.desc) === n(name)) && x.bounds.w > 0 && x.bounds.h > 0);
  return hits.length === 1 ? hits[0] : null;
}

/** Chrome's own pinned web-app shortcut for `name` from `dumpsys shortcut` → the `am start` argv that replays its signed
 * ACTION_START_WEBAPP intent (webapp_mac is Chrome's HMAC over the URL, so Chrome opens it standalone exactly like the
 * home-screen icon). Independent of the launcher (whose icon can vanish on an unclean emulator shutdown). null = none. */
export function pwaShortcutIntent(dump, name) {
  const blocks = String(dump).split('ShortcutInfo {').slice(1).filter((b) => /packageName=com\.android\.chrome/.test(b.slice(0, 400)));
  const pick = (b, k) => { const m = new RegExp(`org\\.chromium\\.chrome\\.browser\\.${k}=([^,}\\]]*)`).exec(b); return m ? m[1].trim() : null; };
  const hits = blocks.filter((b) => /ACTION_START_WEBAPP/.test(b) && pick(b, 'webapp_short_name') === name && pick(b, 'webapp_mac') && pick(b, 'webapp_url'));
  if (!hits.length) return null;
  const b = hits[hits.length - 1]; // the newest pin
  const es = ['webapp_id', 'webapp_url', 'webapp_mac', 'webapp_name', 'webapp_short_name', 'webapp_scope'].flatMap((k) => (pick(b, k) ? ['--es', `org.chromium.chrome.browser.${k}`, pick(b, k)] : []));
  const ei = ['webapp_display_mode', 'webapp_shortcut_version', 'webapp_source'].flatMap((k) => (/^-?\d+$/.test(pick(b, k) || '') ? ['--ei', `org.chromium.chrome.browser.${k}`, pick(b, k)] : []));
  return ['am', 'start', '-a', 'com.google.android.apps.chrome.webapps.WebappManager.ACTION_START_WEBAPP', '-p', 'com.android.chrome', ...es, ...ei];
}

export const DEFAULT_STAGE = { locale: 'nb-NO', demo: true, translate: 'off', closeTabs: true, overlay: true, clock: '0941' };
const CHROME = 'com.android.chrome';
const CMDLINE = '/data/local/tmp/chrome-command-line';
const CHROME_FLAGS = '--disable-features=Translate,TranslateUI --disable-fre --no-default-browser-check --no-first-run --disable-signin-promo';

export const demoCommands = (clock = '0941') => [
  ['enter'], ['clock', '-e', 'hhmm', clock], ['battery', '-e', 'level', '100', '-e', 'plugged', 'false'],
  ['network', '-e', 'wifi', 'show', '-e', 'level', '4'], ['network', '-e', 'mobile', 'hide'], // no "3G" in the film
  ['notifications', '-e', 'visible', 'false'],
].map(([cmd, ...rest]) => ['am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', 'command', cmd, ...rest]);

/** Grayscale block-mean image (pure): `img` RGB, every `k`×`k` block → one value. */
function grayBlocks(img, k, { x0 = 0, y0 = 0, w = img.width, h = img.height } = {}) {
  const gw = Math.floor(w / k), gh = Math.floor(h / k), out = new Float32Array(gw * gh);
  for (let by = 0; by < gh; by++) for (let bx = 0; bx < gw; bx++) {
    let sum = 0, n = 0;
    for (let y = y0 + by * k; y < y0 + (by + 1) * k; y += Math.max(1, k >> 2)) for (let x = x0 + bx * k; x < x0 + (bx + 1) * k; x += Math.max(1, k >> 2)) {
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      const p = (y * img.width + x) * 3; sum += 0.299 * img.rgb[p] + 0.587 * img.rgb[p + 1] + 0.114 * img.rgb[p + 2]; n++;
    }
    out[by * gw + bx] = n ? sum / n : NaN;
  }
  return { v: out, w: gw, h: gh, k };
}

/** The page's rendering resampled into video px (nearest), so both images share one pixel grid. */
function pageInVideoPx(page) {
  const r = page.pxPerVideoPx ?? 1;
  if (Math.abs(r - 1) < 1e-3) return page;
  const w = Math.round(page.width / r), h = Math.round(page.height / r), rgb = Buffer.alloc(w * h * 3);
  if (r < 1.2) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const sx = Math.min(page.width - 1, Math.round(x * r)), sy = Math.min(page.height - 1, Math.round(y * r)); page.rgb.copy(rgb, (y * w + x) * 3, (sy * page.width + sx) * 3, (sy * page.width + sx) * 3 + 3); }
    return { rgb, width: w, height: h };
  }
  // downscaling (a max_size stream): box-average like the screencap's area resampling — nearest would alias text
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx0 = Math.floor(x * r), sx1 = Math.min(page.width, Math.max(sx0 + 1, Math.floor((x + 1) * r))), sy0 = Math.floor(y * r), sy1 = Math.min(page.height, Math.max(sy0 + 1, Math.floor((y + 1) * r)));
    let a = 0, b = 0, c = 0, n = 0;
    for (let yy = sy0; yy < sy1; yy++) for (let xx = sx0; xx < sx1; xx++) { const p = (yy * page.width + xx) * 3; a += page.rgb[p]; b += page.rgb[p + 1]; c += page.rgb[p + 2]; n++; }
    const q = (y * w + x) * 3; rgb[q] = a / n; rgb[q + 1] = b / n; rgb[q + 2] = c / n;
  }
  return { rgb, width: w, height: h };
}

/** Where the page has CONTENT (not its background colour): the samples that can tell offsets apart. */
function contentMask(pg) {
  const vals = [...pg.v].filter(Number.isFinite).sort((a, b) => a - b);
  const bg = vals[Math.floor(vals.length / 2)]; // a page is mostly background
  const m = new Uint8Array(pg.v.length);
  let n = 0;
  for (let i = 0; i < pg.v.length; i++) if (Number.isFinite(pg.v[i]) && Math.abs(pg.v[i] - bg) > 12) { m[i] = 1; n++; }
  return { m, n };
}

/**
 * Alignment cost of page (at offset) vs phone, measured on the page's CONTENT samples (text, markers, cards) with
 * the worst 15 % trimmed (a real overlay must not steer the registration). Rehearsal 4: a plain trimmed mean over
 * all samples was 0 at every offset on the sparse calibration page (the misaligned text fell into the trimmed 20 %)
 * and kept a 65 px misregistration.
 */
function alignCost(pg, ph, ox, oy, step, k, mask = null) {
  const d = [];
  const useMask = mask && mask.n >= 30;
  for (let y = 0; y < pg.h; y += step) for (let x = 0; x < pg.w; x += step) {
    if (useMask && !mask.m[y * pg.w + x]) continue;
    const vx = Math.round(x + ox / k), vy = Math.round(y + oy / k);
    if (vx < 0 || vy < 0 || vx >= ph.w || vy >= ph.h) { if (useMask) d.push(255); continue; } // content pushed off screen = mismatch
    const a = pg.v[y * pg.w + x], b = ph.v[vy * ph.w + vx];
    if (Number.isFinite(a) && Number.isFinite(b)) d.push(Math.abs(a - b));
  }
  if (d.length < (useMask ? 20 : 50)) return Infinity;
  d.sort((p, q) => p - q);
  const keep = d.slice(0, Math.max(1, Math.floor(d.length * 0.85)));
  return keep.reduce((p, q) => p + q, 0) / keep.length;
}

/**
 * Register the page rendering onto the screencap (pure): search the offset around the mapping's guess at ¼ scale
 * (±range px), then refine at 1 px. The overlay check must never depend on the first-guess mapping (rehearsal 3:
 * a ~50 px misregistration turned every text line into "overlay").
 */
export function registerPage(pageV, phone, guess, { range = 160 } = {}) {
  const k = 4;
  const pg = grayBlocks(pageV, k), ph = grayBlocks(phone, k), mk = contentMask(pg);
  let best = { ox: guess.ox, oy: guess.oy, cost: Infinity };
  for (let dy = -range; dy <= range; dy += k) for (let dx = -32; dx <= 32; dx += k) {
    // a uniform page aligns equally well at many offsets: the smallest shift wins ties (the guess is close)
    const c = alignCost(pg, ph, guess.ox + dx, guess.oy + dy, 2, k, mk) + 0.004 * (Math.abs(dx) + Math.abs(dy));
    if (c < best.cost) best = { ox: guess.ox + dx, oy: guess.oy + dy, cost: c };
  }
  const pf = grayBlocks(pageV, 1, { w: pageV.width, h: pageV.height }), pf1 = grayBlocks(phone, 1), mf = contentMask(pf);
  let fine = { ...best, cost: Infinity };
  for (let dy = -k; dy <= k; dy++) for (let dx = -k; dx <= k; dx++) {
    const c = alignCost(pf, pf1, best.ox + dx, best.oy + dy, 3, 1, mf) + 0.004 * (Math.abs(dx) + Math.abs(dy));
    if (c < fine.cost) fine = { ox: best.ox + dx, oy: best.oy + dy, cost: c };
  }
  return { ox: fine.ox, oy: fine.oy, cost: +fine.cost.toFixed(2), shift: { dx: fine.ox - guess.ox, dy: fine.oy - guess.oy } };
}

/**
 * Overlay detection, pure: page = Chrome's rendering of the viewport (CDP screenshot, page px; `pxPerVideoPx`),
 * phone = the screencap (video px), `mapping` = first guess of where the page sits. The page is REGISTERED onto the
 * screencap first; then blurred block means (16 px) are compared, and only a LARGE connected foreign region counts
 * (≥ 2 % of the viewport or ≥ 48×48 CSS px): antialiasing and text-raster differences never add up to that, a
 * bubble/dialog/sheet does. `ignore` = boxes (video px) allowed to differ (the focused field's caret).
 */
export function overlayDiff(page, phone, mapping, { block = 16, tol = 14, faint = 3, faintFill = 0.6, gap = 4, minAreaFrac = 0.02, minCss = 48, minFill = 0.35, ignore = [], register = true, visibleHeight = null } = {}) {
  let pageV = pageInVideoPx(page);
  // Chrome's capture is sized as if the URL bar were hidden (rehearsal 4: 2201 px vs 2055 visible): compare only what
  // the screen can show, else its bottom rows meet the gesture bar
  if (visibleHeight && visibleHeight < pageV.height) pageV = { ...pageV, height: Math.floor(visibleHeight), rgb: pageV.rgb.subarray(0, Math.floor(visibleHeight) * pageV.width * 3) };
  const reg = register ? registerPage(pageV, phone, mapping) : { ox: mapping.ox, oy: mapping.oy, shift: { dx: 0, dy: 0 } };
  const pg = grayBlocks(pageV, block), ph = grayBlocks(phone, block, { x0: Math.round(reg.ox), y0: Math.round(reg.oy), w: pageV.width, h: pageV.height });
  const bad = [];
  const diffs = new Float32Array(pg.w * pg.h).fill(NaN);
  for (let by = 0; by < pg.h; by++) for (let bx = 0; bx < pg.w; bx++) {
    const a = pg.v[by * pg.w + bx], b = ph.v[by * ph.w + bx];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const box = { x: reg.ox + bx * block, y: reg.oy + by * block, w: block, h: block };
    if (ignore.some((g) => box.x < g.x + g.w && box.x + box.w > g.x && box.y < g.y + g.h && box.y + box.h > g.y)) continue;
    const diff = Math.abs(a - b);
    diffs[by * pg.w + bx] = diff;
    if (diff > tol) bad.push({ bx, by, box, diff: Math.round(diff) });
  }
  // a faint but UNIFORM fill (Chrome's translate bubble: 250,248,255 on white) differs by only ~4 levels per block,
  // yet covers its whole box — glyph noise on a clean page never does
  const faintFrac = (bx0, by0, bx1, by1) => { let n = 0, f = 0; for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) { const d = diffs[y * pg.w + x]; if (!Number.isFinite(d)) continue; n++; if (d > faint) f++; } return n ? f / n : 0; };
  const minArea = Math.max(minAreaFrac * pageV.width * pageV.height, (minCss * (mapping.s || 1)) ** 2);
  // merge differing blocks within `gap` blocks of each other (a bubble's text lines are a line apart) into regions;
  // a region counts only if large (minArea) and reasonably filled (minFill of its box): scattered glyph differences never are
  const key = (b) => `${b.bx},${b.by}`;
  const map = new Map(bad.map((b) => [key(b), b]));
  const seen = new Set();
  const regions = [];
  for (const b of bad) {
    if (seen.has(key(b))) continue;
    const st = [b]; seen.add(key(b));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, cnt = 0, d = 0, gx0 = Infinity, gy0 = Infinity, gx1 = -Infinity, gy1 = -Infinity;
    while (st.length) {
      const c = st.pop(); cnt++; d += c.diff;
      gx0 = Math.min(gx0, c.bx); gy0 = Math.min(gy0, c.by); gx1 = Math.max(gx1, c.bx); gy1 = Math.max(gy1, c.by);
      x0 = Math.min(x0, c.box.x); y0 = Math.min(y0, c.box.y); x1 = Math.max(x1, c.box.x + c.box.w); y1 = Math.max(y1, c.box.y + c.box.h);
      for (let dy = -gap; dy <= gap; dy++) for (let dx = -gap; dx <= gap; dx++) { const nb = map.get(`${c.bx + dx},${c.by + dy}`); if (nb && !seen.has(key(nb))) { seen.add(key(nb)); st.push(nb); } }
    }
    const area = (x1 - x0) * (y1 - y0), ff = faintFrac(gx0, gy0, gx1, gy1);
    if (area >= minArea && (cnt * block * block >= minFill * area || ff >= faintFill)) regions.push({ x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0), blocks: cnt, meanDiff: Math.round(d / cnt), faintFill: +ff.toFixed(2) });
  }
  // second pass: grow from strong seeds THROUGH faint blocks (4-connected) — a bubble's uniform fill joins its title,
  // icon and button, which are far apart; a faint region needs ≥ 3 strong seeds inside to count
  const fseen = new Uint8Array(pg.w * pg.h);
  for (const b of bad) {
    const i0 = b.by * pg.w + b.bx;
    if (fseen[i0]) continue;
    const st = [i0]; fseen[i0] = 1;
    let gx0 = Infinity, gy0 = Infinity, gx1 = -Infinity, gy1 = -Infinity, n = 0, strong = 0, dsum = 0;
    while (st.length) {
      const i = st.pop(); const x = i % pg.w, y = (i - x) / pg.w;
      n++; dsum += diffs[i]; if (diffs[i] > tol) strong++;
      gx0 = Math.min(gx0, x); gy0 = Math.min(gy0, y); gx1 = Math.max(gx1, x); gy1 = Math.max(gy1, y);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= pg.w || ny >= pg.h) continue;
        const j = ny * pg.w + nx; if (fseen[j] || !(diffs[j] > faint)) continue;
        fseen[j] = 1; st.push(j);
      }
    }
    const box = { x: reg.ox + gx0 * block, y: reg.oy + gy0 * block, w: (gx1 - gx0 + 1) * block, h: (gy1 - gy0 + 1) * block };
    const area = box.w * box.h, ff = faintFrac(gx0, gy0, gx1, gy1);
    if (strong >= 3 && area >= minArea && ff >= faintFill && !regions.some((r) => box.x < r.x + r.w && box.x + box.w > r.x && box.y < r.y + r.h && box.y + box.h > r.y)) {
      regions.push({ x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h), blocks: n, meanDiff: Math.round(dsum / n), faintFill: +ff.toFixed(2), via: 'faint fill' });
    }
  }
  return { regions, badBlocks: bad.length, blocks: pg.w * pg.h, registration: reg, minArea: Math.round(minArea) };
}

/** Prepare the stage on an open transport. Returns {clean, actions, problems, undo()}. */
export async function prepareStage(tr, stage = {}, { debugDir = null, ready = async () => {}, log = () => {} } = {}) {
  const cfg = { ...DEFAULT_STAGE, ...stage };
  const actions = [], problems = [], undos = [];
  let localeReport = null;
  const act = async (name, fn) => {
    try { const detail = await fn(); actions.push({ name, ok: true, ...(detail !== undefined ? { detail } : {}) }); return detail; } catch (e) { actions.push({ name, ok: false, error: e.message }); return null; }
  };
  if (tr.kind === 'adb') {
    const a = tr.adb, S = tr.serial;
    const sh = async (argv, opts) => (await a.shell(S, argv, { timeoutMs: 20000, ...opts })).stdout.trim();
    // ---- locale ----
    if (cfg.locale) {
      const want = cfg.locale;
      const sys = await act('locale: read system locale', async () => ({ persist: await sh(['getprop', 'persist.sys.locale']), product: await sh(['getprop', 'ro.product.locale']), system_locales: await sh(['settings', 'get', 'system', 'system_locales']) }));
      localeReport = { want, system_locales: sys?.system_locales || null, persist: sys?.persist || null, product: sys?.product || null };
      const lang = want.slice(0, 2).toLowerCase(); // nb (Norwegian bokmål; "no" is the legacy code)
      const sysOk = !!sys && [sys.persist, sys.system_locales].some((v) => new RegExp(`^(${lang}|no)([-_]|$)`, 'i').test(v || ''));
      await act(`locale: Chrome per-app locale → ${want}`, async () => {
        const before = await sh(['cmd', 'locale', 'get-app-locales', CHROME]).catch(() => '');
        if (!new RegExp(want, 'i').test(before)) await sh(['cmd', 'locale', 'set-app-locales', CHROME, '--locales', want]);
        return { before, after: await sh(['cmd', 'locale', 'get-app-locales', CHROME]).catch(() => '') };
      });
      if (!sysOk) problems.push(`system locale is "${sys?.persist || sys?.system_locales || sys?.product || 'unknown'}", not ${want}: Norwegian keyboard/system strings need it. One-time fix (Play images have no root, so emulator -change-locale fails): \`kinetype device-locale --serial ${tr.serial} --locale ${want}\` (drives Settings), then re-save the "ready" snapshot`);
        }
    // ---- translate + Chrome promos: command line (verified via chrome://version) ----
    if (cfg.translate === 'off') {
      const prev = await act('chrome: read command line', () => sh(['cat', CMDLINE]).catch(() => ''));
      const want = `_ ${CHROME_FLAGS}`;
      if ((prev || '').trim() !== want) {
        await act('chrome: write command line (translate off, no first-run/sign-in promos)', () => sh(['sh', '-c', `echo '${want}' > ${CMDLINE}`]));
        undos.push(['chrome: restore command line', () => (prev ? sh(['sh', '-c', `echo '${prev.replace(/'/g, '')}' > ${CMDLINE}`]) : sh(['rm', '-f', CMDLINE]))]);
        await act('chrome: restart to apply flags', async () => { await sh(['am', 'force-stop', CHROME]); if (tr.baseUrl) await sh(['am', 'start', '-a', 'android.intent.action.VIEW', '-d', tr.baseUrl, CHROME]); await new Promise((r) => setTimeout(r, 2500)); tr.cdp = null; tr.devtools = null; });
      }
      // verify: chrome://version shows the command line Chrome actually runs with
      // (the command line is only honoured with chrome://flags "Enable command line on non-rooted devices"; the
      // notranslate meta + the overlay check below do not depend on it)
      await act('chrome: version after restart', async () => {
        await tr.attachCdp().catch(() => {});
        const v = await fetch(`http://127.0.0.1:${tr.devtools.port}/json/version`).then((r) => r.json()).catch(() => ({}));
        return { browser: v.Browser || null };
      });
      // second guard, independent of the flags: notranslate meta at document start
      await act('chrome: notranslate meta at document start (CDP)', async () => {
        if (!tr.cdp) await tr.attachCdp();
        await tr.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const add = () => { if (document.head && !document.querySelector('meta[name=google][content=notranslate]')) { const m = document.createElement('meta'); m.name = 'google'; m.content = 'notranslate'; document.head.appendChild(m); } }; add(); document.addEventListener('DOMContentLoaded', add); })()` });
        return true;
      });
    }
    // ---- SystemUI demo mode ----
    if (cfg.demo) {
      const allowed = await act('demo: read sysui_demo_allowed', () => sh(['settings', 'get', 'global', 'sysui_demo_allowed']));
      if (allowed !== '1') { await act('demo: allow', () => sh(['settings', 'put', 'global', 'sysui_demo_allowed', '1'])); undos.push(['demo: restore sysui_demo_allowed', () => sh(['settings', 'put', 'global', 'sysui_demo_allowed', allowed && allowed !== 'null' ? allowed : '0'])]); }
      for (const argv of demoCommands(cfg.clock)) await act(`demo: ${argv[6]}${argv.length > 7 ? ' ' + argv.slice(7).filter((x) => x !== '-e').join(' ') : ''}`, () => sh(argv));
      undos.push(['demo: exit', () => sh(['am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', 'command', 'exit'])]);
    }
    // ---- Chrome hygiene: one tab ----
    if (cfg.closeTabs) {
      await act('chrome: close every other tab', async () => {
        if (!tr.devtools) await tr.attachCdp();
        const targets = await a.devtoolsTargets(tr.devtools.port);
        const keep = tr.pageTargetId;
        const others = targets.filter((t) => t.type === 'page' && t.id !== keep);
        for (const t of others) await fetch(`http://127.0.0.1:${tr.devtools.port}/json/close/${t.id}`).catch(() => {});
        return { closed: others.length, kept: keep || null };
      });
    }
    if (tr.browser === 'pwa') {
      await act('pwa: find + launch the installed web app', async () => {
        const pk = (await sh(['pm', 'list', 'packages'])).split('\n').map((l) => l.replace('package:', '').trim()).filter((p) => p.startsWith('org.chromium.webapk.'));
        if (pk.length) {
          await sh(['monkey', '-p', pk[0], '-c', 'android.intent.category.LAUNCHER', '1']);
          await new Promise((r) => setTimeout(r, 2000)); await tr.attachCdp(); // the launched app is a new page target
          return { mode: 'webapk', packages: pk, launched: pk[0] };
        }
        // An http://localhost origin cannot be minted into a WebAPK (that needs HTTPS), so Chrome installs it as a
        // home-screen web-app shortcut instead: WebappActivity, standalone display, no URL bar — the same picture.
        const webapp = async () => /topResumedActivity=[^\n]*WebappActivity/.test(await sh(['dumpsys', 'activity', 'activities']));
        if (await webapp()) { await tr.attachCdp(); return { mode: 'shortcut', running: true }; }
        if (cfg.pwaName) {
          const argv = pwaShortcutIntent(await sh(['dumpsys', 'shortcut'], { timeoutMs: 30000 }), cfg.pwaName);
          if (argv) {
            await sh(argv);
            for (let k = 0; k < 12 && !(await webapp()); k++) await new Promise((r) => setTimeout(r, 500));
            if (await webapp()) { await new Promise((r) => setTimeout(r, 1500)); await tr.attachCdp(); return { mode: 'shortcut-intent', launched: cfg.pwaName }; }
          }
          await sh(['input', 'keyevent', 'KEYCODE_HOME']);
          await new Promise((r) => setTimeout(r, 1200));
          await sh(['uiautomator', 'dump', '/sdcard/kinetype-ui.xml']);
          const icon = pwaLauncherIcon(parseUiDump(await sh(['cat', '/sdcard/kinetype-ui.xml'])), cfg.pwaName);
          if (icon) {
            await sh(['input', 'tap', String(icon.bounds.x + (icon.bounds.w >> 1)), String(icon.bounds.y + (icon.bounds.h >> 1))]);
            for (let k = 0; k < 10 && !(await webapp()); k++) await new Promise((r) => setTimeout(r, 500));
            if (await webapp()) { await new Promise((r) => setTimeout(r, 1500)); await tr.attachCdp(); return { mode: 'shortcut', launched: cfg.pwaName }; }
          }
        }
        problems.push(`browser "pwa" but no installed web app${cfg.pwaName ? ` (no home-screen icon "${cfg.pwaName}" that opens standalone)` : ''}: install it once (Chrome ⋮ → Install app) — the device-capture notes (not shipped) — set stage.pwaName to its home-screen name, or use browser "chrome"`);
        return { packages: [] };
      });
    }
  }
  // ---- overlay check (both transports): page rendering vs what the screen shows ----
  let overlay = null;
  if (cfg.overlay) {
    overlay = await act('overlay: page rendering vs screencap', async () => {
      await ready(); // the page the film opens on, settled
      await new Promise((r) => setTimeout(r, 400));
      const metrics = await tr.metrics();
      const mapping = tr.mappingOf(metrics);
      const shot = await tr.cdp.send('Page.captureScreenshot', { format: 'png' });
      const page = await decodeImage(Buffer.from(shot.data, 'base64'));
      const phone = await tr.screencap();
      page.pxPerVideoPx = page.width / (metrics.innerWidth * mapping.s); // page screenshot px per video px
      const ignore = (await tr.evaluate(`(() => { const a = document.activeElement; if (!a || a === document.body) return []; const r = a.getBoundingClientRect(); return [{ x: r.x, y: r.y, w: r.width, h: r.height }]; })()`).catch(() => []))
        .map((b) => ({ x: mapping.ox + mapping.s * b.x - 8, y: mapping.oy + mapping.s * b.y - 8, w: mapping.s * b.w + 16, h: mapping.s * b.h + 16 }));
      const d = overlayDiff(page, phone, mapping, { ignore, visibleHeight: metrics.innerHeight * mapping.s }); // visible viewport in video px
      if (d.regions.length) {
        problems.push(`something that is not the page covers the viewport at ${d.regions.map((r) => `${r.w}×${r.h} px @ (${r.x}, ${r.y})`).join(', ')} — a browser bubble/prompt/dialog/toast (e.g. "Translate page?"); dismiss it or fix its cause, then rehearse again`);
        if (debugDir) { fs.mkdirSync(debugDir, { recursive: true }); await writeAnnotated(phone, path.join(debugDir, 'stage-screencap.png'), path.join(debugDir, 'stage-overlay.png'), d.regions.map((r) => ({ ...r, color: 'red' }))); await writeAnnotated(page, path.join(debugDir, 'stage-page.png'), path.join(debugDir, 'stage-page-annotated.png'), []); }
      }
      return { regions: d.regions, badBlocks: d.badBlocks, blocks: d.blocks, registration: d.registration, minArea: d.minArea };
    });
  }
  const clean = problems.length === 0 && actions.every((x) => x.ok || /read|verify/.test(x.name));
  return {
    clean, problems, actions, overlay, locale: localeReport && { ...localeReport, ok: !problems.some((p) => p.startsWith('system locale')) },
    async undo() {
      const done = [];
      for (const [name, fn] of undos.reverse()) { try { await fn(); done.push({ name, ok: true }); } catch (e) { done.push({ name, ok: false, error: e.message }); } }
      return done;
    },
  };
}

/** `kinetype device-stage`: prepare (and report) the stage on a device, or `--undo` its demo mode. */
export async function deviceStage({ serial, baseUrl, browser = 'chrome', transport = 'adb', undo = false, out, stage = {}, log = () => {} } = {}) {
  const { createTransport } = await import('./transport.js');
  const tr = await createTransport(transport, transport === 'adb' ? { serial, browser, baseUrl, log } : { log });
  try {
    await tr.open();
    if (undo) {
      if (tr.kind !== 'adb') return { undone: [] };
      await tr.adb.shell(tr.serial, ['am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', 'command', 'exit']);
      return { undone: ['demo: exit'], note: `the Chrome command line (${CMDLINE}) is left as is; delete it with: adb shell rm ${CMDLINE}` };
    }
    if (baseUrl && !tr.cdp) await tr.attachCdp().catch(() => {});
    const r = await prepareStage(tr, stage, { debugDir: out ? path.resolve(out) : null, log, ready: async () => { if (baseUrl) await tr.navigate(baseUrl); } });
    return { clean: r.clean, locale: r.locale, problems: r.problems, overlay: r.overlay, actions: r.actions, note: 'demo mode stays on until `kinetype device-stage --undo` (or a perform/rehearse releases it)' };
  } finally { await tr.close(); }
}
