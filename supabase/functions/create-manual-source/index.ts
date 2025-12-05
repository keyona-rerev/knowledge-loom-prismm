import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("🟡 create-manual-source started");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("❌ Missing environment variables");
      return new Response(JSON.stringify({ error: "Server configuration error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create client with user's auth token to verify identity
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("❌ Missing authorization header");
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use auth client to get user from JWT
    const supabaseAuth = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    
    if (authError || !user) {
      console.error("❌ Authentication failed:", authError);
      return new Response(JSON.stringify({ error: "Invalid or expired authentication token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const user_id = user.id;
    console.log("✅ Authenticated user:", user_id);

    // Use service role client for database operations
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const requestBody = await req.json();
    console.log("📦 Request body:", requestBody);

    const { type, url, pdf_text, pdf_title, question_set_id } = requestBody;

    if (!type || (type === "url" && !url) || (type === "pdf" && !pdf_text)) {
      console.log("❌ Invalid parameters:", { type, url, has_pdf_text: !!pdf_text });
      return new Response(JSON.stringify({ error: "Invalid source type or missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let title = "Untitled Article";
    let textContent = "";
    let contentQuality = "good";
    let contentWarning = null;
    let sourceUrl = url || "";
    let contentBlocked = false;

    // Handle PDF type
    if (type === "pdf") {
      console.log("📄 Processing PDF source");
      title = pdf_title || "PDF Document";
      textContent = pdf_text;
      sourceUrl = ""; // PDFs don't have URLs
      
      if (textContent.length < 100) {
        contentQuality = "partial";
        contentWarning = "PDF content appears incomplete";
      }
    } else {
      // Handle URL type
      console.log("🌐 Fetching content from:", url);

      // ✅ IMPROVED: Better headers to avoid bot detection
      let articleResponse;
      try {
        articleResponse = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          },
        });
        console.log("📄 Response status:", articleResponse.status);

        // ✅ IMPROVED: Handle common blocking scenarios gracefully
        if (articleResponse.status === 403 || articleResponse.status === 429) {
          console.log("⚠️ Site blocked automated access");
          contentBlocked = true;
        } else if (!articleResponse.ok) {
          throw new Error(`HTTP ${articleResponse.status}: ${articleResponse.statusText}`);
        }
      } catch (fetchError) {
        console.error("❌ Fetch failed:", fetchError);
        return new Response(JSON.stringify({ error: `Failed to fetch URL: ${fetchError instanceof Error ? fetchError.message : 'Unknown error'}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (contentBlocked) {
        // ✅ IMPROVED: Graceful handling for blocked sites
        console.log("🛡️ Creating card with limited content (site blocked)");
        title = "Site Blocked Access - Manual Review Needed";
        textContent = "This site blocks automated content access. Please add content manually or try a different source.";
        contentQuality = "title_only";
        contentWarning = "Site blocks automated content access - manual review required";
      } else {
        // Normal content processing
        const articleHtml = await articleResponse.text();
        console.log("📝 HTML content length:", articleHtml.length);

      // Extract title
      const titleMatch = /<title>(.*?)<\/title>/i.exec(articleHtml);
      title = titleMatch?.[1]?.trim() || "Untitled Article";
      console.log("📌 Extracted title:", title);

      // Remove HTML tags for content
      textContent = articleHtml
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 10000);

      console.log("📄 Clean content length:", textContent.length);

        // ✅ IMPROVED: Better content quality assessment
        if (textContent.length < 50) {
          contentQuality = "title_only";
          contentWarning = "Limited content available - only title accessible";
        } else if (textContent.length < 500) {
          contentQuality = "partial";
          contentWarning = "Partial content - full article may not be accessible";
        }
      }
    }

    // Create source feed entry
    console.log("💾 Creating source feed entry...");
    const { data: feedData, error: feedError } = await supabase
      .from("source_feeds")
      .insert({
        name: title.substring(0, 255),
        url: sourceUrl,
        feed_type: "manual",
        is_active: true,
        credibility_score: 5,
        user_id: user_id,
      })
      .select()
      .single();

    if (feedError) {
      console.error("❌ Failed to create source feed entry:", feedError);
    } else {
      console.log("✅ Source feed created:", feedData.id);
    }

    // Create reference card
    console.log("💾 Creating reference card...");
    const insertData: any = {
      title: title.substring(0, 255),
      original_text: textContent,
      source_url: sourceUrl,
      source_type: type === "pdf" ? "pdf" : "manual",
      source_feed_id: feedData?.id,
      status: (type === "url" && contentBlocked) ? "needs_review" : "processing",
      global_relevance_score: 5,
      user_id: user_id,
      content_quality: contentQuality,
      content_warning: contentWarning,
    };

    if (question_set_id && question_set_id.trim() !== "") {
      insertData.question_set_id = question_set_id;
      console.log("✅ Adding question_set_id:", question_set_id);
    }

    const { data: cardData, error: insertError } = await supabase
      .from("reference_cards")
      .insert(insertData)
      .select()
      .single();

    if (insertError) {
      console.error("❌ Failed to create reference card:", insertError);
      return new Response(
        JSON.stringify({
          error: "Failed to create reference card",
          details: insertError.message,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log("✅ Reference card created:", cardData.id);

    // ✅ IMPROVED: Only auto-process if we have decent content
    if (!contentBlocked && textContent.length >= 100) {
      console.log("🚀 Triggering auto-processing for card:", cardData.id);
      try {
        const { error: processError } = await supabase.functions.invoke("process-reference-card", {
          body: { cardId: cardData.id },
        });

        if (processError) {
          console.error("⚠️ Auto-processing failed:", processError);
          await supabase.from("reference_cards").update({ status: "needs_review" }).eq("id", cardData.id);
        } else {
          console.log("✅ Auto-processing triggered successfully");
        }
      } catch (processInvokeError) {
        console.error("⚠️ Failed to invoke auto-processing:", processInvokeError);
      }
    } else {
      console.log("⏸️ Skipping auto-processing - insufficient content or blocked site");
    }

    console.log("🎉 create-manual-source completed successfully");
    return new Response(
      JSON.stringify({
        success: true,
        cardId: cardData.id,
        message: contentBlocked 
          ? "Reference card created (site blocked full access - manual review needed)"
          : "Reference card created successfully",
        contentStatus: contentBlocked ? "blocked" : "processed"
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("💥 CRITICAL Error in create-manual-source:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to create manual source",
        details: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
