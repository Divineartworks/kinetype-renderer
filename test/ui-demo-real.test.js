// ui-demo real mode, in the browser: the press indicator is drawn exactly on the
// logged vpoint (pixel test: centroid of the drawn disc vs the mapped vpoint, ≤ 1 px),
// and the pace/legibility/touch checks run as template QA.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromePath } from '../src/cli/browser.js';
import { execFileSync } from 'node:child_process';
import { stills } from '../src/cli/render.js';
import { editPlan } from '../src/cli/edit.js';
import * as X from '../src/kit/x-ui.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const spec = (params = {}) => ({
  template: 'ui-demo', name: 'real-touch-test', format: 'vertical', fps: 30, seed: 1,
  media: { own: { capture: 'fixtures/real/owner/capture.json' } },
  content: { session: { devices: [{ id: 'owner', capture: 'own' }] }, frame: 'none', retime: 'auto', edit: [{ device: 'owner', from: 'owner:new-item', to: 'owner:amount' }] },
  params: { breathe: 0, ...params },
});
const gray = (png) => {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', png, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 64 << 20 });
  return raw;
};

test('real mode: press indicator centroid sits on the logged vpoint (≤ 1 px)', { skip: !chromePath() && 'no Chrome', timeout: 240000 }, async (tt) => {
  const s = spec();
  const plan = await editPlan(s, { specDir: ROOT });
  const tap = plan.events.find((e) => e.type === 'click' && e.step === 'desc');
  assert.ok(tap, 'desc tap in the edit');
  const t = tap.t + 0.01; // disc fully down, the ripple not yet started
  const shot = plan.shots[tap.shot], p = shot.panels[0];
  const cam = X.cameraTrack(p.keys, p.view, undefined, { breathe: 0, duration: shot.f1 - shot.f0, fps: 30 }).at(t - shot.f0);
  const want = { x: p.centre.x + (tap.point.x - cam.cx) * p.rect.s * cam.z, y: p.centre.y + (tap.point.y - cam.cy) * p.rect.s * cam.z };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-real-'));
  try {
    const a = await stills(s, { specDir: ROOT, out: path.join(tmp, 'a'), at: [t], samples: 1, log: () => {} });
    const b = await stills(spec({ touch: false }), { specDir: ROOT, out: path.join(tmp, 'b'), at: [t], samples: 1, log: () => {} });
    const pa = path.join(a.sdir, fs.readdirSync(a.sdir).find((n) => n.startsWith('01_')));
    const pb = path.join(b.sdir, fs.readdirSync(b.sdir).find((n) => n.startsWith('01_')));
    const A = gray(pa), B = gray(pb), W = 1080;
    let sw = 0, sx = 0, sy = 0, n = 0;
    for (let i = 0; i < A.length; i++) {
      const d = Math.abs(A[i] - B[i]);
      if (d < 3) continue;
      sw += d; sx += d * ((i % W) + 0.5); sy += d * (Math.floor(i / W) + 0.5); n++;
    }
    assert.ok(n > 200, `indicator drawn (${n} px differ)`);
    const got = { x: sx / sw, y: sy / sw };
    const err = Math.hypot(got.x - want.x, got.y - want.y);
    tt.diagnostic(`touch centroid error ${err.toFixed(3)} px (${n} px drawn)`);
    assert.ok(err <= 1, `centroid ${got.x.toFixed(2)},${got.y.toFixed(2)} vs vpoint ${want.x.toFixed(2)},${want.y.toFixed(2)}: ${err.toFixed(2)} px`);
    const checks = Object.fromEntries(a.layoutQA.checks.map((c) => [c.id, c.status]));
    assert.equal(checks['touch-accuracy'], 'pass');
    assert.equal(checks.legibility, 'pass');
    // this test edit has no payoff in it: the pace QA must say so (and fail the verdict)
    assert.equal(checks['pace-first-payoff'], 'fail');
    assert.equal(checks.pace, 'fail');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
