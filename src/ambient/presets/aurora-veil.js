// aurora-veil: slow aurora curtains over a dark ridge and a still lake. Sleep / evening.
// Low average picture level, amber horizon, teal-to-violet light. No cuts, no fast motion.
export const FRAG = `
float ridge(float x){
  float h = 0.0, a = 0.5, f = 1.3;
  for (int i = 0; i < 5; i++){ h += a * snoise(vec4(x * f, 3.7 + float(i), u_seed.zw * 9.0)); f *= 2.03; a *= 0.48; }
  return h;
}
vec3 stars(vec2 p){
  vec3 acc = vec3(0.0);
  for (int L = 0; L < 2; L++){
    float sc = L == 0 ? 90.0 : 45.0;
    vec2 g = p * sc, id = floor(g), f = fract(g) - 0.5;
    vec2 h = hash22(id + float(L) * 41.0 + u_seed.xy * 100.0);
    float on = step(L == 0 ? 0.86 : 0.93, h.x);
    vec2 o = (h - 0.5) * 0.7;
    float d = length(f - o) / sc * u_res.y;   // pixels
    float tw = 0.8 + 0.2 * osc(floor(3.0 + h.y * 6.0), h.x);
    float b = on * pow(h.y, 3.0) * (L == 0 ? 0.5 : 1.0) * tw;
    float sg = (L == 0 ? 0.75 : 1.2) * u_res.y / 1080.0;
    acc += b * exp(-d * d / (sg * sg)) * vec3(0.85, 0.9, 1.0);
  }
  return acc;
}
vec3 aurora(vec2 p, vec2 t, out float alpha){
  vec3 col = vec3(0.0); alpha = 0.0;
  float hueShift = u_seed.x;
  for (int i = 0; i < 3; i++){
    float fi = float(i);
    float x = p.x * (0.9 + 0.25 * fi) + fi * 2.3 + u_seed.y * 7.0;
    float base = 0.08 + 0.11 * fi + 0.16 * snoise(vec4(x * 0.55, fi * 4.1, t * 0.6));
    float wx = x + 0.30 * snoise(vec4(x * 0.7, p.y * 0.12, t + fi * 3.0));   // warp mostly along x: rays stay vertical
    float rays = 0.5 + 0.5 * snoise(vec4(wx * 11.0, p.y * 0.3, t * 0.8 + fi * 5.0));
    float thin = pow(0.5 + 0.5 * snoise(vec4(wx * 34.0, p.y * 0.4, t * 0.7 + fi * 2.0)), 5.0) + 0.6 * pow(0.5 + 0.5 * snoise(vec4(wx * 90.0, p.y * 0.8, t * 0.6 + fi)), 8.0);   // a few bright thin rays
    rays = 0.50 + 0.42 * smoothstep(0.1, 0.95, rays) + 0.45 * thin;
    // brightness varies along the ribbon (folds seen edge-on are brighter)
    float fold = 0.75 + 0.5 * smoothstep(0.2, 0.9, abs(snoise(vec4(wx * 1.9, 2.0 + fi, t * 0.7))));
    float d = p.y - base;
    float body = smoothstep(-0.07, 0.06, d) * smoothstep(-0.07, 0.0, d) * exp(-max(d, 0.0) * (3.2 - fi * 0.6));   // lower edge fades out: no dome edge (ghost hill)
    float spill = 0.07 * exp(-abs(min(d, 0.0)) * 18.0) * (1.0 - smoothstep(-0.015, 0.05, d)) * rays;   // faint glow under the edge
    float fade = 0.5 + 0.5 * snoise(vec4(x * 0.22, 9.0 + fi, t * 0.25));   // slow brightness envelope
    float env = smoothstep(0.40, 0.90, fade + (i == 0 ? 0.20 : -0.06)); // parts of the sky glow
    if (i == 0) env = max(env, 0.32);                                  // the low curtain never vanishes
    float I = (body * rays * fold) * env * (0.80 - fi * 0.20);
    int fam = int(floor(hash12(u_seed.yz * 53.0) * 3.999));
    vec3 low, high;
    if (fam == 0)      { low = vec3(0.12, 0.90, 0.42); high = vec3(0.30, 0.20, 0.55); }   // classic green, violet crown
    else if (fam == 1) { low = vec3(0.12, 0.70, 0.85); high = vec3(0.28, 0.24, 0.62); }   // teal-blue
    else if (fam == 2) { low = vec3(0.20, 0.85, 0.50); high = vec3(0.70, 0.20, 0.42); }   // green with a rose crown
    else               { low = vec3(0.45, 0.30, 0.85); high = vec3(0.75, 0.25, 0.55); }   // rare violet/magenta night
    low = mix(low, low.gbr * 0.2 + low * 0.8, hueShift * 0.3);
    vec3 mid = mix(low, vec3(0.12, 0.75, 0.80), 0.6);
    vec3 c3 = d < 0.12 ? mix(low, mid, smoothstep(0.02, 0.12, d)) : mix(mid, high, smoothstep(0.12, 0.32, d));
    col += I * c3 * (1.0 + 0.6 * exp(-max(d, 0.0) * 30.0));
    alpha += I;
  }
  return col;
}
void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = (gl_FragCoord.xy - vec2(0.5 * u_res.x, 0.0)) / u_res.y;   // y: 0 at bottom
  vec2 t = loopc(1.15, 1.0) + loopc(0.28, 3.0) + u_seed.zw * 20.0;
  float hz1 = hash12(u_seed.zw * 61.0), hz2 = hash12(u_seed.xy * 37.0 + 3.0);
  float horizon = 0.24 + 0.11 * hz1;                    // horizon height varies by seed
  float tall = 0.6 + 2.2 * hz2 * hz2;                         // low hills ... tall mountains
  float rx = p.x * 1.4;
  float side = smoothstep(0.15, 0.85, abs(p.x + (u_seed.y - 0.5) * 0.6));
  float rh = horizon + 0.012 + (0.03 + 0.11 * side) * tall * (0.5 + 0.5 * ridge(rx * 0.5)) + 0.012 * ridge(rx * 2.4);
  float trees = step(0.5, hash12(u_seed.xw * 29.0));
  if (trees > 0.5){
    // two irregular rows of spruce, in clusters with clearings
    float cluster = smoothstep(-0.35, 0.25, snoise(vec4(rx * 2.2, 1.0, u_seed.xy * 13.0)));
    float tAdd = 0.0;
    for (int r = 0; r < 2; r++){
      float fr = float(r), freq = r == 0 ? 48.0 : 83.0;
      float tc = rx * freq + fr * 0.37, tid = floor(tc);
      float th = hash12(vec2(tid, 4.0 + fr) + u_seed.xy * 9.0);
      float tf = fract(tc) - 0.5 - (hash12(vec2(tid, 8.0 + fr)) - 0.5) * 0.5;
      float treeH = (r == 0 ? 0.010 + 0.022 * th : 0.006 + 0.012 * th) * step(0.12, th) * cluster;
      float spike = max(0.0, 1.0 - abs(tf) * (2.4 + 1.2 * th));
      tAdd = max(tAdd, treeH * pow(spike, 0.85));
    }
    rh += tAdd;
  }
  // far ridge: lower, hazier, lit by the aurora
  float rhF = horizon + 0.006 + (0.02 + 0.025 * tall) * (0.5 + 0.5 * ridge(rx * 0.9 + 11.0)) + 0.006 * ridge(rx * 3.1 + 4.0);
  vec3 col;
  float y = p.y;
  bool snow = hash12(u_seed.zx * 17.0) < 0.33;
  bool water = y < horizon && !snow;
  vec2 q = vec2(p.x, y);
  if (water){
    float depthW = (horizon - y) / horizon;
    float rip = snoise(vec4(p.x * 3.0, (horizon - y) * 45.0 / (0.3 + depthW), t * 1.4)) * 0.0065 * (0.25 + depthW) * smoothstep(0.0, 0.06, horizon - y);
    q = vec2(p.x + rip, 2.0 * horizon - y + rip * 2.5);
  }
  float sy = (q.y - horizon) / (1.0 - horizon);
  vec3 sky = mix(vec3(0.020, 0.030, 0.060), vec3(0.006, 0.010, 0.026), smoothstep(0.0, 0.9, sy));
  sky += vec3(0.26, 0.12, 0.04) * exp(-sy * 14.0) * (0.45 + 0.25 * u_seed.y);
  sky += vec3(0.010, 0.012, 0.020) * exp(-sy * 7.0);                      // atmospheric haze at the horizon
  sky += stars(vec2(q.x, q.y)) * smoothstep(0.02, 0.25, sy) * (0.55 + 0.45 * smoothstep(0.1, 0.8, sy));
  float a;
  vec3 au = aurora(vec2(q.x, q.y - horizon), t, a);
  sky += au * 0.75;
  col = sky;
  vec3 haze = vec3(0.045, 0.040, 0.050) + au * 0.10;
  vec3 farCol = mix(vec3(0.008, 0.011, 0.020), haze, 0.22);   // far ridge darker than the sky: no light arc
  vec3 nearCol = vec3(0.005, 0.007, 0.012) + au * 0.03;
  float yy = water ? q.y : y;
  float aa = (water ? 2.5 : 1.2) / u_res.y;             // ~1-2.5 px soft edge: no aliasing on tree tips
  float far = smoothstep(rhF + aa, rhF - aa, yy);
  float near = smoothstep(rh + aa, rh - aa, yy);
  // the ridges fade into haze toward their base instead of ending in a hard line
  float baseHaze = exp(-max(yy - horizon, 0.0) * 55.0);
  col = mix(col, farCol, far);
  col = mix(col, nearCol + haze * 0.35 * baseHaze, near);
  if (snow && y < horizon){
    float sd = (horizon - y) / horizon;
    float drift = fbm(vec2(p.x * 2.0, sd * 9.0), t * 0.3 + 2.0, 3) * 0.5 + 0.5;
    col = mix(vec3(0.020, 0.026, 0.040), vec3(0.008, 0.010, 0.018), sd) * (0.85 + 0.3 * drift) + au * 0.05 * (1.0 - sd);
  }
  if (water){
    float depthW = (horizon - y) / horizon;
    col *= mix(0.55, 0.22, smoothstep(0.0, 1.0, depthW));     // reflection fades into dark water toward the viewer
    col += vec3(0.008, 0.010, 0.018) * depthW;
  }
  // low mist resting on the water and the shoreline, drifting slowly
  float mist = fbm(vec2(p.x * 1.6, (y - horizon) * 9.0), t * 0.6 + 5.0, 4) * 0.5 + 0.5;
  float mband = exp(-pow((y - horizon + 0.006) / 0.03, 2.0));
  col += (vec3(0.07, 0.065, 0.075) + au * 0.12) * mband * smoothstep(0.35, 0.8, mist) * 0.8;
  // vignette
  vec2 vv = uv - 0.5; col *= 1.0 - 0.35 * dot(vv, vv) * 2.0;
  o = vec4(finish(col, 0.018), 1.0);
}
`;

export const meta = {
  id: 'aurora-veil',
  title: 'Aurora Veil',
  family: 'generative',
  formats: ['16:9'],
  pillars: ['cosmos', 'mind-power'],
  mood: ['sleep', 'evening', 'calm'],
  loopSeconds: 600,
  params: {},
  images: 0,
};
