import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "No authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create authenticated client
    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: { headers: { Authorization: authHeader } }
      }
    );

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    
    if (authError || !user) {
      console.error("❌ Authentication failed:", authError);
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = user.id;
    console.log("🗑️ Starting data deletion for user:", userId);

    // Use service role for deletions
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const deletionResults: Record<string, { deleted: number; error?: string }> = {};

    // 1. Delete user_newsletter_emails
    const { error: newsletterEmailError, count: newsletterEmailCount } = await supabase
      .from("user_newsletter_emails")
      .delete({ count: "exact" })
      .eq("user_id", userId);
    
    deletionResults.user_newsletter_emails = {
      deleted: newsletterEmailCount || 0,
      error: newsletterEmailError?.message
    };

    // 2. Delete newsletter_emails
    const { error: emailsError, count: emailsCount } = await supabase
      .from("newsletter_emails")
      .delete({ count: "exact" })
      .eq("user_id", userId);
    
    deletionResults.newsletter_emails = {
      deleted: emailsCount || 0,
      error: emailsError?.message
    };

    // 3. Delete reference_cards where source_type = 'newsletter'
    const { error: cardsError, count: cardsCount } = await supabase
      .from("reference_cards")
      .delete({ count: "exact" })
      .eq("user_id", userId)
      .eq("source_type", "newsletter");
    
    deletionResults.reference_cards_newsletter = {
      deleted: cardsCount || 0,
      error: cardsError?.message
    };

    // Log the deletion for audit
    console.log("✅ Data deletion completed for user:", userId, {
      timestamp: new Date().toISOString(),
      results: deletionResults
    });

    // Calculate total deleted
    const totalDeleted = Object.values(deletionResults).reduce(
      (sum, result) => sum + result.deleted, 0
    );

    return new Response(
      JSON.stringify({
        success: true,
        message: `Deleted ${totalDeleted} records`,
        details: deletionResults
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("💥 Unexpected error during data deletion:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
