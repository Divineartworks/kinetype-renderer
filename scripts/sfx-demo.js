#!/usr/bin/env node
// Audition WAV of every sound (1 s spacing) + stats table.  node scripts/sfx-demo.js out.wav
import { writeFileSync } from 'node:fs';
import { SOUNDS, SR } from '../src/audio/sfx/synth.js';
import { analyze } from '../src/audio/sfx/analyze.js';

const out = process.argv[2] || 'out/sfx-demo.wav';
const items = [];
for (const [name, d] of Object.entries(SOUNDS)) {
  if (name === 'key') for (const ch of ['a', 'k', ' ', '\b', '\n']) items.push([`key(${JSON.stringify(ch)})`, d.gen(11, { ch }), d.gain]);
  else if (name === 'swipe') for (const dur of [0.2, 0.5]) items.push([`swipe(${dur})`, d.gen(11, { dur }), d.gain]);
  else items.push([name, d.gen(11), d.gain]);
}
const buf = new Float32Array(Math.round((items.length * 1 + 0.5) * SR));
console.log('sound'.padEnd(14), 'dur ms'.padStart(7), 'peak dBFS'.padStart(10), 'centroid Hz'.padStart(12));
items.forEach(([n, x, g], i) => {
  for (let k = 0; k < x.length; k++) buf[Math.round((0.25 + i) * SR) + k] += x[k] * g;
  const s = analyze(x);
  console.log(n.padEnd(14), (s.dur * 1000).toFixed(0).padStart(7), s.peakDb.toFixed(1).padStart(10), s.centroid.toFixed(0).padStart(12));
});
const b = Buffer.alloc(44 + buf.length * 2);
b.write('RIFF', 0); b.writeUInt32LE(36 + buf.length * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
b.write('data', 36); b.writeUInt32LE(buf.length * 2, 40);
for (let i = 0; i < buf.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i])) * 32767), 44 + i * 2);
writeFileSync(out, b);
console.log('wrote', out);
