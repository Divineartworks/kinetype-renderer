// Local static server + frame sink. Binds 127.0.0.1 only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.css': 'text/css',
  '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.mp4': 'video/mp4',
};

/**
 * @param {{onFrame?:(job:string,i:number,buf:Buffer)=>Promise<void>|void, onFile?:(job:string,name:string,buf:Buffer)=>Promise<void>|void, extraRoots?:Record<string,string>, routes?:Record<string,(req,res)=>void>}} hooks
 */
export function startServer(hooks = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://x');
      if (hooks.routes?.[u.pathname]) return hooks.routes[u.pathname](req, res, u);
      if (u.pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
      if (req.method === 'POST' && (u.pathname === '/__frame' || u.pathname === '/__file')) {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const buf = Buffer.concat(chunks);
        const job = u.searchParams.get('job');
        if (u.pathname === '/__frame') await hooks.onFrame?.(job, Number(u.searchParams.get('i')), buf, u.searchParams.get('ex') ? JSON.parse(u.searchParams.get('ex')) : null);
        else await hooks.onFile?.(job, u.searchParams.get('name'), buf);
        res.writeHead(204).end();
        return;
      }
      let file;
      const m = u.pathname.match(/^\/__root\/([^/]+)\/(.*)$/);
      if (m && hooks.extraRoots?.[m[1]]) {
        const base = hooks.extraRoots[m[1]];
        file = path.resolve(base, decodeURIComponent(m[2]));
        if (file !== base && !file.startsWith(base + path.sep)) throw Object.assign(new Error('forbidden'), { code: 403 });
      } else {
        file = path.resolve(ROOT, '.' + decodeURIComponent(u.pathname));
        if (file !== ROOT && !file.startsWith(ROOT + path.sep)) throw Object.assign(new Error('forbidden'), { code: 403 });
      }
      const st = fs.statSync(file, { throwIfNoEntry: false });
      if (!st || !st.isFile()) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      res.writeHead(e.code === 403 ? 403 : 500).end(String(e.message || e));
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port, url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}
