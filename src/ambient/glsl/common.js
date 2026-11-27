// Shared GLSL for ambient presets. Loop-closed time: every time input is a point on a circle
// driven by u_phase in [0,1) with INTEGER harmonics, so the picture at phase 1 equals phase 0.
export const COMMON = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_phase;   // (frame mod N) / N
uniform float u_frame;   // frame mod N
uniform float u_loop;    // loop length in seconds
uniform float u_qa;      // 1 = QA render: no per-frame grain or dither (motion-only seam measurements)
uniform vec4 u_seed;     // 4 uniform randoms from the seed
uniform vec4 u_p0, u_p1, u_p2, u_p3, u_p4, u_p5; // preset params
uniform vec4 u_stats;   // still: linear luma black point, white point
uniform vec3 u_avg;     // still: mean linear colour
uniform sampler2D u_tex0, u_tex1;
uniform vec2 u_texres;
out vec4 o;
const float TAU = 6.28318530718;

// 4D simplex noise: Ian McEwan, Stefan Gustavson (Ashima Arts), MIT licence.
vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
float mod289(float x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+10.0)*x); }
float permute(float x){ return mod289(((x*34.0)+10.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float taylorInvSqrt(float r){ return 1.79284291400159 - 0.85373472095314 * r; }
vec4 grad4(float j, vec4 ip){
  const vec4 ones = vec4(1.0, 1.0, 1.0, -1.0);
  vec4 p, s;
  p.xyz = floor(fract(vec3(j) * ip.xyz) * 7.0) * ip.z - 1.0;
  p.w = 1.5 - dot(abs(p.xyz), ones.xyz);
  s = vec4(lessThan(p, vec4(0.0)));
  p.xyz = p.xyz + (s.xyz*2.0 - 1.0) * s.www;
  return p;
}
float snoise(vec4 v){
  const vec4 C = vec4(0.138196601125011, 0.276393202250021, 0.414589803375032, -0.447213595499958);
  vec4 i = floor(v + dot(v, vec4(0.309016994374947451)));
  vec4 x0 = v - i + dot(i, C.xxxx);
  vec4 i0;
  vec3 isX = step(x0.yzw, x0.xxx);
  vec3 isYZ = step(x0.zww, x0.yyz);
  i0.x = isX.x + isX.y + isX.z;
  i0.yzw = 1.0 - isX;
  i0.y += isYZ.x + isYZ.y;
  i0.zw += 1.0 - isYZ.xy;
  i0.z += isYZ.z;
  i0.w += 1.0 - isYZ.z;
  vec4 i3 = clamp(i0, 0.0, 1.0);
  vec4 i2 = clamp(i0 - 1.0, 0.0, 1.0);
  vec4 i1 = clamp(i0 - 2.0, 0.0, 1.0);
  vec4 x1 = x0 - i1 + C.xxxx;
  vec4 x2 = x0 - i2 + C.yyyy;
  vec4 x3 = x0 - i3 + C.zzzz;
  vec4 x4 = x0 + C.wwww;
  i = mod289(i);
  float j0 = permute(permute(permute(permute(i.w) + i.z) + i.y) + i.x);
  vec4 j1 = permute(permute(permute(permute(
        i.w + vec4(i1.w, i2.w, i3.w, 1.0))
      + i.z + vec4(i1.z, i2.z, i3.z, 1.0))
      + i.y + vec4(i1.y, i2.y, i3.y, 1.0))
      + i.x + vec4(i1.x, i2.x, i3.x, 1.0));
  vec4 ip = vec4(1.0/294.0, 1.0/49.0, 1.0/7.0, 0.0);
  vec4 p0 = grad4(j0, ip);
  vec4 p1 = grad4(j1.x, ip);
  vec4 p2 = grad4(j1.y, ip);
  vec4 p3 = grad4(j1.z, ip);
  vec4 p4 = grad4(j1.w, ip);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  p4 *= taylorInvSqrt(dot(p4,p4));
  vec3 m0 = max(0.6 - vec3(dot(x0,x0), dot(x1,x1), dot(x2,x2)), 0.0);
  vec2 m1 = max(0.6 - vec2(dot(x3,x3), dot(x4,x4)), 0.0);
  m0 = m0 * m0; m1 = m1 * m1;
  return 49.0 * (dot(m0*m0, vec3(dot(p0, x0), dot(p1, x1), dot(p2, x2)))
               + dot(m1*m1, vec2(dot(p3, x3), dot(p4, x4))));
}

// A point on a circle of radius r, k full turns per loop (k integer => loop-closed).
vec2 loopc(float r, float k){ float a = TAU * fract(u_phase * k); return r * vec2(cos(a), sin(a)); }
// Loop-closed oscillator in [-1,1], k integer cycles per loop.
float osc(float k, float ph){ return sin(TAU * (fract(u_phase * k) + ph)); }

// fbm over 2D space with a 2D loop-closed time coordinate.
float fbm(vec2 p, vec2 t, int oct){
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 7; i++){
    if (i >= oct) break;
    s += a * snoise(vec4(p, t + float(i) * 17.31));
    n += a; p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= 0.5;
  }
  return s / n;
}

float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }

// Output: linear colour -> sRGB, plus film grain and triangular interleaved-gradient dither (anti-banding).
float ign(vec2 px, float f){ px += 5.588238 * mod(f, 64.0); return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715)))); }
vec3 finish(vec3 lin, float grain){
  vec3 c = pow(max(lin, 0.0), vec3(1.0/2.2));
  if (u_qa > 0.5) return c;
  vec2 px = gl_FragCoord.xy;
  float g = hash12(px + mod(u_frame, 97.0) * 13.7) - 0.5;
  c += grain * g * (0.35 + 0.65 * (1.0 - c));
  float d = ign(px, u_frame) + ign(px + 71.3, u_frame + 31.0) - 1.0;
  return c + d / 255.0;
}
`;
