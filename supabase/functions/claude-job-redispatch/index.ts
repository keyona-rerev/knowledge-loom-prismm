// supabase/functions/claude-job-redispatch/index.ts
// Sweep + re-dispatch in one call, shared by fire-due-schedules (cron, via
// x-dispatcher-secret) and the Settings resume action (user JWT, tenant-pinned).
// Holds the ONLY GitHub dispatch credential (DISPATCH_GITHUB_TOKEN, a
// fine-grained PAT scoped Contents:write + Actions:read on the PRIVATE worker repo
// only; repository_dispatch empirically requires Contents:write (verified 2026-10-28).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sweepJobs, markDispatched, workerSecretOk, TENANT, PROOF_ROUTE, isProofJob, hasProofMarker } from "../_shared/job-logic.ts";
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

  // Scoped single-job dispatch: POST { "job_id": "<uuid>" }. Honored on both
  // auth paths - the server-side enqueue kicks (search-sources,
  // _shared/claude-queue.ts) authenticate with the shared secret and must not
  // global-sweep every other queued job (an organic search enqueue used to
  // dispatch the unrelated synthetic cron job early); the tenant JWT path is
  // pinned to TENANT above. The pre-read below exists only for precise error
  // classification. The authoritative guard is the single atomic UPDATE:
  // Postgres row-lock serializes concurrent rotations, so exactly one caller
  // can match the predicates and POST - status='queued' alone would NOT be a
  // one-winner guard, because every rotation keeps status 'queued'.
  let scopedJobId: string | null = null;
  let requestedEvent: unknown = undefined;
  try {
    const b = await req.json();
    if (b && typeof b.job_id === "string") scopedJobId = b.job_id;
    if (b && "event_type" in b) requestedEvent = b.event_type;
  } catch { scopedJobId = null; }
  // An event_type is honored only on the shared-secret path, only for the one
  // allowlisted value, and only for a marked synthetic proof job. Anything else
  // is refused (the tenant JWT path never gets it); no event_type keeps the
  // exact "claude-job" behavior below.
  if (requestedEvent !== undefined && (!viaSecret || !scopedJobId || requestedEvent !== PROOF_ROUTE))
    return json({ error: "event_type not permitted" }, 403);

  if (scopedJobId) {
    const { data: job } = await supabase.from("claude_jobs")
      .select("id, user_id, status, request_id, claim_token, last_dispatched_at, attempt, input_snapshot")
      .eq("id", scopedJobId).maybeSingle();
    if (!job) return json({ error: "not found" }, 404);
    if (job.user_id !== TENANT) return json({ error: "forbidden" }, 403);
    if (job.status !== "queued") return json({ error: "not dispatchable", status: job.status }, 409);
    // Proof jobs: only via the secret path WITH the allowlisted event type, only at
    // attempt=2 (so no failure/expiry/quota path can ever re-queue them). Every
    // other route, including a plain scoped call or Settings resume, is refused.
    if (hasProofMarker(job) || requestedEvent !== undefined) {
      if (!viaSecret || requestedEvent !== PROOF_ROUTE || !isProofJob(job) || job.attempt !== 2)
        return json({ error: "proof job not dispatchable on this route" }, 403);
    }
    const backoffMs = 15 * 60 * 1000;
    if (job.last_dispatched_at && Date.now() - new Date(job.last_dispatched_at).getTime() < backoffMs) {
      return json({ error: "dispatch backoff", last_dispatched_at: job.last_dispatched_at }, 409);
    }
    // Atomic rotation + marker arming in one statement. The loser of a
    // concurrent pair re-evaluates these predicates against the winner's
    // committed marker and matches 0 rows, so no second dispatch is posted.
    const fresh = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const cutoffIso = new Date(Date.now() - backoffMs).toISOString();
    const { data: won } = await supabase.from("claude_jobs")
      .update({ claim_token: fresh, last_dispatched_at: nowIso })
      .eq("id", job.id)
      .eq("user_id", TENANT)
      .eq("status", "queued")
      .or(`last_dispatched_at.is.null,last_dispatched_at.lt.${cutoffIso}`)
      .select("id");
    if (!won?.length) return json({ error: "concurrent dispatch in progress", dispatched: 0 }, 409);
    const ts = Math.floor(Date.now() / 1000);
    const sig = await hmacSha256Hex(dispatchSecret, `${job.id}|${job.request_id}|${fresh}|${ts}`);
    const r = await fetch(`https://api.github.com/repos/${workerRepo}/dispatches`, {
      method: "POST",
      headers: { Authorization: `Bearer ${dispatchToken}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify({ event_type: requestedEvent === PROOF_ROUTE ? PROOF_ROUTE : "claude-job", client_payload: { job_id: job.id, request_id: job.request_id, claim_token: fresh, ts, sig } }),
    }).catch(() => null);
    if (!r?.ok) {
      // S4 preserved: a lost POST must not strand the job behind the backoff.
      // Reset only OUR marker (keyed on the token we just rotated in and still
      // queued), so a concurrent winner or an in-flight claim is never
      // clobbered; the next scoped call or the cron sweep retries immediately.
      await supabase.from("claude_jobs").update({ last_dispatched_at: null })
        .eq("id", job.id).eq("claim_token", fresh).eq("status", "queued");
      return json({ error: "dispatch post failed; job stays queued for retry", dispatched: 0 }, 502);
    }
    return json({ success: true, dispatched: 1, job_id: job.id });
  }

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
