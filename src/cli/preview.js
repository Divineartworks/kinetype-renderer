// Live preview: serves the engine with a player; reloads (keeping the
// playhead) whenever the spec, a template or the kit changes.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { startServer, ROOT } from './server.js';
import { resolve as resolveSpec, validate } from './spec.js';

export async function preview(specPath, { port, open = true } = {}) {
  const roots = {};
  const clients = new Set();
  const specDir = path.dirname(specPath);
  const srv = await startServer({
    extraRoots: roots,
    routes: {
      '/': (req, res) => { res.writeHead(302, { location: '/src/runtime/preview.html' }).end(); },
      '/__resolved': async (req, res) => {
        let body;
        try {
          const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
          const problems = await validate(spec, { specDir });
          if (problems.length) throw new Error('invalid spec:\n  - ' + problems.join('\n  - '));
          const r = await resolveSpec(spec, { specDir, roots });
          let audioUrl = null;
          if (spec.audio?.src) {
            const a = path.resolve(specDir, spec.audio.src);
            roots.audio = path.dirname(a);
            audioUrl = `/__root/audio/${encodeURIComponent(path.basename(a))}`;
          }
          body = { ...r, audioUrl, templateUrl: r.templateUrl };
        } catch (e) {
          body = { error: String(e.message || e) };
        }
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body));
      },
      '/__events': (req, res) => {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(': ok\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
      },
    },
  });
  let timer = null;
  const ping = () => { clearTimeout(timer); timer = setTimeout(() => clients.forEach((c) => c.write('data: reload\n\n')), 120); };
  const watchDirs = [path.join(ROOT, 'templates'), path.join(ROOT, 'src/kit')];
  for (const d of watchDirs) fs.watch(d, { recursive: true }, ping);
  fs.watch(specPath, ping);
  const url = `${srv.url}/src/runtime/preview.html`;
  console.error(`kinetype preview → ${url}   (space play/pause · ←/→ frame · shift+←/→ beat · H motion-blur)`);
  if (open && process.platform === 'darwin') spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
  return new Promise(() => {}); // run until killed
}
