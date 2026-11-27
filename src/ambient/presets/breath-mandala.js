// breath-mandala v3: luminous sacred geometry on deep indigo. The figure and a central light expand on
// the inhale (40 %) and settle on the exhale (60 %) at ~6 breaths/min. Rings turn by whole symmetry steps
// per loop (loop-closed), far below 1 degree per second. The seed picks structure AND palette:
// symmetry order, which layers exist, ring radii, star-polygon step, line weight, background family.
export const FRAG = `
float breath(){
  float cycles = floor(u_loop * 6.0 / 60.0 + 0.5);
  float t = fract(u_phase * cycles);
  return t < 0.4 ? 0.5 - 0.5 * cos(3.14159265 * t / 0.4) : 0.5 + 0.5 * cos(3.14159265 * (t - 0.4) / 0.6);
}
// soft luminous line: core + bloom, width in pixels
float glowLine(float d, float wpx){
  float px = 1.0 / u_res.y; float w = wpx * px;
  return exp(-d * d / (w * w)) * 0.75 + exp(-d * d / (36.0 * w * w)) * 0.30;
}
float seg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
float starPoly(vec2 p, float n, float k, float R, float rot){
  float d = 1e9;
  for (int i = 0; i < 12; i++){
    if (float(i) >= n) break;
    float a0 = rot + TAU * float(i) / n, a1 = rot + TAU * (float(i) + k) / n;
    d = min(d, seg(p, R * vec2(cos(a0), sin(a0)), R * vec2(cos(a1), sin(a1))));
  }
  return d;
}
float hseed(float k){ return hash12(vec2(k, 7.0) + u_seed.xy * 97.0); }
void main(){
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  float pulse = u_p0.x > 0.0 ? u_p0.x : 1.0;   // 1 = breathing guide, 0.001 = still variant for sleep/long-form
  float b = breath() * pulse;
  // ---- structure from the seed ----
  float nOpts[7] = float[7](5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 12.0);
  float n = nOpts[int(floor(hseed(1.0) * 6.999))];
  float kStar = 2.0;                                        // gentle star polygon only (no spiky starbursts)
  float hasSeed = step(0.25, hseed(3.0)), hasStar = step(0.3, hseed(4.0)), hasLotus = step(0.2, hseed(5.0));
  float hasDots = step(0.4, hseed(6.0)), hasOuter = step(0.3, hseed(7.0)), hasSpokes = 0.0;
  float rings = 1.0 + floor(hseed(9.0) * 3.0);
  float scaleAll = 0.95 + 0.13 * hseed(10.0);              // minimum figure size; outer ring capped
  float lw = 3.0 + 1.8 * hseed(11.0);                       // soft line weight 3-4.8 px
  // palette families: ink, accent, background
  int pal = int(floor(hseed(12.0) * 7.999));
  vec3 ink, acc, bgA, bgB;
  if (pal == 0)      { ink = vec3(1.00, 0.74, 0.40); acc = vec3(1.00, 0.55, 0.35); bgA = vec3(0.030, 0.018, 0.060); bgB = vec3(0.004, 0.003, 0.012); }  // gold on indigo
  else if (pal == 1) { ink = vec3(1.00, 0.68, 0.62); acc = vec3(0.85, 0.50, 0.95); bgA = vec3(0.040, 0.014, 0.046); bgB = vec3(0.006, 0.002, 0.010); }  // rose on plum
  else if (pal == 2) { ink = vec3(0.62, 0.88, 0.98); acc = vec3(0.50, 0.66, 1.00); bgA = vec3(0.010, 0.022, 0.060); bgB = vec3(0.002, 0.004, 0.014); }  // ice on sapphire
  else if (pal == 3) { ink = vec3(0.84, 0.72, 1.00); acc = vec3(1.00, 0.72, 0.86); bgA = vec3(0.026, 0.012, 0.064); bgB = vec3(0.004, 0.002, 0.014); }  // lavender on violet
  else if (pal == 4) { ink = vec3(0.72, 1.00, 0.84); acc = vec3(1.00, 0.88, 0.58); bgA = vec3(0.008, 0.030, 0.034); bgB = vec3(0.001, 0.006, 0.009); }  // jade and gold
  else if (pal == 5) { ink = vec3(1.00, 0.88, 0.66); acc = vec3(0.62, 0.80, 1.00); bgA = vec3(0.022, 0.022, 0.050); bgB = vec3(0.003, 0.003, 0.010); }  // champagne on night blue
  else if (pal == 6) { ink = vec3(1.00, 0.80, 0.55); acc = vec3(1.00, 0.55, 0.50); bgA = vec3(0.045, 0.020, 0.022); bgB = vec3(0.008, 0.003, 0.006); }  // amber on deep wine
  else               { ink = vec3(0.90, 0.92, 1.00); acc = vec3(0.70, 0.80, 1.00); bgA = vec3(0.016, 0.020, 0.040); bgB = vec3(0.002, 0.003, 0.008); }  // silver moonlight
  vec2 t = loopc(0.9, 1.0) + loopc(0.22, 2.0) + u_seed.zw * 30.0;

  // ---- background: radial gradient, slow haze, faint distant stars ----
  float r = length(p);
  vec3 col = mix(bgA, bgB, smoothstep(0.0, 0.95, r));
  float hz = fbm(p * 1.3, t, 4);
  col += mix(bgA * 1.6, acc * 0.05, 0.4) * smoothstep(-0.15, 0.8, hz) * (1.0 - smoothstep(0.2, 1.0, r));
  {
    vec2 g = p * 70.0, id = floor(g), f = fract(g) - 0.5;
    vec2 h = hash22(id + u_seed.zw * 50.0);
    float dpx = length(f - (h - 0.5) * 0.6) / 70.0 * u_res.y;
    col += vec3(0.8, 0.85, 1.0) * step(0.93, h.x) * 0.25 * (0.7 + 0.3 * osc(2.0 + floor(h.y * 4.0), h.x)) * exp(-dpx * dpx / 0.8) * smoothstep(0.25, 0.6, r);
  }

  // ---- the figure: breathes 6 % in scale ----
  float s = scaleAll * (1.0 + 0.03 * b);
  vec2 q = p / s; float rq = length(q), th = atan(q.y, q.x);
  float rotA = TAU * u_phase / n, rotB = -TAU * u_phase * 2.0 / n;
  float L = 0.0, La = 0.0;                                  // ink lines, accent lines
  float R1 = 0.085;
  if (hasSeed > 0.5){
    for (int k = 0; k < 12; k++){
      if (float(k) >= n) break;
      float a = TAU * float(k) / n + rotA;
      L += 0.50 * glowLine(length(q - R1 * vec2(cos(a), sin(a))) - R1, lw);
    }
    L += 0.55 * glowLine(rq - R1 * 2.0, lw);
  } else {
    // inner rose instead of seed-of-life
    L += 0.65 * glowLine(rq - 0.12 * (0.75 + 0.25 * cos(n * (th - rotA))), lw);
  }
  if (hasStar > 0.5){
    L += 0.45 * glowLine(starPoly(q, n, kStar, 0.25, rotB), lw);
    La += 0.30 * glowLine(starPoly(q, n, kStar, 0.25, rotB + TAU / (2.0 * n)), lw * 0.8);
  }
  for (int i = 0; i < 3; i++){
    if (float(i) >= rings) break;
    float rr = 0.25 + 0.013 * float(i) + (hasStar > 0.5 ? 0.0 : -0.03);
    L += (0.42 - 0.1 * float(i)) * glowLine(rq - rr, lw * 0.9);
  }
  if (hasLotus > 0.5){
    float sector = TAU / (2.0 * n);
    float a2 = mod(th - rotA, sector * 2.0) - sector;
    float petal = 0.272 + 0.095 * pow(max(cos(a2 / sector * 1.5707963), 0.0), 1.5);
    La += 0.45 * glowLine(rq - petal, lw) * step(0.262, rq);
  }
  if (hasSpokes > 0.5){
    float sp = TAU / n;
    float a3 = mod(th - rotB, sp) - 0.5 * sp;
    float dsp = abs(a3) * rq;
    L += 0.22 * glowLine(dsp, lw * 0.7) * smoothstep(0.10, 0.14, rq) * smoothstep(0.40, 0.33, rq);
  }
  if (hasDots > 0.5){
    float nd = 4.0 * n, ds = TAU / nd;
    float da = mod(th + ds * 3.0 * u_phase, ds) - 0.5 * ds;
    vec2 dp = vec2(rq - 0.395, da * 0.395) * u_res.y;
    La += 0.9 * exp(-dot(dp, dp) / (lw * lw * 1.4));
  }
  if (hasOuter > 0.5) L += 0.25 * glowLine(rq - 0.425, lw * 0.8) + 0.18 * glowLine(rq - 0.44, lw * 0.7);

  // filled petals in two layers (depth): soft radial fill, inner layer brighter, outer layer offset by half a sector
  {
    for (int lay = 0; lay < 2; lay++){
      float fl = float(lay);
      float sector = TAU / n;
      float a4 = mod(th - rotA + fl * 0.5 * sector, sector) - 0.5 * sector;
      float R0 = 0.11 + 0.10 * fl, R1p = 0.24 + 0.12 * fl;
      float wdt = (0.5 - 0.12 * fl) * sector * (1.0 - smoothstep(R0, R1p, rq));
      float inside = smoothstep(0.035, -0.015, abs(a4) * rq - wdt * rq) * smoothstep(R0 - 0.05, R0 + 0.04, rq) * smoothstep(R1p + 0.03, R1p - 0.07, rq);
      float grad = 0.35 + 0.65 * (1.0 - smoothstep(R0, R1p, rq));
      col += mix(acc, ink, 0.4 + 0.3 * fl) * inside * grad * (0.032 - 0.012 * fl) * (0.85 + 0.15 * b);
    }
  }
  float shimmer = 0.65 + 0.35 * snoise(vec4(q * 2.2, t * 0.8));   // light wanders along the lines
  float fadeOut = 1.0 - smoothstep(0.40, 0.50, rq);
  float bright = 0.40 + 0.08 * b;
  col += (ink * L + acc * La) * shimmer * bright * (0.4 + 0.6 * fadeOut);

  // orbiting motes (integer orbits per loop)
  for (int m = 0; m < 28; m++){
    float fm = float(m);
    vec2 h = hash22(vec2(fm, 3.0) + u_seed.xy * 20.0);
    float orbits = (h.x < 0.5 ? 1.0 : 2.0) * (h.y < 0.5 ? 1.0 : -1.0);
    float ang = TAU * (h.x + u_phase * orbits);
    float rad = 0.16 + 0.32 * h.y;
    float dpx = length(q - rad * vec2(cos(ang), sin(ang))) * u_res.y;
    float tw = 0.6 + 0.4 * osc(3.0 + floor(h.y * 4.0), h.x);
    col += mix(ink, acc, h.x) * 0.20 * tw * exp(-dpx * dpx / 7.0);
  }
  // the breath light: wide, readable swing, bounded peak
  float core = exp(-r * r / (0.004 + 0.004 * b));
  float halo = exp(-r * r / (0.03 + 0.025 * b));
  col += mix(vec3(1.0, 0.88, 0.72), ink, 0.35) * (core * (0.26 + 0.05 * b) + halo * (0.07 + 0.015 * b))   /* pulse felt, not watched */;
  col = col / (1.0 + col * 0.45);
  vec2 uv = gl_FragCoord.xy / u_res - 0.5;
  col *= 1.0 - 0.5 * dot(uv, uv);
  o = vec4(finish(col, 0.015), 1.0);
}
`;

export const meta = {
  id: 'breath-mandala',
  title: 'Breath Mandala',
  family: 'generative',
  formats: ['16:9'],
  pillars: ['mind-power', 'teachings'],
  mood: ['breathing', 'focus', 'sacred'],
  loopSeconds: 600,
  params: {
    pulse: { default: 0, min: 0, max: 1.5, uniform: 'u_p0.x', doc: 'breathing pulse amplitude: 0 = built-in (1 = breathing guide), 0.001 = still variant for sleep/long-form' },
  },
  images: 0,
};
