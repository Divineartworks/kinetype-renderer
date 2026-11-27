// Explore safety: same origin only, never type, never submit/send/delete, secrets never reach the audit log.
// The model never writes selectors or URLs: it picks target ids from the snapshot, and only these action kinds exist.

export const ALLOWED_ACTIONS = ['click', 'hover', 'scroll', 'wait'];   // no type/fill/press/goto: credentials and forms are out of reach by construction

/** Same rule as capture's `request` setup: scheme+host+port must equal the flow's origin. */
export function sameOrigin(baseUrl, url) {
  try { return new URL(url, baseUrl).origin === new URL(baseUrl).origin; } catch { return false; }
}

// Things a demo must never do. Submit buttons and these words are refused even when the name also says demo/owner/admin;
// one-click demo/role buttons (e.g. "Åpne som eier") pass because they are neither inside a form submit nor match these words.
const DANGER = /\b(delete|remove|erase|destroy|cancel (?:subscription|account)|unsubscribe|send|submit|pay|buy|purchase|checkout|order|charge|subscribe|sign ?up|register|log ?out|sign ?out|publish|post|slett|fjern|send inn|betal|kj[øo]p|bestill|abonner|registrer|logg ut|publiser)\b/i;

/** Why an element must not be offered to the model ('' = fine). `el` = {name, tag, type, inForm, submits}. */
export function riskOf(el) {
  const name = el.name || '';
  if (el.submits) return 'submits a form';
  if (DANGER.test(name)) return 'looks destructive/outward-facing';
  if (el.tag === 'a' && el.download) return 'download';
  return '';
}

const SECRET_KV = /((?:api[_-]?key|token|secret|passw(?:or)?d|pwd|auth(?:orization)?|session|cookie|bearer)["']?\s*[:=]\s*["']?)[^\s"'&,;]{4,}/gi;
const LONG_TOKEN = /\b(?:sk|pk|ghp|gho|xox[abp]|eyJ)[A-Za-z0-9._-]{16,}\b|\b[A-Za-z0-9+/_-]{40,}={0,2}\b/g;

/** Scrub anything credential-shaped before text is written to explore.log.json. */
export function redact(text) {
  return String(text)
    .replace(/(https?:\/\/[^\s"'<>]*?[?&](?:[^=&\s"']*(?:token|key|secret|passw|auth|sig)[^=&\s"']*)=)[^&\s"'<>]+/gi, '$1[redacted]')
    .replace(SECRET_KV, '$1[redacted]')
    .replace(LONG_TOKEN, '[redacted-token]');
}
/** Redact every string leaf (never stringify-then-regex: escaped quotes in embedded JSON break both the regexes and the parse). */
export function redactDeep(v) {
  if (typeof v === 'string') return redact(v);
  if (Array.isArray(v)) return v.map(redactDeep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactDeep(x)]));
  return v;
}
/** Network backstop for "never submit": only GET/HEAD, plus POSTs to a demo-entry path, may leave the page. */
export const DEMO_PATH = /demo/i;
export const mayRequest = (method, url) => ['GET', 'HEAD', 'OPTIONS'].includes(method) || DEMO_PATH.test(new URL(url).pathname);
