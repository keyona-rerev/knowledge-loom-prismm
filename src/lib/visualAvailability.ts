// Single source of truth for visual-generation availability (503-honesty debt,
// 2026-10-29). Visual generation is OFF while the subscription migration is
// unfinished: the renderer is not configured and ai-caller is unconditionally
// fail-closed, so every generation attempt can only fail. UI surfaces must
// check this flag BEFORE offering or attempting generation, and the edge
// functions enforce the same truth server-side. Existing visual assets,
// scheduled posts, and saved configs are untouched - this gates ATTEMPTS only.
// Flip to true only as part of an authorized visuals re-enable (separate
// decision, renderer cost included).
export const VISUAL_GENERATION_AVAILABLE = false;

export const VISUAL_UNAVAILABLE_NOTE =
  "Visual generation is temporarily unavailable during the subscription migration. Your existing visuals and saved settings are unchanged.";
