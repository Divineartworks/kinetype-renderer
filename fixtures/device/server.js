// Verkstedlogg fixture server: a neutral mobile web app (job log for tradespeople)
// used to build and test native device-capture drivers. Deterministic data, no network deps.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const STATIC = {
  '/': ['app.html', 'text/html; charset=utf-8'],
  '/office': ['office.html', 'text/html; charset=utf-8'],
  '/calibration': ['calibration.html', 'text/html; charset=utf-8'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
  '/icon.svg': ['icon.svg', 'image/svg+xml'],
  '/sw.js': ['sw.js', 'text/javascript; charset=utf-8'],
};

const SEED = [
  ['Bad – Hansen', 'Kari Hansen', 'Lindeveien 4, Oslo', 'in-progress', 48500],
  ['Varmepumpe – Berg', 'Ola Berg', 'Furuveien 12, Asker', 'planned', 32900],
  ['Kjøkken – Lund', 'Marit Lund', 'Storgata 18, Drammen', 'in-progress', 86000],
  ['Terrasse – Moen', 'Jon Moen', 'Solbakken 7, Bærum', 'done', 27400],
  ['Elbillader – Dahl', 'Silje Dahl', 'Bjerkealleen 3, Lillestrøm', 'planned', 18750],
  ['Pussing av fasade – Nygård', 'Per Nygård', 'Kirkeveien 55, Oslo', 'in-progress', 64200],
  ['Gulvvarme – Strand', 'Anne Strand', 'Havnegata 9, Moss', 'done', 21300],
  ['Vindusbytte – Eriksen', 'Tor Eriksen', 'Skogveien 21, Ski', 'planned', 53800],
  ['Garasjeport – Aas', 'Liv Aas', 'Engveien 2, Nesodden', 'done', 15900],
  ['Maling stue – Bakken', 'Nils Bakken', 'Parkveien 30, Oslo', 'in-progress', 12400],
  ['Trapp – Johansen', 'Eva Johansen', 'Åsveien 8, Hønefoss', 'planned', 39000],
  ['Våtrom – Kristiansen', 'Geir Kristiansen', 'Brattbakken 14, Drøbak', 'in-progress', 72500],
  ['Ventilasjon – Haugen', 'Hilde Haugen', 'Sjøgata 6, Sandvika', 'done', 29800],
  ['Tak over inngang – Pedersen', 'Rune Pedersen', 'Myrveien 19, Ås', 'planned', 22600],
  ['Sikringsskap – Olsen', 'Tone Olsen', 'Vestre vei 41, Oslo', 'in-progress', 16700],
  ['Kjellerstue – Larsen', 'Bjørn Larsen', 'Dalen 11, Kongsberg', 'planned', 94000],
  ['Takrenne – Solberg', 'Ingrid Solberg', 'Bakkeveien 27, Holmestrand', 'planned', 14300],
  ['Pergola – Andersen', 'Stian Andersen', 'Granveien 5, Fredrikstad', 'in-progress', 35100],
  ['Radonsperre – Paulsen', 'Mona Paulsen', 'Neslandsvei 33, Tønsberg', 'done', 41200],
  ['Dusjvegg – Halvorsen', 'Arne Halvorsen', 'Rosenborggata 2, Oslo', 'planned', 19400],
  ['Dører – Jensen', 'Randi Jensen', 'Lyngveien 16, Hamar', 'in-progress', 26800],
  ['Peisinnsats – Karlsen', 'Håkon Karlsen', 'Fjellveien 9, Lillehammer', 'done', 37600],
  ['Isolering loft – Martinsen', 'Wenche Martinsen', 'Kaiveien 1, Larvik', 'planned', 48900],
  ['Parkett – Svendsen', 'Trond Svendsen', 'Elvegata 24, Skien', 'in-progress', 31500],
  ['Carport – Ruud', 'Camilla Ruud', 'Sletta 13, Gjøvik', 'planned', 58300],
];
const LINES = [['Befaring og oppmåling', 0.1], ['Materialer', 0.45], ['Arbeid, timer à 890 kr', 0.45]];

const T0 = '2026-10-08T08:00:00.000Z';
function initial() {
  return {
    version: 1,
    lastEvent: { at: T0, text: 'Startet', jobId: null },
    events: [],
    jobs: SEED.map(([title, customer, address, status, amount], i) => ({
      id: i + 1, title, customer, address, status, amount,
      lines: LINES.map(([text, f]) => ({ text, amount: Math.round(amount * f / 100) * 100 })),
      extras: [],
    })),
  };
}

export async function startFixtureServer({ port = 0, host = '127.0.0.1', pollMs = 2000, latencyMs = 0 } = {}) {
  const state = initial();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const send = (res, code, type, body) => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  };
  const json = (res, obj, code = 200) => send(res, code, 'application/json; charset=utf-8', JSON.stringify(obj));
  const readBody = (req) => new Promise((resolve) => {
    let s = ''; req.on('data', (c) => { s += c; }); req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
  });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      if (p.startsWith('/api/')) {
        if (latencyMs > 0) await sleep(latencyMs);
        if (req.method === 'GET' && p === '/api/jobs') return json(res, { jobs: state.jobs, version: state.version });
        if (req.method === 'GET' && p === '/api/state') return json(res, { version: state.version, lastEvent: state.lastEvent });
        if (req.method === 'POST' && p === '/api/reset') {
          Object.assign(state, initial());
          return json(res, { ok: true, version: state.version });
        }
        const m = p.match(/^\/api\/jobs\/(\d+)\/extra$/);
        if (req.method === 'POST' && m) {
          const job = state.jobs.find((j) => j.id === Number(m[1]));
          if (!job) return json(res, { error: 'not found' }, 404);
          const body = await readBody(req);
          const text = String(body.text ?? '').trim() || 'Ekstraarbeid';
          const amount = Math.max(0, Math.round(Number(body.amount) || 0));
          job.extras.push({ text, amount });
          job.status = 'pending-approval';
          state.version += 1;
          state.lastEvent = { at: new Date().toISOString(), text: `Ekstraarbeid på ${job.title}: ${text}`, jobId: job.id };
          state.events.unshift(state.lastEvent);
          return json(res, { ok: true, version: state.version, job });
        }
        return json(res, { error: 'not found' }, 404);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'text/plain', 'method not allowed');
      const entry = STATIC[p];
      if (!entry) return send(res, 404, 'text/plain; charset=utf-8', 'Ikke funnet');
      let body = fs.readFileSync(path.join(DIR, entry[0]), 'utf8');
      if (p === '/office') {
        const poll = Number(url.searchParams.get('poll')) || pollMs;
        body = body.replace('<!--POLL-->', `<script>window.POLL_MS=${poll}</script>`);
      }
      return send(res, 200, entry[1], body);
    } catch (e) {
      send(res, 500, 'text/plain', String(e?.message ?? e));
    }
  });

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const actual = server.address().port;
  return {
    url: `http://${host}:${actual}`,
    port: actual,
    state,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const a = process.argv.slice(2);
  const arg = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
  const s = await startFixtureServer({
    port: Number(arg('--port', 8787)), host: arg('--host', '127.0.0.1'),
    pollMs: Number(arg('--poll', 2000)), latencyMs: Number(arg('--latency', 0)),
  });
  console.log(s.url);
}
