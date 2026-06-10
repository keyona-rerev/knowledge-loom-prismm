import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI } from "../_shared/ai-caller.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function parseJSON(text: string): any {
  let content = text.trim();
  const fence = content.match(/```(?:\w*)?\s*([\s\S]*?)\s*```/i);
  if (fence) content = fence[1].trim();
  const jsonMatch = content.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) content = jsonMatch[1];
  return JSON.parse(content);
}

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
    const { scheduleEntryId, isTestRun = false } = await req.json();

    if (!scheduleEntryId) return new Response(JSON.stringify({ error: "scheduleEntryId is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Load the schedule entry — all decisions come from here, nothing is hardcoded
    const { data: scheduleEntry } = await supabase
      .from("content_schedules")
      .select("*")
      .eq("id", scheduleEntryId)
      .eq("user_id", user.id)
      .eq("is_active", true)
      .single();

    if (!scheduleEntry) return new Response(JSON.stringify({ error: "Schedule entry not found, inactive, or access denied" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: profile } = await supabase
      .from("profiles")
      .select("ai_provider, ai_model, ai_api_key, ai_endpoint, brand_voice, writing_examples, business_name, business_description, target_audience, content_type_templates")
      .eq("user_id", user.id)
      .single();

    if (!profile) return new Response(JSON.stringify({ error: "Profile not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    if (!profile.ai_api_key) return new Response(JSON.stringify({ error: "No AI API key configured in Settings" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const createdDrafts = [];

    // ─── REUSE DECISION TREE ───────────────────────────────────────────────────
    // Before generating fresh content, check if there are eligible parent drafts
    // to resurface. Eligibility: approved, published, within reuse window,
    // reuse_count < max_reuse_count, no child already queued this week.

    let reuseParent = null;

    if (scheduleEntry.max_reuse_count > 0) {
      const windowCutoff = new Date();
      windowCutoff.setDate(windowCutoff.getDate() - (scheduleEntry.reuse_window_days || 90));

      // Find oldest eligible parent for this content type
      const { data: eligibleParents } = await supabase
        .from("drafts")
        .select("*")
        .eq("user_id", user.id)
        .eq("content_type", scheduleEntry.content_type_id)
        .eq("approval_status", "approved")
        .is("parent_draft_id", null)
        .gte("published_at", windowCutoff.toISOString())
        .filter("reuse_count", "lt", supabase.raw("max_reuse_count"))
        .order("published_at", { ascending: true })
        .limit(5);

      if (eligibleParents && eligibleParents.length > 0) {
        // Pick the one with the fewest reuses relative to its max
        reuseParent = eligibleParents.sort((a, b) =>
          (a.reuse_count / (a.max_reuse_count || 1)) - (b.reuse_count / (b.max_reuse_count || 1))
        )[0];
      }
    }

    // ─── PATH A: GENERATE CHILD FROM EXISTING PARENT ──────────────────────────
    if (reuseParent && scheduleEntry.requires_child && scheduleEntry.child_content_type_id) {
      const anglesUsed = Array.isArray(reuseParent.reuse_angles_used) ? reuseParent.reuse_angles_used : [];

      const contentTypeTemplates = Array.isArray(profile.content_type_templates) ? profile.content_type_templates as Array<{ id: string; name: string; prompt: string }> : [];
      const childTemplate = contentTypeTemplates.find(t => t.id === scheduleEntry.child_content_type_id);

      let writingStyleContext = "";
      if (profile.writing_examples && Array.isArray(profile.writing_examples)) {
        const childExamples = (profile.writing_examples as any[]).filter((ex: any) => ex.content_type_id === scheduleEntry.child_content_type_id);
        const fallbackExamples = (profile.writing_examples as any[]).filter((ex: any) => !ex.content_type_id);
        const examples = childExamples.length > 0 ? childExamples : fallbackExamples;
        if (examples.length > 0) {
          writingStyleContext = "\n\nWRITING STYLE EXAMPLES:\n";
          examples.slice(0, 3).forEach((ex: any, i: number) => {
            if (ex.content) writingStyleContext += `\n--- Example ${i + 1} ---\n${ex.content.substring(0, 800)}\n`;
          });
        }
      }

      let businessContext = "";
      if (profile.business_name || profile.business_description || profile.target_audience) {
        businessContext = "\n\nBUSINESS CONTEXT:\n";
        if (profile.business_name) businessContext += `Business: ${profile.business_name}\n`;
        if (profile.business_description) businessContext += `About: ${profile.business_description}\n`;
        if (profile.target_audience) businessContext += `Audience: ${profile.target_audience}\n`;
      }

      const prompt = `Generate a ${scheduleEntry.child_content_type_id} post that resurfaces this existing piece of content from a fresh angle.

PARENT CONTENT:
Title: ${reuseParent.title}
Body: ${(reuseParent.body || "").substring(0, 3000)}

ANGLES ALREADY USED (do not repeat these):
${anglesUsed.length > 0 ? anglesUsed.join("\n") : "None yet — this is the first reuse."}

${childTemplate?.prompt ? `CONTENT TYPE GUIDELINES:\n${childTemplate.prompt}` : ""}
${profile.brand_voice ? `Brand Voice: ${profile.brand_voice}` : ""}
${writingStyleContext}
${businessContext}

Choose a distinct angle not already covered above. State the angle you chose in a field called "angle_used".
${profile.target_audience ? `Write specifically for: ${profile.target_audience}` : ""}

Respond ONLY with valid JSON: {"title": "...", "content": "...", "angle_used": "one sentence describing the angle"}`;

      const aiProfile = { ai_provider: profile.ai_provider, ai_model: profile.ai_model, ai_api_key: profile.ai_api_key, ai_endpoint: profile.ai_endpoint };
      const response = await callAI(aiProfile, [{ role: "user", content: prompt }], "You are a professional content writer. Always respond with valid JSON only.");
      const result = parseJSON(response.text);

      // Save child draft
      const { data: childDraft, error: childError } = await supabase.from("drafts").insert({
        title: result.title,
        body: result.content,
        status: "draft",
        user_id: user.id,
        content_type: scheduleEntry.child_content_type_id,
        parent_draft_id: reuseParent.id,
        approval_status: "pending",
        revision_count: 0,
        seed_insight: `Reuse ${reuseParent.reuse_count + 1} of ${reuseParent.max_reuse_count} — angle: ${result.angle_used || "unspecified"}`,
      }).select().single();

      if (!childError && childDraft) {
        // Update parent reuse tracking
        const updatedAngles = [...anglesUsed, result.angle_used || `Reuse ${reuseParent.reuse_count + 1}`];
        await supabase.from("drafts").update({
          reuse_count: reuseParent.reuse_count + 1,
          reuse_angles_used: updatedAngles,
        }).eq("id", reuseParent.id);

        createdDrafts.push(childDraft);

        // Notify
        await supabase.functions.invoke("send-draft-notification", {
          body: { draftId: childDraft.id },
          headers: { Authorization: authHeader },
        });
      }

    } else {
      // ─── PATH B: GENERATE FRESH CONTENT FROM REFERENCE CARDS ────────────────
      const { data: referenceCards } = await supabase
        .from("reference_cards")
        .select("id, title, ai_summary")
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(3);

      if (!referenceCards || referenceCards.length === 0) {
        return new Response(JSON.stringify({ success: true, message: "No reference cards available for fresh generation", draftsCreated: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      let contentTemplate = null;
      if (scheduleEntry.content_type_id) {
        const { data: tmpl } = await supabase
          .from("content_templates")
          .select("*")
          .eq("content_type", scheduleEntry.content_type_id)
          .eq("is_active", true)
          .or(`user_id.eq.${user.id},is_system_template.eq.true`)
          .order("is_system_template", { ascending: false })
          .limit(1)
          .single();
        contentTemplate = tmpl;
      }

      for (const card of referenceCards) {
        try {
          const { data: generatedContent, error: aiError } = await supabase.functions.invoke("generate-content-from-card", {
            body: {
              cardId: card.id,
              templateId: contentTemplate?.id,
              outputFormat: scheduleEntry.content_type_id,
            },
            headers: { Authorization: authHeader },
          });

          if (aiError) { console.error(`Generation failed for card ${card.id}:`, aiError); continue; }

          const { data: draftData, error: draftError } = await supabase.from("drafts").insert({
            title: generatedContent?.title || `Draft from ${card.title}`,
            body: generatedContent?.content || "",
            status: "draft",
            user_id: user.id,
            seed_insight: card.ai_summary,
            content_type: scheduleEntry.content_type_id,
            approval_status: "pending",
            revision_count: 0,
            // Reuse config inherited from schedule entry
            max_reuse_count: scheduleEntry.max_reuse_count || 0,
            reuse_window_days: scheduleEntry.reuse_window_days || 90,
            reuse_count: 0,
            reuse_angles_used: [],
          }).select().single();

          if (draftError) { console.error("Draft creation failed:", draftError); continue; }

          await supabase.functions.invoke("send-draft-notification", {
            body: { draftId: draftData.id },
            headers: { Authorization: authHeader },
          });

          createdDrafts.push(draftData);
        } catch (error) {
          console.error(`Error processing card ${card.id}:`, error);
        }
      }

      // If this content type requires a child, also queue a child for the first fresh draft
      if (scheduleEntry.requires_child && scheduleEntry.child_content_type_id && createdDrafts.length > 0) {
        const parentDraft = createdDrafts[0];
        await supabase.functions.invoke("execute-autopilot-template", {
          body: {
            scheduleEntryId,
            isTestRun,
            _forceChildOf: parentDraft.id,
          },
          headers: { Authorization: authHeader },
        });
      }
    }

    if (!isTestRun) {
      await supabase.from("content_schedules").update({
        updated_at: new Date().toISOString(),
      }).eq("id", scheduleEntryId);
    }

    return new Response(
      JSON.stringify({ success: true, draftsCreated: createdDrafts.length, draftIds: createdDrafts.map(d => d.id), isTestRun }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
