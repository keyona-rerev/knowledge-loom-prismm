import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enqueueInteractiveJob, awaitInteractiveJob, findLatestGeneration } from "../_shared/claude-queue.ts";
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
    const { draftId, feedback, maxWaitMs } = await req.json();

    if (!draftId || !feedback) return new Response(JSON.stringify({ error: "draftId and feedback are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: draft } = await supabase.from("drafts").select("*").eq("id", draftId).eq("user_id", user.id).single();
    if (!draft) return new Response(JSON.stringify({ error: "Draft not found or access denied" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Store revision history
    const currentVersion = (draft.revision_count || 0) + 1;
    const fbKey = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(feedback ?? "")))
      .then((b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 16));
    const idemKey = `regen:${draftId}:${draft.updated_at}:${fbKey}`;

    let jobId: string;
    const existingJob = await findLatestGeneration(supabase, user.id, `interactive:regenerate-draft-with-feedback:${idemKey}`);
    if (existingJob && existingJob.status !== "failed") {
      // Idempotent reattach BEFORE any metered side effect: an exact retry of
      // the SAME regeneration attaches to the existing job - no second
      // rate-limit slot, no duplicate draft_revisions history row.
      jobId = existingJob.id;
    } else {
      // Rate limiting
      const windowStart = new Date();
      windowStart.setMinutes(windowStart.getMinutes() - 60);
      const { count: rateCount } = await supabase.from('rate_limit_logs').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('action', 'regenerate_draft').gte('created_at', windowStart.toISOString());
      if ((rateCount || 0) >= 50) return new Response(JSON.stringify({ error: 'Rate limit exceeded. Maximum 50 regenerations per hour.' }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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

    const system = buildSystemPrompt(
      "You are a professional editor. Always respond with valid JSON only.",
      hardRules, voiceRules, inlineAttribution
    );
    // Subscription path: enqueue onto claude_jobs; the private worker (Claude
    // Code on the owner's Max subscription) does the AI work. No paid route.
    // Idempotency: an exact retry of the SAME regeneration (same draft
    // version, same feedback) returns the existing job instead of
    // double-spending a worker run; new feedback or a newer draft version is
    // a deliberate new pass and correctly gets a fresh job.
    const handle = await enqueueInteractiveJob(supabase, {
      userId: user.id, route: "regenerate-draft-with-feedback", kind: "regenerate", prompt, system,
      context: { draftId },
      idempotencyKey: idemKey,
    });
    jobId = handle.jobId;
    if (handle.created) {
      // Metered + history side effects only when THIS call admitted a new
      // job; a lost-race reattach charges nothing and writes no history.
      await supabase.from('rate_limit_logs').insert({ user_id: user.id, action: 'regenerate_draft' });
      await supabase.from("draft_revisions").insert({
        draft_id: draftId,
        version: currentVersion,
        body: draft.body,
        changes_summary: `Before revision: ${feedback.substring(0, 100)}...`
      });
    }
    }

    // maxWaitMs: bounded proof hook (forces the 202 path); clamped under the
    // edge wall clock.
    const waitMs = Math.max(1, Math.min(Number(maxWaitMs) || 100_000, 110_000));
    const jobResult = await awaitInteractiveJob(supabase, jobId, waitMs);
    if (!jobResult) {
      // baseUpdatedAt + revisionCount let the client apply the finished result
      // with the same compare-and-set this function uses.
      return new Response(
        JSON.stringify({ queued: true, jobId, error: "still_running", baseUpdatedAt: draft.updated_at, revisionCount: currentVersion }),
        { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const result = parseJSON((jobResult as { text: string }).text);

    // CAS on the trigger-maintained updated_at read before the worker ran: a
    // concurrent edit flips it and we refuse instead of overwriting. The
    // finished result stays readable on the job row.
    const { data: casRows } = await supabase.from("drafts").update({
      title: result.title || draft.title,
      body: result.content,
      revision_feedback: feedback,
      revision_count: currentVersion,
    }).eq("id", draftId).eq("updated_at", draft.updated_at).select("id");

    if (!casRows?.length) {
      return new Response(
        JSON.stringify({ error: "draft_changed", message: "Draft changed while the revision ran; the completed revision is retained on the job and was not applied.", jobId }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ success: true, title: result.title || draft.title, content: result.content, revisionCount: currentVersion }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
