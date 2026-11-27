// Speech analysis shared by the kinetic-captions core (in the page) and the
// director (`kinetype direct`, in Node): the same stress model decides which
// word goes giant in a frame and which line opens an episode. Pure functions.

export const STOP = new Set("you're i'm it's don't can't won't that's there's they're we're he's she's isn't aren't wasn't ain't gonna wanna actually really literally basically honestly just like kind sort thing things something anything everything going get got".split(' ').concat('a an the and or but if so to of in on at by for from with as is are was were be been am it its it\'s this that these those you your yours i me my we us our they them their he him his she her do does did not no yes just then than there here what why when how who will would can could should about into up out over under off all any some very really too also only even'.split(' ')).concat(
  // filler verbs: never a hero, never what a line is "about"
  'start started starting doing getting making gotta right again back more most less where being been around totally completely absolutely fully super extremely pretty maybe always basically obviously definitely probably simply exactly already still ever yet saying dude bro brother guys good okay alright fine anyway whatever stuff everybody everyone somebody someone nobody have has had because yourself myself himself herself themselves ourselves know knew think thought mean meant want wanted need needed say said says see saw look looked make made take took come came go goes went give gave tell told put let bro man guy guys okay yeah'.split(' ')));
export const PROFANE = /^(fuck|fucking|fucked|fuckin|motherfucking|motherfucker|shit|shitty|bitch|bitches|damn|goddamn|goddamnit|hell|ass|pussy|bullshit)$/i;
export const BREAK_BEFORE = new Set('why when but because so and then if while until unless though although'.split(' '));
const WEAK_START = new Set('and but so or because then like um uh well'.split(' '));
const WEAK_END = new Set('the a an to of and or but with for in on at my your his her their our is are was'.split(' '));

/** The episode's themes: content words the speaker keeps coming back to. */
export function themesOf(words) {
  const c = new Map();
  for (const w of words) if (contentWord(w)) { const k = w.text.toLowerCase(); c.set(k, (c.get(k) || 0) + 1); }
  return new Set([...c.entries()].filter(([, n]) => n >= 2).map(([k]) => k));
}

/** Strip surrounding punctuation (keeps apostrophes, hyphens, %, $ and letters of any script). */
export const cleanWord = (w) => w.replace(/^[^A-Za-z0-9'’$%À-￿-]+|[^A-Za-z0-9'’$%À-￿-]+$/g, '');
export const isStop = (w) => STOP.has(w.text.toLowerCase());
/** A word allowed to go giant: a content word, never an intensifier, stopword or contraction. */
export const contentWord = (w) => !isStop(w) && !PROFANE.test(w.text) && w.text.length >= 4 && !/['’]/.test(w.text);

/** Normalise transcript words → [{i, text, raw, start, end, emph, hero, stop}] with stress `s`. */
export function prepareWords(list) {
  // an ALL-CAPS transcript (caption-layer exports shout) would force every look
  // into capitals; restore natural case so mixed-case looks keep their voice
  const letters = list.map((w) => w.text).join('');
  const upper = (letters.match(/\p{Lu}/gu) || []).length, lower = (letters.match(/\p{Ll}/gu) || []).length;
  const shout = upper > 20 && upper > 9 * lower;
  const calm = (t) => (!shout ? t : /^i(['’](m|ve|ll|d))?[^a-z]*$/i.test(t) ? t.charAt(0) + t.slice(1).toLowerCase() : t.toLowerCase());
  const words = list.map((w, i) => { const t = calm(w.text); return { i, text: cleanWord(t) || t, raw: t, start: +w.start, end: w.end != null ? +w.end : +w.start + 0.3, emph: !!w.emph, hero: !!w.hero }; }).filter((w) => w.text);
  words.forEach((w, i) => (w.i = i));
  const counts = new Map();
  for (const w of words) { const k = w.text.toLowerCase(); counts.set(k, (counts.get(k) || 0) + 1); }
  for (const w of words) {
    const k = w.text.toLowerCase();
    let s = 0;
    if (PROFANE.test(k)) s += 3;
    if (!STOP.has(k)) s += 1 + Math.min(2, Math.max(0, w.text.length - 5) * 0.35);
    if (w.end - w.start > 0.42 && !STOP.has(k)) s += 1.2;
    if ((counts.get(k) || 0) >= 3 && !STOP.has(k)) s += 0.8;
    if (w.emph) s += 3;
    w.s = s;
    // sentence punctuation, when the transcript has it (Scribe does; bare whisper does not)
    w.stop = /[.!?…]["”’)]*$/.test(w.raw);
  }
  return words;
}

/** Caption phrases: cut at the speaker's pauses, word/char budgets and clause starts. */
export function phrasesOf(words, { pause = 0.32, maxWords = 4, maxChars = 22 } = {}) {
  const phrases = [];
  let cur = [];
  const flush = () => { if (cur.length) phrases.push({ words: cur }); cur = []; };
  for (let i = 0; i < words.length; i++) {
    const w = words[i], prev = words[i - 1];
    const gap = prev ? w.start - prev.end : 0;
    const chars = cur.reduce((a, x) => a + x.text.length + 1, 0) + w.text.length;
    if (cur.length && (gap > pause || cur.length >= maxWords || chars > maxChars || (BREAK_BEFORE.has(w.text.toLowerCase()) && cur.length >= 2) || (prev && prev.stop))) flush();
    cur.push(w);
  }
  flush();
  return phrases;
}

/**
 * Sentences / thought units for the director: split at sentence punctuation
 * when present, else at pauses ≥ `pause`; units longer than `maxDur` split at
 * their largest internal gap. Each: {words, start, end, text, gapBefore, gapAfter}.
 */
export function sentencesOf(words, { pause = 0.42, maxDur = 9 } = {}) {
  // measured silence (w.pauseAfter, from `annotatePauses`) beats timing gaps
  const gapAfterW = (w, nx) => (w.pauseAfter != null ? w.pauseAfter : nx ? nx.start - w.end : Infinity);
  const units = [];
  let cur = [];
  const flush = () => { if (cur.length) units.push(cur); cur = []; };
  for (let i = 0; i < words.length; i++) {
    const w = words[i], prev = words[i - 1];
    if (cur.length && prev && (prev.stop || gapAfterW(prev, w) >= pause)) flush();
    cur.push(w);
  }
  flush();
  const out = [];
  const split = (ws) => {
    const dur = ws[ws.length - 1].end - ws[0].start;
    if (dur <= maxDur || ws.length < 4) { out.push(ws); return; }
    let best = 1, bestGap = -1;
    for (let k = 2; k < ws.length - 1; k++) { const g = gapAfterW(ws[k - 1], ws[k]) + (BREAK_BEFORE.has(ws[k].text.toLowerCase()) ? 0.08 : 0); if (g > bestGap) { bestGap = g; best = k; } }
    split(ws.slice(0, best)); split(ws.slice(best));
  };
  units.forEach(split);
  // a short tail after a dramatic pause belongs to its line
  // ("rejection breeds … obsession"): fold units of ≤ 2 words into the previous
  for (let k = out.length - 1; k > 0; k--) {
    const a = out[k - 1], b = out[k];
    const pauseBetween = gapAfterW(a[a.length - 1], b[0]);
    if (b.length <= 2 && pauseBetween <= 1.6 && !a[a.length - 1].stop && b[b.length - 1].end - a[0].start <= maxDur + 2) { out.splice(k - 1, 2, [...a, ...b]); }
  }
  return out.map((ws, k) => {
    const prevW = k > 0 ? out[k - 1][out[k - 1].length - 1] : null, nextW = k < out.length - 1 ? out[k + 1][0] : null;
    const last = ws[ws.length - 1];
    // a unit really ends where its silence begins (edge-to-edge timings run on)
    const end = last.quietFrom != null && last.pauseAfter >= 0.1 ? Math.max(last.start + 0.12, last.quietFrom) : last.end;
    return { words: ws, start: ws[0].start, end, text: ws.map((w) => w.raw.trim()).join(' '), gapBefore: prevW ? gapAfterW(prevW, ws[0]) : ws[0].start, gapAfter: nextW ? gapAfterW(last, nextW) : Infinity, quietAfter: last.quietAt ?? null };
  });
}

/**
 * How well a line works as a hook/cold open/spike: dense stressed content,
 * short enough to land, starts clean, ends on a strong word, speaks to "you".
 * Returns {score, reasons[]}.
 */
export const FILLER = /^(uh|um|erm|uhm|hmm|mm|ah)$/i;
const FILLER_PAIRS = [['you', 'know'], ['i', 'mean'], ["i'm", 'saying'], ['you', 'feel'], ['kind', 'of'], ['sort', 'of']];

/** The speaker's own pause rhythm (from annotatePauses): what counts as a real break for THIS person. */
export function pauseStats(words) {
  const ps = words.map((w) => w.pauseAfter).filter((x) => x != null && x > 0.1).sort((a, b) => a - b);
  if (ps.length < 8) return { p50: 0.3, p80: 0.6, measured: false };
  const q = (f) => ps[Math.min(ps.length - 1, Math.floor(f * (ps.length - 1)))];
  return { p50: Math.max(0.15, q(0.5)), p80: Math.max(0.3, q(0.8)), measured: true };
}

/** Whether the transcript carries sentence punctuation (Scribe, punctuating whisper). */
export const isPunctuated = (words) => words.filter((w) => w.stop).length >= Math.max(3, words.length * 0.02);

const HARD_WEAK_START = new Set('and but so or because then like um uh well that from of the to is are was be been being in with for at on by as than'.split(' '));
const SUBJECT = /^(i|i'm|i've|i'll|i'd|you|you're|you've|you'll|we|we're|they|they're|he|he's|she|she's|it|it's|this|that's|there|there's|what|who|nobody|everybody|everyone|people|women|men|your|my|our|their|his|her|no|nothing|everything|life|love)$/i;
const IMPERATIVE = /^(stop|never|don't|do|go|get|look|listen|think|remember|imagine|forget|quit|start|be|make|take|let|let's|keep|protect|walk|leave|focus|trust|watch|wake)$/i;
const HARD_WEAK_END = new Set('the a an to of and or but with for in on at my your his her their our is are was were be been will would can could should must might gonna going not like exactly what just so because that this than if when'.split(' '));

/**
 * Can this line stand on its own as a hook/spike/cold open? A hard gate (the
 * score only ranks lines that pass it): punctuated transcripts need a whole
 * sentence (or a clause that ends one); unpunctuated ones need clean measured
 * pauses at both ends and no connective at either edge.
 */
/**
 * Trim connectives and filler off a line's edges ("and just wait till she
 * leaves you" → "just wait till she leaves you"). Returns a new unit, or null.
 */
export function trimEdges(u, words) {
  let a = 0, b = u.words.length - 1;
  while (a <= b && (HARD_WEAK_START.has(u.words[a].text.toLowerCase()) || FILLER.test(u.words[a].text))) a++;
  while (b >= a && (HARD_WEAK_END.has(u.words[b].text.toLowerCase()) || FILLER.test(u.words[b].text))) b--;
  if (b - a + 1 < 3) return null;
  if (a === 0 && b === u.words.length - 1) return u;
  const ws = u.words.slice(a, b + 1);
  const gapAfterW = (w, nx) => (w.pauseAfter != null ? w.pauseAfter : nx ? nx.start - w.end : Infinity);
  const prev = words[ws[0].i - 1], next = words[ws[ws.length - 1].i + 1];
  return { words: ws, start: ws[0].start, end: ws[ws.length - 1].end, text: ws.map((w) => w.raw.trim()).join(' '), gapBefore: prev ? gapAfterW(prev, ws[0]) : ws[0].start, gapAfter: next ? gapAfterW(ws[ws.length - 1], next) : Infinity, trimmed: true };
}

export function standsAlone(u, { pauses = { p50: 0.3, p80: 0.6 }, punctuated = false, prevWord = null, needPauses = true } = {}) {
  const ws = u.words, first = ws[0], last = ws[ws.length - 1];
  if (HARD_WEAK_START.has(first.text.toLowerCase()) || HARD_WEAK_END.has(last.text.toLowerCase())) return false;
  if (FILLER.test(last.text)) return false;
  if (punctuated) {
    if (!/[.!?…]["”’)]*$/.test(last.raw)) return false;
    const atSentence = !prevWord || prevWord.stop;
    const atClause = prevWord && /[,;:—–-]["”’)]*$/.test(prevWord.raw) && (!needPauses || u.gapBefore >= pauses.p50);
    return atSentence || atClause || (!needPauses && u.trimmed);
  }
  // a dangling adverb means the sentence goes on ("…makes it sometimes incredibly")
  if (/ly$/i.test(last.text) && !/^(only|family|early|holy|ugly|reply|apply|supply|belly|jelly|lonely|lovely|friendly|daily|really)$/i.test(last.text)) return false;
  return !needPauses || (u.gapBefore >= pauses.p50 && u.gapAfter >= pauses.p80);
}

export function quotability(u, { themes = null, title = null, pauses = { p50: 0.3, p80: 0.6 }, punctuated = false, prevStop = null } = {}) {
  const ws = u.words, n = ws.length, dur = u.end - u.start;
  const reasons = [];
  const content = ws.filter(contentWord);
  // emphasis comes from CONTENT words — profanity is punctuation on this kind of show
  const top = content.map((w) => w.s).sort((a, b) => b - a).slice(0, 3);
  let score = top.reduce((a, b) => a + b, 0) / Math.sqrt(Math.max(3, n)) * 2;
  if (content.length) { score += Math.min(3, content.length) * 0.6; reasons.push(`${content.length} content words (${content.slice(0, 3).map((w) => w.text).join(', ')})`); }
  else { score -= 3; reasons.push('no content words'); }
  if (n >= 4 && n <= 12) { score += 1.5; } else if (n < 3) { score -= 2; reasons.push('too short'); } else if (n > 16) { score -= 2; reasons.push('too long'); }
  if (dur >= 1.8 && dur <= 7) score += 1; else if (dur > 9) score -= 2;
  const first = ws[0].text.toLowerCase(), last = ws[n - 1];
  if (WEAK_START.has(first) || /^(of|the|to|that|a|an|it)$/i.test(first)) { score -= 1.2; reasons.push(`starts on "${first}"`); }
  if (WEAK_END.has(last.text.toLowerCase())) { score -= 2; reasons.push(`ends on "${last.text}"`); }
  else if (contentWord(last)) { score += 1.2; reasons.push(`lands on "${last.text}"`); }
  if (ws.some((w) => /^(you|your|you're|yourself)$/i.test(w.text))) { score += 0.8; reasons.push('speaks to "you"'); }
  // filler kills a quote
  let fill = ws.filter((w) => FILLER.test(w.text)).length;
  // "you know" is a tic only when it isn't a real question/clause ("do you know that…", "you know what…")
  const REAL_BEFORE = /^(do|did|would|don't|didn't|if|when|whether|as|to|let|could|should|will)$/i, REAL_AFTER = /^(that|what|how|why|when|where|who|which|the|this|it|him|her|them|me|yourself|exactly|nothing|everything)$/i;
  for (let k = 0; k + 1 < n; k++) for (const [a, b] of FILLER_PAIRS) {
    if (ws[k].text.toLowerCase() !== a || ws[k + 1].text.toLowerCase() !== b) continue;
    if ((k > 0 && REAL_BEFORE.test(ws[k - 1].text)) || (k + 2 < n && REAL_AFTER.test(ws[k + 2].text))) continue;
    fill++;
  }
  if (fill) { score -= fill >= 2 ? 3.5 : 1.2; reasons.push(`${fill} filler`); }
  const prof = ws.filter((w) => PROFANE.test(w.text)).length;
  if (prof === 1) score += 0.3; else if (prof > 2) { score -= (prof - 2) * 0.6; reasons.push(`${prof} profanities`); }
  if (/[?!]["”’)]*$/.test(last.raw)) score += 0.6;
  // clean in and out, measured against THIS speaker's own rhythm
  if (u.gapBefore < pauses.p50) { score -= 1.2; reasons.push('starts mid-thought'); }
  if (u.gapAfter < pauses.p50) { score -= 1.2; reasons.push('runs on'); } else if (u.gapAfter >= pauses.p80) score += 0.6;
  if (u.gapBefore >= pauses.p80) score += 0.4;
  // punctuated transcripts say exactly where a thought starts and ends
  if (/[,;:–—-]["”’)]*$/.test(last.raw)) { score -= 2.5; reasons.push('ends mid-clause'); }
  else if (/[.!?…]["”’)]*$/.test(last.raw)) { score += 0.8; reasons.push('ends the sentence'); }
  else if (punctuated) { score -= 1.2; reasons.push('unfinished sentence'); }
  if (punctuated && prevStop === false) { score -= 1.2; reasons.push('starts mid-sentence'); }
  // no punctuation to say a thought is whole: a line with no subject near its
  // start that doesn't open as a command is probably a fragment ("mental
  // psychological survival mechanism") — heavily penalised, not banned
  const hasTitle = title && ws.some((w) => title.has(w.text.toLowerCase()));
  if (!punctuated && !hasTitle) {
    const lead = ws.slice(0, 2).map((w) => w.text.toLowerCase());
    if (!IMPERATIVE.test(lead[0]) && !lead.some((t) => SUBJECT.test(t))) { score -= 2.5; reasons.push('fragment?'); }
  }
  if (ws.some((w, k) => k > 0 && w.text.toLowerCase() === ws[k - 1].text.toLowerCase() && !/^(very|so|really|no|yes|go|bye|ha)$/i.test(w.text))) { score -= 1.5; reasons.push('stutter'); }
  // "the fuck" / "the shit": the phrase continues ("wake the fuck up")
  if (n >= 2 && PROFANE.test(last.text) && /^(the|a)$/i.test(ws[n - 2].text)) { score -= 2; reasons.push('cut phrase'); }
  if (themes) { const th = [...new Set(content.map((w) => w.text.toLowerCase()).filter((t) => themes.has(t)))]; if (th.length) { score += Math.min(2, th.length) * 0.8; reasons.push(`theme: ${th.join(', ')}`); } }
  if (title) { const tt = [...new Set(ws.map((w) => w.text.toLowerCase()).filter((t) => title.has(t)))]; if (tt.length) { score += 1.5; reasons.push(`title words: ${tt.join(', ')}`); } }
  return { score: +score.toFixed(2), reasons, content: content.length, filler: fill };
}
