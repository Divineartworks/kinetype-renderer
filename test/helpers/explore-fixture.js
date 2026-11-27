// Local static fixture site + stub `claude` binary for explore tests.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PAGES = {
  '/': `<!doctype html><html lang="nb"><head><title>Acme Bygg</title></head><body>
<h1>Acme Bygg</h1><p>Vi har 42 prosjekter og pris fra 2,5 kr per time. Kontakt oss.</p>
<nav><a href="/projects">Se prosjekter</a> <a href="/contact">Kontakt</a> <a href="/contact2">Kontakt</a>
<a href="http://evil.example/steal">Besøk partner</a> <button id="jump" onclick="location.href='http://evil.example/x'">Gå videre</button></nav>
<form action="/never" method="post"><input name="user" placeholder="user"><button type="submit">Send inn</button></form>
<button onclick="document.title='deleted'">Slett konto</button>
<p>debug token=abcd1234efgh5678ijkl9999 visible by mistake</p></body></html>`,
  '/projects': `<!doctype html><html lang="nb"><head><title>Prosjekter</title></head><body><h1>Prosjekter</h1><p>Totalt 42 prosjekter i Oslo.</p><a href="/">Tilbake</a></body></html>`,
  '/contact': `<!doctype html><title>Kontakt</title><h1>Kontakt</h1>`,
  '/contact2': `<!doctype html><title>Kontakt 2</title><h1>Kontakt 2</h1>`,
};

export async function startFixture() {
  const hits = [];
  const srv = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    const body = PAGES[req.url.split('?')[0]];
    res.writeHead(body ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body || 'nope');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}`, hits, close: () => new Promise((r) => srv.close(r)) };
}

/** Stub claude: replies come from a scenario file; entries may name targets ("click":"Se prosjekter") and are resolved to ids from the prompt. */
export function makeStub(scenario) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-stub-'));
  const bin = path.join(dir, 'claude');
  fs.writeFileSync(path.join(dir, 'scenario.json'), JSON.stringify(scenario));
  fs.writeFileSync(bin, `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const dir = ${JSON.stringify(dir)};
let input = ''; process.stdin.on('data', (d) => (input += d)); process.stdin.on('end', () => {
  const calls = fs.existsSync(path.join(dir, 'calls.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'calls.json'))) : [];
  calls.push({ args: process.argv.slice(2), prompt: input });
  fs.writeFileSync(path.join(dir, 'calls.json'), JSON.stringify(calls));
  const sc = JSON.parse(fs.readFileSync(path.join(dir, 'scenario.json')));
  const repair = input.includes('Rewrite the flagged');
  const e = repair ? sc.repair : sc.steps[Math.min(calls.filter((c) => !c.prompt.includes('Rewrite the flagged')).length - 1, sc.steps.length - 1)];
  if (e.fail) { process.stderr.write('boom'); process.exit(1); }
  let reply;
  if (repair) reply = { lines: e.lines };
  else {
    const m = input.match(/CURRENT SCREEN[^\\n]*\\n([\\s\\S]*?)\\n\\nReply with ONE JSON/);
    const snap = JSON.parse(m[1]);
    const id = (name) => (snap.targets.find((t) => t.name === name) || { id: 'tNOPE' }).id;
    const doList = (e.do || []).map((a) => (a.name ? { type: a.type, target: id(a.name) } : a));
    reply = { say: e.say, next: doList.length ? { do: doList } : null, done: !!e.done };
  }
  const json = JSON.stringify(reply, null, 1);
  process.stdout.write(e.chatty === false ? json : 'Sure! Here is the plan {not json} for you:\\n\`\`\`json\\n' + json + '\\n\`\`\`\\nHope that helps {really}.');
});
`, { mode: 0o755 });
  return { bin, dir, calls: () => (fs.existsSync(path.join(dir, 'calls.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'calls.json'))) : []) };
}
