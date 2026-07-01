import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";
import { getPublisher } from "../_shared/publisher/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
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

    const { data: draft } = await supabase
      .from("drafts")
      .select("id, user_id, external_post_id, publish_status")
      .eq("id", draftId)
      .eq("user_id", userId)
      .single();

    if (!draft) return json({ error: "Draft not found or access denied" }, 404);

    // If there's an external post ID, try to delete it from the provider.
    // This is a deliberate user cancel action, so unlike reschedule-draft's
    // cancel-then-republish fallback, we clear our side regardless of
    // whether the provider delete succeeds — the user asked to cancel, and
    // there's no republish step downstream that a still-live post would
    // collide with.
    if (draft.external_post_id) {
      try {
        await getPublisher().cancel(draft.external_post_id);
      } catch (e) {
        console.error("Provider cancel error:", e);
      }
    }

    // Clear the schedule fields so Post Now can fire fresh
    await supabase
      .from("drafts")
      .update({
        external_post_id: null,
        publish_status: null,
        publish_error: null,
        scheduled_for: null,
      })
      .eq("id", draft.id);

    return json({ ok: true, status: "cancelled" });

  } catch (e) {
    console.error("cancel-schedule error:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 200);
  }
});
