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
  opts: { pollMs?: number; maxPolls?: number } = {},
): Promise<{ data: any; error: Error | null }> {
  const { pollMs = 5000, maxPolls = 60 } = opts;
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) return { data: null, error };
  if (!(data?.queued && data?.jobId)) return { data, error: null };
  for (let i = 0; i < maxPolls; i++) {
    await new Promise((r) => setTimeout(r, pollMs));
    const { data: st } = await supabase.functions.invoke(
      `claude-job-status?job_id=${data.jobId}`, { method: "GET" },
    );
    if (st?.status === "completed") {
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
  return { data: null, error: new Error("Still running - check back in a few minutes.") };
}
