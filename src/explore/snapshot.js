// Snapshot of the live page: only what is visible, and only targets that resolve to EXACTLY ONE visible element
// under the same role+name(exact) lookup capture uses. Ambiguous targets are dropped, never guessed.
import crypto from 'node:crypto';
import { riskOf } from './safety.js';

export const MAX_TARGETS = 40;

/** Same lookup as capture's locate() for {role,name,exact}. */
export const locateTarget = (page, t) => page.getByRole(t.role, { name: t.name, exact: t.exact ?? true });

export async function snapshotPage(page) {
  const raw = await page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 4 && r.height > 4 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const txt = (e) => (e.getAttribute('aria-label') || e.innerText || e.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const roleOf = (e) => e.getAttribute('role') || ({ A: 'link', BUTTON: 'button', H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading' }[e.tagName]) || null;
    const items = [...document.querySelectorAll('a[href],button,[role=button],[role=tab],[role=menuitem],[role=link],h1,h2,h3,h4')]
      .filter(vis).map((e) => ({
        role: roleOf(e), name: txt(e), tag: e.tagName.toLowerCase(), download: e.hasAttribute('download'),
        offSite: e.tagName === 'A' && /^https?:/.test(e.href) && new URL(e.href).origin !== location.origin,
        submits: !!e.closest('form') && (e.tagName === 'BUTTON' ? (e.getAttribute('type') || 'submit') === 'submit' : false),
      })).filter((x) => x.role && x.name);
    // innerText never includes <input> values, so typed secrets cannot leak into the corpus
    return { title: document.title, url: location.href, items, text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 3500), scrollable: document.documentElement.scrollHeight - innerHeight };
  });
  const seen = new Set(), targets = [], skipped = [];
  for (const it of raw.items) {
    const key = `${it.role}|${it.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (it.role === 'heading') { targets.push({ role: 'heading', name: it.name, exact: true, scrollOnly: true }); continue; }   // headings: scroll anchors only
    const why = it.offSite ? 'links off-site' : riskOf(it);
    if (why) { skipped.push({ role: it.role, name: it.name, why }); continue; }
    targets.push({ role: it.role, name: it.name, exact: true });
  }
  const unique = [];
  for (const t of targets) {
    if (unique.length >= MAX_TARGETS) break;
    const n = await locateTarget(page, t).count().catch(() => 0);
    if (n === 1) unique.push(t); else skipped.push({ role: t.role, name: t.name, why: `ambiguous (${n} matches)` });
  }
  unique.forEach((t, i) => { t.id = `t${i + 1}`; });
  const snap = { title: raw.title, url: raw.url, screenText: raw.text, canScrollDownPx: Math.max(0, raw.scrollable), targets: unique };
  const hash = crypto.createHash('sha256').update(JSON.stringify({ u: snap.url, t: snap.screenText, g: unique.map((t) => `${t.role}|${t.name}`) })).digest('hex').slice(0, 16);
  return { ...snap, hash, skipped };
}

/** What the model sees (no internals). */
export const forModel = (s) => ({ title: s.title, url: s.url, screenText: s.screenText, canScrollDownPx: s.canScrollDownPx, targets: s.targets.map((t) => ({ id: t.id, role: t.role, name: t.name, ...(t.scrollOnly ? { note: 'scroll only' } : {}) })) });
