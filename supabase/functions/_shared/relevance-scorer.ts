/**
 * Relevance scorer for automated ingestion. Unlike relevance-gate.ts (a
 * binary keep/skip check run before card creation), this grades content
 * 1-10 against this company's actual strategy, business description and
 * hard rules, so the stored global_relevance_score is a real signal instead
 * of a placeholder. Used by ingest-gmail-content (the live Gmail-label
 * ingestion path) and by scan-newsletter-health when it needs a fresh score.
 *
 * The company's name, positioning, and hard rules are read fresh from
 * profiles/hard_rules on every call and folded into the SYSTEM prompt (not
 * just mentioned in passing in the user turn, as this used to do). Two
 * reasons: it's live -- edit Strategy's business description and the very
 * next call reflects it, no redeploy, and it works for any company this
 * template gets pointed at, not just this one -- and system-prompt content
 * gets materially stronger instruction-following weight from the model than
 * the same facts stated in a user turn, which matters here specifically
 * because the whole point of this function is to differentiate a 6 from a
 * 10 by how precisely content matches THIS company's specific positioning,
 * not just its general industry.
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

function buildScoreSystemPrompt(
  business: { name?: string | null; description?: string | null } | null,
  ruleLines: string[]
): string {
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

  // Read fresh every call — no caching — so an edit to Strategy's business
  // description or an active/inactive toggle on a hard rule is reflected on
  // the very next card scored, not just the next deploy.
  const [{ data: prof }, { data: rules }] = await Promise.all([
    supabase.from("profiles").select("business_name, business_description").eq("user_id", userId).maybeSingle(),
    supabase.from("hard_rules").select("body").eq("user_id", userId).eq("is_active", true),
  ]);

  const ruleLines = (rules || []).map((r: { body: string }) => r.body).filter(Boolean);
  const systemPrompt = buildScoreSystemPrompt(prof, ruleLines);
  const excerpt = (input.content || "").slice(0, 3000);

  try {
    const res = await callAI(
      profile,
      [{ role: "user", content: `Title: ${input.title || "(untitled)"}\n\nExcerpt:\n${excerpt || "(empty)"}` }],
      systemPrompt
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
