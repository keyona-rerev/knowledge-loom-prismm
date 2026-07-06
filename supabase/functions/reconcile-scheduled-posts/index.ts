import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";
import { getPublisher } from "../_shared/publisher/index.ts";

// Reconciliation: the Posted tab (and DraftDetail's "actually posted" check)
// have always assumed publish_status='scheduled' AND scheduled_for < now
// means the post actually went out. That's a guess based on the clock, not
// a fact confirmed with Zernio — if Zernio silently failed to fire a post
// (LinkedIn rejected it, the connection token expired, whatever), the app
// would still show it as posted with nothing to indicate otherwise.
//
// This function asks Zernio directly, per draft, via getPost(). Three
// outcomes:
//   - Zernio confirms it posted -> publish_status = 'published_now'. This
//     also normalizes the draft out of the "assumed by clock" bucket
//     entirely; once reconciled, nothing about it depends on the clock
//     anymore.
//   - Zernio confirms it did NOT post (explicit failed/cancelled status, or
//     a 404 meaning Zernio has no record of it at all) -> publish_status =
//     'failed', with the real reason recorded. This surfaces it in
//     Approved's Needs attention card (ApprovedTab's isStuck already
//     catches 'failed'), so something that turned out not to have actually
//     posted becomes visible and actionable again instead of sitting
//     invisible under a false "Posted" badge.
//   - Anything ambiguous (Zernio still reports it as scheduled/pending
//     despite the time having passed, or the lookup itself errors) is left
//     untouched and counted separately — a transient lookup problem should
//     never get misread as a real status change.
//
// Scoped to the authenticated user's own drafts only.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Status strings this file will treat as "confirmed posted" / "confirmed
// not posted," across the range of wording a scheduler might reasonably
// use. Zernio's exact vocabulary for GET /v1/posts/{id} hasn't been probed
// live (see zernio.ts), so this stays permissive rather than matching one
// exact string.
const POSTED_STATUSES = new Set(["posted", "published", "live", "sent", "success", "complete", "completed"]);
const FAILED_STATUSES = new Set(["failed", "cancelled", "canceled", "error", "rejected", "deleted"]);

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

    const nowIso = new Date().toISOString();
    const { data: candidates, error: fetchError } = await supabase
      .from("drafts")
      .select("id, title, external_post_id, scheduled_for")
      .eq("user_id", userId)
      .eq("publish_status", "scheduled")
      .not("external_post_id", "is", null)
      .lt("scheduled_for", nowIso);

    if (fetchError) return json({ error: "Failed to load candidates: " + fetchError.message }, 500);
    if (!candidates || candidates.length === 0) {
      return json({ ok: true, checked: 0, confirmedPosted: 0, confirmedNotPosted: 0, stillAmbiguous: 0, results: [] });
    }

    const publisher = getPublisher();
    let confirmedPosted = 0;
    let confirmedNotPosted = 0;
    let stillAmbiguous = 0;
    const results: any[] = [];

    for (const draft of candidates) {
      try {
        const post = await publisher.getPost(draft.external_post_id as string);
        const statusKey = (post.status || "").toLowerCase();

        if (post.notFound || FAILED_STATUSES.has(statusKey)) {
          const reason = post.notFound
            ? "Zernio has no record of this post (returns 404) — it likely never actually fired."
            : `Zernio reports this post's status as "${post.status}" — it did not go live.`;
          await supabase.from("drafts").update({
            publish_status: "failed",
            publish_error: `${reason} Confirmed via reconciliation.`,
          }).eq("id", draft.id);
          confirmedNotPosted++;
          results.push({ id: draft.id, title: draft.title, outcome: "confirmed_not_posted", detail: reason });
        } else if (POSTED_STATUSES.has(statusKey)) {
          await supabase.from("drafts").update({
            publish_status: "published_now",
            publish_error: null,
          }).eq("id", draft.id);
          confirmedPosted++;
          results.push({ id: draft.id, title: draft.title, outcome: "confirmed_posted" });
        } else {
          // Zernio still reports something like "scheduled"/"pending" despite
          // the time having passed, or an unrecognized status string. Don't
          // guess — leave it alone and flag it for a human to check.
          stillAmbiguous++;
          results.push({ id: draft.id, title: draft.title, outcome: "ambiguous", detail: `Zernio status: "${post.status}"` });
        }
      } catch (e) {
        // The lookup itself failed (network, auth, rate limit) — this is
        // NOT the same as Zernio confirming anything, so the draft is left
        // exactly as it was.
        stillAmbiguous++;
        const msg = e instanceof Error ? e.message : "Lookup failed";
        results.push({ id: draft.id, title: draft.title, outcome: "lookup_error", detail: msg });
      }
    }

    return json({
      ok: true,
      checked: candidates.length,
      confirmedPosted,
      confirmedNotPosted,
      stillAmbiguous,
      results,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
