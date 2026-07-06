import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Newsletter health scan. Two ways in:
//   1. pg_cron, weekly, with the shared x-cron-secret header (same pattern as
//      fire-due-schedules) — scans across ALL users, since that's the
//      scheduled sweep.
//   2. A logged-in user hitting "Run scan now" from the new Health tab
//      (Review page), with a normal Authorization bearer token — scans ONLY
//      that user's senders. This is what makes on-demand checking possible
//      instead of only ever waiting for Monday's cron; it deliberately does
//      NOT rescan every other user's data just because one person wants a
//      fresh look at their own.
//
// For every newsletter sender that's produced reference cards recently, this
// rolls up their scores into a recommendation: healthy, watch, or
// unsubscribe. Individual reference_cards are scored at ingestion time (see
// ingest-gmail-content + _shared/relevance-scorer.ts); this is the layer that
// turns "this one card was a 2" into "this sender has been a 2, 3, and 2 for
// the last three weeks running, consider dropping it."

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const LOOKBACK_DAYS = 60;
const MIN_SAMPLES_FOR_VERDICT = 3;

function recommend(avg: number, count: number): { recommendation: "healthy" | "watch" | "unsubscribe"; reason: string } {
  if (count < MIN_SAMPLES_FOR_VERDICT) {
    return { recommendation: "healthy", reason: `Only ${count} scored item(s) so far — not enough history yet` };
  }
  if (avg <= 3.5) {
    return {
      recommendation: "unsubscribe",
      reason: `Last ${count} items averaged ${avg.toFixed(1)}/10 — consistently low relevance to strategy`,
    };
  }
  if (avg <= 5.5) {
    return {
      recommendation: "watch",
      reason: `Last ${count} items averaged ${avg.toFixed(1)}/10 — mixed relevance, worth watching`,
    };
  }
  return { recommendation: "healthy", reason: `Last ${count} items averaged ${avg.toFixed(1)}/10` };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Determine which entry path this is. A real user JWT takes priority
    // over the cron-secret header if somehow both were sent, since a user
    // triggering their own scan is the more specific, more restrictive case.
    let scopedUserId: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) scopedUserId = user.id;
    }

    if (!scopedUserId) {
      const presented = req.headers.get("x-cron-secret") ?? "";
      const { data: cfg } = await supabase
        .from("automation_config").select("value").eq("key", "cron_fire_secret").maybeSingle();
      if (!cfg?.value || presented !== cfg.value) return json({ error: "Forbidden" }, 403);
    }

    const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();

    let emailsQuery = supabase
      .from("newsletter_emails")
      .select("user_id, from_address, reference_card_id, received_at")
      .eq("processing_status", "success")
      .not("reference_card_id", "is", null)
      .not("from_address", "is", null)
      .gte("received_at", since);
    if (scopedUserId) emailsQuery = emailsQuery.eq("user_id", scopedUserId);

    const { data: emails, error: emailsError } = await emailsQuery;
    if (emailsError) return json({ error: emailsError.message }, 500);

    if (!emails || emails.length === 0) {
      return json({ success: true, sendersScanned: 0, message: "No newsletter emails in lookback window" });
    }

    const cardIds = [...new Set(emails.map((e) => e.reference_card_id).filter(Boolean))];
    const { data: cards, error: cardsError } = await supabase
      .from("reference_cards")
      .select("id, global_relevance_score")
      .in("id", cardIds);
    if (cardsError) return json({ error: cardsError.message }, 500);

    const scoreByCardId = new Map<string, number>();
    (cards || []).forEach((c) => {
      if (typeof c.global_relevance_score === "number") scoreByCardId.set(c.id, c.global_relevance_score);
    });

    const groups = new Map<string, { userId: string; sender: string; scores: number[] }>();
    for (const e of emails) {
      const score = scoreByCardId.get(e.reference_card_id);
      if (score === undefined) continue;
      const key = `${e.user_id}::${e.from_address}`;
      if (!groups.has(key)) groups.set(key, { userId: e.user_id, sender: e.from_address, scores: [] });
      groups.get(key)!.scores.push(score);
    }

    const rows: Array<Record<string, unknown>> = [];
    for (const { userId, sender, scores } of groups.values()) {
      const count = scores.length;
      const avg = scores.reduce((a, b) => a + b, 0) / count;
      const { recommendation, reason } = recommend(avg, count);
      rows.push({
        user_id: userId,
        sender_address: sender,
        card_count: count,
        avg_score: Math.round(avg * 100) / 100,
        last_score: scores[scores.length - 1],
        recommendation,
        reason,
        last_scanned_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    if (rows.length > 0) {
      const { error: upsertError } = await supabase
        .from("newsletter_health")
        .upsert(rows, { onConflict: "user_id,sender_address" });
      if (upsertError) return json({ error: upsertError.message }, 500);
    }

    const flagged = rows.filter((r) => r.recommendation !== "healthy").length;
    console.log(`✅ Newsletter health scan complete. ${rows.length} senders scanned, ${flagged} flagged.${scopedUserId ? ` (scoped to user ${scopedUserId})` : " (global cron sweep)"}`);

    return json({ success: true, sendersScanned: rows.length, flagged });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
