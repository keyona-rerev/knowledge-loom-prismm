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
    const { direction, seedInsight, seedCategory, insightCardIds, userId, templateId } = await req.json();

    console.log("Generating final content with params:", { 
      direction: direction?.title, 
      seedCategory, 
      insightCardIdsCount: insightCardIds?.length,
      userId,
      templateId
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

    // Initialize Supabase client first to fetch profile
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    // Fetch user's AI preferences
    const { data: profile, error: profileError } = await supabaseClient
      .from("profiles")
      .select("ai_provider, ai_model, google_ai_api_key, custom_ai_endpoint, custom_ai_model_name")
      .eq("user_id", userId)
      .single();

    if (profileError || !profile) {
      return new Response(
        JSON.stringify({ error: "User profile not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (profile.ai_provider === "google-ai" && !profile.google_ai_api_key) {
      return new Response(
        JSON.stringify({ error: "Google AI API key not configured. Please add it in Settings." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (profile.ai_provider === "custom" && (!profile.custom_ai_endpoint || !profile.google_ai_api_key)) {
      return new Response(
        JSON.stringify({ error: "Custom AI provider not fully configured. Please check Settings." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

    // Fetch template if provided
    let template = null;
    if (templateId) {
      const { data: templateData, error: templateError } = await supabaseClient
        .from("content_templates")
        .select("*")
        .eq("id", templateId)
        .single();
      
      if (!templateError && templateData) {
        template = templateData;
        console.log(`Using template: ${template.name}`);
      }
    }

    // Prepare the prompt for AI generation
    const prompt = createContentPrompt(direction, seedInsight, seedCategory, insightCardsData);

    console.log(`Calling AI with provider: ${profile.ai_provider}, model: ${profile.ai_model}`);

    // Call AI based on user's provider preference
    let generatedContent;
    if (profile.ai_provider === "google-ai") {
      const aiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${profile.ai_model}:generateContent?key=${profile.google_ai_api_key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: `System: You are an expert content creator that crafts compelling, well-structured content pieces.\n\nUser: ${prompt}` }]
            }],
            generationConfig: {
              temperature: 1,
              topK: 40,
              topP: 0.95,
              maxOutputTokens: 8192,
            }
          }),
        }
      );

      if (!aiResponse.ok) {
        const errorText = await aiResponse.text();
        console.error("Google AI API error:", aiResponse.status, errorText);
        
        if (aiResponse.status === 429) {
          return new Response(
            JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        
        throw new Error(`Google AI API error: ${aiResponse.status}`);
      }

      const aiData = await aiResponse.json();
      generatedContent = aiData.candidates[0].content.parts[0].text;
      
    } else if (profile.ai_provider === "custom") {
      const aiResponse = await fetch(profile.custom_ai_endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${profile.google_ai_api_key}`,
        },
        body: JSON.stringify({
          model: profile.custom_ai_model_name,
          messages: [
            { role: "system", content: "You are an expert content creator that crafts compelling, well-structured content pieces." },
            { role: "user", content: prompt }
          ],
        }),
      });

      if (!aiResponse.ok) {
        const errorText = await aiResponse.text();
        console.error("Custom AI API error:", aiResponse.status, errorText);
        throw new Error(`Custom AI API error: ${aiResponse.status}`);
      }

      const aiData = await aiResponse.json();
      generatedContent = aiData.choices[0].message.content;
    }

    if (!generatedContent) {
      throw new Error("No content generated from AI");
    }

    console.log("AI response received successfully");

    // Parse the response to extract title and content
    const { title, content } = parseGeneratedContent(generatedContent, direction.title);

    console.log("Content generation complete");
    return new Response(
      JSON.stringify({
        title,
        content,
        direction,
        insightCardsUsed: insightCardsData.length,
        templateUsed: template?.name || "none"
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
    insightCards.forEach((insight: any, index: number) => {
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