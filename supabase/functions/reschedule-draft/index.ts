import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";
import { getPublisher } from "../_shared/publisher/index.ts";
import { getDraftImageUrl } from "../_shared/get-draft-image-url.ts";
import { platformSpec, resolveDraftPlatform } from "../_shared/publisher/platform-config.ts";

// Moves an already-scheduled draft to a new time. Invoked from the calendar
// view's inline time edit with { draftId, newScheduledFor, timezone }.
//
// Tries the provider's PUT /v1/posts/{id} first (Publisher.updateSchedule).
// If that throws (unsupported, rejected, or anything else goes wrong), falls
// back to cancelling the existing post and republishing fresh at the new
// time, bypassing the cadence resolver entirely since the caller already
// supplied an explicit instant.
//
// Two failure-handling rules that matter here:
// - updateSchedule() and the DB write that persists it are in SEPARATE
//   try/catch blocks. If updateSchedule() succeeds on the provider but the
//   DB write then fails (transient network blip), that must not be treated
//   as "updateSchedule failed" — doing so would cancel a post that was just
//   successfully moved and republish a duplicate.
// - If cancelling the old post fails, the fallback stops there rather than
//   proceeding to republish anyway: we don't know whether the old post is
//   still live, so publishing a new one risks two live posts. The draft's
//   existing schedule is left untouched (not nulled out) so it keeps
//   pointing at whatever is actually still scheduled.
// - Every terminal write is a single UPDATE call that sets publish_status
//   together with whatever fields it implies, never a separate "clear the
//   fields first" write followed by a second "set the real status" write —
//   that gap would leave publish_status transiently null (invisible to both
//   the calendar's scheduled/published_now filter and Review's
//   needs_attention filter) if the function were interrupted between them.

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

    const { draftId, newScheduledFor, timezone: clientTimezone } = await req.json().catch(() => ({}));
    if (!draftId) return json({ error: "draftId is required" }, 400);
    if (!newScheduledFor) return json({ error: "newScheduledFor is required" }, 400);
    const newDate = new Date(newScheduledFor);
    if (Number.isNaN(newDate.getTime())) return json({ error: "newScheduledFor is not a valid date" }, 400);
    if (newDate.getTime() <= Date.now()) return json({ error: "newScheduledFor must be in the future" }, 400);

    const { data: draft, error: draftError } = await supabase
      .from("drafts")
      .select("id, user_id, body, external_post_id, publish_status, scheduled_for, format_id")
      .eq("id", draftId)
      .eq("user_id", userId)
      .single();
    if (draftError || !draft) return json({ error: "Draft not found or access denied" }, 404);

    const platform = await resolveDraftPlatform(supabase, draft.format_id);
    const spec = platformSpec(platform);

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
    let updatedInPlace = false;
    try {
      await publisher.updateSchedule(draft.external_post_id, scheduledForIso, timezone);
      updatedInPlace = true;
    } catch (updateErr) {
      console.warn("updateSchedule failed, falling back to cancel + republish:", updateErr);
    }

    if (updatedInPlace) {
      // Separate try/catch: the provider-side move already succeeded, so a
      // failure here must not trigger cancel + republish.
      try {
        await supabase.from("drafts").update({
          scheduled_for: scheduledForIso,
          publish_status: "scheduled",
          publish_error: null,
        }).eq("id", draft.id);
        return json({ ok: true, status: "rescheduled", method: "update", scheduledFor: scheduledForIso });
      } catch (dbErr) {
        const msg = dbErr instanceof Error ? dbErr.message : "Failed to save the new time";
        return json({
          ok: false,
          status: "failed",
          error: `Zernio moved the post but saving the new time failed: ${msg}. The post is scheduled at the new time on the provider even though this shows an error; refresh before retrying.`,
        }, 500);
      }
    }

    // Fallback: cancel the existing post, then republish fresh at the new
    // time. Abort here (without touching the draft) if cancel fails, since
    // we don't know whether the old post is still live.
    try {
      await publisher.cancel(draft.external_post_id);
    } catch (cancelErr) {
      const msg = cancelErr instanceof Error ? cancelErr.message : "Could not cancel the existing post";
      return json({
        ok: false,
        status: "failed",
        error: `${msg}. Nothing changed; the draft is still scheduled at its original time.`,
      }, 502);
    }

    // Old post is confirmed gone past this point. Every branch below writes
    // external_post_id/scheduled_for together with the resulting
    // publish_status in one UPDATE, so the draft is never left with a stale
    // external_post_id (which would fool publish-to-zernio's idempotency
    // check into treating a cancelled post as still scheduled) or with
    // publish_status sitting null.
    const text = (draft.body ?? "").trim();
    if (!text) {
      await supabase.from("drafts").update({
        external_post_id: null,
        scheduled_for: null,
        publish_status: "needs_attention",
        publish_error: "Draft has no body to publish",
      }).eq("id", draft.id);
      return json({ ok: false, status: "needs_attention", error: "Draft has no body to publish" }, 200);
    }
    if (text.length > spec.maxChars) {
      const msg = `Draft is ${text.length} characters; ${spec.label} allows ${spec.maxChars}`;
      await supabase.from("drafts").update({
        external_post_id: null,
        scheduled_for: null,
        publish_status: "needs_attention",
        publish_error: msg,
      }).eq("id", draft.id);
      return json({ ok: false, status: "needs_attention", error: msg }, 200);
    }

    const { data: conn } = await supabase
      .from("social_connections")
      .select("external_account_id, status")
      .eq("user_id", userId)
      .eq("provider", publisher.name)
      .eq("platform", platform)
      .maybeSingle();
    if (!conn?.external_account_id) {
      const msg = `${spec.label} is not connected. Connect it in Settings first.`;
      await supabase.from("drafts").update({
        external_post_id: null,
        scheduled_for: null,
        publish_status: "needs_attention",
        publish_error: msg,
      }).eq("id", draft.id);
      return json({ ok: false, status: "needs_attention", error: msg }, 200);
    }

    try {
      const imageUrl = await getDraftImageUrl(supabase, draft.id);
      if (spec.requiresImage && !imageUrl) {
        const msg = `${spec.label} requires an image before it can be posted. Generate a visual for this draft first.`;
        await supabase.from("drafts").update({
          external_post_id: null,
          scheduled_for: null,
          publish_status: "needs_attention",
          publish_error: msg,
        }).eq("id", draft.id);
        return json({ ok: false, status: "needs_attention", error: msg }, 200);
      }
      const result = await publisher.publish({
        text,
        platform,
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
        external_post_id: null,
        scheduled_for: null,
        publish_status: "needs_attention",
        publish_error: `Reschedule cancelled the old post but republishing failed: ${msg}`,
      }).eq("id", draft.id);
      return json({ ok: false, status: "needs_attention", error: msg }, 200);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
