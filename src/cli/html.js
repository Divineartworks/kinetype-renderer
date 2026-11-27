// Single-file HTML export: engine + template + spec + fonts (+ audio) in one file.
import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { ROOT } from './server.js';
import { resolve as resolveSpec, validate } from './spec.js';
import { outDirFor } from './render.js';

export async function buildHtml(spec, { specPath, specDir, out, withAudio = true } = {}) {
  const problems = await validate(spec, { specDir });
  if (problems.length) throw new Error('invalid spec:\n  - ' + problems.join('\n  - '));
  if (spec.media && Object.keys(spec.media).length) throw new Error('html export does not embed footage/images yet (spec.media) — use `kinetype render` or `kinetype preview` for media compositions');
  const { COMPLEX } = await import('../kit/font.js');
  if (COMPLEX.test(JSON.stringify(spec.content || {}))) throw new Error('html export does not bundle the HarfBuzz shaper yet: complex-script text (Arabic, Hebrew, Indic…) — use `kinetype render` or `kinetype preview`');
  const resolved = await resolveSpec(spec, { specDir });
  const tpl = (id) => JSON.stringify(path.join(ROOT, 'templates', id, 'index.js'));
  const kids = Object.keys(resolved.templateUrls || {});
  const entry = [
    `import { start } from ${JSON.stringify(path.join(ROOT, 'src/runtime/standalone.js'))};`,
    `import main from ${tpl(spec.template)};`,
    ...kids.map((id, i) => `import t${i} from ${tpl(id)};`),
    `start(main, {${kids.map((id, i) => `${JSON.stringify(id)}: t${i}`).join(', ')}});`,
  ].join('\n');
  const res = await esbuild.build({
    stdin: { contents: entry, resolveDir: ROOT, sourcefile: 'kinetype-entry.js', loader: 'js' },
    bundle: true, write: false, format: 'iife', minify: true, target: 'es2022', legalComments: 'none',
    logLevel: 'silent',
  });
  const js = res.outputFiles[0].text;
  const fonts = Object.fromEntries(Object.entries(resolved.fontFiles).map(([k, v]) => [k, fs.readFileSync(v.path).toString('base64')]));
  let audioData = null;
  if (withAudio && spec.audio?.src) {
    const a = path.resolve(specDir, spec.audio.src);
    const mime = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg' }[path.extname(a).toLowerCase()] || 'audio/mpeg';
    audioData = `data:${mime};base64,${fs.readFileSync(a).toString('base64')}`;
  }
  const safe = (o) => JSON.stringify(o).replace(/</g, '\\u003c');
  const title = spec.name || spec.template;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title.replace(/[<&]/g, '')}</title>
<meta name="generator" content="kinetype">
</head><body>
<script>window.__KT_SPEC__=${safe(resolved.spec)};window.__KT_FONTS__=${safe(fonts)};window.__KT_AUDIO__=${audioData ? safe(audioData) : 'null'};</script>
<script>${js.replace(/<\/script/gi, '<\\/script')}</script>
</body></html>
`;
  const { name, dir } = outDirFor(spec, specPath, null);
  const file = path.resolve(out || path.join(dir, `${name}.html`));
  fs.writeFileSync(file, html);
  return file;
}
