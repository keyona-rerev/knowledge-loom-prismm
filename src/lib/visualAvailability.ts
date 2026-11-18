// Single source of truth for visual-generation availability in the app.
// Visual generation is a per-install switch: set the build variable
// VITE_VISUALS_ENABLED=true (and the edge-function secret VISUALS_ENABLED=true)
// to turn it on. Unset = OFF, so an install that has not opted in keeps its
// current behavior. Generation runs on the Claude subscription queue only -
// no AI API key is used anywhere. UI surfaces check this flag BEFORE offering
// or attempting generation; the edge functions enforce the same switch.
export const VISUAL_GENERATION_AVAILABLE =
  String(import.meta.env.VITE_VISUALS_ENABLED ?? "").trim().toLowerCase() === "true";

export const VISUAL_UNAVAILABLE_NOTE =
  "Visual generation is turned off for this install. Your existing visuals and saved settings are unchanged.";
