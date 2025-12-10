import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    // Verify user authentication from JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("❌ Missing authorization header");
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const supabaseAuth = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
    
    if (authError || !user) {
      console.error("❌ Invalid token:", authError?.message);
      return new Response(
        JSON.stringify({ error: "Invalid or expired authentication token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = user.id;
    console.log("✅ Authenticated user:", userId);

    // Use service role client for database operations
    const supabaseClient = createClient(supabaseUrl, serviceRoleKey);

    const { draftId, feedback, templateId } = await req.json();

    if (!draftId || !feedback) {
      return new Response(
        JSON.stringify({ error: "draftId and feedback are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Rate limiting: 50 regenerations per hour per user
    const windowStart = new Date();
    windowStart.setMinutes(windowStart.getMinutes() - 60);
    
    const { count: rateCount } = await supabaseClient
      .from('rate_limit_logs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('action', 'regenerate_draft')
      .gte('created_at', windowStart.toISOString());
    
    if ((rateCount || 0) >= 50) {
      console.log('❌ Rate limit exceeded for user:', userId);
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded. Maximum 50 regenerations per hour.' }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log this attempt for rate limiting
    await supabaseClient.from('rate_limit_logs').insert({
      user_id: userId,
      action: 'regenerate_draft'
    });

    // Fetch the original draft - verify it belongs to the authenticated user
    const { data: draft, error: draftError } = await supabaseClient
      .from("drafts")
      .select("*")
      .eq("id", draftId)
      .eq("user_id", userId)
      .single();

    if (draftError || !draft) {
      console.error("❌ Draft not found or access denied:", draftError);
      return new Response(
        JSON.stringify({ error: "Draft not found or access denied" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("🔄 Regenerating draft:", draft.title);

    // Fetch user profile for AI config and business context
    const { data: profile } = await supabaseClient
      .from("profiles")
      .select("ai_provider, ai_model, google_ai_api_key, custom_ai_endpoint, custom_ai_model_name, brand_voice, writing_examples, business_name, business_description, target_audience, content_type_templates")
      .eq("user_id", userId)
      .single();

    if (!profile) {
      return new Response(
        JSON.stringify({ error: "Profile not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate AI configuration
    if (profile.ai_provider === "google-ai" && !profile.google_ai_api_key) {
      return new Response(
        JSON.stringify({ error: "Google AI API key not configured. Please add it in Settings." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Store current version in revision history before regenerating
    const currentVersion = (draft.revision_count || 0) + 1;
    await supabaseClient.from("draft_revisions").insert({
      draft_id: draftId,
      version: currentVersion,
      body: draft.body,
      changes_summary: `Before revision based on feedback: ${feedback.substring(0, 100)}...`
    });

    // Build writing style context
    let writingStyleContext = "";
    if (profile.writing_examples && Array.isArray(profile.writing_examples) && profile.writing_examples.length > 0) {
      writingStyleContext = "\n\nWRITING STYLE EXAMPLES (mimic this tone, structure, and voice):\n";
      profile.writing_examples.slice(0, 4).forEach((example: { content: string }, i: number) => {
        if (example.content) {
          writingStyleContext += `\n--- Example ${i + 1} ---\n${example.content.substring(0, 800)}\n`;
        }
      });
    }

    // Build business context
    let businessContext = "";
    if (profile.business_name || profile.business_description || profile.target_audience) {
      businessContext = "\n\nBUSINESS CONTEXT:\n";
      if (profile.business_name) businessContext += `Business: ${profile.business_name}\n`;
      if (profile.business_description) businessContext += `About: ${profile.business_description}\n`;
      if (profile.target_audience) businessContext += `Target Audience: ${profile.target_audience}\n`;
    }

    // Get content type template
    let contentTypePrompt = "";
    if (draft.content_type && profile.content_type_templates) {
      const templates = profile.content_type_templates as Array<{ id: string; prompt: string }>;
      const matchingTemplate = templates.find(t => t.id === draft.content_type);
      if (matchingTemplate?.prompt) {
        contentTypePrompt = `\n\nCONTENT TYPE GUIDELINES:\n${matchingTemplate.prompt}`;
      }
    }

    const prompt = `Revise this content based on the feedback provided. Make the requested changes while maintaining overall quality and coherence.

CURRENT CONTENT:
Title: ${draft.title}
Body:
${draft.body}

FEEDBACK TO INCORPORATE:
${feedback}

${profile.brand_voice ? `Brand Voice: ${profile.brand_voice}` : ""}
${contentTypePrompt}
${writingStyleContext}
${businessContext}

Instructions:
1. Address ALL the feedback points
2. Maintain the core message while improving based on feedback
3. Keep the same general structure unless feedback suggests otherwise
4. Ensure the content remains professional and well-written
${profile.target_audience ? `5. Keep content valuable for: ${profile.target_audience}` : ""}

Respond in JSON format:
{
  "title": "Updated title (or keep same if not mentioned in feedback)",
  "content": "Full revised content with markdown formatting"
}`;

    console.log("🤖 Calling AI with provider:", profile.ai_provider);

    let result;
    if (profile.ai_provider === "google-ai") {
      const aiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${profile.ai_model}:generateContent?key=${profile.google_ai_api_key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: `System: You are a professional editor. Always respond with valid JSON.\n\nUser: ${prompt}` }]
            }],
            generationConfig: {
              temperature: 0.7,
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
      const generatedText = aiData.candidates[0].content.parts[0].text;
      
      let content = generatedText;
      const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (fenceMatch) {
        content = fenceMatch[1].trim();
      }
      result = JSON.parse(content);

    } else if (profile.ai_provider === "custom") {
      const aiResponse = await fetch(profile.custom_ai_endpoint!, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${profile.google_ai_api_key}`,
        },
        body: JSON.stringify({
          model: profile.custom_ai_model_name,
          messages: [
            { role: "system", content: "You are a professional editor. Always respond with valid JSON." },
            { role: "user", content: prompt }
          ],
          response_format: { type: "json_object" }
        }),
      });

      if (!aiResponse.ok) {
        throw new Error(`Custom AI error: ${aiResponse.status}`);
      }

      const aiData = await aiResponse.json();
      result = JSON.parse(aiData.choices[0].message.content);

    } else {
      // Use Lovable AI (default/fallback)
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      if (!LOVABLE_API_KEY) {
        return new Response(
          JSON.stringify({ error: "AI API not configured. Please configure an AI provider in Settings." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: "You are a professional editor. Always respond with valid JSON." },
            { role: "user", content: prompt }
          ],
        }),
      });

      if (!aiResponse.ok) {
        const errorText = await aiResponse.text();
        console.error("Lovable AI API error:", aiResponse.status, errorText);
        throw new Error(`AI processing failed: ${aiResponse.status}`);
      }

      const aiData = await aiResponse.json();
      const generatedText = aiData.choices?.[0]?.message?.content ?? "";
      
      let content = generatedText;
      const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (fenceMatch) {
        content = fenceMatch[1].trim();
      }
      result = JSON.parse(content);
    }

    // Update the draft with new content
    const { error: updateError } = await supabaseClient
      .from("drafts")
      .update({
        title: result.title || draft.title,
        body: result.content,
        revision_feedback: feedback,
        revision_count: currentVersion,
        updated_at: new Date().toISOString()
      })
      .eq("id", draftId);

    if (updateError) {
      console.error("❌ Failed to update draft:", updateError);
      throw updateError;
    }

    console.log("✅ Draft regenerated successfully, version:", currentVersion);

    return new Response(
      JSON.stringify({
        success: true,
        title: result.title || draft.title,
        content: result.content,
        revisionCount: currentVersion
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("💥 Error regenerating draft:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
