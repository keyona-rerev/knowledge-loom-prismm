import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Inlined from _shared/ai-caller.ts ─────────────────────────────────────
interface AIProfile { ai_provider: string; ai_model: string; ai_api_key: string; ai_endpoint?: string; }
interface AIMessage { role: "user" | "assistant" | "system"; content: string; }
interface AIResponse { text: string; provider: string; model: string; }

async function callAnthropic(profile: AIProfile, messages: AIMessage[], system?: string): Promise<string> {
  const model = profile.ai_model || "claude-sonnet-4-20250514";
  const body: Record<string, unknown> = { model, max_tokens: 8192, messages: messages.filter(m => m.role !== "system") };
  if (system) body.system = system;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": profile.ai_api_key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content?.[0]?.text ?? "";
}

async function callGemini(profile: AIProfile, messages: AIMessage[], system?: string): Promise<string> {
  const model = profile.ai_model || "gemini-2.0-flash-exp";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${profile.ai_api_key}`;
  const contents = messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  if (system && contents.length > 0) contents[0].parts[0].text = `${system}\n\n${contents[0].parts[0].text}`;
  const res = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents, generationConfig: { temperature: 0.7, maxOutputTokens: 8192 } }),
  });
  if (!res.ok) throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

async function callOpenAICompat(profile: AIProfile, messages: AIMessage[], system?: string): Promise<string> {
  const endpoints: Record<string, string> = {
    openai: "https://api.openai.com/v1/chat/completions",
    grok: "https://api.x.ai/v1/chat/completions",
    deepseek: "https://api.deepseek.com/v1/chat/completions",
  };
  const url = profile.ai_endpoint || endpoints[profile.ai_provider] || endpoints.openai;
  const model = profile.ai_model || "gpt-4o";
  const allMessages = system ? [{ role: "system", content: system }, ...messages] : messages;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${profile.ai_api_key}` },
    body: JSON.stringify({ model, messages: allMessages, max_tokens: 8192 }),
  });
  if (!res.ok) throw new Error(`${profile.ai_provider} API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

async function callAI(profile: AIProfile, messages: AIMessage[], system?: string): Promise<AIResponse> {
  if (!profile.ai_api_key) throw new Error("No AI API key configured. Add your key in Settings.");
  let text: string;
  switch (profile.ai_provider) {
    case "anthropic": text = await callAnthropic(profile, messages, system); break;
    case "google-ai": text = await callGemini(profile, messages, system); break;
    case "openai": case "grok": case "deepseek": case "custom": text = await callOpenAICompat(profile, messages, system); break;
    default: text = await callAnthropic(profile, messages, system);
  }
  return { text, provider: profile.ai_provider, model: profile.ai_model };
}

async function loadAIProfile(supabase: any, userId: string): Promise<AIProfile> {
  const { data, error } = await supabase.from("profiles").select("ai_provider, ai_model, ai_api_key, ai_endpoint").eq("user_id", userId).single();
  if (error || !data) throw new Error("Failed to load AI profile for user");
  return data as AIProfile;
}

// ─── Inlined + updated from _shared/relevance-scorer.ts ────────────────────
interface ScoreVerdict { score: number; relevant: boolean; reason: string; }

function buildScoreSystemPrompt(business: { name?: string | null; description?: string | null } | null, ruleLines: string[]): string {
  const identity = business?.description
    ? `You are a relevance scorer for ${business.name || "a company"}, positioned as: ${business.description}`
    : "You are a relevance scorer for a company that has not yet described its positioning in Strategy — score on general business/professional relevance only, since there's no specific positioning to measure against yet.";
  const rules = ruleLines.length ? `\n\nThis company's framing rules: ${ruleLines.join("; ")}.` : "";
  return `${identity}${rules}

You grade source content 1-10 for how useful it would be as material for THIS company's content strategy. The distinction that matters most is between "on-topic for the industry" and "on-topic for THIS company's specific positioning" — those are not the same thing, and the gap between a 6 and a 10 should track that difference, not general subject-matter overlap.

Score 1-2: pure noise. Ads, unsubscribe/footer boilerplate, paywall stubs, broken or empty scrapes, spam.
Score 3-5: real content, but only loosely related to this company's industry or audience — true and on-topic in a general sense, not specifically about what this company argues or who it serves.
Score 6-7: speaks to this company's actual market or audience, but doesn't engage its specific positioning above — solid industry-relevant material, not a direct hit.
Score 8-10: speaks directly to this company's stated positioning — the more precisely it could be cited to support (or seriously challenge) that exact argument, the higher within this range.

Respond with ONLY minified JSON, no other text: {"score":<1-10 integer>,"reason":"<max 15 words>"}. Err toward the middle (5) when genuinely unsure rather than guessing at an extreme.`;
}

async function scoreRelevance(supabase: any, userId: string, input: { title: string; content: string }): Promise<ScoreVerdict> {
  let profile: AIProfile;
  try {
    profile = await loadAIProfile(supabase, userId);
  } catch {
    return { score: 5, relevant: true, reason: "No AI profile configured - scoring skipped" };
  }
  if (!profile.ai_api_key) return { score: 5, relevant: true, reason: "No AI key configured - scoring skipped" };

  const [{ data: prof }, { data: rules }] = await Promise.all([
    supabase.from("profiles").select("business_name, business_description").eq("user_id", userId).maybeSingle(),
    supabase.from("hard_rules").select("body").eq("user_id", userId).eq("is_active", true),
  ]);
  const ruleLines = (rules || []).map((r: { body: string }) => r.body).filter(Boolean);
  const systemPrompt = buildScoreSystemPrompt(prof, ruleLines);
  const excerpt = (input.content || "").slice(0, 3000);

  try {
    const res = await callAI(profile, [{ role: "user", content: `Title: ${input.title || "(untitled)"}\n\nExcerpt:\n${excerpt || "(empty)"}` }], systemPrompt);
    const match = res.text.match(/\{[\s\S]*\}/);
    if (!match) return { score: 5, relevant: true, reason: "Score response unparseable - defaulted to 5" };
    const parsed = JSON.parse(match[0]);
    const rawScore = Number(parsed.score);
    if (!Number.isFinite(rawScore)) return { score: 5, relevant: true, reason: "Score response malformed - defaulted to 5" };
    const score = Math.min(10, Math.max(1, Math.round(rawScore)));
    return { score, relevant: score >= 3, reason: String(parsed.reason || "").slice(0, 200) };
  } catch (err) {
    console.error("Relevance scorer call failed, defaulting to 5:", err);
    return { score: 5, relevant: true, reason: "Scoring call failed - defaulted to 5" };
  }
}

// ─── process-reference-card itself ──────────────────────────────────────────
function parseJSON(text: string): any {
  let content = text.trim();
  const fence = content.match(/```(?:\w*)?\s*([\s\S]*?)\s*```/i);
  if (fence) content = fence[1].trim();
  const jsonMatch = content.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) content = jsonMatch[1];
  return JSON.parse(content);
}

// Titles that mean "nothing usable was actually extracted," so this pass
// should write a real one instead of leaving the placeholder in place
// forever. Case-insensitive match against the trimmed title.
const GENERIC_TITLES = new Set([
  "", "untitled", "untitled article", "pasted article", "pdf document",
  "site blocked access - manual review needed",
]);

function needsGeneratedTitle(title: string | null | undefined): boolean {
  return GENERIC_TITLES.has((title ?? "").trim().toLowerCase());
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
        let card: any = null;
        for (let attempt = 0; attempt < 4 && !card; attempt++) {
          if (attempt > 0) await new Promise((r) => setTimeout(r, 250 * attempt));
          const { data } = await supabase.from("reference_cards").select("user_id").eq("id", body.cardId).single();
          card = data;
        }
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

  let card: any = null;
  for (let attempt = 0; attempt < 4 && !card; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 250 * attempt));
    const { data } = await supabase.from("reference_cards").select("*, reference_card_templates(custom_questions)").eq("id", cardId).eq("user_id", userId).single();
    card = data;
  }
  if (!card) return new Response(JSON.stringify({ error: "Card not found or access denied" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const { data: profile } = await supabase.from("profiles").select("ai_provider, ai_model, ai_api_key, ai_endpoint").eq("user_id", userId).single();

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

  // Only ask for a generated title when the extracted one is genuinely
  // unusable (empty, or one of the pipeline's own placeholder strings like
  // "Untitled Article") — never overwrite a real title a site actually
  // provided or the user typed in themselves.
  const generateTitle = needsGeneratedTitle(card.title) && contentLength >= 100;

  const prompt = `Analyze this content and provide a summary plus answers to specific questions.
${generateTitle ? `\nThis source has no usable title (the page provided none, or it was blocked/placeholder text). Also write a concise, specific title for it -- 12 words or fewer, describing what this piece is actually about, not a generic category label. Base it only on the content below.\n` : ""}
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
  ${generateTitle ? '"title": "a concise, specific title generated from the content above",\n  ' : ""}"summary": "2-3 sentence summary",
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

  const generatedTitle = generateTitle && typeof result.title === "string" && result.title.trim()
    ? result.title.trim().slice(0, 255)
    : null;

  const { data: updated } = await supabase
    .from("reference_cards")
    .update({
      ...(generatedTitle ? { title: generatedTitle } : {}),
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
    return new Response(JSON.stringify({
      success: true,
      deleted: true,
      cardId,
      relevanceScore,
      reason: `Scored ${relevanceScore}, below your auto-delete threshold`,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({ success: true, cardId, title: generatedTitle ?? card.title, summary: result.summary, answers: updatedAnswers, quality: contentQuality, relevanceScore }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
