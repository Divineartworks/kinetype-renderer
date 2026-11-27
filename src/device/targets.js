// In-page target library for device transports. The adb transport talks raw CDP to Chrome on the phone,
// so there is no Playwright locator there: targets are resolved by this one function, evaluated in the page
// through Runtime.evaluate on BOTH transports (the headless stand-in runs exactly the same code).
//
// target = {selector} | {testId} | {role, name?} | {text}, plus exact/nth — the kinetype.flow.v1 vocabulary.
// Role/name is a pragmatic subset of ARIA (explicit role, the implicit roles a product UI uses, accessible
// name from aria-labelledby/aria-label/label/alt/placeholder/text); matching follows Playwright's default
// (case-insensitive, whitespace-normalised substring unless exact). Elements hidden from the accessibility
// tree are never matched. `probe` is the capture driver's fail-closed visibility test (3×3 hit points).
import { probeTarget } from '../capture/driver.js';

/** Runs in the page. Returns the library object; installed once per document as window.__ktDevice. */
export function deviceLib(probeSrc) {
  const probe = (0, eval)(`(${probeSrc})`);
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const IMPLICIT = (el) => {
    const t = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (t === 'button' || t === 'summary') return 'button';
    if (t === 'a' && el.hasAttribute('href')) return 'link';
    if (t === 'input') {
      if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'search') return 'searchbox';
      if (type === 'number') return 'spinbutton';
      if (type === 'range') return 'slider';
      if (['', 'text', 'email', 'tel', 'url'].includes(type)) return 'textbox';
      return null;
    }
    if (t === 'textarea') return 'textbox';
    if (t === 'select') return el.multiple ? 'listbox' : 'combobox';
    if (/^h[1-6]$/.test(t)) return 'heading';
    if (t === 'img' && el.getAttribute('alt')) return 'img';
    if (t === 'dialog') return 'dialog';
    if (t === 'ul' || t === 'ol') return 'list';
    if (t === 'li') return 'listitem';
    if (t === 'nav') return 'navigation';
    if (t === 'main') return 'main';
    if (t === 'output') return 'status';
    return null;
  };
  const roleOf = (el) => (el.getAttribute('role') || '').trim().split(/\s+/)[0] || IMPLICIT(el);
  const FROM_CONTENT = new Set(['button', 'link', 'heading', 'tab', 'menuitem', 'option', 'cell', 'listitem', 'checkbox', 'radio', 'switch', 'status', 'treeitem']);
  const textOf = (el) => {
    let s = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 3) s += n.textContent;
      else if (n.nodeType === 1 && !hiddenSelf(n)) s += ' ' + (n.getAttribute('aria-label') || (n.tagName === 'IMG' ? n.getAttribute('alt') || '' : textOf(n))) + ' ';
    }
    return s;
  };
  function nameOf(el) {
    const lb = el.getAttribute('aria-labelledby');
    if (lb) return norm(lb.split(/\s+/).map((id) => { const r = document.getElementById(id); return r ? textOf(r) : ''; }).join(' '));
    const al = el.getAttribute('aria-label');
    if (al && norm(al)) return norm(al);
    const t = el.tagName.toLowerCase();
    if (t === 'input' || t === 'textarea' || t === 'select') {
      if (['button', 'submit', 'reset'].includes(el.type)) return norm(el.value);
      const labels = el.labels ? [...el.labels] : [];
      if (labels.length) return norm(labels.map(textOf).join(' '));
      return norm(el.getAttribute('placeholder') || el.getAttribute('title') || '');
    }
    if (t === 'img') return norm(el.getAttribute('alt') || el.getAttribute('title') || '');
    if (FROM_CONTENT.has(roleOf(el))) return norm(textOf(el)) || norm(el.getAttribute('title') || '');
    return norm(el.getAttribute('title') || '');
  }
  function hiddenSelf(el) {
    if (el.hidden || el.getAttribute('aria-hidden') === 'true' || el.inert) return true;
    const cs = getComputedStyle(el);
    return cs.display === 'none' || cs.visibility === 'hidden';
  }
  function hidden(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) if (hiddenSelf(n)) return true;
    return false;
  }
  const matches = (have, want, exact) => (exact ? norm(have) === norm(want) : norm(have).toLowerCase().includes(norm(want).toLowerCase()));
  function find(t) {
    let els;
    if (t.selector) els = [...document.querySelectorAll(t.selector)];
    else if (t.testId || t.testid) els = [...document.querySelectorAll(`[data-testid="${CSS.escape(t.testId || t.testid)}"]`)];
    else if (t.role) {
      els = [...document.querySelectorAll('*')].filter((el) => roleOf(el) === t.role && !hidden(el) && (t.name === undefined || matches(nameOf(el), t.name, t.exact)));
    } else if (t.text) {
      const all = [...document.body.querySelectorAll('*')].filter((el) => !['SCRIPT', 'STYLE', 'TEMPLATE'].includes(el.tagName) && matches(el.textContent, t.text, t.exact) && !hidden(el));
      // the smallest elements that contain the text (Playwright getByText semantics)
      els = all.filter((el) => !all.some((o) => o !== el && el.contains(o)));
    } else els = [];
    if (t.nth !== undefined) els = els[t.nth] ? [els[t.nth]] : [];
    return els;
  }
  const held = new Map();
  let seq = 0;
  // ids must not repeat across documents (a tap that navigates starts a new library instance)
  const doc = Math.round(performance.timeOrigin).toString(36);
  const lib = {
    /** Resolve a target: count, plus box/visibility of the single match (held under an id for tracking). */
    locate(t) {
      const els = find(t);
      const out = { count: els.length };
      if (els.length !== 1) return out;
      const el = els[0];
      const id = `${doc}-t${++seq}`;
      held.set(id, el);
      const editable = el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
      return { ...out, id, ...probe(el), editable, focused: document.activeElement === el, role: roleOf(el), name: nameOf(el) };
    },
    probe(id) { const el = held.get(id); return el ? probe(el) : { gone: true }; },
    release(id) { held.delete(id); },
    /** Scroll offset of the scroller under the point (or of the document). */
    scrollerAt(p) {
      let el = document.elementFromPoint(Math.min(Math.max(p.x, 0), innerWidth - 1), Math.min(Math.max(p.y, 0), innerHeight - 1));
      while (el && el !== document.documentElement && el !== document.body) {
        const cs = getComputedStyle(el);
        if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) return { top: el.scrollTop, max: el.scrollHeight - el.clientHeight, doc: false };
        el = el.parentElement;
      }
      const se = document.scrollingElement;
      return { top: se.scrollTop, max: se.scrollHeight - se.clientHeight, doc: true };
    },
    metrics() {
      const vv = window.visualViewport || { offsetLeft: 0, offsetTop: 0, width: innerWidth, height: innerHeight, scale: 1, pageTop: scrollY, pageLeft: scrollX };
      const a = document.activeElement;
      const editable = !!a && (a.isContentEditable || (['INPUT', 'TEXTAREA'].includes(a.tagName) && !['button', 'submit', 'checkbox', 'radio'].includes(a.type)));
      return {
        dpr: devicePixelRatio, innerWidth, innerHeight, scrollX, scrollY,
        vv: { offsetLeft: vv.offsetLeft, offsetTop: vv.offsetTop, width: vv.width, height: vv.height, scale: vv.scale },
        screen: { width: screen.width, height: screen.height },
        standalone: matchMedia('(display-mode: standalone)').matches,
        editableFocused: editable,
        url: location.pathname + location.search + location.hash,
      };
    },
    /** Everything that decides where the page sits on the screen (calibration diagnostics). */
    diag() {
      const vv = window.visualViewport;
      const dm = ['fullscreen', 'standalone', 'minimal-ui', 'browser'].find((m) => matchMedia(`(display-mode: ${m})`).matches) || 'unknown';
      const rect = (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, position: getComputedStyle(e).position }; };
      return {
        devicePixelRatio, innerWidth, innerHeight, outerWidth, outerHeight,
        clientWidth: document.documentElement.clientWidth, clientHeight: document.documentElement.clientHeight,
        visualViewport: vv ? { offsetLeft: vv.offsetLeft, offsetTop: vv.offsetTop, pageLeft: vv.pageLeft, pageTop: vv.pageTop, width: vv.width, height: vv.height, scale: vv.scale } : null,
        screen: { width: screen.width, height: screen.height, availWidth: screen.availWidth, availHeight: screen.availHeight, orientation: screen.orientation?.type },
        displayMode: dm, scrollX, scrollY,
        viewportMeta: document.querySelector('meta[name=viewport]')?.content || null,
        userAgent: navigator.userAgent, url: location.origin + location.pathname, visibilityState: document.visibilityState,
        markers: Object.fromEntries([...document.querySelectorAll('[data-cal]')].map((e) => [e.dataset.cal, rect(e)])),
      };
    },
    /** Per-frame scroll timeline (read-only): [page ms, document scrollTop] on every animation frame since the last
     * drain — a frame-accurate record of what the page showed, for aligning recorder clocks. */
    drainScroll() {
      if (!this._sl) {
        this._sl = [];
        this._fl = [];
        const tick = (ts) => {
          const y = document.scrollingElement.scrollTop; const l = this._sl;
          if (!l.length || l[l.length - 1][1] !== y || l.length < 2) l.push([performance.timeOrigin + ts, y]);
          if (l.length > 2000) l.splice(0, 1000);
          // every animation frame's timestamp: Chrome's frame pacing as the page sees it (smoothness metric)
          this._fl.push(performance.timeOrigin + ts); if (this._fl.length > 4000) this._fl.splice(0, 2000);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }
      const out = this._sl; this._sl = [];
      out.frames = this._fl; this._fl = [];
      // keep the last point so a stretch without change still has its start
      if (out.length) this._sl.push(out[out.length - 1]);
      return { scroll: [...out], frames: out.frames };
    },
    /** DOM busy signal: something visibly says "loading" (aria-busy, progressbar, a skeleton). */
    busy() {
      const q = document.querySelectorAll('[aria-busy="true"],[role="progressbar"],.skeleton,[data-skeleton]');
      for (const el of q) if (!hidden(el)) { const r = el.getBoundingClientRect(); if (r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < innerHeight) return true; }
      return false;
    },
    /** Pre-warm: fonts loaded and every <img> decoded. */
    async ready() {
      if (document.fonts) await document.fonts.ready;
      await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
      return document.readyState;
    },
    /** Calibration overlay: four fixed magenta squares at known CSS positions (removed right after the check). */
    overlay(on, size = 24) {
      document.getElementById('__kt_cal')?.remove();
      if (!on) return null;
      // inset (12/88 % × 20/80 %): rounded corners, cutouts, edge-to-edge nav bars and toolbars live at the edges
      const w = innerWidth, h = innerHeight;
      const x0 = Math.round(w * 0.12), x1 = Math.round(w * 0.88) - size, y0 = Math.round(h * 0.2), y1 = Math.round(h * 0.8) - size;
      const pos = { tl: [x0, y0], tr: [x1, y0], bl: [x0, y1], br: [x1, y1] };
      const root = document.createElement('div');
      root.id = '__kt_cal';
      root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
      for (const [k, [x, y]] of Object.entries(pos)) {
        const d = document.createElement('div');
        d.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:${size}px;height:${size}px;background:#ff00ff`;
        root.appendChild(d);
      }
      document.documentElement.appendChild(root);
      return Object.fromEntries(Object.entries(pos).map(([k, [x, y]]) => [k, { x, y, w: size, h: size }]));
    },
    /** Momentum tail for the headless stand-in only (headless Chrome never flings after touchEnd). */
    fling(p, v, tau) {
      return new Promise((resolve) => {
        let el = document.elementFromPoint(Math.min(Math.max(p.x, 0), innerWidth - 1), Math.min(Math.max(p.y, 0), innerHeight - 1));
        while (el && el !== document.documentElement && el !== document.body) {
          const cs = getComputedStyle(el);
          if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) break;
          el = el.parentElement;
        }
        const sc = !el || el === document.documentElement || el === document.body ? document.scrollingElement : el;
        const t0 = performance.now(); const y0 = sc.scrollTop; const total = v * tau;
        const step = () => {
          const t = (performance.now() - t0) / 1000;
          const k = 1 - Math.exp(-t / tau);
          sc.scrollTop = y0 + total * k;
          if (Math.abs(v) * Math.exp(-t / tau) < 20 || t > 6) return resolve(sc.scrollTop);
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    },
  };
  return lib;
}

const LIB_SRC = `(${deviceLib})(${JSON.stringify(String(probeTarget))})`;

/** Expression that installs the library once per document and calls lib[method](...args). */
export function libCall(method, ...args) {
  return `(window.__ktDevice || Object.defineProperty(window, '__ktDevice', { value: ${LIB_SRC}, configurable: true }).__ktDevice).${method}(${args.map((a) => JSON.stringify(a)).join(',')})`;
}

export const describeTarget = (t) => JSON.stringify(t);
