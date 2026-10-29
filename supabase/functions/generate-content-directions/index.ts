import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enqueueInteractiveJob, awaitInteractiveJob, findLatestGeneration } from "../_shared/claude-queue.ts";
import { PENDING_STATUSES, bindingsEqual, isUuid, parseJsonPayload } from "../_shared/interactive-bindings.ts";
import { loadStrategyContext, buildContextBlock, buildSystemPrompt } from "../_shared/strategy-context.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ROUTE = "generate-content-directions";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Authentication required" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabaseAuth = createClient(supabaseUrl, serviceRoleKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) return new Response(JSON.stringify({ error: "Invalid or expired authentication token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    // jobId on the wire is the STRATEGY selection id (legacy field feeding
    // loadStrategyContext), distinct from any claude_jobs generation id.
    const { seedInsight, seedCategory, formatId, natureId, jobId, requestKey, maxWaitMs } = await req.json();
    const strategyJobId = jobId ?? null;

    if (!seedInsight) return new Response(JSON.stringify({ error: "seedInsight is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Admission validation (before any queue write): id fields must be
    // UUID-shaped when present so snapshot metadata is coherent.
    for (const [name, v] of [["formatId", formatId], ["natureId", natureId], ["jobId", jobId]] as const) {
      if (v !== undefined && v !== null && !isUuid(v)) {
        return new Response(JSON.stringify({ error: `${name} must be a UUID` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // v4.1 G3: normalized replay binding (directions route set).
    const binding = {
      seedInsight, seedCategory: seedCategory ?? null,
      formatId: formatId ?? null, natureId: natureId ?? null,
      strategyJobId,
    };
    const ccKey = requestKey ? `cc:${user.id}:${String(requestKey)}` : undefined;

    // Reattach probe BEFORE any generation work or side effects (v4.1 G2/G3).
    if (ccKey) {
      const latest = await findLatestGeneration(supabase, user.id, `interactive:${ROUTE}:${ccKey}`);
      if (latest) {
        const { data: job } = await supabase.from("claude_jobs").select("id, status, result, input_snapshot").eq("id", latest.id).single();
        const stored = job?.input_snapshot?.binding ?? null;
        // null stored binding = legacy job: reattach by key only (contract gap, accepted).
        if (stored && !bindingsEqual(stored, binding)) {
          return new Response(JSON.stringify({ error: "INPUT_MISMATCH", jobId: latest.id }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        if (PENDING_STATUSES.includes(job?.status)) {
          return new Response(JSON.stringify({ queued: true, jobId: latest.id, error: "still_running" }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        if (job?.status === "completed") {
          const text = String(job.result?.text ?? "");
          return new Response(JSON.stringify({ ...parseJsonPayload(text), jobId: latest.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        // failed latest on a cc-key replay: EXPLICIT TERMINAL, never a silent
        // :rN rotation (v4.1 G2 - a fresh generation requires a deliberate
        // click carrying a FRESH requestKey; the UI marks the handle terminal
        // and preserves the inputs).
        if (job?.status === "failed") {
          return new Response(JSON.stringify({ error: "JOB_FAILED", reason: "failed", jobId: latest.id }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }
    }

    const { ctx, hardRules, voiceRules, inlineAttribution } = await loadStrategyContext(supabase, user.id, { formatId, natureId, jobId });
    const strategyBlock = buildContextBlock(ctx);

    const { data: cards } = await supabase
      .from("reference_cards")
      .select("title, ai_summary")
      .eq("user_id", user.id)
      .eq("status", "active")
      .not("ai_summary", "is", null)
      .limit(10);

    const contextCards = cards?.map(c => `${c.title}: ${c.ai_summary}`).join('\n\n') || "No reference cards available";

    const prompt = `Based on this seed insight and reference materials, generate 4 distinct content directions.

Seed Insight: ${seedInsight}
Category: ${seedCategory}

${strategyBlock}
Reference Materials:
${contextCards}

Generate 4 unique angles for developing this insight into content. Each should have a compelling title, 2-3 sentence description, and unique angle.

Respond ONLY with valid JSON:
{"directions": [{"title": "...", "description": "...", "angle": "..."}, ...]}`;

    const SYSTEM = buildSystemPrompt(
      "You are a creative content strategist. Always respond with valid JSON only, no markdown.",
      hardRules, voiceRules, inlineAttribution
    );

    const handle = await enqueueInteractiveJob(supabase, {
      userId: user.id, route: ROUTE, kind: "directions", prompt, system: SYSTEM,
      context: { formatId: formatId ?? null, natureId: natureId ?? null, strategyJobId },
      binding,
      idempotencyKey: ccKey,
      noRotateFailed: !!ccKey,
    });
    // Probe-miss race: a same-key generation appeared AND failed between the
    // probe above and this insert. Same explicit terminal as the probe path.
    if (handle.failedLatest) {
      return new Response(JSON.stringify({ error: "JOB_FAILED", reason: "failed", jobId: handle.jobId }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const waitMs = Math.max(1, Math.min(Number(maxWaitMs) || 100_000, 110_000));
    const result = await awaitInteractiveJob(supabase, handle.jobId, waitMs);
    if (result === null) {
      return new Response(JSON.stringify({ queued: true, jobId: handle.jobId, error: "still_running" }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const parsed = parseJsonPayload(String((result as { text?: string }).text ?? ""));
    return new Response(JSON.stringify({ ...parsed, jobId: handle.jobId }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
