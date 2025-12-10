import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Data retention period (90 days)
const RETENTION_DAYS = 90;

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
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
    console.log("🧹 Starting email cleanup job for user:", userId);

    // Use service role client for database operations
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Calculate cutoff date (90 days ago)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
    const cutoffISO = cutoffDate.toISOString();

    console.log(`📅 Deleting emails older than: ${cutoffISO}`);

    // 1. Get IDs of reference cards that will be archived/deleted - only for this user
    const { data: oldEmails, error: selectError } = await supabase
      .from("newsletter_emails")
      .select("id, reference_card_id")
      .eq("user_id", userId)
      .lt("received_at", cutoffISO);

    if (selectError) {
      console.error("❌ Failed to query old emails:", selectError);
      throw selectError;
    }

    const oldEmailCount = oldEmails?.length || 0;
    console.log(`📧 Found ${oldEmailCount} emails to process`);

    if (oldEmailCount === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No emails older than 90 days found",
          deleted: { newsletter_emails: 0, reference_cards: 0 }
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get unique reference card IDs
    const referenceCardIds = oldEmails
      .map(e => e.reference_card_id)
      .filter((id): id is string => id !== null);

    // 2. Mark reference cards as archived (instead of deleting, to preserve user data)
    let archivedCards = 0;
    if (referenceCardIds.length > 0) {
      const { count, error: archiveError } = await supabase
        .from("reference_cards")
        .update({ status: "archived" })
        .in("id", referenceCardIds)
        .eq("user_id", userId)
        .eq("source_type", "newsletter");
      
      if (archiveError) {
        console.error("⚠️ Failed to archive reference cards:", archiveError);
      } else {
        archivedCards = count || 0;
      }
    }

    // 3. Delete old newsletter_emails records for this user only
    const { count: deletedCount, error: deleteError } = await supabase
      .from("newsletter_emails")
      .delete({ count: "exact" })
      .eq("user_id", userId)
      .lt("received_at", cutoffISO);

    if (deleteError) {
      console.error("❌ Failed to delete old emails:", deleteError);
      throw deleteError;
    }

    console.log("✅ Cleanup completed:", {
      emailsDeleted: deletedCount || 0,
      cardsArchived: archivedCards,
      timestamp: new Date().toISOString()
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: `Cleaned up ${deletedCount || 0} emails, archived ${archivedCards} reference cards`,
        deleted: {
          newsletter_emails: deletedCount || 0,
          reference_cards_archived: archivedCards
        },
        cutoffDate: cutoffISO
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("💥 Cleanup job failed:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
