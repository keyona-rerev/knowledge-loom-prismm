// supabase/functions/_shared/interactive-run.ts
// Shared "run a prompt on the Claude subscription queue" step for stateless
// generation functions. Enqueues a claude_jobs row, waits up to maxWaitMs, and
// returns either the worker's text or a ready-made 202 Response carrying the
// jobId so the client polls claude-job-status. No provider keys, no paid path.
import { enqueueInteractiveJob, awaitInteractiveJob, InteractiveJobArgs } from "./claude-queue.ts";

export type InteractiveOutcome =
  | { done: true; text: string }
  | { done: false; response: Response };

export async function runInteractiveOrQueue(
  supabase: { from(table: string): any },
  args: InteractiveJobArgs,
  corsHeaders: Record<string, string>,
  maxWaitMs?: number,
): Promise<InteractiveOutcome> {
  const { jobId } = await enqueueInteractiveJob(supabase, args);
  // maxWaitMs is a bounded proof hook (forces the 202 path); clamp under the
  // edge wall clock.
  const waitMs = Math.max(1, Math.min(Number(maxWaitMs) || 100_000, 110_000));
  const result = await awaitInteractiveJob(supabase, jobId, waitMs);
  if (result === null) {
    return {
      done: false,
      response: new Response(
        JSON.stringify({ queued: true, jobId, error: "still_running" }),
        { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      ),
    };
  }
  return { done: true, text: String((result as { text?: string }).text ?? "") };
}
