// Server-side mirror of src/lib/visualAvailability.ts (503-honesty debt,
// 2026-10-29). Visual generation is OFF: renderer unconfigured, ai-caller
// fail-closed. Gate ATTEMPTS only - never touches existing draft_visuals rows,
// assets, or profiles.visual_studio_config. Remove this early return only as
// part of an authorized visuals re-enable.
export const VISUALS_UNAVAILABLE_BODY = {
  error:
    "Visual generation is temporarily unavailable during the subscription migration. No visual was created and no paid call was made.",
  code: "VISUALS_UNAVAILABLE",
} as const;
