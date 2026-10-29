// supabase/functions/claude-job-status/index.ts
// Tenant-facing worker status for the Settings operating record (S6).
// Tenant-JWT only; returns the full truthful picture, never secrets.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { TENANT } from "../_shared/job-logic.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

serve(async (req) => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: { user } } = await supabase.auth.getUser((req.headers.get("Authorization") ?? "").replace("Bearer ", ""));
  if (!user || user.id !== TENANT) return json({ error: "unauthorized" }, 401);

  const { data: jobs } = await supabase.from("claude_jobs")
    .select("id, status, run_url, last_error, updated_at").order("updated_at", { ascending: false }).limit(200);
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
});
