import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";
import { getPublisher } from "../_shared/publisher/index.ts";
import { getDraftImageUrl } from "../_shared/get-draft-image-url.ts";

// Publishes an approved draft immediately (or within ~60 seconds) by scheduling
// it at the current time. Unlike publish-to-zernio, this bypasses the slot
// resolver — it's a manual "send now" action.
//
// Idempotent: if external_post_id is already set and publish_status is
// "published_now", returns success immediately without re-posting.

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
      .select("id, user_id, body, approval_status, external_post_id, publish_status")
      .eq("id", draftId)
      .eq("user_id", userId)
      .single();

    if (!draft) return json({ error: "Draft not found or access denied" }, 404);

    // Idempotency: already posted via post-now.
    if (draft.external_post_id && draft.publish_status === "published_now") {
      return json({ ok: true, alreadyPosted: true, externalPostId: draft.external_post_id });
    }

    if (draft.approval_status !== "approved") {
      return json({ error: "Draft must be approved before posting" }, 409);
    }

    const text = (draft.body ?? "").trim();
    if (!text) return json({ error: "Draft has no body to publish" }, 400);
    if (text.length > LINKEDIN_MAX_CHARS) {
      return json(
        { error: `Draft is ${text.length} characters; LinkedIn allows ${LINKEDIN_MAX_CHARS}` },
        400,
      );
    }

    const publisher = getPublisher();

    // The connected LinkedIn account.
    const { data: conn } = await supabase
      .from("social_connections")
      .select("external_account_id, status")
      .eq("user_id", userId)
      .eq("provider", publisher.name)
      .eq("platform", "linkedin")
      .maybeSingle();

    if (!conn?.external_account_id) {
      return json(
        { error: "LinkedIn is not connected. Connect it in Settings first." },
        400,
      );
    }

    // Schedule 60 seconds from now so the provider has time to process it.
    // This is effectively "now" from the user's perspective.
    const scheduledFor = new Date(Date.now() + 60_000).toISOString();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

    try {
      const imageUrl = await getDraftImageUrl(supabase, draft.id);
      const result = await publisher.publish({
        text,
        platform: "linkedin",
        accountId: conn.external_account_id,
        scheduledFor,
        timezone,
        imageUrl,
      });

      await supabase
        .from("drafts")
        .update({
          external_post_id: result.externalPostId,
          publish_status: "published_now",
          publish_error: null,
          scheduled_for: scheduledFor,
        })
        .eq("id", draft.id);

      return json({
        ok: true,
        status: "published_now",
        externalPostId: result.externalPostId,
        scheduledFor,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Provider publish failed";
      await supabase
        .from("drafts")
        .update({ publish_status: "failed", publish_error: msg })
        .eq("id", draft.id);
      return json({ ok: false, status: "failed", error: msg }, 502);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
