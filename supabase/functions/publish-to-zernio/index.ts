import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";
import { getPublisher } from "../_shared/publisher/index.ts";
import { resolveForApproval, nextOccurrence, type Frequency } from "../_shared/schedule-resolver.ts";
import { getDraftImageUrl } from "../_shared/get-draft-image-url.ts";
import { maxCharsFor, requiresMedia, platformLabel } from "../_shared/publisher/platform-rules.ts";

// Hand an approved draft to the provider's scheduler at its slot time.
// Invoked on approval with { draftId }. Idempotent: a draft already handed off
// (external_post_id set) is a no-op. It NEVER publishes immediately and NEVER
// posts silently when the timing can't be resolved; such cases land in
// publish_status = 'needs_attention' for the UI.
//
// Platform-aware: draft.platform (denormalized from its schedule at
// generation time, see the set_draft_platform_from_schedule trigger) drives
// the char limit, the media requirement, and which social_connections row
// is used. Platforms that require media (see platform-rules.ts) and have no
// ready image NEVER publish text-only and NEVER substitute a fallback/reused
// image -- they land in needs_attention instead.
//
// Concurrency is closed by the atomic claim below: a single conditional
// UPDATE moves one draft from a retryable state (null/needs_attention/failed)
// to 'scheduling'. Exactly one concurrent caller wins; losers affect 0 rows
// and back off before any provider call. (The pre-claim pattern was
// read-then-act across PendingTab/DraftDetail/ApprovedTab call sites, which
// let two calls both reach the provider.) The failure write below still
// guards external_post_id: it only marks the draft failed if
// external_post_id is still null at write time.
//
// A crash between provider accept and the external_post_id write leaves
// 'scheduling' with a null external id -- a state that is NOT safe to
// auto-retry (Zernio's post schema has no idempotency key, so a blind retry
// could create a duplicate live post). The cron sweep parks stale claims
// (>10 min) into needs_attention with an explanatory note instead of
// re-publishing; reconcile there before retrying.
//
// OCCUPANCY-AWARE SLOT ASSIGNMENT: resolveForApproval() only knows this one
// draft's own intended time (stamped at generation, or "next occurrence from
// approval time" if that's passed). It has no idea whether another draft
// already claimed that exact instant. Left alone, two drafts approved for
// the same cadence slot around the same time both resolve to the identical
// next occurrence and get stacked on top of each other with Zernio -- two
// live posts scheduled for the same second. The loop below walks the slot's
// own cadence pattern forward, skipping any instant already genuinely
// occupied (publish_status='scheduled' AND external_post_id set for another
// draft on this same schedule_id -- i.e. actually handed off, not just
// stamped at generation), until it lands on the first truly open one. This
// is also what makes clearing a backlog of stuck same-slot drafts safe:
// retrying them one at a time, in order, sequences them onto consecutive
// open occurrences instead of colliding, because each successful write is
// visible to the occupancy check for the next one.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_SLOT_ADVANCES = 200; // safety cap; nextOccurrence itself searches up to 830 days per call

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const scheduleDraft = async (
  supabase: ReturnType<typeof createClient>,
  draftId: string,
  userId: string,
): Promise<Response> => {
    const { data: draft } = await supabase
      .from("drafts")
      .select("id, user_id, body, approval_status, schedule_id, scheduled_for, external_post_id, platform")
      .eq("id", draftId)
      .eq("user_id", userId)
      .single();
    if (!draft) return json({ error: "Draft not found or access denied" }, 404);

    // Idempotency: already handed off.
    if (draft.external_post_id) {
      return json({ ok: true, alreadyScheduled: true, externalPostId: draft.external_post_id });
    }

    if (draft.approval_status !== "approved") {
      return json({ error: "Draft is not approved" }, 409);
    }

    // Atomic claim BEFORE any provider call. The pre-existing pattern was
    // read-check -> provider API -> write, which lets concurrent invocations
    // (UI double-click vs cron sweep) both reach the publisher and create
    // duplicate external posts. The claim is a single conditional UPDATE:
    // exactly one concurrent caller transitions a retryable state to
    // 'scheduling'; losers affect 0 rows and back off. Failure paths below
    // move the row to 'failed'/'needs_attention' (visible, retryable); a
    // crashed claim is parked to needs_attention by the sweep after a
    // staleness window (never auto-retried; see the header note).
    const { data: claimed } = await supabase
      .from("drafts")
      .update({ publish_status: "scheduling" })
      .eq("id", draft.id)
      .is("external_post_id", null)
      .or("publish_status.is.null,publish_status.eq.needs_attention,publish_status.eq.failed")
      .select("id")
      .maybeSingle();
    if (!claimed) {
      return json({ ok: true, inProgress: true, status: "scheduling" });
    }

    const platform: string = draft.platform ?? "linkedin";
    const label = platformLabel(platform);

    // Helper to flag a draft as needing attention rather than posting.
    const needsAttention = async (msg: string) => {
      await supabase.from("drafts").update({
        publish_status: "needs_attention",
        publish_error: msg,
      }).eq("id", draft.id);
      return json({ ok: false, status: "needs_attention", error: msg }, 200);
    };

    const text = (draft.body ?? "").trim();
    if (!text) return await needsAttention("Draft has no body to publish");
    const maxChars = maxCharsFor(platform);
    if (text.length > maxChars) {
      return await needsAttention(
        `Draft is ${text.length} characters; ${label} allows ${maxChars}`,
      );
    }

    const publisher = getPublisher();

    // The connected destination for this draft's platform.
    const { data: conn } = await supabase
      .from("social_connections")
      .select("external_account_id, status")
      .eq("user_id", userId)
      .eq("provider", publisher.name)
      .eq("platform", platform)
      .maybeSingle();
    if (!conn?.external_account_id) {
      return await needsAttention(`${label} is not connected. Connect it in Settings first.`);
    }

    // Image lookup happens before the media-requirement check below, since
    // platforms that require media need to know NOW whether one is ready --
    // never fall back to a default/reused image (see platform-rules.ts and
    // the no-repeat/no-fallback rule for Instagram specifically).
    const imageUrl = await getDraftImageUrl(supabase, draft.id);
    if (requiresMedia(platform) && !imageUrl) {
      return await needsAttention(
        `${label} requires an image and none is ready yet for this draft. Generate/approve the visual first -- this will never auto-substitute a fallback image.`,
      );
    }

    // The slot timing. No slot -> we have no schedule to publish against.
    if (!draft.schedule_id) {
      return await needsAttention("Draft has no schedule slot; cannot resolve a publish time.");
    }
    const { data: slot } = await supabase
      .from("content_schedules")
      .select("day_of_week, frequency, anchor, time_of_day, timezone")
      .eq("id", draft.schedule_id)
      .single();
    if (!slot) return await needsAttention("Schedule slot not found for this draft.");

    const timing = {
      day_of_week: slot.day_of_week,
      frequency: slot.frequency as Frequency,
      anchor: slot.anchor,
      time_of_day: slot.time_of_day,
      timezone: slot.timezone,
    };

    // Resolve the publish instant (handles late approval; never returns "now").
    const resolved = resolveForApproval(timing, draft.scheduled_for ?? null, new Date());
    if (!resolved.scheduledFor) {
      return await needsAttention(
        resolved.basis === "as_needed"
          ? "Slot is 'as needed' and has no fixed publish time. Set a time before publishing."
          : "Could not resolve a future publish time for this slot.",
      );
    }

    // Occupancy-aware advance (see file header). Walk forward through this
    // slot's cadence pattern, skipping any instant another draft on the same
    // schedule_id has already genuinely claimed, until landing on an open one.
    let candidate = new Date(resolved.scheduledFor);
    let basis: string = resolved.basis;
    for (let i = 0; i < MAX_SLOT_ADVANCES; i++) {
      const { count: occupied } = await supabase
        .from("drafts")
        .select("id", { count: "exact", head: true })
        .eq("schedule_id", draft.schedule_id)
        .eq("publish_status", "scheduled")
        .not("external_post_id", "is", null)
        .eq("scheduled_for", candidate.toISOString());
      if (!occupied) break;
      const next = nextOccurrence(timing, new Date(candidate.getTime() + 1000));
      if (!next) {
        return await needsAttention("Every upcoming occurrence of this slot's cadence is already taken. Check the Cadence tab.");
      }
      candidate = next;
      basis = "queued"; // moved off the originally-intended time because another approved draft already held that instant
    }
    const scheduledForFinal = candidate.toISOString();

    // Hand off to the provider's scheduler.
    try {
      const result = await publisher.publish({
        text,
        platform,
        accountId: conn.external_account_id,
        scheduledFor: scheduledForFinal,
        timezone: resolved.timezone,
        imageUrl,
      });
      await supabase.from("drafts").update({
        external_post_id: result.externalPostId,
        publish_status: "scheduled",
        publish_basis: basis,
        publish_error: null,
        scheduled_for: scheduledForFinal,
      }).eq("id", draft.id);
      return json({
        ok: true,
        status: "scheduled",
        basis,
        scheduledFor: scheduledForFinal,
        timezone: resolved.timezone,
        externalPostId: result.externalPostId,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Provider publish failed";

      // Only mark failed if a concurrent call hasn't already succeeded for
      // this same draft in the meantime (see the idempotency-race note
      // above). The .is("external_post_id", null) guard makes this
      // conditional on the DB, not on anything read earlier in this
      // request, so it's safe even if that concurrent success landed
      // between our read at the top of this function and this write.
      const { data: updated } = await supabase
        .from("drafts")
        .update({ publish_status: "failed", publish_error: msg })
        .eq("id", draft.id)
        .is("external_post_id", null)
        .select("id")
        .maybeSingle();

      if (!updated) {
        const { data: current } = await supabase
          .from("drafts")
          .select("external_post_id, publish_status, scheduled_for")
          .eq("id", draft.id)
          .single();
        return json({
          ok: true,
          alreadyScheduled: true,
          externalPostId: current?.external_post_id,
          status: current?.publish_status,
        });
      }

      return json({ ok: false, status: "failed", error: msg }, 502);
    }
};

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

    const body = await req.json().catch(() => ({}));

    // Cron sweep mode: shared-secret auth (same pattern as check-approved-queue).
    // Schedules approved-but-unscheduled drafts so in-system approvals reach the
    // publisher without waiting for a UI session.
    const cronSecret = req.headers.get("x-cron-secret") ?? "";
    // Clean service-role client for cron mode: the default client forwards the
    // caller's anon JWT, which downgrades reads to the anon role under RLS.
    const svc = createClient(supabaseUrl, serviceRoleKey);
    const { data: cronCfg } = await svc
      .from("automation_config").select("value").eq("key", "cron_fire_secret").maybeSingle();
    const expectedCron = cronCfg?.value ?? "";
    if (expectedCron !== "" && cronSecret === expectedCron) {
      if (body?.sweep !== true || !body?.user_id) {
        return json({ error: "cron sweep requires {sweep:true, user_id}" }, 400);
      }
      // Park stale claims instead of auto-retrying them: a 'scheduling' row
      // older than 10 minutes means the claiming invocation died between the
      // claim and the final write. It may have crashed AFTER the provider
      // accepted the post (external id never recorded), so re-publishing
      // could duplicate a live post. Zernio's post schema has no idempotency
      // key, so the safe move is needs_attention + reconcile.
      const staleIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data: parked } = await svc
        .from("drafts")
        .update({
          publish_status: "needs_attention",
          publish_error:
            "Recovered stale scheduling claim: the publish run was interrupted after claiming this draft. A provider post may or may not have been created - reconcile with Zernio before retrying.",
        })
        .eq("user_id", body.user_id)
        .eq("publish_status", "scheduling")
        .is("external_post_id", null)
        .lt("updated_at", staleIso)
        .select("id");
      const results = [];
      if (parked?.length) {
        results.push(...parked.map((d) => ({ draftId: d.id, ok: false, parkedStaleClaim: true })));
      }

      const { data: candidates, error: candErr } = await svc
        .from("drafts")
        .select("id")
        .eq("user_id", body.user_id)
        .eq("approval_status", "approved")
        .is("publish_status", null)
        .order("scheduled_for", { ascending: true })
        .limit(10);
      if (candErr) return json({ error: "sweep fetch failed: " + candErr.message }, 500);
      for (const c of candidates ?? []) {
        const res = await scheduleDraft(svc, c.id, body.user_id);
        results.push({ draftId: c.id, httpStatus: res.status, body: await res.json() });
      }
      return json({ ok: true, processed: results.length, results });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return json({ error: "Invalid or expired token" }, 401);
    const userId = user.id;

    const { draftId } = body;
    if (!draftId) return json({ error: "draftId is required" }, 400);

    return await scheduleDraft(supabase, draftId, userId);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
