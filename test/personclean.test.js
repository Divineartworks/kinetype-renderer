// plan.personClean is a caller opt-in (looks behind him): absent, a window's spec is exactly what it always was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windowSpec } from '../src/cli/compose.js';
import kc from '../templates/kinetic-captions/index.js';

const plan = { video: 'v.mp4', look: 'noir' };
const win = { id: 'moment1', role: 'moment', start: 0, end: 4, in: 0, out: 0, look: 'noir', energy: 'signature', heroes: [1.2] };
const words = [{ text: 'accessible', start: 0.5, end: 1 }, { text: 'twenty-four', start: 1.2, end: 1.9 }];
const spec = (p, w = win) => windowSpec(p, w, words, { fps: 30, format: { width: 1080, height: 1920, fps: 30 }, name: 'm' });

test('personClean is off unless the plan (or the window) asks for it', () => {
  assert.equal(spec(plan).params.personClean, undefined);
  assert.equal(spec({ ...plan, personClean: true }).params.personClean, true);
  assert.equal(spec(plan, { ...win, personClean: true }).params.personClean, true);
  assert.deepEqual(spec(plan), spec({ ...plan, personClean: false }), 'a false flag changes nothing');
});

test('the template declares the personClean parameter', () => {
  assert.ok(kc.schema?.properties?.personClean || JSON.stringify(kc.schema ?? kc).includes('personClean'));
});

// ── the receipt says what the template REALLY did, never what the plan asked for
import { personCleanVerdict, cleanVerdictOfRender } from '../templates/kinetic-captions/personclean.js';
import { cleanFields } from '../src/cli/compose.js';
import fs from 'node:fs';

const clip = {};
const base = { raw: { personClean: true }, clip, lookId: 'neon', stage: false, split: false, zones: null, hasMatte: true };

test('personClean is applied only with footage, a matte and a plain layout', () => {
  assert.deepEqual(personCleanVerdict(base), { asked: true, applied: true, safe: false });
  assert.equal(personCleanVerdict({ ...base, raw: {} }).asked, false);
  for (const [k, v, why] of [['hasMatte', false, 'no person matte'], ['zones', {}, 'zoned (letterboxed) layout'], ['split', true, 'split layout'], ['stage', true, 'stage layout'], ['clip', null, 'no footage']]) {
    const r = personCleanVerdict({ ...base, [k]: v });
    assert.equal(r.applied, false, k);
    assert.equal(r.why, why);
  }
  assert.equal(personCleanVerdict({ ...base, lookId: 'cover' }).safe, true);
});

test('compose receipts personClean only when the render says it was applied, else personCleanFellBack', () => {
  const plan = { look: 'neon', personClean: true };
  const applied = cleanVerdictOfRender({ qa: { layout: { notes: ['personClean: applied'] } } });
  const skipped = cleanVerdictOfRender({ qa: { layout: { notes: ['x', 'personClean: not applied - no person matte'] } } });
  assert.deepEqual(applied, { applied: true });
  assert.deepEqual(skipped, { applied: false, why: 'no person matte' });
  assert.deepEqual(cleanFields({ look: 'neon', clean: applied }, plan), { personClean: true });
  assert.deepEqual(cleanFields({ look: 'neon', clean: skipped }, plan), { personCleanFellBack: 'no person matte' });
  // a kinetype that predates the flag reports nothing: the plan's ask must not be receipted as applied
  assert.ok(cleanFields({ look: 'neon', clean: null }, plan).personCleanFellBack);
  assert.deepEqual(cleanFields({ look: 'cover', clean: null }, plan), {});
  assert.deepEqual(cleanFields({ look: 'neon', clean: null }, { look: 'neon' }), {});
});

test('the checkout carries the capability marker the app probes', () => {
  assert.match(fs.readFileSync(new URL('../templates/kinetic-captions/personclean.js', import.meta.url), 'utf8'), /kinetype-capability: personClean\/2/);
});

test('neon cuts the wall wash and the caption haze off his silhouette', () => {
  const src = fs.readFileSync(new URL('../templates/kinetic-captions/looks/neon.js', import.meta.url), 'utf8');
  assert.match(src, /washOff\(g, t, p, st\.on \* 0\.6/);
  assert.match(src, /A\.offHim\(g, t, \(hg\)/);
  assert.match(src, /A\.offHim\(g, t, glows, \{ blend: 'lighter' \}\)/, 'tube glow of the layers in front of him');
});

// ── frames drawn without a person matte are counted and receipted (the app re-looks a window above 20 %)
import { createMatteCounter } from '../templates/kinetic-captions/personclean.js';

test('the matte counter counts frames with a missing matte, not samples, and ignores draws outside a frame', () => {
  const have = (t) => t < 0.5 || t >= 0.9;                       // matte missing between 0.5 s and 0.9 s
  const c = createMatteCounter((t) => (have(t) ? {} : null));
  c.matteAt(0.6);                                                // priming draw outside a frame: counts for nothing
  for (let i = 0; i < 30; i++) {                                 // 30 fps, 4 samples per frame (trailing shutter)
    c.beginFrame(i);
    for (let k = 0; k < 4; k++) c.matteAt(Math.max(0, i / 30 - k / 120));
    c.matteAt(i / 30);                                           // the same frame asks again (cleanPost, offHim): still one frame
    c.endFrame();
  }
  c.matteAt(0.6);
  const st = c.stats();
  assert.equal(st.cleanFrames.length, 30);
  assert.deepEqual(st.cleanMatteMiss, [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27]);
  assert.equal(st.cleanMatteMiss.length, 13);
});

test('the receipt carries the matte-miss frames from the render receipt to the compose row', () => {
  const rc = { qa: { layout: { notes: ['personClean: applied'] } }, clean: { frames: 120, matteMissFrames: 31 } };
  const v = cleanVerdictOfRender(rc);
  assert.deepEqual(v, { applied: true, frames: 120, matteMissFrames: 31 });
  assert.deepEqual(cleanFields({ look: 'noir', clean: v }, { look: 'noir', personClean: true }), { personClean: true, personCleanFrames: 120, personCleanMatteMissFrames: 31 });
  assert.deepEqual(cleanVerdictOfRender({ qa: { layout: { notes: ['personClean: applied'] } } }), { applied: true }, 'a render without counters: unchanged');
  assert.equal(cleanVerdictOfRender({ qa: { layout: { notes: ['personClean: not applied - no person matte'] } }, clean: { frames: 5, matteMissFrames: 5 } }).applied, false);
});

test('every matte read behind him goes through the counter, and the marker is in all four files the app probes', () => {
  const rd = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  const tpl = rd('templates/kinetic-captions/index.js');
  const region = tpl.slice(tpl.indexOf('const drawClean'), tpl.indexOf('// ── smart placement'));
  assert.ok(!/clip\.matte\(/.test(region), 'drawClean / cleanPost / offHim must read the matte through matteAt');
  assert.equal((region.match(/matteAt\(t\)/g) || []).length, 3);
  assert.match(tpl, /beginFrame: counter\.beginFrame/);
  for (const f of ['templates/kinetic-captions/personclean.js', 'src/cli/compose.js', 'templates/kinetic-captions/index.js', 'templates/kinetic-captions/looks/neon.js']) {
    assert.match(rd(f), /kinetype-capability: personClean\/2/, f);
  }
});

test('the engine and the renderer pass the counters through', () => {
  const rd = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  assert.match(rd('src/kit/engine.js'), /scene\.beginFrame\?\.\(i\)/);
  assert.match(rd('src/runtime/boot.js'), /stats: \(\) => eng\.stats\(\)/);
  assert.match(rd('src/cli/render.js'), /clean: \{ frames: cleanSeen\.size, matteMissFrames: cleanMiss\.size \}/);
});
