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

    const { cardId, customQuestion } = await req.json();

    if (!cardId) {
      return new Response(
        JSON.stringify({ error: "cardId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Processing card:", cardId, "Custom question:", customQuestion ? "Yes" : "No");

    // Get card first to get user_id for rate limiting
    const { data: card, error: cardError } = await supabase
      .from("reference_cards")
      .select("*, reference_card_templates(custom_questions)")
      .eq("id", cardId)
      .single();

    if (cardError || !card) {
      console.error("Card not found:", cardError);
      return new Response(
        JSON.stringify({ error: "Card not found: " + (cardError?.message || "Unknown") }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Rate limiting: 100 card processings per hour per user
    if (card.user_id) {
      const windowStart = new Date();
      windowStart.setMinutes(windowStart.getMinutes() - 60);
      
      const { count: rateCount, error: rateError } = await supabase
        .from('rate_limit_logs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', card.user_id)
        .eq('action', 'process_card')
        .gte('created_at', windowStart.toISOString());
      
      if (!rateError && (rateCount || 0) >= 100) {
        console.log('❌ Rate limit exceeded for user:', card.user_id);
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Maximum 100 card processings per hour.' }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      // Log this rate limit action
      await supabase.from('rate_limit_logs').insert({ user_id: card.user_id, action: 'process_card' });
    }

    console.log("Card found:", card.title);

    // Fetch user's AI preferences
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("ai_provider, ai_model, google_ai_api_key, custom_ai_endpoint, custom_ai_model_name")
      .eq("user_id", card.user_id)
      .single();

    if (profileError) {
      console.error("Profile fetch error:", profileError);
    }

    // Get questions from question_set_id or use custom question
    let questions: string[] = [];
    let isCustomQuestion = false;

    if (customQuestion && customQuestion.trim()) {
      // Use the custom question
      questions = [customQuestion.trim()];
      isCustomQuestion = true;
      console.log("Using custom question:", customQuestion);
    } else if (card.question_set_id) {
      console.log("Using question set:", card.question_set_id);
      const { data: questionSet, error: questionSetError } = await supabase
        .from("question_sets")
        .select("questions")
        .eq("id", card.question_set_id)
        .single();

      if (questionSetError) {
        console.error("Question set fetch error:", questionSetError);
      } else if (questionSet?.questions && Array.isArray(questionSet.questions)) {
        questions = questionSet.questions.filter((q: any) => typeof q === "string" && q.trim());
        console.log("Loaded questions from question set:", questions.length);
      }
    }

    console.log("Questions found:", questions.length);

    // Check for content quality issues
    let contentWarning = null;
    let contentQuality = "good";

    if (!card.original_text || card.original_text.trim().length < 100) {
      contentWarning = "Limited content available - only title accessible";
      contentQuality = "title_only";
    } else if (card.original_text.length < 500) {
      contentWarning = "Partial content - full article may not be accessible";
      contentQuality = "partial";
    }

    // Generate summary and optionally answer questions
    let prompt = `Analyze the article and provide a concise summary (2-3 sentences).
Article Title: ${card.title}
Content: ${card.original_text}

Return ONLY valid JSON without code fences or any commentary.`;

    if (questions.length > 0) {
      prompt += `

Also answer these questions based strictly on the content:
${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Your JSON response schema:
{
  "summary": "your summary",
  "answers": {
    "0": "answer to question 1",
    "1": "answer to question 2"
  }
}`;
    } else {
      prompt += `

Your JSON response schema:
{
  "summary": "your summary"
}`;
    }

    console.log("Calling AI API with provider:", profile?.ai_provider || "lovable-ai");

    try {
      let aiResponseData;

      // Determine which AI provider to use
      if (profile?.ai_provider === "google-ai" && profile.google_ai_api_key) {
        // Use Google AI
        const aiResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${profile.ai_model || 'gemini-2.0-flash-exp'}:generateContent?key=${profile.google_ai_api_key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{
                parts: [{ text: `System: You are a content analyst. Always respond with valid JSON.\n\nUser: ${prompt}` }]
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
        aiResponseData = aiData.candidates[0].content.parts[0].text;

      } else if (profile?.ai_provider === "custom" && profile.custom_ai_endpoint && profile.google_ai_api_key) {
        // Use Custom AI
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
          }),
        });

        if (!aiResponse.ok) {
          const errorText = await aiResponse.text();
          console.error("Custom AI API error:", aiResponse.status, errorText);
          throw new Error(`Custom AI API error: ${aiResponse.status}`);
        }

        const aiData = await aiResponse.json();
        aiResponseData = aiData.choices[0].message.content;

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
          throw new Error(`AI processing failed: ${aiResponse.status} - ${errorText}`);
        }

        const aiData = await aiResponse.json();
        aiResponseData = aiData.choices?.[0]?.message?.content ?? "";
      }

      console.log("AI response received");

      let content = aiResponseData;
      // Strip code fences if present
      const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (fenceMatch) {
        content = fenceMatch[1].trim();
      }

      // Try to parse JSON robustly
      let result: { summary: string; answers?: Record<string, string> };
      try {
        result = JSON.parse(content);
      } catch (parseError) {
        console.error("Failed to parse AI response as JSON:", content);
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            result = JSON.parse(jsonMatch[0]);
          } catch {
            result = { summary: aiResponseData, answers: {} };
          }
        } else {
          result = { summary: aiResponseData, answers: {} };
        }
      }

      console.log("Updating card with results...");

      // For custom questions, merge with existing answers instead of replacing
      let finalAnswers = result.answers || {};
      if (isCustomQuestion && card.insight_answers) {
        // Generate a unique key for this custom question using timestamp
        const customKey = `custom_${Date.now()}`;
        const existingAnswers = typeof card.insight_answers === 'object' ? card.insight_answers : {};
        
        // Store the custom question and answer
        finalAnswers = {
          ...existingAnswers,
          [customKey]: {
            question: customQuestion.trim(),
            answer: result.answers?.["0"] || result.summary,
            timestamp: new Date().toISOString()
          }
        };
        console.log("Merged custom question answer with existing answers");
      }

      // Update card with results
      const updateData: any = {
        status: "active"
      };

      // Only update summary if not a custom question
      if (!isCustomQuestion) {
        updateData.ai_summary = result.summary;
        updateData.insight_answers = finalAnswers;
        updateData.content_quality = contentQuality;
        updateData.content_warning = contentWarning;
      } else {
        // For custom questions, only update the answers
        updateData.insight_answers = finalAnswers;
      }

      const { error: updateError } = await supabase
        .from("reference_cards")
        .update(updateData)
        .eq("id", cardId);

      if (updateError) {
        console.error("Failed to update card:", updateError);
        throw new Error("Failed to update card: " + updateError.message);
      }

      console.log("Card updated successfully");

      return new Response(
        JSON.stringify({ 
          success: true, 
          summary: result.summary,
          answers: result.answers || {},
          contentQuality,
          contentWarning 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } catch (aiError) {
      console.error("AI processing error:", aiError);
      
      // Update card with error status
      await supabase
        .from("reference_cards")
        .update({
          content_warning: "Error: Unable to process content with AI - " + (aiError instanceof Error ? aiError.message : "Unknown error"),
          content_quality: "error",
          status: "needs_review"
        })
        .eq("id", cardId);

      return new Response(
        JSON.stringify({ error: "AI processing failed", details: aiError instanceof Error ? aiError.message : "Unknown error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

  } catch (error) {
    console.error("Error in process-reference-card:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
