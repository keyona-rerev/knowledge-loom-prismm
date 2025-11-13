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

    // Get card with template questions
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

    console.log("Card found:", card.title);

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

    console.log("Calling AI API...");

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
        }),
      });

      if (!aiResponse.ok) {
        const errorText = await aiResponse.text();
        console.error("AI API error:", aiResponse.status, errorText);
        throw new Error(`AI processing failed: ${aiResponse.status} - ${errorText}`);
      }

      const aiData = await aiResponse.json();
      console.log("AI response received");

      const raw = aiData.choices?.[0]?.message?.content ?? "";
      let content = raw;
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
            result = { summary: raw, answers: {} };
          }
        } else {
          result = { summary: raw, answers: {} };
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
