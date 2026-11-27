// `kinetype device-locale --serial S --locale nb-NO`: set the SYSTEM language of a Play-image emulator, which
// has no root (`emulator -change-locale` runs `su 0 setprop …` and fails), by driving the Settings app like a person:
// Languages → System languages → Add a language → search "norsk" → Norsk bokmål → region Norge → "Change system
// language?" → Change. Each step dumps the screen (uiautomator), recognises it by its labels — in English OR already
// Norwegian — and acts; if nb is already in the list but not first it is dragged to the top. Idempotent (nothing to do
// when the system language is already nb), verified with `settings get system system_locales` /
// `getprop persist.sys.locale`, and it refuses (exit 1) unless nb-NO ends up FIRST. A screen it does not recognise is
// saved (XML) and reported — never guessed.
import fs from 'node:fs';
import path from 'node:path';
import { parseUiDump } from './uia.js';

const T = {
  languages: /^(Languages|Språk)$/i,
  systemLanguages: /^(System languages|Systemspråk)$/i,
  addLanguage: /^(\+ ?)?(Add a language|Legg til et språk)$/i,
  nb: /^Norsk bokmål/i,
  norge: /^(Norge|Norway)$/i,
  changeTitle: /(Change system language|Endre systemspråk|systemspråket til)/i,
  changeBtn: /^(Change|Endre)$/i,
  searchDesc: /^(Search|Søk)/i,
};
const centre = (n) => ({ x: Math.round(n.bounds.x + n.bounds.w / 2), y: Math.round(n.bounds.y + n.bounds.h / 2) });
const isNb = (v) => /^(nb|no)([-_]|$)/i.test(String(v || '').trim());

/** Read the system locale list (first = active) the way the stage checks it. */
export async function readLocale(io) {
  const sys = (await io.sh(['settings', 'get', 'system', 'system_locales']).catch(() => '')).trim();
  const persist = (await io.sh(['getprop', 'persist.sys.locale']).catch(() => '')).trim();
  const list = sys && sys !== 'null' ? sys.split(',') : [];
  return { system_locales: sys && sys !== 'null' ? sys : null, persist: persist || null, first: list[0] || persist || null, nbFirst: isNb(list[0] || persist) };
}

/** Classify one screen (pure): what is it, and what would a person tap next. */
export function classify(nodes) {
  const txt = (re) => nodes.find((n) => re.test(n.text) && n.bounds.w > 1);
  const desc = (re) => nodes.find((n) => re.test(n.desc) && n.bounds.w > 1);
  if (nodes.some((n) => T.changeTitle.test(n.text))) { const b = txt(T.changeBtn); if (b) return { screen: 'confirm-change', tap: b }; }
  const regionList = nodes.filter((n) => /^(Norge|Svalbard og Jan Mayen|Norway|Svalbard & Jan Mayen)$/i.test(n.text));
  if (regionList.length >= 2) return { screen: 'region', tap: txt(T.norge) };
  const add = txt(T.addLanguage);
  const nbItems = nodes.filter((n) => T.nb.test(n.text));
  // the System languages list: a "+ Add a language" row (and the current languages above it)
  if (add && nodes.some((n) => /locale_list|dragList|Remove|Fjern/i.test(n.resourceId + n.desc + n.text) || n.resourceId.includes('add_language'))) {
    if (nbItems.length) {
      const langs = nodes.filter((n) => n.resourceId.endsWith(':id/label') || n.resourceId.endsWith(':id/locale_title')).sort((a, b) => a.bounds.y - b.bounds.y);
      const nb = langs.find((n) => T.nb.test(n.text));
      if (nb && langs[0] !== nb) return { screen: 'system-languages', drag: { from: centre(nb), to: { x: centre(nb).x, y: langs[0].bounds.y + 4 } }, nbRow: nb };
      return { screen: 'system-languages', done: true };
    }
    return { screen: 'system-languages', tap: add };
  }
  // the language picker (all languages, or search results): tap Norsk bokmål if listed, else search for it
  if (nodes.some((n) => /Suggested|Foreslåtte|All languages|Alle språk/i.test(n.text)) || nodes.some((n) => n.resourceId.endsWith(':id/search_src_text'))) {
    if (nbItems.length) return { screen: 'language-picker', tap: nbItems[0] };
    const field = nodes.find((n) => n.resourceId.endsWith(':id/search_src_text') && n.bounds.w > 1);
    if (field) return { screen: 'language-picker', type: { field, text: 'norsk' } };
    const s = desc(T.searchDesc) || nodes.find((n) => n.resourceId.endsWith(':id/search') || n.resourceId.endsWith(':id/search_button'));
    if (s) return { screen: 'language-picker', tap: s };
  }
  // Settings → System → Languages (Android 13+): open "System languages"
  const sl = txt(T.systemLanguages);
  if (sl && nodes.some((n) => T.languages.test(n.text) || /App languages|Appspråk/i.test(n.text))) return { screen: 'languages', tap: sl };
  return { screen: 'unknown' };
}

/** Drive Settings until nb-NO is the first system language. io: {sh(argv) → stdout, dump() → xml}. */
export async function setDeviceLocale(io, { locale = 'nb-NO', debugDir = null, log = () => {}, maxSteps = 24, settleMs = 900 } = {}) {
  if (!/^nb(-NO)?$/i.test(locale)) throw new Error(`device-locale: only nb-NO is automated (asked: ${locale})`);
  const before = await readLocale(io);
  const steps = [];
  if (before.nbFirst) return { ok: true, changed: false, before, after: before, steps };
  await io.sh(['am', 'start', '-a', 'android.settings.LOCALE_SETTINGS']);
  const wait = () => new Promise((r) => setTimeout(r, settleMs));
  await wait();
  let lastScreen = null, repeats = 0;
  for (let i = 0; i < maxSteps; i++) {
    const xml = await io.dump();
    const nodes = parseUiDump(xml);
    const c = classify(nodes);
    steps.push({ screen: c.screen, action: c.tap ? `tap "${c.tap.text || c.tap.desc || c.tap.resourceId}"` : c.type ? `type "${c.type.text}"` : c.drag ? 'drag Norsk bokmål to the top' : c.done ? 'done' : 'none' });
    log(`device-locale: ${steps.at(-1).screen} → ${steps.at(-1).action}`);
    if (c.screen === lastScreen) repeats++; else repeats = 0;
    lastScreen = c.screen;
    if (c.screen === 'unknown' || repeats >= 3) {
      if (debugDir) { fs.mkdirSync(debugDir, { recursive: true }); fs.writeFileSync(path.join(debugDir, `locale-screen-${i}.xml`), xml); }
      break;
    }
    if (c.done) break;
    if (c.tap) { const p = centre(c.tap); await io.sh(['input', 'tap', String(p.x), String(p.y)]); }
    else if (c.type) { const p = centre(c.type.field); await io.sh(['input', 'tap', String(p.x), String(p.y)]); await io.sh(['input', 'text', c.type.text]); }
    else if (c.drag) await io.sh(['input', 'draganddrop', String(c.drag.from.x), String(c.drag.from.y), String(c.drag.to.x), String(c.drag.to.y), '1500']);
    await wait();
    if (c.screen === 'confirm-change' || c.drag) { const now = await readLocale(io); if (now.nbFirst) break; }
  }
  const after = await readLocale(io);
  await io.sh(['input', 'keyevent', 'KEYCODE_HOME']).catch(() => {});
  return { ok: after.nbFirst, changed: !before.nbFirst && after.nbFirst, before, after, steps, ...(after.nbFirst ? {} : { error: `system language is still "${after.first}" after ${steps.length} step(s) — last screen "${lastScreen}"${debugDir ? `, saved in ${debugDir}` : ''}; set it by hand: Settings → System → Languages → System languages → Add a language → Norsk bokmål (Norge) → Change` }) };
}

/** CLI: adb-backed io. */
export async function deviceLocale({ serial, locale = 'nb-NO', out, log = () => {} } = {}) {
  const adb = await import('./adb.js');
  const devs = await adb.devices();
  serial ||= devs.find((d) => d.state === 'device')?.serial;
  if (!devs.some((d) => d.serial === serial && d.state === 'device')) throw new Error(`adb: device ${serial || '(none)'} not attached`);
  const io = {
    sh: async (argv) => (await adb.shell(serial, argv, { timeoutMs: 30000 })).stdout,
    dump: async () => { const r = await adb.adb(['exec-out', 'uiautomator', 'dump', '/dev/tty'], { serial, timeoutMs: 30000 }); return r.stdout.slice(0, r.stdout.lastIndexOf('</hierarchy>') + 12); },
  };
  const r = await setDeviceLocale(io, { locale, debugDir: out ? path.resolve(out) : null, log });
  return { serial, ...r };
}
