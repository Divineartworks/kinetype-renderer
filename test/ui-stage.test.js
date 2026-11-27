// ui-stage, end to end with real pixels: capture the highlight fixture page once, show it in a
// 2-panel and a 3-panel stage (different frames, crops, start offsets and stage scales), then in
// the OUTPUT frames find each panel's target colour rectangle (inside that panel's screen) and
// assert the highlight stroke sits HIGHLIGHT_PAD CSS px outside it on all four sides (±2 px) —
// i.e. the composed map (stage × panel camera) is what the frames, rings and connectors share —
// that no ring is drawn once the modal covers the target, and that a connector whose endpoint is
// covered fails the verdict (fail-closed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { captureFlow } from '../src/capture/index.js';
import { chromePath } from '../src/cli/browser.js';
import { stills } from '../src/cli/render.js';
import { HIGHLIGHT_PAD } from '../src/kit/x-ui.js';

const HTML = fs.readFileSync(new URL('../fixtures/highlight-app/index.html', import.meta.url));
const ACCENT = [0xff, 0x88, 0x00];

function decode(file) {
  const s = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', file])).streams[0];
  const px = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 });
  return { w: s.width, h: s.height, px };
}
const at = (im, x, y) => { const i = (y * im.w + x) * 3; return [im.px[i], im.px[i + 1], im.px[i + 2]]; };
const near = (c, ref, tol) => Math.abs(c[0] - ref[0]) <= tol && Math.abs(c[1] - ref[1]) <= tol && Math.abs(c[2] - ref[2]) <= tol;
/** Bounding box of pixels matching ref inside region r (output px). */
function colourRect(im, ref, r, tol = 40) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
  for (let y = Math.max(0, Math.floor(r.y)); y < Math.min(im.h, Math.ceil(r.y + r.h)); y++) for (let x = Math.max(0, Math.floor(r.x)); x < Math.min(im.w, Math.ceil(r.x + r.w)); x++) if (near(at(im, x, y), ref, tol)) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return n > 100 ? { x0, y0, x1: x1 + 1, y1: y1 + 1, n } : null;
}
function strokeCentre(im, x, y, dx, dy, max) {
  const hits = [];
  for (let k = 1; k <= max; k++) {
    const xx = Math.round(x + dx * k), yy = Math.round(y + dy * k);
    if (xx < 0 || yy < 0 || xx >= im.w || yy >= im.h) break;
    if (near(at(im, xx, yy), ACCENT, 70)) hits.push(k);
    else if (hits.length) break;
  }
  return hits.length ? hits.reduce((a, b) => a + b, 0) / hits.length : null;
}
const anyAccentIn = (im, r) => {
  for (let y = Math.max(0, r.y0); y < Math.min(im.h, r.y1); y++) for (let x = Math.max(0, r.x0); x < Math.min(im.w, r.x1); x++) if (near(at(im, x, y), ACCENT, 70)) return true;
  return false;
};
const fileOf = (st, k) => path.join(st.sdir, fs.readdirSync(st.sdir).filter((n) => n.startsWith(String(k + 1).padStart(2, '0') + '_'))[0]);

/** Pixel-verify every (panel, time) pick: ring centred HIGHLIGHT_PAD CSS px outside the target colour rect. */
function verifyRings(im, picks, label) {
  for (const o of picks) {
    const tr = colourRect(im, o.ref, o.screen);
    assert.ok(tr, `${label} ${o.panel}: target colour found inside its screen`);
    const kz = (tr.x1 - tr.x0) / o.cssW;
    const want = HIGHLIGHT_PAD * kz, my = Math.round((tr.y0 + tr.y1) / 2), mx = Math.round((tr.x0 + tr.x1) / 2);
    const sides = { left: strokeCentre(im, tr.x0, my, -1, 0, want * 3), right: strokeCentre(im, tr.x1 - 1, my, 1, 0, want * 3), top: strokeCentre(im, mx, tr.y0, 0, -1, want * 3), bottom: strokeCentre(im, mx, tr.y1 - 1, 0, 1, want * 3) };
    for (const [side, d] of Object.entries(sides)) {
      assert.ok(d != null, `${label} ${o.panel} @${o.t.toFixed(3)}s: stroke found on the ${side}`);
      assert.ok(Math.abs(d - 0.5 - want) <= 2, `${label} ${o.panel} @${o.t.toFixed(3)}s ${side}: stroke centre ${(d - 0.5).toFixed(2)} px out, want ${want.toFixed(2)} ±2`);
    }
  }
}

test('ui-stage: rings on 2 and 3 panels sit exactly on the composed map of each tracked target; covered → no ring; hidden connector endpoint fails', { skip: !chromePath() && 'no Chrome', timeout: 900000 }, async () => {
  const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(HTML); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-stage-'));
  try {
    const flowFile = path.join(dir, 'flow.json');
    fs.writeFileSync(flowFile, JSON.stringify({
      schema: 'kinetype.flow.v1', name: 'stage-fixture', app: { name: 'T', baseUrl: `http://127.0.0.1:${srv.address().port}` },
      device: { kind: 'desktop', viewport: { width: 960, height: 600 }, deviceScaleFactor: 2 }, fps: 15,
      steps: [
        { id: 'open-page', action: 'goto', url: '/', hold: 0.3 },
        { id: 'row', action: 'hover', target: { role: 'button', name: 'Row' }, label: 'Row', hold: 0.6 },
        { id: 'scroll-list', action: 'scroll', by: 120, duration: 0.6, hold: 0.6 },
        { id: 'open', action: 'click', target: { role: 'button', name: 'Open' }, label: 'Open', hold: 0 },
        { id: 'see', action: 'observe', target: { selector: '#see' }, label: 'Dialog', hold: 1.6 },
      ],
    }));
    const r = await captureFlow(flowFile, { out: path.join(dir, 'cap') });
    const cap = JSON.parse(fs.readFileSync(r.capture, 'utf8'));
    const open = cap.events.find((e) => e.step === 'open' && e.type === 'click');
    const row = cap.events.find((e) => e.step === 'row' && e.type === 'hover');
    const cover = row.track.find((x) => !x.visible);
    assert.ok(cover && cover.t > open.t, 'fixture: the modal covers the row after the click');

    const common = { fps: 30, render: { samples: 1 }, palette: { accent: '#FF8800' }, media: { cap: { capture: r.capture } } };
    const panel = (id, extra) => ({ id, capture: 'cap', camera: 'wide', cursor: { show: false }, label: id, ...extra });
    const co = [{ at: 'row', text: 'Row', when: 'after', duration: 3.2 }, { at: 'see', target: 'see', text: 'Dialog', when: 'after', duration: 1.2 }];
    const specs = {
      dual: { ...common, template: 'ui-stage', format: 'landscape', params: { grain: 0, autoHold: false, dimUnfocused: 0, legibility: 0 },
        content: { panels: [panel('a', { frame: 'browser', callouts: co }), panel('b', { frame: 'bare', start: 0.4, crop: { x: 20, y: 60, w: 880, h: 520 }, callouts: co })],
          layout: [{ at: 0, arrangement: 'dual', focus: 'a' }, { at: 2.0, arrangement: 'dual', focus: 'b' }] } },
      triad: { ...common, template: 'ui-stage', format: 'landscape', params: { grain: 0, autoHold: false, dimUnfocused: 0, legibility: 0, unfocusScale: 0.8 },
        content: { panels: [panel('a', { frame: 'bare', crop: { x: 20, y: 60, w: 880, h: 520 }, callouts: co }), panel('b', { frame: 'browser', start: 0.25, callouts: co }), panel('c', { frame: 'phone', start: 0.5, crop: { x: 20, y: 60, w: 420, h: 520 }, callouts: co })],
          layout: [{ at: 0, arrangement: 'triad', focus: 'b' }] } },
    };
    for (const [name, spec] of Object.entries(specs)) {
      const st0 = await stills(spec, { specDir: dir, out: path.join(dir, `${name}-0`), at: [0.1], samples: 1, log: () => {} });
      const qa = st0.info.qa;
      const chk = qa.checks.find((c) => /highlight-accuracy/.test(c.id));
      assert.equal(chk?.status, 'pass', `${name}: ${JSON.stringify(chk)}`);
      const ov = qa.overlays.filter((o) => o.kind === 'highlight');
      const ids = spec.content.panels.map((p) => p.id);
      for (const id of ids) assert.ok(ov.some((o) => o.panel === id && o.label === 'Row'), `${name}: panel ${id} draws its Row highlight`);
      // never drawn once covered, on any panel
      assert.ok(!ov.some((o) => o.label === 'Row' && o.captureT >= cover.t - 1e-6), `${name}: no Row ring once the modal covers it`);
      // pick, per panel, a settled moment with its Row ring at full alpha; and a Dialog moment
      const pick = (label, ref, cssW) => ids.map((id) => {
        const os_ = ov.filter((o) => o.panel === id && o.label === label && o.alpha > 0.97 && (spec.content.layout.length < 2 || o.t > 2.7 || o.t < 1.9));
        const o = os_[Math.floor(os_.length / 2)];
        return o && { panel: id, t: o.t, screen: o.screen, ref, cssW };
      }).filter(Boolean);
      const rows = pick('Row', [255, 0, 255], 340), dlg = pick('Dialog', [0, 80, 255], 240);
      assert.equal(rows.length, ids.length, `${name}: a Row moment per panel`);
      const all = [...rows, ...dlg];
      const st = await stills(spec, { specDir: dir, out: path.join(dir, `${name}-1`), at: all.map((o) => o.t), samples: 1, log: () => {} });
      all.forEach((o, k) => verifyRings(decode(fileOf(st, k)), [o], name));
      // covered: after the modal is up, no accent ring around the dimmed row in any panel
      const tCov = Math.max(...ids.map((id) => (spec.content.panels.find((p) => p.id === id).start ?? 0))) + cover.t + 0.35;
      const sc = await stills(spec, { specDir: dir, out: path.join(dir, `${name}-2`), at: [tCov], samples: 1, log: () => {} });
      const im = decode(fileOf(sc, 0));
      const scr = sc.info.qa.overlays.filter((o) => o.kind === 'highlight').map((o) => o.screen);
      const dims = [];
      for (const s of (scr.length ? scr : [{ x: 0, y: 0, w: im.w, h: im.h }])) { const d = colourRect(im, [118, 0, 118], s, 30); if (d) dims.push(d); }
      for (const d of dims) assert.equal(anyAccentIn(im, { x0: d.x0 - 30, y0: d.y0 - 30, x1: d.x1 + 30, y1: d.y1 + 30 }), false, `${name}: no ring around a covered row`);
    }

    // fail-closed connector: endpoint "row" is covered by the modal for part of the window → verdict fails
    const bad = { ...specs.dual, content: { ...specs.dual.content, connectors: [{ from: { panel: 'a', target: 'row' }, to: { panel: 'b', target: 'see' }, at: cover.t - 0.2, dur: 0.6, hold: 1.0 }] } };
    const sb = await stills(bad, { specDir: dir, out: path.join(dir, 'bad'), at: [0.1], samples: 1, log: () => {} });
    const cc = sb.info.qa.checks.find((c) => /connector-endpoints/.test(c.id));
    assert.equal(cc?.status, 'fail', JSON.stringify(cc));
    // fit: true cannot invent a window: "row" and "see" are never visible together → still fails closed
    const fitted = { ...bad, content: { ...bad.content, connectors: [{ ...bad.content.connectors[0], fit: true }] } };
    const sf = await stills(fitted, { specDir: dir, out: path.join(dir, 'fit'), at: [0.1], samples: 1, log: () => {} });
    assert.equal(sf.info.qa.checks.find((c) => /connector-endpoints/.test(c.id))?.status, 'fail');
    assert.ok(sf.info.qa.notes.some((n) => /connector 1 fit: no window/.test(n)), 'fit reports that no window exists');
    // ...but it finds one that exists: asked too early (dialog not open yet) with a long hold → moved + trimmed → pass
    const early = { ...specs.dual, content: { ...specs.dual.content, connectors: [{ from: { panel: 'a', target: 'see' }, to: { panel: 'b', target: 'see' }, at: open.t - 0.4, dur: 0.4, hold: 6, fit: true }] } };
    const se = await stills(early, { specDir: dir, out: path.join(dir, 'fit2'), at: [0.1], samples: 1, log: () => {} });
    assert.equal(se.info.qa.checks.find((c) => /connector-endpoints/.test(c.id))?.status, 'pass', JSON.stringify(se.info.qa.checks.find((c) => /connector-endpoints/.test(c.id))));
    assert.ok(se.info.qa.notes.some((n) => /connector 1 fit: [\d.]+s → [\d.]+s, hold 6\.00 → /.test(n)), se.info.qa.notes.filter((n) => /fit/.test(n)).join(' | '));
    // and a connector between two VISIBLE targets passes, endpoints on the composed rings
    const good = { ...specs.dual, content: { ...specs.dual.content, connectors: [{ from: { panel: 'a', target: 'see' }, to: { panel: 'b', target: 'see' }, at: 'b:see+0.1', dur: 0.4, hold: 0.3 }] } };
    const sg = await stills(good, { specDir: dir, out: path.join(dir, 'good'), at: [0.1], samples: 1, log: () => {} });
    const cg = sg.info.qa.checks.find((c) => /connector-endpoints/.test(c.id));
    assert.equal(cg?.status, 'pass', JSON.stringify(cg));
    const con = sg.info.qa.overlays.filter((o) => o.kind === 'connector');
    assert.ok(con.length > 3);
    for (const o of con) {
      const onEdge = (p, rg) => (Math.abs(p.x - rg.x) < 0.01 || Math.abs(p.x - rg.x - rg.w) < 0.01 || Math.abs(p.y - rg.y) < 0.01 || Math.abs(p.y - rg.y - rg.h) < 0.01) && p.x >= rg.x - 0.01 && p.x <= rg.x + rg.w + 0.01 && p.y >= rg.y - 0.01 && p.y <= rg.y + rg.h + 0.01; // overlay coords are rounded to 0.01 px
      assert.ok(onEdge(o.a, o.from.ring) && onEdge(o.b, o.to.ring), `connector endpoints lie on their rings: ${JSON.stringify(o)}`);
    }
  } finally { srv.close(); if (process.env.KT_KEEP) console.error('kept', dir); else fs.rmSync(dir, { recursive: true, force: true }); }
});
