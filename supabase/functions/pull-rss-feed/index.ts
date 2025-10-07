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

    const { feedId } = await req.json();

    if (!feedId) {
      return new Response(
        JSON.stringify({ error: "feedId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get feed details with default template
    const { data: feed, error: feedError } = await supabase
      .from("source_feeds")
      .select("*, default_template_id, user_id")
      .eq("id", feedId)
      .single();

    if (feedError || !feed) {
      return new Response(
        JSON.stringify({ error: "Feed not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch RSS feed
    const rssResponse = await fetch(feed.url);
    const rssText = await rssResponse.text();

    // Parse RSS
    const items = parseRSS(rssText);
    const createdCardIds = [];

    // Create reference cards with full content fetching
    for (const item of items.slice(0, 5)) {
      let fullContent = item.description;
      
      // Fetch full article content if link exists
      if (item.link) {
        try {
          const articleResponse = await fetch(item.link);
          const articleHtml = await articleResponse.text();
          
          // Extract text content (remove scripts, styles, HTML tags)
          fullContent = articleHtml
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        } catch (error) {
          console.error("Failed to fetch full article:", error);
        }
      }

      const { data: cardData, error: insertError } = await supabase
        .from("reference_cards")
        .insert({
          title: item.title,
          original_text: fullContent,
          source_url: item.link,
          source_type: "rss",
          source_feed_id: feedId,
          template_id: feed.default_template_id,
          status: "processing",
          global_relevance_score: 5,
          user_id: feed.user_id
        })
        .select()
        .single();

      if (insertError) {
        console.error("Failed to insert reference card:", insertError);
      } else if (cardData) {
        createdCardIds.push(cardData.id);
      }
    }

    // Auto-process all created cards
    console.log("Triggering auto-processing for", createdCardIds.length, "cards");
    for (const cardId of createdCardIds) {
      try {
        const { error: processError } = await supabase.functions.invoke("process-reference-card", {
          body: { cardId }
        });
        if (processError) {
          console.error("Failed to process card", cardId, ":", processError);
        }
      } catch (error) {
        console.error("Error processing card", cardId, ":", error);
      }
    }

    // Update feed last_pulled_at
    await supabase
      .from("source_feeds")
      .update({ 
        last_pulled_at: new Date().toISOString(),
        last_successful_pull_at: new Date().toISOString()
      })
      .eq("id", feedId);

    return new Response(
      JSON.stringify({ success: true, itemsCreated: createdCardIds.length, cardIds: createdCardIds }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Simplified RSS parser
function parseRSS(xmlText: string) {
  const items: Array<{ title: string; description: string; link: string }> = [];
  
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xmlText)) !== null) {
    const itemContent = match[1];
    
    const titleMatch = /<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/.exec(itemContent);
    const descMatch = /<description><!\[CDATA\[(.*?)\]\]><\/description>|<description>(.*?)<\/description>/.exec(itemContent);
    const linkMatch = /<link>(.*?)<\/link>/.exec(itemContent);

    items.push({
      title: titleMatch?.[1] || titleMatch?.[2] || "Untitled",
      description: (descMatch?.[1] || descMatch?.[2] || "").substring(0, 500),
      link: linkMatch?.[1] || "",
    });
  }

  return items;
}
