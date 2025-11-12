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

    // Get template if provided
    let template = null;
    if (templateId) {
      const { data: templateData, error: templateError } = await supabaseClient
        .from("content_templates")  // ✅ CORRECT TABLE
        .select("*")
        .eq("id", templateId)
        .single();
      template = templateData;
    }

    // Prepare AI prompt
    const prompt = createContentPrompt(card, template, outputFormat);

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
    }

    // Parse the response to extract title and content
    const { title, content } = parseGeneratedContent(generatedContent, card.title);

    console.log("✅ Content generated successfully using template:", template?.name || 'default');

    return new Response(
      JSON.stringify({
        title,
        content,
        sourceCard: {
          id: card.id,
          title: card.title,
          source: card.source_feeds?.name
        },
        templateUsed: template?.name || "manual"
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

function createContentPrompt(card: any, template: any, outputFormat: string) {
  const primaryInsight = card.insight_answers ? Object.values(card.insight_answers)[0] : card.ai_summary;
  
  if (template) {
    const templateConfig = template.template_structure;
    return `STRICTLY FOLLOW THIS CONTENT TEMPLATE.

TEMPLATE: ${template.name}
GOAL: ${templateConfig.goal || 'Create engaging content'}

STRUCTURE REQUIREMENTS:
${formatStructureRequirements(templateConfig.structure || {})}

VOICE & TONE: ${templateConfig.voice_guidelines || 'Professional and engaging'}

SOURCE MATERIAL:
Title: ${card.title}
Source: ${card.source_feeds?.name || 'Unknown'}
Primary Insight: "${primaryInsight || 'No specific insight'}"

ADDITIONAL INSIGHTS:
${card.insight_answers ? Object.entries(card.insight_answers).map(([key, value]) => `• ${value}`).join('\n') : 'No additional insights'}

FORMAT RESPONSE AS:
TITLE: [Generated title]
CONTENT: [Full content following the structure above]`;
  }

  // Fallback to basic prompt
  return `Create a ${outputFormat === 'visual' ? 'visually engaging' : 'well-structured'} content piece based on this reference material:

REFERENCE CONTENT:
Title: ${card.title}
Source: ${card.source_feeds?.name || 'Unknown'}
Primary Insight: "${primaryInsight || 'No summary available'}"

KEY INSIGHTS:
${card.insight_answers ? Object.entries(card.insight_answers).map(([key, value]) => `• ${value}`).join('\n') : 'No specific insights extracted'}

Please generate a complete content piece with:
1. A compelling title that captures the essence
2. Engaging introduction that hooks the reader
3. Well-structured body that develops the core ideas
4. Clear takeaways or conclusion
5. Natural flow and readability

Format the response as:
TITLE: [Your generated title here]
CONTENT: [Your full content here, using markdown formatting for headings, lists, and emphasis]

Make the content authentic, valuable, and suitable for ${outputFormat} format.`;
}

// Helper functions for template structure
function formatStructureRequirements(structure: any) {
  const requirements = [];
  
  if (structure.hook) requirements.push(`• Hook: ${structure.hook.description || 'Engaging opening'}${structure.hook.max_chars ? ` (max ${structure.hook.max_chars} chars)` : ''}`);
  if (structure.body) requirements.push(`• Body: ${structure.body.description || 'Main content'}${structure.body.min_words && structure.body.max_words ? ` (${structure.body.min_words}-${structure.body.max_words} words)` : ''}`);
  if (structure.cta) requirements.push(`• CTA: ${structure.cta.description || 'Call to action'}${structure.cta.required_elements ? ` - Include: ${structure.cta.required_elements.join(', ')}` : ''}`);
  if (structure.hashtags) requirements.push(`• Hashtags: ${structure.hashtags.count || 3} relevant hashtags`);
  
  return requirements.join('\n');
}

function getFormattingRules(structure: any) {
  const rules = [];
  
  if (structure.hook?.max_chars) rules.push(`• Hook must be under ${structure.hook.max_chars} characters`);
  if (structure.body?.min_words && structure.body?.max_words) rules.push(`• Body must be ${structure.body.min_words}-${structure.body.max_words} words`);
  if (structure.body?.formatting === 'bold_key_concepts') rules.push(`• Bold key concepts and data points`);
  if (structure.body?.sections) rules.push(`• Include these sections: ${structure.body.sections.join(', ')}`);
  if (structure.hashtags?.count) rules.push(`• Include ${structure.hashtags.count} professional hashtags`);
  if (structure.title?.max_chars) rules.push(`• Title under ${structure.title.max_chars} characters`);
  
  return rules.length > 0 ? rules.join('\n') : '• Use markdown for formatting (headings, lists, emphasis)';
}

function getSectionRequirements(structure: any) {
  const sections = [];
  
  if (structure.hook) {
    sections.push(`[Hook: ${structure.hook.description || 'Your engaging hook here'}${structure.hook.max_chars ? ` - max ${structure.hook.max_chars} characters` : ''}]`);
  }
  
  if (structure.body) {
    sections.push(`[Body: ${structure.body.description || 'Your main content here'}${structure.body.min_words && structure.body.max_words ? ` - ${structure.body.min_words}-${structure.body.max_words} words` : ''}]`);
  }
  
  if (structure.cta) {
    sections.push(`[CTA: ${structure.cta.description || 'Your call-to-action here'}${structure.cta.required_elements ? ` - include ${structure.cta.required_elements.join(', ')}` : ''}]`);
  }
  
  if (structure.hashtags) {
    sections.push(`[Hashtags: ${structure.hashtags.count || 3} relevant hashtags]`);
  }
  
  return sections.join('\n');
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