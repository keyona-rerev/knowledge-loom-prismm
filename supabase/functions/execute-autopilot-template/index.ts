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
    const { templateId, isTestRun = false } = await req.json();

    if (!templateId) {
      return new Response(
        JSON.stringify({ error: "templateId is required" }),
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

    console.log("🔄 Executing autopilot template:", templateId, "Test run:", isTestRun);

    // Get template with feed details
    const { data: template, error: templateError } = await supabaseClient
      .from("content_templates")
      .select("*")
      .eq("id", templateId)
      .single();

    if (templateError || !template) {
      console.error("❌ Template not found:", templateError);
      throw new Error("Template not found");
    }

    // Get recent reference cards for the user
    const { data: { session } } = await supabaseClient.auth.getSession();
    const userId = session?.user?.id;

    if (!userId) {
      throw new Error("User not authenticated");
    }

    const { data: referenceCards, error: cardsError } = await supabaseClient
      .from("reference_cards")
      .select("id, title, ai_summary, insight_answers, source_feed_id")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(3);

    if (cardsError) {
      console.error("❌ Error fetching reference cards:", cardsError);
      throw cardsError;
    }

    if (!referenceCards || referenceCards.length === 0) {
      console.log("📭 No reference cards found for user");
      return new Response(
        JSON.stringify({ success: true, message: "No content available", draftsCreated: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📚 Found ${referenceCards.length} reference cards for template`);

    // Get content template if specified
    let contentTemplate = null;
    if (template.content_type) {
      const { data: tmpl } = await supabaseClient
        .from("content_templates")
        .select("*")
        .eq("content_type", template.content_type)
        .eq("is_active", true)
        .or(`user_id.eq.${template.user_id},is_system_template.eq.true`)
        .order("is_system_template", { ascending: false })
        .limit(1)
        .single();
      contentTemplate = tmpl;
    }

    const createdDrafts = [];

    // Generate draft from each reference card
    for (const card of referenceCards) {
      try {
        // Generate content using AI
        const { data: generatedContent, error: aiError } = await supabaseClient.functions.invoke("generate-content-from-card", {
          body: {
            cardId: card.id,
            templateId: contentTemplate?.id,
            outputFormat: template.content_type
          }
        });

        if (aiError) {
          console.error(`❌ AI generation failed for card ${card.id}:`, aiError);
          continue;
        }

        // Create draft with template
        const { data: draftData, error: draftError } = await supabaseClient
          .from("drafts")
          .insert({
            title: generatedContent?.title || `Draft from ${card.title}`,
            body: generatedContent?.content || "Content generation in progress...",
            status: "draft",
            user_id: userId,
            seed_insight: card.ai_summary,
            content_type: template.output_format,
            autopilot_template_id: template.id,
            approval_status: template.approval_required !== false ? 'pending' : 'draft',
            revision_count: 0
          })
          .select()
          .single();

        if (draftError) {
          console.error(`❌ Draft creation failed:`, draftError);
          continue;
        }

        console.log("✅ Draft created:", draftData.id);

        // Send notification
        if (draftData) {
          console.log("📧 Triggering notification for draft:", draftData.id);
          await supabaseClient.functions.invoke('send-draft-notification', {
            body: { draftId: draftData.id }
          });
        }

        createdDrafts.push(draftData);

      } catch (error) {
        console.error(`💥 Error processing card ${card.id}:`, error);
      }
    }

    // Update template last run time
    if (!isTestRun) {
      await supabaseClient
        .from("content_templates")
        .update({ 
          last_run_at: new Date().toISOString()
        })
        .eq("id", templateId);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        draftsCreated: createdDrafts.length,
        draftIds: createdDrafts.map(d => d.id),
        isTestRun 
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error("💥 Error in execute-autopilot-template:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});