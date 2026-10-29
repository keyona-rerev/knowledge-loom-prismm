// FAIL-CLOSED STUB (2026-10-29): this interactive visual tool has no Claude
// subscription route yet. Under provider=claude_code it must be unavailable,
// never a paid API fallback. The full implementation remains in the repo and
// returns when migrated. Deployed from a stub because the repo's visual-prompt
// chain references uncommitted publisher/ files and cannot bundle.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  return new Response(JSON.stringify({ error: "Visual generation is temporarily unavailable: content generation now runs on the Claude subscription, and this tool has not been migrated to it yet. No paid API call was made." }), { status: 503, headers: { ...cors, "Content-Type": "application/json" } });
});
