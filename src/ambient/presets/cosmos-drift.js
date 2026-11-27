// cosmos-drift v2: soft emission nebula (low-frequency clouds, gentle warp, glowing cores, dust lanes)
// with parallax star layers. Star layers repeat every P cells and pan exactly P cells per loop.
export const FRAG = `
vec3 starLayer(vec2 p, float cell, float pan, float density, float size, float bright, float salt){
  float aspect = u_res.x / u_res.y;
  float P = ceil((aspect + 0.2) / cell) + 1.0;
  vec2 g = p / cell + vec2(u_phase * P * pan, 0.0);
  vec2 id = floor(g);
  vec3 acc = vec3(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){
    vec2 cid = id + vec2(float(i), float(j));
    vec2 key = vec2(mod(cid.x, P), cid.y) + salt + u_seed.xy * 50.0;
    vec2 h = hash22(key);
    if (h.x > density) continue;
    vec2 pos = cid + 0.15 + 0.7 * hash22(key + 7.7);
    float dpx = length(g - pos) * cell * u_res.y;
    float sg = size * u_res.y / 1080.0;
    float mag = pow(hash12(key + 3.1), 5.0);
    float tw = 0.88 + 0.12 * osc(floor(2.0 + h.y * 5.0), h.x);
    vec3 tint = mix(vec3(1.0, 0.82, 0.65), vec3(0.72, 0.84, 1.0), hash12(key + 9.2));
    float win = smoothstep(cell * u_res.y * 0.9, 0.0, dpx);   // halo ends inside the 3x3 neighbourhood: no square cells
    acc += tint * bright * (0.2 + 1.6 * mag) * tw * (exp(-dpx * dpx / (sg * sg)) + 0.05 * mag * exp(-dpx / (sg * 4.0)) * win);
  }
  return acc;
}
// a few bright foreground stars with a wide soft bloom (depth cue); they pan with the near layer
vec3 heroStars(vec2 p){
  float cell = 0.22, aspect = u_res.x / u_res.y;
  float P = ceil((aspect + 0.2) / cell) + 1.0;
  vec2 g = p / cell + vec2(u_phase * P * 1.0, 0.0);
  vec2 id = floor(g);
  vec3 acc = vec3(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){
    vec2 cid = id + vec2(float(i), float(j));
    vec2 key = vec2(mod(cid.x, P), cid.y) + 77.0 + u_seed.xy * 50.0;
    vec2 h = hash22(key);
    if (h.x > 0.16) continue;
    vec2 pos = cid + 0.2 + 0.6 * hash22(key + 4.4);
    float dpx = length(g - pos) * cell * u_res.y;
    float sg = 1.1 * u_res.y / 1080.0;
    float win = smoothstep(cell * u_res.y * 0.95, 0.0, dpx);
    vec3 tint = mix(vec3(1.0, 0.86, 0.72), vec3(0.75, 0.86, 1.0), h.y);
    float tw = 0.92 + 0.08 * osc(floor(2.0 + h.y * 3.0), h.x);
    acc += tint * tw * (1.6 * exp(-dpx * dpx / (sg * sg)) + 0.035 * exp(-dpx / (sg * 5.0)) * win);
  }
  return acc;
}
float soft(vec2 p, vec2 t){ return fbm(p, t, 4) * 0.5 + 0.5; }
void main(){
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  vec2 t = loopc(0.85, 1.0) + loopc(0.18, 2.0) + u_seed.zw * 40.0;
  vec2 tm = loopc(0.22, 1.0) + u_seed.zw * 40.0;                 // macro structure evolves 4x slower: stable composition
  vec2 np = p * 0.75 + u_seed.xy * 10.0;
  // gentle warp
  vec2 w = vec2(fbm(np * 0.8, tm, 3), fbm(np * 0.8 + 4.7, tm + 2.0, 3));
  vec2 q = np + 0.35 * w;
  float base = soft(q, tm);
  // focal core: a brighter region placed by the seed, so the eye has somewhere to rest
  vec2 fc = (u_seed.xy - 0.5) * vec2(0.9, 0.5);
  float focal = exp(-dot(p - fc, p - fc) / 0.09);
  base = base * (0.70 + 0.55 * focal);
  float fil = 1.0 - abs(fbm(q * 2.2 + 3.3, t * 0.8 + 5.0, 4));   // ridged filaments
  float detail = fbm(q * 5.5 + 1.7, t * 0.6 + 9.0, 3);              // fine resolved structure in the bright parts
  float dens = smoothstep(0.48, 0.88, base) * (0.70 + 0.50 * detail);
  float core = smoothstep(0.62, 0.95, base) * smoothstep(0.55, 0.95, fil);
  float wisp = pow(fil, 6.0) * smoothstep(0.35, 0.7, base);
  // palettes chosen by seed (clean, hue-separated; the old amber/rose family read as muddy brown)
  float hs = fract(u_seed.z * 7.31 + u_seed.w * 3.17);
  vec3 deep, mid, mid2, hot;
  if (hs < 0.25)      { deep = vec3(0.05, 0.04, 0.18); mid = vec3(0.34, 0.15, 0.62); mid2 = vec3(0.12, 0.22, 0.60); hot = vec3(0.92, 0.72, 1.00); }
  else if (hs < 0.50) { deep = vec3(0.02, 0.07, 0.16); mid = vec3(0.07, 0.36, 0.56); mid2 = vec3(0.10, 0.48, 0.46); hot = vec3(0.72, 0.96, 1.00); }
  else if (hs < 0.75) { deep = vec3(0.07, 0.03, 0.14); mid = vec3(0.56, 0.14, 0.42); mid2 = vec3(0.24, 0.16, 0.62); hot = vec3(1.00, 0.74, 0.86); }
  else                { deep = vec3(0.03, 0.05, 0.17); mid = vec3(0.12, 0.22, 0.60); mid2 = vec3(0.30, 0.18, 0.58); hot = vec3(1.00, 0.88, 0.66); }
  float hueMix = smoothstep(-0.4, 0.5, fbm(np * 0.5 + 21.0, tm + 7.0, 3));
  mid = mix(mid, mid2, hueMix);
  vec3 col = vec3(0.0012, 0.0016, 0.004);
  // galactic glow: a soft band across the frame (angle by seed) that keeps every frame from going empty
  float ga = (u_seed.w - 0.5) * 1.6;
  float gd = dot(p - fc * 0.4, vec2(-sin(ga), cos(ga)));
  float gal = exp(-gd * gd / 0.05) * smoothstep(0.3, 0.8, soft(np * 1.6 + 5.0, tm));
  col += mix(deep * 1.5, vec3(0.16, 0.15, 0.20), 0.3) * gal * 0.22;
  col += deep * smoothstep(0.40, 0.82, base) * 0.80;
  col += mid * dens * dens * 2.3;
  col += mid * wisp * 0.75;
  float ff = pow(1.0 - abs(fbm(q * 7.0 + 8.0, t * 0.5 + 4.0, 3)), 8.0);    // fine bright filaments
  col += mix(mid, hot, 0.3) * ff * dens * 0.45;
  col += hot * core * 0.85 + hot * focal * dens * 0.35;
  float fdust = smoothstep(0.05, 0.55, fbm(q * 9.0 + 3.1, t * 0.5 + 2.0, 3)); // fine dark globules and lanes
  col *= 1.0 - 0.65 * fdust * smoothstep(0.2, 0.8, dens);
  // dark dust lanes cutting across the bright parts
  float dust = smoothstep(0.55, 0.80, soft(np * 1.7 + w * 0.6 + 9.0, t * 0.7 + 3.0));
  col *= 1.0 - 0.6 * dust * smoothstep(0.35, 0.7, base);
  // stars: far, mid, near (near pans 2 periods per loop)
  vec3 st = starLayer(p, 0.009, 0.0, 0.10 + 0.22 * gal, 0.55, 0.40, 1.0)   // far: fixed
          + starLayer(p, 0.024, 1.0, 0.18, 0.75, 0.75, 2.0)                 // mid and near: one period per loop
          + starLayer(p, 0.075, 1.0, 0.12, 0.95, 1.10, 3.0)
          + heroStars(p);
  col += st * (1.0 - 0.6 * dust);
  col = col / (1.0 + col * 0.45);
  vec2 uv = gl_FragCoord.xy / u_res - 0.5;
  col *= 1.0 - 0.75 * dot(uv, uv);
  o = vec4(finish(col, 0.018), 1.0);
}
`;

export const meta = {
  id: 'cosmos-drift',
  title: 'Cosmos Drift',
  family: 'generative',
  formats: ['16:9'],
  pillars: ['cosmos', 'mysteries', 'futures'],
  mood: ['sleep', 'awe', 'calm'],
  loopSeconds: 600,
  params: {},
  images: 0,
};
