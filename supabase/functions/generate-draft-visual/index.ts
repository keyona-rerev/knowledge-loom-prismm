import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PRISMM_SYSTEM_PROMPT = `You are a visual designer for Prismm, inheritance infrastructure for community banks and credit unions.

BRAND:
- Navy #1b2b45 (foundation), Coral #f9655b (accent/energy), Purple #6658ea (highlights), Yellow #f5c070 (sparingly), White #ffffff, Paper #f4f1ea
- Fonts: Bricolage Grotesque (display, 700-800) + Hanken Grotesk (body, 400-600) via Google Fonts
- Logo: https://res.cloudinary.com/dialhpycd/image/upload/v1772044659/prismm-logo-dark-bright_2x-removebg-preview_ut98x4.png
- Tone: calm authority. Trusted financial software with a human pulse. Direct, trustworthy, human. Not bold/disruptive. Not soft/sentimental.
- Rounded cards (14-18px radius), generous whitespace, uppercase letter-spaced eyebrow labels in yellow or coral
- Navy base with soft radial glows of purple and coral

VISUAL TYPES:
1. stat_graphic — large hero number + supporting context. For retention cliff stats, wealth transfer figures.
2. quote_card — pull quote in display type. For thought leadership lines.
3. pillar_statement — single ownable thesis, no stat no quote. "No one has built this from the bank's side."
4. human_moment — narrative-forward, no data. Short scene-setter. Warmer tone, more whitespace.
5. timeline — wealth transfer window, scale and urgency in one glance.
6. comparison — before/after or with/without Prismm. Retention gap made visual.
7. checklist — preparedness pillar. Documents, trusted people, connected accounts.
8. branded_announcement — product news, partnership, milestone. Clean wordmark lockup.

OUTPUT RULES:
- Return ONLY a JSON object, no markdown, no backticks, no preamble
- JSON must have exactly two keys: "visual_type" (string) and "html" (string)
- The html value must be a complete self-contained HTML document
- HTML must include Google Fonts import for Bricolage Grotesque and Hanken Grotesk
- Design for LinkedIn 1200x627 (landscape) as primary format
- The html must have a fixed width of 1200px and height of 627px
- No external images except the Prismm logo via the Cloudinary URL above
- Use inline CSS only, no external stylesheets
- Navy background (#1b2b45) as the base
- Prismm logo in bottom-left corner, small (height: 28px), with clear space
- Never mention probate, never use em-dashes
- Content must be grounded in specifics from the draft, not generic`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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

    // Fetch the draft
    const { data: draft, error: draftError } = await supabase
      .from("drafts")
      .select("*")
      .eq("id", draftId)
      .single();

    if (draftError || !draft) {
      return new Response(
        JSON.stringify({ error: "Draft not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch user profile for AI key
    const { data: profile } = await supabase
      .from("profiles")
      .select("google_ai_api_key, ai_model")
      .eq("user_id", userId)
      .single();

    const apiKey = profile?.google_ai_api_key;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "No AI API key configured. Add your Google AI key in Settings." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Insert a generating placeholder
    const { data: visual, error: insertError } = await supabase
      .from("draft_visuals")
      .insert({
        draft_id: draftId,
        user_id: userId,
        visual_type: "generating",
        html_content: "",
        status: "generating"
      })
      .select()
      .single();

    if (insertError) {
      console.error("Insert error:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to create visual record" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Call Gemini
    const model = profile?.ai_model || "gemini-2.0-flash-exp";
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const draftContent = `TITLE: ${draft.title || "Untitled"}

BODY:
${draft.body || ""}

SEED INSIGHT: ${draft.seed_insight || ""}`;

    const geminiResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `${PRISMM_SYSTEM_PROMPT}\n\nDRAFT CONTENT:\n${draftContent}\n\nAnalyze this draft, select the most appropriate visual type, and generate a complete branded HTML visual. Return only the JSON object.`
          }]
        }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 8192,
        }
      })
    });

    if (!geminiResponse.ok) {
      const errText = await geminiResponse.text();
      console.error("Gemini error:", errText);
      await supabase.from("draft_visuals").update({
        status: "error",
        error_message: `Gemini API error: ${geminiResponse.status}`
      }).eq("id", visual.id);

      return new Response(
        JSON.stringify({ error: "AI generation failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const geminiData = await geminiResponse.json();
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Parse JSON from response
    let parsed: { visual_type: string; html: string };
    try {
      const cleaned = rawText
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error("Parse error:", e, "Raw:", rawText.substring(0, 500));
      await supabase.from("draft_visuals").update({
        status: "error",
        error_message: "Failed to parse AI response as JSON"
      }).eq("id", visual.id);

      return new Response(
        JSON.stringify({ error: "Failed to parse visual from AI response" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update the visual record with the result
    await supabase.from("draft_visuals").update({
      visual_type: parsed.visual_type,
      html_content: parsed.html,
      status: "ready"
    }).eq("id", visual.id);

    console.log(`✅ Visual generated: ${parsed.visual_type} for draft ${draftId}`);

    return new Response(
      JSON.stringify({ success: true, visualId: visual.id, visualType: parsed.visual_type }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
