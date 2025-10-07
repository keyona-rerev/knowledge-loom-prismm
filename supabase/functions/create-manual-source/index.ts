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

    const { type, url } = await req.json();

    if (type !== "url" || !url) {
      return new Response(
        JSON.stringify({ error: "Only URL type is supported currently" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch article content (simplified)
    const articleResponse = await fetch(url);
    const articleHtml = await articleResponse.text();

    // Extract title and text (very simplified - use proper HTML parser in production)
    const titleMatch = /<title>(.*?)<\/title>/i.exec(articleHtml);
    const title = titleMatch?.[1] || "Untitled Article";
    
    // Remove HTML tags for content
    const textContent = articleHtml
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 1000);

    // Create reference card
    const { error: insertError } = await supabase
      .from("reference_cards")
      .insert({
        title,
        original_text: textContent,
        source_url: url,
        source_type: "manual",
        status: "needs_review",
        global_relevance_score: 5,
      });

    if (insertError) {
      throw insertError;
    }

    return new Response(
      JSON.stringify({ success: true }),
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
