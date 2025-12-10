import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    return new Response(null, { headers: corsHeaders });
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
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { cardId, customQuestion } = await req.json();

    if (!cardId) {
      return new Response(
        JSON.stringify({ error: "cardId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Processing card:", cardId, "Custom question:", customQuestion ? "Yes" : "No");

    // Get card - verify it belongs to the authenticated user
    const { data: card, error: cardError } = await supabase
      .from("reference_cards")
      .select("*, reference_card_templates(custom_questions)")
      .eq("id", cardId)
      .eq("user_id", userId)
      .single();

    if (cardError || !card) {
      console.error("❌ Card not found or access denied:", cardError);
      return new Response(
        JSON.stringify({ error: "Card not found or access denied" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Rate limiting: 100 card processings per hour per user
    const windowStart = new Date();
    windowStart.setMinutes(windowStart.getMinutes() - 60);
    
    const { count: rateCount, error: rateError } = await supabase
      .from('rate_limit_logs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('action', 'process_card')
      .gte('created_at', windowStart.toISOString());
    
    if (!rateError && (rateCount || 0) >= 100) {
      console.log('❌ Rate limit exceeded for user:', userId);
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded. Maximum 100 card processings per hour.' }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Daily limit: 500 card processings per day
    const dayStart = new Date();
    dayStart.setHours(dayStart.getHours() - 24);
    
    const { count: dailyCount } = await supabase
      .from('rate_limit_logs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('action', 'process_card')
      .gte('created_at', dayStart.toISOString());
    
    if ((dailyCount || 0) >= 500) {
      console.log('❌ Daily limit exceeded for user:', userId);
      return new Response(
        JSON.stringify({ error: 'Daily limit exceeded. Maximum 500 card processings per day.' }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log this attempt for rate limiting
    await supabase.from('rate_limit_logs').insert({
      user_id: userId,
      action: 'process_card'
    });

    // Get user's AI preferences
    const { data: profile } = await supabase
      .from("profiles")
      .select("ai_provider, ai_model, google_ai_api_key, custom_ai_endpoint, custom_ai_model_name")
      .eq("user_id", userId)
      .single();

    // Build questions list
    let questions: string[] = [];
    
    if (customQuestion) {
      questions = [customQuestion];
    } else if (card.question_set_id) {
      // Get questions from assigned question set
      const { data: questionSet } = await supabase
        .from("question_sets")
        .select("questions")
        .eq("id", card.question_set_id)
        .single();
      
      if (questionSet?.questions) {
        questions = questionSet.questions;
      }
    } else if (card.reference_card_templates?.custom_questions) {
      // Get questions from template
      const templateQuestions = card.reference_card_templates.custom_questions as string[];
      if (Array.isArray(templateQuestions)) {
        questions = templateQuestions;
      }
    }
    
    // Default questions if none found
    if (questions.length === 0) {
      // Try to get user's active question set
      const { data: activeSet } = await supabase
        .from("question_sets")
        .select("questions")
        .eq("user_id", userId)
        .eq("is_active", true)
        .limit(1)
        .single();
      
      if (activeSet?.questions) {
        questions = activeSet.questions;
      } else {
        questions = [
          "What is the main argument or thesis?",
          "What evidence or examples support it?",
          "How is this relevant to my work?"
        ];
      }
    }

    // Assess content quality
    const contentLength = card.original_text?.length || 0;
    let contentQuality = "unknown";
    let contentWarning = null;

    if (contentLength < 100) {
      contentQuality = "low";
      contentWarning = "Very short content - may lack substance";
    } else if (contentLength < 500) {
      contentQuality = "medium";
    } else {
      contentQuality = "high";
    }

    // Build AI prompt
    const prompt = `You are analyzing content to extract insights. Analyze this content and provide a summary plus answers to specific questions.

Content to analyze:
Title: ${card.title || "Untitled"}
Source: ${card.source_url || "Unknown"}

${card.original_text || "No content available"}

---

Please provide:
1. A brief 2-3 sentence summary of the main points
2. Answers to these questions:
${questions.map((q, i) => `   ${i + 1}. ${q}`).join("\n")}

Format your response as JSON:
{
  "summary": "Your 2-3 sentence summary here",
  "answers": {
    "${questions[0]}": "Answer to first question",
    ${questions.slice(1).map(q => `"${q}": "Answer"`).join(",\n    ")}
  }
}`;

    console.log("🤖 Calling AI with provider:", profile?.ai_provider || "lovable-ai");

    let result;

    if (profile?.ai_provider === "google-ai" && profile.google_ai_api_key) {
      const aiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${profile.ai_model || "gemini-1.5-flash"}:generateContent?key=${profile.google_ai_api_key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: prompt }]
            }],
            generationConfig: {
              temperature: 0.3,
              topK: 40,
              topP: 0.95,
              maxOutputTokens: 4096,
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
      const generatedText = aiData.candidates?.[0]?.content?.parts?.[0]?.text || "";
      result = parseAIJsonResponse(generatedText, "process-reference-card");

    } else if (profile?.ai_provider === "custom" && profile.custom_ai_endpoint) {
      const aiResponse = await fetch(profile.custom_ai_endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${profile.google_ai_api_key}`,
        },
        body: JSON.stringify({
          model: profile.custom_ai_model_name,
          messages: [
            { role: "system", content: "You are a content analyst. Always respond with valid JSON." },
            { role: "user", content: prompt }
          ],
          response_format: { type: "json_object" }
        }),
      });

      if (!aiResponse.ok) {
        throw new Error(`Custom AI API error: ${aiResponse.status}`);
      }

      const aiData = await aiResponse.json();
      const generatedText = aiData.choices[0].message.content;
      result = parseAIJsonResponse(generatedText, "process-reference-card");

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
            { role: "system", content: "You are a content analyst. Always respond with valid JSON." },
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
      result = parseAIJsonResponse(generatedText, "process-reference-card");
    }

    // Handle custom questions - merge with existing answers
    let updatedAnswers = result.answers || {};
    if (customQuestion && card.insight_answers) {
      const existingAnswers = typeof card.insight_answers === 'object' ? card.insight_answers : {};
      updatedAnswers = {
        ...existingAnswers,
        [`[Custom - ${new Date().toLocaleDateString()}] ${customQuestion}`]: 
          result.answers?.[customQuestion] || Object.values(result.answers || {})[0] || ""
      };
    }

    // Update the card with AI results
    const { error: updateError } = await supabase
      .from("reference_cards")
      .update({
        ai_summary: result.summary,
        insight_answers: updatedAnswers,
        content_quality: contentQuality,
        content_warning: contentWarning,
        status: "active",
        updated_at: new Date().toISOString()
      })
      .eq("id", cardId);

    if (updateError) {
      console.error("❌ Failed to update card:", updateError);
      throw updateError;
    }

    console.log("✅ Card processed successfully:", cardId);

    return new Response(
      JSON.stringify({
        success: true,
        cardId,
        summary: result.summary,
        answers: updatedAnswers,
        quality: contentQuality
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("💥 Error processing card:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
