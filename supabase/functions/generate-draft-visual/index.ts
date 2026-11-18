// generate-draft-visual - queue the branded graphic for one draft.
// Subscription only: no AI API key, no paid endpoint, no external renderer.
// The worker (Claude Code on the install owner's own Claude plan) writes the
// HTML and renders the PNG in its sandbox; claude-job-complete stores it.
// The client polls draft_visuals for status 'generating' -> 'ready'/'error'.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enqueueInteractiveJob } from "../_shared/claude-queue.ts";
import { makeDb } from "../_shared/supabase-db.ts";
import { requestDraftVisual, visualsEnabled } from "../_shared/visual-enqueue.ts";
import { VISUALS_UNAVAILABLE_BODY } from "../_shared/visual-availability.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  // Per-install switch (VISUALS_ENABLED=true). Off = honest 503, no writes.
  if (!visualsEnabled((k) => Deno.env.get(k))) return json(VISUALS_UNAVAILABLE_BODY, 503);

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authentication required" }, 401);
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) return json({ error: "Invalid or expired authentication token" }, 401);

    // The owner comes from the verified token only, never from the body.
    const { draftId } = await req.json().catch(() => ({}));
    if (!draftId || typeof draftId !== "string") return json({ error: "draftId is required" }, 400);

    // Format platform is the fallback when the draft row has no platform.
    const { data: draftFormat } = await supabase.from("drafts").select("format_id").eq("id", draftId).maybeSingle();
    let formatPlatform: string | null = null;
    if (draftFormat?.format_id) {
      const { data: fmt } = await supabase.from("formats").select("platform").eq("id", draftFormat.format_id).maybeSingle();
      formatPlatform = fmt?.platform ?? null;
    }

    const r = await requestDraftVisual(makeDb(supabase), supabase, enqueueInteractiveJob, {
      authUserId: user.id, draftId, formatPlatform,
    });
    return json(r.body, r.status);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
