// heroOnce through the real layout (needs Chrome, skipped without it): zones force a top-band hero (p.cover) even with no
// footage/matte, so layoutPhrase runs its filter. The key word must be read once in every look: the giant OR the block.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromePath } from '../src/cli/browser.js';
import { session } from '../src/cli/render.js';

const WORDS = 'you must learn to accept the situation'.split(' ').map((t, i) => ({ text: t, start: +(0.2 + i * 0.35).toFixed(2), end: +(0.5 + i * 0.35).toFixed(2) }));
const spec = (look, heroOnce) => ({
  template: 'kinetic-captions', name: `once-${look}`, format: { width: 540, height: 960, fps: 30 }, fps: 30, duration: 3.5, seed: 7,
  params: { look, energy: 'wild', heroOnce, zones: { top: [0, 0.3], bottom: [0.67, 0.86] } },
  content: { words: WORDS, heroes: [1.0] },
  rules: { beatCoverage: false, loopExact: false }, render: { crf: 18, preset: 'ultrafast' },
});
const phraseLines = async (look, heroOnce) => {
  const s = await session(spec(look, heroOnce), { specDir: process.cwd() });
  try {
    const out = {};
    for (const t of s.info.qa.texts || []) if (/^phrase-\d+$/.test(t.label)) out[t.label] = (t.lines || []).join(' ');
    return { texts: out, notes: s.info.qa.notes };
  } finally { await s.close(); }
};
const skip = !chromePath() && 'no Chrome';

for (const look of ['marker', 'cover', 'cinema', 'swiss']) {
  test(`heroOnce ${look}: no duplicated or dropped words in any phrase block`, { skip, timeout: 240000 }, async () => {
    const off = await phraseLines(look, false), on = await phraseLines(look, true);
    const all = (o) => Object.values(o.texts).join(' ').toLowerCase().split(/\s+/).filter(Boolean);
    const wOff = all(off), wOn = all(on);
    assert.ok(wOff.length >= 6, `the phrases were laid out (${JSON.stringify(off.texts)})`);
    // with the flag, no word appears more often than without it, and no word outside the hero's own is lost
    const count = (a, w) => a.filter((x) => x === w).length;
    for (const w of new Set(wOff)) assert.ok(count(wOn, w) <= count(wOff, w), `${look}: "${w}" repeated (${JSON.stringify(on.texts)})`);
    const lost = [...new Set(wOff)].filter((w) => count(wOn, w) < count(wOff, w));
    assert.ok(lost.length <= 1, `${look}: lost ${JSON.stringify(lost)}`);
    if (look === 'cinema' || look === 'swiss') assert.deepEqual(wOn, wOff, `${look} lays the key out inside the phrase: untouched`);
    else assert.equal(lost.length, 1, `${look}: exactly the hero word leaves the caption block`);
  });
}
