// "Score now": scores the CALLER's unscored cards on the subscription queue. JWT identity only (no body user id).
// Each call settles any finished job first, then enqueues at most one bounded batch. The worker is asynchronous:
// the response reports what was applied/queued/pending; the UI calls again (or reloads) to pick up results.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { tick, makeSupabaseStore } from "../_shared/relevance-queue.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authentication required" }, 401);
    const url = Deno.env.get("SUPABASE_URL") ?? "", key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const { data: { user }, error } = await createClient(url, key, { global: { headers: { Authorization: authHeader } } }).auth.getUser(authHeader.replace("Bearer ", ""));
    if (error || !user) return json({ error: "Invalid or expired token" }, 401);
    const service = createClient(url, key);
    const r = await tick(makeSupabaseStore(service), { userId: user.id });
    const { count: unscored } = await service.from("reference_cards").select("id", { count: "exact", head: true }).eq("user_id", user.id).in("relevance_state", ["unscored", "queued"]);
    const { count: failed } = await service.from("reference_cards").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("relevance_state", "failed");
    return json({ success: true, ...r, remaining: unscored ?? 0, failed: failed ?? 0 });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
