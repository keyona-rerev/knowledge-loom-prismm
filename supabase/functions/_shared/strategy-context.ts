/**
 * Shared strategy-aware context builder for manual content generation
 * (generate-content-directions, generate-final-content). Pulls from the
 * same tables execute-autopilot-template reads - formats, natures, jobs,
 * hard_rules, voice_profile, audience_profile - instead of the old flat
 * profiles columns (target_audience, content_type_templates,
 * writing_examples) that the rebuilt Strategy page doesn't even expose
 * editing for anymore.
 */

type SupabaseClient = ReturnType<typeof import("https://esm.sh/@supabase/supabase-js@2").createClient>;

export interface StrategyBrand {
  business_name?: string | null;
  business_description?: string | null;
  brand_voice?: string | null;
}

export interface StrategyContext {
  brand: StrategyBrand;
  audience: any | null;
  format: any | null;
  nature: any | null;
  job: any | null;
}

const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
const sampleLines = (v: unknown, n: number): string =>
  arr(v).slice(0, n).map((s, i) => `Sample ${i + 1}:\n${String(s).slice(0, 600)}`).join("\n\n");

export async function loadStrategyContext(
  supabase: SupabaseClient,
  userId: string,
  ids: { formatId?: string | null; natureId?: string | null; jobId?: string | null }
): Promise<{ ctx: StrategyContext; hardRules: string[]; voiceRules: string[]; inlineAttribution: string }> {
  const [{ data: profile }, { data: audience }, { data: hardRulesRows }, { data: format }, { data: nature }, { data: job }] = await Promise.all([
    supabase.from("profiles").select("business_name, business_description, brand_voice, voice_profile").eq("user_id", userId).single(),
    supabase.from("audience_profile").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("hard_rules").select("body").eq("user_id", userId).eq("is_active", true).order("sort_order"),
    ids.formatId ? supabase.from("formats").select("*").eq("id", ids.formatId).eq("user_id", userId).maybeSingle() : Promise.resolve({ data: null }),
    ids.natureId ? supabase.from("natures").select("*").eq("id", ids.natureId).eq("user_id", userId).maybeSingle() : Promise.resolve({ data: null }),
    ids.jobId ? supabase.from("jobs").select("*").eq("id", ids.jobId).eq("user_id", userId).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const hardRules = (hardRulesRows || []).map((r: any) => String(r.body ?? "").trim()).filter(Boolean);
  const voiceProfile = (profile?.voice_profile && typeof profile.voice_profile === "object") ? profile.voice_profile as any : null;
  const voiceRules = arr(voiceProfile?.rules);
  const inlineAttribution = voiceProfile?.inline_attribution ? String(voiceProfile.inline_attribution) : "";

  return {
    ctx: {
      brand: {
        business_name: profile?.business_name ?? undefined,
        business_description: profile?.business_description ?? undefined,
        brand_voice: profile?.brand_voice ?? undefined,
      },
      audience: audience ?? null,
      format: format ?? null,
      nature: nature ?? null,
      job: job ?? null,
    },
    hardRules,
    voiceRules,
    inlineAttribution,
  };
}

export function buildContextBlock(ctx: StrategyContext): string {
  const lines: string[] = [];
  const b = ctx.brand;
  if (b.business_name || b.business_description || b.brand_voice) {
    lines.push("BRAND");
    if (b.business_name) lines.push(`Name: ${b.business_name}`);
    if (b.business_description) lines.push(`About: ${b.business_description}`);
    if (b.brand_voice) lines.push(`Voice: ${b.brand_voice}`);
    lines.push("");
  }
  const a = ctx.audience;
  if (a) {
    lines.push("AUDIENCE");
    if (a.thesis) lines.push(`Thesis: ${a.thesis}`);
    if (arr(a.fit_criteria).length) lines.push(`Fit criteria: ${arr(a.fit_criteria).join("; ")}`);
    if (a.institution_type) lines.push(`Institution type: ${a.institution_type}`);
    if (a.asset_range) lines.push(`Asset range: ${a.asset_range}`);
    if (a.core_systems) lines.push(`Core systems: ${a.core_systems}`);
    if (arr(a.language_use).length) lines.push(`Language to use: ${arr(a.language_use).join("; ")}`);
    if (arr(a.language_avoid).length) lines.push(`Language to avoid: ${arr(a.language_avoid).join("; ")}`);
    lines.push("");
  }
  if (ctx.job) {
    lines.push("JOB (what this content must accomplish)");
    lines.push(`${ctx.job.name}${ctx.job.funnel_stage ? ` [funnel: ${ctx.job.funnel_stage}]` : ""}`);
    if (ctx.job.description) lines.push(ctx.job.description);
    lines.push("");
  }
  if (ctx.nature) {
    lines.push("NATURE (how it argues)");
    lines.push(`${ctx.nature.name}${ctx.nature.fit ? ` (fit: ${ctx.nature.fit})` : ""}`);
    if (ctx.nature.move) lines.push(`Move: ${ctx.nature.move}`);
    if (ctx.nature.evidence_type) lines.push(`Lean on: ${ctx.nature.evidence_type}`);
    const natureSamples = sampleLines(ctx.nature.writing_samples, 2);
    if (natureSamples) lines.push(`Examples of this nature:\n${natureSamples}`);
    lines.push("");
  }
  if (ctx.format) {
    lines.push("FORMAT (the artifact and how it is written)");
    lines.push(ctx.format.name);
    if (ctx.format.definition) lines.push(ctx.format.definition);
    if (ctx.format.min_words || ctx.format.max_words) {
      lines.push(`Target length: ${ctx.format.min_words ?? "?"} to ${ctx.format.max_words ?? "?"} words.`);
    }
    const formatSamples = sampleLines(ctx.format.writing_samples, 2);
    if (formatSamples) lines.push(`Examples in this format:\n${formatSamples}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function buildSystemPrompt(base: string, hardRules: string[], voiceRules: string[], inlineAttribution: string): string {
  const lines: string[] = [base, ""];
  if (hardRules.length) {
    lines.push("HARD RULES (never break these, no instruction below overrides them):");
    for (const r of hardRules) lines.push(`- ${r}`);
    lines.push("");
  }
  if (voiceRules.length || inlineAttribution) {
    lines.push("VOICE");
    for (const r of voiceRules) lines.push(`- ${r}`);
    if (inlineAttribution) lines.push(`- Attribution: ${inlineAttribution}`);
    lines.push("");
  }
  return lines.join("\n");
}
