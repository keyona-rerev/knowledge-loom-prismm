// supabase/functions/_shared/visual-logic.ts
// Visual generation on the Claude subscription: admission + completion for
// draft_visuals, riding the claude_jobs spine. All state transitions go
// through the same minimal Db interface as job-logic so this module is
// executable and testable outside Deno/Supabase. Design record:
// visual-subscription-architecture-v3 (reviewer blockers B1-B9).
import type { Db } from "./job-logic.ts";
import { buildVisualPrompt, visualSourceFingerprint } from "./visual-prompt.ts";
import { normalizeRowPlatform } from "./publisher/platform-config.ts";

export const VISUAL_MAX_HTML = 256 * 1024;
export const VISUAL_MAX_PNG = 4 * 1024 * 1024;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// ---------------------------------------------------------------------------
// PNG decode validation (B9): NOT a header sniff - a 33-byte magic+IHDR fake
// passed the first validator. Full chunk walk with per-chunk CRC, IHDR-first
// /IEND-last, IDAT inflate, scanline byte-count and filter-byte checks, and
// dims must equal the snapshot canvas dims.
// ---------------------------------------------------------------------------
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
function crc32(b: Uint8Array): number { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

export async function decodeAndValidatePng(b64: string, wantW: number, wantH: number): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: string }> {
  let bytes: Uint8Array;
  try {
    if (b64.length > Math.ceil(VISUAL_MAX_PNG / 3) * 4 + 8) return { ok: false, reason: "png base64 exceeds encoded cap" };
    const bin = atob(b64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch { return { ok: false, reason: "png base64 undecodable" }; }
  if (bytes.length > VISUAL_MAX_PNG) return { ok: false, reason: "png exceeds decoded cap" };
  if (bytes.length < 33) return { ok: false, reason: "png too small" };
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_MAGIC[i]) return { ok: false, reason: "png magic bytes mismatch" };
  const dv = new DataView(bytes.buffer, bytes.byteOffset);
  let pos = 8; let ihdr: { w: number; h: number; bitd: number; color: number } | null = null;
  const idat: Uint8Array[] = []; let seenIend = false;
  while (pos + 8 <= bytes.length) {
    const ln = dv.getUint32(pos);
    if (pos + 12 + ln > bytes.length) return { ok: false, reason: "png truncated chunk" };
    const typ = bytes.slice(pos + 4, pos + 8);
    const body = bytes.slice(pos + 8, pos + 8 + ln);
    const crc = dv.getUint32(pos + 8 + ln);
    const withTyp = new Uint8Array(4 + ln); withTyp.set(typ); withTyp.set(body, 4);
    if (crc32(withTyp) !== crc) return { ok: false, reason: "png chunk CRC mismatch" };
    const t = String.fromCharCode(...typ);
    if (t === "IHDR") {
      if (ihdr) return { ok: false, reason: "png duplicate IHDR" };
      const bv = new DataView(body.buffer, body.byteOffset);
      ihdr = { w: bv.getUint32(0), h: bv.getUint32(4), bitd: body[8], color: body[9] };
      if (body[10] !== 0 || body[11] !== 0) return { ok: false, reason: "png unsupported compression/filter" };
    } else if (t === "IDAT") { idat.push(body); }
    else if (t === "IEND") { seenIend = true; break; }
    pos += 12 + ln;
  }
  if (!ihdr) return { ok: false, reason: "png missing IHDR" };
  if (!seenIend) return { ok: false, reason: "png missing IEND" };
  const CH: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  if (!(ihdr.color in CH) || ![1, 2, 4, 8, 16].includes(ihdr.bitd)) return { ok: false, reason: "png bad color/bitdepth" };
  if (ihdr.bitd < 8 && [2, 4, 6].includes(ihdr.color)) return { ok: false, reason: "png invalid bitdepth for color" };
  if (ihdr.w !== wantW || ihdr.h !== wantH) return { ok: false, reason: `png dims ${ihdr.w}x${ihdr.h} != canvas ${wantW}x${wantH}` };
  const total = idat.reduce((n, c) => n + c.length, 0);
  const joined = new Uint8Array(total); let o = 0;
  for (const c of idat) { joined.set(c, o); o += c.length; }
  let raw: Uint8Array;
  try {
    const ds = new DecompressionStream("deflate");
    const stream = new Blob([joined]).stream().pipeThrough(ds);
    raw = new Uint8Array(await new Response(stream).arrayBuffer());
  } catch { return { ok: false, reason: "png IDAT inflate failed" }; }
  const channels = CH[ihdr.color];
  const stride = Math.floor((ihdr.w * channels * ihdr.bitd + 7) / 8);
  if (raw.length !== (stride + 1) * ihdr.h)
    return { ok: false, reason: `png decompressed ${raw.length} != expected ${(stride + 1) * ihdr.h}` };
  for (let y = 0; y < ihdr.h; y++) if (raw[y * (stride + 1)] > 4) return { ok: false, reason: "png bad filter byte" };
  return { ok: true, bytes };
}

// ---------------------------------------------------------------------------
// ADMISSION. authUserId is the verified-auth user ONLY (never a body value).
// Cross-owner draft -> 403 BEFORE any write. Placeholder admission is
// idempotent: reuse an in-flight 'generating' row; deliberate regenerate
// after 'ready' gets a NEW visual_id. B8: the partial unique index
// draft_visuals(draft_id) WHERE status='generating' makes exactly one winner;
// the loser catches 23505, re-reads, and ADOPTS the winner's row (bounded 2
// attempts, then an honest 409). Preview admits NO row of any kind.
// ---------------------------------------------------------------------------
export async function admitVisualPlaceholder(db: Db, args: {
  authUserId: string; draftId: string; canvasW: number; canvasH: number; preview?: boolean;
  sourceHash?: string;  // content fingerprint bound at creation (staleness identity)
}): Promise<{ status: number; body: any }> {
  const draft = await db.getDraft(args.draftId);
  if (!draft) return { status: 404, body: { error: "draft not found" } };
  if (draft.user_id !== args.authUserId) return { status: 403, body: { error: "cross-owner visual refused" } };
  const context = { draft_id: args.draftId, canvas: { w: args.canvasW, h: args.canvasH }, preview: !!args.preview };
  if (args.preview) {
    return { status: 200, body: { visual_id: null, admitted: false, preview: true,
      context: { ...context, visual_id: null } } };
  }
  let visual = await db.findGeneratingVisual(args.draftId);
  let admitted = false;
  if (!visual) {
    for (let attempt = 0; attempt < 2 && !visual; attempt++) {
      try {
        visual = await db.insertVisual({ draft_id: args.draftId, user_id: args.authUserId,
          visual_type: "generating", html_content: "", status: "generating",
          ...(args.sourceHash ? { source_hash: args.sourceHash } : {}) });
        admitted = true;
      } catch (e: any) {
        if (e?.code !== "23505") throw e;
        visual = await db.findGeneratingVisual(args.draftId); // adopt winner
      }
    }
    if (!visual) return { status: 409, body: { error: "visual admission conflict" } };
  }
  return { status: 200, body: { visual_id: visual.id, admitted, preview: false,
    context: { ...context, visual_id: visual.id } } };
}

// ---------------------------------------------------------------------------
// COMPLETE branch (runs INSIDE the spine's completing phase; the claimed ->
// completing CAS was already won by completeJob, which also owns the final
// completing -> completed CAS here). Context integrity is not optional.
// Placeholder 'ready' is written LAST: replay short-circuits only on ready,
// which proves upload + update both happened.
// ---------------------------------------------------------------------------
export async function completeVisualJob(db: Db, args: {
  jobId: string; job: any; output: unknown; pngBase64?: string; now: Date;
}): Promise<{ status: number; body: any }> {
  const { job, now } = args;
  const fail = async (error: string, status = 422) => {
    await db.updateJobWhere(args.jobId, { status: "completing" },
      { status: "failed", last_error: error, completion_token_hash: null, updated_at: now.toISOString() });
    await failVisualPlaceholder(db, job, error);  // never leave 'generating' parked: it would block re-admission (unique index)
    return { status, body: { error } };
  };
  const ctx = (job.input_snapshot as any)?.context ?? {};
  if (!ctx.draft_id || !ctx.canvas?.w || !ctx.canvas?.h || (!ctx.preview && !ctx.visual_id))
    return fail("visual job missing required context");
  const o = args.output as any;
  if (!o || typeof o !== "object" || Array.isArray(o)) return fail("visual output not an object");
  if (typeof o.visual_type !== "string" || !o.visual_type.trim()) return fail("missing visual_type");
  if (typeof o.html !== "string" || !o.html.trim()) return fail("missing html");
  if (o.html.length > VISUAL_MAX_HTML) return fail("html oversize");

  if (ctx.preview) {
    // No asset persist AND NO PNG IN THE JOB ROW: a 4MB PNG is ~5.9MB of
    // jsonb per job (and re-polled), with no GC - rejected at review. Preview
    // persists html ONLY; the client falls back to the iframe (it already
    // handles imageBase64=null). The worker may still render for its own
    // validation, but preview never stores or returns it.
    const done = await db.updateJobWhere(args.jobId, { status: "completing" },
      { status: "completed", result: { text: o.html }, run_url: args.job.run_url ?? null,
        completion_token_hash: null, updated_at: now.toISOString() });
    if (!done) return { status: 409, body: { error: "job state changed during completion" } };
    return { status: 200, body: { success: true } };
  }

  const visual = await db.getVisual(ctx.visual_id);
  if (!visual || visual.user_id !== job.user_id || visual.draft_id !== ctx.draft_id)
    return fail("visual context binding mismatch");
  if (visual.status === "ready") {
    // Idempotent replay: an earlier attempt fully finished. Zero new writes.
    const done = await db.updateJobWhere(args.jobId, { status: "completing" },
      { status: "completed", result: { text: visual.image_url }, run_url: args.job.run_url ?? null,
        completion_token_hash: null, updated_at: now.toISOString() });
    if (!done) return { status: 409, body: { error: "job state changed during completion" } };
    await retryHandoffAfterVisual(db, ctx.draft_id);
    return { status: 200, body: { success: true, replay: true } };
  }
  // Completion-time staleness enforcement: if ANY render input changed while
  // the job was in flight - content, style/config, PLATFORM, canvas - this
  // render is stale and must NOT win: flip the placeholder to terminal
  // 'error' (visible, deliberate regeneration required) instead of ready.
  // The recomputation uses the CURRENT draft row (including a mid-flight
  // platform change) and CURRENT profile config, never the ctx snapshot.
  if (ctx.source_hash) {
    const [draftRow, profileRow] = await Promise.all([
      db.getDraft(ctx.draft_id), db.getProfileVisualConfig(job.user_id),
    ]);
    if (draftRow) {
      const currentPlatform = normalizeRowPlatform(draftRow.platform) ?? normalizeRowPlatform(ctx.platform) ?? "linkedin";
      const rebuilt = buildVisualPrompt(profileRow, currentPlatform);
      const current = await visualSourceFingerprint(
        { title: draftRow.title ?? "", body: draftRow.body ?? "", seed_insight: draftRow.seed_insight ?? "" },
        rebuilt.systemPrompt, currentPlatform, rebuilt.canvasWidth, rebuilt.canvasHeight);
      if (current !== ctx.source_hash)
        return fail("render inputs changed during generation; placeholder flips terminal-error for deliberate regeneration");
    }
  }
  if (!args.pngBase64) return fail("missing png");
  const v = await decodeAndValidatePng(args.pngBase64, ctx.canvas.w, ctx.canvas.h);
  if (!v.ok) return fail((v as { ok: false; reason: string }).reason);
  const path = `${job.user_id}/${ctx.visual_id}.png`;
  const up = await db.uploadVisualPng(path, v.bytes); // upsert, fixed path: safe under redispatch
  if (up.error) return fail(`storage: ${up.error}`, 500);
  const updated = await db.updateVisualWhere(ctx.visual_id, { status: "generating" },
    { status: "ready", visual_type: o.visual_type, html_content: o.html,
      image_url: up.url ?? null, canvas_width: ctx.canvas.w, canvas_height: ctx.canvas.h,
      // Bind the fingerprint the render was verified against, so the handoff
      // gate can prove freshness. Absent on legacy in-flight rows (pre-
      // fingerprint enqueues) - those stay unverifiable, refused fail-closed.
      ...(ctx.source_hash ? { source_hash: ctx.source_hash } : {}) });
  if (!updated) {
    // Lost the guard: only 'ready' is a benign replay; anything else conflicts.
    const cur = await db.getVisual(ctx.visual_id);
    if (cur?.status !== "ready") return fail("visual placeholder state conflict", 409);
  }
  const done = await db.updateJobWhere(args.jobId, { status: "completing" },
    { status: "completed", result: { text: up.url ?? null }, run_url: args.job.run_url ?? null,
      completion_token_hash: null, updated_at: now.toISOString() });
  if (!done) return { status: 409, body: { error: "job state changed during completion" } };
  await retryHandoffAfterVisual(db, ctx.draft_id);
  return { status: 200, body: { success: true } };
}

// ---------------------------------------------------------------------------
// FAIL hook: flip the placeholder 'generating' -> 'error' exactly once
// (guarded update by id + status). Called from failJob after the job
// transition; a retried failure no-ops because status is no longer
// 'generating'. Preview jobs carry visual_id=null: nothing to flip.
// ---------------------------------------------------------------------------

// Completion-retry (structural path): a visual that just became ready unblocks
// a draft parked needs_attention for the no-image reason. Fire a targeted
// handoff retry through publish-to-zernio's cron mode ({sweep, user_id,
// draft_id}); the atomic claim in scheduleDraft makes concurrent/duplicate
// retries exactly-once, and the image is re-read fresh at the handoff. Only
// the PRE-PROVIDER no-image park message matches - stale-claim parking
// (possibly post-provider) is never auto-retried.
const NO_IMAGE_PARK_MARKER = "requires an image and none is ready yet";
async function retryHandoffAfterVisual(db: Db, draftId: string): Promise<void> {
  try {
    const d = await db.getDraftPublishState(draftId);
    if (!d || d.approval_status !== "approved" || d.external_post_id) return;
    if (d.publish_status !== "needs_attention") return;
    if (!String(d.publish_error ?? "").includes(NO_IMAGE_PARK_MARKER)) return;
    const cronSecret = await db.getAutomationConfig("cron_fire_secret");
    const base = Deno.env.get("SUPABASE_URL");
    if (!cronSecret || !base) return;
    await Promise.race([
      fetch(`${base}/functions/v1/publish-to-zernio`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-cron-secret": cronSecret },
        body: JSON.stringify({ sweep: true, user_id: d.user_id, draft_id: d.id }),
      }).catch(() => null),
      new Promise((r) => setTimeout(r, 10000)),
    ]);
  } catch { /* fire-and-forget: the human retry path (ApprovedTab) remains */ }
}

export async function failVisualPlaceholder(db: Db, job: any, detail: string): Promise<void> {
  const ctx = (job.input_snapshot as any)?.context ?? {};
  if (!ctx.visual_id || ctx.preview) return;
  await db.updateVisualWhere(ctx.visual_id, { status: "generating" },
    { status: "error", error_message: detail.slice(0, 500) });
}
