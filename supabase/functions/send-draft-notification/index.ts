import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { draftId } = await req.json();

    if (!draftId) {
      return new Response(JSON.stringify({ error: "Missing draftId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    // Get draft with user info
    const { data: draft, error: draftError } = await supabaseClient
      .from("drafts")
      .select(`
        *,
        profiles (
          email
        )
      `)
      .eq("id", draftId)
      .single();

    if (draftError) throw draftError;

    // Get pending count
    const { count: pendingCount } = await supabaseClient
      .from("drafts")
      .select("*", { count: "exact", head: true })
      .eq("user_id", draft.user_id)
      .eq("approval_status", "pending");

    // In a real implementation, send actual email here
    console.log('📧 Would send email to:', draft.profiles.email, {
      draftTitle: draft.title,
      pendingCount,
      draftId: draft.id
    });

    // Log the notification
    await supabaseClient
      .from("email_notifications")
      .insert({
        user_id: draft.user_id,
        draft_id: draftId,
        type: "draft_ready",
        sent_at: new Date().toISOString()
      });

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Notification processed",
        email: draft.profiles.email,
        pendingCount 
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error("Error in send-draft-notification:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});