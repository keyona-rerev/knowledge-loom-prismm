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

    console.log("Processing card:", cardId);

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

    // Determine questions: prefer template-specific, then fall back to global
    let questions: string[] = [];

    // 1) Template-specific questions (using template_id explicitly)
    let templateQuestions: string[] | null = null;
    if (card.template_id) {
      const { data: template, error: templateError } = await supabase
        .from("reference_card_templates")
        .select("custom_questions")
        .eq("id", card.template_id)
        .maybeSingle();
      if (templateError) {
        console.error("Template fetch error:", templateError);
      }
      if (template?.custom_questions && Array.isArray(template.custom_questions)) {
        templateQuestions = template.custom_questions.filter((q: any) => typeof q === "string" && q.trim());
      }
    }

    if (templateQuestions?.length) {
      questions = templateQuestions;
    } else {
      // 2) Fallback to global questions
      const { data: profile } = await supabase
        .from("profiles")
        .select("global_insight_questions, active_question_indices")
        .limit(1)
        .maybeSingle();

      if (profile?.global_insight_questions && Array.isArray(profile.global_insight_questions)) {
        if (profile.active_question_indices && Array.isArray(profile.active_question_indices) && profile.active_question_indices.length) {
          questions = profile.active_question_indices
            .map((idx: number) => profile.global_insight_questions[idx])
            .filter((q: any) => typeof q === "string" && q && q.trim());
        } else {
          questions = profile.global_insight_questions.filter((q: any) => typeof q === "string" && q.trim());
        }
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

      // Update card with results
      const { error: updateError } = await supabase
        .from("reference_cards")
        .update({
          ai_summary: result.summary,
          insight_answers: result.answers || {},
          content_quality: contentQuality,
          content_warning: contentWarning,
          status: "active"
        })
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
