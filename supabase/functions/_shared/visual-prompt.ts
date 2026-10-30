import { sha256Hex } from "./job-logic.ts";
// Shared prompt-building logic for Visual Studio config -> AI system prompt.
// Used by BOTH generate-draft-visual (the real thing, persisted to
// draft_visuals) and preview-visual (Visual Studio's live "sample post"
// preview, never persisted). Keeping this in one file means the preview a
// user sees while tuning Visual Studio is built from the exact same logic
// that will actually run on their next real draft — no drift between
// "what I previewed" and "what actually generates."

import { platformSpec, DEFAULT_PLATFORM } from "./publisher/platform-config.ts";

export interface DesignRule { id: string; text: string; tag: "do" | "avoid"; }
export interface VisualConfig {
  color_background: string; color_accent: string; color_highlight: string; color_sparing_accent: string;
  display_font: string; body_font: string;
  logo_url: string; logo_min_height: number;
  canvas_width: number; canvas_height: number; // LinkedIn canvas size (the original, still the default)
  instagram_canvas_width?: number; instagram_canvas_height?: number; // Instagram canvas size, defaults to a 1080x1080 square
  design_rules: DesignRule[];
  enabled_visual_types: string[];
}

// The canvas size to actually render at for a given platform: the user's
// saved per-platform value if set, else that platform's sane default. Used
// by both the prompt builder below and generate-draft-visual's render call,
// so the AI is always told the exact dimensions the PNG is captured at.
export function canvasDimsForPlatform(
  config: VisualConfig | null | undefined,
  platform: string,
): { width: number; height: number } {
  const spec = platformSpec(platform);
  if (platform === "instagram") {
    return {
      width: config?.instagram_canvas_width || spec.canvasWidth,
      height: config?.instagram_canvas_height || spec.canvasHeight,
    };
  }
  return {
    width: config?.canvas_width || spec.canvasWidth,
    height: config?.canvas_height || spec.canvasHeight,
  };
}

function orientationLabel(width: number, height: number): string {
  if (width === height) return "square";
  return width > height ? "landscape" : "portrait";
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

export function buildSystemPromptFromConfig(
  config: VisualConfig,
  businessName?: string | null,
  businessDescription?: string | null,
  platform: string = DEFAULT_PLATFORM,
): string {
  const { width, height } = canvasDimsForPlatform(config, platform);
  const platformLabel = platformSpec(platform).label;
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
- Fixed width ${width}px, height ${height}px (${platformLabel} ${orientationLabel(width, height)})
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

// ---------------------------------------------------------------------------
// Legacy fallback prompt assets, moved verbatim from generate-draft-visual so
// the batch producer (produce-scheduled-visuals) builds byte-identical
// prompts. Do not edit without checking both callers.
// ---------------------------------------------------------------------------
// set on profiles, and superseded entirely by visual_studio_config once a user
// has saved anything from the Visual Studio page (see below).
export const DEFAULT_DESIGN_RULES = `DESIGN RULES (read every rule before generating):

WHAT THIS GRAPHIC IS:
- One central visual element (a number, a before/after split, an icon, a simple diagram showing how pieces connect) PLUS a statement of 10 words or fewer. That is the whole graphic.
- The statement distills the POST'S CORE IDEA into something a 65-year-old can read from across a table. Not a summary. Not a quote. A declaration.
- The visual element must show a transformation, a contrast, a logic connection, or a scale — something that makes the idea land without words.

WHAT THIS GRAPHIC IS NOT:
- NOT a text card. Do not restate the post. Do not paste bullet points. Do not reproduce paragraphs.
- NOT a slide. No title + body layout. No headers over body copy.
- NOT a listicle. No numbered lists, no bullet points, no checkboxes.
- If you find yourself writing more than 10 words of main content, stop and rethink.

TYPOGRAPHY:
- Main statement: minimum 72px, maximum 96px, Bricolage Grotesque 800 weight. Bold enough to read as a thumbnail.
- Supporting label (if any): maximum 24px, Hanken Grotesk 400. One line only.
- Our audience skews older — legibility is non-negotiable. Nothing below 20px anywhere.
- Maximum two type sizes on the canvas. No more.

LAYOUT:
- The visual element occupies the dominant portion of the canvas.
- The statement anchors below or beside it — not layered on top of it.
- Generous whitespace. Nothing crammed. Breathing room is part of the design.
- Logo: bottom-left, height 56px minimum. Visually prominent, never tiny or faint.

VISUAL ELEMENT OPTIONS (pick one that fits the content):
- A large hero number (e.g. "$84T", "72%", "1 in 3") stark and full-bleed
- A before/after split — two halves of the canvas showing contrast
- A simple two-or-three node diagram showing how things connect or flow
- A single icon or symbol at large scale that represents the idea

FORBIDDEN:
- No pill labels, category tags, eyebrow text, or badge shapes
- No card boxes, bordered containers, rounded rect panels, or frosted-glass overlays
- No decorative icons used as decoration (only as the central visual element)
- No em-dashes
- Never mention probate`;

// Legacy hardcoded brand block. Used ONLY as a fallback for users who have
// never saved anything from the Visual Studio page (profiles.visual_studio_config
// is null/empty) — this keeps every existing user's output byte-identical to
// before Visual Studio was wired in. The moment a user saves Visual Studio
// once, this switches to buildSystemPromptFromConfig entirely, with no path
// back to these hardcoded values short of them explicitly re-editing Visual
// Studio itself.
//
// Parametrized only on canvas size/orientation label, so an Instagram draft
// hitting this fallback (a user who has never touched Visual Studio) still
// gets a sensible square canvas instead of LinkedIn's landscape crop; the
// LinkedIn case renders byte-identical to the original hardcoded prompt.
export function legacyBaseSystemPrompt(width: number, height: number, orientation: string): string {
  return `You are a visual designer for Prismm, inheritance infrastructure for community banks and credit unions.

BRAND:
- Colors: Navy #1b2b45 (background base), Coral #f9655b (accent/energy), Purple #6658ea (highlights), Yellow #f5c070 (sparingly), White #ffffff, Paper #f4f1ea
- Fonts: Bricolage Grotesque (display, 700-800) + Hanken Grotesk (body, 400-500) via Google Fonts
- Logo: https://res.cloudinary.com/dialhpycd/image/upload/v1772044659/prismm-logo-dark-bright_2x-removebg-preview_ut98x4.png
- Tone: calm authority. Trusted financial software with a human pulse. Direct, trustworthy, human.
- Navy base. Soft radial or linear gradients of purple or coral as background texture. No harsh lines.

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
- Include Google Fonts import for Bricolage Grotesque and Hanken Grotesk
- Fixed width ${width}px, height ${height}px (${orientation})
- Inline CSS only, no external stylesheets
- Navy background (#1b2b45) as the base
- The 10-word-or-fewer statement must be the insight extracted from the draft, NOT a copy of its opening line`;
}

// Single source for the render-prompt construction, shared by the interactive
// handler (generate-draft-visual) and the batch/approval paths. A saved,
// parseable visual_studio_config owns prompt+dims; anything malformed or
// absent falls back to visual_design_rules / DEFAULT_DESIGN_RULES over the
// legacy base prompt.
// deno-lint-ignore no-explicit-any
export function buildVisualPrompt(profile: any, platform: string) {
  const spec = platformSpec(platform);
  const legacyOrientation = platform === "instagram" ? "Instagram square" : "LinkedIn landscape";
  let systemPrompt: string;
  let canvasWidth = spec.canvasWidth;
  let canvasHeight = spec.canvasHeight;
  const rawConfig = profile?.visual_studio_config as string | null | undefined;
  if (rawConfig && rawConfig.trim()) {
    try {
      const config = JSON.parse(rawConfig) as VisualConfig;
      systemPrompt = buildSystemPromptFromConfig(config, profile?.business_name, profile?.business_description, platform);
      const dims = canvasDimsForPlatform(config, platform);
      canvasWidth = dims.width;
      canvasHeight = dims.height;
    } catch {
      const designRules = profile?.visual_design_rules?.trim() || DEFAULT_DESIGN_RULES;
      systemPrompt = `${legacyBaseSystemPrompt(canvasWidth, canvasHeight, legacyOrientation)}\n\n${designRules}`;
    }
  } else {
    const designRules = profile?.visual_design_rules?.trim()
      ? profile.visual_design_rules.trim()
      : DEFAULT_DESIGN_RULES;
    systemPrompt = `${legacyBaseSystemPrompt(canvasWidth, canvasHeight, legacyOrientation)}\n\n${designRules}`;
  }
  return { systemPrompt, canvasWidth, canvasHeight };
}

// Canonical fingerprint over ALL render inputs (draft content + system prompt
// + platform + canvas). JSON.stringify canonicalizes template-literal
// ambiguity; a style/config/canvas change invalidates exactly like a content
// edit. Bound at admit, compared at scan and at completion.
// deno-lint-ignore no-explicit-any
export async function visualSourceFingerprint(draft: any, systemPrompt: string, platform: string, canvasW: number, canvasH: number): Promise<string> {
  return sha256Hex(JSON.stringify({
    title: draft.title ?? "", body: draft.body ?? "", seed: draft.seed_insight ?? "",
    system: systemPrompt, platform, canvasW, canvasH,
  }));
}
