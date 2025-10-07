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

    const { seedInsight, seedCategory, userId } = await req.json();

    if (!seedInsight || !userId) {
      return new Response(
        JSON.stringify({ error: "seedInsight and userId are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get relevant reference cards
    const { data: cards } = await supabase
      .from("reference_cards")
      .select("title, ai_summary, insight_answers")
      .eq("user_id", userId)
      .eq("status", "active")
      .not("ai_summary", "is", null)
      .limit(10);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "AI API not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const contextCards = cards?.map(c => `${c.title}: ${c.ai_summary}`).join('\n\n') || "No reference cards available";

    const prompt = `Based on this seed insight and reference materials, generate 4 distinct content directions.

Seed Insight: ${seedInsight}
Category: ${seedCategory}

Reference Materials:
${contextCards}

Generate 4 unique angles/directions for developing this insight into content. Each should:
- Have a compelling title
- Include a 2-3 sentence description
- Suggest a unique angle or approach

Respond in JSON format:
{
  "directions": [
    {"title": "...", "description": "...", "angle": "..."},
    {"title": "...", "description": "...", "angle": "..."},
    {"title": "...", "description": "...", "angle": "..."},
    {"title": "...", "description": "...", "angle": "..."}
  ]
}`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a creative content strategist. Always respond with valid JSON." },
          { role: "user", content: prompt }
        ],
        response_format: { type: "json_object" }
      }),
    });

    if (!aiResponse.ok) {
      throw new Error(`AI request failed: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const result = JSON.parse(aiData.choices[0].message.content);

    return new Response(
      JSON.stringify(result),
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
