import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";
import { getPublisher } from "../_shared/publisher/index.ts";

// Syncs engagement metrics (likes/comments/impressions) for the caller's
// posted drafts. Invoked with { draftId } to sync one, or {} to sync every
// eligible draft for the user.
//
// "Posted" here matches Dashboard.tsx's definition: publish_status is
// published_now, or publish_status is scheduled with scheduled_for already
// in the past (Zernio should have fired it by now).
//
// Per-draft failures (including a plan/billing gap that blocks analytics
// access entirely) are recorded onto drafts.metrics_error rather than
// aborting the whole sync, since one draft's failure shouldn't hide metrics
// that did come back for the rest.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authentication required" }, 401);

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return json({ error: "Invalid or expired token" }, 401);
    const userId = user.id;

    const { draftId } = await req.json().catch(() => ({}));
    const nowIso = new Date().toISOString();

    let query = supabase
      .from("drafts")
      .select("id, external_post_id")
      .eq("user_id", userId)
      .not("external_post_id", "is", null);

    if (draftId) {
      query = query.eq("id", draftId);
    } else {
      query = query.or(`publish_status.eq.published_now,and(publish_status.eq.scheduled,scheduled_for.lt.${nowIso})`);
    }

    const { data: drafts, error: draftsError } = await query;
    if (draftsError) return json({ error: draftsError.message }, 500);
    if (!drafts || drafts.length === 0) {
      return json({ ok: true, synced: 0, failed: 0, errors: [] });
    }

    const publisher = getPublisher();
    let synced = 0;
    const errors: { draftId: string; error: string }[] = [];

    for (const draft of drafts) {
      if (!draft.external_post_id) continue;
      try {
        const stats = await publisher.getAnalytics(draft.external_post_id);
        await supabase.from("drafts").update({
          metric_likes: stats.likes,
          metric_comments: stats.comments,
          metric_impressions: stats.impressions,
          metrics_synced_at: nowIso,
          metrics_error: null,
        }).eq("id", draft.id);
        synced++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Analytics fetch failed";
        await supabase.from("drafts").update({ metrics_error: msg }).eq("id", draft.id);
        errors.push({ draftId: draft.id, error: msg });
      }
    }

    return json({ ok: true, synced, failed: errors.length, errors });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
