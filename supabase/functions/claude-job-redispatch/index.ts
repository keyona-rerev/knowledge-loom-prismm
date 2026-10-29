// supabase/functions/claude-job-redispatch/index.ts
// Sweep + re-dispatch in one call, shared by fire-due-schedules (cron, via
// x-dispatcher-secret) and the Settings resume action (user JWT, tenant-pinned).
// Holds the ONLY GitHub dispatch credential (DISPATCH_GITHUB_TOKEN, a
// fine-grained PAT scoped Contents:write + Actions:read on the PRIVATE worker repo
// only; repository_dispatch empirically requires Contents:write (verified 2026-10-28).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sweepJobs, markDispatched, workerSecretOk, TENANT } from "../_shared/job-logic.ts";
import { makeDb } from "../_shared/supabase-db.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function hmacSha256Hex(secret: string, raw: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Two callers: the cron dispatcher (shared secret) or the tenant herself (JWT).
  const viaSecret = await workerSecretOk(Deno.env.get("DISPATCHER_SECRET"), req.headers.get("x-dispatcher-secret"));
  if (!viaSecret) {
    const { data: { user } } = await supabase.auth.getUser((req.headers.get("Authorization") ?? "").replace("Bearer ", ""));
    if (!user || user.id !== TENANT) return json({ error: "unauthorized" }, 401);
  }

  const dispatchToken = Deno.env.get("DISPATCH_GITHUB_TOKEN") ?? "";
  const workerRepo = Deno.env.get("WORKER_REPO") ?? ""; // PRIVATE worker repo, e.g. "keyona-rerev/loom-claude-worker"
  const dispatchSecret = Deno.env.get("DISPATCH_SECRET") ?? "";
  if (!dispatchToken || !workerRepo || !dispatchSecret)
    return json({ error: "dispatch not configured" }, 500);

  const db = makeDb(supabase);
  const result = await sweepJobs(db, {});
  let dispatched = 0;
  for (const job of result.dispatch) {
    const ts = Math.floor(Date.now() / 1000);
    const sig = await hmacSha256Hex(dispatchSecret, `${job.job_id}|${job.request_id}|${job.claim_token}|${ts}`);
    const r = await fetch(`https://api.github.com/repos/${workerRepo}/dispatches`, {
      method: "POST",
      headers: { Authorization: `Bearer ${dispatchToken}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify({ event_type: "claude-job", client_payload: { job_id: job.job_id, request_id: job.request_id, claim_token: job.claim_token, ts, sig } }),
    }).catch(() => null);
    // S4: arm last_dispatched_at only on confirmed success; a failed POST stays
    // eligible for the next sweep instead of waiting out the backoff.
    if (r?.ok) { await markDispatched(db, job.job_id); dispatched++; }
  }
  return json({ success: true, requeuedExpired: result.requeuedExpired, dispatched });
});
