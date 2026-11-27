// Looks behind him (plan key personClean): whether it was REALLY applied to a window, decided in one place.
// kinetype-capability: personClean/2  (the app's bridge probes this marker in the checkout it renders with; bump it when the contract changes)
export const PERSON_CLEAN_APPLIED = 'personClean: applied';
export const PERSON_CLEAN_SKIPPED = 'personClean: not applied -';
export const READABLE_NOTE = 'readable:';
const SAFE_LOOKS = ['cover', 'poster', 'marker'];

/** {asked, applied, safe, why}. A look that already leaves him alone is `safe` (nothing to apply, not a fallback); any other
 * refusal carries the reason, which compose receipts as "fell back". */
export function personCleanVerdict({ raw, clip, lookId, stage, split, zones, hasMatte }) {
  if (!raw || raw.personClean !== true) return { asked: false, applied: false, safe: false };
  if (SAFE_LOOKS.includes(lookId)) return { asked: true, applied: false, safe: true, why: 'safe look' };
  const why = !clip ? 'no footage' : stage ? 'stage layout' : split ? 'split layout' : zones ? 'zoned (letterboxed) layout' : !hasMatte ? 'no person matte' : null;
  return why ? { asked: true, applied: false, safe: false, why } : { asked: true, applied: true, safe: false };
}

/** The verdict a finished window render recorded (render receipt qa.layout.notes): {applied, why} or null when it never asked. */
export function cleanVerdictOfRender(rc) {
  const v = cleanVerdictOfNotes(rc);
  // frames drawn with no person matte (the plain footage, no look effect on them), counted by the template while rendering
  const readable = v?.applied && (rc?.qa?.layout?.notes || []).some((n) => String(n).startsWith(READABLE_NOTE)); // the window was drawn with the readable kit
  if (v?.applied && Number.isFinite(rc?.clean?.frames)) return { ...v, ...(readable ? { readable: true } : {}), frames: rc.clean.frames, matteMissFrames: rc.clean.matteMissFrames ?? 0 };
  return readable ? { ...v, readable: true } : v;
}

function cleanVerdictOfNotes(rc) {
  const notes = rc?.qa?.layout?.notes || [];
  for (const n of notes) {
    const i = String(n).indexOf(PERSON_CLEAN_APPLIED);
    if (i >= 0) return { applied: true };
    const j = String(n).indexOf(PERSON_CLEAN_SKIPPED);
    if (j >= 0) return { applied: false, why: String(n).slice(j + PERSON_CLEAN_SKIPPED.length).trim() };
  }
  return null;
}

/** Counts, per rendered frame, whether the person matte was missing in any sample drawn for it. Samples drawn outside beginFrame / endFrame
 * (the engine's priming draws, stills, seeks) count for nothing. stats() lists frame indexes so counts from several workers can be unioned. */
export function createMatteCounter(matte) {
  let cur = null;
  const seen = new Set(), miss = new Set();
  return {
    matteAt: (t) => { const m = matte(t); if (!m && cur !== null) miss.add(cur); return m; },
    beginFrame: (i) => { cur = i; seen.add(i); },
    endFrame: () => { cur = null; },
    stats: () => ({ cleanFrames: [...seen], cleanMatteMiss: [...miss] }),
  };
}
