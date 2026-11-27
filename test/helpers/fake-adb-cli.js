#!/usr/bin/env node
// Fake `adb` for the rig (test/helpers/fake-android.js): forwards argv to the harness's control server
// (FAKE_ADB_CTL), prints what comes back, exits with its code. A {block:true} answer (the scrcpy server shell)
// keeps the process alive until SIGTERM, which it reports to the harness (/killed) before exiting.
const ctl = process.env.FAKE_ADB_CTL;
if (!ctl) { process.stderr.write('fake adb: FAKE_ADB_CTL not set\n'); process.exit(127); }
const post = (p, body) => fetch(ctl + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
try {
  const r = await (await post('/cmd', { argv: process.argv.slice(2) })).json();
  // pipes are async: exit only after stdout has been flushed
  if (r.stdout) await new Promise((res) => process.stdout.write(Buffer.from(r.stdout, 'base64'), res));
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.block) {
    setInterval(() => {}, 1 << 30);
    process.on('SIGTERM', async () => { await post('/killed', { argv: process.argv.slice(2) }).catch(() => {}); process.exit(143); });
  } else process.exit(r.code ?? 0);
} catch (e) {
  process.stderr.write(`fake adb: ${e.message}\n`);
  process.exit(1);
}
