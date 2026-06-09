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
    const { direction, seedInsight, seedCategory, insightCardIds } = await req.json();

    if (!direction || !seedInsight) return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Rate limiting
    const windowStart = new Date();
    windowStart.setMinutes(windowStart.getMinutes() - 60);
    const { count: rateCount } = await supabase.from('rate_limit_logs').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('action', 'generate_final').gte('created_at', windowStart.toISOString());
    if ((rateCount || 0) >= 100) return new Response(JSON.stringify({ error: 'Rate limit exceeded.' }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    await supabase.from('rate_limit_logs').insert({ user_id: user.id, action: 'generate_final' });

    const { data: profile } = await supabase.from("profiles").select("ai_provider, ai_model, ai_api_key, ai_endpoint, brand_voice, writing_examples, business_name, business_description, target_audience, content_type_templates").eq("user_id", user.id).single();
    if (!profile) return new Response(JSON.stringify({ error: "Profile not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    let writingStyleContext = "";
    if (profile.writing_examples && Array.isArray(profile.writing_examples) && profile.writing_examples.length > 0) {
      writingStyleContext = "\n\nWRITING STYLE EXAMPLES:\n";
      profile.writing_examples.slice(0, 4).forEach((ex: { content: string }, i: number) => {
        if (ex.content) writingStyleContext += `\n--- Example ${i + 1} ---\n${ex.content.substring(0, 1000)}\n`;
      });
    }

    let businessContext = "";
    if (profile.business_name || profile.business_description || profile.target_audience) {
      businessContext = "\n\nBUSINESS CONTEXT:\n";
      if (profile.business_name) businessContext += `Business: ${profile.business_name}\n`;
      if (profile.business_description) businessContext += `About: ${profile.business_description}\n`;
      if (profile.target_audience) businessContext += `Audience: ${profile.target_audience}\n`;
    }

    let contentTypePrompt = "";
    if (direction.contentType && profile.content_type_templates) {
      const templates = profile.content_type_templates as Array<{ id: string; prompt: string }>;
      const t = templates.find(t => t.id === direction.contentType);
      if (t?.prompt) contentTypePrompt = `\n\nCONTENT TYPE GUIDELINES:\n${t.prompt}`;
    }

    let insightContext = "";
    if (insightCardIds?.length) {
      const { data: cards } = await supabase.from("insight_cards").select("title, content").in("id", insightCardIds).eq("user_id", user.id);
      if (cards?.length) {
        insightContext = "\n\nRELEVANT INSIGHTS:\n";
        cards.forEach((c: { title: string; content: string }) => { insightContext += `- ${c.title}: ${c.content}\n`; });
      }
    }

    const prompt = `Generate full content based on this direction.

Direction: ${JSON.stringify(direction)}
Seed Insight: ${seedInsight}
Category: ${seedCategory || "General"}
${profile.brand_voice ? `Brand Voice: ${profile.brand_voice}` : ""}
${insightContext}
${contentTypePrompt}
${writingStyleContext}
${businessContext}

Create comprehensive, publication-ready content. Engaging title, clear structure, professional quality.
${profile.target_audience ? `Write specifically for: ${profile.target_audience}` : ""}

Respond ONLY with valid JSON: {"title": "...", "content": "full markdown content"}`;

    const aiProfile = { ai_provider: profile.ai_provider, ai_model: profile.ai_model, ai_api_key: profile.ai_api_key, ai_endpoint: profile.ai_endpoint };
    const response = await callAI(aiProfile, [{ role: "user", content: prompt }], "You are a professional content writer. Always respond with valid JSON only.");
    const result = parseJSON(response.text);

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
