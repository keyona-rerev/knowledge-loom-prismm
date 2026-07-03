/**
 * Relevance scorer for automated ingestion. Unlike relevance-gate.ts (a
 * binary keep/skip check run before card creation), this grades content
 * 1-10 against this company's actual strategy, business description and
 * hard rules, so the stored global_relevance_score is a real signal instead
 * of a placeholder. Used by ingest-gmail-content (the live Gmail-label
 * ingestion path) and by scan-newsletter-health when it needs a fresh score.
 *
 * Fails open on any error (missing AI profile, malformed response, API
 * failure) by returning a neutral 5 — a broken scorer should never block
 * ingestion, it should just mean "unscored" in practice.
 */
import { callAI, loadAIProfile, type AIProfile } from "./ai-caller.ts";

export interface ScoreVerdict {
  score: number; // 1-10
  relevant: boolean; // score >= 3 — worth keeping as a card at all
  reason: string;
}

const SCORE_SYSTEM_PROMPT = `You are a relevance scorer for a content pipeline that turns source material into reference cards used to ground thought-leadership posts for a specific company. Given that company's positioning and a piece of source content, score how useful this content is as source material for that company's content strategy, on a scale of 1 to 10. Score 1-2 for pure noise: ads, unsubscribe/footer boilerplate, paywall stubs, broken or empty scrapes, spam. Score 3-5 for content that's real but only loosely related to the company's industry or audience. Score 6-10 for content that speaks directly to the company's market, audience, or thesis, the higher the more directly citable. Respond with ONLY minified JSON, no other text: {"score":<1-10 integer>,"reason":"<max 15 words>"}. Err toward the middle (5) when genuinely unsure rather than guessing at an extreme.`;

export async function scoreRelevance(
  supabase: ReturnType<typeof import("https://esm.sh/@supabase/supabase-js@2").createClient>,
  userId: string,
  input: { title: string; content: string }
): Promise<ScoreVerdict> {
  let profile: AIProfile;
  try {
    profile = await loadAIProfile(supabase, userId);
  } catch {
    return { score: 5, relevant: true, reason: "No AI profile configured - scoring skipped" };
  }
  if (!profile.ai_api_key) {
    return { score: 5, relevant: true, reason: "No AI key configured - scoring skipped" };
  }

  // Light strategy context — enough to judge fit without pulling the whole
  // Strategy page. business_description is the one field every profile has;
  // hard_rules are optional and often empty early on.
  const [{ data: prof }, { data: rules }] = await Promise.all([
    supabase.from("profiles").select("business_name, business_description").eq("user_id", userId).maybeSingle(),
    supabase.from("hard_rules").select("body").eq("user_id", userId).eq("is_active", true),
  ]);

  const ruleLines = (rules || []).map((r: { body: string }) => r.body).filter(Boolean);
  const context = prof?.business_description
    ? `Company: ${prof.business_name || "the company"}. Positioning: ${prof.business_description}` +
      (ruleLines.length ? `\nFraming rules: ${ruleLines.join("; ")}` : "")
    : "No strategy context configured for this company yet — score on general business/professional relevance.";

  const excerpt = (input.content || "").slice(0, 3000);

  try {
    const res = await callAI(
      profile,
      [{ role: "user", content: `${context}\n\nTitle: ${input.title || "(untitled)"}\n\nExcerpt:\n${excerpt || "(empty)"}` }],
      SCORE_SYSTEM_PROMPT
    );

    const match = res.text.match(/\{[\s\S]*\}/);
    if (!match) {
      console.warn("Relevance scorer: unparseable response, defaulting to 5:", res.text.slice(0, 200));
      return { score: 5, relevant: true, reason: "Score response unparseable - defaulted to 5" };
    }

    const parsed = JSON.parse(match[0]);
    const rawScore = Number(parsed.score);
    if (!Number.isFinite(rawScore)) {
      return { score: 5, relevant: true, reason: "Score response malformed - defaulted to 5" };
    }
    const score = Math.min(10, Math.max(1, Math.round(rawScore)));

    return { score, relevant: score >= 3, reason: String(parsed.reason || "").slice(0, 200) };
  } catch (err) {
    console.error("Relevance scorer call failed, defaulting to 5:", err);
    return { score: 5, relevant: true, reason: "Scoring call failed - defaulted to 5" };
  }
}
