import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { scoreRelevance } from "../_shared/relevance-scorer.ts";

// One-off backfill: rescore existing newsletter reference_cards that still
// carry the old hardcoded global_relevance_score of 5, so the newsletter
// health scan reflects reality instead of pre-fix placeholder data. Not part
// of the regular pipeline — run manually, then safe to delete.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BATCH_SIZE = 40;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const presented = req.headers.get("x-cron-secret") ?? "";
    const { data: cfg } = await supabase
      .from("automation_config").select("value").eq("key", "cron_fire_secret").maybeSingle();
    if (!cfg?.value || presented !== cfg.value) return json({ error: "Forbidden" }, 403);

    const { data: cards, error } = await supabase
      .from("reference_cards")
      .select("id, user_id, title, original_text")
      .eq("source_type", "newsletter")
      .eq("global_relevance_score", 5)
      .limit(BATCH_SIZE);
    if (error) return json({ error: error.message }, 500);

    if (!cards || cards.length === 0) {
      return json({ success: true, processed: 0, remaining: 0, done: true });
    }

    let processed = 0;
    for (const card of cards) {
      try {
        const verdict = await scoreRelevance(supabase, card.user_id, {
          title: card.title || "",
          content: card.original_text || "",
        });
        await supabase
          .from("reference_cards")
          .update({ global_relevance_score: verdict.score })
          .eq("id", card.id);
        processed++;
      } catch (e) {
        console.error("Failed to rescore card:", card.id, e);
      }
    }

    const { count: remaining } = await supabase
      .from("reference_cards")
      .select("*", { count: "exact", head: true })
      .eq("source_type", "newsletter")
      .eq("global_relevance_score", 5);

    return json({ success: true, processed, remaining: remaining ?? 0, done: (remaining ?? 0) === 0 });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
