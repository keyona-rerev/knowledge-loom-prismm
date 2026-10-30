// supabase/functions/_shared/draft-writer.ts
// Shared draft-writing used by BOTH the in-app API path (after the patch) and
// claude-job-complete. Helper bodies copied VERBATIM from
// execute-autopilot-template/index.ts so rows and side effects are identical.
import type { Db } from "./job-logic.ts";   // stale import name fixed (was _shared-job-logic.ts; type-only, erased at bundle time)

// --- verbatim from execute-autopilot-template/index.ts ---
export function parseJSON(text: string): any {
  let content = text.trim();
  const fence = content.match(/```(?:\w*)?\s*([\s\S]*?)\s*```/i);
  if (fence) content = fence[1].trim();
  const jsonMatch = content.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) content = jsonMatch[1];
  return JSON.parse(content);
}

export const statAttributions = (v: unknown): { figure: string; source: string }[] =>
  Array.isArray(v)
    ? v
        .filter((x) => x && typeof x === "object")
        .map((x: any) => ({ figure: String(x.figure ?? "").trim(), source: String(x.source ?? "").trim() }))
        .filter((x) => x.figure || x.source)
    : [];

export const retiredStatFlag = (body: unknown): string | null => {
  const text = String(body ?? "").toLowerCase();
  const has70 = /\b70\s*(?:percent|%)/.test(text);
  if (has70 && (text.includes("communit") || text.includes("inherit") || text.includes("bank"))) {
    return "Resembles the retired 70 percent figure about inherited assets leaving community banks. Confirm the source before approving.";
  }
  return null;
};
// --- end verbatim ---

export interface SnapshotCtx {
  userId: string; slotId: string; intendedScheduledFor: string;
  formatId: string | null; natureId: string | null; jobId: string | null;
  laneId: string | null; readerId: string | null; seedId: string | null;
  requiresChild: boolean; reuseParentId: string | null;
  childFormatId: string | null; childNatureId: string | null;
  isTestRun: boolean; path: "A" | "B" | "B-child";
  maxReuseCount?: number; reuseWindowDays?: number;
  contentTypeKey: string; childContentTypeKey?: string;
  seedRow?: { id: string; times_used?: number } | null;
  offeredCardIds?: string[];       // trusted cards offered this run (source rotation)
  offeredCards?: { id: string; times_used?: number }[];
  reuseParent?: { id: string; reuse_count?: number; max_reuse_count?: number; reuse_angles_used?: string[] } | null;
  parentTitle?: string | null; parentBody?: string | null; // set for B-child snapshots
}

export interface DraftOutput {
  title: string; body: string;
  angle_used?: string;
  stat_attributions?: { figure: string; source: string; card_id?: string }[];
}

export interface WriteResult {
  draftIds: string[];
  insertedIds: string[];             // only rows THIS call actually inserted
  parentDraftId: string | null;      // PATH B parent (child job target when requiresChild)
  parentTitle: string | null;
  parentBody: string | null;
  parentInserted: boolean;
}

// Inserts drafts with the SAME field shapes as the in-app path, then the SAME
// side effects in the SAME order: reuse-parent counters (path A), seed usage
// (path B), source-rotation advance (both paths, skipped on test runs), and a
// per-draft send-draft-notification invoke.
export async function writeDraftsFromSnapshot(
  db: Db, snap: SnapshotCtx, items: DraftOutput[], requestId: string,
): Promise<WriteResult> {
  const draftIds: string[] = [];
  const insertedIds: string[] = [];
  let parentInserted = false;
  let parentDraftId: string | null = null, parentTitle: string | null = null, parentBody: string | null = null;

  for (const o of items) {
    const base: Record<string, unknown> = {
      title: o.title, body: o.body,
      status: "draft", approval_status: "pending", user_id: snap.userId,
      schedule_id: snap.slotId, scheduled_for: snap.intendedScheduledFor,
      job_id: snap.jobId, lane_id: snap.laneId, reader_id: snap.readerId,
      revision_count: 0,
      stat_attributions: statAttributions(o.stat_attributions),
      stat_flag: retiredStatFlag(o.body),
    };
    let row: Record<string, unknown>;
    if (snap.path === "A") {
      // teaser of an existing parent (verbatim fields from the in-app path)
      const rp = snap.reuseParent!;
      row = { ...base,
        parent_draft_id: rp.id,
        format_id: snap.childFormatId, nature_id: snap.childNatureId,
        content_type: snap.childContentTypeKey ?? snap.contentTypeKey,
        seed_insight: `Teaser ${(rp.reuse_count ?? 0) + 1} of ${rp.max_reuse_count}. Hook: ${o.angle_used || "unspecified"}`,
      };
    } else if (snap.path === "B-child") {
      // Verbatim anchored semantics (b400fbba line ~704): parent title + hook,
      // "unspecified" fallback when the model gave no angle.
      row = { ...base,
        parent_draft_id: snap.reuseParentId,
        format_id: snap.childFormatId, nature_id: snap.childNatureId,
        content_type: snap.childContentTypeKey ?? snap.contentTypeKey,
        seed_insight: `Teaser for "${snap.parentTitle}". Hook: ${o.angle_used || "unspecified"}`,
      };
    } else {
      // PATH B fresh parent (verbatim fields)
      row = { ...base,
        format_id: snap.formatId, nature_id: snap.natureId,
        seed_id: snap.seedId, content_type: snap.contentTypeKey,
        max_reuse_count: snap.maxReuseCount ?? 0,
        reuse_window_days: snap.reuseWindowDays ?? 90,
        reuse_count: 0, reuse_angles_used: [],
      };
    }
    // Persistent idempotency key (R1): a retried completion after a crash
    // conflict-skips rows an earlier attempt already wrote.
    row.worker_request_id = `${requestId}:${draftIds.length}`;
    const draft = await db.insertDraft(row);
    draftIds.push(draft.id);
    if (snap.path === "B") { parentDraftId = draft.id; parentTitle = o.title; parentBody = o.body; }
    if (draft.existed) continue; // recovery path: row and its side effects already happened
    insertedIds.push(draft.id);
    if (snap.path === "B") parentInserted = true;

    // Side effect 1 (path A): advance the reuse parent's counters.
    // Same skip-on-test-run rule as the in-app path.
    if (snap.path === "A" && !snap.isTestRun) {
      const rp = snap.reuseParent!;
      await db.updateDraft(rp.id, {
        reuse_count: (rp.reuse_count ?? 0) + 1,
        reuse_angles_used: [...(rp.reuse_angles_used ?? []), o.angle_used || `Teaser ${(rp.reuse_count ?? 0) + 1}`],
      });
    }
    // Side effect 2 (path B): seed usage (only when the parent row is new).
    if (snap.path === "B" && snap.seedRow && !snap.isTestRun) {
      await db.updateSeed(snap.seedRow.id, {
        times_used: (snap.seedRow.times_used ?? 0) + 1,
        last_used_at: new Date().toISOString(),
      });
    }

    // Side effect 4: notification per NEW draft, inline with its insert, so a
    // crash on a later item can't strand an inserted draft un-notified, and a
    // recovery run never re-notifies (fire-and-forget, as in the app path).
    await db.notify(draft.id).catch(() => {});
  }

  // Side effect 3: advance source rotation once per run that produced a NEW
  // draft (both paths; no-op on test runs) - verbatim semantics of recordSourceUsage.
  if (insertedIds.length && !snap.isTestRun) {
    const now = new Date().toISOString();
    for (const c of snap.offeredCards ?? []) {
      await db.updateCard(c.id, { times_used: (c.times_used ?? 0) + 1, last_used_at: now, is_used: true });
    }
  }

  return { draftIds, insertedIds, parentDraftId, parentTitle, parentBody, parentInserted };
}
