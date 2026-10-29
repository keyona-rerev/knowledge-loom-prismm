import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { awaitInteractiveJob } from "../_shared/claude-queue.ts";
import {
  DISCOVER_KIND, DISCOVER_SYSTEM, MAX_TARGET, buildDiscoveryPrompt, cleanTopics, parseCandidates, verifyCandidates,
} from "../_shared/discover-candidates.ts";

// Finds candidate source URLs with real public web search, run as an interactive
// job on the Claude subscription queue (claude_jobs). It ONLY returns candidate
// {title, url, reason}; DiscoverSources.tsx feeds each through create-manual-source.
// No provider key, no paid API, no fallback, no model-memory guesses.
// Admission is DB-owned (enqueue_search_job): one open search job per user; a repeat
// call reattaches to it. Candidates are accepted ONLY if their URL appears in the
// worker-extracted verified_urls (from successful WebSearch tool results); otherwise
// the call fails closed. Answers 200 {candidates} or 202 {queued, jobId}.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : []);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Kick the dispatcher scoped to the job we just admitted: the scoped path
// dispatches exactly that job. A bare global kick here would also dispatch
// every other queued job (e.g. a synthetic cron-reserved job) on an organic
// search. The 13:20 UTC cron remains the global backstop.
async function kickDispatcher(jobId?: string) {
  const secret = Deno.env.get("DISPATCHER_SECRET") ?? "";
  if (!secret) return;
  await Promise.race([
    fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/claude-job-redispatch`, {
      method: "POST", headers: { "x-dispatcher-secret": secret, "Content-Type": "application/json" },
      body: JSON.stringify(jobId ? { job_id: jobId } : {}),
    }).catch(() => null),
    new Promise((r) => setTimeout(r, 10000)),
  ]);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authentication required" }, 401);

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const supabaseAuth = createClient(supabaseUrl, serviceRoleKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) return json({ error: "Invalid or expired authentication token" }, 401);
    const userId = user.id;

    const body = await req.json().catch(() => ({}));
    const targetCount = Math.max(1, Math.min(MAX_TARGET, Number(body.targetCount) || 5));
    // excludeUrls is applied LOCALLY after results return; it is never sent to the worker.
    const excludeUrls = arr(body.excludeUrls).slice(0, 400);
    const requestKey = UUID.test(String(body.requestKey ?? "")) ? String(body.requestKey) : crypto.randomUUID();

    const { data: audience } = await supabase.from("audience_profile")
      .select("discovery_topics").eq("user_id", userId).maybeSingle();
    const topics = cleanTopics(audience?.discovery_topics);
    // Unconfigured by default: nothing is searched until the user has deliberately saved public terms.
    if (!topics.length) return json({ error: "Add public search topics on the Discover page before searching." }, 400);
    const prompt = buildDiscoveryPrompt({ topics }, targetCount);

    const { data: adm, error: admErr } = await supabase.rpc("enqueue_search_job", {
      p_user: userId,
      p_request_id: `interactive:search-sources:${userId}:${requestKey}`,
      p_snapshot: { kind: "interactive", interactiveKind: DISCOVER_KIND, prompt, system: DISCOVER_SYSTEM, context: {} },
      p_claim_token: crypto.randomUUID(),
    });
    const row = Array.isArray(adm) ? adm[0] : adm;
    if (admErr || !row?.job_id) return json({ error: "Could not queue the source search" }, 500);
    await kickDispatcher(row.job_id);

    const waitMs = Math.max(1, Math.min(Number(body.maxWaitMs) || 100_000, 110_000));
    const result = await awaitInteractiveJob(supabase, row.job_id, waitMs) as { text?: string; verified_urls?: unknown } | null;
    if (result === null) return json({ queued: true, jobId: row.job_id, reattached: !!row.reused, error: "still_running" }, 202);

    try {
      const candidates = verifyCandidates(parseCandidates(String(result.text ?? ""), excludeUrls), result.verified_urls);
      return json({ success: true, candidates });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : "Could not parse search results" }, 502);
    }
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
