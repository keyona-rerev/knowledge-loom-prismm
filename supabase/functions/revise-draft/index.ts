import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI } from "../_shared/ai-caller.ts";
import { loadStrategyContext, buildContextBlock, buildSystemPrompt } from "../_shared/strategy-context.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function parseJSON(text: string): any {
  let content = text.trim();
  const fence = content.match(/```(?:\w*)?\s*([\s\S]*?)\s*```/i);
  if (fence) content = fence[1].trim();
  const jsonMatch = content.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) content = jsonMatch[1];
  return JSON.parse(content);
}

// The specific AI-writing tells this pass exists to strip out. Kept as its
// own list (not folded into a generic "write well" instruction) so it's
// easy to add to the moment a new trope starts showing up in drafts,
// without touching the rest of the prompt.
const PROSE_TROPES = [
  `The "it's not X, it's Y" false-contrast construction (e.g. "It's not about the tools, it's about the mindset").`,
  `Announcing the insight instead of just making it ("Here's the thing:", "The real question is...", "What most people miss is...", "This is what most people get wrong").`,
  `"Let that sink in" and other manufactured-weight sentence stunts.`,
  `Empty scene-setting openers ("In today's fast-paced world...", "In an era of...").`,
  `Rhetorical questions used as a structural crutch instead of an actual argument.`,
  `Staccato one-line paragraphs used purely for punch rather than because the idea needs the break.`,
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authentication required" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseAuth = createClient(supabaseUrl, serviceRoleKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid or expired authentication token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { draftId, notes } = await req.json();
    if (!draftId) {
      return new Response(JSON.stringify({ error: "draftId is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Rate limiting, same shape and window as regenerate-draft-with-feedback.
    const windowStart = new Date();
    windowStart.setMinutes(windowStart.getMinutes() - 60);
    const { count: rateCount } = await supabase
      .from("rate_limit_logs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("action", "revise_draft")
      .gte("created_at", windowStart.toISOString());
    if ((rateCount || 0) >= 50) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded. Maximum 50 revisions per hour." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    await supabase.from("rate_limit_logs").insert({ user_id: user.id, action: "revise_draft" });

    const { data: draft } = await supabase.from("drafts").select("*").eq("id", draftId).eq("user_id", user.id).single();
    if (!draft) {
      return new Response(JSON.stringify({ error: "Draft not found or access denied" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: profile } = await supabase.from("profiles").select("ai_provider, ai_model, ai_api_key, ai_endpoint").eq("user_id", user.id).single();
    if (!profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!profile.ai_api_key) {
      return new Response(JSON.stringify({ error: "No AI API key configured in Settings" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Store revision history before overwriting, same pattern as
    // regenerate-draft-with-feedback, so a bad revise pass is always
    // recoverable from draft_revisions.
    const currentVersion = (draft.revision_count || 0) + 1;
    await supabase.from("draft_revisions").insert({
      draft_id: draftId,
      version: currentVersion,
      body: draft.body,
      changes_summary: `Before prose revision (trope cleanup pass)${notes ? `: ${notes}` : ""}`,
    });

    // Same strategy tables execute-autopilot-template and
    // regenerate-draft-with-feedback read, resolved off the draft's own
    // format/nature/job so the revised prose still matches the format and
    // nature it was originally generated for.
    const { ctx, hardRules, voiceRules, inlineAttribution } = await loadStrategyContext(supabase, user.id, {
      formatId: draft.format_id, natureId: draft.nature_id, jobId: draft.job_id,
    });
    const strategyBlock = buildContextBlock(ctx);

    // Every figure gets pinned by exact wording so the rewrite can't drift
    // a number, and can't quietly invent a new one either.
    const statLines = Array.isArray(draft.stat_attributions) && draft.stat_attributions.length
      ? draft.stat_attributions.map((a: any) => `- "${a.figure}" from ${a.source}`).join("\n")
      : "";

    const prompt = `Rewrite this post's prose. This is a line-level editing pass, not a rewrite of the argument and not a fresh take on the topic.

CURRENT CONTENT:
Title: ${draft.title}
Body:
${draft.body}
${statLines ? `\nFIGURES ALREADY CITED (keep every one of these worded exactly as-is; do not alter a number and do not introduce new ones):\n${statLines}` : ""}
${notes ? `\nADDITIONAL NOTES FROM THE REVIEWER:\n${notes}` : ""}

WHAT TO FIX
Cut these specific tropes wherever they show up, and rewrite around them so the point still lands, just without the crutch:
${PROSE_TROPES.map((t) => `- ${t}`).join("\n")}

WHAT TO PRESERVE
- The actual argument, structure, and length. Do not condense this into a summary or pad it into something longer.
- Every fact, figure, and attribution exactly as stated above.
- The title, unless it also carries one of the tropes above.

${strategyBlock}

Respond ONLY with valid JSON: {"title": "...", "content": "the fully rewritten post"}`;

    const aiProfile = { ai_provider: profile.ai_provider, ai_model: profile.ai_model, ai_api_key: profile.ai_api_key, ai_endpoint: profile.ai_endpoint };
    const system = buildSystemPrompt(
      "You are a sharp, unsentimental line editor. Your only job on this pass is prose quality: cut the specific tropes you're given, and leave everything else -- the argument, the facts, the structure -- intact. Always respond with valid JSON only.",
      hardRules, voiceRules, inlineAttribution
    );
    const response = await callAI(aiProfile, [{ role: "user", content: prompt }], system);
    const result = parseJSON(response.text);

    await supabase.from("drafts").update({
      title: result.title || draft.title,
      body: result.content,
      revision_count: currentVersion,
      updated_at: new Date().toISOString(),
    }).eq("id", draftId);

    return new Response(
      JSON.stringify({ success: true, title: result.title || draft.title, content: result.content, revisionCount: currentVersion }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
