// src/lib/createContentRecovery.ts
// Durable generation handle for CreateContent's interactive generations
// (generate-content-directions / generate-final-content), v2.
//
// Contract: batch13 v4 (sha256 92019d03a769...). Terms used here and in
// CreateContent.tsx:
//   requestKey      - client-minted UUID per DELIBERATE generation click,
//                     persisted BEFORE the first invoke and replayed verbatim
//                     on every reattach. The server keys admissions
//                     cc:<user.id>:<requestKey> per route, so a replay either
//                     returns the already-admitted job (the SAME id on a 200
//                     inline answer and a 202 queued answer) or admits it then.
//   generationJobId - the claude_jobs id of the admitted run. Polled via
//                     claude-job-status, consumed via consume-final-job.
//   strategyJobId   - the strategy-library "job to be done" selection. It is
//                     content-relevant (it shapes generated content and the
//                     draft metadata consume-final-job persists from the
//                     trusted input_snapshot.context), so it participates in
//                     input comparison. The legacy WIRE field for it is still
//                     named "jobId" in the invoke bodies - never confuse it
//                     with a generationJobId.
//
// Handle lifecycle (contract G2):
//   pending  - requestKey persisted, no generationJobId yet (the browser died
//              between admission and the answer, or admission never landed).
//              Recovers by REPLAYING the same requestKey + snapshot inputs;
//              never mints a second key for the same intent.
//   bound    - generationJobId known. Poll / consume only; never re-invokes.
//   terminal - the job is proven gone or failed (404, status failed, consume
//              409 reason failed, consume 422). Kept ONLY to restore the
//              inputs and show what happened; never auto re-admitted on mount
//              (no silent worker spend). A fresh generation happens only on a
//              deliberate click, which mints a FRESH requestKey.
//   Retention: keep on 401/429/5xx/network/lookup-miss/409-mismatch; a 400
//   validation on a FRESH admission may clear (the request can never admit),
//   while a 400 on a REATTACH retains (a job may already exist server-side).
//   Cleared otherwise only on explicit discard, successful consume, or
//   rendered completion.
//
// v1 handles (version 1, a bare jobId with no requestKey) predate key-based
// admission: they stay poll/consume-only and are never re-invoked.

export interface CreateContentInputs {
  seedInsight: string;
  seedCategory: string;
  formatId: string | null;      // strategy library ids; null = unset
  natureId: string | null;
  strategyJobId: string | null; // strategy "job to be done" id - NOT a generation id
  insightCardIds: string[];
}

export interface ContentDirection {
  title: string;
  description: string;
  angle: string;
}

export type CreateContentPhase = "directions" | "final";
export type CreateContentHandleStatus = "active" | "terminal";

export interface CreateContentHandle {
  version: 1 | 2;
  uid: string;                        // owner binding: only this account resumes it
  phase: CreateContentPhase;          // which function the run belongs to
  status: CreateContentHandleStatus;  // terminal handles only restore inputs
  requestKey?: string;                // v2: replayed on reattach
  generationJobId?: string;           // bound claude_jobs id (v1: read from stored "jobId")
  inputs: CreateContentInputs;        // restored on resume so nothing is retyped
  direction?: ContentDirection;       // phase "final": the chosen direction
  directions?: ContentDirection[];    // phase "final": restores the directions step
  terminalReason?: string;            // why the run ended (terminal handles only)
  updatedAt: string;                  // ISO timestamp of the last write
}

// Minimal storage contract so tests can inject a fake (and private-mode
// browsers that throw on access degrade to "no recovery" instead of crashing).
export interface HandleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const createContentHandleKey = (uid: string) => `loom.create-content.job.${uid}`;

// Per-run storage layout (v3, multi-tab/multi-run): ONE SLOT PER RUN, keyed by
// uid + the run's stable intent identity (requestKey for v2, generationJobId
// for legacy v1). Different concurrent runs never share a slot, so no
// read/write TOCTOU and no last-writer-wins across runs. The pre-v3 single
// slot is migrated after a VERIFIED per-run write and is never deleted when a
// storage write fails. No expiry or pruning: unconsumed jobs/content are
// never thrown away on a timer - a slot is removed only on consume success,
// deliberate discard, or dismiss of that run.
export const createContentRunKey = (uid: string, identity: string) => `${createContentHandleKey(uid)}.${identity}`;

// Enumerate storage keys. localStorage exposes length + key(i); test fakes
// may expose keys(). Defensive: enumeration failure degrades to "no runs".
function storageKeys(storage: HandleStorage): string[] {
  const s = storage as { keys?: () => string[]; length?: number; key?: (i: number) => string | null };
  try {
    if (typeof s.keys === "function") return s.keys();
    if (typeof s.length === "number" && typeof s.key === "function") {
      const out: string[] = [];
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (k) out.push(k);
      }
      return out;
    }
  } catch { /* storage unavailable */ }
  return [];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isDirection = (d: unknown): d is ContentDirection => {
  const o = d as Record<string, unknown> | null;
  return !!o && typeof o.title === "string" && typeof o.description === "string" && typeof o.angle === "string";
};

const strOrNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const strOrUndef = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

// Mint a fresh requestKey for a deliberate generation click. One key per user
// intent; retries and reattaches always replay the SAME key.
export function mintRequestKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Very old runtimes without randomUUID: UUID-shaped random from Math.random.
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
}

// Validate and normalize a parsed value into a handle, or null if it cannot
// be trusted to resume anything. A final-phase handle without its direction
// can never resume (the consume flow needs it), so it is rejected.
function sanitize(h: unknown): CreateContentHandle | null {
  const o = h as Record<string, unknown> | null;
  if (!o || (o.version !== 1 && o.version !== 2) || typeof o.uid !== "string" || !o.uid) return null;
  if (o.phase !== "directions" && o.phase !== "final") return null;

  // v1 stored the generation id as "jobId"; v2 stores it as "generationJobId".
  // Accept both on v1 as well: a normalized v1 handle that is updated (e.g.
  // marked terminal) and re-persisted carries "generationJobId" - it must not
  // become unreadable on the next load.
  const rawJob = o.version === 1 ? (o.jobId ?? o.generationJobId) : o.generationJobId;
  const generationJobId = strOrUndef(rawJob);
  if (generationJobId && !UUID_RE.test(generationJobId)) return null;
  if (o.version === 1 && !generationJobId) return null; // v1 is bound-only

  const requestKey = o.version === 2 ? strOrUndef(o.requestKey) : undefined;
  if (o.version === 2 && !requestKey) return null; // a v2 handle without its key can neither reattach nor be identified

  const status: CreateContentHandleStatus = o.status === "terminal" ? "terminal" : "active";
  const terminalReason = status === "terminal" ? strOrUndef(o.terminalReason) : undefined;

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
    version: o.version,
    uid: o.uid,
    phase: o.phase,
    status,
    inputs,
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : new Date(0).toISOString(),
  };
  if (requestKey) out.requestKey = requestKey;
  if (generationJobId) out.generationJobId = generationJobId;
  if (terminalReason) out.terminalReason = terminalReason;
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
// (claude-job-status and consume-final-job also scope by user server-side;
// this keeps the client honest and avoids cross-account resumes on a shared
// browser.) Corrupt or untrusted entries are removed so they are not re-parsed
// on every mount.
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

// Persisted BEFORE the first invoke: the requestKey survives the browser
// dying between admission and the answer, so the next mount can reattach.
export function buildPendingHandle(
  uid: string,
  phase: CreateContentPhase,
  requestKey: string,
  inputs: CreateContentInputs,
  extra: { direction?: ContentDirection; directions?: ContentDirection[] } = {},
): CreateContentHandle {
  return {
    version: 2,
    uid,
    phase,
    status: "active",
    requestKey,
    inputs,
    direction: extra.direction,
    directions: extra.directions,
    updatedAt: new Date().toISOString(),
  };
}

export function bindGenerationJob(h: CreateContentHandle, generationJobId: string): CreateContentHandle {
  return { ...h, version: 2, generationJobId, updatedAt: new Date().toISOString() };
}

// Terminal handles are kept, not cleared: after a reload they restore the
// inputs and explain the failure. Cleared by an explicit dismiss/discard or
// overwritten by the next deliberate Generate click (which mints a fresh key).
export function markHandleTerminal(h: CreateContentHandle, reason: string): CreateContentHandle {
  return { ...h, status: "terminal", terminalReason: reason, updatedAt: new Date().toISOString() };
}

export const isPendingHandle = (h: CreateContentHandle): boolean =>
  h.status === "active" && !h.generationJobId;
export const isBoundHandle = (h: CreateContentHandle): boolean => !!h.generationJobId;
export const isTerminalHandle = (h: CreateContentHandle): boolean => h.status === "terminal";
export const isLegacyHandle = (h: CreateContentHandle): boolean => h.version === 1;

// What a stored handle does on mount / Resume (contract G2):
//   terminal -> "none"    never auto re-admit a proven-gone/failed job
//   bound    -> "poll"    poll / consume only, never re-invoke
//   pending  -> "reattach" re-invoke with the SAME requestKey + snapshot inputs
export type ReconcileAction = "reattach" | "poll" | "none";
export function reconcileAction(h: CreateContentHandle): ReconcileAction {
  if (h.status === "terminal") return "none";
  if (h.generationJobId) return "poll";
  return "reattach";
}

// Identity of a run across its lifecycle: the requestKey for v2 handles
// (stable from pending through bound), the generationJobId for legacy v1
// handles. Identity makes every storage write CONDITIONAL: an older run
// finishing, being discarded, or resolving a conflict must NEVER clobber a
// NEWER run's handle persisted by another tab or a later click (multi-tab
// last-writer-wins is a bug, not a policy).
export function runIdentityOf(h: CreateContentHandle): string {
  return h.requestKey ?? h.generationJobId ?? "";
}

export function isSameRun(a: CreateContentHandle, b: CreateContentHandle): boolean {
  const ka = runIdentityOf(a);
  const kb = runIdentityOf(b);
  return !!ka && ka === kb;
}

// Read one run's handle from its own slot. Untrusted entries (wrong uid,
// identity disagreeing with the slot key, corrupt JSON) are removed so they
// are not re-parsed on every mount.
export function readRunHandle(storage: HandleStorage, uid: string, identity: string): CreateContentHandle | null {
  if (!uid || !identity) return null;
  const slot = createContentRunKey(uid, identity);
  let raw: string | null = null;
  try {
    raw = storage.getItem(slot);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const h = sanitize(parsed);
  if (!h || h.uid !== uid || runIdentityOf(h) !== identity) {
    try {
      storage.removeItem(slot);
    } catch { /* ignore */ }
    return null;
  }
  return h;
}

// Clear ONLY this run's own slot. Other runs' slots are different keys, so a
// finishing/discarding run can never clobber a concurrent run by construction.
export function clearCreateContentHandleForRun(storage: HandleStorage, uid: string, identity: string): boolean {
  if (!uid || !identity) return false;
  try {
    storage.removeItem(createContentRunKey(uid, identity));
    return true;
  } catch {
    return false;
  }
}

// Write an update (bind / terminal mark / re-persist) into this run's own
// slot. A handle whose identity disagrees with the slot is refused: writes
// stay inside their own run even if a caller passes a stale identity.
export function writeCreateContentHandleForRun(
  storage: HandleStorage,
  uid: string,
  identity: string,
  next: CreateContentHandle,
): boolean {
  if (!uid || !identity || runIdentityOf(next) !== identity) return false;
  try {
    storage.setItem(createContentRunKey(uid, identity), JSON.stringify(next));
    return true;
  } catch {
    return false; // storage unavailable: recovery is best-effort, slot kept
  }
}

// Migrate the pre-v3 single slot into a per-run slot. The per-run write is
// VERIFIED by a BYTE-EQUAL read-back of the exact serialized payload before
// the legacy entry is removed; on any storage failure or byte mismatch the
// legacy entry stays and migration retries next mount.
export function migrateLegacyCreateContentHandle(storage: HandleStorage, uid: string): void {
  if (!uid) return;
  const legacy = createContentHandleKey(uid);
  let raw: string | null = null;
  try {
    raw = storage.getItem(legacy);
  } catch {
    return; // storage unavailable: never delete what we cannot read
  }
  if (!raw) return;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const h = sanitize(parsed);
  if (!h || h.uid !== uid) {
    try {
      storage.removeItem(legacy);
    } catch { /* ignore */ }
    return; // corrupt or another account's entry: drop it
  }
  const identity = runIdentityOf(h);
  if (!identity) return; // cannot key it per-run: leave the legacy entry
  const slot = createContentRunKey(uid, identity);
  if (readRunHandle(storage, uid, identity)) {
    // A per-run slot already holds this run (newer truth - e.g. a terminal
    // state written by another tab). The stale legacy entry must NOT
    // resurrect it: drop the legacy entry, keep the per-run slot.
    try {
      storage.removeItem(legacy);
    } catch { /* leave it; migration retries next mount */ }
    return;
  }
  const serialized = JSON.stringify(h);
  try {
    storage.setItem(slot, serialized);
  } catch {
    return; // failed write: keep legacy
  }
  let back: string | null = null;
  try {
    back = storage.getItem(slot);
  } catch {
    return; // unreadable: keep legacy
  }
  if (back !== serialized) return; // byte-mismatched read-back: keep legacy
  try {
    storage.removeItem(legacy);
  } catch { /* leave it; migration retries next mount */ }
}

// Every recoverable run for this account, newest first. The legacy single
// slot is migrated first so a pre-v3 run is discoverable alongside newer
// per-run runs. Mount uses this to make ALL runs selectable - the newest
// alone is not closure when other runs are still recoverable.
export function listCreateContentHandles(storage: HandleStorage, uid: string): CreateContentHandle[] {
  if (!uid) return [];
  migrateLegacyCreateContentHandle(storage, uid);
  const prefix = createContentHandleKey(uid) + ".";
  const out: CreateContentHandle[] = [];
  for (const k of storageKeys(storage)) {
    if (!k.startsWith(prefix)) continue;
    const h = readRunHandle(storage, uid, k.slice(prefix.length));
    if (h) out.push(h);
  }
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out;
}

// Prefer the server's decoded error body over the SDK's generic
// "Edge Function returned a non-2xx status code" wrapper.
export function invokeErrorMessage(error: unknown, body: Record<string, unknown> | null, fallback: string): string {
  const fromBody = body?.error ?? body?.message;
  if (typeof fromBody === "string" && fromBody) return fromBody;
  const msg = (error as { message?: string } | null)?.message;
  if (msg && msg !== "Edge Function returned a non-2xx status code") return msg;
  return fallback;
}

// Insight card order is selection order, not meaning - compare as sets.
// strategyJobId IS part of the comparison (contract G3, v4 amendment): it is
// content-relevant, so a changed strategy selection must not silently
// reattach to a run started with different settings.
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

// Serialize the shared input fields for an invoke body exactly as the live
// form does: unset strategy selections are OMITTED (undefined drops from
// JSON), so a reattach replays the same normalized shape the original
// admission stored. "jobId" is the legacy wire name for strategyJobId.
export function invokeInputFields(inputs: CreateContentInputs): Record<string, unknown> {
  return {
    seedInsight: inputs.seedInsight,
    seedCategory: inputs.seedCategory,
    formatId: inputs.formatId ?? undefined,
    natureId: inputs.natureId ?? undefined,
    jobId: inputs.strategyJobId ?? undefined,
  };
}

export type CreateContentErrorClass = "terminal" | "transient";

// BOUND-phase poll errors (via invokeQueued): stillRunning marks status-
// service failures, expired auth and poll-budget exhaustion - the job may
// still be queued or running, so the handle must be kept and the run resumed,
// never retried with a new admission. Everything else (404 job gone, failed
// job, unreadable result) consumed the job: terminal, inputs retained.
export function classifyCreateContentError(error: unknown): CreateContentErrorClass {
  return (error as { stillRunning?: boolean } | null)?.stillRunning ? "transient" : "terminal";
}

// ADMISSION-phase invoke errors (pending handles, contract G2 retention):
// only a 400 validation on a FRESH admission may clear (the request can never
// be admitted). A 400 on a REATTACH retains - another tab may already have
// admitted the job. Everything else (401/429/5xx/network/unknown) retains:
// the job may have been admitted despite the lost answer.
export type AdmissionErrorClass = "clear" | "retain";
export function classifyAdmissionError(error: unknown, opts: { reattach: boolean }): AdmissionErrorClass {
  const status = Number((error as { context?: { status?: unknown } } | null)?.context?.status);
  if (status === 400) return opts.reattach ? "retain" : "clear";
  return "retain";
}

// A 409 INPUT_MISMATCH from a generation function carries the existing
// generationJobId: the server already holds a job admitted under this
// requestKey but with different normalized inputs. The old job is never
// dropped and its content never silently reused - the user chooses.
export interface InputMismatch {
  existingGenerationJobId: string | null;
}
export function parseInputMismatch(status: number, body: Record<string, unknown> | null): InputMismatch | null {
  if (status !== 409 || !body) return null;
  const code = body.code ?? body.error;
  if (code !== "INPUT_MISMATCH") return null;
  return { existingGenerationJobId: typeof body.jobId === "string" ? body.jobId : null };
}

// A 409 failed-replay from a generation function (executor failed-replay
// contract, pending backend followup): this requestKey replayed to an
// EXISTING job whose latest state is FAILED. The server refuses to
// automatically re-run it (no silent fresh generation on mount) and answers
// with the failed job's identity. Strictly terminal: the UI marks the bound
// handle terminal and retains the inputs; it never retries, never polls the
// dead job, and never re-admits on its own - only a deliberate Generate
// click (which mints a fresh requestKey) starts a new run.
export interface FailedReplay {
  failedGenerationJobId: string | null;
}
export function parseFailedReplay(status: number, body: Record<string, unknown> | null): FailedReplay | null {
  if (status !== 409 || !body) return null;
  const code = body.code ?? body.error;
  if (code === "INPUT_MISMATCH") return null; // user-resolved conflict, not terminal
  if (body.reason !== "failed") return null;
  return { failedGenerationJobId: typeof body.jobId === "string" ? body.jobId : null };
}

// supabase's FunctionsHttpError carries the raw Response as .context; read
// its JSON body defensively (never throws).
export async function readInvokeErrorBody(error: unknown): Promise<Record<string, unknown> | null> {
  const ctx = (error as { context?: { json?: unknown } } | null)?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const parsed = await (ctx.json as () => Promise<unknown>)();
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

// consume-final-job outcome interpretation (contract G4). Body is { jobId }
// only; the server derives owner, content and metadata. Statuses:
//   200 { draftId, created:true }  -> new consume: notification fires HERE only
//   200 { draftId, created:false } -> already consumed: silent reattach
//   409 { reason: "pending" }      -> queued/claimed/completing AND
//                                     paused_auth/paused_quota: try later,
//                                     NEVER terminal - resume polling
//   409 { reason: "failed" }       -> status failed only: strictly terminal
//   404                            -> missing / not owned: terminal
//   422 LEGACY_CONTENT_UNDERIVABLE -> per-job content failure: terminal
//   401/429/5xx/network            -> consume call itself failed: transient
// Branch ONLY on the `created` field (200 carries both outcomes). A missing
// flag biases to silent: notifications are at-most-once, so a lost flag means
// no email - never a duplicate one.
export type ConsumeOutcome =
  | { kind: "created"; draftId: string }
  | { kind: "reattached"; draftId: string }
  | { kind: "pending" }
  | { kind: "terminal"; reason: string }
  | { kind: "transient"; reason: string };

export function interpretConsumeResult(status: number, body: unknown): ConsumeOutcome {
  const b = (body ?? {}) as Record<string, unknown>;
  const draftId = typeof b.draftId === "string" ? b.draftId : "";
  if (status === 200) {
    if (!draftId) return { kind: "transient", reason: "Draft creation returned no draft id." };
    return b.created === true ? { kind: "created", draftId } : { kind: "reattached", draftId };
  }
  if (status === 409) {
    const reason = typeof b.reason === "string" ? b.reason : "";
    if (reason === "pending") return { kind: "pending" };
    return { kind: "terminal", reason: reason === "failed" ? "The generation failed." : "That run could not be continued." };
  }
  if (status === 404) return { kind: "terminal", reason: "That job is no longer available." };
  if (status === 422) return { kind: "terminal", reason: "The generated content could not be recovered." };
  return { kind: "transient", reason: "Draft creation is temporarily unavailable." };
}

// What the final-content runner does when invokeQueued returns an error.
// Transient (stillRunning): the job may still complete - keep the handle so
// the run resumes; never re-admit. Terminal (404 / failed / unreadable), on
// BOTH fresh and resumed runs: surface the failure and stay - the inputs are
// restored and no placeholder draft is ever substituted for the requested
// generated content, and no notification fires.
export type FinalRunErrorAction =
  | { kind: "keep-handle" }
  | { kind: "surface-and-stay" };

export function finalRunErrorAction(error: unknown): FinalRunErrorAction {
  if (classifyCreateContentError(error) === "transient") return { kind: "keep-handle" };
  return { kind: "surface-and-stay" };
}
