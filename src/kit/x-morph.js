// Outline sampling for glyph-morph: turn shaped runs into ordered, evenly
// spaced point loops that follow the real letter outlines. Pure functions.

/** Flatten one glyph's path commands (font units, y-down) into closed polylines. */
function flatten(cmds) {
  const loops = [];
  let cur = null, cx = 0, cy = 0, sx = 0, sy = 0;
  const push = (x, y) => cur.push(x, y);
  for (const c of cmds) {
    if (c.type === 'M') {
      if (cur && cur.length >= 6) loops.push(cur);
      cur = [];
      cx = sx = c.x; cy = sy = c.y;
      push(cx, cy);
    } else if (c.type === 'L') {
      cx = c.x; cy = c.y; push(cx, cy);
    } else if (c.type === 'Q') {
      for (let k = 1; k <= 10; k++) {
        const t = k / 10, u = 1 - t;
        push(u * u * cx + 2 * u * t * c.x1 + t * t * c.x, u * u * cy + 2 * u * t * c.y1 + t * t * c.y);
      }
      cx = c.x; cy = c.y;
    } else if (c.type === 'C') {
      for (let k = 1; k <= 14; k++) {
        const t = k / 14, u = 1 - t;
        push(
          u * u * u * cx + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
          u * u * u * cy + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y,
        );
      }
      cx = c.x; cy = c.y;
    } else if (c.type === 'Z') {
      if (cur && (cx !== sx || cy !== sy)) push(sx, sy);
      cx = sx; cy = sy;
    }
  }
  if (cur && cur.length >= 6) loops.push(cur);
  return loops;
}

function polyLen(p) {
  let L = 0;
  for (let i = 2; i < p.length; i += 2) L += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  L += Math.hypot(p[0] - p[p.length - 2], p[1] - p[p.length - 1]);
  return L;
}

function signedArea(p) {
  let a = 0;
  for (let i = 0; i < p.length; i += 2) {
    const j = (i + 2) % p.length;
    a += p[i] * p[j + 1] - p[j] * p[i + 1];
  }
  return a / 2;
}

/** Resample a closed polyline to n points at even arc length. */
function resample(p, n) {
  const out = new Float64Array(n * 2);
  const L = polyLen(p);
  const step = L / n;
  const m = p.length / 2;
  let seg = 0, segPos = 0, acc = 0;
  let ax = p[0], ay = p[1];
  let bx = p[2 % p.length], by = p[3 % p.length];
  let segLen = Math.hypot(bx - ax, by - ay);
  for (let k = 0; k < n; k++) {
    const target = k * step;
    while (acc + segLen < target && seg < m) {
      acc += segLen;
      seg++;
      ax = bx; ay = by;
      const j = ((seg + 1) % m) * 2;
      bx = p[j]; by = p[j + 1];
      segLen = Math.hypot(bx - ax, by - ay);
    }
    const f = segLen > 1e-9 ? (target - acc) / segLen : 0;
    out[k * 2] = ax + (bx - ax) * f;
    out[k * 2 + 1] = ay + (by - ay) * f;
    segPos = f;
  }
  return out;
}

/**
 * Sample placed runs into one ordered point cloud of exactly n points.
 * placed: [{run, x, y}] with (x,y) = pen origin on the baseline (canvas px).
 * Returns { x, y (Float64Array n), loop (Int32Array n: contour id), loops }.
 * Contours: left→right by glyph, outer before counters; every contour wound
 * the same way and started at its top-left point, so two words line up.
 */
export function samplePoints(placed, n) {
  const contours = [];
  let gi = 0;
  for (const { run, x, y } of placed) {
    for (const it of run.items) {
      if (!it.g.hasInk) continue;
      const s = run.scale * it.gs;
      const loops = flatten(it.g.commands).map((lp) => {
        const q = new Float64Array(lp.length);
        for (let i = 0; i < lp.length; i += 2) {
          q[i] = x + it.x + lp[i] * s;
          q[i + 1] = y + it.gdy + lp[i + 1] * s;
        }
        return q;
      });
      const withArea = loops.map((q) => ({ q, a: signedArea(q), len: polyLen(q) })).filter((c) => c.len > 1);
      withArea.sort((a, b) => Math.abs(b.a) - Math.abs(a.a));
      for (const c of withArea) {
        let q = c.q;
        if (c.a < 0) {
          // make every contour clockwise (screen space) so morphs never flip
          const r = new Float64Array(q.length);
          for (let i = 0; i < q.length; i += 2) { r[i] = q[q.length - 2 - i]; r[i + 1] = q[q.length - 1 - i]; }
          q = r;
        }
        let cxs = 0;
        for (let i = 0; i < q.length; i += 2) cxs += q[i];
        contours.push({ q, len: c.len, glyph: gi, cx: cxs / (q.length / 2) });
      }
      gi++;
    }
  }
  const total = contours.reduce((a, c) => a + c.len, 0) || 1;
  // largest-remainder allocation, at least 6 points per contour
  const raw = contours.map((c) => Math.max(6, (n * c.len) / total));
  let counts = raw.map(Math.floor);
  let rem = n - counts.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rem > 0 && k < order.length * 4; k++, rem--) counts[order[k % order.length][1]]++;
  while (rem < 0) {
    const i = counts.indexOf(Math.max(...counts));
    counts[i]--;
    rem++;
  }
  const X = new Float64Array(n), Y = new Float64Array(n), loop = new Int32Array(n);
  let o = 0;
  contours.forEach((c, ci) => {
    const pts = resample(c.q, counts[ci]);
    // start at the top-left-most point
    let best = 0, bv = Infinity;
    for (let k = 0; k < counts[ci]; k++) {
      const v = pts[k * 2 + 1] + pts[k * 2] * 0.35;
      if (v < bv) { bv = v; best = k; }
    }
    for (let k = 0; k < counts[ci]; k++) {
      const j = ((k + best) % counts[ci]) * 2;
      X[o] = pts[j]; Y[o] = pts[j + 1]; loop[o] = ci; o++;
    }
  });
  return { x: X, y: Y, loop, loops: contours.length, n };
}
