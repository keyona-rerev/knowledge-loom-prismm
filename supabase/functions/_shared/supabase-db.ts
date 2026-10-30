// supabase/functions/_shared/supabase-db.ts - translates supabase-js to the Db
// interface used by job-logic. Equality filters only; the conditional update
// relies on Postgres row locking (single UPDATE ... WHERE) for atomicity.
import type { Db } from "./job-logic.ts";

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
    async getDraft(id) {
      const { data } = await supabase.from("drafts").select("id, user_id, title, body, seed_insight, platform").eq("id", id).maybeSingle();
      return data ?? null;
    },
    async findGeneratingVisual(draftId) {
      const { data } = await supabase.from("draft_visuals").select("*")
        .eq("draft_id", draftId).eq("status", "generating").maybeSingle();
      return data ?? null;
    },
    async insertVisual(row) {
      const { data, error } = await supabase.from("draft_visuals").insert(row).select().single();
      if (error) { const e = new Error(error.message) as Error & { code?: string }; e.code = error.code; throw e; }  // 23505 preserved for adopt-winner
      return data;
    },
    async getVisual(id) {
      const { data } = await supabase.from("draft_visuals").select("*").eq("id", id).maybeSingle();
      return data ?? null;
    },
    async updateVisualWhere(id, filter, fields) {
      // Atomic conditional update, same contract as updateJobWhere: apply only
      // if every filter key still equals its value; null when 0 rows matched.
      let q = supabase.from("draft_visuals").update(fields).eq("id", id);
      for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
      const { data, error } = await q.select().maybeSingle();
      if (error) { const e = new Error(error.message) as Error & { code?: string }; e.code = error.code; throw e; }
      return data ?? null;
    },
    async getDraftPublishState(id) {
      const { data } = await supabase.from("drafts")
        .select("id, user_id, approval_status, publish_status, publish_error, external_post_id, platform, scheduled_for")
        .eq("id", id).maybeSingle();
      return data ?? null;
    },
    async getProfileVisualConfig(userId) {
      const { data } = await supabase.from("profiles")
        .select("business_name, business_description, visual_design_rules, visual_studio_config")
        .eq("user_id", userId).maybeSingle();
      return data ?? null;
    },
    async getAutomationConfig(key) {
      const { data } = await supabase.from("automation_config").select("value").eq("key", key).maybeSingle();
      return data?.value ?? null;
    },
    async uploadVisualPng(path, bytes) {
      const { error } = await supabase.storage.from("draft-visuals")
        .upload(path, bytes, { contentType: "image/png", upsert: true });
      if (error) return { error: error.message };
      const { data: pub } = supabase.storage.from("draft-visuals").getPublicUrl(path);
      return { url: pub.publicUrl };
    },
  };
}
