// supabase/functions/_shared/job-logic.ts
// All claude_jobs state transitions, over a minimal Db interface so the logic
// is executable and testable outside Deno/Supabase. The index.ts adapters are
// thin translations from supabase-js to this interface.
import { findCollision, collisionVerdict, type NoveltyWindowRow } from "./_shared-novelty.ts";
import { writeDraftsFromSnapshot, type SnapshotCtx, type DraftOutput } from "./_shared-draft-writer.ts";

export interface Db {
  getJob(id: string): Promise<any | null>;
  // Atomic conditional update: applies fields only if every filter key still
  // equals its value; returns the updated row or null (0 rows matched).
  updateJobWhere(id: string, filter: Record<string, unknown>, fields: Record<string, unknown>): Promise<any | null>;
  listJobsWhere(filter: Record<string, unknown>): Promise<any[]>;
  insertJob(row: Record<string, unknown>): Promise<any>;
  // Conflict-skips on drafts.worker_request_id (request_id + ':' + item index):
  // returns existed=true when the row was already written by an earlier attempt,
  // so callers skip that item's side effects (R1).
  insertDraft(row: Record<string, unknown>): Promise<{ id: string; existed: boolean }>;
  updateDraft(id: string, fields: Record<string, unknown>): Promise<void>;
  updateSeed(id: string, fields: Record<string, unknown>): Promise<void>;
  updateCard(id: string, fields: Record<string, unknown>): Promise<void>;
  recentDrafts(userId: string, sinceIso: string): Promise<NoveltyWindowRow[]>;
  notify(draftId: string): Promise<void>;
}

// Tenant pinning reads from env, fail-closed: an unset/empty TENANT_USER_ID
// makes every tenant check fail (no real UUID ever equals ""), never permissive.
export const TENANT = Deno.env.get("TENANT_USER_ID") ?? "";

// F5: constant-time compare via sha256, and a hard assert that the configured
// secret is present and non-empty (empty header + empty secret must NOT pass).
export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function workerSecretOk(configured: string | undefined, presented: string | null): Promise<boolean> {
  if (!configured || configured.length === 0) return false; // fail closed, loudly misconfigured
  if (!presented || presented.length === 0) return false;
  return (await sha256Hex(configured)) === (await sha256Hex(presented));
}

const uuid = () => crypto.randomUUID();

// ---------------------------------------------------------------------------
// CLAIM. One atomic conditional update: matches only a queued row with this
// claim_token, and in the same write sets claimed fields, clears claim_token
// (F1: consumed, never reusable), and stores the HASH of a fresh single-use
// completion token. The plaintext completion token exists only in this
// response. No two-step gap: a crash mid-claim leaves the row queued.
// ---------------------------------------------------------------------------
export async function claimJob(db: Db, args: {
  jobId: string; claimToken: string; workerId: string; now?: Date; claimTtlMin?: number;
}): Promise<{ status: number; body: any }> {
  const now = args.now ?? new Date();
  const ttl = args.claimTtlMin ?? 15;
  const job = await db.getJob(args.jobId);
  if (!job) return { status: 404, body: { error: "unknown job" } };
  if (job.user_id !== TENANT) return { status: 403, body: { error: "wrong tenant" } };

  const completionToken = uuid();
  const updated = await db.updateJobWhere(args.jobId,
    { status: "queued", claim_token: args.claimToken },
    { status: "claimed", claimed_by: args.workerId, claimed_at: now.toISOString(),
      claim_expires_at: new Date(now.getTime() + ttl * 60000).toISOString(),
      claim_token: null, completion_token_hash: await sha256Hex(completionToken),
      last_dispatched_at: null, // consumed: the dispatch that led here is done
      updated_at: now.toISOString() });
  if (!updated) return { status: 409, body: { error: "not claimable" } };
  return { status: 200, body: {
    job_id: args.jobId, completion_token: completionToken,
    claim_expires_at: updated.claim_expires_at, input_snapshot: updated.input_snapshot,
  } };
}

// ---------------------------------------------------------------------------
// Output schema, pinned (F3): the ONE shape the worker prompt demands, the
// contract documents, and this endpoint validates. Extra keys rejected.
// ---------------------------------------------------------------------------
const OUTPUT_KEYS = new Set(["title", "body", "angle_used", "stat_attributions"]);
const ATTR_KEYS = new Set(["figure", "source", "card_id"]);

export function validateOutput(output: unknown, allowedCardIds: Set<string>): string | null {
  const items = Array.isArray(output) ? output : [output];
  if (items.length === 0 || items.length > 4) return "output must be 1-4 items";
  for (const o of items) {
    if (!o || typeof o !== "object" || Array.isArray(o)) return "item not an object";
    for (const k of Object.keys(o as object)) if (!OUTPUT_KEYS.has(k)) return `unexpected key: ${k}`;
    const it = o as any;
    if (typeof it.title !== "string" || !it.title.trim()) return "output missing title";
    if (typeof it.body !== "string" || !it.body.trim()) return "output missing body";
    if (it.body.length > 20000) return "body oversized";
    if (it.angle_used !== undefined && typeof it.angle_used !== "string") return "angle_used not a string";
    if (it.stat_attributions !== undefined) {
      if (!Array.isArray(it.stat_attributions)) return "stat_attributions not an array";
      for (const a of it.stat_attributions) {
        if (!a || typeof a !== "object") return "stat_attribution not an object";
        for (const k of Object.keys(a)) if (!ATTR_KEYS.has(k)) return `unexpected attribution key: ${k}`;
        if (a.card_id && !allowedCardIds.has(a.card_id)) return "citation outside snapshot";
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// COMPLETE. B7 fix: the claim is consumed BEFORE any draft write by an atomic
// 'claimed' -> 'completing' transition keyed on the token hash. A retry after
// a partial failure sees 'completing' and gets 409 - it can never double-write
// drafts. A crash mid-write is recovered by the sweeper (below), never retried
// blind. F2: novelty re-check runs against LIVE recent drafts at completion
// time, not the frozen enqueue window. Novelty collision requeues once, then
// fails honestly; requeues clear claim_token so the sweep re-dispatch rotates
// a fresh one (F1).
// ---------------------------------------------------------------------------
export async function completeJob(db: Db, args: {
  jobId: string; completionToken: string; output: unknown; runUrl?: string;
  now?: Date; noveltyWindowDays?: number;
}): Promise<{ status: number; body: any }> {
  const now = args.now ?? new Date();
  const job = await db.getJob(args.jobId);
  if (!job) return { status: 404, body: { error: "unknown job" } };
  if (job.user_id !== TENANT) return { status: 403, body: { error: "wrong tenant" } };
  const tokenHash = await sha256Hex(args.completionToken);

  // S2: verify the ORIGINAL claim expiry BEFORE consuming - the consume below
  // extends the window for the completing phase, so checking after would be
  // dead code. An expired claim is failed honestly, never consumed.
  if (job.status === "claimed" && job.claim_expires_at && new Date(job.claim_expires_at) < now) {
    await db.updateJobWhere(args.jobId, { status: "claimed" },
      { status: "failed", last_error: "claim expired before completion", completion_token_hash: null, updated_at: now.toISOString() });
    return { status: 409, body: { error: "claim expired" } };
  }

  // Atomic consume: exactly one caller can move claimed -> completing.
  // The completing phase gets its own fresh 10-minute window; the sweeper only
  // touches jobs past expiry, so a healthy completion is never requeued mid-write.
  const claimed = await db.updateJobWhere(args.jobId,
    { status: "claimed", completion_token_hash: tokenHash },
    { status: "completing",
      claim_expires_at: new Date(now.getTime() + 10 * 60000).toISOString(),
      updated_at: now.toISOString() });
  if (!claimed) return { status: 409, body: { error: "not completable" } };
  const snap = claimed.input_snapshot as SnapshotCtx & { chosenCardIds?: string[] };
  const shapeErr = validateOutput(args.output, new Set(snap.chosenCardIds ?? []));
  if (shapeErr) {
    await db.updateJobWhere(args.jobId, { status: "completing" },
      { status: "failed", last_error: `output validation: ${shapeErr}`, completion_token_hash: null, updated_at: now.toISOString() });
    return { status: 422, body: { error: shapeErr } };
  }
  const items = (Array.isArray(args.output) ? args.output : [args.output]) as DraftOutput[];

  // F2: live novelty window at completion time (body included - F8).
  const since = new Date(now.getTime() - (args.noveltyWindowDays ?? 30) * 86400000).toISOString();
  const windowRows = await db.recentDrafts(claimed.user_id, since);
  for (const o of items) {
    const v = collisionVerdict(findCollision(o, windowRows), claimed.novelty_retries ?? 0);
    if (v.action === "requeue") {
      await db.updateJobWhere(args.jobId, { status: "completing" },
        { status: "queued", claimed_by: null, completion_token_hash: null, claim_token: null,
          novelty_retries: (claimed.novelty_retries ?? 0) + 1, last_error: v.reason, updated_at: now.toISOString() });
      return { status: 422, body: { success: false, requeued: true, reason: v.reason } };
    }
    if (v.action === "fail") {
      await db.updateJobWhere(args.jobId, { status: "completing" },
        { status: "failed", completion_token_hash: null, last_error: v.reason, updated_at: now.toISOString() });
      return { status: 422, body: { error: v.reason } };
    }
  }

  // Draft writes + the same side effects as the in-app path. Each item carries
  // a persistent worker_request_id (request_id + ':' + index); a retried
  // completion after a crash conflict-skips rows already written and skips
  // their side effects, so recovery never double-writes (R1).
  let result;
  try {
    result = await writeDraftsFromSnapshot(db, snap, items, claimed.request_id);
  } catch (e) {
    // Compensation: the job is honestly failed, not silently retried into a
    // duplicate; the sweeper surfaces it for review.
    await db.updateJobWhere(args.jobId, { status: "completing" },
      { status: "failed", last_error: `draft write failed: ${(e as Error).message}`, completion_token_hash: null, updated_at: new Date().toISOString() });
    return { status: 500, body: { error: "draft write failed" } };
  }

  // PATH B child enqueue when the slot requires it (B6 fix): the child prompt
  // needs the parent's real title/body, which only exist now.
  let childJobId: string | null = null;
  if (snap.path === "B" && snap.requiresChild && result.parentDraftId) {
    const childSnap: SnapshotCtx = { ...snap, path: "B-child", reuseParentId: result.parentDraftId,
      parentTitle: result.parentTitle, parentBody: result.parentBody } as SnapshotCtx;
    try {
      const child = await db.insertJob({
        user_id: claimed.user_id, request_id: `${claimed.request_id}:child`,
        status: "queued", path: "B-child", input_snapshot: childSnap,
        attempt: 0, novelty_retries: 0, created_at: now.toISOString(), updated_at: now.toISOString(),
      });
      childJobId = child.id;
    } catch (e) {
      // request_id unique conflict = child already enqueued by an earlier attempt.
      if (!isUniqueViolation(e)) throw e;
    }
  }

  // W1/W2: recovery is at-most-once for side effects by design (conflict-skip).
  // When rows pre-existed, stamp a VISIBLE recovery note on the job so Settings
  // can warn "recovered; side effects skipped for pre-existing rows" instead of
  // pretending the run was clean. A durable side-effect ledger is the preferred
  // fix at scale; documented in the operating record.
  const recoveredCount = result.draftIds.length - result.insertedIds.length;
  const recoveryNote = recoveredCount > 0
    ? `recovered; side effects skipped for ${recoveredCount} pre-existing row(s)` : null;

  // Final transition is a checked CAS: if the row is no longer 'completing'
  // (e.g. a sweep raced us), report 409 instead of claiming success (R1).
  const done = await db.updateJobWhere(args.jobId, { status: "completing" },
    { status: "completed", draft_id: result.draftIds[0] ?? null,
      run_url: args.runUrl ?? null, completion_token_hash: null,
      last_error: recoveryNote, updated_at: new Date().toISOString() });
  if (!done) return { status: 409, body: { error: "job state changed during completion" } };
  return { status: 200, body: { success: true, draftIds: result.draftIds, childJobId, recovered: recoveredCount > 0 } };
}

// ---------------------------------------------------------------------------
// FAIL (F6: tenant pin added). Requeue clears BOTH tokens; only the sweep's
// re-dispatch issues a fresh claim_token, so a failed job can never be
// reclaimed with a stale token.
// ---------------------------------------------------------------------------
export async function failJob(db: Db, args: {
  jobId: string; completionToken: string; error: string;
  reasonCode?: "quota" | "auth" | "error"; // structured, from the worker (R8); substring sniff is fallback only
  now?: Date; maxAttempts?: number;
}): Promise<{ status: number; body: any }> {
  const now = args.now ?? new Date();
  const job = await db.getJob(args.jobId);
  if (!job) return { status: 404, body: { error: "unknown job" } };
  if (job.user_id !== TENANT) return { status: 403, body: { error: "wrong tenant" } };
  const tokenHash = await sha256Hex(args.completionToken);
  if (job.status !== "claimed" || job.completion_token_hash !== tokenHash)
    return { status: 409, body: { error: "not failable" } };

  const detail = String(args.error ?? "unknown").slice(0, 500);
  const lower = detail.toLowerCase();
  const code = args.reasonCode
    ?? (lower.includes("credit") || lower.includes("quota") || lower.includes("usage limit") ? "quota"
      : lower.includes("auth") || lower.includes("401") || lower.includes("token") ? "auth" : "error");
  let fields: Record<string, unknown>;
  if (code === "quota") {
    fields = { status: "paused_quota", last_error: detail };
  } else if (code === "auth") {
    fields = { status: "paused_auth", last_error: detail };
  } else if ((job.attempt ?? 0) + 1 <= (args.maxAttempts ?? 2)) {
    fields = { status: "queued", attempt: (job.attempt ?? 0) + 1, last_error: detail };
  } else {
    fields = { status: "failed", last_error: detail };
  }
  await db.updateJobWhere(args.jobId, { status: "claimed" },
    { ...fields, claimed_by: null, claim_token: null, completion_token_hash: null, updated_at: now.toISOString() });
  return { status: 200, body: { success: true, newStatus: fields.status } };
}

// ---------------------------------------------------------------------------
// SWEEP (B4). Recovers expired claimed/completing jobs back to queued, rotates
// a FRESH claim_token onto every queued job that needs (re)dispatch, and
// returns the dispatch list. The caller (the enqueue path in
// fire-due-schedules, or the Settings resume action) performs the actual
// repository_dispatch POST per returned job - the GitHub credential lives
// dispatcher-side, never in this endpoint.
// ---------------------------------------------------------------------------
export async function sweepJobs(db: Db, args: { now?: Date; dispatchBackoffMin?: number; maxAttempts?: number; quotaPauseHours?: number }): Promise<{ requeuedExpired: number; resumedQuota: number; dispatch: { job_id: string; request_id: string; claim_token: string }[] }> {
  const now = args.now ?? new Date();
  const backoff = args.dispatchBackoffMin ?? 15;
  const maxAttempts = args.maxAttempts ?? 2;
  const stuck = (await db.listJobsWhere({ status: "claimed" }))
    .concat(await db.listJobsWhere({ status: "completing" }))
    .filter((j) => j.claim_expires_at && new Date(j.claim_expires_at) < now);
  let requeued = 0;
  for (const j of stuck) {
    // Retry cap (review gate): an expired-claim requeue consumes an attempt,
    // exactly like a worker-reported failure. Without this, a job whose worker
    // repeatedly dies after claiming loops forever on the backoff.
    const nextAttempt = (j.attempt ?? 0) + 1;
    const capped = nextAttempt > maxAttempts;
    const ok = await db.updateJobWhere(j.id, { status: j.status },
      capped
        ? { status: "failed", claimed_by: null, claim_token: null, completion_token_hash: null,
            last_error: `claim expired in '${j.status}'; retry cap (${maxAttempts}) reached - dead-lettered`, updated_at: now.toISOString() }
        : { status: "queued", attempt: nextAttempt, claimed_by: null, claim_token: null, completion_token_hash: null,
            last_error: `claim expired in '${j.status}', requeued by sweep (attempt ${nextAttempt}/${maxAttempts})`, updated_at: now.toISOString() });
    if (ok) requeued++;
  }
  // Quota resume: a 5-hour subscription window resets on its own, so parked
  // paused_quota jobs re-enter the queue after quotaPauseHours (default 6h >
  // the 5h window). paused_auth stays parked: it needs the token renewed,
  // which is a human action surfaced via claude-job-status.
  const quotaPauseMs = (args.quotaPauseHours ?? 6) * 3600000;
  const quotaParked = (await db.listJobsWhere({ status: "paused_quota" }))
    .filter((j) => j.updated_at && new Date(j.updated_at) < new Date(now.getTime() - quotaPauseMs));
  let resumedQuota = 0;
  for (const j of quotaParked) {
    // Resume consumes an attempt too: a job that keeps failing quota after
    // each resumed window dead-letters instead of retrying forever (review gate).
    const nextAttempt = (j.attempt ?? 0) + 1;
    const capped = nextAttempt > maxAttempts;
    const ok = await db.updateJobWhere(j.id, { status: "paused_quota" },
      capped
        ? { status: "failed", claim_token: null, completion_token_hash: null,
            last_error: `quota pause elapsed but retry cap (${maxAttempts}) reached - dead-lettered`, updated_at: now.toISOString() }
        : { status: "queued", attempt: nextAttempt, claim_token: null, completion_token_hash: null,
            last_error: `quota pause elapsed; resumed by sweep (attempt ${nextAttempt}/${maxAttempts})`, updated_at: now.toISOString() });
    if (ok) resumedQuota++;
  }
  // Rotate + dispatch only queued jobs that were never dispatched or whose
  // last dispatch is older than the backoff - no churn on in-flight runs (R4).
  const queued = (await db.listJobsWhere({ status: "queued" }))
    .filter((j) => !j.last_dispatched_at || new Date(j.last_dispatched_at) < new Date(now.getTime() - backoff * 60000));
  const dispatch = [];
  for (const j of queued) {
    const fresh = uuid();
    const ok = await db.updateJobWhere(j.id, { status: "queued" },
      { claim_token: fresh, updated_at: now.toISOString() });
    if (ok) dispatch.push({ job_id: j.id, request_id: j.request_id, claim_token: fresh });
  }
  return { requeuedExpired: requeued, resumedQuota, dispatch };
}

// S4: the dispatcher marks a job dispatched ONLY after the repository_dispatch
// POST confirms. A failed POST leaves last_dispatched_at unset, so the next
// sweep retries promptly instead of waiting out the backoff.
export async function markDispatched(db: Db, jobId: string, now?: Date): Promise<boolean> {
  const ok = await db.updateJobWhere(jobId, { status: "queued" },
    { last_dispatched_at: (now ?? new Date()).toISOString() });
  return !!ok;
}

// S5: child-insert duplicate detection uses the Postgres error code, not a string sniff.
export function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string })?.code === "23505";
}
