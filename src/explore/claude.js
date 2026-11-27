// Claude through the subscription CLI (`claude -p`), no API key, no tools: the model only reads text and answers JSON.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

export function claudeBin() {
  const c = [process.env.CLAUDE_BIN, '/opt/homebrew/bin/claude', '/usr/local/bin/claude', '/usr/bin/claude'].filter(Boolean);
  return c.find((f) => fs.existsSync(f)) || 'claude';
}

/** First balanced {...} object in a chatty reply (ignores prose / code fences around it, respects strings). */
export function extractJson(s) {
  for (let a = s.indexOf('{'); a >= 0; a = s.indexOf('{', a + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let i = a; i < s.length; i++) {
      const c = s[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) { try { return JSON.parse(s.slice(a, i + 1)); } catch { break; } }
    }
  }
  throw new Error(`no JSON object in reply: ${s.slice(0, 300)}`);
}

const sleep = (ms) => { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

/** → {text, json, ms, attempts}. Retries because the CLI can be mid-update or rate-limited for a moment. */
export function askClaude(prompt, { model = process.env.KINETYPE_EXPLORE_MODEL || 'claude-sonnet-5-5', timeoutMs = 240000, retries = 3 } = {}) {
  const t0 = Date.now();
  let r, attempts = 0;
  const wait = Number(process.env.KINETYPE_EXPLORE_RETRY_WAIT_MS ?? 8000);
  for (attempts = 1; attempts <= retries; attempts++) {
    r = spawnSync(claudeBin(), ['-p', '--model', model, '--tools', ''], { input: prompt, cwd: os.tmpdir(), encoding: 'utf8', timeout: timeoutMs, maxBuffer: 1 << 24 });
    if (r.status === 0 && r.stdout.trim()) {
      try { return { text: r.stdout, json: extractJson(r.stdout), ms: Date.now() - t0, attempts }; }
      catch (e) { if (attempts === retries) throw Object.assign(e, { rawReply: r.stdout }); }
    }
    if (attempts < retries) sleep(wait * attempts);
  }
  throw new Error(`claude -p failed (status ${r.status}): ${(r.stderr || r.error?.message || r.stdout || '').slice(0, 400)}`);
}
