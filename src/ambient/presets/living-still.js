// living-still: ONE generated still brought to life. Depth parallax on a closed camera path, a slow
// breathing zoom, drifting mist in the far depth band, soft light rays and floating motes.
// u_tex0 = still, u_tex1 = depth (bright = near). u_p0 = (camAmp, focus, mist, motes), u_p1 = (lightX, lightY, rays, warmth)
// u_p2 = (horizonY, mistHeight, ripple, -) in screen uv (y up); u_p3 = (targetAPL, contrast, twinkle, -)
// u_p4 = grade (neutralize 0-1, split-tone 0-1, clarity 0-1, cool..warm -1..1); all 0 = untouched colour
// u_p5 = breath light (strength, x, y, radius); 0 = off / defaults (x,y 0.5, radius 0.06)
export const FRAG = `
vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }
void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  float ia = u_texres.x / u_texres.y, sa = u_res.x / u_res.y;
  vec2 st = uv - 0.5;
  if (ia > sa) st.x *= sa / ia; else st.y *= ia / sa;
  float camAmp = u_p0.x > 0.0 ? u_p0.x : 0.006;               // cinemagraph: the camera barely moves
  float focus = u_p0.y > 0.0 ? u_p0.y : 0.30;
  float zoom = 1.07 + 0.015 * (0.5 + 0.5 * osc(1.0, 0.75));       // one slow push-in and back per loop
  st /= zoom;
  vec2 cam = camAmp * vec2(osc(3.0, 0.0), 0.55 * osc(4.0, 0.125));   // closed 3:4 Lissajous path, ~2-3 px/s
  vec2 s = st + 0.5, off = vec2(0.0);
  float d = 0.0;
  // blurred depth gives a smooth displacement field (stretch, never tear); damp it across depth edges
  vec2 e = 4.0 / u_texres;
  for (int i = 0; i < 5; i++){
    vec2 sp = s + off;
    d = textureLod(u_tex1, sp, 3.0).r;
    float g = abs(textureLod(u_tex1, sp + vec2(e.x, 0.0), 3.0).r - textureLod(u_tex1, sp - vec2(e.x, 0.0), 3.0).r)
            + abs(textureLod(u_tex1, sp + vec2(0.0, e.y), 3.0).r - textureLod(u_tex1, sp - vec2(0.0, e.y), 3.0).r);
    off = cam * (d - focus) * 2.0 / (1.0 + 12.0 * g);
  }
  vec2 su = s + off;
  vec2 t = loopc(0.9, 1.0) + loopc(0.2, 3.0) + u_seed.zw * 20.0;
  float hy = u_p2.x > 0.0 ? u_p2.x : 0.45;
  // water shimmer below the horizon: tiny horizontal displacement, stronger near the viewer
  // water mask: open water and reflections only. Solid objects (a boat, a rock, a shore) stand out NEARER than
  // their blurred surroundings in the depth map; they and a ~8 px dilation around them stay rigid.
  float solid = 0.0;
  if (u_p2.z > 0.0 && su.y < hy){
    vec2 dpx8 = 8.0 / u_texres;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){
      vec2 sp = su + vec2(float(i), float(j)) * dpx8;
      solid = max(solid, smoothstep(0.012, 0.035, textureLod(u_tex1, sp, 1.0).r - textureLod(u_tex1, sp, 5.0).r));
    }
  }
  if (u_p2.z > 0.0 && su.y < hy && solid < 0.999){
    float dy = hy - su.y, k = dy / hy;
    float shore = smoothstep(0.0, 0.035, dy);                         // the shoreline itself stays calm
    vec2 tw2 = loopc(0.25, 60.0);                                    // water moves every few seconds (10 s cycle)
    // two octaves of horizontally stretched noise at unrelated scales: no regular "wave filter" pattern
    float yy = dy / (0.3 + k);                                       // perspective: ripples compress toward the horizon
    float r = 0.65 * snoise(vec4(su.x * 3.0, yy * 38.0, t * 1.1 + tw2))
            + 0.35 * snoise(vec4(su.x * 7.5 + 3.1, yy * 95.0, t * 1.7 - tw2 + 5.0));
    float amp = u_p2.z * shore * (1.0 - solid);
    su.x += r * amp * 0.0028 * (0.3 + k);
    su.y += r * amp * 0.0004 * k;
  }
  // light denoise: smooth low-amplitude grain (night skies), keep strong small details such as stars
  vec3 sharp = lin(texture(u_tex0, su).rgb), smooth1 = lin(textureLod(u_tex0, su, 1.4).rgb);
  vec3 det = sharp - smooth1;
  float keep = smoothstep(0.002, 0.012, abs(dot(det, vec3(0.2126, 0.7152, 0.0722))));
  vec3 col = smooth1 + det * keep;
  // star twinkle: only small bright details (high-pass), each cell on its own slow rhythm
  if (u_p3.z > 0.0){
    vec3 hp = max(col - lin(textureLod(u_tex0, su, 2.5).rgb), 0.0);
    vec2 cell = floor(su * u_texres / 5.0);
    float h = hash12(cell + u_seed.xy * 31.0);
    float tw = osc(20.0 + floor(h * 40.0), h) * step(0.93, h);    // only ~1 in 14 stars twinkle, 10-30 s cycles
    // stars only: a strong isolated point on a dark surround. Sensor grain (weak) and galaxy cores (bright
    // surround) never twinkle.
    float bgL = dot(lin(textureLod(u_tex0, su, 3.5).rgb), vec3(0.2126, 0.7152, 0.0722));
    float strong = smoothstep(0.03, 0.10, dot(hp, vec3(0.2126, 0.7152, 0.0722))) * smoothstep(0.05, 0.015, bgL);
    col += hp * u_p3.z * tw * strong * smoothstep(hy, hy + 0.05, su.y);
  }

  // mist: drifts through the far band (low depth), tinted by the picture's own average colour
  float mistAmt = u_p0.z > 0.0 ? u_p0.z : 0.35;
  vec3 avg = lin(textureLod(u_tex0, vec2(0.5, 0.55), 9.0).rgb);
  vec3 mistCol = mix(avg, vec3(dot(avg, vec3(0.33))), 0.3) * 1.25;
  // the mist lives at far depth: it takes ONE rigid parallax offset (no seam where near objects shift), and it
  // fades softly in front of anything nearer than the horizon
  vec2 sm = s + cam * (0.1 - focus) * 2.0;
  float m = fbm(vec2(sm.x * 2.2, sm.y * 5.0) + loopc(0.35, 3.0) + loopc(0.06, 12.0), t * 0.7, 5) * 0.5 + 0.5;
  float mh = u_p2.y > 0.0 ? u_p2.y : 0.08;
  float bh = hy + mh * 0.4 + mh * 0.7 * snoise(vec4(sm.x * 1.6, 3.0, t * 0.3));   // the bank rises and dips along x
  float band = exp(-pow((sm.y - bh) / mh, 2.0));
  float dH = textureLod(u_tex1, vec2(0.5, hy), 6.0).r;
  float hide = smoothstep(dH + 0.08, dH + 0.28, textureLod(u_tex1, sm, 4.5).r);
  col = mix(col, mistCol, clamp(mistAmt * band * smoothstep(0.42, 0.88, m) * (1.0 - hide), 0.0, 0.6));

  // drifting light: a very soft low-frequency field of light and shade that moves across the scene
  float life = u_p1.z < 0.0 ? 0.0 : 1.0;
  float dl = fbm(vec2(su.x * 1.3, su.y * 2.0) + loopc(0.25, 6.0), t * 0.4 + 11.0, 3);
  col *= 1.0 + 0.06 * life * dl;
  // light rays from the brightest point (u_p1.xy), gently breathing
  float rays = max(u_p1.z, 0.0);
  if (rays > 0.0){
    vec2 L = u_p1.xy, dir = (L - uv);
    float acc = 0.0;
    for (int k = 0; k < 28; k++){
      vec2 sp = uv + dir * (float(k) / 28.0) * 0.85;
      vec3 c = texture(u_tex0, sp + off).rgb;
      acc += smoothstep(0.62, 0.95, dot(c, vec3(0.3, 0.55, 0.15)));
    }
    acc /= 28.0;
    float ang = atan(dir.y, dir.x);
    float flick = 0.75 + 0.25 * snoise(vec4(ang * 6.0, 0.0, t * 0.6));
    vec3 warm = mix(vec3(1.0, 0.9, 0.75), vec3(1.0, 0.75, 0.5), u_p1.w);
    col += warm * acc * rays * flick * (0.85 + 0.15 * osc(2.0, 0.3));
  }

  // motes: stateless, rise an integer number of times per loop, fade at the edges
  float motes = u_p0.w > 0.0 ? u_p0.w : 1.0;
  vec3 warmM = mix(vec3(1.0, 0.96, 0.9), vec3(1.0, 0.9, 0.78), u_p1.w);   // pale, never LED-yellow
  for (int i = 0; i < 36; i++){
    float fi = float(i);
    vec2 h = hash22(vec2(fi, 11.0) + u_seed.xy * 30.0);
    float rise = h.y < 0.6 ? 1.0 : 2.0;
    float y = fract(h.y + u_phase * rise);
    float x = h.x + 0.02 * osc(3.0 + floor(h.x * 3.0), h.y);
    vec2 mp = vec2(x, y);
    float size = (1.5 + 4.0 * hash12(vec2(fi, 5.0))) * u_res.y / 1080.0;
    float dpx = length((uv - mp) * u_res);
    float edge = smoothstep(0.0, 0.12, y) * smoothstep(1.0, 0.85, y);
    float tw = 0.6 + 0.4 * osc(5.0 + floor(h.x * 4.0), h.y);
    col += warmM * motes * 0.035 * edge * tw * exp(-dpx * dpx / (size * size));
  }
  // auto grade from the still's own statistics (u_stats, u_avg): levels, gentle cast removal, split tone,
  // vibrance, then exposure toward a night-friendly target average level
  const vec3 LW = vec3(0.2126, 0.7152, 0.0722);
  float neutral = u_p4.x;
  vec3 wb = mix(vec3(1.0), vec3(dot(u_avg, LW)) / max(u_avg, vec3(1e-4)), neutral);
  col *= wb;
  float bk = u_stats.x * 0.9, wt = max(u_stats.y, bk + 0.05);
  col = max(col - bk, 0.0) / (wt - bk);
  // clarity: hazy, low-range stills get local tonal separation (hill layers), punchy ones are left alone
  float clarity = u_p4.z;
  vec3 blurL = max(lin(textureLod(u_tex0, su, 5.0).rgb) * wb - bk, 0.0) / (wt - bk);
  col = max(col + (col - blurL) * clarity, 0.0);
  float l = dot(col, LW);
  float cw = u_p4.w;
  vec3 cool = vec3(0.84, 0.95, 1.16), warm = vec3(1.10, 1.00, 0.84);
  vec3 shadowT = mix(cool, vec3(1.0), max(cw, 0.0)), highT = mix(warm, cool * 0.97 + 0.03, max(-cw, 0.0));
  col *= mix(vec3(1.0), mix(shadowT, highT, smoothstep(0.02, 0.4, l)), u_p4.y);
  float sat = length(col - l) / max(l, 1e-4);
  col = l + (col - l) * (1.0 + 0.25 * (1.0 - smoothstep(0.0, 0.6, sat)));
  if (u_p3.y > 0.0) col = pow(max(col, 0.0), vec3(u_p3.y)) * pow(0.18, 1.0 - u_p3.y);
  float aL = max((dot(u_avg * wb, LW) - bk) / (wt - bk), 1e-4);
  float target = u_p3.x > 0.0 ? u_p3.x : 0.08;
  col *= min(1.0, target / aL);
  if (u_p5.x > 0.0){
    float cycles = floor(u_loop * 6.0 / 60.0 + 0.5);
    float bt = fract(u_phase * cycles);
    float b = bt < 0.4 ? 0.5 - 0.5 * cos(3.14159265 * bt / 0.4) : 0.5 + 0.5 * cos(3.14159265 * (bt - 0.4) / 0.6);
    vec2 bc = vec2(u_p5.y > 0.0 ? u_p5.y : 0.5, u_p5.z > 0.0 ? u_p5.z : 0.5);
    vec2 dv = (uv - bc) * vec2(u_res.x / u_res.y, 1.0);
    float rad = (u_p5.w > 0.0 ? u_p5.w : 0.06) * (0.85 + 0.30 * b);
    float orb = exp(-dot(dv, dv) / (rad * rad)) * 0.6 + exp(-dot(dv, dv) / (9.0 * rad * rad)) * 0.25;
    col += mix(vec3(1.0, 0.86, 0.66), vec3(0.85, 0.92, 1.0), 0.3) * orb * u_p5.x * (0.2 + 0.8 * b) * 0.6;
  }
  vec2 vv = uv - 0.5;
  col *= 1.0 - 0.30 * dot(vv, vv);
  o = vec4(finish(col, 0.012), 1.0);
}
`;

export const meta = {
  id: 'living-still',
  title: 'Living Still',
  family: 'living-still',
  formats: ['16:9'],
  pillars: ['cosmos', 'mind-power', 'teachings', 'lore'],
  mood: ['sleep', 'calm', 'contemplative'],
  loopSeconds: 600,
  // zero means "off" or "shader default" for the params whose default is 0; they are not magic numbers
  params: {
    camAmp:     { default: 0.010, min: 0.002, max: 0.03, uniform: 'u_p0.x', doc: 'parallax camera amplitude (uv units)' },
    focus:      { default: 0.30, min: 0.1, max: 0.6, uniform: 'u_p0.y', doc: 'depth value that stays still under parallax' },
    mist:       { default: 0.35, min: 0, max: 0.6, uniform: 'u_p0.z', doc: 'mist bank strength' },
    motes:      { default: 1.0, min: 0, max: 2, uniform: 'u_p0.w', doc: 'floating motes brightness' },
    lightX:     { default: 0.5, min: 0, max: 1, uniform: 'u_p1.x', doc: 'light ray origin x (screen uv)' },
    lightY:     { default: 0.6, min: 0, max: 1, uniform: 'u_p1.y', doc: 'light ray origin y (screen uv, up)' },
    rays:       { default: 0, min: 0, max: 0.6, uniform: 'u_p1.z', doc: 'light ray strength, 0 = none' },
    warmth:     { default: 0, min: 0, max: 1, uniform: 'u_p1.w', doc: 'warm tint of rays and motes' },
    horizonY:   { default: 0.45, min: 0.1, max: 0.8, uniform: 'u_p2.x', doc: 'horizon height (screen uv, up)' },
    mistHeight: { default: 0.08, min: 0.02, max: 0.2, uniform: 'u_p2.y', doc: 'mist bank thickness' },
    ripple:     { default: 0, min: 0, max: 3, uniform: 'u_p2.z', doc: 'water shimmer below the horizon, 0 = none' },
    targetAPL:  { default: 0, min: 0, max: 0.3, uniform: 'u_p3.x', doc: 'auto-exposure target average picture level (linear), 0 = off' },
    contrast:   { default: 0, min: 0, max: 1.5, uniform: 'u_p3.y', doc: 'contrast exponent around mid grey, 0 = off' },
    twinkle:    { default: 0, min: 0, max: 2, uniform: 'u_p3.z', doc: 'star twinkle on small bright details, 0 = none' },
    neutralize: { default: 0, min: 0, max: 1, uniform: 'u_p4.x', doc: 'pull the colour cast towards neutral, 0 = untouched' },
    split:      { default: 0, min: 0, max: 1, uniform: 'u_p4.y', doc: 'split-tone (cool shadows, warm highlights), 0 = none' },
    clarity:    { default: 0, min: 0, max: 1, uniform: 'u_p4.z', doc: 'local contrast, 0 = none' },
    coolWarm:   { default: 0, min: -1, max: 1, uniform: 'u_p4.w', doc: 'overall colour temperature, -1 cool .. 1 warm, 0 = untouched' },
    breath:     { default: 0, min: 0, max: 1, uniform: 'u_p5.x', doc: 'breathing light orb strength, 0 = none' },
    breathX:    { default: 0, min: 0, max: 1, uniform: 'u_p5.y', doc: 'breath orb centre x (screen uv), 0 = 0.5' },
    breathY:    { default: 0, min: 0, max: 1, uniform: 'u_p5.z', doc: 'breath orb centre y (screen uv, up), 0 = 0.5' },
    breathRadius: { default: 0, min: 0, max: 0.3, uniform: 'u_p5.w', doc: 'breath orb radius (uv), 0 = 0.06' },
  },
  images: 2,
};
