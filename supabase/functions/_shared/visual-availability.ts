// Server-side mirror of src/lib/visualAvailability.ts. Visual generation is
// a per-install switch: the edge-function secret VISUALS_ENABLED=true turns
// it on (see visualsEnabled in visual-enqueue.ts). Unset = OFF, and the
// functions answer this honest 503 before any write. Generation runs on the
// subscription queue only - there is no paid route to fall back to.
export const VISUALS_UNAVAILABLE_BODY = {
  error:
    "Visual generation is turned off for this install. No visual was created and no paid call was made.",
  code: "VISUALS_UNAVAILABLE",
} as const;
