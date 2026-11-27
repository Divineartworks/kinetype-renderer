// Audio analysis via a local Python (librosa, optional beat_this).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './server.js';

export function python() {
  const cands = [process.env.KINETYPE_PYTHON, 'python3.11', 'python3'].filter(Boolean);
  for (const c of cands) {
    try {
      execFileSync(c, ['-c', 'import librosa'], { stdio: 'ignore', cwd: ROOT });
      return c;
    } catch {}
  }
  throw new Error('no Python with librosa found (pip install librosa; optionally beat_this); set KINETYPE_PYTHON');
}

export async function analyzeAudio(file, { out, clicks = false } = {}) {
  if (!file || !fs.existsSync(file)) throw new Error(`audio file not found: ${file}`);
  const abs = path.resolve(file);
  const dest = path.resolve(out || abs.replace(/\.[^.]+$/, '') + '.analysis.json');
  // cwd outside ~/Documents: macOS TCC makes imports fail there under some launchers
  const clickFile = clicks ? abs.replace(/\.[^.]+$/, '') + '.clicks.wav' : '';
  execFileSync(python(), [path.join(ROOT, 'scripts/audio_analyze.py'), abs, dest, clickFile], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const r = JSON.parse(fs.readFileSync(dest, 'utf8'));
  return { ...r, file: dest, ...(clicks ? { clicks: clickFile } : {}) };
}
