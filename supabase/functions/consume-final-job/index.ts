// supabase/functions/consume-final-job/index.ts
// Batch13 (v4.1 contract G4): single-winner consume of a completed
// generate-final-content job into a drafts row. The draft is bound to the
// generation via drafts.generation_job_id (gate-1 column + unique index +
// service-only guard trigger); the unique index is the concurrency settle -
// a double consume collapses onto { created:false } by unique violation.
// Metadata comes ONLY from the trusted input_snapshot (context/binding),
// never re-sent by the client; absent legacy metadata stays NULL (schema
// legal) and is reported as legacy:true, never a 422 by itself.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PENDING_STATUSES, parseJsonPayload } from "../_shared/interactive-bindings.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authentication required" }, 401);

    const supabaseAuth = createClient(supabaseUrl, serviceRoleKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) return json({ error: "Invalid or expired authentication token" }, 401);

    const { jobId } = await req.json();
    if (!jobId) return json({ error: "jobId is required" }, 400);

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: job } = await supabase.from("claude_jobs")
      .select("id, user_id, route, status, result, input_snapshot")
      .eq("id", jobId).maybeSingle();

    // 404: missing, not owned, or not a final-content job (tight surface).
    if (!job || job.user_id !== user.id || job.route !== "generate-final-content") {
      return json({ error: "not_found" }, 404);
    }

    // 409 pending = try-later (incl. paused_auth/paused_quota); failed = strictly terminal.
    if (PENDING_STATUSES.includes(job.status)) return json({ error: "job_pending", reason: "pending", jobId }, 409);
    if (job.status === "failed") return json({ error: "job_failed", reason: "failed", jobId }, 409);
    if (job.status !== "completed") return json({ error: "job_pending", reason: "pending", jobId }, 409);

    // Completed: already-consumed check (silent success).
    const { data: existing } = await supabase.from("drafts")
      .select("id").eq("generation_job_id", jobId).eq("user_id", user.id).maybeSingle();
    if (existing) return json({ draftId: existing.id, created: false });

    // Derive content from the stored result only (P1: JSON inside result.text).
    const text = typeof job.result?.text === "string" ? job.result.text : "";
    let payload: any = null;
    try { payload = parseJsonPayload(text); } catch { payload = null; }
    const title = typeof payload?.title === "string" && payload.title ? payload.title : null;
    const content = typeof payload?.content === "string" && payload.content ? payload.content : null;
    if (!content) return json({ error: "LEGACY_CONTENT_UNDERIVABLE", jobId }, 422);

    // Trusted metadata from the snapshot; absent stays NULL (legacy cue).
    const snap = job.input_snapshot ?? {};
    const ctx = (snap.context ?? {}) as Record<string, unknown>;
    const binding = (snap.binding ?? {}) as Record<string, unknown>;
    const legacy = Object.keys(ctx).length === 0 && !snap.binding;
    const formatId = (ctx.formatId ?? binding.formatId ?? null) as string | null;
    const natureId = (ctx.natureId ?? binding.natureId ?? null) as string | null;
    const strategyJobId = (ctx.strategyJobId ?? binding.strategyJobId ?? null) as string | null;
    const seedCategory = (binding.seedCategory ?? null) as string | null;
    const direction = binding.direction ?? null;

    // Format server-resolved for content_type (never client-supplied).
    let contentType: string | null = null;
    if (formatId) {
      const { data: fmt } = await supabase.from("formats").select("key").eq("id", formatId).maybeSingle();
      contentType = (fmt?.key as string) ?? null;
    }

    const { data: draft, error: insertErr } = await supabase.from("drafts").insert({
      user_id: user.id,
      title,
      seed_insight: title,
      body: content,
      status: "draft",
      seed_category: seedCategory,
      selected_direction: direction ? JSON.stringify(direction) : null,
      content_type: contentType,
      format_id: formatId,
      nature_id: natureId,
      job_id: strategyJobId,
      template_id: null,
      revision_count: 0,
      approval_status: "pending",
      generation_job_id: jobId,
    }).select("id").single();

    if (insertErr) {
      // Unique violation on generation_job_id: a concurrent consume won.
      // Collapse to the silent already-consumed outcome.
      if ((insertErr as { code?: string }).code === "23505") {
        const { data: winner } = await supabase.from("drafts")
          .select("id").eq("generation_job_id", jobId).eq("user_id", user.id).maybeSingle();
        if (winner) return json({ draftId: winner.id, created: false });
      }
      throw insertErr;
    }

    // Notification ONLY on a new consume (lost-response gap accepted, v4.1 G4).
    await supabase.from("email_notifications").insert({
      user_id: user.id, draft_id: draft.id, type: "draft_ready", sent_at: new Date().toISOString(),
    });

    return json({ draftId: draft.id, created: true, ...(legacy ? { legacy: true } : {}) });

  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
