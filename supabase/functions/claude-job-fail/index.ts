// supabase/functions/claude-job-fail/index.ts - thin adapter over _shared/job-logic.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { failJob, workerSecretOk } from "../_shared/job-logic.ts";
import { makeDb } from "../_shared/supabase-db.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!(await workerSecretOk(Deno.env.get("WORKER_SECRET"), req.headers.get("x-worker-secret"))))
    return json({ error: "unauthorized" }, 401);
  const { job_id, completion_token, error } = await req.json().catch(() => ({}));
  if (!job_id || !completion_token) return json({ error: "missing fields" }, 400);
  const db = makeDb(createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!));
  const r = await failJob(db, { jobId: job_id, completionToken: completion_token, error: String(error ?? "unknown") });
  return json(r.body, r.status);
});
