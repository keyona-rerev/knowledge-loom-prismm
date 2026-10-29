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
  context?: Record<string, unknown>; // small structured extras for the worker
}

export interface InteractiveJobHandle { jobId: string; requestId: string; }

// Enqueue + dispatch. Idempotent per requestId: a retry returns the same job.
export async function enqueueInteractiveJob(
  supabase: QueueDb, args: InteractiveJobArgs
): Promise<InteractiveJobHandle> {
  const requestId = `interactive:${args.route}:${crypto.randomUUID()}`;
  const snapshot = {
    kind: "interactive",
    interactiveKind: args.kind,
    prompt: args.prompt,
    system: args.system ?? null,
    context: args.context ?? {},
  };
  const { data: job, error } = await supabase.from("claude_jobs").insert({
    user_id: args.userId, route: args.route, request_id: requestId,
    status: "queued", path: "interactive", attempt: 0, novelty_retries: 0,
    claim_token: crypto.randomUUID(), input_snapshot: snapshot,
  }).select("id").single();
  if (error) {
    // Unique conflict = same request already queued; return the existing row.
    const { data: existing } = await supabase.from("claude_jobs")
      .select("id, request_id").eq("request_id", requestId).maybeSingle();
    if (existing) return { jobId: existing.id, requestId: existing.request_id };
    throw new Error(`enqueue failed: ${error.message}`);
  }
  // Kick the dispatcher (10s cap, no-op if unconfigured): sweeps and posts the
  // signed repository_dispatch for every queued job, this one included.
  const dispatcherSecret = Deno.env.get("DISPATCHER_SECRET") ?? "";
  if (dispatcherSecret) {
    await Promise.race([
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/claude-job-redispatch`, {
        method: "POST",
        headers: { "x-dispatcher-secret": dispatcherSecret, "Content-Type": "application/json" },
        body: "{}",
      }).catch(() => null),
      new Promise((r) => setTimeout(r, 10000)),
    ]);
  }
  return { jobId: job.id, requestId };
}

// Poll for completion. Returns the worker's result payload, or null on
// timeout (caller may then hand the jobId to the client for status polling).
export async function awaitInteractiveJob(
  supabase: QueueDb, jobId: string, timeoutMs = 240_000, intervalMs = 4_000
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
