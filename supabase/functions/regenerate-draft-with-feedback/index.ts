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

    // 1. Fetch the original draft
    const { data: draft, error: draftError } = await supabaseClient
      .from("drafts")
      .select("*")
      .eq("id", draftId)
      .single();

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

    // 2. Fetch user's AI preferences and content type templates
    const { data: profile, error: profileError } = await supabaseClient
      .from("profiles")
      .select("ai_provider, ai_model, google_ai_api_key, custom_ai_endpoint, custom_ai_model_name, content_type_templates, writing_examples, business_name, target_audience")
      .eq("user_id", draft.user_id)
      .maybeSingle();

    // Validate AI configuration based on provider
    if (profile?.ai_provider === "google-ai" && !profile.google_ai_api_key) {
      return new Response(
        JSON.stringify({ error: "Google AI API key not configured. Please add it in Settings." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (profile?.ai_provider === "custom" && (!profile.custom_ai_endpoint || !profile.google_ai_api_key)) {
      return new Response(
        JSON.stringify({ error: "Custom AI provider not fully configured. Please check Settings." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let contentTypeTemplate = null;
    if (profile?.content_type_templates && draft.content_type) {
      contentTypeTemplate = (profile.content_type_templates as any[])?.find(
        (t: any) => t.id === draft.content_type || t.name.toLowerCase().replace(/\s+/g, '_') === draft.content_type
      );
    }

    // 3. Prepare the AI prompt with feedback and template guidelines
    const improvementPrompt = createImprovementPrompt(draft, feedback, contentTypeTemplate, profile);

    console.log("Calling AI with provider:", profile?.ai_provider || "lovable-ai");

    // 4. Call AI based on user's provider preference
    let generatedText;
    if (profile?.ai_provider === "google-ai" && profile.google_ai_api_key) {
      const aiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${profile.ai_model || 'gemini-2.0-flash-exp'}:generateContent?key=${profile.google_ai_api_key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: `System: You are an expert content editor that improves drafts based on feedback.\n\nUser: ${improvementPrompt}` }]
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
      generatedText = aiData.candidates[0].content.parts[0].text;

    } else if (profile?.ai_provider === "custom" && profile.custom_ai_endpoint && profile.google_ai_api_key) {
      const aiResponse = await fetch(profile.custom_ai_endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${profile.google_ai_api_key}`,
        },
        body: JSON.stringify({
          model: profile.custom_ai_model_name,
          messages: [
            { role: "system", content: "You are an expert content editor that improves drafts based on feedback." },
            { role: "user", content: improvementPrompt }
          ],
        }),
      });

      if (!aiResponse.ok) {
        const errorText = await aiResponse.text();
        console.error("Custom AI API error:", aiResponse.status, errorText);
        throw new Error(`Custom AI API error: ${aiResponse.status}`);
      }

      const aiData = await aiResponse.json();
      generatedText = aiData.choices[0].message.content;

    } else {
      // Use Lovable AI (default/fallback for "lovable-ai" or undefined)
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      if (!LOVABLE_API_KEY) {
        return new Response(
          JSON.stringify({ error: "AI API not configured. Please configure an AI provider in Settings." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
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
        console.error("Lovable AI API error:", errorText);
        throw new Error(`AI API error: ${aiResponse.status}`);
      }

      const aiData = await aiResponse.json();
      generatedText = aiData.choices?.[0]?.message?.content || "Failed to generate revised content";
    }
    
    // Parse the response
    const { title: revisedTitle, content: revisedContent } = parseGeneratedContent(generatedText, draft.title);

    // 5. Create a new draft with the revised content
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

    // 6. Update original draft to show it was revised
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
});

function createImprovementPrompt(draft: any, feedback: string, contentTypeTemplate: any, profile: any) {
  let prompt = `IMPROVE THIS DRAFT BASED ON EDITOR FEEDBACK:

ORIGINAL DRAFT:
Title: ${draft.title || "Untitled"}
Content: ${draft.body}

EDITOR FEEDBACK: ${feedback}
`;

  // Add content type template guidelines if available
  if (contentTypeTemplate && contentTypeTemplate.prompt) {
    prompt += `\n==== CONTENT TYPE REQUIREMENTS ====
${contentTypeTemplate.name} Guidelines:
${contentTypeTemplate.prompt}

CRITICAL: The revised draft must follow these content type guidelines.
=================================\n\n`;
  }

  // Add writing style reference if available
  if (profile?.writing_examples && Array.isArray(profile.writing_examples)) {
    const validExamples = profile.writing_examples.filter((ex: string) => ex && ex.trim().length > 0);
    if (validExamples.length > 0) {
      prompt += `\n==== WRITING VOICE REFERENCE ====
Match the tone and style demonstrated in these examples:
${validExamples.slice(0, 2).map((ex: string, i: number) => `\nExample ${i + 1}:\n${ex.substring(0, 300)}...`).join('\n')}
=================================\n\n`;
    }
  }

  prompt += `
INSTRUCTIONS:
- Carefully address ALL points in the editor feedback
- ${contentTypeTemplate ? `Follow the ${contentTypeTemplate.name} content type requirements exactly` : 'Maintain the original content structure'}
- Improve clarity, structure, and quality based on the feedback
- ${profile?.writing_examples?.length ? 'Match the writing style from the examples above' : 'Keep consistent tone'}
- Return ONLY the revised content

Format as:
TITLE: [Revised title]
CONTENT: [Complete revised content]`;

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
