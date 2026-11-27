// Claim guard: narration may only state numbers, prices, names and superlatives that exist in the corpus of the
// screens the explorer actually visited. Digits AND spelled-out numbers (English + Norwegian) are checked.
// Ported from the director donor (claimIssues/wordNumbers) and extended for Norwegian.

const UNITS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  // Norwegian. "en"/"ett" are the indefinite article as much as the number: excluded (as FORGE N3 does).
  null: 0, to: 2, tre: 3, fire: 4, fem: 5, seks: 6, sju: 7, syv: 7, åtte: 8, ni: 9, ti: 10, elleve: 11, tolv: 12,
  tretten: 13, fjorten: 14, femten: 15, seksten: 16, sytten: 17, atten: 18, nitten: 19,
};
const TENS = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  tjue: 20, tyve: 20, tretti: 30, tredve: 30, førti: 40, femti: 50, seksti: 60, sytti: 70, åtti: 80, nitti: 90,
};
const SCALES = { hundred: 100, thousand: 1e3, million: 1e6, millions: 1e6, hundre: 100, tusen: 1e3, millioner: 1e6, million_no: 1e6 };
const CONNECT = new Set(['and', 'og']);
const MORPHEMES = [...Object.keys(UNITS), ...Object.keys(TENS), 'hundre', 'tusen', 'og'].sort((a, b) => b.length - a.length);

/** "tjueto" → ['tjue','to'] ; null when the word is not fully made of number morphemes (and at least two). */
function compound(word) {
  if (word.length < 5) return null;
  const go = (rest) => {
    if (!rest) return [];
    for (const m of MORPHEMES) if (rest.startsWith(m)) { const t = go(rest.slice(m.length)); if (t) return [m, ...t]; }
    return null;
  };
  const parts = go(word);
  return parts && parts.length >= 2 ? parts : null;
}

/** Number words ("forty-two thousand three hundred", "tjueto", "to tusen fem hundre") → [42300, …]; only values ≥ 10. */
export function wordNumbers(text) {
  const raw = text.toLowerCase().replace(/\d+(?:[.,]\d+)*/g, ' # ').replace(/[,.;:!?]/g, ' | ').replace(/[^\p{L}\s|#-]/gu, ' ').replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  const toks = [];
  for (const w of raw) { const c = !(w in UNITS) && !(w in TENS) && !(w in SCALES) ? compound(w) : null; toks.push(...(c || [w])); }
  const out = []; let cur = null, total = 0;
  const flush = () => { if (cur !== null) out.push(total + cur); cur = null; total = 0; };
  let prev = '';
  for (const w of toks) {
    const was = prev; prev = w;
    if (w in UNITS) cur = (cur || 0) + UNITS[w];
    else if (w in TENS) cur = (cur || 0) + TENS[w];
    else if ((w === 'hundred' || w === 'hundre') && !(cur === null && was === '#')) cur = (cur === null ? 1 : cur) * 100;   // "hundre" alone = 100
    else if ((w === 'thousand' || w === 'tusen' || w === 'million' || w === 'millions' || w === 'millioner') && !(cur === null && was === '#')) { total += (cur === null ? 1 : cur) * SCALES[w]; cur = 0; }
    else if (CONNECT.has(w) && cur !== null) continue;
    else flush();
  }
  flush();
  return out.filter((n) => n >= 10);   // small words ("one", "to", "tre") are ordinary language, not claims
}

const variants = (n) => { const g = n.toLocaleString('en-US'); return [String(n), g, g.replace(/,/g, ' '), g.replace(/,/g, '.'), g.replace(/,/g, ' '), g.replace(/,/g, ' ')]; };
const norm = (t) => String(t).toLowerCase().replace(/[\s  ]+/g, ' ');

const SUPERLATIVES = ['best', 'beste', 'fastest', 'raskeste', 'cheapest', 'billigste', 'guaranteed', 'garantert', '#1', 'number one', 'nummer en', 'nummer én',
  'award', 'award-winning', 'prisvinnende', 'leading', 'ledende', 'market leader', 'markedsleder', 'trusted by', 'betrodd av', 'rated', 'biggest', 'største', 'largest', 'most popular', 'mest populære', 'only', 'eneste'];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasNumber = (hay, n) => new RegExp(`(?<![\\p{N}])${esc(n)}(?![\\p{N}]|[.,]\\p{N})`, 'u').test(hay);
const hasWord = (hay, w) => new RegExp(`(?<![\\p{L}\\p{N}])${esc(w)}(?![\\p{L}\\p{N}])`, 'u').test(hay);

/** Proper-noun-ish tokens in narration (capitalised, not at the start of a sentence). */
export function namesIn(text) {
  const out = [];
  const re = /(^|[.!?]\s+)?(\p{Lu}[\p{L}\p{N}'’-]+)/gu;
  for (const m of text.matchAll(re)) if (!m[1] && m.index > 0) out.push(m[2]);
  return out;
}

/** → [{step, error}] ; lines = [{id|step, say|text}], corpus = every visited screen's text joined. */
export function claimIssues(lines, corpus) {
  const hay = norm(corpus);
  const out = [];
  for (const l of lines) {
    const step = l.id || l.step, say = l.say ?? l.text;
    if (!say || !String(say).trim()) { out.push({ step, error: 'narration line is empty' }); continue; }
    for (const n of say.match(/\d+(?:[.,]\d+)*/g) || []) if (!hasNumber(hay, n)) out.push({ step, error: `claim "${n}" is not on the visited screens` });
    for (const n of wordNumbers(say)) if (!variants(n).some((v) => hasNumber(hay, v))) out.push({ step, error: `claim "${n}" (spelled out) is not on the visited screens` });
    const s = norm(say);
    for (const w of SUPERLATIVES) if (hasWord(s, w) && !hasWord(hay, w)) out.push({ step, error: `claim "${w}" is not supported by the visited screens` });
    for (const nm of namesIn(say)) if (!hay.includes(nm.toLowerCase())) out.push({ step, error: `name "${nm}" is not on the visited screens` });
  }
  return out;
}
