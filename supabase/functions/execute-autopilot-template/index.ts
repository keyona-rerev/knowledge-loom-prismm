import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI } from "../_shared/ai-caller.ts";

// Knowledge Loom autopilot. A schedule slot is a standing instruction: produce a post
// of this format and nature, doing this job, for this lane and reader. Generation reads
// the strategy and audience libraries plus the seed bank, not reference cards. Newsletter
// intake still feeds reference cards in parallel and is untouched here.
//
// Per run a slot either resurfaces an eligible parent (reuse) or generates fresh. When the
// slot requires a child, fresh runs also produce a companion post in the child format.

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

interface SlotContext {
  format: any;
  nature: any;
  job: any;
  lane: any | null;
  reader: any | null;
  questions: string[];
  audience: any | null;
  seed: any | null;
  brand: { business_name?: string; business_description?: string; brand_voice?: string };
}

// Assemble the full strategy and audience context into a single prompt block.
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

// Pick a reader to rotate into a slot when the slot leaves the reader unset.
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

    const supabaseAuth = createClient(supabaseUrl, serviceRoleKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) return json({ error: "Invalid or expired authentication token" }, 401);

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { scheduleId, isTestRun = false } = await req.json();
    if (!scheduleId) return json({ error: "scheduleId is required" }, 400);

    // 1. The slot. Every decision flows from here.
    const { data: slot } = await supabase
      .from("content_schedules")
      .select("*")
      .eq("id", scheduleId)
      .eq("user_id", user.id)
      .eq("is_active", true)
      .single();
    if (!slot) return json({ error: "Slot not found, inactive, or access denied" }, 404);

    // 2. Brand and AI provider.
    const { data: profile } = await supabase
      .from("profiles")
      .select("ai_provider, ai_model, ai_api_key, ai_endpoint, business_name, business_description, brand_voice")
      .eq("user_id", user.id)
      .single();
    if (!profile) return json({ error: "Profile not found" }, 404);
    if (!profile.ai_api_key) return json({ error: "No AI API key configured in Settings" }, 400);

    const aiProfile = { ai_provider: profile.ai_provider, ai_model: profile.ai_model, ai_api_key: profile.ai_api_key, ai_endpoint: profile.ai_endpoint };

    // 3. Resolve the slot's libraries.
    const [{ data: format }, { data: nature }, { data: job }] = await Promise.all([
      supabase.from("formats").select("*").eq("id", slot.format_id).eq("user_id", user.id).single(),
      supabase.from("natures").select("*").eq("id", slot.nature_id).eq("user_id", user.id).single(),
      supabase.from("jobs").select("*").eq("id", slot.job_id).eq("user_id", user.id).single(),
    ]);
    if (!format || !nature || !job) return json({ error: "Slot references a missing format, nature, or job" }, 400);
    // Enforce: schedules only run engine jobs. Reference motions are run by hand.
    if (job.kind !== "engine_job") return json({ error: "Slot job must be an engine job" }, 400);

    let lane: any = null;
    if (slot.lane_id) {
      const { data } = await supabase.from("lanes").select("*").eq("id", slot.lane_id).eq("user_id", user.id).maybeSingle();
      lane = data;
    }

    // Reader: the slot fixes one, or we rotate among published readers.
    let reader: any = null;
    if (slot.reader_id) {
      const { data } = await supabase.from("readers").select("*").eq("id", slot.reader_id).eq("user_id", user.id).maybeSingle();
      reader = data;
    } else {
      const { data: allReaders } = await supabase.from("readers").select("*").eq("user_id", user.id).eq("is_active", true);
      reader = pickReader(allReaders || [], lane);
    }
    let questions: string[] = [];
    if (reader) {
      const { data: rq } = await supabase.from("reader_questions").select("question").eq("reader_id", reader.id).order("sort_order");
      questions = (rq || []).map((q) => q.question);
    }

    // 4. Audience profile.
    const { data: audience } = await supabase.from("audience_profile").select("*").eq("user_id", user.id).maybeSingle();

    // 5. Seed: prefer the least-used, longest-unused seed that fits this lane and nature.
    const laneScopes = ["both"];
    if (lane?.key === "credit_union" || lane?.key === "community_bank") laneScopes.push(lane.key);
    let seed: any = null;
    {
      const { data: seeds } = await supabase
        .from("seeds")
        .select("*")
        .eq("user_id", user.id)
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
    const baseCtx: SlotContext = { format, nature, job, lane, reader, questions, audience, seed, brand };
    const contextBlock = buildContextBlock(baseCtx);
    const system = "You are Prismm's content engine. Prismm is inheritance infrastructure for financial institutions. Write in the brand voice, answer the reader's real questions, and never invent statistics. Respond with valid JSON only.";

    const createdDrafts: any[] = [];

    // 6. Reuse decision: when the slot pairs with a child and an eligible parent exists,
    // resurface it from a fresh angle rather than generating new fresh content.
    let reuseParent: any = null;
    if (slot.requires_child && (slot.max_reuse_count ?? 0) > 0) {
      const { data: parents } = await supabase
        .from("drafts")
        .select("*")
        .eq("user_id", user.id)
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

    // Resolve child format/nature once (used by both reuse and companion paths).
    const childFormatId = slot.child_format_id || slot.format_id;
    const childNatureId = slot.child_nature_id || slot.nature_id;
    const loadChildLibs = async () => {
      const [{ data: cf }, { data: cn }] = await Promise.all([
        supabase.from("formats").select("*").eq("id", childFormatId).eq("user_id", user.id).single(),
        supabase.from("natures").select("*").eq("id", childNatureId).eq("user_id", user.id).single(),
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

RESURFACE THIS PUBLISHED PIECE FROM A NEW ANGLE
Title: ${reuseParent.title}
Body: ${(reuseParent.body || "").slice(0, 3000)}

Angles already used (do not repeat):
${anglesUsed.length ? anglesUsed.map((x) => `- ${x}`).join("\n") : "None yet; this is the first reuse."}

Write a new post in the format and nature above that makes a distinct point from the same source. State the angle you chose in "angle_used".

Respond ONLY with JSON: {"title": "...", "body": "...", "angle_used": "one sentence"}`;

      const res = await callAI(aiProfile, [{ role: "user", content: prompt }], system);
      const result = parseJSON(res.text);

      const { data: child } = await supabase.from("drafts").insert({
        title: result.title,
        body: result.body,
        status: "draft",
        approval_status: "pending",
        user_id: user.id,
        parent_draft_id: reuseParent.id,
        schedule_id: slot.id,
        format_id: childFormatId,
        nature_id: childNatureId,
        job_id: slot.job_id,
        lane_id: slot.lane_id,
        reader_id: reader?.id ?? null,
        content_type: cf.key,
        revision_count: 0,
        seed_insight: `Reuse ${(reuseParent.reuse_count ?? 0) + 1} of ${reuseParent.max_reuse_count}. Angle: ${result.angle_used || "unspecified"}`,
      }).select().single();

      if (child) {
        if (!isTestRun) {
          await supabase.from("drafts").update({
            reuse_count: (reuseParent.reuse_count ?? 0) + 1,
            reuse_angles_used: [...anglesUsed, result.angle_used || `Reuse ${(reuseParent.reuse_count ?? 0) + 1}`],
          }).eq("id", reuseParent.id);
        }
        createdDrafts.push(child);
      }
    } else {
      // PATH B: fresh parent from strategy, audience, and the seed.
      const seedBlock = seed
        ? `\n\nSEED (build the post on this premise)\n${seed.premise}${seed.category ? `\nCategory: ${seed.category}` : ""}`
        : "\n\nNo seed supplied; choose a premise that fits the job and nature above.";
      const prompt = `${contextBlock}${seedBlock}

Write one post that does the job, argues in the nature, fits the format and its length, speaks to the lane and reader, and answers the reader's questions where natural. Use the audience's preferred language and avoid the language to avoid.

Respond ONLY with JSON: {"title": "...", "body": "..."}`;

      const res = await callAI(aiProfile, [{ role: "user", content: prompt }], system);
      const result = parseJSON(res.text);

      const { data: parent } = await supabase.from("drafts").insert({
        title: result.title,
        body: result.body,
        status: "draft",
        approval_status: "pending",
        user_id: user.id,
        schedule_id: slot.id,
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
      }).select().single();

      if (parent) {
        createdDrafts.push(parent);

        // Mark the seed as used so rotation moves on.
        if (seed && !isTestRun) {
          await supabase.from("seeds").update({
            times_used: (seed.times_used ?? 0) + 1,
            last_used_at: new Date().toISOString(),
          }).eq("id", seed.id);
        }

        // Companion child in the child format, if the slot pairs them.
        if (slot.requires_child) {
          const { cf, cn } = await loadChildLibs();
          if (cf && cn) {
            const childCtx: SlotContext = { ...baseCtx, format: cf, nature: cn };
            const childPrompt = `${buildContextBlock(childCtx)}

COMPANION TO THIS NEW POST (adapt it into the format and nature above, do not just summarize)
Title: ${parent.title}
Body: ${(parent.body || "").slice(0, 3000)}

Respond ONLY with JSON: {"title": "...", "body": "...", "angle_used": "one sentence"}`;
            const childRes = await callAI(aiProfile, [{ role: "user", content: childPrompt }], system);
            const childResult = parseJSON(childRes.text);
            const { data: child } = await supabase.from("drafts").insert({
              title: childResult.title,
              body: childResult.body,
              status: "draft",
              approval_status: "pending",
              user_id: user.id,
              parent_draft_id: parent.id,
              schedule_id: slot.id,
              format_id: childFormatId,
              nature_id: childNatureId,
              job_id: slot.job_id,
              lane_id: slot.lane_id,
              reader_id: reader?.id ?? null,
              content_type: cf.key,
              revision_count: 0,
              seed_insight: `Companion to "${parent.title}". Angle: ${childResult.angle_used || "unspecified"}`,
            }).select().single();
            if (child) createdDrafts.push(child);
          }
        }
      }
    }

    // Notify on each created draft (best-effort).
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
