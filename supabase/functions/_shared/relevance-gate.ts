/**
 * Lightweight relevance gate for automated ingestion (RSS pulls, newsletter
 * emails). Runs a cheap AI classification before a reference card is created
 * so obvious noise (ads, unsubscribe boilerplate, paywall stubs, broken
 * scrapes, off-topic spam) never becomes a card that needs manual cleanup.
 *
 * Fails open on any error (missing AI profile, malformed response, API
 * failure) — a broken gate should never block real ingestion.
 */
import { callAI, loadAIProfile, type AIProfile } from "./ai-caller.ts";

export interface RelevanceVerdict {
  relevant: boolean;
  reason: string;
}

const GATE_SYSTEM_PROMPT = `You are a fast relevance filter for a content pipeline that turns source material into reference cards used to ground thought-leadership posts (LinkedIn, Instagram, and other platforms). Given a title and excerpt, decide whether it is substantive enough to be worth saving as a reference card, or whether it is noise: ads, unsubscribe/footer boilerplate, paywall stubs, broken or empty scrapes, spam, or content that is wildly off-topic from business, professional, or industry insight. Respond with ONLY minified JSON, no other text: {"relevant":true|false,"reason":"<max 15 words>"}. Err toward relevant when genuinely unsure.`;

export async function assessRelevance(
  supabase: ReturnType<typeof import("https://esm.sh/@supabase/supabase-js@2").createClient>,
  userId: string,
  input: { title: string; content: string }
): Promise<RelevanceVerdict> {
  let profile: AIProfile;
  try {
    profile = await loadAIProfile(supabase, userId);
  } catch {
    return { relevant: true, reason: "No AI profile configured - gate skipped" };
  }
  if (!profile.ai_api_key) {
    return { relevant: true, reason: "No AI key configured - gate skipped" };
  }

  const excerpt = (input.content || "").slice(0, 3000);

  try {
    const res = await callAI(
      profile,
      [{ role: "user", content: `Title: ${input.title || "(untitled)"}\n\nExcerpt:\n${excerpt || "(empty)"}` }],
      GATE_SYSTEM_PROMPT
    );

    const match = res.text.match(/\{[\s\S]*\}/);
    if (!match) {
      console.warn("Relevance gate: unparseable response, defaulting to relevant:", res.text.slice(0, 200));
      return { relevant: true, reason: "Gate response unparseable - defaulted to relevant" };
    }

    const parsed = JSON.parse(match[0]);
    if (typeof parsed.relevant !== "boolean") {
      return { relevant: true, reason: "Gate response malformed - defaulted to relevant" };
    }

    return { relevant: parsed.relevant, reason: String(parsed.reason || "").slice(0, 200) };
  } catch (err) {
    console.error("Relevance gate call failed, defaulting to relevant:", err);
    return { relevant: true, reason: "Gate call failed - defaulted to relevant" };
  }
}
