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

    const { cardId } = await req.json();

    if (!cardId) {
      return new Response(
        JSON.stringify({ error: "cardId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get card with template questions
    const { data: card, error: cardError } = await supabase
      .from("reference_cards")
      .select("*, reference_card_templates(custom_questions)")
      .eq("id", cardId)
      .single();

    if (cardError || !card) {
      return new Response(
        JSON.stringify({ error: "Card not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get global questions from profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("global_insight_questions, active_question_indices")
      .single();

    let questions: string[] = [];
    
    // Use template questions if available, otherwise use active global questions
    if (card.reference_card_templates?.custom_questions) {
      questions = card.reference_card_templates.custom_questions;
    } else if (profile?.global_insight_questions && profile?.active_question_indices) {
      questions = profile.active_question_indices.map((idx: number) => 
        profile.global_insight_questions[idx]
      ).filter(Boolean);
    }

    if (questions.length === 0) {
      return new Response(
        JSON.stringify({ error: "No questions configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "AI API not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

    // Generate summary and answer questions
    const prompt = `Analyze this article and provide:
1. A brief summary (2-3 sentences)
2. Answer each of these questions based on the content:

${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Article Title: ${card.title}
Content: ${card.original_text}

Respond in JSON format:
{
  "summary": "your summary",
  "answers": {
    "0": "answer to question 1",
    "1": "answer to question 2",
    ...
  }
}`;

    try {
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
          response_format: { type: "json_object" }
        }),
      });

      if (!aiResponse.ok) {
        const errorText = await aiResponse.text();
        console.error("AI API error:", aiResponse.status, errorText);
        throw new Error(`AI processing failed: ${aiResponse.status}`);
      }

      const aiData = await aiResponse.json();
      const content = aiData.choices[0].message.content;
      const result = JSON.parse(content);

      // Update card with results
      const { error: updateError } = await supabase
        .from("reference_cards")
        .update({
          ai_summary: result.summary,
          insight_answers: result.answers,
          content_quality: contentQuality,
          content_warning: contentWarning,
          status: "active"
        })
        .eq("id", cardId);

      if (updateError) {
        throw new Error("Failed to update card");
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          summary: result.summary,
          answers: result.answers,
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
          content_warning: "Error: Unable to process content with AI",
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
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
