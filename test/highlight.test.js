// Highlight accuracy, end to end with real pixels: capture a fixture page whose targets are solid
// colours (one in a scrolling list, one that a modal covers mid-flow, one inside the modal), render
// ui-demo stills, find each target's colour rectangle in the OUTPUT frame and assert the highlight
// stroke sits HIGHLIGHT_PAD CSS px outside it on all four sides (±2 output px) — and that no
// highlight is drawn once the modal covers its target.
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
import { HIGHLIGHT_PAD, trackAt } from '../src/kit/x-ui.js';

const HTML = fs.readFileSync(new URL('../fixtures/highlight-app/index.html', import.meta.url));
const ACCENT = [0xff, 0x88, 0x00];

/** Decode a PNG/JPEG to {w, h, px: rgb24} with ffmpeg (exact for PNG). */
function decode(file) {
  const s = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', file])).streams[0];
  const px = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 });
  return { w: s.width, h: s.height, px };
}
const at = (im, x, y) => { const i = (y * im.w + x) * 3; return [im.px[i], im.px[i + 1], im.px[i + 2]]; };
const near = (c, ref, tol) => Math.abs(c[0] - ref[0]) <= tol && Math.abs(c[1] - ref[1]) <= tol && Math.abs(c[2] - ref[2]) <= tol;

/** Bounding box (output px, edges at half coverage) of the pixels matching `ref`. */
function colourRect(im, ref, tol = 40) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) if (near(at(im, x, y), ref, tol)) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return n > 200 ? { x0, y0, x1: x1 + 1, y1: y1 + 1, n } : null;
}

/** Centre of the accent stroke met walking from (x, y) by (dx, dy), within `max` px; null if none. */
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

test('highlight: tracked ring surrounds the real target in output pixels; gone once a modal covers it', { skip: !chromePath() && 'no Chrome', timeout: 600000 }, async () => {
  const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(HTML); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-highlight-'));
  try {
    const flowFile = path.join(dir, 'flow.json');
    fs.writeFileSync(flowFile, JSON.stringify({
      schema: 'kinetype.flow.v1', name: 'highlight-fixture', app: { name: 'T', baseUrl: `http://127.0.0.1:${srv.address().port}` },
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
    const row = cap.events.find((e) => e.step === 'row' && e.type === 'hover'), open = cap.events.find((e) => e.step === 'open' && e.type === 'click');
    const see = cap.events.find((e) => e.step === 'see');
    // capture: the row's track follows the list scroll, and turns invisible when the modal opens
    assert.ok(row.track.some((x) => x.visible && Math.abs(x.box.y - 300) < 1) && row.track.some((x) => x.visible && Math.abs(x.box.y - 180) < 1), JSON.stringify(row.track));
    const cover = row.track.find((x) => !x.visible);
    assert.ok(cover && cover.t > open.t && cover.t - open.t < 0.5, `row covered right after the click (${cover?.t} vs ${open.t})`);
    assert.equal(trackAt(open, Math.round(cover.t * cap.fps), cap.fps).visible, false, 'the clicked button is covered too');
    // the visibility flip is on EXACTLY the first captured frame whose pixels show the backdrop
    const fc = Math.round(cover.t * cap.fps), dsf = cap.device.deviceScaleFactor;
    const capPx = (f) => at(decode(path.join(r.out, 'frames', `f${String(f).padStart(6, '0')}.jpg`)), Math.round(620 * dsf), Math.round(150 * dsf));
    assert.ok(near(capPx(fc - 1), [0, 200, 83], 40), `frame ${fc - 1} still shows the uncovered button: ${capPx(fc - 1)}`);
    assert.ok(near(capPx(fc), [0, 90, 37], 30), `frame ${fc} shows the backdrop: ${capPx(fc)}`);
    assert.equal(trackAt(see, Math.round((see.t + 0.2) * cap.fps), cap.fps).visible, true);

    const spec = {
      template: 'ui-demo', format: 'landscape', fps: 30, render: { samples: 1 },
      media: { cap: { capture: r.capture } },
      palette: { accent: '#FF8800' },
      params: { grain: 0, autoHold: false },
      content: {
        capture: 'cap', frame: 'browser', camera: 'auto', cursor: { show: false },
        callouts: [
          { at: 'row', text: 'Row', when: 'after', duration: 3.4 },
          { at: 'open', text: 'Open', when: 'after', duration: 2 },
          { at: 'see', target: 'see', text: 'Dialog', when: 'after', duration: 1.4 },
        ],
      },
    };
    const st0 = await stills(spec, { specDir: dir, out: path.join(dir, 'r0'), at: [0.1], samples: 1, log: () => {} });
    const info = st0.info;
    const chk = info.qa.checks.find((c) => /highlight-accuracy/.test(c.id));
    assert.equal(chk?.status, 'pass', JSON.stringify(chk));
    const ov = info.qa.overlays.filter((o) => o.kind === 'highlight');
    if (process.env.KT_DEBUG) console.error(JSON.stringify({ warnings: info.qa.warnings, notes: info.qa.notes, ov: ov.map((o) => [o.label, +o.t.toFixed(3), o.box.y]) }));
    // film ≡ capture clock here (no retime): pick moments from the overlays log, then verify them in pixels
    const pick = (label, pred) => ov.filter((o) => o.label === label && o.alpha > 0.97 && pred(o)).map((o) => o.t);
    const rowBefore = pick('Row', (o) => Math.abs(o.box.y - 300) < 0.5 && o.t > row.t + 0.2).slice(-1)[0];
    const rowAfter = pick('Row', (o) => Math.abs(o.box.y - 180) < 0.5).slice(-1)[0];
    const dlg = pick('Dialog', () => true);
    assert.ok(rowBefore != null && rowAfter != null && dlg.length, 'overlays log has the moments to check');
    assert.ok(!ov.some((o) => o.label === 'Open' && o.t >= cover.t - 1e-6), 'no "Open" highlight once the modal is up');
    assert.ok(!ov.some((o) => o.label === 'Row' && o.t >= cover.t - 1e-6), 'no "Row" highlight once the modal is up');
    const tCovered = cover.t + 0.3;
    const times = [rowBefore, rowAfter, dlg[Math.floor(dlg.length / 2)], tCovered];
    const st = await stills(spec, { specDir: dir, out: path.join(dir, 'r1'), at: times, samples: 1, log: () => {} });
    const files = st.items.map((_, k) => path.join(st.sdir, fs.readdirSync(st.sdir).filter((n) => n.startsWith(String(k + 1).padStart(2, '0') + '_'))[0]));
    const cases = [{ label: 'Row', ref: [255, 0, 255], cssW: 340 }, { label: 'Row', ref: [255, 0, 255], cssW: 340 }, { label: 'Dialog', ref: [0, 80, 255], cssW: 240 }];
    for (const [k, cs] of cases.entries()) {
      const im = decode(files[k]);
      const tr = colourRect(im, cs.ref);
      assert.ok(tr, `${cs.label} @${times[k]}: target colour found`);
      const kz = (tr.x1 - tr.x0) / cs.cssW; // output px per CSS px (camera zoom × window scale), measured
      const want = HIGHLIGHT_PAD * kz;
      const my = Math.round((tr.y0 + tr.y1) / 2), mx = Math.round((tr.x0 + tr.x1) / 2);
      const sides = {
        left: strokeCentre(im, tr.x0, my, -1, 0, want * 3), right: strokeCentre(im, tr.x1 - 1, my, 1, 0, want * 3),
        top: strokeCentre(im, mx, tr.y0, 0, -1, want * 3), bottom: strokeCentre(im, mx, tr.y1 - 1, 0, 1, want * 3),
      };
      for (const [side, d] of Object.entries(sides)) {
        assert.ok(d != null, `${cs.label} @${times[k].toFixed(3)}s: highlight stroke found on the ${side}`);
        // d counts px from the last target pixel; the stroke centre sits HIGHLIGHT_PAD CSS px outside the edge
        assert.ok(Math.abs(d - 0.5 - want) <= 2, `${cs.label} @${times[k].toFixed(3)}s ${side}: stroke centre ${(d - 0.5).toFixed(2)} px out, want ${want.toFixed(2)} ±2`);
      }
    }
    // covered: the (dimmed) row and the button carry no highlight at all
    const im = decode(files[3]);
    assert.equal(colourRect(im, [255, 0, 255], 40), null, 'row is covered by the backdrop (no pure magenta left)');
    const dim = colourRect(im, [118, 0, 118], 30);
    assert.ok(dim, 'dimmed row found under the backdrop');
    const m = 40;
    assert.equal(anyAccentIn(im, { x0: dim.x0 - m, y0: dim.y0 - m, x1: dim.x1 + m, y1: dim.y1 + m }), false, 'no highlight around the covered row');
    const green = colourRect(im, [0, 90, 37], 25);
    assert.ok(green, 'dimmed button found under the backdrop');
    assert.equal(anyAccentIn(im, { x0: green.x0 - m, y0: green.y0 - m, x1: green.x1 + m, y1: green.y1 + m }), false, 'no highlight around the covered button');
  } finally { srv.close(); if (process.env.KT_KEEP) console.error('kept', dir); else fs.rmSync(dir, { recursive: true, force: true }); }
});
