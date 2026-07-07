import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);

// This function is a READ-ONLY MIRROR of the system-prompt assembly inside
// execute-autopilot-template (the "Scheduled draft generation" /
// Cadence path) -- specifically the HARD RULES / VOICE / STATISTICS AND
// SOURCES / TRUSTED SOURCES block. It makes no AI call and writes nothing.
// Its only job is to let Settings show the literal text that would be sent,
// so "did my hard rule actually make it into the prompt" and "did editing
// Strategy actually change anything" both have a direct, verifiable answer
// instead of requiring trust.
//
// IMPORTANT: this is a second copy, not a shared import, because
// execute-autopilot-template's system-prompt block is inlined in that file
// rather than factored into _shared/strategy-context.ts (unlike
// generate-content-directions, generate-final-content, revise-draft, and
// regenerate-draft-with-feedback, which all call the real shared
// buildSystemPrompt from that module and so can never drift from what this
// function shows). If the two ever disagree, execute-autopilot-template's
// actual deployed code is the ground truth, not this file -- flag it for a
// refactor into a single shared function the next time both are touched.
//
// This identity line is itself a second copy of buildIdentityLine() in
// execute-autopilot-template/index.ts, kept in sync by hand for the same
// reason the rest of this file is a manual mirror rather than a shared
// import. It used to be a literal hardcoded Prismm sentence here even after
// execute-autopilot-template was fixed to read business_name/business_description
// -- this function already fetched both fields for the CONTEXT block below,
// just never used them for the line that actually claims to mirror the real
// system prompt.
function buildIdentityLine(businessName?: string | null, businessDescription?: string | null): string {
  if (businessName && businessDescription) {
    return `You are ${businessName}'s content engine. ${businessDescription}`;
  }
  if (businessName) {
    return `You are ${businessName}'s content engine.`;
  }
  return "You are this brand's content engine. Set a business name and description in Strategy for a more specific voice.";
}

function buildFreshGenerationSystemPrompt(
  identityLine: string,
  hardRules: string[],
  voiceRules: string[],
  inlineAttribution: string,
  approvedCards: any[],
): string {
  const sourceLine = (c: any) => {
    const summary = (c.ai_summary && String(c.ai_summary).trim()) ? String(c.ai_summary).trim() : String(c.original_text || "").slice(0, 400);
    const tag = c.from_company ? "[FROM THE COMPANY] " : "";
    return `- ${tag}${c.title || "Untitled"}: ${summary}`;
  };

  const systemLines: string[] = [
    identityLine,
    "Write in the brand voice and answer the reader's real questions.",
    "",
  ];
  if (hardRules.length) {
    systemLines.push("HARD RULES (never break these, no instruction below overrides them):");
    for (const r of hardRules) systemLines.push(`- ${r}`);
    systemLines.push("");
  }
  if (voiceRules.length || inlineAttribution) {
    systemLines.push("VOICE");
    for (const r of voiceRules) systemLines.push(`- ${r}`);
    if (inlineAttribution) systemLines.push(`- Attribution: ${inlineAttribution}`);
    systemLines.push("");
  }
  systemLines.push("STATISTICS AND SOURCES");
  systemLines.push("- State a figure or statistic only if it is attributable to one of the TRUSTED SOURCES below. Never invent a number and never cite a source that is not listed.");
  systemLines.push("- Weave each citation into the prose. Do not write it as a parenthetical footnote.");
  systemLines.push('- For every figure you state, record the figure and the exact source title it came from in "stat_attributions".');
  if (approvedCards.length) {
    systemLines.push("");
    systemLines.push("TRUSTED SOURCES (the only sources you may cite figures from):");
    for (const c of approvedCards) systemLines.push(sourceLine(c));
  } else {
    systemLines.push("- No trusted sources are available, so do not state any figures or statistics.");
  }
  systemLines.push("");
  systemLines.push('Respond with valid JSON only. Always include a "stat_attributions" array; use [] when the post states no figures.');
  return systemLines.join("\n");
}

// Same CONTEXT block shape execute-autopilot-template builds per slot
// (brand/audience/lane/reader/job/nature/format), condensed here to the
// fields that actually change what gets written, for the same reason as
// above: a direct rendering, not a description of one.
function buildSlotContextBlock(opts: {
  business_name?: string | null; business_description?: string | null; brand_voice?: string | null;
  format: any; nature: any; job: any; lane: any | null;
}): string {
  const lines: string[] = [];
  if (opts.business_name || opts.business_description || opts.brand_voice) {
    lines.push("BRAND");
    if (opts.business_name) lines.push(`Name: ${opts.business_name}`);
    if (opts.business_description) lines.push(`About: ${opts.business_description}`);
    if (opts.brand_voice) lines.push(`Voice: ${opts.brand_voice}`);
    lines.push("");
  }
  if (opts.lane) {
    lines.push("LANE");
    lines.push(`${opts.lane.name}${opts.lane.is_wedge ? " (wedge lane)" : ""}`);
    if (opts.lane.description) lines.push(opts.lane.description);
    lines.push("");
  }
  lines.push("JOB (what this post must accomplish)");
  lines.push(`${opts.job.name} [funnel: ${opts.job.funnel_stage}]`);
  if (opts.job.description) lines.push(opts.job.description);
  lines.push("");
  lines.push("NATURE (how the post argues)");
  lines.push(`${opts.nature.name} (fit: ${opts.nature.fit})`);
  if (opts.nature.move) lines.push(`Move: ${opts.nature.move}`);
  lines.push("");
  lines.push("FORMAT (the artifact and how it is written)");
  lines.push(opts.format.name);
  if (opts.format.min_words || opts.format.max_words) {
    lines.push(`Target length: ${opts.format.min_words ?? "?"} to ${opts.format.max_words ?? "?"} words.`);
  }
  return lines.join("\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authentication required" }, 401);

    const supabaseAuth = createClient(supabaseUrl, serviceRoleKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) return json({ error: "Invalid or expired authentication token" }, 401);

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { formatId, natureId, jobId, laneId } = await req.json();
    if (!formatId || !natureId || !jobId) {
      return json({ error: "formatId, natureId, and jobId are required" }, 400);
    }

    const [{ data: profile }, { data: hardRulesRows }, { data: format }, { data: nature }, { data: job }, { data: lane }, { data: approvedRaw }] = await Promise.all([
      supabase.from("profiles").select("business_name, business_description, brand_voice, voice_profile").eq("user_id", user.id).single(),
      supabase.from("hard_rules").select("body, is_active").eq("user_id", user.id).order("sort_order"),
      supabase.from("formats").select("*").eq("id", formatId).eq("user_id", user.id).maybeSingle(),
      supabase.from("natures").select("*").eq("id", natureId).eq("user_id", user.id).maybeSingle(),
      supabase.from("jobs").select("*").eq("id", jobId).eq("user_id", user.id).maybeSingle(),
      laneId ? supabase.from("lanes").select("*").eq("id", laneId).eq("user_id", user.id).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from("reference_cards").select("*").eq("user_id", user.id).eq("approved", true),
    ]);

    if (!format || !nature || !job) {
      return json({ error: "Could not find that format, nature, or job on your account" }, 404);
    }

    const activeHardRules = (hardRulesRows || []).filter((r: any) => r.is_active);
    const inactiveHardRuleCount = (hardRulesRows || []).length - activeHardRules.length;
    const hardRules = activeHardRules.map((r: any) => String(r.body ?? "").trim()).filter(Boolean);

    const voiceProfile = (profile?.voice_profile && typeof profile.voice_profile === "object") ? profile.voice_profile as any : null;
    const voiceRules = arr(voiceProfile?.rules);
    const inlineAttribution = voiceProfile?.inline_attribution ? String(voiceProfile.inline_attribution) : "";

    const approvedCards = (approvedRaw || []).filter((c: any) => {
      const q = c.content_quality ?? "";
      return q !== "error" && q !== "title_only" && c.status !== "archived" && c.status !== "inactive";
    });

    const identityLine = buildIdentityLine(profile?.business_name, profile?.business_description);
    const system = buildFreshGenerationSystemPrompt(identityLine, hardRules, voiceRules, inlineAttribution, approvedCards);
    const contextBlock = buildSlotContextBlock({
      business_name: profile?.business_name, business_description: profile?.business_description, brand_voice: profile?.brand_voice,
      format, nature, job, lane: lane ?? null,
    });

    return json({
      system,
      contextBlock,
      hardRuleCount: hardRules.length,
      inactiveHardRuleCount,
      trustedSourceCount: approvedCards.length,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
