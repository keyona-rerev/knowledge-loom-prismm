// supabase/functions/regenerate-draft-with-feedback/index.ts

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const { draftId, feedback, templateId} = await req.json();

    if (!draftId || !feedback) {
      return new Response(
        JSON.stringify({ error: "draftId and feedback are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // 1. Fetch the original draft with template
    const { data: draft, error: draftError } = await supabaseClient
      .from("drafts")
      .select(`
        *,
        content_templates (
          name,
          template_structure
        )
      `)
      .eq("id", draftId)
      .single();

          let template = null;
    if (templateId) {
      const { data: templateData, error: templateError } = await supabaseClient
        .from("content_templates")
        .select("*")
        .eq("id", templateId)
        .single();
      
      if (!templateError) {
        template = templateData;
      }
    }

    if (draftError || !draft) {
      console.error("Error fetching draft:", draftError);
      return new Response(
        JSON.stringify({ error: "Draft not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 2. Prepare the AI prompt with feedback
    const improvementPrompt = `
IMPROVE THIS DRAFT BASED ON EDITOR FEEDBACK:

        ORIGINAL DRAFT:
        Title: ${draft.title || "Untitled"}
        Content: ${draft.body}

        EDITOR FEEDBACK: ${feedback}

        INSTRUCTIONS:
        - Carefully address all points in the editor feedback
        - Maintain the core message and intent of the original
        - Improve clarity, structure, and quality based on the feedback
        - Keep similar length and tone
        - Return ONLY the revised content in the same format as the original

REVISED CONTEST:
`;

    // 3. Call Lovable AI Gateway to regenerate content
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const aiResponse = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: "You are an expert content editor that improves drafts based on feedback."
            },
            {
              role: "user",
              content: improvementPrompt
            }
          ],
        }),
      }
    );

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("AI API error:", errorText);
      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const generatedText = aiData.choices?.[0]?.message?.content || "Failed to generate revised content";
    
    // Parse the response
    const { title: revisedTitle, content: revisedContent } = parseGeneratedContent(generatedText, draft.title);

    // 4. Create a new draft with the revised content
      const { data: newDraft, error: createError } = await supabaseClient
      .from("drafts")
      .insert({
        user_id: draft.user_id,
        title: revisedTitle,
        body: revisedContent,
        seed_insight: draft.seed_insight,
        seed_category: draft.seed_category,
        selected_direction: draft.selected_direction,
        content_type: draft.content_type,
        autopilot_template_id: draft.autopilot_template_id,
        approval_status: "pending", // New draft needs review again
        revised_from: draft.id, // Track which draft this revised from
        revision_feedback: feedback, // Store the feedback that prompted this revision
      })
      .select()
      .single();

    if (createError) {
      console.error("Error creating revised draft:", createError);
      throw new Error("Failed to create revised draft");
    }

    // 5. Update original draft to show it was revised
    await supabaseClient
      .from("drafts")
      .update({
        approval_status: "revised", // Mark original as revised
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", draftId);

    return new Response(
      JSON.stringify({ 
        success: true, 
        newDraftId: newDraft.id,
        message: "Draft successfully regenerated with feedback" 
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error("Error in regenerate-draft-with-feedback:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  }
  // ADD THESE FUNCTIONS AT THE VERY END OF THE FILE, BEFORE THE LAST CLOSING BRACE:

function createTemplatePrompt(draft: any, template: any, feedback: string) {
  const structure = template.template_structure;
  return `🚨 CRITICAL: YOU MUST FOLLOW THIS EXACT TEMPLATE STRUCTURE. DO NOT DEVIATE.

TEMPLATE: ${template.name}
GOAL: ${structure.goal || 'Create engaging content'}

ORIGINAL DRAFT:
Title: ${draft.title || "Untitled"}
Content: ${draft.body}

EDITOR FEEDBACK: ${feedback}

🚨 REQUIRED SECTIONS - INCLUDE ALL:
${formatStructureRequirements(structure)}

🚨 FORMATTING RULES:
${getFormattingRules(structure)}

🚨 IMPROVEMENTS NEEDED:
1. Address the user feedback: "${feedback}"
2. Maintain core message but improve structure and engagement
3. Follow the template requirements exactly

RETURN ONLY THE REVISED CONTENT FOLLOWING THE TEMPLATE STRUCTURE:`;
}

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
});

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
    if (config.sections) requirements += ` [Sections: ${config.sections.join(', ')}]`;
    if (config.required_elements) requirements += ` [Required: ${config.required_elements.join(', ')}]`;
    return requirements;
  }).join('\n');
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