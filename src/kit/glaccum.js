// GPU motion-blur accumulator (WebGL2). Sub-samples drawn on a GPU-backed 2D
// canvas are uploaded as textures (GPU→GPU), summed in a float framebuffer and
// read back ONCE per output frame — instead of one CPU readback + JS sum per
// sub-sample. Opaque renders only (transparent keeps the exact CPU path).
const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
const FS_ADD = `#version 300 es
precision highp float; in vec2 uv; uniform sampler2D src; uniform float w; out vec4 o;
void main(){ o = texture(src, vec2(uv.x, 1.0 - uv.y)) * w; }`;
// average → bytes, rounded to nearest; y flipped so readPixels is top-down
const FS_OUT = `#version 300 es
precision highp float; in vec2 uv; uniform sampler2D acc; out vec4 o;
void main(){ vec4 c = texture(acc, vec2(uv.x, 1.0 - uv.y)); o = floor(c * 255.0 + 0.5) / 255.0; }`;

export function createAccumulator(w, h) {
  if (typeof OffscreenCanvas === 'undefined') return null;
  const c = new OffscreenCanvas(w, h);
  const gl = c.getContext('webgl2', { premultipliedAlpha: false, antialias: false, preserveDrawingBuffer: true });
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) return null;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = (fs) => { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); return p; };
  const pAdd = prog(FS_ADD), pOut = prog(FS_OUT);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  for (const p of [pAdd, pOut]) { const loc = gl.getAttribLocation(p, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0); }
  const tex = (internal, format, type) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
  const srcTex = tex(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
  const accTex = tex(gl.RGBA32F, gl.RGBA, gl.FLOAT);
  const outTex = tex(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
  const fbAcc = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbAcc); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, accTex, 0);
  const fbOut = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbOut); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outTex, 0);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.viewport(0, 0, w, h);
  const bytes = new Uint8Array(w * h * 4);
  return {
    begin() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbAcc);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },
    add(canvas, weight) {
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbAcc);
      gl.useProgram(pAdd);
      gl.uniform1i(gl.getUniformLocation(pAdd, 'src'), 0);
      gl.uniform1f(gl.getUniformLocation(pAdd, 'w'), weight);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.BLEND);
    },
    /** Resolve the average and return RGBA bytes (top-down). */
    finish() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbOut);
      gl.useProgram(pOut);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, accTex);
      gl.uniform1i(gl.getUniformLocation(pOut, 'acc'), 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      return bytes;
    },
  };
}
