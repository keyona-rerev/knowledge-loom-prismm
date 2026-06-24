import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";

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
    const zernioApiKey = Deno.env.get("ZERNIO_API_KEY") ?? "";

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

    // If there's an external post ID, try to delete it from Zernio
    if (draft.external_post_id && zernioApiKey) {
      try {
        const res = await fetch(`https://zernio.com/api/v1/posts/${draft.external_post_id}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${zernioApiKey}`,
            "Content-Type": "application/json",
          },
        });
        // 404 is fine — already gone. Anything else we log but don't block.
        if (!res.ok && res.status !== 404) {
          const body = await res.text();
          console.error("Zernio delete failed:", res.status, body);
        }
      } catch (e) {
        console.error("Zernio delete error:", e);
        // Don't block — clear our side regardless
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
