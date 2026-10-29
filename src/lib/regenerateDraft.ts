import { supabase } from "@/integrations/supabase/client";
import { parseJsonText } from "@/lib/invokeQueued";

export type RegenerateResult =
  | { ok: true; title: string; content: string; revisionCount: number }
  | { ok: false; reason: "changed" | "failed" | "unreadable" | "timeout"; message: string };

// Regenerate a draft with reviewer feedback on the Claude subscription queue.
// The edge function answers 200 when the worker finished in time (it applied
// the result itself, guarded by a compare-and-set on drafts.updated_at), or
// 202 { jobId, baseUpdatedAt, revisionCount } when still running. In the 202
// case this polls claude-job-status and applies the result with the SAME
// compare-and-set on the raw baseUpdatedAt string, so a concurrent edit is
// never overwritten.
export async function regenerateWithFeedback(
  draftId: string,
  feedback: string,
  opts: { pollMs?: number; maxPolls?: number; maxWaitMs?: number } = {},
): Promise<RegenerateResult> {
  const { pollMs = 5000, maxPolls = 60, maxWaitMs } = opts;
  const { data, error } = await supabase.functions.invoke("regenerate-draft-with-feedback", {
    body: { draftId, feedback, ...(maxWaitMs ? { maxWaitMs } : {}) },
  });
  if (error) {
    const status = (error as any)?.context?.status;
    return status === 409
      ? { ok: false, reason: "changed", message: "This draft changed while the revision ran - the revision was not applied." }
      : { ok: false, reason: "failed", message: error.message || "unknown error" };
  }
  if (data?.success) return { ok: true, title: data.title, content: data.content, revisionCount: data.revisionCount };
  if (!(data?.queued && data?.jobId)) {
    return { ok: false, reason: "failed", message: data?.error || "unknown error" };
  }

  let result: { title?: string; content?: string } | null = null;
  let unreadable = false;
  for (let i = 0; i < maxPolls; i++) {
    await new Promise((r) => setTimeout(r, pollMs));
    const { data: st } = await supabase.functions.invoke(`claude-job-status?job_id=${data.jobId}`, { method: "GET" });
    if (st?.status === "completed") {
      try { result = parseJsonText(st?.result?.text ?? ""); } catch { unreadable = true; }
      break;
    }
    if (st?.status === "failed") {
      return { ok: false, reason: "failed", message: st?.last_error || "worker job failed" };
    }
  }
  if (!result?.content) {
    return unreadable
      ? { ok: false, reason: "unreadable", message: "The revision finished but the result was unreadable - the draft is unchanged." }
      : { ok: false, reason: "timeout", message: "The revision is still running - check back in a few minutes." };
  }

  const { data: casRows, error: casError } = await supabase
    .from("drafts")
    .update({
      ...(result.title ? { title: result.title } : {}),
      body: result.content,
      revision_feedback: feedback,
      revision_count: data.revisionCount,
    })
    .eq("id", draftId)
    .eq("updated_at", data.baseUpdatedAt)
    .select("id");
  if (casError || !casRows?.length) {
    return { ok: false, reason: "changed", message: "This draft changed while the revision ran - the revision was not applied." };
  }
  return { ok: true, title: result.title ?? "", content: result.content, revisionCount: data.revisionCount };
}
