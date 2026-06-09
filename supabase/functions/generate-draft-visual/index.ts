import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI } from "../_shared/ai-caller.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PRISMM_SYSTEM_PROMPT = `You are a visual designer for Prismm, inheritance infrastructure for community banks and credit unions.

BRAND:
- Navy #1b2b45 (foundation), Coral #f9655b (accent/energy), Purple #6658ea (highlights), Yellow #f5c070 (sparingly), White #ffffff, Paper #f4f1ea
- Fonts: Bricolage Grotesque (display, 700-800) + Hanken Grotesk (body, 400-600) via Google Fonts
- Logo: https://res.cloudinary.com/dialhpycd/image/upload/v1772044659/prismm-logo-dark-bright_2x-removebg-preview_ut98x4.png
- Tone: calm authority. Trusted financial software with a human pulse. Direct, trustworthy, human.
- Rounded cards (14-18px radius), generous whitespace, uppercase letter-spaced eyebrow labels in yellow or coral
- Navy base with soft radial glows of purple and coral

VISUAL TYPES:
1. stat_graphic — large hero number + supporting context
2. quote_card — pull quote in display type
3. pillar_statement — single ownable thesis line
4. human_moment — narrative-forward, warm tone, more whitespace
5. timeline — wealth transfer window, scale and urgency
6. comparison — before/after or with/without Prismm
7. checklist — preparedness pillar, action-oriented
8. branded_announcement — product news, milestone, wordmark lockup

OUTPUT RULES:
- Return ONLY a JSON object, no markdown, no backticks
- JSON must have exactly two keys: "visual_type" (string) and "html" (string)
- The html must be a complete self-contained HTML document
- Include Google Fonts import for Bricolage Grotesque and Hanken Grotesk
- Fixed width 1200px, height 627px (LinkedIn landscape)
- Inline CSS only, no external stylesheets
- Navy background (#1b2b45) as the base
- Prismm logo in bottom-left corner, height 28px
- Never mention probate, never use em-dashes
- Content grounded in specifics from the draft`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const { draftId, userId } = await req.json();

    if (!draftId || !userId) return new Response(JSON.stringify({ error: "Missing draftId or userId" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: draft } = await supabase.from("drafts").select("*").eq("id", draftId).single();
    if (!draft) return new Response(JSON.stringify({ error: "Draft not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: profile } = await supabase.from("profiles").select("ai_provider, ai_model, ai_api_key, ai_endpoint").eq("user_id", userId).single();

    if (!profile?.ai_api_key) {
      return new Response(JSON.stringify({ error: "No AI API key configured. Add your key in Settings." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Insert generating placeholder
    const { data: visual } = await supabase.from("draft_visuals").insert({
      draft_id: draftId,
      user_id: userId,
      visual_type: "generating",
      html_content: "",
      status: "generating"
    }).select().single();

    if (!visual) return new Response(JSON.stringify({ error: "Failed to create visual record" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const draftContent = `TITLE: ${draft.title || "Untitled"}\n\nBODY:\n${draft.body || ""}\n\nSEED INSIGHT: ${draft.seed_insight || ""}`;

    const aiProfile = { ai_provider: profile.ai_provider, ai_model: profile.ai_model, ai_api_key: profile.ai_api_key, ai_endpoint: profile.ai_endpoint };

    let response;
    try {
      response = await callAI(
        aiProfile,
        [{ role: "user", content: `DRAFT CONTENT:\n${draftContent}\n\nAnalyze this draft, select the most appropriate visual type, and generate a complete branded HTML visual. Return only the JSON object with "visual_type" and "html" keys.` }],
        PRISMM_SYSTEM_PROMPT
      );
    } catch (aiError) {
      await supabase.from("draft_visuals").update({ status: "error", error_message: String(aiError) }).eq("id", visual.id);
      return new Response(JSON.stringify({ error: "AI generation failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let parsed: { visual_type: string; html: string };
    try {
      const cleaned = response.text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      await supabase.from("draft_visuals").update({ status: "error", error_message: "Failed to parse AI response as JSON" }).eq("id", visual.id);
      return new Response(JSON.stringify({ error: "Failed to parse visual from AI response" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await supabase.from("draft_visuals").update({ visual_type: parsed.visual_type, html_content: parsed.html, status: "ready" }).eq("id", visual.id);

    return new Response(JSON.stringify({ success: true, visualId: visual.id, visualType: parsed.visual_type }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
