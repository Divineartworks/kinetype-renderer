// Minimal Chrome DevTools Protocol client over a WebSocket (Node 22 global WebSocket). Used for Chrome on the
// phone (adb-forwarded devtools socket), where Playwright cannot attach; same send/on surface as a Playwright
// CDPSession so the device driver runs unchanged on both transports.
export async function connectCdp(wsUrl, { timeoutMs = 10000 } = {}) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`CDP connect timeout ${wsUrl}`)), timeoutMs);
    ws.addEventListener('open', () => { clearTimeout(t); resolve(); }, { once: true });
    ws.addEventListener('error', (e) => { clearTimeout(t); reject(new Error(`CDP connect failed ${wsUrl}: ${e.message || 'error'}`)); }, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(typeof m.data === 'string' ? m.data : Buffer.from(m.data).toString('utf8'));
    if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`)); else p.resolve(msg.result);
    } else for (const fn of listeners.get(msg.method) || []) fn(msg.params);
  });
  ws.addEventListener('close', () => { for (const p of pending.values()) p.reject(new Error('CDP socket closed')); pending.clear(); });
  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const i = ++id;
        pending.set(i, { resolve, reject, method });
        ws.send(JSON.stringify({ id: i, method, params }));
      });
    },
    on(ev, fn) { if (!listeners.has(ev)) listeners.set(ev, new Set()); listeners.get(ev).add(fn); },
    off(ev, fn) { listeners.get(ev)?.delete(fn); },
    close() { try { ws.close(); } catch {} },
  };
}
