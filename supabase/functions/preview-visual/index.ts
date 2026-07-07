import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI } from "../_shared/ai-caller.ts";
import { buildSystemPromptFromConfig, SAMPLE_DRAFT, type VisualConfig } from "../_shared/visual-prompt.ts";

// Visual Studio's live preview. Takes the CURRENT, possibly-unsaved config
// straight from the browser (not read from profiles — someone tuning
// colors/fonts wants to see the effect of what's on screen right now, not
// what they last saved) plus either a real draftId or the fixed sample
// post, and generates a one-off visual using the exact same prompt-building
// logic as real generation (buildSystemPromptFromConfig, shared). Nothing
// is written to draft_visuals or anywhere else — this is read-only from the
// user's perspective, a look-but-don't-persist preview.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function renderToPng(html: string, width: number, height: number): Promise<Uint8Array | null> {
  const rendererUrl = Deno.env.get("RENDERER_URL");
  const rendererApiKey = Deno.env.get("RENDERER_API_KEY");
  if (!rendererUrl || !rendererApiKey) return null;
  try {
    const res = await fetch(`${rendererUrl}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": rendererApiKey },
      body: JSON.stringify({ html, width, height }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    if (!body?.success || !body?.image) return null;
    const binary = atob(body.image);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authentication required" }, 401);

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return json({ error: "Invalid or expired token" }, 401);
    const userId = user.id;

    const { config, draftId } = await req.json().catch(() => ({}));
    if (!config) return json({ error: "config is required" }, 400);

    const { data: profile } = await supabase
      .from("profiles")
      .select("ai_provider, ai_model, ai_api_key, ai_endpoint, business_name, business_description")
      .eq("user_id", userId)
      .single();
    if (!profile?.ai_api_key) {
      return json({ error: "No AI API key configured. Add your key in Settings." }, 400);
    }

    let draftContent: string;
    if (draftId) {
      const { data: draft } = await supabase
        .from("drafts")
        .select("title, body, seed_insight")
        .eq("id", draftId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!draft) return json({ error: "Draft not found or access denied" }, 404);
      draftContent = `TITLE: ${draft.title || "Untitled"}\n\nBODY:\n${draft.body || ""}\n\nSEED INSIGHT: ${draft.seed_insight || ""}`;
    } else {
      draftContent = `TITLE: ${SAMPLE_DRAFT.title}\n\nBODY:\n${SAMPLE_DRAFT.body}\n\nSEED INSIGHT: ${SAMPLE_DRAFT.seed_insight}`;
    }

    const visualConfig = config as VisualConfig;
    const systemPrompt = buildSystemPromptFromConfig(visualConfig, profile?.business_name, profile?.business_description);
    const canvasWidth = visualConfig.canvas_width || 1200;
    const canvasHeight = visualConfig.canvas_height || 627;

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
      return json({ error: "AI generation failed: " + (aiError instanceof Error ? aiError.message : String(aiError)) }, 500);
    }

    let parsed: { visual_type: string; html: string };
    try {
      const cleaned = response.text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return json({ error: "Failed to parse visual from AI response" }, 500);
    }

    // Best-effort render to PNG for a crisp preview; if the renderer is
    // unavailable, the raw HTML is still returned and the frontend can
    // display it directly in an iframe as a fallback.
    let imageBase64: string | null = null;
    const pngBytes = await renderToPng(parsed.html, canvasWidth, canvasHeight);
    if (pngBytes) {
      let binary = "";
      for (let i = 0; i < pngBytes.length; i++) binary += String.fromCharCode(pngBytes[i]);
      imageBase64 = btoa(binary);
    }

    return json({ success: true, visualType: parsed.visual_type, html: parsed.html, imageBase64 });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
