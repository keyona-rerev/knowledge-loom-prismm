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
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    // Verify user authentication from JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("❌ Missing authorization header");
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const supabaseAuth = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
    
    if (authError || !user) {
      console.error("❌ Invalid token:", authError?.message);
      return new Response(
        JSON.stringify({ error: "Invalid or expired authentication token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = user.id;
    console.log("✅ Authenticated user:", userId);

    // Use service role client for database operations
    const supabaseClient = createClient(supabaseUrl, serviceRoleKey);

    const { draftId } = await req.json();

    if (!draftId) {
      return new Response(JSON.stringify({ error: "Missing draftId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get draft - verify it belongs to the authenticated user
    const { data: draft, error: draftError } = await supabaseClient
      .from("drafts")
      .select(`
        *,
        profiles (
          email
        )
      `)
      .eq("id", draftId)
      .eq("user_id", userId)
      .single();

    if (draftError || !draft) {
      console.error("❌ Draft not found or access denied:", draftError);
      return new Response(
        JSON.stringify({ error: "Draft not found or access denied" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get pending count
    const { count: pendingCount } = await supabaseClient
      .from("drafts")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("approval_status", "pending");

    // In a real implementation, send actual email here
    console.log('📧 Would send email to:', draft.profiles?.email, {
      draftTitle: draft.title,
      pendingCount,
      draftId: draft.id
    });

    // Log the notification
    await supabaseClient
      .from("email_notifications")
      .insert({
        user_id: userId,
        draft_id: draftId,
        type: "draft_ready",
        sent_at: new Date().toISOString()
      });

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Notification processed",
        email: draft.profiles?.email,
        pendingCount 
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error("Error in send-draft-notification:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
