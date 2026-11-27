// Template registry (Node side). Templates are discovered by directory and
// loaded on demand, so a broken or in-progress template never takes the
// others down, and adding one is just adding templates/<id>/index.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const cache = new Map();

export function templateIds() {
  return fs.readdirSync(DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && fs.existsSync(path.join(DIR, d.name, 'index.js')))
    .map((d) => d.name)
    .sort();
}

export async function loadTemplate(id) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id || '')) throw new Error(`bad template id "${id}"`);
  if (cache.has(id)) return cache.get(id);
  const file = path.join(DIR, id, 'index.js');
  if (!fs.existsSync(file)) throw new Error(`unknown template "${id}". Known: ${templateIds().join(', ')}`);
  const mod = (await import(pathToFileURL(file).href)).default;
  if (!mod || mod.id !== id) throw new Error(`templates/${id}/index.js must default-export a template with id "${id}"`);
  cache.set(id, mod);
  return mod;
}

/** Load every template; broken ones are reported, not thrown. */
export async function loadAll() {
  const ok = [], broken = [];
  for (const id of templateIds()) {
    try { ok.push(await loadTemplate(id)); } catch (e) { broken.push({ id, error: String(e.message || e).split('\n')[0] }); }
  }
  return { templates: ok, broken };
}

export const templateUrl = (id) => `/templates/${id}/index.js`;
