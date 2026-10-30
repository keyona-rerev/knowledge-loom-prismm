import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enqueueInteractiveJob, awaitInteractiveJob, findLatestGeneration } from "../_shared/claude-queue.ts";
import { PENDING_STATUSES, bindingsEqual, isUuid, normalizeCardIds, parseJsonPayload } from "../_shared/interactive-bindings.ts";
import { formatFitsPlatform, feedPlatform } from "../_shared/publisher/platform-rules.ts";
import { loadStrategyContext, buildContextBlock, buildSystemPrompt } from "../_shared/strategy-context.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ROUTE = "generate-final-content";

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
    // jobId on the wire is the STRATEGY selection id (legacy field feeding
    // loadStrategyContext), distinct from any claude_jobs generation id.
    const { direction, seedInsight, seedCategory, insightCardIds, formatId, natureId, jobId, requestKey, maxWaitMs } = await req.json();
    const strategyJobId = jobId ?? null;

    if (!direction || !seedInsight) return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Admission validation (before any queue write): id fields must be
    // UUID-shaped when present so snapshot metadata is coherent.
    for (const [name, v] of [["formatId", formatId], ["natureId", natureId], ["jobId", jobId]] as const) {
      if (v !== undefined && v !== null && !isUuid(v)) {
        return new Response(JSON.stringify({ error: `${name} must be a UUID` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }
    if (insightCardIds !== undefined && insightCardIds !== null) {
      if (!Array.isArray(insightCardIds) || insightCardIds.some((c) => !isUuid(c))) {
        return new Response(JSON.stringify({ error: "insightCardIds must be UUIDs" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // v4.1 G3: normalized replay binding (final route set; insightCardIds as
    // an order-insensitive set; direction full object, final-route only).
    const binding = {
      direction, seedInsight, seedCategory: seedCategory ?? null,
      formatId: formatId ?? null, natureId: natureId ?? null,
      insightCardIds: normalizeCardIds(insightCardIds),
      strategyJobId,
    };
    const ccKey = requestKey ? `cc:${user.id}:${String(requestKey)}` : undefined;

    // Reattach probe BEFORE rate side effects (v4.1 G2/G3 + keying section):
    // live/completed reattach bypasses the rate charge entirely.
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

    // Rate limiting - CREATE path only, and the log row lands only when the
    // enqueue actually creates a generation (created flag, batch12 pattern).
    const windowStart = new Date();
    windowStart.setMinutes(windowStart.getMinutes() - 60);
    const { count: rateCount } = await supabase.from('rate_limit_logs').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('action', 'generate_final').gte('created_at', windowStart.toISOString());
    if ((rateCount || 0) >= 100) return new Response(JSON.stringify({ error: 'Rate limit exceeded.' }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { ctx, hardRules, voiceRules, inlineAttribution } = await loadStrategyContext(supabase, user.id, { formatId, natureId, jobId });

    // A format whose declared minimum length cannot fit its platform's limit
    // would produce a draft that can never publish. Refuse before queuing.
    if (ctx.format) {
      const fit = formatFitsPlatform(ctx.format, feedPlatform(ctx.format.platform));
      if (!fit.fits)
        return new Response(JSON.stringify({ error: "format_exceeds_platform_limit", format: ctx.format.name,
          estimated_min_chars: fit.estimatedMinChars, platform_max_chars: fit.maxChars }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const strategyBlock = buildContextBlock(ctx);

    let insightContext = "";
    if (insightCardIds?.length) {
      const { data: cards } = await supabase.from("insight_cards").select("title, content").in("id", insightCardIds).eq("user_id", user.id);
      if (cards?.length) {
        insightContext = "\n\nRELEVANT INSIGHTS:\n";
        cards.forEach((c: { title: string; content: string }) => { insightContext += `- ${c.title}: ${c.content}\n`; });
      }
    }

    const prompt = `Generate full content based on this direction.

Direction: ${JSON.stringify(direction)}
Seed Insight: ${seedInsight}
Category: ${seedCategory || "General"}

${strategyBlock}${insightContext}

Create comprehensive, publication-ready content. Engaging title, clear structure, professional quality.

Respond ONLY with valid JSON: {"title": "...", "content": "full markdown content"}`;

    const SYSTEM = buildSystemPrompt(
      "You are a professional content writer. Always respond with valid JSON only.",
      hardRules, voiceRules, inlineAttribution
    );

    const handle = await enqueueInteractiveJob(supabase, {
      userId: user.id, route: ROUTE, kind: "final_content", prompt, system: SYSTEM,
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
    if (handle.created) {
      await supabase.from('rate_limit_logs').insert({ user_id: user.id, action: 'generate_final' });
    }
    const waitMs = Math.max(1, Math.min(Number(maxWaitMs) || 100_000, 110_000));
    const result = await awaitInteractiveJob(supabase, handle.jobId, waitMs);
    if (result === null) {
      return new Response(JSON.stringify({ queued: true, jobId: handle.jobId, error: "still_running" }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const parsed = parseJsonPayload(String((result as { text?: string }).text ?? ""));
    return new Response(JSON.stringify({ ...parsed, jobId: handle.jobId }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
