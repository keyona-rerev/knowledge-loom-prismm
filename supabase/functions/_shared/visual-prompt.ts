// Shared prompt-building logic for Visual Studio config -> AI system prompt.
// Used by BOTH generate-draft-visual (the real thing, persisted to
// draft_visuals) and preview-visual (Visual Studio's live "sample post"
// preview, never persisted). Keeping this in one file means the preview a
// user sees while tuning Visual Studio is built from the exact same logic
// that will actually run on their next real draft — no drift between
// "what I previewed" and "what actually generates."

export interface DesignRule { id: string; text: string; tag: "do" | "avoid"; }
export interface VisualConfig {
  color_background: string; color_accent: string; color_highlight: string; color_sparing_accent: string;
  display_font: string; body_font: string;
  logo_url: string; logo_min_height: number;
  canvas_width: number; canvas_height: number;
  design_rules: DesignRule[];
  enabled_visual_types: string[];
}

// The AI's real, actually-implemented visual types. This is the single
// source of truth for what the AI can be told to produce — Visual Studio's
// toggle list (src/pages/VisualStudio.tsx, ALL_VISUAL_TYPES) must match
// these ids exactly. Previously Visual Studio had 8 toggles with a
// completely different vocabulary (stat_graphic, quote_card,
// pillar_statement, human_moment, comparison, timeline, checklist,
// branded_announcement) that had no connection to what the AI could
// actually do — toggling them did nothing. Rather than build out prompt
// support for 8 types (a real design/scope decision on its own) or leave
// fake toggles in place, the UI was cut down to exactly these 4 real ones,
// and enabled_visual_types now genuinely controls what's offered below.
const VISUAL_TYPES: Record<string, { label: string; description: string; selectionHint: string }> = {
  hero_number: {
    label: "hero_number",
    description: "one large stat or number dominates the canvas, 10-word-or-fewer statement below",
    selectionHint: "If the post has a number or stat, use hero_number.",
  },
  before_after: {
    label: "before_after",
    description: "canvas split into two halves showing contrast (old way vs new way, before vs after)",
    selectionHint: "If it's about a problem being solved, use before_after.",
  },
  logic_diagram: {
    label: "logic_diagram",
    description: "2-3 connected nodes or steps showing how something works, minimal labels only",
    selectionHint: "If it explains a process, use logic_diagram.",
  },
  transformation: {
    label: "transformation",
    description: "a single symbolic visual (icon, shape, arrow) at large scale showing change or direction",
    selectionHint: "Otherwise, transformation.",
  },
};
const ALL_VISUAL_TYPE_IDS = Object.keys(VISUAL_TYPES);

// This was a literal hardcoded Prismm sentence even after the rest of this
// function was wired up to read profiles.visual_studio_config -- VisualConfig
// (the thing Visual Studio actually saves) never carried business identity,
// so business_name/business_description have to come in as separate
// arguments from the caller instead. Same pattern as buildIdentityLine() in
// execute-autopilot-template/index.ts, adapted for the visual-designer framing.
function buildVisualIdentityLine(businessName?: string | null, businessDescription?: string | null): string {
  if (businessName && businessDescription) {
    return `You are a visual designer for ${businessName}. ${businessDescription}`;
  }
  if (businessName) {
    return `You are a visual designer for ${businessName}.`;
  }
  return "You are a visual designer for this brand. Set a business name and description in Strategy for a more specific voice.";
}

export function buildSystemPromptFromConfig(config: VisualConfig, businessName?: string | null, businessDescription?: string | null): string {
  const rulesLines: string[] = ["DESIGN RULES (read every rule before generating):"];
  const dos = config.design_rules.filter((r) => r.tag === "do");
  const avoids = config.design_rules.filter((r) => r.tag === "avoid");
  if (dos.length) {
    rulesLines.push("", "DO:");
    for (const r of dos) rulesLines.push(`- ${r.text}`);
  }
  if (avoids.length) {
    rulesLines.push("", "AVOID:");
    for (const r of avoids) rulesLines.push(`- ${r.text}`);
  }

  // enabled_visual_types genuinely restricts what the AI is offered. If
  // everything got disabled (user error, or an empty/legacy config), fall
  // back to all 4 rather than handing the AI an empty type list.
  const requestedEnabled = (config.enabled_visual_types || []).filter((id) => ALL_VISUAL_TYPE_IDS.includes(id));
  const enabledIds = requestedEnabled.length > 0 ? requestedEnabled : ALL_VISUAL_TYPE_IDS;

  const typeLines = enabledIds.map((id, i) => `${i + 1}. ${VISUAL_TYPES[id].label} — ${VISUAL_TYPES[id].description}`);
  const selectionHints = enabledIds.map((id) => VISUAL_TYPES[id].selectionHint).join(" ");

  const brandBlock = `${buildVisualIdentityLine(businessName, businessDescription)}

BRAND:
- Colors: Background ${config.color_background} (base), Accent ${config.color_accent} (energy), Highlight ${config.color_highlight}, Sparing accent ${config.color_sparing_accent} (used sparingly)
- Fonts: ${config.display_font} (display) + ${config.body_font} (body) via Google Fonts
- Logo: ${config.logo_url} — bottom-left, minimum ${config.logo_min_height}px height, visually prominent
- Tone: direct, trustworthy, human.
- ${config.color_background} base. Soft radial or linear gradients of ${config.color_highlight} or ${config.color_accent} as background texture. No harsh lines.

VISUAL TYPES (only these are available — pick one):
${typeLines.join("\n")}

SELECTION RULE: Pick the type that makes the post's core idea land visually. ${selectionHints}

OUTPUT RULES:
- Return ONLY a JSON object, no markdown, no backticks
- JSON must have exactly two keys: "visual_type" (string, must be one of the ids listed above) and "html" (string)
- The html must be a complete self-contained HTML document
- Include Google Fonts import for ${config.display_font} and ${config.body_font}
- Fixed width ${config.canvas_width}px, height ${config.canvas_height}px (LinkedIn landscape)
- Inline CSS only, no external stylesheets
- ${config.color_background} background as the base
- The 10-word-or-fewer statement must be the insight extracted from the draft, NOT a copy of its opening line`;

  return `${brandBlock}\n\n${rulesLines.join("\n")}`;
}

// Fixed canned sample used when a user has no real drafts yet to preview
// against (or picks "Sample post" instead of one of their own). Generic
// business content so the preview is meaningful for any Knowledge Loom
// user, not tied to any one business's actual subject matter.
export const SAMPLE_DRAFT = {
  title: "Most customers churn quietly before they ever complain",
  body: "By the time a customer files a complaint, the decision to leave has usually already been made. The real signal shows up earlier: fewer logins, shorter sessions, a support ticket that never gets a reply. Most businesses only notice the relationship is over once the invoice goes unpaid, because nothing in the system was watching for the quiet version of the exit.",
  seed_insight: "Businesses track complaints, not the quiet disengagement that precedes them.",
};
