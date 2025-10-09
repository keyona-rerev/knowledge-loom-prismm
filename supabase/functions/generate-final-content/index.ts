import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { direction, seedInsight, seedCategory, insightCardIds, userId } = await req.json();

    console.log("Generating final content with params:", { 
      direction: direction?.title, 
      seedCategory, 
      insightCardIdsCount: insightCardIds?.length,
      userId 
    });

    if (!direction || !seedInsight || !userId) {
      console.error("Missing required fields");
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    // Fetch selected insight cards if any
    let insightCardsData = [];
    if (insightCardIds && insightCardIds.length > 0) {
      const { data: insights, error: insightsError } = await supabaseClient
        .from("insight_cards")
        .select("title, content, insight_type")
        .in("id", insightCardIds)
        .eq("user_id", userId);

      if (insightsError) {
        console.error("Error fetching insight cards:", insightsError);
      } else {
        insightCardsData = insights || [];
        console.log(`Fetched ${insightCardsData.length} insight cards`);
      }
    }

    // Prepare the prompt for AI generation
    const prompt = createContentPrompt(direction, seedInsight, seedCategory, insightCardsData);

    // Call Lovable AI Gateway
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    console.log("Calling Lovable AI Gateway...");
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: "You are an expert content creator that crafts compelling, well-structured content pieces."
          },
          {
            role: "user",
            content: prompt
          }
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("AI API error:", aiResponse.status, errorText);
      
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required. Please add credits to your workspace." }),
          {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      
      throw new Error(`AI API error: ${aiResponse.status} - ${errorText}`);
    }

    const aiData = await aiResponse.json();
    console.log("AI response received successfully");
    
    const generatedContent = aiData.choices?.[0]?.message?.content;
    if (!generatedContent) {
      throw new Error("No content generated from AI");
    }

    // Parse the response to extract title and content
    const { title, content } = parseGeneratedContent(generatedContent, direction.title);

    console.log("Content generation complete");
    return new Response(
      JSON.stringify({
        title,
        content,
        direction,
        insightCardsUsed: insightCardsData.length,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in generate-final-content:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error occurred" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

function createContentPrompt(direction: any, seedInsight: string, seedCategory: string, insightCards: any[]) {
  let prompt = `Create a well-structured content piece based on the following direction:

CONTENT DIRECTION:
Title: ${direction.title}
Description: ${direction.description}
Angle: ${direction.angle}

SEED INSIGHT (${seedCategory}): ${seedInsight}

`;

  if (insightCards.length > 0) {
    prompt += "ADDITIONAL INSIGHTS TO INCORPORATE:\n";
    insightCards.forEach((insight, index) => {
      prompt += `${index + 1}. [${insight.insight_type}] ${insight.title}: ${insight.content}\n`;
    });
    prompt += "\n";
  }

  prompt += `Please generate a complete content piece with:
1. A compelling title (different from the direction title)
2. Engaging introduction that hooks the reader
3. Well-structured body that develops the core idea
4. Clear takeaways or conclusion
5. Natural incorporation of the seed insight and any additional insights

Format the response as:
TITLE: [Your generated title here]
CONTENT: [Your full content here, using markdown formatting for readability]

Make the content authentic, valuable, and aligned with the direction's angle.`;

  return prompt;
}

function parseGeneratedContent(generatedText: string, fallbackTitle: string) {
  let title = fallbackTitle;
  let content = generatedText;

  // Try to extract title if formatted properly
  const titleMatch = generatedText.match(/TITLE:\s*(.+?)(?:\n|$)/i);
  if (titleMatch) {
    title = titleMatch[1].trim();
    content = generatedText.replace(/TITLE:\s*.+?\n/i, "").trim();
  }

  // Remove CONTENT: prefix if present
  content = content.replace(/^CONTENT:\s*/i, "").trim();

  return { title, content };
}
