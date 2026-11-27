// Ambient loop page (driven by src/ambient/render.js). Every frame is a pure function of (preset, seed, frame index, frame count):
// phase = (i mod N) / N, so frame N is frame 0 exactly and the loop seam is closed by construction.
import { COMMON } from './glsl/common.js';

const canvas = document.getElementById('c');
let gl, prog, uni = {}, texs = [], W, H, N;

function compile(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n'));
  return s;
}
// seed -> 4 floats in [0,1) (mulberry32)
function seedVec(seed) {
  let a = seed >>> 0; const out = [];
  for (let k = 0; k < 4; k++) { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); out.push(((t ^ (t >>> 14)) >>> 0) / 4294967296); }
  return out;
}
// still statistics for the auto grade: linear luma 0.5th / 99.7th percentiles and the mean linear colour
function imageStats(im) {
  const W = 256, H = Math.max(1, Math.round(256 * im.naturalHeight / im.naturalWidth));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0, W, H);
  const d = x.getImageData(0, 0, W, H).data, L = [], avg = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) {
    const r = (d[i] / 255) ** 2.2, g = (d[i + 1] / 255) ** 2.2, b = (d[i + 2] / 255) ** 2.2;
    avg[0] += r; avg[1] += g; avg[2] += b; L.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
  }
  L.sort((a, b) => a - b); const n = L.length;
  return { stats: [L[Math.floor(n * 0.005)], L[Math.floor(n * 0.997)], 0, 0], avg: avg.map((v) => v / n) };
}
function loadImage(url) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; }); }

window.setup = async ({ preset, seed, w, h, frames, images = [], params = {}, qa = false, frag }) => {
  W = w; H = h; N = frames;
  canvas.width = w; canvas.height = h;
  gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: false, alpha: false });
  if (!gl) throw new Error('no webgl2');
  const mod = frag ? { FRAG: frag } : await import(`./presets/${preset}.js`);   // `frag`: test-only override of the preset source
  const vs = `#version 300 es\nin vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`;
  prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, COMMON + '\n' + mod.FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  for (const n of ['u_res', 'u_phase', 'u_frame', 'u_seed', 'u_loop', 'u_qa', 'u_tex0', 'u_tex1', 'u_texres', 'u_p0', 'u_p1', 'u_p2', 'u_p3', 'u_p4', 'u_p5', 'u_stats', 'u_avg']) uni[n] = gl.getUniformLocation(prog, n);
  gl.uniform2f(uni.u_res, w, h);
  gl.uniform4fv(uni.u_seed, seedVec(seed));
  gl.uniform1f(uni.u_loop, params.loopSeconds || 600);
  gl.uniform1f(uni.u_qa, qa ? 1 : 0);
  gl.uniform4fv(uni.u_p0, params.p0 || [0, 0, 0, 0]);
  gl.uniform4fv(uni.u_p1, params.p1 || [0, 0, 0, 0]);
  gl.uniform4fv(uni.u_p2, params.p2 || [0, 0, 0, 0]);
  gl.uniform4fv(uni.u_p3, params.p3 || [0, 0, 0, 0]);
  gl.uniform4fv(uni.u_p4, params.p4 || [0, 0, 0, 0]);
  gl.uniform4fv(uni.u_p5, params.p5 || [0, 0, 0, 0]);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  for (let k = 0; k < images.length; k++) {
    const im = await loadImage(images[k]);
    const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, im);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(uni['u_tex' + k], k);
    if (k === 0) { gl.uniform2f(uni.u_texres, im.naturalWidth, im.naturalHeight); const st = imageStats(im); gl.uniform4fv(uni.u_stats, st.stats); gl.uniform3fv(uni.u_avg, st.avg); }
    texs.push(t);
  }
  gl.viewport(0, 0, w, h);
  return { renderer: gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) };
};

// unwrap = true feeds u_phase = i / N and u_frame = i WITHOUT the mod: frame N is then rendered at phase 1.0,
// which proves the shader itself is periodic (seam checks only; real renders always wrap).
function draw(i, seedOverride, unwrap = false) {
  if (seedOverride !== undefined) gl.uniform4fv(uni.u_seed, seedVec(seedOverride));
  const fi = unwrap ? i : ((i % N) + N) % N;
  gl.uniform1f(uni.u_phase, fi / N);
  gl.uniform1f(uni.u_frame, fi);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// Render frames [from, to) and POST each RGBA frame (bottom-up rows) to the local sink.
window.run = async ({ from, to, step = 1, sink, seeds, unwrap = false }) => {
  const px = new Uint8Array(W * H * 4);
  const t0 = performance.now();
  const inflight = [];
  const gcEvery = Math.max(2, Math.floor(96e6 / (W * H * 4)));   // ~96 MB of frame Blobs between collections
  let n = 0;
  for (let i = from; i < to; i += step) {
    draw(i, seeds ? seeds[n] : undefined, unwrap);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    // Blob body (Uint8Array bodies are ~25x slower in Chrome), up to 6 frames in flight; the sink reorders by index
    inflight.push(fetch(`${sink}?i=${n}`, { method: 'POST', body: new Blob([px]) }).then((r) => { if (!r.ok) throw new Error('sink ' + r.status); }));
    if (inflight.length >= Math.min(6, gcEvery)) await inflight.shift();
    n++;
    if (n % gcEvery === 0 && window.gc) { await Promise.all(inflight.splice(0)); window.gc(); }   // release finished frame Blobs (renderer blob quota)
  }
  await Promise.all(inflight);
  return { frames: n, ms: performance.now() - t0 };
};

// Pure GPU timing (no readback): ms per frame.
window.bench = (count = 60) => {
  const px = new Uint8Array(4);
  draw(0); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const t0 = performance.now();
  for (let i = 0; i < count; i++) { draw(i * 37); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
  return (performance.now() - t0) / count;
};
window.benchRead = (count = 30) => {
  const px = new Uint8Array(W * H * 4);
  const t0 = performance.now();
  for (let i = 0; i < count; i++) { draw(i * 37); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); }
  const t1 = performance.now();
  return { readMs: (t1 - t0) / count };
};
window.benchPost = async (count = 30, sink) => {
  const px = new Uint8Array(W * H * 4);
  const t0 = performance.now();
  for (let i = 0; i < count; i++) { const r = await fetch(sink, { method: 'POST', body: new Blob([px]) }); await r.text(); }
  const t1 = performance.now();
  const inflight = [];
  for (let i = 0; i < count; i++) { inflight.push(fetch(sink, { method: 'POST', body: new Blob([px]) })); if (inflight.length >= 6) await inflight.shift(); }
  await Promise.all(inflight);
  return { postBlobMs: (t1 - t0) / count, postPipelinedMs: (performance.now() - t1) / count };
};
window.ready = true;
