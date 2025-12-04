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

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    console.log("📧 Received newsletter email webhook");
    
    const contentType = req.headers.get("content-type") || "";
    console.log("📋 Content-Type:", contentType);

    let recipient = "";
    let sender = "";
    let from = "";
    let subject = "Newsletter";
    let bodyHtml = "";
    let bodyPlain = "";

    // Mailgun sends as multipart/form-data
    if (contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await req.formData();
      recipient = formData.get("recipient")?.toString() || "";
      sender = formData.get("sender")?.toString() || "";
      from = formData.get("from")?.toString() || sender;
      subject = formData.get("subject")?.toString() || "Newsletter";
      bodyHtml = formData.get("body-html")?.toString() || "";
      bodyPlain = formData.get("body-plain")?.toString() || "";
    } else if (contentType.includes("application/json")) {
      // Support JSON for testing
      const json = await req.json();
      recipient = json.recipient || "";
      sender = json.sender || "";
      from = json.from || sender;
      subject = json.subject || "Newsletter";
      bodyHtml = json["body-html"] || json.bodyHtml || "";
      bodyPlain = json["body-plain"] || json.bodyPlain || "";
    } else {
      console.error("❌ Unsupported content type:", contentType);
      return new Response(
        JSON.stringify({ error: "Unsupported content type. Expected multipart/form-data or application/json" }),
        { status: 415, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    console.log("📬 Email details:", { recipient, from, subject: subject.substring(0, 50) });

    if (!recipient) {
      console.error("❌ No recipient in webhook");
      return new Response(
        JSON.stringify({ error: "No recipient provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract email prefix from recipient (e.g., user-abc123-xyz@domain.com -> user-abc123-xyz)
    const emailPrefix = recipient.split("@")[0];
    const recipientDomain = recipient.split("@")[1];
    
    console.log("🔍 Looking up user by email prefix:", emailPrefix);

    // Find user by email prefix
    const { data: userEmail, error: lookupError } = await supabase
      .from("user_newsletter_emails")
      .select("user_id, email_address")
      .eq("email_prefix", emailPrefix)
      .eq("is_active", true)
      .single();

    if (lookupError || !userEmail) {
      console.error("❌ User not found for email prefix:", emailPrefix, lookupError);
      return new Response(
        JSON.stringify({ error: "Unknown recipient" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = userEmail.user_id;
    console.log("✅ Found user:", userId);

    // Verify domain matches user's configured domain
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("newsletter_domain")
      .eq("user_id", userId)
      .single();

    if (profileError || !profile?.newsletter_domain) {
      console.error("❌ User has no newsletter domain configured");
      return new Response(
        JSON.stringify({ error: "Newsletter domain not configured for user" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (recipientDomain !== profile.newsletter_domain) {
      console.error("❌ Domain mismatch:", recipientDomain, "vs", profile.newsletter_domain);
      return new Response(
        JSON.stringify({ error: "Domain mismatch" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Rate limiting: Check emails in last hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recentCount, error: countError } = await supabase
      .from("newsletter_emails")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("received_at", oneHourAgo);

    if (countError) {
      console.error("❌ Failed to check rate limit:", countError);
    }

    const emailsThisHour = recentCount || 0;
    const RATE_LIMIT = 50;

    if (emailsThisHour >= RATE_LIMIT) {
      console.warn("⚠️ Rate limit exceeded for user:", userId, "Count:", emailsThisHour);
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Maximum 50 emails per hour." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📊 Rate limit check: ${emailsThisHour}/${RATE_LIMIT} emails this hour`);

    // Parse and clean content
    let content = "";
    
    if (bodyHtml) {
      // Remove scripts, styles, and HTML tags
      content = bodyHtml
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, " ")
        .trim();
    } else if (bodyPlain) {
      content = bodyPlain.trim();
    }

    // Truncate content if too long (max 50000 chars)
    if (content.length > 50000) {
      content = content.substring(0, 50000) + "... [truncated]";
    }

    if (content.length < 50) {
      console.warn("⚠️ Email content too short:", content.length, "characters");
    }

    console.log(`📝 Parsed content: ${content.length} characters`);

    // Create reference card
    const { data: card, error: cardError } = await supabase
      .from("reference_cards")
      .insert({
        user_id: userId,
        title: subject || "Newsletter",
        original_text: content,
        source_type: "newsletter",
        source_url: `mailto:${from}`,
        status: "processing",
        global_relevance_score: 5,
      })
      .select()
      .single();

    if (cardError) {
      console.error("❌ Failed to create reference card:", cardError);
      
      // Still log the email even if card creation fails
      await supabase.from("newsletter_emails").insert({
        user_id: userId,
        from_address: from,
        subject: subject,
        processing_status: "error",
      });

      return new Response(
        JSON.stringify({ error: "Failed to create reference card", details: cardError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("✅ Created reference card:", card.id);

    // Log the email
    await supabase.from("newsletter_emails").insert({
      user_id: userId,
      from_address: from,
      subject: subject,
      reference_card_id: card.id,
      processing_status: "success",
    });

    // Trigger AI processing
    console.log("🤖 Triggering AI processing for card:", card.id);
    try {
      const { error: processError } = await supabase.functions.invoke("process-reference-card", {
        body: { cardId: card.id }
      });
      
      if (processError) {
        console.error("⚠️ AI processing failed:", processError);
        // Don't fail the whole request if AI processing fails
      } else {
        console.log("✅ AI processing triggered successfully");
      }
    } catch (processErr) {
      console.error("⚠️ Error triggering AI processing:", processErr);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        cardId: card.id,
        message: "Newsletter processed successfully" 
      }),
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
