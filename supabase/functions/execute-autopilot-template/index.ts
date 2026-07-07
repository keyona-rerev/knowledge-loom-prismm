import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI } from "../_shared/ai-caller.ts";
import { resolveNext, type Frequency } from "../_shared/schedule-resolver.ts";

// Knowledge Loom autopilot. A schedule slot is a standing instruction: produce a post
// of this format and nature, doing this job, for this lane and reader. Generation reads
// the strategy and audience libraries plus the seed bank, and the fresh path also pulls
// from the reference-card library, ranked by rotation first and then a first-party-weighted
// relevance, governed by the source faders. Newsletter intake still feeds reference cards
// in parallel and is untouched here.
//
// Per run a slot either resurfaces an eligible parent (reuse) or generates fresh. When the
// slot requires a child, fresh runs also produce a companion post in the child format.
//
// The child post is always a SHORT LinkedIn feed post that teases the parent article
// and drives readers to it. It is not a summary and not a copy. It opens a loop,
// surfaces one specific insight or provocation from the parent, and lets the article close it.

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
const sampleLines = (v: unknown, n: number): string =>
  arr(v).slice(0, n).map((s, i) => `Sample ${i + 1}:\n${String(s).slice(0, 600)}`).join("\n\n");

const statAttributions = (v: unknown): { figure: string; source: string }[] =>
  Array.isArray(v)
    ? v
        .filter((x) => x && typeof x === "object")
        .map((x: any) => ({ figure: String(x.figure ?? "").trim(), source: String(x.source ?? "").trim() }))
        .filter((x) => x.figure || x.source)
    : [];

const retiredStatFlag = (body: unknown): string | null => {
  const text = String(body ?? "").toLowerCase();
  const has70 = /\b70\s*(?:percent|%)/.test(text);
  if (has70 && (text.includes("communit") || text.includes("inherit") || text.includes("bank"))) {
    return "Resembles the retired 70 percent figure about inherited assets leaving community banks. Confirm the source before approving.";
  }
  return null;
};

// Builds the opening system-prompt line that establishes what the AI is
// writing on behalf of. Previously this was a hardcoded literal string
// naming Prismm specifically, disconnected from profile.business_name /
// business_description even though both are already fetched and used
// elsewhere in this same function's BRAND block. That meant switching this
// codebase to a different business would leave every single generated
// draft opening with the wrong company name and description, with no
// setting anywhere that could fix it. Now built from those same profile
// fields, with a generic fallback if neither is set.
function buildIdentityLine(businessName?: string, businessDescription?: string): string {
  if (businessName && businessDescription) {
    return `You are ${businessName}'s content engine. ${businessDescription}`;
  }
  if (businessName) {
    return `You are ${businessName}'s content engine.`;
  }
  return "You are this brand's content engine. Set a business name and description in Strategy for a more specific voice.";
}

interface GenSettings {
  source_reliance: number;
  first_party_weight: number;
  nature_intensity: number;
  voice_adherence: number;
}

interface SlotContext {
  format: any;
  nature: any;
  job: any;
  lane: any | null;
  reader: any | null;
  questions: string[];
  audience: any | null;
  swot: any[];
  seed: any | null;
  brand: { business_name?: string; business_description?: string; brand_voice?: string };
  gen: GenSettings;
}

function buildContextBlock(ctx: SlotContext): string {
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
    if (arr(a.channels).length) lines.push(`Channels: ${arr(a.channels).join(", ")}`);
    lines.push("");
  }
  // Strengths, weaknesses, and opportunities are always live. Triggered
  // threats are deliberately excluded: Strategy describes them as "held out
  // of rotation" until whatever real-world trigger fires, and there is no
  // mechanism anywhere that marks a trigger as having fired, so surfacing
  // them here unconditionally would contradict the one piece of behavior
  // the UI already promises for them. Standing threats have no such gate,
  // so they're always live same as the other three quadrants.
  const swotVisible = ctx.swot.filter((s) => s.quadrant !== "threat" || s.threat_class !== "triggered");
  if (swotVisible.length) {
    const swotLabels: Record<string, string> = { strength: "Strength", weakness: "Weakness", opportunity: "Opportunity", threat: "Threat" };
    lines.push("SWOT (the competitive terrain)");
    for (const s of swotVisible) {
      if (s.body) lines.push(`- [${swotLabels[s.quadrant] ?? s.quadrant}] ${s.body}`);
    }
    lines.push("");
  }
  if (ctx.lane) {
    lines.push("LANE");
    lines.push(`${ctx.lane.name}${ctx.lane.is_wedge ? " (wedge lane)" : ""}`);
    if (ctx.lane.description) lines.push(ctx.lane.description);
    if (arr(ctx.lane.vocabulary).length) lines.push(`Vocabulary: ${arr(ctx.lane.vocabulary).join(", ")}`);
    lines.push("");
  } else {
    lines.push("LANE: write so it lands in both lanes; avoid lane-specific jargon.");
    lines.push("");
  }
  if (ctx.reader) {
    lines.push("READER");
    lines.push(`Role: ${ctx.reader.role}${ctx.reader.who ? ` (${ctx.reader.who})` : ""}`);
    lines.push(`Side: ${ctx.reader.side === "end_user" ? "end user" : "decision maker"}`);
    if (ctx.questions.length) lines.push(`Questions this reader needs answered:\n- ${ctx.questions.join("\n- ")}`);
    lines.push("");
  } else {
    lines.push("READER: no single reader fixed; write to the audience broadly.");
    lines.push("");
  }
  lines.push("JOB (what this post must accomplish)");
  lines.push(`${ctx.job.name} [funnel: ${ctx.job.funnel_stage}]`);
  if (ctx.job.description) lines.push(ctx.job.description);
  lines.push("");
  lines.push("NATURE (how the post argues)");
  lines.push(`${ctx.nature.name} (fit: ${ctx.nature.fit})`);
  if (ctx.nature.move) lines.push(`Move: ${ctx.nature.move}`);
  if (ctx.nature.evidence_type) lines.push(`Lean on: ${ctx.nature.evidence_type}`);
  const natureSamples = sampleLines(ctx.nature.writing_samples, 2);
  if (natureSamples) lines.push(`Examples of this nature:\n${natureSamples}`);
  const intensity = ctx.gen.nature_intensity;
  if (intensity <= 2) lines.push("Apply this nature gently.");
  else if (intensity >= 4) lines.push("Commit hard to this nature, make its move unmistakable.");
  lines.push("");
  const adherence = ctx.gen.voice_adherence;
  lines.push("VOICE DISCIPLINE");
  if (adherence <= 2) lines.push("You may vary phrasing and structure freely.");
  else if (adherence === 3) lines.push("Balance the brand voice with natural variation.");
  else lines.push("Hold tightly to the brand voice, minimal stylistic deviation.");
  lines.push("");
  lines.push("FORMAT (the artifact and how it is written)");
  lines.push(ctx.format.name);
  if (ctx.format.definition) lines.push(ctx.format.definition);
  if (ctx.format.min_words || ctx.format.max_words) {
    lines.push(`Target length: ${ctx.format.min_words ?? "?"} to ${ctx.format.max_words ?? "?"} words.`);
  }
  const formatSamples = sampleLines(ctx.format.writing_samples, 2);
  if (formatSamples) lines.push(`Examples in this format:\n${formatSamples}`);
  return lines.join("\n");
}

function pickReader(readers: any[], lane: any | null): any | null {
  const published = readers.filter((r) => r.is_published_to);
  if (!published.length) return null;
  const laneKey = lane?.key;
  const matching = published.filter((r) => r.lane_scope === "both" || (laneKey && r.lane_scope === laneKey));
  const pool = matching.length ? matching : published;
  return pool[Math.floor(Math.random() * pool.length)];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authentication required" }, 401);

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const body = await req.json();
    const { scheduleId, isTestRun = false, scheduledForOverride } = body;
    if (!scheduleId) return json({ error: "scheduleId is required" }, 400);

    const token = authHeader.replace("Bearer ", "");
    let userId: string;
    if (token === serviceRoleKey) {
      if (!body.userId) return json({ error: "userId is required for internal invocation" }, 400);
      userId = body.userId;
    } else {
      const supabaseAuth = createClient(supabaseUrl, serviceRoleKey, { global: { headers: { Authorization: authHeader } } });
      const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
      if (authError || !user) return json({ error: "Invalid or expired authentication token" }, 401);
      userId = user.id;
    }

    const { data: slot } = await supabase
      .from("content_schedules")
      .select("*")
      .eq("id", scheduleId)
      .eq("user_id", userId)
      .eq("is_active", true)
      .single();
    if (!slot) return json({ error: "Slot not found, inactive, or access denied" }, 404);

    // scheduledForOverride lets a caller (the Cadence "fast-forward" batch
    // generator) stamp a specific future occurrence of this slot instead of
    // always the very next one. Without it, running the same slot several
    // times in one sitting would stack every draft onto the same date;
    // batch generation walks the slot's own cadence forward and passes a
    // different real occurrence in on each call. Every other caller
    // (the daily cron, the per-slot "Run" button) omits it and gets the
    // original behavior unchanged.
    const intendedScheduledFor = scheduledForOverride
      ?? resolveNext({
        day_of_week: slot.day_of_week,
        frequency: slot.frequency as Frequency,
        anchor: slot.anchor,
        time_of_day: slot.time_of_day,
        timezone: slot.timezone,
      }).scheduledFor;

    const { data: profile } = await supabase
      .from("profiles")
      .select("ai_provider, ai_model, ai_api_key, ai_endpoint, business_name, business_description, brand_voice, voice_profile, gen_source_reliance, gen_first_party_weight, gen_nature_intensity, gen_voice_adherence")
      .eq("user_id", userId)
      .single();
    if (!profile) return json({ error: "Profile not found" }, 404);
    if (!profile.ai_api_key) return json({ error: "No AI API key configured in Settings" }, 400);

    const aiProfile = { ai_provider: profile.ai_provider, ai_model: profile.ai_model, ai_api_key: profile.ai_api_key, ai_endpoint: profile.ai_endpoint };

    const gen: GenSettings = {
      source_reliance: profile.gen_source_reliance ?? 3,
      first_party_weight: profile.gen_first_party_weight ?? 4,
      nature_intensity: profile.gen_nature_intensity ?? 4,
      voice_adherence: profile.gen_voice_adherence ?? 5,
    };

    const [{ data: format }, { data: nature }, { data: job }] = await Promise.all([
      supabase.from("formats").select("*").eq("id", slot.format_id).eq("user_id", userId).single(),
      supabase.from("natures").select("*").eq("id", slot.nature_id).eq("user_id", userId).single(),
      supabase.from("jobs").select("*").eq("id", slot.job_id).eq("user_id", userId).single(),
    ]);
    if (!format || !nature || !job) return json({ error: "Slot references a missing format, nature, or job" }, 400);
    if (job.kind !== "engine_job") return json({ error: "Slot job must be an engine job" }, 400);

    let lane: any = null;
    if (slot.lane_id) {
      const { data } = await supabase.from("lanes").select("*").eq("id", slot.lane_id).eq("user_id", userId).maybeSingle();
      lane = data;
    }

    let reader: any = null;
    if (slot.reader_id) {
      const { data } = await supabase.from("readers").select("*").eq("id", slot.reader_id).eq("user_id", userId).maybeSingle();
      reader = data;
    } else {
      const { data: allReaders } = await supabase.from("readers").select("*").eq("user_id", userId).eq("is_active", true);
      reader = pickReader(allReaders || [], lane);
    }
    let questions: string[] = [];
    if (reader) {
      const { data: rq } = await supabase.from("reader_questions").select("question").eq("reader_id", reader.id).order("sort_order");
      questions = (rq || []).map((q) => q.question);
    }

    const { data: audience } = await supabase.from("audience_profile").select("*").eq("user_id", userId).maybeSingle();
    const { data: swotRows } = await supabase.from("swot_items").select("*").eq("user_id", userId).order("sort_order");
    const swot = swotRows || [];

    const laneScopes = ["both"];
    if (lane?.key === "credit_union" || lane?.key === "community_bank") laneScopes.push(lane.key);
    let seed: any = null;
    {
      const { data: seeds } = await supabase
        .from("seeds")
        .select("*")
        .eq("user_id", userId)
        .eq("is_active", true)
        .in("lane_scope", laneScopes)
        .order("last_used_at", { ascending: true, nullsFirst: true })
        .order("times_used", { ascending: true })
        .limit(20);
      const list = seeds || [];
      const byNature = list.filter((s) => s.suggested_nature_key && s.suggested_nature_key === nature.key);
      seed = (byNature[0] || list[0]) ?? null;
    }

    const brand = {
      business_name: profile.business_name ?? undefined,
      business_description: profile.business_description ?? undefined,
      brand_voice: profile.brand_voice ?? undefined,
    };
    const baseCtx: SlotContext = { format, nature, job, lane, reader, questions, audience, swot, seed, brand, gen };
    const contextBlock = buildContextBlock(baseCtx);

    const { data: hardRulesRows } = await supabase
      .from("hard_rules").select("body").eq("user_id", userId).eq("is_active", true).order("sort_order");
    const hardRules = (hardRulesRows || []).map((r) => String(r.body ?? "").trim()).filter(Boolean);
    const voiceProfile = (profile.voice_profile && typeof profile.voice_profile === "object") ? profile.voice_profile as any : null;
    const voiceRules = arr(voiceProfile?.rules);
    const inlineAttribution = voiceProfile?.inline_attribution ? String(voiceProfile.inline_attribution) : "";

    const { data: approvedRaw } = await supabase
      .from("reference_cards").select("*").eq("user_id", userId).eq("approved", true);
    const approvedCards = (approvedRaw || []).filter((c) => {
      const q = c.content_quality ?? "";
      return q !== "error" && q !== "title_only" && c.status !== "archived" && c.status !== "inactive";
    });
    const sourceLine = (c: any) => {
      const summary = (c.ai_summary && String(c.ai_summary).trim()) ? String(c.ai_summary).trim() : String(c.original_text || "").slice(0, 400);
      const tag = c.from_company ? "[FROM THE COMPANY] " : "";
      return `- ${tag}${c.title || "Untitled"}: ${summary}`;
    };

    const systemLines: string[] = [
      buildIdentityLine(profile.business_name, profile.business_description),
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
    const system = systemLines.join("\n");

    const createdDrafts: any[] = [];

    let reuseParent: any = null;
    if (slot.requires_child && (slot.max_reuse_count ?? 0) > 0) {
      const { data: parents } = await supabase
        .from("drafts")
        .select("*")
        .eq("user_id", userId)
        .eq("schedule_id", slot.id)
        .eq("approval_status", "approved")
        .is("parent_draft_id", null)
        .not("published_at", "is", null)
        .gt("max_reuse_count", 0)
        .order("published_at", { ascending: true })
        .limit(10);
      const eligible = (parents || []).filter((p) => {
        if ((p.reuse_count ?? 0) >= (p.max_reuse_count ?? 0)) return false;
        const windowDays = p.reuse_window_days ?? 90;
        const windowEnd = new Date(new Date(p.published_at).getTime() + windowDays * 86400000);
        return new Date() <= windowEnd;
      });
      reuseParent = eligible.sort((a, b) =>
        ((a.reuse_count ?? 0) / (a.max_reuse_count || 1)) - ((b.reuse_count ?? 0) / (b.max_reuse_count || 1))
      )[0] ?? null;
    }

    const childFormatId = slot.child_format_id || slot.format_id;
    const childNatureId = slot.child_nature_id || slot.nature_id;
    const loadChildLibs = async () => {
      const [{ data: cf }, { data: cn }] = await Promise.all([
        supabase.from("formats").select("*").eq("id", childFormatId).eq("user_id", userId).single(),
        supabase.from("natures").select("*").eq("id", childNatureId).eq("user_id", userId).single(),
      ]);
      return { cf, cn };
    };

    if (reuseParent) {
      // PATH A: child that resurfaces the parent from a new angle.
      const { cf, cn } = await loadChildLibs();
      if (!cf || !cn) return json({ error: "Slot child references a missing format or nature" }, 400);
      const childCtx: SlotContext = { ...baseCtx, format: cf, nature: cn };
      const anglesUsed = arr(reuseParent.reuse_angles_used);
      const prompt = `${buildContextBlock(childCtx)}

TEASER POST FOR THIS PUBLISHED ARTICLE
The parent article is a long-form piece. Your job is to write a short LinkedIn feed post that:
1. Opens a loop — surface ONE specific insight, provocation, or tension from the article that the reader wants resolved.
2. Does NOT summarize or restate the article. The feed post is the door, not the room.
3. Ends in a way that makes the full article the natural next step.
4. Stands on its own as a piece of writing — someone who never reads the article should still get value from this post.

Parent article title: ${reuseParent.title}
Parent article body: ${(reuseParent.body || "").slice(0, 3000)}

Angles already used as teasers (do not repeat the same hook):
${anglesUsed.length ? anglesUsed.map((x) => `- ${x}`).join("\n") : "None yet; this is the first teaser."}

State the specific insight or hook you chose in "angle_used". For any figure you use, record it in stat_attributions.

Respond ONLY with JSON: {"title": "...", "body": "...", "angle_used": "one sentence describing the hook you chose", "stat_attributions": [{"figure": "...", "source": "..."}]}`;

      const res = await callAI(aiProfile, [{ role: "user", content: prompt }], system);
      const result = parseJSON(res.text);

      const { data: child } = await supabase.from("drafts").insert({
        title: result.title,
        body: result.body,
        status: "draft",
        approval_status: "pending",
        user_id: userId,
        parent_draft_id: reuseParent.id,
        schedule_id: slot.id,
        scheduled_for: intendedScheduledFor,
        format_id: childFormatId,
        nature_id: childNatureId,
        job_id: slot.job_id,
        lane_id: slot.lane_id,
        reader_id: reader?.id ?? null,
        content_type: cf.key,
        revision_count: 0,
        seed_insight: `Teaser ${(reuseParent.reuse_count ?? 0) + 1} of ${reuseParent.max_reuse_count}. Hook: ${result.angle_used || "unspecified"}`,
        stat_attributions: statAttributions(result.stat_attributions),
        stat_flag: retiredStatFlag(result.body),
      }).select().single();

      if (child) {
        if (!isTestRun) {
          await supabase.from("drafts").update({
            reuse_count: (reuseParent.reuse_count ?? 0) + 1,
            reuse_angles_used: [...anglesUsed, result.angle_used || `Teaser ${(reuseParent.reuse_count ?? 0) + 1}`],
          }).eq("id", reuseParent.id);
        }
        createdDrafts.push(child);
      }
    } else {
      // PATH B: fresh parent from strategy, audience, and the seed.
      const seedBlock = seed
        ? `\n\nSEED (build the post on this premise)\n${seed.premise}${seed.category ? `\nCategory: ${seed.category}` : ""}`
        : "\n\nNo seed supplied; choose a premise that fits the job and nature above.";

      let sourceBlock = "";
      let chosenCards: any[] = [];
      if (gen.source_reliance > 1) {
        const topByReliance: Record<number, number> = { 2: 2, 3: 3, 4: 5, 5: 6 };
        const takeN = topByReliance[gen.source_reliance] ?? 0;
        const scored = approvedCards.map((c) => ({
          card: c,
          score: (c.global_relevance_score ?? 0) + (c.from_company ? gen.first_party_weight * 2 : 0),
        }));
        const lastUsedMs = (c: any) => (c.last_used_at ? new Date(c.last_used_at).getTime() : -Infinity);
        scored.sort((a, b) =>
          ((a.card.times_used ?? 0) - (b.card.times_used ?? 0)) ||
          (lastUsedMs(a.card) - lastUsedMs(b.card)) ||
          (b.score - a.score) ||
          (new Date(b.card.created_at).getTime() - new Date(a.card.created_at).getTime())
        );
        const chosen = scored.slice(0, takeN).map((s) => s.card);
        chosenCards = chosen;
        if (chosen.length) {
          const cardLines = chosen.map((c) => {
            const summary = (c.ai_summary && String(c.ai_summary).trim())
              ? String(c.ai_summary).trim()
              : String(c.original_text || "").slice(0, 400);
            const tag = c.from_company ? "[FROM THE COMPANY] " : "";
            return `- ${tag}${c.title || "Untitled"}: ${summary}`;
          });
          const relianceInstruction: Record<number, string> = {
            2: "Optional seasoning, use only if it sharpens the point.",
            3: "Draw on these where they sharpen the point, do not force them.",
            4: "Build the post around the strongest of these, using their real figures.",
            5: "This post should be source-led, anchor it in these and their specifics.",
          };
          const instructionLines = [relianceInstruction[gen.source_reliance] ?? ""];
          if (gen.first_party_weight >= 4 && chosen.some((c) => c.from_company)) {
            instructionLines.push("Prefer the framing and claims from sources marked FROM THE COMPANY, treat outside sources as secondary.");
          }
          sourceBlock = `\n\nSOURCES (reference material)\n${instructionLines.filter(Boolean).join("\n")}\n${cardLines.join("\n")}`;
        }
      }

      const prompt = `${contextBlock}${seedBlock}${sourceBlock}

Write one post that does the job, argues in the nature, fits the format and its length, speaks to the lane and reader, and answers the reader's questions where natural. Use the audience's preferred language and avoid the language to avoid. Use only figures attributable to the trusted sources and record each one in stat_attributions.

Respond ONLY with JSON: {"title": "...", "body": "...", "stat_attributions": [{"figure": "the number as you stated it", "source": "the exact trusted source title"}]}`;

      const res = await callAI(aiProfile, [{ role: "user", content: prompt }], system);
      const result = parseJSON(res.text);

      const { data: parent } = await supabase.from("drafts").insert({
        title: result.title,
        body: result.body,
        status: "draft",
        approval_status: "pending",
        user_id: userId,
        schedule_id: slot.id,
        scheduled_for: intendedScheduledFor,
        format_id: slot.format_id,
        nature_id: slot.nature_id,
        job_id: slot.job_id,
        lane_id: slot.lane_id,
        reader_id: reader?.id ?? null,
        seed_id: seed?.id ?? null,
        content_type: format.key,
        revision_count: 0,
        max_reuse_count: slot.max_reuse_count ?? 0,
        reuse_window_days: slot.reuse_window_days ?? 90,
        reuse_count: 0,
        reuse_angles_used: [],
        stat_attributions: statAttributions(result.stat_attributions),
        stat_flag: retiredStatFlag(result.body),
      }).select().single();

      if (parent) {
        createdDrafts.push(parent);

        if (seed && !isTestRun) {
          await supabase.from("seeds").update({
            times_used: (seed.times_used ?? 0) + 1,
            last_used_at: new Date().toISOString(),
          }).eq("id", seed.id);
        }

        if (chosenCards.length && !isTestRun) {
          const now = new Date().toISOString();
          for (const c of chosenCards) {
            await supabase.from("reference_cards").update({
              times_used: (c.times_used ?? 0) + 1,
              last_used_at: now,
              is_used: true,
            }).eq("id", c.id);
          }
        }

        // Companion child: a short LinkedIn feed post that teases the parent article.
        // It opens a loop from one specific insight in the article and drives the reader
        // to the full piece. It is NOT a summary and NOT a copy of the parent.
        if (slot.requires_child) {
          const { cf, cn } = await loadChildLibs();
          if (cf && cn) {
            const childCtx: SlotContext = { ...baseCtx, format: cf, nature: cn };
            const childPrompt = `${buildContextBlock(childCtx)}

TEASER POST FOR THIS NEW ARTICLE
The parent post above is a long-form article. Your job is to write a short LinkedIn feed post that:
1. Opens a loop — surface ONE specific insight, provocation, statistic, or tension from the article that the reader wants resolved.
2. Does NOT summarize the article or restate its structure. The feed post is the door, not the room.
3. Stands on its own as a piece of writing. Someone who never reads the article should still get value from this post.
4. Ends naturally in a way that makes the full article the obvious next step — but do not write "link in comments" or any explicit CTA. Let the writing do it.
5. Keep it short. This is a feed post, not a mini-article. Under 200 words.

Parent article title: ${parent.title}
Parent article body: ${(parent.body || "").slice(0, 3000)}

State the specific insight or hook you chose in "angle_used". For any figure you use from the article, record it in stat_attributions.

Respond ONLY with JSON: {"title": "...", "body": "...", "angle_used": "one sentence describing the hook you chose", "stat_attributions": [{"figure": "...", "source": "..."}]}`;

            const childRes = await callAI(aiProfile, [{ role: "user", content: childPrompt }], system);
            const childResult = parseJSON(childRes.text);
            const { data: child } = await supabase.from("drafts").insert({
              title: childResult.title,
              body: childResult.body,
              status: "draft",
              approval_status: "pending",
              user_id: userId,
              parent_draft_id: parent.id,
              schedule_id: slot.id,
              scheduled_for: intendedScheduledFor,
              format_id: childFormatId,
              nature_id: childNatureId,
              job_id: slot.job_id,
              lane_id: slot.lane_id,
              reader_id: reader?.id ?? null,
              content_type: cf.key,
              revision_count: 0,
              seed_insight: `Teaser for "${parent.title}". Hook: ${childResult.angle_used || "unspecified"}`,
              stat_attributions: statAttributions(childResult.stat_attributions),
              stat_flag: retiredStatFlag(childResult.body),
            }).select().single();
            if (child) createdDrafts.push(child);
          }
        }
      }
    }

    for (const d of createdDrafts) {
      await supabase.functions.invoke("send-draft-notification", {
        body: { draftId: d.id },
        headers: { Authorization: authHeader },
      }).catch(() => {});
    }

    return json({ success: true, draftsCreated: createdDrafts.length, draftIds: createdDrafts.map((d) => d.id), isTestRun });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
