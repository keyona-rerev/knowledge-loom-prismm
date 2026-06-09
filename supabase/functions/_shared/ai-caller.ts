/**
 * Shared AI caller utility for all Insight Forge edge functions.
 * Reads provider, model, api_key, and optional endpoint from the user profile
 * and routes to the correct API. Add new providers here — no edge function changes needed.
 */

export interface AIProfile {
  ai_provider: string;
  ai_model: string;
  ai_api_key: string;
  ai_endpoint?: string;
}

export interface AIMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AIResponse {
  text: string;
  provider: string;
  model: string;
}

// ─── Anthropic ────────────────────────────────────────────────────────────────
async function callAnthropic(profile: AIProfile, messages: AIMessage[], system?: string): Promise<string> {
  const model = profile.ai_model || "claude-sonnet-4-20250514";
  const body: Record<string, unknown> = {
    model,
    max_tokens: 8192,
    messages: messages.filter(m => m.role !== "system"),
  };
  if (system) body.system = system;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": profile.ai_api_key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text ?? "";
}

// ─── Google AI (Gemini) ───────────────────────────────────────────────────────
async function callGemini(profile: AIProfile, messages: AIMessage[], system?: string): Promise<string> {
  const model = profile.ai_model || "gemini-2.0-flash-exp";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${profile.ai_api_key}`;

  // Gemini doesn't have a system role — prepend to first user message
  const contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  if (system && contents.length > 0) {
    contents[0].parts[0].text = `${system}\n\n${contents[0].parts[0].text}`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents,
      generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

// ─── OpenAI-compatible (OpenAI, Grok, DeepSeek, Custom) ──────────────────────
async function callOpenAICompat(profile: AIProfile, messages: AIMessage[], system?: string): Promise<string> {
  const endpoints: Record<string, string> = {
    openai: "https://api.openai.com/v1/chat/completions",
    grok: "https://api.x.ai/v1/chat/completions",
    deepseek: "https://api.deepseek.com/v1/chat/completions",
  };

  const url = profile.ai_endpoint || endpoints[profile.ai_provider] || endpoints.openai;
  const model = profile.ai_model || "gpt-4o";

  const allMessages = system
    ? [{ role: "system", content: system }, ...messages]
    : messages;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${profile.ai_api_key}`,
    },
    body: JSON.stringify({ model, messages: allMessages, max_tokens: 8192 }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${profile.ai_provider} API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

// ─── Main caller — routes by provider ────────────────────────────────────────
export async function callAI(
  profile: AIProfile,
  messages: AIMessage[],
  system?: string
): Promise<AIResponse> {
  if (!profile.ai_api_key) {
    throw new Error("No AI API key configured. Add your key in Settings.");
  }

  let text: string;

  switch (profile.ai_provider) {
    case "anthropic":
      text = await callAnthropic(profile, messages, system);
      break;
    case "google-ai":
      text = await callGemini(profile, messages, system);
      break;
    case "openai":
    case "grok":
    case "deepseek":
    case "custom":
      text = await callOpenAICompat(profile, messages, system);
      break;
    default:
      // Default to Anthropic
      text = await callAnthropic(profile, messages, system);
  }

  return { text, provider: profile.ai_provider, model: profile.ai_model };
}

// ─── Helper: load AI profile from Supabase ───────────────────────────────────
export async function loadAIProfile(
  supabase: ReturnType<typeof import("https://esm.sh/@supabase/supabase-js@2").createClient>,
  userId: string
): Promise<AIProfile> {
  const { data, error } = await supabase
    .from("profiles")
    .select("ai_provider, ai_model, ai_api_key, ai_endpoint")
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    throw new Error("Failed to load AI profile for user");
  }

  return data as AIProfile;
}
