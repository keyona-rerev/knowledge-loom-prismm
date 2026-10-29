// src/lib/createContentRecovery.ts
// Durable job handle for CreateContent's interactive generations
// (generate-content-directions / generate-final-content).
//
// Both functions answer 202 { queued, jobId } when the Claude worker is still
// running, and the client then polls claude-job-status. Before this handle,
// the jobId lived only in the awaiting call: a reload, or a transient status
// failure (expired auth, status 503, poll budget exhausted), dropped it
// forever. The worker still finished the run on the subscription, but the
// result was never consumed - and a retry enqueued a second generation.
//
// The handle is stored per user id in localStorage (same pattern as
// DiscoverSources' loom.discover.search handle): written as soon as a jobId
// exists, kept across transient failures, and cleared only when the phase's
// result is fully consumed (directions rendered / draft row inserted).
// Resuming only ever polls the stored job (invokeQueued resumeJobId) - it
// never enqueues a second generation.

export interface CreateContentInputs {
  seedInsight: string;
  seedCategory: string;
  formatId: string | null;      // strategy library ids; null = unset
  natureId: string | null;
  strategyJobId: string | null; // strategy "job to be done" id - NOT the claude job
  insightCardIds: string[];
}

export interface ContentDirection {
  title: string;
  description: string;
  angle: string;
}

export interface CreateContentHandle {
  version: 1;
  uid: string;                    // owner binding: only this account resumes it
  phase: "directions" | "final";  // which function the job belongs to
  jobId: string;                  // claude_jobs id, polled via claude-job-status
  inputs: CreateContentInputs;    // restored on resume so nothing is retyped
  direction?: ContentDirection;   // phase "final": the chosen direction
  directions?: ContentDirection[]; // phase "final": restores the directions step
  updatedAt: string;              // ISO timestamp of the last write
}

// Minimal storage contract so tests can inject a fake (and private-mode
// browsers that throw on access degrade to "no recovery" instead of crashing).
export interface HandleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const createContentHandleKey = (uid: string) => `loom.create-content.job.${uid}`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isDirection = (d: unknown): d is ContentDirection => {
  const o = d as Record<string, unknown> | null;
  return !!o && typeof o.title === "string" && typeof o.description === "string" && typeof o.angle === "string";
};

const strOrNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

// Validate and normalize a parsed value into a handle, or null if it cannot
// be trusted to resume anything. A final-phase handle without its direction
// can never resume (the draft insert needs it), so it is rejected.
function sanitize(h: unknown): CreateContentHandle | null {
  const o = h as Record<string, unknown> | null;
  if (!o || o.version !== 1 || typeof o.uid !== "string" || !o.uid) return null;
  if (o.phase !== "directions" && o.phase !== "final") return null;
  if (typeof o.jobId !== "string" || !UUID_RE.test(o.jobId)) return null;
  const i = o.inputs as Record<string, unknown> | null;
  if (!i || typeof i.seedInsight !== "string" || typeof i.seedCategory !== "string") return null;
  const inputs: CreateContentInputs = {
    seedInsight: i.seedInsight,
    seedCategory: i.seedCategory,
    formatId: strOrNull(i.formatId),
    natureId: strOrNull(i.natureId),
    strategyJobId: strOrNull(i.strategyJobId),
    insightCardIds: Array.isArray(i.insightCardIds)
      ? i.insightCardIds.filter((x: unknown) => typeof x === "string")
      : [],
  };
  const out: CreateContentHandle = {
    version: 1,
    uid: o.uid,
    phase: o.phase,
    jobId: o.jobId,
    inputs,
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : new Date(0).toISOString(),
  };
  if (isDirection(o.direction)) {
    out.direction = { title: o.direction.title, description: o.direction.description, angle: o.direction.angle };
  }
  if (Array.isArray(o.directions)) {
    out.directions = o.directions.filter(isDirection)
      .map((d: ContentDirection) => ({ title: d.title, description: d.description, angle: d.angle }));
  }
  if (out.phase === "final" && !out.direction) return null;
  return out;
}

// Read the stored handle for this account. Owner binding is enforced twice:
// the storage key is per-uid and the stored uid must match the session.
// (claude-job-status also scopes by user server-side; this keeps the client
// honest and avoids cross-account resumes on a shared browser.) Corrupt or
// untrusted entries are removed so they are not re-parsed on every mount.
export function readCreateContentHandle(storage: HandleStorage, uid: string): CreateContentHandle | null {
  if (!uid) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(createContentHandleKey(uid));
  } catch {
    return null; // storage unavailable
  }
  if (!raw) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const h = sanitize(parsed);
  if (!h) {
    // Unparseable or untrusted entry: remove it so it is not re-parsed every mount.
    try {
      storage.removeItem(createContentHandleKey(uid));
    } catch { /* ignore */ }
    return null;
  }
  if (h.uid !== uid) return null; // another account's handle: never resume it
  return h;
}

export function writeCreateContentHandle(storage: HandleStorage, uid: string, h: CreateContentHandle | null): void {
  if (!uid) return;
  try {
    const key = createContentHandleKey(uid);
    if (h) storage.setItem(key, JSON.stringify(h));
    else storage.removeItem(key);
  } catch {
    // Storage unavailable (private mode / quota): recovery is best-effort.
  }
}

export function buildCreateContentHandle(
  uid: string,
  phase: "directions" | "final",
  jobId: string,
  inputs: CreateContentInputs,
  extra: { direction?: ContentDirection; directions?: ContentDirection[] } = {},
): CreateContentHandle {
  return {
    version: 1,
    uid,
    phase,
    jobId,
    inputs,
    direction: extra.direction,
    directions: extra.directions,
    updatedAt: new Date().toISOString(),
  };
}

// Insight card order is selection order, not meaning - compare as sets.
export function sameInputs(a: CreateContentInputs, b: CreateContentInputs): boolean {
  const cards = (xs: string[]) => [...xs].sort().join("");
  return a.seedInsight === b.seedInsight
    && a.seedCategory === b.seedCategory
    && a.formatId === b.formatId
    && a.natureId === b.natureId
    && a.strategyJobId === b.strategyJobId
    && cards(a.insightCardIds) === cards(b.insightCardIds);
}

export function sameDirection(a?: ContentDirection, b?: ContentDirection): boolean {
  return !!a && !!b && a.title === b.title && a.description === b.description && a.angle === b.angle;
}

export type CreateContentErrorClass = "terminal" | "transient";

// invokeQueued marks status-service failures, expired auth and poll-budget
// exhaustion with stillRunning: the job may still be queued or running, so
// the handle must be kept and the run resumed - never retried with a new
// enqueue and never fallen back to a placeholder draft. Everything else
// (400/404 job gone or invalid, failed job, unreadable result) consumed the
// job: terminal, safe to clear and start over.
export function classifyCreateContentError(error: unknown): CreateContentErrorClass {
  return (error as { stillRunning?: boolean } | null)?.stillRunning ? "transient" : "terminal";
}

// What the final-content runner does when invokeQueued returns an error.
// Transient (stillRunning): the job may still complete - keep the handle so
// the run resumes; never fall back, never re-enqueue. Terminal on a FRESH
// interactive click: the pre-recovery behavior is a basic placeholder draft
// from the direction, so the click still yields something. Terminal on a
// RESUMED run (auto or manual): no silent placeholder - the user asked for
// generated content, so surface the error and leave the restored inputs and
// directions in place instead.
export type FinalRunErrorAction =
  | { kind: "keep-handle" }
  | { kind: "surface-and-stay" }
  | { kind: "fallback-basic-draft" };

export function finalRunErrorAction(error: unknown, wasResume: boolean): FinalRunErrorAction {
  if (classifyCreateContentError(error) === "transient") return { kind: "keep-handle" };
  return wasResume ? { kind: "surface-and-stay" } : { kind: "fallback-basic-draft" };
}

