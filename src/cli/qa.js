// Quality gates. Layout QA runs on what the template REGISTERED (boxes,
// sizes, colours, beat hits); pixel QA runs on rendered bytes. Each check
// names its subject and says what it could not see.
import { contrast, hexToRgb } from '../kit/color.js';

const check = (id, status, detail, data) => ({ id, status, detail, ...(data ? { data } : {}) });

export function layoutQA(info, spec) {
  const checks = [];
  const { width: W, height: H, qa } = info;
  const rules = spec.rules || {};
  const safe = rules.safeMargin ?? Math.round(Math.min(W, H) * 0.035);
  // 1. safe area
  const out = qa.texts.filter((t) => t.box && (t.box.x0 < safe - 0.5 || t.box.y0 < safe - 0.5 || t.box.x1 > W - safe + 0.5 || t.box.y1 > H - safe + 0.5) && !t.bleed);
  checks.push(check('safe-area', qa.texts.length ? (out.length ? 'fail' : 'pass') : 'unknown', qa.texts.length ? `${out.length}/${qa.texts.length} registered text boxes cross the ${safe}px safe margin` : 'template registered no text boxes', out.length ? out.map((t) => ({ label: t.label, box: roundBox(t.box) })) : undefined));
  // 2. contrast
  const lows = [];
  for (const t of qa.texts) {
    if (!t.fg || !t.bg) continue;
    const c = contrast(t.fg, t.bg);
    const need = (t.size ?? 0) >= 36 ? 3 : 4.5;
    if (c < need) lows.push({ label: t.label, ratio: +c.toFixed(2), need });
  }
  const hardLows = lows.filter((l) => !qa.texts.find((t) => t.label === l.label)?.decorative);
  checks.push(check('contrast', hardLows.length ? 'fail' : lows.length ? 'warn' : qa.texts.some((t) => t.fg) ? 'pass' : 'unknown', lows.length ? `${lows.length} text layers below WCAG ratio` : 'all registered text meets WCAG (3:1 large, 4.5:1 small)', lows.length ? lows : undefined));
  // 3. minimum size (phone feeds show a 1080 frame at ~40%)
  const minPx = rules.minTextPx ?? Math.round(Math.min(W, H) * 0.0148); // 16px at 1080
  const tiny = qa.texts.filter((t) => t.size && t.size < minPx && !t.decorative);
  checks.push(check('min-text-size', tiny.length ? 'warn' : 'pass', tiny.length ? `${tiny.length} readable text layers under ${minPx}px cap size` : `no readable text under ${minPx}px`, tiny.length ? tiny.map((t) => ({ label: t.label, size: +t.size.toFixed(1) })) : undefined));
  // 4. orphans
  const orphans = qa.texts.filter((t) => Array.isArray(t.lines) && t.lines.length >= 2 && t.lines[t.lines.length - 1].trim().split(/\s+/).length === 1 && t.lines.join(' ').split(/\s+/).length >= 4 && !t.orphanOk);
  checks.push(check('orphans', orphans.length ? 'warn' : 'pass', orphans.length ? `${orphans.length} blocks end on a single-word line` : 'no single-word last lines in multi-line blocks', orphans.length ? orphans.map((t) => ({ label: t.label, lines: t.lines })) : undefined));
  // 5. beat coverage
  const bc = rules.beatCoverage;
  if (bc !== false) {
    const bpm = info.bpm;
    const dense = bc?.dense ?? 0, then = bc?.then ?? 0;
    if (dense || then) {
      const beats = beatTimes(spec, info);
      const tol = 1.01 / info.fps;
      const missing = [];
      beats.forEach((bt, n) => {
        const required = (bc?.until == null || n < bc.until) && (n < dense || (then && (n - dense) % then === 0));
        if (!required) return;
        if (!qa.hits.some((h) => Math.abs(h.t - bt) <= tol)) missing.push({ beat: n, t: +bt.toFixed(3) });
      });
      checks.push(check('beat-coverage', missing.length ? 'fail' : 'pass', missing.length ? `${missing.length} required beats have no registered hit` : `every required beat (first ${dense}, then every ${then}) has a hit`, missing.length ? missing : undefined));
    }
  }
  // checks templates run on their own output (e.g. ui-demo highlight accuracy); a fail fails the render
  for (const c of qa.checks || []) checks.push(c);
  // warnings templates raise about their own inputs (e.g. a shot cut short)
  checks.push(check('template-warnings', qa.warnings.length ? 'warn' : 'pass', qa.warnings.length ? qa.warnings.join(' | ') : 'no template warnings'));
  return { checks, texts: qa.texts.length, hits: qa.hits.length, notes: qa.notes, warnings: qa.warnings };
}

function beatTimes(spec, info) {
  const bpm = spec.bpm ?? 120, off = spec.beatOffset ?? 0;
  if (spec.audio?.beats?.length) return spec.audio.beats.filter((b) => b >= 0 && b < info.duration);
  const out = [];
  for (let n = 0; off + (n * 60) / bpm < info.duration - 1e-6; n++) out.push(off + (n * 60) / bpm);
  return out;
}

const roundBox = (b) => ({ x0: Math.round(b.x0), y0: Math.round(b.y0), x1: Math.round(b.x1), y1: Math.round(b.y1) });

/**
 * Streaming pixel QA: frames are inspected as they pass (never retained), so
 * a 3-minute 1080x1920 render costs the same memory as a 20s one. Checks the
 * loop seam (first vs last frame) and palette discipline (saturated pixels
 * whose hue is not near any palette hue).
 */
export function pixelQAStream({ info, spec, first, last }) {
  const pal = Object.values(info.palette || {}).filter((v) => typeof v === 'string' && /^#/.test(v));
  const hues = pal.map(hueSat).filter((h) => h.s > 0.25).map((h) => h.h);
  const tol = spec.rules?.hueTolerance ?? 14;
  const strict = spec.rules?.paletteStrict !== false && hues.length > 0;
  const every = Math.max(1, Math.round(info.fps / 6));
  let firstBuf = null, lastBuf = null, worst = { frame: -1, frac: 0 }, sampled = 0;
  return {
    /** ex: [[x0, y0, x1, y1]] render-px regions of third-party pixels (captured UI, logos) to skip */
    push(i, buf, ex = null) {
      if (i === first) firstBuf = Buffer.from(buf);
      if (i === last) lastBuf = Buffer.from(buf);
      if (!strict || ((i - first) % every !== 0 && i !== last)) return;
      sampled++;
      let off = 0, seen = 0;
      const rowW = info.renderWidth || info.width;
      for (let p = 0; p < buf.length; p += 16) {
        if (ex && ex.length) {
          const px = p >> 2, x = px % rowW, y = (px / rowW) | 0;
          if (ex.some((r) => x >= r[0] && x < r[2] && y >= r[1] && y < r[3])) continue;
        }
        seen++;
        const r = buf[p], g = buf[p + 1], b = buf[p + 2];
        if (Math.max(r, g, b) - Math.min(r, g, b) < 48) continue; // near-neutral
        const h = rgbHue(r, g, b);
        if (!hues.some((ph) => Math.min(Math.abs(h - ph), 360 - Math.abs(h - ph)) <= tol)) off++;
      }
      const frac = off / Math.max(1, seen);
      if (frac > worst.frac) worst = { frame: i, frac };
    },
    finish() {
      const checks = [];
      if (info.loop && first === 0 && last === info.frames - 1 && firstBuf && lastBuf) {
        let maxd = 0, diff = 0;
        for (let i = 0; i < firstBuf.length; i++) {
          const d = Math.abs(firstBuf[i] - lastBuf[i]);
          if (d > maxd) maxd = d;
          if (d > 2) diff++;
        }
        const need = spec.rules?.loopExact ?? true;
        checks.push(check('loop-seam', maxd === 0 ? 'pass' : need ? 'fail' : 'warn', maxd === 0 ? 'frame 0 and last frame are byte-identical' : `frame 0 vs last: max channel diff ${maxd}, ${diff} channels differ by >2`));
      } else if (info.loop) checks.push(check('loop-seam', 'unknown', 'partial render: seam not checked'));
      if (strict) {
        const limit = spec.rules?.offPaletteMax ?? 0.002;
        checks.push(check('palette', worst.frac > limit ? 'fail' : 'pass', `worst frame ${worst.frame}: ${(worst.frac * 100).toFixed(3)}% saturated pixels off-palette (limit ${(limit * 100).toFixed(2)}%), ${sampled} frames sampled`));
      } else checks.push(check('palette', 'unknown', spec.rules?.paletteStrict === false ? 'disabled by spec rules.paletteStrict=false' : 'palette has no saturated hues to enforce'));
      return { checks, framesSampled: sampled };
    },
  };
}

function hueSat(hex) {
  const [r, g, b] = hexToRgb(hex);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return { h: rgbHue(r, g, b), s: mx ? (mx - mn) / mx : 0 };
}
function rgbHue(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0;
  let h;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
