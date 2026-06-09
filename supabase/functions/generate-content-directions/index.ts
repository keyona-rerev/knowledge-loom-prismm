import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI, loadAIProfile } from "../_shared/ai-caller.ts";

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
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Authentication required" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabaseAuth = createClient(supabaseUrl, serviceRoleKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) return new Response(JSON.stringify({ error: "Invalid or expired authentication token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { seedInsight, seedCategory } = await req.json();

    if (!seedInsight) return new Response(JSON.stringify({ error: "seedInsight is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: profile } = await supabase
      .from("profiles")
      .select("ai_provider, ai_model, ai_api_key, ai_endpoint, business_name, business_description, target_audience")
      .eq("user_id", user.id)
      .single();

    if (!profile) return new Response(JSON.stringify({ error: "User profile not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: cards } = await supabase
      .from("reference_cards")
      .select("title, ai_summary")
      .eq("user_id", user.id)
      .eq("status", "active")
      .not("ai_summary", "is", null)
      .limit(10);

    const contextCards = cards?.map(c => `${c.title}: ${c.ai_summary}`).join('\n\n') || "No reference cards available";

    let businessContext = "";
    if (profile.business_name || profile.business_description || profile.target_audience) {
      businessContext = `\n\nBUSINESS CONTEXT:\n`;
      if (profile.business_name) businessContext += `Business: ${profile.business_name}\n`;
      if (profile.business_description) businessContext += `About: ${profile.business_description}\n`;
      if (profile.target_audience) businessContext += `Audience: ${profile.target_audience}\n`;
    }

    const prompt = `Based on this seed insight and reference materials, generate 4 distinct content directions.

Seed Insight: ${seedInsight}
Category: ${seedCategory}

Reference Materials:
${contextCards}
${businessContext}

Generate 4 unique angles for developing this insight into content. Each should have a compelling title, 2-3 sentence description, and unique angle.
${profile.target_audience ? `Be specifically relevant for the target audience described above.` : ''}

Respond ONLY with valid JSON:
{"directions": [{"title": "...", "description": "...", "angle": "..."}, ...]}`;

    const aiProfile = { ai_provider: profile.ai_provider, ai_model: profile.ai_model, ai_api_key: profile.ai_api_key, ai_endpoint: profile.ai_endpoint };
    const response = await callAI(aiProfile, [{ role: "user", content: prompt }], "You are a creative content strategist. Always respond with valid JSON only, no markdown.");

    const result = parseJSON(response.text);

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
