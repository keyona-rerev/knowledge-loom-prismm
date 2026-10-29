import { supabase } from "@/integrations/supabase/client";

// Parse a model reply that should be JSON (tolerates code fences / preamble).
export function parseJsonText(text: string): any {
  let content = (text ?? "").trim();
  const fence = content.match(/```(?:\w*)?\s*([\s\S]*?)\s*```/i);
  if (fence) content = fence[1].trim();
  const m = content.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (m) content = m[1];
  return JSON.parse(content);
}

// Invoke an edge function that runs on the Claude subscription queue. The
// function answers 200 with the parsed result, or 202 { queued, jobId } when
// the worker is still running; in that case poll claude-job-status until the
// job completes or fails. Returns the same { data, error } shape as
// supabase.functions.invoke so call sites change minimally.
export async function invokeQueued(
  fn: string,
  body: Record<string, unknown>,
  opts: {
    pollMs?: number; maxPolls?: number;
    resumeJobId?: string;                 // skip the invoke and poll an existing job (durable reattach)
    onJobId?: (jobId: string) => void;    // called as soon as a job handle exists
    raw?: boolean;                        // return the job's whole result object instead of parsed text
  } = {},
): Promise<{ data: any; error: (Error & { stillRunning?: boolean }) | null }> {
  const { pollMs = 5000, maxPolls = 60 } = opts;
  let jobId = opts.resumeJobId;
  if (!jobId) {
    const { data, error } = await supabase.functions.invoke(fn, { body });
    if (error) return { data: null, error };
    if (!(data?.queued && data?.jobId)) return { data, error: null };
    jobId = String(data.jobId);
    opts.onJobId?.(jobId);
  }
  for (let i = 0; i < maxPolls; i++) {
    if (i > 0 || !opts.resumeJobId) await new Promise((r) => setTimeout(r, pollMs));
    const { data: st, error: stErr } = await supabase.functions.invoke(
      `claude-job-status?job_id=${jobId}`, { method: "GET" },
    );
    if (stErr) {
      const status = Number((stErr as any)?.context?.status);
      if (status === 400 || status === 404) {
        return { data: null, error: new Error(status === 404 ? "That job is no longer available." : "The job handle is invalid.") };
      }
      // A status-service failure or expired authentication is not a terminal job.
      // Retain the handle for both newly-enqueued and resumed jobs.
      const err: Error & { stillRunning?: boolean } = new Error(status === 401
        ? "Sign in again before checking this job."
        : "Job status is temporarily unavailable. The job may still be queued or running.");
      err.stillRunning = true;
      return { data: null, error: err };
    }
    if (st?.status === "completed") {
      if (opts.raw) return { data: st.result ?? {}, error: null };
      try {
        return { data: parseJsonText(st?.result?.text ?? ""), error: null };
      } catch {
        return { data: null, error: new Error("The result was completed but unreadable. Please try again.") };
      }
    }
    if (st?.status === "failed") {
      return { data: null, error: new Error(st?.last_error || "worker job failed") };
    }
  }
  const err: Error & { stillRunning?: boolean } = new Error("Still running - check back in a few minutes.");
  err.stillRunning = true;
  return { data: null, error: err };
}
