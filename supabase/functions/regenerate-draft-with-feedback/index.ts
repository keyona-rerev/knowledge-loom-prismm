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
    const { draftId, feedback } = await req.json();

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

    // 3. Call AI to regenerate content
    const aiResponse = await fetch(
      "https://api.lovable.ai/v1/proxy/ai/generate",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("LOVABLE_AI_GATEWAY_KEY")}`,
        },
        body: JSON.stringify({
          model: "gemini-2.5-flash",
          prompt: improvementPrompt,
          max_tokens: 4000,
        }),
      }
    );

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("AI API error:", errorText);
      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const revisedContent = aiData.choices?.[0]?.text || aiData.content || "Failed to generate revised content";

    // 4. Create a new draft with the revised content
    const { data: newDraft, error: createError } = await supabaseClient
      .from("drafts")
      .insert({
        user_id: draft.user_id,
        title: `Revised: ${draft.title}`,
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
});