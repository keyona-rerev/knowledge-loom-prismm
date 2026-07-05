import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Finds candidate source URLs via Claude's native web search tool (same
// Anthropic key already configured for content generation — no separate
// search provider or key needed). This function ONLY finds and returns
// candidate {title, url, reason} triples; it does not fetch full content,
// score, or create any reference_cards. The caller (DiscoverSources.tsx)
// is responsible for feeding each candidate through the existing
// create-manual-source pipeline, which fetches the real article and
// triggers process-reference-card to assign a real score — the same
// scoring every other source in the app goes through, including the
// auto-delete trigger that silently drops anything below the user's
// configured threshold. This split keeps "find candidates" (one AI call)
// separate from "vet and ingest" (one call per candidate), so the frontend
// can show live per-candidate progress instead of one long opaque call.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function parseJSON(text: string): any {
  let content = text.trim();
  const fence = content.match(/```(?:\w*)?\s*([\s\S]*?)\s*```/i);
  if (fence) content = fence[1].trim();
  const jsonMatch = content.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) content = jsonMatch[1];
  return JSON.parse(content);
}

const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authentication required" }, 401);

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const supabaseAuth = createClient(supabaseUrl, serviceRoleKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) return json({ error: "Invalid or expired authentication token" }, 401);
    const userId = user.id;

    const body = await req.json();
    const targetCount: number = Math.max(1, Math.min(15, Number(body.targetCount) || 5));
    const excludeUrls: string[] = arr(body.excludeUrls).slice(0, 200);

    const { data: profile } = await supabase
      .from("profiles")
      .select("ai_provider, ai_model, ai_api_key, business_name, business_description")
      .eq("user_id", userId)
      .single();
    if (!profile) return json({ error: "Profile not found" }, 404);
    if (!profile.ai_api_key) return json({ error: "No AI API key configured in Settings" }, 400);

    // Web search (the Anthropic-native tool this whole feature is built on)
    // is only available through Anthropic's own Messages API, not through
    // the OpenAI-compatible path used for other providers. Rather than
    // silently degrading to a plain (non-searching) call — which would let
    // Claude invent plausible-sounding but fake URLs — this fails loudly so
    // the person knows exactly why nothing was found.
    if (profile.ai_provider !== "anthropic") {
      return json({ error: "Source discovery needs the Anthropic provider (for its built-in web search). Switch to Anthropic in Settings, or ask for this to be extended to your current provider." }, 400);
    }

    const { data: audience } = await supabase.from("audience_profile").select("*").eq("user_id", userId).maybeSingle();
    const { data: hardRulesRows } = await supabase
      .from("hard_rules").select("body").eq("user_id", userId).eq("is_active", true).order("sort_order");
    const hardRules = (hardRulesRows || []).map((r: any) => String(r.body ?? "").trim()).filter(Boolean);

    const contextLines: string[] = [];
    if (profile.business_name || profile.business_description) {
      contextLines.push(`Company: ${profile.business_name || "the company"}`);
      if (profile.business_description) contextLines.push(`Positioning: ${profile.business_description}`);
    }
    if (audience?.thesis) contextLines.push(`Audience thesis: ${audience.thesis}`);
    if (arr(audience?.fit_criteria).length) contextLines.push(`Fit criteria: ${arr(audience.fit_criteria).join("; ")}`);
    if (audience?.institution_type) contextLines.push(`Institution type: ${audience.institution_type}`);
    if (hardRules.length) contextLines.push(`Framing rules: ${hardRules.join("; ")}`);
    const context = contextLines.length ? contextLines.join("\n") : "No strategy context configured yet — search for general high-quality business/industry news relevant to a professional B2B audience.";

    const excludeBlock = excludeUrls.length
      ? `\n\nDo NOT return any of these URLs — already seen this session:\n${excludeUrls.slice(0, 100).join("\n")}`
      : "";

    const userPrompt = `${context}

Search the web for ${Math.min(Math.max(targetCount, 1), 15)} distinct, real, currently-live articles or reports that would make strong, citable source material for this company's content strategy. Prioritize substantive, specific, recently published pieces (news, research, data, industry analysis) over generic evergreen listicles. Every URL must come from an actual search result — never invent or guess a URL.${excludeBlock}

Respond with ONLY minified JSON, no other text: {"candidates":[{"title":"...","url":"...","reason":"one short phrase on why this fits"}]}`;

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": profile.ai_api_key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: profile.ai_model || "claude-sonnet-4-6",
        max_tokens: 4096,
        messages: [{ role: "user", content: userPrompt }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      return json({ error: `Anthropic API error ${anthropicRes.status}: ${errText.slice(0, 300)}` }, 502);
    }

    const data = await anthropicRes.json();
    // The response can contain server_tool_use / web_search_tool_result
    // blocks interleaved with text blocks. The final answer (the JSON we
    // asked for) is the last text block.
    const textBlocks = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text);
    const finalText = textBlocks[textBlocks.length - 1] || "";

    let parsed: any;
    try {
      parsed = parseJSON(finalText);
    } catch {
      return json({ error: "Could not parse search results", raw: finalText.slice(0, 500) }, 502);
    }

    const rawCandidates = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
    const cleaned = rawCandidates
      .map((c: any) => ({
        title: String(c?.title ?? "").slice(0, 300).trim(),
        url: String(c?.url ?? "").trim(),
        reason: String(c?.reason ?? "").slice(0, 200).trim(),
      }))
      .filter((c: any) => c.url && /^https?:\/\//i.test(c.url));

    return json({ success: true, candidates: cleaned });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
