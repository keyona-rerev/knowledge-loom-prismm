// supabase/functions/claude-job-status/index.ts
// Tenant-facing worker status for the Settings operating record (S6).
// Tenant-JWT only; returns the full truthful picture, never secrets.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { TENANT } from "../_shared/job-logic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  // Browser polls this from the app origin (202 revise flow); without a
  // preflight answer the poll never reaches the function.
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: { user }, error: authError } = await supabase.auth.getUser((req.headers.get("Authorization") ?? "").replace("Bearer ", ""));
  if (authError || !user || user.id !== TENANT) return json({ error: "unauthorized" }, 401);

  // Per-job read for the interactive 202 flow: tenant can poll one job's
  // status and, for interactive jobs only, the worker's result payload.
  // Draft-generating jobs never expose input/output here, only status.
  const url = new URL(req.url);
  const jobId = url.searchParams.get("job_id");
  if (jobId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) return json({ error: "invalid job_id" }, 400);
    const { data: job, error } = await supabase.from("claude_jobs")
      .select("id, path, status, result, last_error, updated_at")
      .eq("id", jobId).eq("user_id", user.id).maybeSingle();
    if (error) return json({ error: "job status unavailable" }, 503);
    if (!job) return json({ error: "not found" }, 404);
    const body: Record<string, unknown> = { id: job.id, status: job.status, last_error: job.last_error, updated_at: job.updated_at };
    if (job.path === "interactive" && job.status === "completed") body.result = job.result;
    return json(body);
  }

  const { data: jobs, error: jobsError } = await supabase.from("claude_jobs")
    .select("id, status, run_url, last_error, updated_at").eq("user_id", user.id).order("updated_at", { ascending: false }).limit(200);
  if (jobsError) return json({ error: "queue status unavailable" }, 503);
  const all = jobs ?? [];
  const counts: Record<string, number> = {};
  for (const j of all) counts[j.status] = (counts[j.status] ?? 0) + 1;
  const lastRun = all.find((j) => j.status === "completed" || j.status === "failed") ?? null;
  const recoveries = all.filter((j) => (j.last_error ?? "").startsWith("recovered;")).length;

  return json({
    mode: "claude_code", // drafts are written by the subscription worker; visual/search routes unchanged on their existing adapter state
    queue: counts,
    lastRun: lastRun ? { status: lastRun.status, run_url: lastRun.run_url, at: lastRun.updated_at } : null,
    recoveries,
    worker: {
      repo: Deno.env.get("WORKER_REPO") ?? null,           // private repo name only, never secrets
      token_label: "CLAUDE_CODE_OAUTH_TOKEN",              // label, never the value
      token_expires_at: Deno.env.get("WORKER_TOKEN_EXPIRES_AT") ?? null, // set when the token is minted (1-year OAuth token lifetime)
    },
  });
  } catch {
    return json({ error: "job status unavailable" }, 503);
  }
});
