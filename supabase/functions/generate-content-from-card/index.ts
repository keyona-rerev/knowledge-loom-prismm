import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Universal AI JSON response parser - handles any AI provider's response format
function parseAIJsonResponse(text: string, functionName: string): any {
  let content = text.trim();
  
  // Strip markdown code fences (handles ```json, ```, ```javascript, etc.)
  const fenceMatch = content.match(/```(?:\w*)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    content = fenceMatch[1].trim();
  }
  
  // Try to find JSON object or array if there's extra text
  const jsonMatch = content.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    content = jsonMatch[1];
  }
  
  try {
    return JSON.parse(content);
  } catch (error) {
    console.error(`[${functionName}] Failed to parse AI JSON response:`, content.slice(0, 500));
    throw new Error("AI returned invalid JSON format");
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    // Verify user authentication from JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("❌ Missing authorization header");
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const supabaseAuth = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
    
    if (authError || !user) {
      console.error("❌ Invalid token:", authError?.message);
      return new Response(
        JSON.stringify({ error: "Invalid or expired authentication token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = user.id;
    console.log("✅ Authenticated user:", userId);

    // Use service role client for database operations
    const supabaseClient = createClient(supabaseUrl, serviceRoleKey);

    const { cardId, templateId, outputFormat } = await req.json();

    if (!cardId) {
      return new Response(
        JSON.stringify({ error: "cardId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

    // Log this attempt for rate limiting
    await supabaseClient.from('rate_limit_logs').insert({
      user_id: userId,
      action: 'generate_content'
    });

    // Get reference card - verify it belongs to the authenticated user
    const { data: card, error: cardError } = await supabaseClient
      .from("reference_cards")
      .select("*")
      .eq("id", cardId)
      .eq("user_id", userId)
      .single();

    if (cardError || !card) {
      console.error("❌ Card not found or access denied:", cardError);
      return new Response(
        JSON.stringify({ error: "Reference card not found or access denied" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user's AI preferences and business context
    const { data: profile } = await supabaseClient
      .from("profiles")
      .select("ai_provider, ai_model, google_ai_api_key, custom_ai_endpoint, custom_ai_model_name, brand_voice, writing_examples, business_name, business_description, target_audience, content_type_templates")
      .eq("user_id", userId)
      .single();

    if (!profile) {
      return new Response(
        JSON.stringify({ error: "Profile not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate AI configuration
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

    // Get content template if specified
    let templatePrompt = "";
    if (templateId) {
      const { data: template } = await supabaseClient
        .from("content_templates")
        .select("*")
        .eq("id", templateId)
        .single();
      if (template) {
        templatePrompt = `\n\nContent Template Structure:\n${JSON.stringify(template.template_structure)}`;
      }
    }

    // Get content type template from user's profile settings
    let contentTypePrompt = "";
    if (outputFormat && profile.content_type_templates) {
      const templates = profile.content_type_templates as Array<{ id: string; name: string; prompt: string }>;
      const matchingTemplate = templates.find(t => t.id === outputFormat);
      if (matchingTemplate?.prompt) {
        contentTypePrompt = `\n\nCONTENT TYPE GUIDELINES:\n${matchingTemplate.prompt}`;
      }
    }

    // Build writing style context from examples
    let writingStyleContext = "";
    if (profile.writing_examples && Array.isArray(profile.writing_examples) && profile.writing_examples.length > 0) {
      writingStyleContext = "\n\nWRITING STYLE EXAMPLES (mimic this tone, structure, and voice - but NOT the content):\n";
      profile.writing_examples.slice(0, 4).forEach((example: { content: string }, i: number) => {
        if (example.content) {
          writingStyleContext += `\n--- Example ${i + 1} ---\n${example.content.substring(0, 1000)}\n`;
        }
      });
      writingStyleContext += "\nIMPORTANT: Learn the STYLE from these examples (sentence structure, tone, vocabulary, formatting patterns) but create ORIGINAL content based on the reference card.\n";
    }

    // Build business context
    let businessContext = "";
    if (profile.business_name || profile.business_description || profile.target_audience) {
      businessContext = "\n\nBUSINESS CONTEXT:\n";
      if (profile.business_name) businessContext += `Business: ${profile.business_name}\n`;
      if (profile.business_description) businessContext += `About: ${profile.business_description}\n`;
      if (profile.target_audience) businessContext += `Target Audience: ${profile.target_audience}\n`;
      businessContext += "\nIMPORTANT: Write from this business's perspective specifically for this target audience.\n";
    }

    // Build insight answers context
    let insightContext = "";
    if (card.insight_answers && typeof card.insight_answers === "object") {
      insightContext = "\n\nKEY INSIGHTS FROM SOURCE:\n";
      Object.entries(card.insight_answers).forEach(([question, answer]) => {
        insightContext += `Q: ${question}\nA: ${answer}\n\n`;
      });
    }

    const prompt = `Generate professional content based on this reference card.

Source Material:
Title: ${card.title}
Summary: ${card.ai_summary || "No summary available"}
${insightContext}

Output Format: ${outputFormat || "blog_post"}
${profile.brand_voice ? `Brand Voice: ${profile.brand_voice}` : ""}
${templatePrompt}
${contentTypePrompt}
${writingStyleContext}
${businessContext}

Create a compelling ${outputFormat || "blog post"} that:
1. Has an engaging title
2. Provides valuable insights from the source material
3. Is well-structured with clear sections
4. Maintains professional tone throughout
${profile.brand_voice ? `5. Follows the brand voice: ${profile.brand_voice}` : ""}
${profile.target_audience ? `6. Is specifically written to be valuable for: ${profile.target_audience}` : ""}

Respond in JSON format:
{
  "title": "Generated title",
  "content": "Full formatted content with markdown"
}`;

    console.log("🤖 Calling AI with provider:", profile.ai_provider);

    let result;
    if (profile.ai_provider === "google-ai") {
      const aiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${profile.ai_model}:generateContent?key=${profile.google_ai_api_key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: `System: You are a professional content writer. Always respond with valid JSON.\n\nUser: ${prompt}` }]
            }],
            generationConfig: {
              temperature: 0.7,
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
      const generatedText = aiData.candidates[0].content.parts[0].text;
      result = parseAIJsonResponse(generatedText, "generate-content-from-card");

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
            { role: "system", content: "You are a professional content writer. Always respond with valid JSON." },
            { role: "user", content: prompt }
          ],
          response_format: { type: "json_object" }
        }),
      });

      if (!aiResponse.ok) {
        const errorText = await aiResponse.text();
        console.error("Custom AI API error:", aiResponse.status, errorText);
        throw new Error(`Custom AI API error: ${aiResponse.status}`);
      }

      const aiData = await aiResponse.json();
      const generatedText = aiData.choices[0].message.content;
      result = parseAIJsonResponse(generatedText, "generate-content-from-card");

    } else {
      // Use Lovable AI (default/fallback)
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
            { role: "system", content: "You are a professional content writer. Always respond with valid JSON." },
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
      const generatedText = aiData.choices?.[0]?.message?.content ?? "";
      result = parseAIJsonResponse(generatedText, "generate-content-from-card");
    }

    console.log("✅ Content generated successfully");

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("💥 Error in generate-content-from-card:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
