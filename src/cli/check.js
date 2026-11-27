// `kinetype check`: environment + every example spec. For each example:
// validate, boot the template, draw 4 times in scrambled order twice and
// require identical pixels (the seek-purity contract), check fonts/glyphs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ROOT, startServer } from './server.js';
import { launch, liveBrowser, openRuntime, chromePath, withTimeout } from './browser.js';
import { validate, resolve as resolveSpec } from './spec.js';

function probe(cmd, args) {
  try { return execFileSync(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString().split('\n')[0].trim(); } catch { return null; }
}

export async function check({ only, log = console.error, launch: launchFn = launch } = {}) {
  const env = {
    node: process.version,
    chrome: chromePath(),
    ffmpeg: probe('ffmpeg', ['-version']),
    librosa: (() => { try { return probe(process.env.KINETYPE_PYTHON || 'python3.11', ['-c', 'import librosa;print(librosa.__version__)']); } catch { return null; } })(),
    whisper: probe('which', ['whisper-cli']),
  };
  const files = fs.readdirSync(path.join(ROOT, 'examples')).filter((f) => f.endsWith('.json') && (!only || f.startsWith(only))).sort();
  const results = [];
  const roots = {};
  const srv = await startServer({ extraRoots: roots });
  // one Chrome crash must fail at most the example it hit, never every later one
  const browsers = liveBrowser(launchFn);
  try {
    for (const f of files) {
      const p = path.join(ROOT, 'examples', f);
      const r = { example: f };
      try {
        const spec = JSON.parse(fs.readFileSync(p, 'utf8'));
        r.template = spec.template;
        const problems = await validate(spec, { specDir: path.dirname(p) });
        if (problems.length) throw new Error('invalid: ' + problems.join('; '));
        const resolved = await resolveSpec(spec, { specDir: path.dirname(p), roots });
        const rt = await openRuntime(await browsers.get(), srv.url, resolved);
        const D = rt.info.duration;
        const times = [0.013, D * 0.37, D * 0.71, D - 1 / rt.info.fps];
        const hashAll = async (order) => {
          const out = {};
          for (const k of order) {
            const px = await withTimeout(rt.page.evaluate(async (t) => {
              await window.KT.seek(t);
              const c = document.getElementById('stage');
              const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
              let h = 2166136261;
              for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i], 16777619);
              return h >>> 0;
            }, times[k]), 60000, `seek(${times[k].toFixed(2)})`);
            out[k] = px;
          }
          return out;
        };
        const a = await hashAll([0, 1, 2, 3]), b = await hashAll([3, 1, 0, 2]);
        r.pure = [0, 1, 2, 3].every((k) => a[k] === b[k]);
        r.duration = D;
        r.frames = rt.info.frames;
        r.missingGlyphs = rt.info.missingGlyphs;
        r.errors = rt.errors;
        r.ok = r.pure && !Object.keys(r.missingGlyphs).length && !rt.errors.length;
        await rt.context.close();
      } catch (e) {
        r.ok = false;
        r.error = String(e.message || e).split('\n')[0];
      }
      log(`${r.ok ? 'ok  ' : 'FAIL'} ${f}${r.error ? ' — ' + r.error : ''}${r.pure === false ? ' — seek is not pure (order-dependent pixels)' : ''}`);
      results.push(r);
    }
  } finally {
    await browsers.close();
    await srv.close();
  }
  return { env, results, ok: results.every((r) => r.ok) && !!env.chrome && !!env.ffmpeg };
}
