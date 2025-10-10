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
    const { cardId, templateId, outputFormat } = await req.json();

    if (!cardId) {
      return new Response(
        JSON.stringify({ error: "cardId is required" }),
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

    console.log("🔄 Generating content from card:", cardId);

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

    // ✅ UPDATED: Get content template based on output format
    const { data: contentTemplate } = await supabaseClient
      .from("content_templates")
      .select("*")
      .eq("content_type", outputFormat || 'blog_post')
      .eq("is_active", true)
      .or(`user_id.eq.${card.user_id},is_system_template.eq.true`)
      .order("is_system_template", { ascending: false })
      .limit(1)
      .single();

    // Get autopilot template if provided (for backward compatibility)
    let autopilotTemplate = null;
    if (templateId) {
      const { data: templateData } = await supabaseClient
        .from("autopilot_templates")
        .select("*")
        .eq("id", templateId)
        .single();
      autopilotTemplate = templateData;
    }

    // ✅ UPDATED: Use template-driven prompt
    const prompt = await createContentPrompt(card, contentTemplate, autopilotTemplate, outputFormat, supabaseClient);

    // Call AI API through Lovable gateway
    const aiResponse = await fetch("https://gateway.lovable.app/v1/proxy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
      },
      body: JSON.stringify({
        model: "gemini-2.0-flash-exp",
        contents: [
          {
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
      }),
    });

    if (!aiResponse.ok) {
      throw new Error(`AI API error: ${aiResponse.statusText}`);
    }

    const aiData = await aiResponse.json();
    const generatedContent = aiData.candidates[0].content.parts[0].text;

    // Parse the response to extract title and content
    const { title, content } = parseGeneratedContent(generatedContent, card.title);

    console.log("✅ Content generated successfully using template:", contentTemplate?.name || 'default');

    return new Response(
      JSON.stringify({
        title,
        content,
        sourceCard: {
          id: card.id,
          title: card.title,
          source: card.source_feeds?.name
        },
        templateUsed: contentTemplate?.name || autopilotTemplate?.name || "manual"
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

// ✅ UPDATED: Template-driven prompt generation
async function createContentPrompt(card: any, contentTemplate: any, autopilotTemplate: any, outputFormat: string, supabaseClient: any) {
  const primaryInsight = card.insight_answers ? Object.values(card.insight_answers)[0] : card.ai_summary;
  
  // Use content template if available
  if (contentTemplate) {
    return buildPromptFromTemplate(card, contentTemplate, primaryInsight);
  }
  
  // Fallback to original logic for backward compatibility
  return buildBasicPrompt(card, autopilotTemplate, outputFormat, primaryInsight);
}

function buildPromptFromTemplate(card: any, template: any, primaryInsight: any) {
  const templateConfig = template.template_structure;
  
  return `STRICTLY FOLLOW THIS CONTENT TEMPLATE. DO NOT DEVIATE FROM THE STRUCTURE.

TEMPLATE: ${template.name}
GOAL: ${templateConfig.goal}

REQUIRED STRUCTURE:
${formatStructureRequirements(templateConfig.structure)}

VOICE & TONE: ${templateConfig.voice_guidelines}

CONTENT SOURCE:
Title: ${card.title}
Source: ${card.source_feeds?.name || 'Unknown'}
Primary Strategic Insight: "${primaryInsight || 'No specific insight'}"

QUALITY CHECKS:
${templateConfig.quality_checks?.map((check: string) => `• ${check}`).join('\n') || '• Ensure high-quality, engaging content'}

ADDITIONAL INSIGHTS:
${card.insight_answers ? Object.entries(card.insight_answers).slice(1).map(([key, value]) => `• ${value}`).join('\n') : 'No additional insights'}

RESPONSE FORMAT - STRICTLY FOLLOW:
TITLE: [Generated title following template requirements]
CONTENT: [Full content following the exact structure above]

CRITICAL: Preserve the strategic angle and core insight throughout the content.`;
}

function formatStructureRequirements(structure: any) {
  return Object.entries(structure).map(([section, config]: [string, any]) => {
    let requirements = `${section.toUpperCase()}: ${config.description}`;
    if (config.approx_words) requirements += ` (~${config.approx_words} words)`;
    if (config.min_words && config.max_words) requirements += ` (${config.min_words}-${config.max_words} words)`;
    if (config.max_chars) requirements += ` (max ${config.max_chars} characters)`;
    if (config.sentences) requirements += ` (${config.sentences} sentences)`;
    if (config.count) requirements += ` (${config.count} items)`;
    if (config.required === false) requirements += ` [OPTIONAL]`;
    if (config.formatting) requirements += ` [Format: ${config.formatting}]`;
    return requirements;
  }).join('\n');
}

function buildBasicPrompt(card: any, template: any, outputFormat: string, primaryInsight: any) {
  let prompt = `Create a ${outputFormat === 'visual' ? 'visually engaging' : 'well-structured'} content piece based on this reference material:

REFERENCE CONTENT:
Title: ${card.title}
Source: ${card.source_feeds?.name || 'Unknown'}
Primary Insight: "${primaryInsight || card.ai_summary || 'No summary available'}"

KEY INSIGHTS:
${card.insight_answers ? Object.entries(card.insight_answers).map(([key, value]) => `• ${value}`).join('\n') : 'No specific insights extracted'}

`;

  if (template) {
    prompt += `CONTENT REQUIREMENTS:
- Format: ${template.output_format}
- Frequency: ${template.frequency}
- Topics: ${template.topic_filters?.join(', ') || 'No specific topics'}
- Use ${template.use_global_questions ? 'global questions' : 'custom template'}

`;
  }

  prompt += `Please generate a complete content piece with:
1. A compelling title that captures the essence
2. Engaging introduction that hooks the reader
3. Well-structured body that develops the core ideas
4. Clear takeaways or conclusion
5. Natural flow and readability

Format the response as:
TITLE: [Your generated title here]
CONTENT: [Your full content here, using markdown formatting for headings, lists, and emphasis]

Make the content authentic, valuable, and suitable for ${outputFormat} format.`;

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