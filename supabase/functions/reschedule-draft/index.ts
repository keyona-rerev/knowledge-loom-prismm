import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";
import { getPublisher } from "../_shared/publisher/index.ts";
import { getDraftImageUrl } from "../_shared/get-draft-image-url.ts";

// Moves an already-scheduled draft to a new time. Invoked from the calendar
// view's inline time edit with { draftId, newScheduledFor, timezone }.
//
// Tries the provider's PUT /v1/posts/{id} first (Publisher.updateSchedule).
// If that throws (unsupported, rejected, or anything else goes wrong), falls
// back to cancelling the existing post and republishing fresh at the new
// time, bypassing the cadence resolver entirely since the caller already
// supplied an explicit instant. If the republish leg of that fallback also
// fails, the draft is left in publish_status "needs_attention" rather than
// silently dropped, since the old post was already cancelled by then.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LINKEDIN_MAX_CHARS = 3000;

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
    const zernioApiKey = Deno.env.get("ZERNIO_API_KEY") ?? "";

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authentication required" }, 401);

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return json({ error: "Invalid or expired token" }, 401);
    const userId = user.id;

    const { draftId, newScheduledFor, timezone: clientTimezone } = await req.json().catch(() => ({}));
    if (!draftId) return json({ error: "draftId is required" }, 400);
    if (!newScheduledFor) return json({ error: "newScheduledFor is required" }, 400);
    const newDate = new Date(newScheduledFor);
    if (Number.isNaN(newDate.getTime())) return json({ error: "newScheduledFor is not a valid date" }, 400);
    if (newDate.getTime() <= Date.now()) return json({ error: "newScheduledFor must be in the future" }, 400);

    const { data: draft } = await supabase
      .from("drafts")
      .select("id, user_id, body, external_post_id, publish_status, scheduled_for")
      .eq("id", draftId)
      .eq("user_id", userId)
      .single();
    if (!draft) return json({ error: "Draft not found or access denied" }, 404);

    if (!draft.external_post_id) {
      return json({ error: "Draft is not scheduled yet; nothing to reschedule." }, 409);
    }
    if (draft.publish_status === "published_now") {
      return json({ error: "This draft already posted and can't be rescheduled." }, 409);
    }

    const timezone = clientTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const scheduledForIso = newDate.toISOString();
    const publisher = getPublisher();

    // Try moving the existing post in place first.
    try {
      await publisher.updateSchedule(draft.external_post_id, scheduledForIso, timezone);
      await supabase.from("drafts").update({
        scheduled_for: scheduledForIso,
        publish_status: "scheduled",
        publish_error: null,
      }).eq("id", draft.id);
      return json({ ok: true, status: "rescheduled", method: "update", scheduledFor: scheduledForIso });
    } catch (updateErr) {
      console.warn("updateSchedule failed, falling back to cancel + republish:", updateErr);
    }

    // Fallback: cancel the existing post, then republish fresh at the new time.
    if (zernioApiKey) {
      try {
        const res = await fetch(`https://zernio.com/api/v1/posts/${draft.external_post_id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${zernioApiKey}`, "Content-Type": "application/json" },
        });
        if (!res.ok && res.status !== 404) {
          console.error("Zernio cancel (pre-reschedule) failed:", res.status, await res.text());
        }
      } catch (e) {
        console.error("Zernio cancel (pre-reschedule) error:", e);
      }
    }

    // Old post is gone or unreachable either way past this point, so the draft
    // can no longer be considered scheduled under its old external_post_id.
    await supabase.from("drafts").update({
      external_post_id: null,
      publish_status: null,
      scheduled_for: null,
    }).eq("id", draft.id);

    const text = (draft.body ?? "").trim();
    if (!text) {
      await supabase.from("drafts").update({
        publish_status: "needs_attention",
        publish_error: "Draft has no body to publish",
      }).eq("id", draft.id);
      return json({ ok: false, status: "needs_attention", error: "Draft has no body to publish" }, 200);
    }
    if (text.length > LINKEDIN_MAX_CHARS) {
      const msg = `Draft is ${text.length} characters; LinkedIn allows ${LINKEDIN_MAX_CHARS}`;
      await supabase.from("drafts").update({ publish_status: "needs_attention", publish_error: msg }).eq("id", draft.id);
      return json({ ok: false, status: "needs_attention", error: msg }, 200);
    }

    const { data: conn } = await supabase
      .from("social_connections")
      .select("external_account_id, status")
      .eq("user_id", userId)
      .eq("provider", publisher.name)
      .eq("platform", "linkedin")
      .maybeSingle();
    if (!conn?.external_account_id) {
      const msg = "LinkedIn is not connected. Connect it in Settings first.";
      await supabase.from("drafts").update({ publish_status: "needs_attention", publish_error: msg }).eq("id", draft.id);
      return json({ ok: false, status: "needs_attention", error: msg }, 200);
    }

    try {
      const imageUrl = await getDraftImageUrl(supabase, draft.id);
      const result = await publisher.publish({
        text,
        platform: "linkedin",
        accountId: conn.external_account_id,
        scheduledFor: scheduledForIso,
        timezone,
        imageUrl,
      });
      await supabase.from("drafts").update({
        external_post_id: result.externalPostId,
        publish_status: "scheduled",
        publish_basis: "rescheduled",
        publish_error: null,
        scheduled_for: scheduledForIso,
      }).eq("id", draft.id);
      return json({ ok: true, status: "rescheduled", method: "cancel_and_republish", scheduledFor: scheduledForIso });
    } catch (publishErr) {
      const msg = publishErr instanceof Error ? publishErr.message : "Provider publish failed";
      await supabase.from("drafts").update({
        publish_status: "needs_attention",
        publish_error: `Reschedule cancelled the old post but republishing failed: ${msg}`,
      }).eq("id", draft.id);
      return json({ ok: false, status: "needs_attention", error: msg }, 200);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
