import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { cardId, templateId, outputFormat, userId } = await req.json();

    if (!cardId || !userId) {
      return new Response(
        JSON.stringify({ error: "cardId and userId are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    // Rate limiting: 100 content generations per hour per user
    const windowStart = new Date();
    windowStart.setMinutes(windowStart.getMinutes() - 60);
    
    const { count: rateCount, error: rateError } = await supabaseClient
      .from('rate_limit_logs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('action', 'generate_content')
      .gte('created_at', windowStart.toISOString());
    
    if (!rateError && (rateCount || 0) >= 100) {
      console.log('❌ Rate limit exceeded for user:', userId);
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded. Maximum 100 content generations per hour.' }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    // Log this rate limit action
    await supabaseClient.from('rate_limit_logs').insert({ user_id: userId, action: 'generate_content' });

    // Fetch user's AI preferences, content type templates, and business context
    const { data: profile, error: profileError } = await supabaseClient
      .from("profiles")
      .select("ai_provider, ai_model, google_ai_api_key, custom_ai_endpoint, custom_ai_model_name, content_type_templates, writing_examples, business_name, business_description, target_audience")
      .eq("user_id", userId)
      .single();

    if (profileError || !profile) {
      return new Response(
        JSON.stringify({ error: "User profile not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate AI configuration based on provider
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

    console.log("🔄 Generating content from card:", cardId, "with template:", templateId, "using", profile.ai_provider);

    // Get reference card with insights
    const { data: card, error: cardError } = await supabaseClient
      .from("reference_cards")
      .select(`
        *,
        source_feeds (
          name,
          credibility_score
        )
      `)
      .eq("id", cardId)
      .single();

    if (cardError || !card) {
      console.error("❌ Card not found:", cardError);
      throw new Error("Reference card not found");
    }

    // Get content type template from user profile if provided
    let contentTypeTemplate = null;
    if (templateId && profile?.content_type_templates) {
      contentTypeTemplate = (profile.content_type_templates as any[])?.find(
        (t: any) => t.id === templateId || t.name.toLowerCase().replace(/\s+/g, '_') === templateId
      );
    }

    // Prepare AI prompt with template, writing examples, and business context
    const prompt = createContentPrompt(
      card, 
      contentTypeTemplate, 
      outputFormat, 
      profile.writing_examples,
      profile.business_name,
      profile.business_description,
      profile.target_audience
    );

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
              parts: [{ text: prompt }]
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

    } else {
      // Use Lovable AI (default/fallback for "lovable-ai" or undefined)
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      if (!LOVABLE_API_KEY) {
        return new Response(
          JSON.stringify({ error: "AI API not configured. Please configure an AI provider in Settings." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "user", content: prompt }
          ],
        }),
      });

      if (!aiResponse.ok) {
        const errorText = await aiResponse.text();
        console.error("Lovable AI API error:", aiResponse.status, errorText);
        throw new Error(`AI processing failed: ${aiResponse.status}`);
      }

      const aiData = await aiResponse.json();
      generatedContent = aiData.choices?.[0]?.message?.content ?? "";
    }

    // Parse the response to extract title and content
    const { title, content } = parseGeneratedContent(generatedContent, card.title);

    console.log("✅ Content generated successfully using template:", contentTypeTemplate?.name || 'default');

    return new Response(
      JSON.stringify({
        title,
        content,
        sourceCard: {
          id: card.id,
          title: card.title,
          source: card.source_feeds?.name
        },
        templateUsed: contentTypeTemplate?.name || "manual"
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error("Error in generate-content-from-card:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

function createContentPrompt(
  card: any, 
  contentTypeTemplate: any, 
  outputFormat: string, 
  writingExamples: any[],
  businessName?: string,
  businessDescription?: string,
  targetAudience?: string
) {
  const primaryInsight = card.insight_answers ? Object.values(card.insight_answers)[0] : card.ai_summary;
  
  let prompt = `Create content based on this reference material:

SOURCE MATERIAL:
Title: ${card.title}
Source: ${card.source_feeds?.name || 'Unknown'}
Primary Insight: "${primaryInsight || 'No specific insight'}"

ADDITIONAL INSIGHTS:
${card.insight_answers ? Object.entries(card.insight_answers).map(([key, value]) => `• ${value}`).join('\n') : 'No additional insights'}

`;

  // Add business context
  if (businessName || businessDescription || targetAudience) {
    prompt += `\n==== BUSINESS CONTEXT ====\n`;
    if (businessName) prompt += `Business: ${businessName}\n`;
    if (businessDescription) prompt += `About: ${businessDescription}\n`;
    if (targetAudience) prompt += `Target Audience: ${targetAudience}\n`;
    prompt += `\nIMPORTANT: Write from this business's perspective and keep this audience sharply in focus. The content should be relevant and valuable for them specifically.\n=================================\n\n`;
  }

  // Add content type template guidelines if available
  if (contentTypeTemplate && contentTypeTemplate.prompt) {
    prompt += `\n==== CONTENT TYPE REQUIREMENTS ====
${contentTypeTemplate.name} Guidelines:
${contentTypeTemplate.prompt}

CRITICAL: Follow these guidelines exactly for structure, tone, length, and formatting.
=================================\n\n`;
  }

  // Add writing style examples if available
  if (writingExamples && Array.isArray(writingExamples)) {
    const validExamples = writingExamples.filter((ex: string) => ex && ex.trim().length > 0);
    if (validExamples.length > 0) {
      prompt += `\n==== WRITING VOICE REFERENCE ====
Match the tone and style from these examples (use style only, not content):
${validExamples.slice(0, 2).map((ex: string, i: number) => `\nExample ${i + 1}:\n${ex.substring(0, 300)}...`).join('\n')}
=================================\n\n`;
    }
  }

  prompt += `
Generate a COMPLETE, READY-TO-PUBLISH content piece with:
1. Compelling title
2. Engaging introduction
3. Well-developed body
4. Clear conclusion
${contentTypeTemplate ? `5. Following ${contentTypeTemplate.name} requirements exactly` : '5. Natural flow and readability'}

Format as:
TITLE: [Generated title]
CONTENT: [Complete content in markdown]

${contentTypeTemplate ? `Remember: Follow the ${contentTypeTemplate.name} content type requirements precisely.` : `Make it suitable for ${outputFormat} format.`}`;

  return prompt;
}

function parseGeneratedContent(generatedText: string, fallbackTitle: string) {
  let title = fallbackTitle;
  let content = generatedText;

  const titleMatch = generatedText.match(/TITLE:\s*(.+?)(?:\n|$)/i);
  if (titleMatch) {
    title = titleMatch[1].trim();
    content = generatedText.replace(/TITLE:\s*.+?\n/i, "").trim();
  }

  content = content.replace(/^CONTENT:\s*/i, "").trim();
  return { title, content };
}
