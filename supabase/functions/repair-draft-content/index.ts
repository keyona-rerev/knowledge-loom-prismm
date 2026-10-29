import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";

// One-shot content-repair tool for already-scheduled drafts.
//
// Why this exists: a figure audit found load-bearing claims in scheduled
// posts that could not be owning-source verified. Editing only the DB row
// would leave the provider (Zernio) holding the old copy, so the repair must
// go through the provider's verified update route:
//   GET /v1/posts/{id}  -> capture exact live payload (platforms, schedule)
//   PUT /v1/posts/{id}  -> same payload with corrected content
//   GET /v1/posts/{id}  -> readback must match the corrected text exactly
// Only after the readback matches does the DB row change, in a single write.
//
// Safety rules:
// - cron-secret auth only; not reachable from the app UI.
// - Refuses anything not publish_status='scheduled' with an external_post_id,
//   unless action='db-only' for an unscheduled draft (no provider call).
// - If the provider GET fails, the post is not 'scheduled', the PUT fails, or
//   the readback mismatches, NOTHING in the DB changes and the original
//   provider copy is left untouched.
// - The PUT echoes the provider's own platforms/scheduledFor/timezone back so
//   the time and channel are preserved exactly.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const ZBASE = "https://zernio.com/api/v1";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const zkey = Deno.env.get("ZERNIO_API_KEY") ?? "";
    if (!zkey) return json({ error: "ZERNIO_API_KEY not set" }, 500);

    const svc = createClient(supabaseUrl, serviceRoleKey);
    const { data: cronCfg } = await svc
      .from("automation_config").select("value").eq("key", "cron_fire_secret").maybeSingle();
    const expectedCron = cronCfg?.value ?? "";
    const cronSecret = req.headers.get("x-cron-secret") ?? "";
    if (expectedCron === "" || cronSecret !== expectedCron) {
      return json({ error: "cron secret required" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const { draftId, action, newBody, newAttributions } = body ?? {};
    if (!draftId) return json({ error: "draftId required" }, 400);
    if (!["read", "repair", "db-only"].includes(action)) {
      return json({ error: "action must be read|repair|db-only" }, 400);
    }

    const { data: draft, error: dErr } = await svc
      .from("drafts")
      .select("id, user_id, body, stat_attributions, external_post_id, publish_status, scheduled_for")
      .eq("id", draftId)
      .single();
    if (dErr || !draft) return json({ error: "draft not found" }, 404);

    const zh = { Authorization: `Bearer ${zkey}`, "Content-Type": "application/json" };

    const getPost = async () => {
      const res = await fetch(`${ZBASE}/posts/${encodeURIComponent(draft.external_post_id)}`, { headers: zh });
      const text = await res.text();
      let parsed: any = null;
      try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
      return { http: res.status, parsed };
    };

    if (action === "read") {
      if (!draft.external_post_id) return json({ error: "no external_post_id", draft }, 400);
      const g = await getPost();
      return json({ http: g.http, provider: g.parsed, draft_body: draft.body, draft_attributions: draft.stat_attributions });
    }

    if (action === "db-only") {
      if (draft.external_post_id) return json({ error: "has external_post_id; use repair" }, 400);
      if (!newBody) return json({ error: "newBody required" }, 400);
      const { error: uErr } = await svc.from("drafts").update({
        body: newBody,
        stat_attributions: newAttributions ?? draft.stat_attributions,
        updated_at: new Date().toISOString(),
      }).eq("id", draftId);
      if (uErr) return json({ error: `db update failed: ${uErr.message}` }, 500);
      return json({ ok: true, mode: "db-only", draftId });
    }

    // action === "repair"
    if (draft.publish_status !== "scheduled" || !draft.external_post_id) {
      return json({ error: `not a scheduled provider post (status=${draft.publish_status}, ext=${draft.external_post_id})` }, 400);
    }
    if (!newBody) return json({ error: "newBody required" }, 400);

    const before = await getPost();
    if (before.http !== 200) return json({ error: `provider GET failed (${before.http})`, provider: before.parsed }, 502);
    const post = before.parsed?.post ?? before.parsed;
    const status = post?.status ?? post?.state ?? "unknown";
    if (status !== "scheduled") return json({ error: `provider status is '${status}', refusing to edit` }, 409);
    const rawPlatforms = post?.platforms;
    const scheduledFor = post?.scheduledFor;
    const timezone = post?.timezone;
    if (!Array.isArray(rawPlatforms) || rawPlatforms.length === 0 || !scheduledFor) {
      return json({ error: "provider post missing platforms/scheduledFor; refusing to guess", provider: post }, 502);
    }
    // GET returns populated account objects; PUT expects the create shape
    // [{ platform, accountId: "<id>" }]. Normalize, refusing to guess.
    const platforms = rawPlatforms.map((p: any) => {
      const accountId = typeof p?.accountId === "string" ? p.accountId : (p?.accountId?._id ?? p?.accountId?.id);
      if (!p?.platform || !accountId) throw new Error("cannot normalize platform entry: " + JSON.stringify(p).slice(0, 200));
      return { platform: p.platform, accountId };
    });

    const putRes = await fetch(`${ZBASE}/posts/${encodeURIComponent(draft.external_post_id)}`, {
      method: "PUT",
      headers: zh,
      body: JSON.stringify({ content: newBody, platforms, scheduledFor, timezone, status: "scheduled" }),
    });
    const putText = await putRes.text();
    if (!putRes.ok) {
      return json({ error: `provider PUT failed (${putRes.status}): ${putText}` }, 502);
    }

    const after = await getPost();
    if (after.http !== 200) return json({ error: `readback GET failed (${after.http}) - provider may hold new copy, DB NOT updated` }, 502);
    const afterPost = after.parsed?.post ?? after.parsed;
    const afterContent = afterPost?.content ?? afterPost?.text ?? "";
    if (afterContent !== newBody) {
      return json({
        error: "readback content mismatch - DB NOT updated, manual reconcile required",
        expected_head: newBody.slice(0, 160),
        actual_head: String(afterContent).slice(0, 160),
      }, 502);
    }
    if ((afterPost?.scheduledFor ?? "") !== scheduledFor) {
      return json({
        error: "readback schedule changed unexpectedly - DB NOT updated, manual reconcile required",
        before: scheduledFor, after: afterPost?.scheduledFor,
      }, 502);
    }

    const { error: uErr } = await svc.from("drafts").update({
      body: newBody,
      stat_attributions: newAttributions ?? draft.stat_attributions,
      updated_at: new Date().toISOString(),
    }).eq("id", draftId);
    if (uErr) {
      return json({ error: `provider updated but DB write failed: ${uErr.message} - manual reconcile required` }, 500);
    }
    return json({
      ok: true, draftId, external_post_id: draft.external_post_id,
      scheduledFor, timezone,
      old_head: String(post?.content ?? "").slice(0, 160),
      new_head: newBody.slice(0, 160),
    });
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
