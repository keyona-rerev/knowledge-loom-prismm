import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runInteractiveOrQueue } from "../_shared/interactive-run.ts";
import { loadStrategyContext, buildContextBlock, buildSystemPrompt } from "../_shared/strategy-context.ts";

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
    const { seedInsight, seedCategory, formatId, natureId, jobId, maxWaitMs } = await req.json();

    if (!seedInsight) return new Response(JSON.stringify({ error: "seedInsight is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { ctx, hardRules, voiceRules, inlineAttribution } = await loadStrategyContext(supabase, user.id, { formatId, natureId, jobId });
    const strategyBlock = buildContextBlock(ctx);

    const { data: cards } = await supabase
      .from("reference_cards")
      .select("title, ai_summary")
      .eq("user_id", user.id)
      .eq("status", "active")
      .not("ai_summary", "is", null)
      .limit(10);

    const contextCards = cards?.map(c => `${c.title}: ${c.ai_summary}`).join('\n\n') || "No reference cards available";

    const prompt = `Based on this seed insight and reference materials, generate 4 distinct content directions.

Seed Insight: ${seedInsight}
Category: ${seedCategory}

${strategyBlock}
Reference Materials:
${contextCards}

Generate 4 unique angles for developing this insight into content. Each should have a compelling title, 2-3 sentence description, and unique angle.

Respond ONLY with valid JSON:
{"directions": [{"title": "...", "description": "...", "angle": "..."}, ...]}`;

    const SYSTEM = buildSystemPrompt(
      "You are a creative content strategist. Always respond with valid JSON only, no markdown.",
      hardRules, voiceRules, inlineAttribution
    );
    const outcome = await runInteractiveOrQueue(supabase, {
      userId: user.id, route: "generate-content-directions", kind: "directions", prompt, system: SYSTEM,
    }, corsHeaders, maxWaitMs);
    if (!outcome.done) return outcome.response;
    const result = parseJSON(outcome.text);

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
