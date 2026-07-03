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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Authentication required" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabaseAuth = createClient(supabaseUrl, serviceRoleKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) return new Response(JSON.stringify({ error: "Invalid or expired authentication token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { draftId, feedback } = await req.json();

    if (!draftId || !feedback) return new Response(JSON.stringify({ error: "draftId and feedback are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Rate limiting
    const windowStart = new Date();
    windowStart.setMinutes(windowStart.getMinutes() - 60);
    const { count: rateCount } = await supabase.from('rate_limit_logs').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('action', 'regenerate_draft').gte('created_at', windowStart.toISOString());
    if ((rateCount || 0) >= 50) return new Response(JSON.stringify({ error: 'Rate limit exceeded. Maximum 50 regenerations per hour.' }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    await supabase.from('rate_limit_logs').insert({ user_id: user.id, action: 'regenerate_draft' });

    const { data: draft } = await supabase.from("drafts").select("*").eq("id", draftId).eq("user_id", user.id).single();
    if (!draft) return new Response(JSON.stringify({ error: "Draft not found or access denied" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: profile } = await supabase.from("profiles").select("ai_provider, ai_model, ai_api_key, ai_endpoint").eq("user_id", user.id).single();
    if (!profile) return new Response(JSON.stringify({ error: "Profile not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Store revision history
    const currentVersion = (draft.revision_count || 0) + 1;
    await supabase.from("draft_revisions").insert({
      draft_id: draftId,
      version: currentVersion,
      body: draft.body,
      changes_summary: `Before revision: ${feedback.substring(0, 100)}...`
    });

    // Same strategy tables execute-autopilot-template and the modernized
    // Create Content flow read, instead of the old flat profiles columns.
    // Read format/nature/job straight off the draft being revised - it
    // already carries them from when it was first generated, so revising it
    // doesn't need any new UI to re-pick them.
    const { ctx, hardRules, voiceRules, inlineAttribution } = await loadStrategyContext(supabase, user.id, {
      formatId: draft.format_id, natureId: draft.nature_id, jobId: draft.job_id,
    });
    const strategyBlock = buildContextBlock(ctx);

    const prompt = `Revise this content based on the feedback. Address all points while maintaining quality.

CURRENT CONTENT:
Title: ${draft.title}
Body:
${draft.body}

FEEDBACK:
${feedback}

${strategyBlock}

Respond ONLY with valid JSON: {"title": "...", "content": "full revised content"}`;

    const aiProfile = { ai_provider: profile.ai_provider, ai_model: profile.ai_model, ai_api_key: profile.ai_api_key, ai_endpoint: profile.ai_endpoint };
    const system = buildSystemPrompt(
      "You are a professional editor. Always respond with valid JSON only.",
      hardRules, voiceRules, inlineAttribution
    );
    const response = await callAI(aiProfile, [{ role: "user", content: prompt }], system);
    const result = parseJSON(response.text);

    await supabase.from("drafts").update({
      title: result.title || draft.title,
      body: result.content,
      revision_feedback: feedback,
      revision_count: currentVersion,
      updated_at: new Date().toISOString()
    }).eq("id", draftId);

    return new Response(JSON.stringify({ success: true, title: result.title || draft.title, content: result.content, revisionCount: currentVersion }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
