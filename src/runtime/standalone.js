// Single-file HTML runtime. The exporter generates an entry that imports the
// spec's template(s) and calls start(); spec + fonts (+ audio) are injected globals.
import { createEngine } from '../kit/engine.js';
import { mountPlayer } from './player.js';

export function start(template, templates = {}) {
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;
  const spec = window.__KT_SPEC__;
  const fontBuffers = Object.fromEntries(Object.entries(window.__KT_FONTS__).map(([k, v]) => [k, b64(v)]));
  const canvas = document.createElement('canvas');
  const engine = createEngine({ canvas, spec, template, templates, fontBuffers, readback: false });
  let audio = null;
  if (window.__KT_AUDIO__) {
    audio = new Audio(window.__KT_AUDIO__);
    audio.loop = engine.loop;
  }
  const player = mountPlayer(engine, { audio, title: `${template.id} · ${engine.W}×${engine.H} · ${engine.fps}fps` });
  // Public, deterministic surface: any frame on demand.
  window.seek = (t) => { player.pause(); player.seek(t); };
  window.kinetype = { engine, player, info: () => engine.info() };
  window.__hf = { duration: engine.duration, seek: (t) => engine.seek(t) }; // HyperFrames-compatible
}
