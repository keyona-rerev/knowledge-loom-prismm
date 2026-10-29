// An accepted queue job is not a generated draft. A duplicate can already be terminal.
export type GenerationOutcome = { kind: "queued" | "pending" | "completed" | "failed" | "unknown"; drafts: number; jobId?: string };
export function generationOutcome(data: any): GenerationOutcome {
  if (data?.error || data?.jobStatus === "failed") return { kind: "failed", drafts: 0, jobId: data?.jobId };
  if (data?.queued && data?.jobId) {
    if (data.jobStatus === "completed") return { kind: "completed", drafts: 0, jobId: data.jobId };
    return { kind: data.duplicate ? "pending" : "queued", drafts: 0, jobId: data.jobId };
  }
  if (Number.isInteger(data?.draftsCreated) && data.draftsCreated >= 0) return { kind: "completed", drafts: data.draftsCreated };
  return { kind: "unknown", drafts: 0 };
}
