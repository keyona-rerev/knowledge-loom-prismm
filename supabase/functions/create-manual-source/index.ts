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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { type, url, user_id } = await req.json();

    if (type !== "url" || !url) {
      return new Response(
        JSON.stringify({ error: "Only URL type is supported currently" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Fetching content from:", url);

    // Fetch article content
    const articleResponse = await fetch(url);
    if (!articleResponse.ok) {
      throw new Error(`Failed to fetch URL: ${articleResponse.status}`);
    }
    
    const articleHtml = await articleResponse.text();

    // Extract title and text
    const titleMatch = /<title>(.*?)<\/title>/i.exec(articleHtml);
    const title = titleMatch?.[1] || "Untitled Article";
    
    // Remove HTML tags for content
    const textContent = articleHtml
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    console.log("Extracted title:", title);
    console.log("Content length:", textContent.length);

    // Create entry in source_feeds for tracking manual sources
    const { data: feedData, error: feedError } = await supabase
      .from("source_feeds")
      .insert({
        name: title,
        url: url,
        feed_type: "manual",
        is_active: true,
        credibility_score: 5,
        user_id: user_id
      })
      .select()
      .single();

    if (feedError) {
      console.error("Failed to create source feed entry:", feedError);
    }

    // Create reference card
    const { data: cardData, error: insertError } = await supabase
      .from("reference_cards")
      .insert({
        title,
        original_text: textContent,
        source_url: url,
        source_type: "manual",
        source_feed_id: feedData?.id,
        status: "processing",
        global_relevance_score: 5,
        user_id: user_id
      })
      .select()
      .single();

    if (insertError) {
      console.error("Failed to create reference card:", insertError);
      throw insertError;
    }

    console.log("Successfully created reference card:", cardData?.id);

    // Auto-process the card immediately
    console.log("Triggering auto-processing for card:", cardData.id);
    const { error: processError } = await supabase.functions.invoke("process-reference-card", {
      body: { cardId: cardData.id }
    });

    if (processError) {
      console.error("Failed to trigger auto-processing:", processError);
      // Don't throw - we still created the card, just log the error
    }

    return new Response(
      JSON.stringify({ success: true, cardId: cardData?.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in create-manual-source:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
