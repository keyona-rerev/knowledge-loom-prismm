// supabase/functions/_shared/claude-queue.ts
// Interactive AI on the Claude subscription: enqueue a prompt job onto
// claude_jobs, kick the signed dispatcher, and await the worker's result.
// This is the subscription replacement for the removed paid-API callAI route.
// No provider keys, no paid endpoint: the private worker repo's GitHub Actions
// run does the Claude work under the owner's Max subscription.

export interface QueueDb {
  from(table: string): any;
}

export interface InteractiveJobArgs {
  userId: string;
  route: string;           // calling function, e.g. "revise-draft"
  kind: string;            // prompt shape, e.g. "revise", "directions", "visual"
  prompt: string;          // user-turn content
  system?: string;         // system prompt
  context?: Record<string, unknown>; // small structured extras for the worker (batch13: trusted strategy/format/nature identity for consume)
  binding?: Record<string, unknown>; // batch13: normalized replay inputs, compared on reattach (409 INPUT_MISMATCH on divergence)
  idempotencyKey?: string; // deterministic retry key; omit for one-shot prompts
  // batch13 cc-key callers (directions/final): NEVER rotate a failed latest
  // generation into :rN - a fresh generation requires a deliberate click with
  // a fresh key. Covers the probe-miss race: same-key job appears AND fails
  // between the route's probe and this insert. Default false preserves the
  // legacy revise/regen deliberate-retry rotation semantics.
  noRotateFailed?: boolean;
}

export interface InteractiveJobHandle { jobId: string; requestId: string; created: boolean; failedLatest?: boolean; }

// Latest generation of a request family (base + :rN retry suffixes), bound to
// the owning user. Callers use this BEFORE metered side effects (rate-limit
// log rows, revision history) so an idempotent reattach never double-charges;
// the enqueue conflict path uses the same owner-bound lookup. Two-digit
// generations order correctly: length first, then lexicographic.
export async function findLatestGeneration(
  supabase: QueueDb, userId: string, requestId: string
): Promise<{ id: string; request_id: string; status: string } | null> {
  const { data: gens } = await supabase.from("claude_jobs")
    .select("id, request_id, status")
    .eq("user_id", userId)
    .or(`request_id.eq.${requestId},request_id.like.${requestId}:r%`);
  return (gens ?? []).sort((a: any, b: any) =>
    a.request_id.length - b.request_id.length || String(a.request_id).localeCompare(String(b.request_id))
  ).pop() ?? null;
}

// Enqueue + dispatch. Idempotent per requestId: a retry returns the same job.
export async function enqueueInteractiveJob(
  supabase: QueueDb, args: InteractiveJobArgs
): Promise<InteractiveJobHandle> {
  const requestId = `interactive:${args.route}:${args.idempotencyKey ?? crypto.randomUUID()}`;
  const snapshot = {
    kind: "interactive",
    interactiveKind: args.kind,
    prompt: args.prompt,
    system: args.system ?? null,
    context: args.context ?? {},
    binding: args.binding ?? null, // null on legacy one-shot callers: reattach-by-key only
  };
  let effectiveRequestId = requestId;
  const { data: job, error } = await supabase.from("claude_jobs").insert({
    user_id: args.userId, route: args.route, request_id: effectiveRequestId,
    status: "queued", path: "interactive", attempt: 0, novelty_retries: 0,
    claim_token: crypto.randomUUID(), input_snapshot: snapshot,
  }).select("id").single();
  if (error) {
    // Unique conflict: a generation of this request already exists. Reattach
    // to the LATEST generation - UNLESS that generation is terminal-failed:
    // replaying a FAILED idempotent job reattaches the caller to a dead
    // result and makes the intent unretryable. The next generation key is
    // deterministic (":r2", ":r3", ...), so concurrent retries of the same
    // generation still collapse onto one job through the same unique key.
    const latest = await findLatestGeneration(supabase, args.userId, requestId);
    if (!latest) throw new Error(`enqueue failed: ${error.message}`);
    if (latest.status !== "failed") return { jobId: latest.id, requestId: latest.request_id, created: false };
    if (args.noRotateFailed) {
      // cc-key replay racing a failed winner: hand the existing terminal
      // identity back; the route answers 409 JOB_FAILED. No new generation,
      // no kick, no side effects - even under the probe-miss race.
      return { jobId: latest.id, requestId: latest.request_id, created: false, failedLatest: true };
    }
    const gen = Number((String(latest.request_id).match(/:r(\d+)$/) ?? [0, "1"])[1]) + 1;
    const retryRequestId = `${requestId}:r${gen}`;
    const { data: retryJob, error: retryErr } = await supabase.from("claude_jobs").insert({
      user_id: args.userId, route: args.route, request_id: retryRequestId,
      status: "queued", path: "interactive", attempt: 0, novelty_retries: 0,
      claim_token: crypto.randomUUID(), input_snapshot: snapshot,
    }).select("id").single();
    if (retryErr) {
      // A concurrent same-generation retry won the key: reattach to its job.
      const { data: retryExisting } = await supabase.from("claude_jobs")
        .select("id, request_id").eq("request_id", retryRequestId).maybeSingle();
      if (retryExisting) return { jobId: retryExisting.id, requestId: retryExisting.request_id, created: false };
      throw new Error(`enqueue retry failed: ${retryErr.message}`);
    }
    const retryKick = Deno.env.get("DISPATCHER_SECRET") ?? "";
    if (retryKick) {
      await Promise.race([
        fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/claude-job-redispatch`, {
          method: "POST",
          headers: { "x-dispatcher-secret": retryKick, "Content-Type": "application/json" },
          body: JSON.stringify({ job_id: retryJob.id }),
        }).catch(() => null),
        new Promise((r) => setTimeout(r, 10000)),
      ]);
    }
    return { jobId: retryJob.id, requestId: retryRequestId, created: true };
  }
  // Kick the dispatcher scoped to THIS job (10s cap, no-op if unconfigured):
  // the scoped path posts the signed repository_dispatch for this job only.
  // A global kick here would dispatch every other queued job along with it;
  // the 13:20 UTC cron sweep remains the global backstop.
  const dispatcherSecret = Deno.env.get("DISPATCHER_SECRET") ?? "";
  if (dispatcherSecret) {
    await Promise.race([
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/claude-job-redispatch`, {
        method: "POST",
        headers: { "x-dispatcher-secret": dispatcherSecret, "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: job.id }),
      }).catch(() => null),
      new Promise((r) => setTimeout(r, 10000)),
    ]);
  }
  return { jobId: job.id, requestId, created: true };
}

// Poll for completion. Returns the worker's result payload, or null on
// timeout (caller may then hand the jobId to the client for status polling).
export async function awaitInteractiveJob(
  supabase: QueueDb, jobId: string, timeoutMs = 100_000, intervalMs = 4_000
  // NOTE: timeout must stay well under the ~150s edge-function wall clock;
  // on timeout the caller returns 202 + jobId and the client polls
  // claude-job-status?job_id=, so the job is never dropped without a handle.
): Promise<unknown | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data: job } = await supabase.from("claude_jobs")
      .select("status, result, last_error").eq("id", jobId).single();
    if (job?.status === "completed") return job.result ?? null;
    if (job?.status === "failed") throw new Error(job.last_error ?? "worker job failed");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}
