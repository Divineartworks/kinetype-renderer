import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { chromePath } from '../src/cli/browser.js';
import { flowProblems } from '../src/capture/flow.js';
import { wordNumbers, claimIssues, namesIn } from '../src/explore/claim.js';
import { extractJson } from '../src/explore/claude.js';
import { redact, redactDeep, riskOf, mayRequest } from '../src/explore/safety.js';
import { snapshotPage } from '../src/explore/snapshot.js';
import { vetActions, explore } from '../src/explore/index.js';
import { startFixture, makeStub } from './helpers/explore-fixture.js';

const haveChrome = !!chromePath();
const needChrome = { skip: haveChrome ? false : 'no Chrome (set KINETYPE_CHROME)' };
let site;
before(async () => { site = await startFixture(); process.env.KINETYPE_EXPLORE_RETRY_WAIT_MS = '0'; });
after(async () => { await site.close(); });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kt-explore-test-'));
const run = (scenario, extra = {}) => {
  const stub = makeStub(scenario);
  process.env.CLAUDE_BIN = stub.bin;
  const out = tmp();
  return { stub, out, p: explore({ url: site.url + '/', goal: 'Tour for a contractor', seconds: 28, out, ...extra }) };
};
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

// ---------- claim guard (pure) ----------
test('claim guard: digits must be on the visited screens, decimals are one token', () => {
  const corpus = 'Vi har 42 prosjekter og pris fra 2,5 kr';
  assert.deepEqual(claimIssues([{ id: 's1', say: 'Vi har 42 prosjekter fra 2,5 kr per time' }], corpus), []);
  const bad = claimIssues([{ id: 's1', say: 'Over 100 prosjekter, og 2,6 kr' }], corpus);
  assert.deepEqual(bad.map((b) => b.error.match(/"([^"]+)"/)[1]), ['100', '2,6']);
});

test('claim guard: spelled-out English numbers are claims too', () => {
  assert.deepEqual(wordNumbers('forty-two thousand three hundred and five users'), [42305]);
  assert.deepEqual(wordNumbers('We serve 2,5 million and twenty two firms'), [22]);   // "2,5 million" is a digit claim, not 1 000 000
  assert.equal(claimIssues([{ id: 's1', say: 'Trusted by forty two clients' }], 'We have 42 clients').filter((i) => /spelled/.test(i.error)).length, 0);
  const bad = claimIssues([{ id: 's1', say: 'Used by fifty thousand teams' }], 'We have 42 clients');
  assert.match(bad[0].error, /50000.*spelled out/);
});

test('claim guard: Norwegian number words, compounds, and en/ett excluded', () => {
  assert.deepEqual(wordNumbers('tjueto kunder og femtitre prosjekter'), [22, 53]);
  assert.deepEqual(wordNumbers('to tusen fem hundre og tolv'), [2512]);
  assert.deepEqual(wordNumbers('over hundre'), [100]);
  assert.deepEqual(wordNumbers('en kunde, ett prosjekt, to ganger, tre ganger'), []);   // en/ett/to/tre are ordinary words
  assert.equal(claimIssues([{ id: 's1', say: 'Tjuefem prosjekter i Oslo' }], 'Totalt 25 prosjekter i Oslo').length, 0);
  assert.match(claimIssues([{ id: 's1', say: 'Femti prosjekter i Oslo' }], 'Totalt 25 prosjekter i Oslo')[0].error, /"50" \(spelled out\)/);
  assert.match(claimIssues([{ id: 's1', say: 'Over to tusen kunder' }], 'Totalt 25 kunder')[0].error, /2000/);
});

test('claim guard: superlatives and names need support on the page', () => {
  assert.match(claimIssues([{ id: 's1', say: 'Norges beste byggeverktøy' }], 'Et byggeverktøy')[0].error, /"beste"/);
  assert.equal(claimIssues([{ id: 's1', say: 'The best tool' }], 'the best tool ever').length, 0);
  assert.equal(claimIssues([{ id: 's1', say: 'Bestemmer selv' }], 'x').length, 0, 'word boundary: "best" inside another word is not a superlative');
  assert.deepEqual(namesIn('Dette er Acme Bygg i Oslo. Neste viser AcmeApp'), ['Acme', 'Bygg', 'Oslo', 'AcmeApp']);   // sentence starts (Dette, Neste) are not names
  assert.match(claimIssues([{ id: 's1', say: 'Vi jobber med Skanska daglig' }], 'Acme Bygg')[0].error, /name "Skanska"/);
});

test('claude reply: JSON is extracted from chatty replies (prose, fences, braces in strings)', () => {
  const t = 'Sure {not json}! ```json\n{"say":"a } tricky { string","next":{"do":[{"type":"scroll","by":500}]},"done":false}\n``` bye {x}';
  assert.deepEqual(extractJson(t), { say: 'a } tricky { string', next: { do: [{ type: 'scroll', by: 500 }] }, done: false });
  assert.throws(() => extractJson('no object here'), /no JSON object/);
});

test('safety: secrets are redacted, actions are an allow-list over snapshot ids', () => {
  assert.doesNotMatch(redact('token=abcd1234efgh5678ijkl9999 and api_key: "sk-live-ABCDEFGHIJKLMNOP1234" url https://x.io/a?access_token=zzz999&b=1'), /abcd1234|ABCDEFGH|zzz999/);
  const snap = { canScrollDownPx: 0, targets: [{ id: 't1', role: 'link', name: 'Se prosjekter' }, { id: 't2', role: 'heading', name: 'Om', scrollOnly: true }] };
  const a = vetActions([{ type: 'type', target: 't1', text: 'pw' }, { type: 'goto', url: 'http://evil.example' }, { type: 'click', target: 't1' }], snap);   // only the first 2 are considered
  assert.deepEqual(a.ok, []);
  assert.deepEqual(a.rejected.map((r) => r.why.match(/not allowed/) ? 'not allowed' : r.why), ['not allowed', 'not allowed']);
  const b = vetActions([{ type: 'click', target: 't9' }, { type: 'click', target: 't2' }], snap);
  assert.deepEqual(b.ok, []);
  assert.match(b.rejected[0].why, /unknown target "t9"/);
  assert.match(b.rejected[1].why, /headings can only be scrolled/);
  const c = vetActions([{ type: 'click', target: 't1' }, { type: 'scroll', by: 500 }], snap);
  assert.deepEqual(c.ok, [{ type: 'click', target: { role: 'link', name: 'Se prosjekter', exact: true } }]);
  assert.match(c.rejected[0].why, /cannot scroll/);
  const d = vetActions([{ type: 'click', target: 't1' }], snap, new Set(['click|link:Se prosjekter']));
  assert.deepEqual(d.ok, []);
  assert.match(d.rejected[0].why, /already done/);
});

test('review fixes: redactDeep survives embedded JSON, submit/danger beat demo wording, digits match whole numbers, empty lines flagged', () => {
  const log = { prompt: 'screen {"text":"token: abcdef123456 password=hunter22"} and {"api_key":"sk-live-ABCDEFGHIJKLMNOP1234"}', n: 3 };
  const r = JSON.stringify(redactDeep(log));
  assert.doesNotMatch(r, /abcdef123456|hunter22|ABCDEFGH/);
  assert.equal(riskOf({ name: 'Try demo and submit order', submits: true }), 'submits a form');
  assert.ok(riskOf({ name: 'Send message to admin', submits: false }));
  assert.equal(riskOf({ name: 'Åpne som eier', submits: false }), '');
  assert.equal(mayRequest('POST', 'http://x/api/orders'), false);
  assert.equal(mayRequest('POST', 'http://x/api/auth/demo'), true);
  assert.equal(mayRequest('GET', 'http://x/api/orders'), true);
  assert.equal(claimIssues([{ id: 's1', say: 'Fem 5 team' }], 'We have 15 teams in 2025').length, 1);
  assert.equal(claimIssues([{ id: 's1', say: '15 teams' }], 'We have 15 teams').length, 0);
  assert.match(claimIssues([{ id: 's1', say: '  ' }], 'x')[0].error, /empty/);
});

// ---------- live page ----------
test('snapshot: ambiguous, off-site, destructive and submit targets are never offered', needChrome, async () => {
  const b = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await b.newPage();
    await page.goto(site.url + '/');
    const s = await snapshotPage(page);
    const names = s.targets.map((t) => t.name);
    assert.ok(names.includes('Se prosjekter'));
    assert.ok(!names.includes('Kontakt'), 'two links named Kontakt resolve to 2 elements: dropped');
    assert.ok(!names.includes('Besøk partner'), 'off-site link');
    assert.ok(!names.includes('Send inn') && !names.includes('Slett konto'));
    const why = Object.fromEntries(s.skipped.map((x) => [x.name, x.why]));
    assert.match(why['Kontakt'], /ambiguous \(2/);
    assert.match(why['Besøk partner'], /off-site/);
    assert.match(why['Send inn'], /submit/);
    assert.match(why['Slett konto'], /destructive/);
  } finally { await b.close(); }
});

// ---------- end to end with a stub claude ----------
const tour = (extra = {}) => ({
  steps: [
    { say: 'Acme Bygg samler alle prosjekter, og du ser 42 av dem fra første skjerm.', do: [{ type: 'click', name: 'Se prosjekter' }] },
    { say: 'Her ligger totalt 42 prosjekter i Oslo, klare til oppfølging.', do: [], done: true },
  ],
  ...extra,
});

test('explore: writes a valid flow, anchored narration and an audit log; mark follows the actions', needChrome, async () => {
  const { out, stub, p } = run(tour());
  const r = await p;
  assert.equal(r.verified, true);
  const flow = readJson(path.join(out, 'flow.json'));
  assert.deepEqual(flowProblems(flow), []);
  assert.deepEqual(flow.steps.map((s) => s.id), ['open', 's1', 's2-1-click', 's2']);
  assert.equal(flow.steps[0].url, '/');
  assert.deepEqual(flow.steps[2].target, { role: 'link', name: 'Se prosjekter', exact: true });
  const nar = readJson(path.join(out, 'narration.json'));
  assert.equal(nar.schema, 'director.narration.v1');
  assert.deepEqual(nar.lines.map((l) => l.mark), ['s1', 's2']);
  const markIds = new Set(flow.steps.filter((s) => s.action === 'mark').map((s) => s.id));
  assert.ok(nar.lines.every((l) => markIds.has(l.mark) && l.step === l.mark));
  const log = readJson(path.join(out, 'explore.log.json'));
  assert.equal(log.result, 'ok');
  assert.equal(log.steps.length, 2);
  assert.ok(log.steps.every((s) => /^[0-9a-f]{16}$/.test(s.snapshotHash) && s.prompt && s.reply && s.parsed && s.claudeMs >= 0));
  assert.notEqual(log.steps[0].snapshotHash, log.steps[1].snapshotHash);
  assert.equal(log.steps[0].actions[0].ok, true);
  assert.equal(log.verify.ok, true);
  // the model is called with no tools and sees only unique, safe targets
  assert.deepEqual(stub.calls()[0].args.slice(-2), ['--tools', '']);
  const offered = JSON.parse(stub.calls()[0].prompt.match(/CURRENT SCREEN[^\n]*\n([\s\S]*?)\n\nReply with ONE JSON/)[1]).targets.map((t) => t.name);
  assert.deepEqual(offered.sort(), ['Acme Bygg', 'Gå videre', 'Se prosjekter']);   // no Slett konto / Send inn / Besøk partner / ambiguous Kontakt
  // the page's accidental secret never reaches the audit log
  assert.doesNotMatch(fs.readFileSync(path.join(out, 'explore.log.json'), 'utf8'), /abcd1234efgh5678ijkl9999/);
  assert.ok(!site.hits.some((h) => h.includes('/never')), 'nothing was submitted');
});

test('explore: ungrounded narration is repaired once, then verified', needChrome, async () => {
  const sc = tour(); sc.steps[1].say = 'Her ligger totalt 100 prosjekter i Oslo.';
  sc.repair = { lines: [{ id: 's1', say: 'Acme Bygg samler alle prosjekter, og du ser 42 av dem fra første skjerm.' }, { id: 's2', say: 'Her ligger totalt 42 prosjekter i Oslo.' }] };
  const { out, p } = run(sc);
  await p;
  const log = readJson(path.join(out, 'explore.log.json'));
  assert.equal(log.claimGuard.firstPass.length, 1);
  assert.deepEqual(log.claimGuard.afterRepair, []);
  assert.match(readJson(path.join(out, 'narration.json')).lines[1].text, /42 prosjekter/);
});

test('explore: still-ungrounded narration writes NO flow/narration, only the audit log', needChrome, async () => {
  const sc = tour(); sc.steps[1].say = 'Norges beste verktøy for femti tusen kunder.';
  sc.repair = { lines: [{ id: 's1', say: 'Acme Bygg samler 42 prosjekter.' }, { id: 's2', say: 'Norges beste verktøy for femti tusen kunder.' }] };
  const { out, p } = run(sc);
  await assert.rejects(p, /claim guard/);
  assert.ok(!fs.existsSync(path.join(out, 'flow.json')) && !fs.existsSync(path.join(out, 'narration.json')));
  const log = readJson(path.join(out, 'explore.log.json'));
  assert.equal(log.result, 'claim guard failed');
  assert.ok(log.claimGuard.afterRepair.length >= 2);
});

test('explore: off-site navigation is blocked, recorded, and never enters the flow', needChrome, async () => {
  const sc = { steps: [
    { say: 'Acme Bygg viser 42 prosjekter her.', do: [{ type: 'click', name: 'Gå videre' }] },
    { say: 'Acme Bygg viser 42 prosjekter her også.', do: [], done: true },
  ] };
  const { out, p } = run(sc);
  await p;   // the story ends at the screen before the blocked click
  const log = readJson(path.join(out, 'explore.log.json'));
  assert.ok(log.blocked.some((b) => b.kind === 'navigation' && b.url.startsWith('http://evil.example')));
  assert.equal(log.steps[0].actions[0].ok, false);
  assert.equal(log.steps[0].ended, 'action failed');
  assert.ok(!fs.readFileSync(path.join(out, 'flow.json'), 'utf8').includes('Gå videre'));
  assert.ok(!site.hits.some((h) => h.includes('evil')));
});

test('explore: hallucinated / unsafe actions are rejected and end the story instead of acting', needChrome, async () => {
  const sc = { steps: [
    { say: 'Acme Bygg viser 42 prosjekter her.', do: [{ type: 'click', name: 'Slett konto' }, { type: 'type', target: 't1', text: 'hunter2' }] },
  ] };
  const { out, p } = run(sc);
  await p;   // story ends after the first screen: one narrated step, nothing clicked
  const log = readJson(path.join(out, 'explore.log.json'));
  assert.equal(log.steps.length, 1);
  assert.equal(log.steps[0].ended, 'no valid next action');
  assert.equal(log.steps[0].rejected.length, 2);
  assert.equal(readJson(path.join(out, 'flow.json')).steps.length, 2);   // open + mark
});

test('explore: ambiguity - a target the model names that is not unique never reaches the flow', needChrome, async () => {
  const sc = { steps: [{ say: 'Acme Bygg viser 42 prosjekter her.', do: [{ type: 'click', name: 'Kontakt' }] }] };
  const { out, p } = run(sc);
  await p;
  assert.ok(!fs.readFileSync(path.join(out, 'flow.json'), 'utf8').includes('Kontakt'));
});
