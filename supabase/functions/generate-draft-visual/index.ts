import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI } from "../_shared/ai-caller.ts";
import { buildSystemPromptFromConfig, type VisualConfig } from "../_shared/visual-prompt.ts";
import { resolveDraftPlatform } from "../_shared/publisher/platform-rules.ts";

// Instagram has no per-user canvas config yet (Visual Studio only exposes
// one canvas size, oriented around LinkedIn's landscape default) but it
// hard-requires a square-ish image, so it gets a fixed override here rather
// than silently reusing whatever the user picked for LinkedIn. 1080x1080 is
// Instagram's safest universal feed size (works for feed, is croppable for
// stories/reels without losing the subject).
const INSTAGRAM_CANVAS = { width: 1080, height: 1080 };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Default design rules. These are overridden per-user if visual_design_rules is
// set on profiles, and superseded entirely by visual_studio_config once a user
// has saved anything from the Visual Studio page (see below).
const DEFAULT_DESIGN_RULES = `DESIGN RULES (read every rule before generating):

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
// A function (not a plain string) only so an Instagram draft can still get
// its correct 1080x1080 dimensions stated even when the user has never
// touched Visual Studio. For every other platform, called with (1200, 627,
// "LinkedIn landscape"), producing the exact byte-identical text this was
// before.
function legacyBaseSystemPrompt(width: number, height: number, shapeLabel: string): string {
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
- Fixed width ${width}px, height ${height}px (${shapeLabel})
- Inline CSS only, no external stylesheets
- Navy background (#1b2b45) as the base
- The 10-word-or-fewer statement must be the insight extracted from the draft, NOT a copy of its opening line`;
}

// Renders HTML to a PNG via the prismm-renderer service (real headless
// Chromium via Puppeteer: page.setContent + waitUntil networkidle0, then
// page.screenshot). This is a deterministic, full-fidelity conversion of the
// HTML/CSS into pixels, not an approximation, and it runs entirely
// server-side so it never depends on a browser tab staying open.
//
// Best-effort: if the renderer is unreachable or misconfigured, this returns
// null and the visual still saves with status "ready" and no image_url. The
// client's ensureVisualImageUploaded (html2canvas-based) remains as a
// fallback capture path for that case, so a renderer outage degrades
// gracefully instead of blocking visual generation entirely.
async function renderToPng(html: string, width: number, height: number): Promise<Uint8Array | null> {
  const rendererUrl = Deno.env.get("RENDERER_URL");
  const rendererApiKey = Deno.env.get("RENDERER_API_KEY");
  if (!rendererUrl || !rendererApiKey) {
    console.error("RENDERER_URL or RENDERER_API_KEY not configured; skipping server-side render.");
    return null;
  }

  try {
    const res = await fetch(`${rendererUrl}/render`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": rendererApiKey,
      },
      body: JSON.stringify({ html, width, height }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`Renderer returned ${res.status}: ${errText}`);
      return null;
    }

    const body = await res.json();
    if (!body?.success || !body?.image) {
      console.error("Renderer response missing image data:", JSON.stringify(body));
      return null;
    }

    const binary = atob(body.image);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch (err) {
    console.error("Renderer call failed:", err);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const { draftId, userId } = await req.json();

    if (!draftId || !userId) {
      return new Response(
        JSON.stringify({ error: "Missing draftId or userId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: draft } = await supabase
      .from("drafts")
      .select("*")
      .eq("id", draftId)
      .single();

    if (!draft) {
      return new Response(
        JSON.stringify({ error: "Draft not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("ai_provider, ai_model, ai_api_key, ai_endpoint, visual_design_rules, visual_studio_config, business_name, business_description")
      .eq("user_id", userId)
      .single();

    if (!profile?.ai_api_key) {
      return new Response(
        JSON.stringify({ error: "No AI API key configured. Add your key in Settings." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Visual Studio's saved config is the permanent source once it exists —
    // no path back to the legacy hardcoded prompt below short of a user
    // explicitly clearing it. Until a user has saved Visual Studio at least
    // once, behavior is byte-identical to before it was wired in (legacy
    // prompt + visual_design_rules override, exactly as before).
    const platform = await resolveDraftPlatform(supabase, draft.format_id ?? null);
    const instagramOverride = platform === "instagram" ? INSTAGRAM_CANVAS : null;

    let systemPrompt: string;
    let canvasWidth = instagramOverride?.width ?? 1200;
    let canvasHeight = instagramOverride?.height ?? 627;
    const rawConfig = (profile as any).visual_studio_config as string | null | undefined;
    if (rawConfig && rawConfig.trim()) {
      try {
        const config = JSON.parse(rawConfig) as VisualConfig;
        if (instagramOverride) {
          config.canvas_width = instagramOverride.width;
          config.canvas_height = instagramOverride.height;
        }
        systemPrompt = buildSystemPromptFromConfig(config, profile.business_name, profile.business_description);
        canvasWidth = config.canvas_width || canvasWidth;
        canvasHeight = config.canvas_height || canvasHeight;
      } catch (e) {
        console.error("Failed to parse visual_studio_config, falling back to legacy prompt:", e);
        const designRules = (profile as any).visual_design_rules?.trim() || DEFAULT_DESIGN_RULES;
        systemPrompt = `${legacyBaseSystemPrompt(canvasWidth, canvasHeight, instagramOverride ? "square" : "LinkedIn landscape")}\n\n${designRules}`;
      }
    } else {
      const designRules: string =
        (profile as any).visual_design_rules?.trim()
          ? (profile as any).visual_design_rules.trim()
          : DEFAULT_DESIGN_RULES;
      systemPrompt = `${legacyBaseSystemPrompt(canvasWidth, canvasHeight, instagramOverride ? "square" : "LinkedIn landscape")}\n\n${designRules}`;
    }

    // Insert generating placeholder
    const { data: visual } = await supabase
      .from("draft_visuals")
      .insert({
        draft_id: draftId,
        user_id: userId,
        visual_type: "generating",
        html_content: "",
        status: "generating",
      })
      .select()
      .single();

    if (!visual) {
      return new Response(
        JSON.stringify({ error: "Failed to create visual record" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const draftContent = `TITLE: ${draft.title || "Untitled"}\n\nBODY:\n${draft.body || ""}\n\nSEED INSIGHT: ${draft.seed_insight || ""}`;

    const aiProfile = {
      ai_provider: profile.ai_provider,
      ai_model: profile.ai_model,
      ai_api_key: profile.ai_api_key,
      ai_endpoint: profile.ai_endpoint,
    };

    let response;
    try {
      response = await callAI(
        aiProfile,
        [
          {
            role: "user",
            content: `DRAFT CONTENT:\n${draftContent}\n\nRead the draft. Extract the single most important idea. Choose the visual type that makes that idea land without words. Write a statement of 10 words or fewer that declares the idea — do not quote or restate the post opening. Generate the complete branded HTML visual following all design rules. Return only the JSON object with "visual_type" and "html" keys.`,
          },
        ],
        systemPrompt
      );
    } catch (aiError) {
      await supabase
        .from("draft_visuals")
        .update({ status: "error", error_message: String(aiError) })
        .eq("id", visual.id);
      return new Response(
        JSON.stringify({ error: "AI generation failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let parsed: { visual_type: string; html: string };
    try {
      const cleaned = response.text
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      await supabase
        .from("draft_visuals")
        .update({ status: "error", error_message: "Failed to parse AI response as JSON" })
        .eq("id", visual.id);
      return new Response(
        JSON.stringify({ error: "Failed to parse visual from AI response" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Render server-side (real Chromium via prismm-renderer) and upload,
    // so image_url is populated in the same request that marks the visual
    // ready — no client capture step required for the common case.
    let imageUrl: string | null = null;
    const pngBytes = await renderToPng(parsed.html, canvasWidth, canvasHeight);
    if (pngBytes) {
      const path = `${userId}/${visual.id}.png`;
      const { error: uploadError } = await supabase.storage
        .from("draft-visuals")
        .upload(path, pngBytes, { contentType: "image/png", upsert: true });
      if (uploadError) {
        console.error("Server-side image upload failed:", uploadError);
      } else {
        const { data: pub } = supabase.storage.from("draft-visuals").getPublicUrl(path);
        imageUrl = pub?.publicUrl ?? null;
      }
    }

    await supabase
      .from("draft_visuals")
      .update({
        visual_type: parsed.visual_type,
        html_content: parsed.html,
        status: "ready",
        image_url: imageUrl,
      })
      .eq("id", visual.id);

    return new Response(
      JSON.stringify({ success: true, visualId: visual.id, visualType: parsed.visual_type, imageUrl }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
