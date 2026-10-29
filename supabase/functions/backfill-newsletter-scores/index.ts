import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { tick, makeSupabaseStore } from "../_shared/relevance-queue.ts";

// Formerly a one-off inline rescorer (paid callAI path). Scoring now lives on the subscription queue; this entry
// point (same cron-secret auth) just runs one relevance tick. It does not rescore score=5 cards: with threshold 6
// those cards no longer exist, and no recovery of deleted cards is claimed.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const presented = req.headers.get("x-cron-secret") ?? "";
    const { data: cfg } = await supabase.from("automation_config").select("value").eq("key", "cron_fire_secret").maybeSingle();
    if (!cfg?.value || presented !== cfg.value) return json({ error: "Forbidden" }, 403);
    return json({ success: true, relevance: await tick(makeSupabaseStore(supabase)) });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
