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

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const requestBody = await req.json();
    console.log("📦 Request body:", requestBody);

    // ✅ UPDATED: Include question_set_id
    const { type, url, user_id, question_set_id } = requestBody;

    if (!user_id) {
      console.error("❌ Missing user_id");
      return new Response(JSON.stringify({ error: "Authentication required - user_id missing" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (type !== "url" || !url) {
      console.log("❌ Invalid parameters:", { type, url });
      return new Response(JSON.stringify({ error: "Only URL type is supported currently" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("🌐 Fetching content from:", url);

    // Fetch article content
    let articleResponse;
    try {
      articleResponse = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; InsightForge/1.0)",
        },
      });
      console.log("📄 Response status:", articleResponse.status);

      if (!articleResponse.ok) {
        throw new Error(`HTTP ${articleResponse.status}: ${articleResponse.statusText}`);
      }
    } catch (fetchError) {
      console.error("❌ Fetch failed:", fetchError);
      return new Response(JSON.stringify({ error: `Failed to fetch URL: ${fetchError instanceof Error ? fetchError.message : 'Unknown error'}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const articleHtml = await articleResponse.text();
    console.log("📝 HTML content length:", articleHtml.length);

    if (!articleHtml || articleHtml.length < 100) {
      console.error("❌ Insufficient content fetched");
      return new Response(JSON.stringify({ error: "Could not fetch sufficient content from URL" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract title and text
    const titleMatch = /<title>(.*?)<\/title>/i.exec(articleHtml);
    const title = titleMatch?.[1]?.trim() || "Untitled Article";
    console.log("📌 Extracted title:", title);

    // Remove HTML tags for content
    const textContent = articleHtml
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 10000);

    console.log("📄 Clean content length:", textContent.length);

    if (textContent.length < 50) {
      console.error("❌ Insufficient text content after cleaning");
      return new Response(JSON.stringify({ error: "Could not extract sufficient text content from URL" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create source feed entry
    console.log("💾 Creating source feed entry...");
    const { data: feedData, error: feedError } = await supabase
      .from("source_feeds")
      .insert({
        name: title.substring(0, 255),
        url: url,
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

    // ✅ UPDATED: Create reference card WITH question_set_id
    console.log("💾 Creating reference card with question_set_id:", question_set_id);
    const insertData: any = {
      title: title.substring(0, 255),
      original_text: textContent,
      source_url: url,
      source_type: "manual",
      source_feed_id: feedData?.id,
      status: "processing",
      global_relevance_score: 5,
      user_id: user_id,
    };

    // Only add question_set_id if it's provided and not empty
    if (question_set_id && question_set_id.trim() !== "") {
      insertData.question_set_id = question_set_id;
      console.log("✅ Adding question_set_id:", question_set_id);
    } else {
      console.log("ℹ️ No question_set_id provided, using NULL");
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

    // Auto-process the card
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

    console.log("🎉 create-manual-source completed successfully");
    return new Response(
      JSON.stringify({
        success: true,
        cardId: cardData.id,
        message: "Reference card created successfully",
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