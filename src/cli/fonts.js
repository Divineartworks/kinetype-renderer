// Font registry. Fonts are resolved by (family, weight, style) to a static TTF
// on disk; missing Google Fonts are fetched once (static instance, full
// character set) and pinned by sha256 in fonts/fonts.json.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT } from './server.js';

const DIR = path.join(ROOT, 'fonts');
const FILES = path.join(DIR, 'files');
const REG = path.join(DIR, 'fonts.json');

export function registry() {
  return fs.existsSync(REG) ? JSON.parse(fs.readFileSync(REG, 'utf8')) : {};
}
function saveRegistry(r) {
  const sorted = Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b)));
  const tmp = REG + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(sorted, null, 2) + '\n');
  fs.renameSync(tmp, REG);
}
export const fontKey = ({ family, weight = 400, style = 'normal' }) => `${family}|${weight}|${style}`;
export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Returns an absolute TTF path for the font spec, fetching from Google Fonts if needed. */
export async function ensureFont(f, { offline = false } = {}) {
  if (f.file) {
    const p = path.resolve(f.file);
    if (!fs.existsSync(p)) throw new Error(`font file not found: ${p}`);
    return p;
  }
  const reg = registry();
  const key = fontKey(f);
  const hit = reg[key];
  if (hit && fs.existsSync(path.join(FILES, hit.file))) return path.join(FILES, hit.file);
  if (offline) throw new Error(`font ${key} not installed (run: kinetype fonts add "${f.family}" ${f.weight ?? 400}${f.style === 'italic' ? ' --italic' : ''})`);
  const ital = f.style === 'italic' ? 1 : 0;
  const w = f.weight ?? 400;
  const fam = encodeURIComponent(f.family).replace(/%20/g, '+');
  const cssUrl = `https://fonts.googleapis.com/css2?family=${fam}:ital,wght@${ital},${w}`;
  const css = await (await fetch(cssUrl, { headers: { 'user-agent': 'curl/8' } })).text();
  const m = css.match(/url\((https:[^)]+\.ttf)\)/);
  if (!m) throw new Error(`Google Fonts has no static TTF for ${key} (${cssUrl}): ${css.slice(0, 160)}`);
  const buf = Buffer.from(await (await fetch(m[1])).arrayBuffer());
  fs.mkdirSync(FILES, { recursive: true });
  const file = `${f.family.replace(/[^A-Za-z0-9]+/g, '')}-${w}${ital ? 'i' : ''}.ttf`;
  fs.writeFileSync(path.join(FILES, file), buf);
  // re-read right before writing: parallel agents may be adding fonts too
  const fresh = registry();
  fresh[key] = { file, sha256: sha256(buf), license: 'OFL-1.1 (Google Fonts)', source: m[1], fetched: new Date().toISOString().slice(0, 10) };
  saveRegistry(fresh);
  return path.join(FILES, file);
}

/** Register fonts that are already on disk (used for the seed set). */
export function adopt(f, file, source) {
  const reg = registry();
  const buf = fs.readFileSync(path.join(FILES, file));
  reg[fontKey(f)] = { file, sha256: sha256(buf), license: 'OFL-1.1 (Google Fonts)', source, fetched: new Date().toISOString().slice(0, 10) };
  saveRegistry(reg);
}
