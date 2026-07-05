import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI } from "../_shared/ai-caller.ts";
import { scoreRelevance } from "../_shared/relevance-scorer.ts";

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

    // process-reference-card can be called by the GAS ingest function (service role)
    // OR by authenticated users directly. Support both paths.
    const authHeader = req.headers.get("Authorization");
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    let userId: string;

    if (authHeader && authHeader !== `Bearer ${serviceRoleKey}`) {
      const supabaseAuth = createClient(supabaseUrl, serviceRoleKey, { global: { headers: { Authorization: authHeader } } });
      const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(authHeader.replace("Bearer ", ""));
      if (authError || !user) return new Response(JSON.stringify({ error: "Invalid or expired authentication token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      userId = user.id;
    } else {
      // Service role call (from create-manual-source, or GAS ingest).
      const body = await req.json();
      if (!body.cardId) return new Response(JSON.stringify({ error: "cardId is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      // Prefer the userId the caller already has (create-manual-source
      // knows it — it just authenticated this same user moments ago).
      // Falling back to a fresh SELECT-by-cardId here was intermittently
      // returning no row immediately after the caller's own insert
      // (visible as a "Card not found" 404 in this function's logs),
      // silently leaving every manually-added source on its placeholder
      // score forever. Passing userId directly skips that lookup for any
      // caller that already knows it; the lookup remains as a fallback
      // for older callers that don't pass it.
      if (body.userId) {
        userId = body.userId;
      } else {
        const { data: card } = await supabase.from("reference_cards").select("user_id").eq("id", body.cardId).single();
        if (!card) return new Response(JSON.stringify({ error: "Card not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        userId = card.user_id;
      }

      // Re-parse won't work after consuming body — pass values forward
      return await processCard(supabase, userId, body.cardId, body.customQuestion, corsHeaders);
    }

    const { cardId, customQuestion } = await req.json();
    if (!cardId) return new Response(JSON.stringify({ error: "cardId is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    return await processCard(supabase, userId, cardId, customQuestion, corsHeaders);

  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

async function processCard(supabase: any, userId: string, cardId: string, customQuestion: string | undefined, corsHeaders: Record<string, string>) {
  // Rate limiting
  const windowStart = new Date();
  windowStart.setMinutes(windowStart.getMinutes() - 60);
  const { count: rateCount } = await supabase.from('rate_limit_logs').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('action', 'process_card').gte('created_at', windowStart.toISOString());
  if ((rateCount || 0) >= 100) return new Response(JSON.stringify({ error: 'Rate limit exceeded.' }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const dayStart = new Date();
  dayStart.setHours(dayStart.getHours() - 24);
  const { count: dailyCount } = await supabase.from('rate_limit_logs').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('action', 'process_card').gte('created_at', dayStart.toISOString());
  if ((dailyCount || 0) >= 500) return new Response(JSON.stringify({ error: 'Daily limit exceeded.' }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  await supabase.from('rate_limit_logs').insert({ user_id: userId, action: 'process_card' });

  const { data: card } = await supabase.from("reference_cards").select("*, reference_card_templates(custom_questions)").eq("id", cardId).eq("user_id", userId).single();
  if (!card) return new Response(JSON.stringify({ error: "Card not found or access denied" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const { data: profile } = await supabase.from("profiles").select("ai_provider, ai_model, ai_api_key, ai_endpoint").eq("user_id", userId).single();

  // Build questions
  let questions: string[] = [];
  if (customQuestion) {
    questions = [customQuestion];
  } else if (card.question_set_id) {
    const { data: qs } = await supabase.from("question_sets").select("questions").eq("id", card.question_set_id).single();
    if (qs?.questions) questions = qs.questions;
  } else if (card.reference_card_templates?.custom_questions) {
    const tq = card.reference_card_templates.custom_questions as string[];
    if (Array.isArray(tq)) questions = tq;
  }

  if (questions.length === 0) {
    // Fallback when the card has no question set assigned. Pick the set marked as
    // default (is_global) first, then the oldest active set. Deterministic so the
    // default chosen on the Reference Card Questions page is always the one used.
    const { data: fallbackSet } = await supabase
      .from("question_sets")
      .select("questions")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("is_global", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    questions = fallbackSet?.questions || ["What is the main argument?", "What evidence supports it?", "How is this relevant to my work?"];
  }

  const contentLength = card.original_text?.length || 0;
  const contentQuality = contentLength < 100 ? "low" : contentLength < 500 ? "medium" : "high";
  const contentWarning = contentLength < 100 ? "Very short content - may lack substance" : null;

  const prompt = `Analyze this content and provide a summary plus answers to specific questions.

Title: ${card.title || "Untitled"}
Source: ${card.source_url || "Unknown"}

${card.original_text || "No content available"}

---

Provide:
1. A brief 2-3 sentence summary
2. Answers to these questions:
${questions.map((q, i) => `   ${i + 1}. ${q}`).join("\n")}

Respond ONLY with valid JSON:
{
  "summary": "2-3 sentence summary",
  "answers": {
    ${questions.map(q => `"${q}": "answer"`).join(",\n    ")}
  }
}`;

  let result;
  if (profile?.ai_api_key) {
    const aiProfile = { ai_provider: profile.ai_provider, ai_model: profile.ai_model, ai_api_key: profile.ai_api_key, ai_endpoint: profile.ai_endpoint };
    const response = await callAI(aiProfile, [{ role: "user", content: prompt }], "You are a content analyst. Always respond with valid JSON only.");
    let content = response.text.trim();
    const fence = content.match(/```(?:\w*)?\s*([\s\S]*?)\s*```/i);
    if (fence) content = fence[1].trim();
    const jsonMatch = content.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonMatch) content = jsonMatch[1];
    result = JSON.parse(content);
  } else {
    result = { summary: "AI not configured — add your API key in Settings.", answers: {} };
  }

  let updatedAnswers = result.answers || {};
  if (customQuestion && card.insight_answers) {
    const existing = typeof card.insight_answers === 'object' ? card.insight_answers : {};
    updatedAnswers = { ...existing, [`[Custom - ${new Date().toLocaleDateString()}] ${customQuestion}`]: result.answers?.[customQuestion] || Object.values(result.answers || {})[0] || "" };
  }

  // Real relevance scoring. create-manual-source (and older ingestion paths)
  // insert every card with a hardcoded global_relevance_score of 5 as a
  // placeholder — this is the one place non-automated cards ever get
  // processed after creation, so it's also the one place that placeholder
  // can actually get replaced with a real, AI-graded score against this
  // company's strategy. Fails open to the existing score (not a fresh
  // guess) if scoring itself fails, so a scorer outage never overwrites a
  // real score with noise.
  let relevanceScore = card.global_relevance_score;
  try {
    const verdict = await scoreRelevance(supabase, userId, {
      title: card.title || "",
      content: card.original_text || "",
    });
    relevanceScore = verdict.score;
  } catch (err) {
    console.error("Relevance scoring failed during processing, keeping existing score:", err);
  }

  // The auto-delete rule (score below profiles.auto_delete_score_threshold)
  // is enforced entirely by a database trigger on reference_cards
  // (enforce_relevance_threshold), not here. It fires on this UPDATE the
  // same way it fires on any insert/update from any code path — ingestion,
  // a manual edit, a future backfill — so there's exactly one place the
  // rule lives instead of one copy per call site. This function just writes
  // the real score and lets the trigger decide whether the row survives.
  const { data: updated } = await supabase
    .from("reference_cards")
    .update({
      ai_summary: result.summary,
      insight_answers: updatedAnswers,
      content_quality: contentQuality,
      content_warning: contentWarning,
      status: "active",
      global_relevance_score: relevanceScore,
      updated_at: new Date().toISOString()
    })
    .eq("id", cardId)
    .select("id")
    .maybeSingle();

  if (!updated) {
    // The trigger deleted the row as part of the update above.
    return new Response(JSON.stringify({
      success: true,
      deleted: true,
      cardId,
      relevanceScore,
      reason: `Scored ${relevanceScore}, below your auto-delete threshold`,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({ success: true, cardId, summary: result.summary, answers: updatedAnswers, quality: contentQuality, relevanceScore }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
