// Flow file (kinetype.flow.v1): schema validation, defaults, hashing, request-origin guard.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FLOW_SCHEMA = JSON.parse(fs.readFileSync(path.join(HERE, 'flow.schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
const check = ajv.compile(FLOW_SCHEMA);

export const DEVICES = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};

/** Human-readable problems ([] when valid). Also catches duplicate step ids and cross-field mistakes. */
export function flowProblems(flow) {
  const out = [];
  if (!check(flow)) {
    for (const e of check.errors) {
      if (e.keyword === 'if') continue;
      out.push(`${e.instancePath || '(root)'} ${e.message}${e.params?.additionalProperty ? ` "${e.params.additionalProperty}"` : ''}`);
    }
    if (!out.length) out.push('flow does not match kinetype.flow.v1');
    return [...new Set(out)];
  }
  const seen = new Set();
  const DEVICE_ONLY = ['tap', 'swipe', 'fling', 'back', 'keyboard', 'sync', 'refresh'];
  for (const [i, s] of flow.steps.entries()) {
    if (seen.has(s.id)) out.push(`/steps/${i}/id duplicate step id "${s.id}"`);
    if (DEVICE_ONLY.includes(s.action) && flow.device.kind !== 'android') out.push(`/steps/${i}/action "${s.action}" needs device.kind "android" (kinetype rehearse/perform)`);
    if (s.target?.os && flow.device.kind !== 'android') out.push(`/steps/${i}/target "os" (native UI) needs device.kind "android"`);
    for (const k of ['target', 'until']) if (s[k]?.testid !== undefined) { if (s[k].testId !== undefined && s[k].testId !== s[k].testid) out.push(`/steps/${i}/${k} testid and testId differ`); }
    seen.add(s.id);
  }
  // a web app is needed unless every target is native UI (an android flow in other apps, e.g. "the old way" in SMS)
  const web = flow.device.kind !== 'android' || (flow.setup || []).length || flow.steps.some((s) => s.action === 'goto' || (s.target && !s.target.os) || (s.until && !s.until.os));
  if (web && !flow.app) out.push('(root) must have required property \'app\' (a flow with web steps needs app.baseUrl)');
  for (const [i, r] of (flow.setup || []).entries()) {
    if (!flow.app) break;
    try { assertSameOrigin(flow.app.baseUrl, r.url); } catch (e) { out.push(`/setup/${i}/url ${e.message}`); }
  }
  const markIds = new Set(flow.steps.filter((s) => s.action === 'mark').map((s) => s.id));
  for (const m of flow.marks || []) if (!markIds.has(m)) out.push(`/marks "${m}" is not a mark step`);
  return out;
}

export function resolveFlow(flow, { baseUrl } = {}) {
  const problems = flowProblems(flow);
  if (problems.length) throw new Error(`invalid flow:\n  ${problems.join('\n  ')}`);
  const dev = DEVICES[flow.device.kind];
  const f = structuredClone(flow);
  f.device = { kind: flow.device.kind, viewport: flow.device.viewport || dev.viewport, deviceScaleFactor: flow.device.deviceScaleFactor || dev.deviceScaleFactor, isMobile: dev.isMobile, hasTouch: dev.hasTouch, locale: flow.device.locale || 'nb-NO', timezone: flow.device.timezone || 'Europe/Oslo', colorScheme: flow.device.colorScheme || 'light' };
  f.fps = flow.fps || 30;
  f.seed = flow.seed ?? 1;
  f.trackTail = flow.trackTail ?? 3;
  if (baseUrl) f.app.baseUrl = baseUrl;
  f.app.baseUrl = f.app.baseUrl.replace(/\/+$/, '');
  f.setup = f.setup || [];
  for (const s of f.steps) s.hold = s.hold ?? (s.action === 'mark' || s.action === 'observe' ? 0 : 0.4);
  return f;
}

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Absolute URL for a step/setup url; request urls may only target the flow's baseUrl. */
export function assertSameOrigin(baseUrl, url) {
  const base = new URL(baseUrl);
  const u = new URL(url, base);
  if (u.origin !== base.origin) throw new Error(`url "${url}" leaves the flow's baseUrl origin (${base.origin})`);
  return u.toString();
}

export function loadFlow(file) {
  const raw = fs.readFileSync(file);
  let flow;
  try { flow = JSON.parse(raw); } catch (e) { throw new Error(`${file}: not valid JSON (${e.message})`); }
  resolveStepFiles(flow, path.dirname(path.resolve(file)));
  return { flow, hash: sha256(raw), raw };
}

/** `files` on a click step (a file-chooser upload) are paths relative to the flow file; made absolute here and
 * required to exist, so a capture never starts with a missing upload. */
export function resolveStepFiles(flow, dir) {
  for (const s of flow?.steps || []) {
    if (!Array.isArray(s.files)) continue;
    s.files = s.files.map((f) => path.resolve(dir, f));
    for (const f of s.files) if (!fs.existsSync(f) || !fs.statSync(f).isFile()) throw new Error(`step ${s.id}: upload file not found: ${f}`);
  }
  return flow;
}
