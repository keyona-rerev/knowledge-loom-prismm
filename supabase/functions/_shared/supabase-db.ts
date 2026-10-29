// supabase/functions/_shared/supabase-db.ts - translates supabase-js to the Db
// interface used by job-logic. Equality filters only; the conditional update
// relies on Postgres row locking (single UPDATE ... WHERE) for atomicity.
import type { Db } from "./_shared/job-logic.ts";

export function makeDb(supabase: any): Db {
  return {
    async getJob(id) {
      const { data } = await supabase.from("claude_jobs").select("*").eq("id", id).maybeSingle();
      return data ?? null;
    },
    async updateJobWhere(id, filter, fields) {
      let q = supabase.from("claude_jobs").update(fields).eq("id", id);
      for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
      const { data } = await q.select().maybeSingle();
      return data ?? null;
    },
    async listJobsWhere(filter) {
      let q = supabase.from("claude_jobs").select("*");
      for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
      const { data } = await q;
      return data ?? [];
    },
    async insertJob(row) {
      const { data, error } = await supabase.from("claude_jobs").insert(row).select().single();
      if (error) { const e = new Error(error.message) as Error & { code?: string }; e.code = error.code; throw e; }
      return data;
    },
    async insertDraft(row) {
      const wrid = row.worker_request_id;
      if (wrid) {
        const { data: existing } = await supabase.from("drafts").select("id").eq("worker_request_id", wrid).maybeSingle();
        if (existing) return { id: existing.id, existed: true };
      }
      const { data, error } = await supabase.from("drafts").insert(row).select().single();
      if (error) {
        // Unique violation: a concurrent completion beat us; treat as existing (R1).
        if (wrid && error.code === "23505") {
          const { data: existing } = await supabase.from("drafts").select("id").eq("worker_request_id", wrid).maybeSingle();
          if (existing) return { id: existing.id, existed: true };
        }
        const e = new Error(error.message) as Error & { code?: string }; e.code = error.code; throw e;
      }
      return { id: data.id, existed: false };
    },
    async updateDraft(id, fields) {
      const { error } = await supabase.from("drafts").update(fields).eq("id", id);
      if (error) throw new Error(error.message);
    },
    async updateSeed(id, fields) {
      const { error } = await supabase.from("seeds").update(fields).eq("id", id);
      if (error) throw new Error(error.message);
    },
    async updateCard(id, fields) {
      const { error } = await supabase.from("reference_cards").update(fields).eq("id", id);
      if (error) throw new Error(error.message);
    },
    // Novelty history = drafts the user has NOT rejected: pending, approved and
    // published items form the visible corpus; user-rejected themes are already
    // curated out by the user and must not blindly block new angles (R8).
    async recentDrafts(userId, sinceIso) {
      const { data } = await supabase.from("drafts").select("title, body, seed_insight, stat_attributions")
        .eq("user_id", userId).gte("created_at", sinceIso)
        .or("approval_status.is.null,approval_status.neq.rejected")
        .order("created_at", { ascending: false }).limit(100);
      return data ?? [];
    },
    async notify(draftId) {
      // Bounded (S1): a hung notification function must not eat the 10-minute
      // completing window. Notification is fire-and-forget by design.
      await Promise.race([
        supabase.functions.invoke("send-draft-notification", { body: { draftId } }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("notify timeout")), 10000)),
      ]);
    },
  };
}
