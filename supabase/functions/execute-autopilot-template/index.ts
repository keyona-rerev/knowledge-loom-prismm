import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// execute-autopilot-template does not call AI directly —
// it delegates to generate-content-from-card which uses the shared caller.
// No AI refactor needed here, but we remove any google_ai_api_key references.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Authentication required" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabaseAuth = createClient(supabaseUrl, serviceRoleKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) return new Response(JSON.stringify({ error: "Invalid or expired authentication token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { templateId, isTestRun = false } = await req.json();

    if (!templateId) return new Response(JSON.stringify({ error: "templateId is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: template } = await supabase.from("autopilot_templates").select("*").eq("id", templateId).eq("user_id", user.id).single();
    if (!template) return new Response(JSON.stringify({ error: "Autopilot template not found or access denied" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: referenceCards } = await supabase.from("reference_cards").select("id, title, ai_summary").eq("user_id", user.id).eq("status", "active").order("created_at", { ascending: false }).limit(3);

    if (!referenceCards || referenceCards.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No content available", draftsCreated: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let contentTemplate = null;
    if (template.content_type) {
      const { data: tmpl } = await supabase.from("content_templates").select("*").eq("content_type", template.content_type).eq("is_active", true).or(`user_id.eq.${user.id},is_system_template.eq.true`).order("is_system_template", { ascending: false }).limit(1).single();
      contentTemplate = tmpl;
    }

    const createdDrafts = [];

    for (const card of referenceCards) {
      try {
        const { data: generatedContent, error: aiError } = await supabase.functions.invoke("generate-content-from-card", {
          body: { cardId: card.id, templateId: contentTemplate?.id, outputFormat: template.content_type },
          headers: { Authorization: authHeader }
        });

        if (aiError) { console.error(`AI generation failed for card ${card.id}:`, aiError); continue; }

        const { data: draftData, error: draftError } = await supabase.from("drafts").insert({
          title: generatedContent?.title || `Draft from ${card.title}`,
          body: generatedContent?.content || "Content generation in progress...",
          status: "draft",
          user_id: user.id,
          seed_insight: card.ai_summary,
          content_type: template.content_type,
          autopilot_template_id: template.id,
          approval_status: 'pending',
          revision_count: 0
        }).select().single();

        if (draftError) { console.error("Draft creation failed:", draftError); continue; }

        await supabase.functions.invoke('send-draft-notification', {
          body: { draftId: draftData.id },
          headers: { Authorization: authHeader }
        });

        createdDrafts.push(draftData);
      } catch (error) {
        console.error(`Error processing card ${card.id}:`, error);
      }
    }

    if (!isTestRun) {
      await supabase.from("autopilot_templates").update({ last_run_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", templateId);
    }

    return new Response(JSON.stringify({ success: true, draftsCreated: createdDrafts.length, draftIds: createdDrafts.map(d => d.id), isTestRun }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
