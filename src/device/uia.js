// Native Android UI targets (`target.os`): the accessibility tree from `uiautomator dump`, matched by
// package / text / resourceId / desc with the same rules as page targets (case-insensitive, whitespace-normalised
// substring unless exact; ambiguity is an error, never a guess). Bounds are screen px; the transport scales them to
// video px. Used for "the old way" flows in other apps (SMS, camera, share sheet, notifications).
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const ent = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#10;/g, '\n').replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&');

/** uiautomator XML → flat list of nodes {text, resourceId, desc, package, cls, clickable, focused, editable, bounds:{x,y,w,h}}. */
export function parseUiDump(xml) {
  const nodes = [];
  const re = /<node\b([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(xml))) {
    const a = {};
    for (const [, k, v] of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) a[k] = ent(v);
    const b = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(a.bounds || '');
    if (!b) continue;
    const [x1, y1, x2, y2] = b.slice(1).map(Number);
    nodes.push({
      text: a.text || '', resourceId: a['resource-id'] || '', desc: a['content-desc'] || '', package: a.package || '', cls: a.class || '',
      clickable: a.clickable === 'true', focused: a.focused === 'true', editable: /EditText/.test(a.class || '') || a.editable === 'true',
      visibleToUser: a['visible-to-user'] !== 'false', bounds: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 },
    });
  }
  return nodes;
}

const has = (have, want, exact) => (exact ? norm(have) === norm(want) : norm(have).toLowerCase().includes(norm(want).toLowerCase()));
/** resourceId "compose_message_text" matches "com.app:id/compose_message_text" (the id part), a full id matches exactly. */
const idMatch = (have, want) => (want.includes(':id/') ? have === want : have.endsWith(':id/' + want) || have === want);

export function matchOs(nodes, t, screen = null) {
  let out = nodes.filter((n) => (t.package === undefined || n.package === t.package)
    && (t.text === undefined || has(n.text, t.text, t.exact))
    && (t.desc === undefined || has(n.desc, t.desc, t.exact))
    && (t.resourceId === undefined || idMatch(n.resourceId, t.resourceId))
    && n.bounds.w > 1 && n.bounds.h > 1 && n.visibleToUser);
  // nested matches (a row and the label inside it): keep the smallest — its centre is inside the row anyway
  out = out.filter((n) => !out.some((o) => o !== n && inside(o.bounds, n.bounds) && (o.bounds.w * o.bounds.h < n.bounds.w * n.bounds.h)));
  if (t.nth !== undefined) out = out[t.nth] ? [out[t.nth]] : [];
  const onScreen = (b) => !screen || (b.x >= 0 && b.y >= 0 && b.x + b.w <= screen.width && b.y + b.h <= screen.height);
  return out.map((n) => ({ ...n, onScreen: onScreen(n.bounds) }));
}
const inside = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
