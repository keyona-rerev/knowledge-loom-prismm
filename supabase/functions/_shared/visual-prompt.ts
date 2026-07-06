// Shared prompt-building logic for Visual Studio config -> AI system prompt.
// Used by BOTH generate-draft-visual (the real thing, persisted to
// draft_visuals) and preview-visual (Visual Studio's live "sample post"
// preview, never persisted). Keeping this in one file means the preview a
// user sees while tuning Visual Studio is built from the exact same logic
// that will actually run on their next real draft — no drift between
// "what I previewed" and "what actually generates."

export interface DesignRule { id: string; text: string; tag: "do" | "avoid"; }
export interface VisualConfig {
  color_navy: string; color_coral: string; color_purple: string; color_yellow: string;
  display_font: string; body_font: string;
  logo_url: string; logo_min_height: number;
  canvas_width: number; canvas_height: number;
  design_rules: DesignRule[];
  enabled_visual_types: string[];
}

// NOTE: enabled_visual_types uses a different vocabulary (stat_graphic,
// quote_card, pillar_statement, human_moment, comparison, timeline,
// checklist, branded_announcement) than the AI's actual visual type
// selection below (hero_number, before_after, logic_diagram,
// transformation) — the two were never reconciled. This function does not
// attempt to bridge that gap; see HARDCODED_VALUES_AUDIT.md.
export function buildSystemPromptFromConfig(config: VisualConfig): string {
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

  const brandBlock = `You are a visual designer for Prismm, inheritance infrastructure for community banks and credit unions.

BRAND:
- Colors: Navy ${config.color_navy} (background base), Coral ${config.color_coral} (accent/energy), Purple ${config.color_purple} (highlights), Yellow ${config.color_yellow} (sparingly)
- Fonts: ${config.display_font} (display) + ${config.body_font} (body) via Google Fonts
- Logo: ${config.logo_url} — bottom-left, minimum ${config.logo_min_height}px height, visually prominent
- Tone: calm authority. Trusted financial software with a human pulse. Direct, trustworthy, human.
- ${config.color_navy} base. Soft radial or linear gradients of ${config.color_purple} or ${config.color_coral} as background texture. No harsh lines.

VISUAL TYPES:
1. hero_number — one large stat or number dominates the canvas, 10-word-or-fewer statement below
2. before_after — canvas split into two halves showing contrast (without Prismm vs with, old way vs new way)
3. logic_diagram — 2-3 connected nodes or steps showing how something works, minimal labels only
4. transformation — a single symbolic visual (icon, shape, arrow) at large scale showing change or direction

SELECTION RULE: Pick the type that makes the post's core idea land visually. If the post has a number or stat, use hero_number. If it's about a problem being solved, use before_after. If it explains a process, use logic_diagram. Otherwise, transformation.

OUTPUT RULES:
- Return ONLY a JSON object, no markdown, no backticks
- JSON must have exactly two keys: "visual_type" (string) and "html" (string)
- The html must be a complete self-contained HTML document
- Include Google Fonts import for ${config.display_font} and ${config.body_font}
- Fixed width ${config.canvas_width}px, height ${config.canvas_height}px (LinkedIn landscape)
- Inline CSS only, no external stylesheets
- ${config.color_navy} background as the base
- The 10-word-or-fewer statement must be the insight extracted from the draft, NOT a copy of its opening line`;

  return `${brandBlock}\n\n${rulesLines.join("\n")}`;
}

// Fixed canned sample used when a user has no real drafts yet to preview
// against (or picks "Sample post" instead of one of their own). Deliberately
// generic financial-services content so the preview is meaningful for any
// Knowledge Loom user, not just Prismm specifically.
export const SAMPLE_DRAFT = {
  title: "Half of inherited deposits leave within a year",
  body: "When a depositor passes, the account doesn't quietly transfer within your walls. It moves. Roughly half of inherited deposits leave the institution within twelve months, most often to whichever advisor or bank the heir already trusts. The relationship your institution spent decades building with the depositor rarely extends to their children — because it was never built with them in the first place.",
  seed_insight: "Institutions have no systematic relationship with heirs before the money moves.",
};
