import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { assessRelevance } from "../_shared/relevance-gate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Maximum email content size (1MB in characters)
const MAX_EMAIL_SIZE = 1_000_000;

// Maximum age of webhook timestamp (5 minutes in seconds)
const MAX_TIMESTAMP_AGE_SECONDS = 300;

// Mailgun webhook signature verification using HMAC-SHA256
async function verifyMailgunSignature(
  timestamp: string,
  token: string,
  signature: string,
  signingKey: string
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(timestamp + token);

    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(signingKey),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const sig = await crypto.subtle.sign("HMAC", key, data);
    const hexSig = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return hexSig === signature;
  } catch (error) {
    console.error("❌ Signature verification error:", error);
    return false;
  }
}

// Enhanced HTML sanitization - removes dangerous elements and event handlers
function sanitizeHtml(html: string): string {
  if (!html) return "";
  
  let sanitized = html;
  
  // 1. Remove script tags and their content
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  
  // 2. Remove style tags and their content
  sanitized = sanitized.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
  
  // 3. Remove iframe, object, embed, form elements
  sanitized = sanitized.replace(/<(iframe|object|embed|form|input|button)\b[^>]*>.*?<\/\1>/gi, "");
  sanitized = sanitized.replace(/<(iframe|object|embed|form|input|button)\b[^>]*\/?>/gi, "");
  
  // 4. Remove event handlers (on*)
  sanitized = sanitized.replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  
  // 5. Remove javascript: URLs
  sanitized = sanitized.replace(/\s+href\s*=\s*["']?\s*javascript:[^"'>\s]*/gi, "");
  sanitized = sanitized.replace(/\s+src\s*=\s*["']?\s*javascript:[^"'>\s]*/gi, "");
  
  // 6. Remove data: URLs that could contain scripts
  sanitized = sanitized.replace(/\s+src\s*=\s*["']?\s*data:text\/html[^"'>\s]*/gi, "");
  
  // 7. Strip remaining HTML tags to get text content
  sanitized = sanitized
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, " ") // Remove numeric HTML entities
    .replace(/\s+/g, " ")
    .trim();
  
  return sanitized;
}

// Get client IP from request headers
function getClientIP(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
         req.headers.get("x-real-ip") ||
         req.headers.get("cf-connecting-ip") ||
         "unknown";
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const clientIP = getClientIP(req);

  try {
    console.log("📧 Received newsletter email webhook from IP:", clientIP);
    
    const contentType = req.headers.get("content-type") || "";
    console.log("📋 Content-Type:", contentType);

    let recipient = "";
    let sender = "";
    let from = "";
    let subject = "Newsletter";
    let bodyHtml = "";
    let bodyPlain = "";
    let mailgunTimestamp = "";
    let mailgunToken = "";
    let mailgunSignature = "";

    // Determine content type - Accept form data, JSON, or empty (some webhooks send empty content-type)
    const isFormData = contentType.includes("multipart/form-data") || 
                       contentType.includes("application/x-www-form-urlencoded");
    const isJson = contentType.includes("application/json");

    // Only reject truly unsupported content types (not empty ones)
    if (!isFormData && !isJson && contentType !== "") {
      console.error("❌ Unsupported content type:", contentType);
      return new Response(
        JSON.stringify({ error: "Unsupported content type. Expected multipart/form-data or application/json" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    try {
      if (isJson) {
        // Parse as JSON (for testing)
        const json = await req.json();
        recipient = json.recipient || "";
        sender = json.sender || "";
        from = json.from || sender;
        subject = json.subject || "Newsletter";
        bodyHtml = json["body-html"] || json.bodyHtml || "";
        bodyPlain = json["body-plain"] || json.bodyPlain || "";
        // Mailgun signature fields
        mailgunTimestamp = json.timestamp || "";
        mailgunToken = json.token || "";
        mailgunSignature = json.signature || "";
      } else {
        // Parse as form-data (Mailgun default, also try for empty content-type)
        const formData = await req.formData();
        recipient = formData.get("recipient")?.toString() || "";
        sender = formData.get("sender")?.toString() || "";
        from = formData.get("from")?.toString() || sender;
        subject = formData.get("subject")?.toString() || "Newsletter";
        bodyHtml = formData.get("body-html")?.toString() || "";
        bodyPlain = formData.get("body-plain")?.toString() || "";
        // Mailgun signature fields
        mailgunTimestamp = formData.get("timestamp")?.toString() || "";
        mailgunToken = formData.get("token")?.toString() || "";
        mailgunSignature = formData.get("signature")?.toString() || "";
      }
    } catch (parseError) {
      console.error("❌ Failed to parse request body:", parseError);
      return new Response(
        JSON.stringify({ error: "Failed to parse request body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ===== SECURITY CHECK 1: Email size limit (1MB) =====
    const totalContentSize = (bodyHtml?.length || 0) + (bodyPlain?.length || 0);
    if (totalContentSize > MAX_EMAIL_SIZE) {
      console.error("❌ Email too large:", totalContentSize, "characters. IP:", clientIP);
      return new Response(
        JSON.stringify({ error: "Email content too large. Maximum size is 1MB." }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify Mailgun webhook signature if MAILGUN_SIGNING_KEY is configured
    const signingKey = Deno.env.get("MAILGUN_SIGNING_KEY");
    if (signingKey) {
      if (!mailgunTimestamp || !mailgunToken || !mailgunSignature) {
        console.error("❌ Missing Mailgun signature fields. IP:", clientIP, "Recipient:", recipient);
        return new Response(
          JSON.stringify({ error: "Missing signature fields" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // ===== SECURITY CHECK 2: Timestamp validation (prevent replay attacks) =====
      const webhookTimestamp = parseInt(mailgunTimestamp, 10);
      const currentTimestamp = Math.floor(Date.now() / 1000);
      const timestampAge = currentTimestamp - webhookTimestamp;
      
      if (isNaN(webhookTimestamp) || timestampAge > MAX_TIMESTAMP_AGE_SECONDS || timestampAge < -60) {
        console.error("❌ Webhook timestamp too old or invalid:", {
          webhookTimestamp,
          currentTimestamp,
          age: timestampAge,
          ip: clientIP,
          recipient
        });
        return new Response(
          JSON.stringify({ error: "Webhook timestamp expired or invalid" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const isValidSignature = await verifyMailgunSignature(
        mailgunTimestamp,
        mailgunToken,
        mailgunSignature,
        signingKey
      );

      if (!isValidSignature) {
        // ===== SECURITY CHECK 3: Enhanced logging for failed signature verification =====
        console.error("❌ Invalid Mailgun signature - rejecting request:", {
          ip: clientIP,
          timestamp: new Date().toISOString(),
          attemptedRecipient: recipient,
          mailgunTimestamp,
          sender: sender?.substring(0, 50) // Truncate for safety
        });
        return new Response(
          JSON.stringify({ error: "Invalid signature" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log("✅ Mailgun signature verified successfully");
    } else {
      console.warn("⚠️ MAILGUN_SIGNING_KEY not configured - skipping signature verification (DEVELOPMENT MODE)");
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

    // ===== SECURITY CHECK 4: Enhanced HTML sanitization =====
    let content = "";
    
    if (bodyHtml) {
      // Use DOM-based sanitization
      content = sanitizeHtml(bodyHtml);
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

    // Relevance gate: skip creating a card at all for noise (ads, digest
    // footers, off-topic newsletters) before it eats up review-queue space.
    const verdict = await assessRelevance(supabase, userId, { title: subject, content });
    if (!verdict.relevant) {
      console.log("⏭️ Skipping irrelevant newsletter email:", subject?.substring(0, 50), "-", verdict.reason);
      await supabase.from("newsletter_emails").insert({
        user_id: userId,
        from_address: from,
        subject: subject,
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
