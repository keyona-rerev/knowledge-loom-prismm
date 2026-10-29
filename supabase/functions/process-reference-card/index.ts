import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { tick, makeSupabaseStore } from "../_shared/summary-queue.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── process-reference-card: marks a card for summary on the Claude subscription queue. Settlement is DB-owned
// (migration 20261029200000) and applied by the tick (fire-due-schedules) or by Settle now (JWT path below). No provider keys, no paid path. ───

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    // process-reference-card can be called by the GAS ingest function (service role)
    // OR by authenticated users directly. Support both paths.
    const authHeader = req.headers.get("Authorization");
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    let userId: string;

    if (authHeader && authHeader !== `Bearer ${serviceRoleKey}`) {
      const supabaseAuth = createClient(supabaseUrl, serviceRoleKey, { global: { headers: { Authorization: authHeader } } });
      const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(authHeader.replace("Bearer ", ""));
      if (authError || !user) return new Response(JSON.stringify({ error: "Invalid or expired authentication token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      userId = user.id;
    } else {
      // Service role call (from create-manual-source, or GAS ingest).
      const body = await req.json();
      if (!body.cardId) return new Response(JSON.stringify({ error: "cardId is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      // Prefer the userId the caller already has (create-manual-source
      // knows it — it just authenticated this same user moments ago).
      // Falling back to a fresh SELECT-by-cardId here was intermittently
      // returning no row immediately after the caller's own insert
      // (visible as a "Card not found" 404 in this function's logs),
      // silently leaving every manually-added source on its placeholder
      // score forever. Passing userId directly skips that lookup for any
      // caller that already knows it; the lookup remains as a fallback
      // for older callers that don't pass it.
      if (body.userId) {
        userId = body.userId;
      } else {
        let card: any = null;
        for (let attempt = 0; attempt < 4 && !card; attempt++) {
          if (attempt > 0) await new Promise((r) => setTimeout(r, 250 * attempt));
          const { data } = await supabase.from("reference_cards").select("user_id").eq("id", body.cardId).single();
          card = data;
        }
        if (!card) return new Response(JSON.stringify({ error: "Card not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        userId = card.user_id;
      }

      // Re-parse won't work after consuming body — pass values forward
      // Service-role (ingest/background) callers only mark the card pending; the tick enqueues and settles it.
      return await processCard(supabase, userId, body.cardId, body.customQuestion, corsHeaders, false);
    }

    const { cardId, customQuestion } = await req.json();
    if (!cardId) return new Response(JSON.stringify({ error: "cardId is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    return await processCard(supabase, userId, cardId, customQuestion, corsHeaders, true);

  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

async function processCard(supabase: any, userId: string, cardId: string, customQuestion: string | undefined, corsHeaders: Record<string, string>, userInitiated: boolean) {
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  // Rate limiting (unchanged)
  const windowStart = new Date(); windowStart.setMinutes(windowStart.getMinutes() - 60);
  const { count: rateCount } = await supabase.from('rate_limit_logs').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('action', 'process_card').gte('created_at', windowStart.toISOString());
  if ((rateCount || 0) >= 100) return json({ error: 'Rate limit exceeded.' }, 429);
  const dayStart = new Date(); dayStart.setHours(dayStart.getHours() - 24);
  const { count: dailyCount } = await supabase.from('rate_limit_logs').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('action', 'process_card').gte('created_at', dayStart.toISOString());
  if ((dailyCount || 0) >= 500) return json({ error: 'Daily limit exceeded.' }, 429);
  await supabase.from('rate_limit_logs').insert({ user_id: userId, action: 'process_card' });

  // The insert-then-invoke race: retry the ownership lookup briefly (unchanged behavior).
  let owned = false;
  for (let attempt = 0; attempt < 4 && !owned; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 250 * attempt));
    const { data } = await supabase.from("reference_cards").select("id").eq("id", cardId).eq("user_id", userId).maybeSingle();
    owned = !!data;
  }
  if (!owned) return json({ error: "Card not found or access denied" }, 404);

  const custom = typeof customQuestion === "string" && customQuestion.trim() ? customQuestion.trim() : null;
  // User pressing Process/Ask is an explicit retry (resets the attempt cap); background callers never reset it.
  const { data: state, error } = await supabase.rpc("mark_summary_pending", { p_user: userId, p_card: cardId, p_custom: custom, p_reset: userInitiated });
  if (error) return json({ error: "Could not queue summary: " + error.message }, 500);
  if (!state) return json({ error: "Card not found or access denied" }, 404);

  // Settle now: user-initiated only, scoped to this user, bounded (3 cards). Async: applied by a later tick or Settle now.
  let tickResult: unknown = null;
  if (userInitiated) {
    try { tickResult = await tick(makeSupabaseStore(supabase), { userId }); } catch (_e) { /* the scheduled tick still settles it */ }
  }
  return json({ success: true, queued: true, cardId, summaryState: state, settle: tickResult }, 202);
}
