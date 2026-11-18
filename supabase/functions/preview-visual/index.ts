// preview-visual - Visual Studio's live preview on the subscription queue.
// Takes the CURRENT (possibly unsaved) config from the browser plus a real
// draft or the fixed sample post. Persists nothing except the job row; the
// result is html only (no PNG), shown by the client in a sandboxed iframe.
// Answers 202 { queued, jobId }; the client polls claude-job-status.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enqueueInteractiveJob } from "../_shared/claude-queue.ts";
import { requestVisualPreview, visualsEnabled } from "../_shared/visual-enqueue.ts";
import { VISUALS_UNAVAILABLE_BODY } from "../_shared/visual-availability.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!visualsEnabled((k) => Deno.env.get(k))) return json(VISUALS_UNAVAILABLE_BODY, 503);

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authentication required" }, 401);
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) return json({ error: "Invalid or expired token" }, 401);

    const { config, draftId, platform } = await req.json().catch(() => ({}));
    const { data: profile } = await supabase.from("profiles")
      .select("business_name, business_description").eq("user_id", user.id).maybeSingle();

    let draft = null;
    if (draftId) {
      const { data } = await supabase.from("drafts").select("title, body, seed_insight")
        .eq("id", draftId).eq("user_id", user.id).maybeSingle();
      if (!data) return json({ error: "Draft not found or access denied" }, 404);
      draft = data;
    }

    const r = await requestVisualPreview(supabase, enqueueInteractiveJob, {
      authUserId: user.id, config, platform, draft,
      businessName: profile?.business_name ?? null, businessDescription: profile?.business_description ?? null,
    });
    return json(r.body, r.status);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
