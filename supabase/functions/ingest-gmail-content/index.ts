import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { assessRelevance } from "../_shared/relevance-gate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    console.log("📧 Received Gmail ingest request");

    const json = await req.json();
    const { user_id, subject, sender, body, message_id } = json;

    // Validate required fields
    if (!user_id) {
      return new Response(
        JSON.stringify({ error: "Missing user_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!body || body.length < 10) {
      return new Response(
        JSON.stringify({ error: "Email body too short or missing" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify user exists in Supabase
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("user_id", user_id)
      .single();

    if (profileError || !profile) {
      console.error("❌ User not found:", user_id);
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Deduplicate — skip if message_id already processed
    if (message_id) {
      const { data: existing } = await supabase
        .from("newsletter_emails")
        .select("id")
        .eq("user_id", user_id)
        .eq("gmail_message_id", message_id)
        .single();

      if (existing) {
        console.log("⏭️ Already processed message_id:", message_id);
        return new Response(
          JSON.stringify({ success: true, skipped: true, reason: "already_processed" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Truncate body if over 50000 chars
    const content = body.length > 50000
      ? body.substring(0, 50000) + "... [truncated]"
      : body;

    console.log(`📝 Processing email: "${subject}" from ${sender} (${content.length} chars)`);

    // Relevance gate: skip creating a card at all for noise (ads, digest
    // footers, off-topic newsletters) before it eats up review-queue space.
    const verdict = await assessRelevance(supabase, user_id, { title: subject, content });
    if (!verdict.relevant) {
      console.log("⏭️ Skipping irrelevant Gmail newsletter:", subject?.substring(0, 50), "-", verdict.reason);
      await supabase.from("newsletter_emails").insert({
        user_id,
        from_address: sender,
        subject: subject || "Newsletter",
        gmail_message_id: message_id || null,
        processing_status: "skipped_irrelevant",
      });
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: verdict.reason }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create reference card
    const { data: card, error: cardError } = await supabase
      .from("reference_cards")
      .insert({
        user_id,
        title: subject || "Newsletter",
        original_text: content,
        source_type: "newsletter",
        source_url: `mailto:${sender}`,
        status: "processing",
        global_relevance_score: 5,
      })
      .select()
      .single();

    if (cardError) {
      console.error("❌ Failed to create reference card:", cardError);
      return new Response(
        JSON.stringify({ error: "Failed to create reference card", details: cardError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("✅ Created reference card:", card.id);

    // Log the email
    await supabase.from("newsletter_emails").insert({
      user_id,
      from_address: sender,
      subject: subject || "Newsletter",
      reference_card_id: card.id,
      gmail_message_id: message_id || null,
      processing_status: "success",
    });

    // Trigger AI processing
    try {
      const { error: processError } = await supabase.functions.invoke("process-reference-card", {
        body: { cardId: card.id }
      });
      if (processError) {
        console.error("⚠️ AI processing failed:", processError);
      } else {
        console.log("✅ AI processing triggered for card:", card.id);
      }
    } catch (e) {
      console.error("⚠️ Error triggering AI processing:", e);
    }

    return new Response(
      JSON.stringify({ success: true, cardId: card.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("💥 Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
