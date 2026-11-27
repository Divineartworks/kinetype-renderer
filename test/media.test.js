import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeFilter } from '../src/cli/media.js';

// field report 2026-10-15: the JPEG frame cache read a bt709 video with the wrong matrix and every
// kinetic window came out 7-8 darker on the speaker's face than the base it was cut from.
const base = { fr: null, lut: null, f: 30, native: false, W: 1080, H: 1920 };

test('exact colour decodes with the source matrix and writes real JFIF', () => {
  const vf = decodeFilter({ ...base, exact: true, p: { matrix: 'bt709', full: false } });
  assert.ok(vf.startsWith('scale=in_color_matrix=bt709:in_range=limited,format=rgb24,'));
  assert.ok(vf.endsWith(',scale=out_color_matrix=bt601:out_range=full,format=yuvj420p'));
});

test('a full-range bt601 source is read as such', () => {
  const vf = decodeFilter({ ...base, exact: true, p: { matrix: 'bt601', full: true } });
  assert.ok(vf.startsWith('scale=in_color_matrix=bt601:in_range=full,format=rgb24,'));
});

test('the lut is applied in RGB after the exact decode', () => {
  const vf = decodeFilter({ ...base, exact: true, p: { matrix: 'bt709', full: false }, lut: "/x/it's.cube" });
  assert.ok(vf.indexOf('format=rgb24,') < vf.indexOf('lut3d='));
  assert.ok(vf.includes("lut3d=file='/x/it'\\''s.cube'"));
});

test('KINETYPE_EXACT_COLOUR=0 keeps the old chain', () => {
  const vf = decodeFilter({ ...base, exact: false, p: { matrix: 'bt709', full: false } });
  assert.equal(vf, 'fps=30,scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos');
});

test('a bt2020 source keeps its matrix', () => {
  const vf = decodeFilter({ ...base, exact: true, p: { matrix: 'bt2020', full: false } });
  assert.ok(vf.startsWith('scale=in_color_matrix=bt2020:in_range=limited,format=rgb24,'));
});
