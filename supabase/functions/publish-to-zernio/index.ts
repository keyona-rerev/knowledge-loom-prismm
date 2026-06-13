import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";
import { getPublisher } from "../_shared/publisher/index.ts";
import { resolveForApproval, type Frequency } from "../_shared/schedule-resolver.ts";

// Hand an approved draft to the provider's scheduler at its slot time.
// Invoked on approval with { draftId }. Idempotent: a draft already handed off
// (external_post_id set) is a no-op. It NEVER publishes immediately and NEVER
// posts silently when the timing can't be resolved; such cases land in
// publish_status = 'needs_attention' for the UI.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LINKEDIN_MAX_CHARS = 3000; // confirmed from Zernio's LinkedIn platform page

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
    if (!draftId) return json({ error: "draftId is required" }, 400);

    // Load the draft (scoped to the user).
    const { data: draft } = await supabase
      .from("drafts")
      .select("id, user_id, body, approval_status, schedule_id, scheduled_for, external_post_id")
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
    if (text.length > LINKEDIN_MAX_CHARS) {
      return await needsAttention(
        `Draft is ${text.length} characters; LinkedIn allows ${LINKEDIN_MAX_CHARS}`,
      );
    }

    const publisher = getPublisher();

    // The connected LinkedIn destination.
    const { data: conn } = await supabase
      .from("social_connections")
      .select("external_account_id, status")
      .eq("user_id", userId)
      .eq("provider", publisher.name)
      .eq("platform", "linkedin")
      .maybeSingle();
    if (!conn?.external_account_id) {
      return await needsAttention("LinkedIn is not connected. Connect it in Settings first.");
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

    // Resolve the publish instant (handles late approval; never returns "now").
    const resolved = resolveForApproval(
      {
        day_of_week: slot.day_of_week,
        frequency: slot.frequency as Frequency,
        anchor: slot.anchor,
        time_of_day: slot.time_of_day,
        timezone: slot.timezone,
      },
      draft.scheduled_for ?? null,
      new Date(),
    );
    if (!resolved.scheduledFor) {
      return await needsAttention(
        resolved.basis === "as_needed"
          ? "Slot is 'as needed' and has no fixed publish time. Set a time before publishing."
          : "Could not resolve a future publish time for this slot.",
      );
    }

    // Hand off to the provider's scheduler.
    try {
      const result = await publisher.publish({
        text,
        platform: "linkedin",
        accountId: conn.external_account_id,
        scheduledFor: resolved.scheduledFor,
        timezone: resolved.timezone,
      });
      await supabase.from("drafts").update({
        external_post_id: result.externalPostId,
        publish_status: "scheduled",
        publish_basis: resolved.basis,
        publish_error: null,
        scheduled_for: resolved.scheduledFor,
      }).eq("id", draft.id);
      return json({
        ok: true,
        status: "scheduled",
        basis: resolved.basis,
        scheduledFor: resolved.scheduledFor,
        timezone: resolved.timezone,
        externalPostId: result.externalPostId,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Provider publish failed";
      await supabase.from("drafts").update({
        publish_status: "failed",
        publish_error: msg,
      }).eq("id", draft.id);
      return json({ ok: false, status: "failed", error: msg }, 502);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
