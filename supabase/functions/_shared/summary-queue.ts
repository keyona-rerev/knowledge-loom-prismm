// supabase/functions/_shared/summary-queue.ts
// Card summaries on the Claude subscription queue with DB-owned settlement (migration 20261029200000).
// Ingest and the Process button only mark a card 'pending'. tick(): finalize finished jobs (apply/release), then
// reserve pending cards and enqueue ONE job per card. Async: a job enqueued by a tick is applied by the NEXT tick
// or Settle now; never claim a same-pass summary. No provider keys, no paid path.
import { enqueueInteractiveJob } from "./claude-queue.ts";

export const SUMMARY_ROUTE = "process-reference-card";
export const MAX_CARDS_PER_TENANT_PER_TICK = 3;   // DB also caps 5 open jobs per tenant
export const MAX_TENANTS_PER_TICK = 25;
export const ORPHAN_AFTER_MS = 15 * 60_000;
export const SYSTEM_PROMPT = "You are a content analyst. Always respond with valid JSON only.";

export interface SummaryCard {
  id: string; user_id: string; title: string | null; source_url: string | null; original_text: string | null;
  question_set_id?: string | null; summary_custom_question?: string | null;
}
export interface JobRow { id: string; user_id: string; route: string; status: string; result: any; last_error: string | null; input_snapshot?: any }
export interface OpenRef { cardId: string; userId: string; jobId: string; updatedAt: string }

export interface SummaryStore {
  tenantsWithPending(limit: number): Promise<string[]>;
  pendingCards(userId: string, limit: number): Promise<SummaryCard[]>;
  openRefs(userId: string | null): Promise<OpenRef[]>;
  getCard(userId: string, cardId: string): Promise<SummaryCard | null>;
  questionsFor(card: SummaryCard): Promise<string[]>;
  getJob(jobId: string, userId: string): Promise<JobRow | null>;
  reserve(userId: string, cardId: string, jobId: string, hash: string): Promise<boolean>;
  apply(a: { userId: string; cardId: string; jobId: string; hash: string; summary: string; answers: Record<string, unknown>; title: string | null; customKey: string | null }): Promise<boolean>;
  release(userId: string, cardId: string, jobId: string, reason: string): Promise<string | null>;
  unreserve(userId: string, cardId: string, jobId: string): Promise<boolean>;
  enqueue(a: { userId: string; cardId: string; jobId: string; hash: string; prompt: string; generateTitle: boolean }): Promise<void>;
}

const GENERIC_TITLES = new Set(["", "untitled", "untitled article", "pasted article", "pdf document", "site blocked access - manual review needed"]);
export function needsGeneratedTitle(title: string | null | undefined): boolean {
  return GENERIC_TITLES.has((title ?? "").trim().toLowerCase());
}

export function wantsTitle(card: SummaryCard): boolean {
  return needsGeneratedTitle(card.title) && (card.original_text?.length ?? 0) >= 100;
}

export function buildPrompt(card: SummaryCard, questions: string[], generateTitle: boolean): string {
  return `Analyze this content and provide a summary plus answers to specific questions.
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
    ${questions.map((q) => `"${q}": "answer"`).join(",\n    ")}
  }
}`;
}

// Hash of EXACTLY what the model is shown (prompt) + what the apply writes into (custom key). Content, title, questions or
// custom question changing between enqueue and apply changes the hash, and apply is refused.
export async function inputHash(prompt: string, customQuestion: string | null): Promise<string> {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([prompt, customQuestion ?? null])));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

export async function planFor(store: SummaryStore, card: SummaryCard) {
  const custom = card.summary_custom_question?.trim() || null;
  const questions = custom ? [custom] : await store.questionsFor(card);
  const generateTitle = !custom && wantsTitle(card);
  const prompt = buildPrompt(card, questions, generateTitle);
  return { prompt, generateTitle, custom, hash: await inputHash(prompt, custom) };
}

// Untrusted model output -> validated fields or null.
export function parseSummary(text: string, questions: string[], custom: string | null): { summary: string; answers: Record<string, string>; title: string | null } | null {
  try {
    let c = text.trim();
    const fence = c.match(/```(?:\w*)?\s*([\s\S]*?)\s*```/i); if (fence) c = fence[1].trim();
    const m = c.match(/(\{[\s\S]*\})/); if (m) c = m[1];
    const j = JSON.parse(c);
    if (!j || typeof j !== "object" || typeof j.summary !== "string" || !j.summary.trim()) return null;
    const answers: Record<string, string> = {};
    const raw = j.answers && typeof j.answers === "object" && !Array.isArray(j.answers) ? j.answers : {};
    for (const q of questions) { const v = raw[q]; if (typeof v === "string") answers[q] = v.slice(0, 4000); }
    if (custom && !Object.keys(answers).length) { const first = Object.values(raw).find((v) => typeof v === "string"); if (typeof first === "string") answers[custom] = first.slice(0, 4000); }
    const title = typeof j.title === "string" && j.title.trim() ? j.title.trim().slice(0, 255) : null;
    return { summary: j.summary.slice(0, 4000), answers, title };
  } catch { return null; }
}

export interface TickResult { applied: number; released: number; unreserved: number; stale: number; enqueued: number; pending: number; errors: string[] }

export async function finalizeOpen(store: SummaryStore, userId: string | null, now = Date.now()): Promise<Omit<TickResult, "enqueued">> {
  const r = { applied: 0, released: 0, unreserved: 0, stale: 0, pending: 0, errors: [] as string[] };
  for (const o of await store.openRefs(userId)) {
    try {
      const job = await store.getJob(o.jobId, o.userId);
      if (!job) {
        if (now - Date.parse(o.updatedAt) > ORPHAN_AFTER_MS) { if (await store.unreserve(o.userId, o.cardId, o.jobId)) r.unreserved++; } else r.pending++;
        continue;
      }
      if (job.user_id !== o.userId || job.route !== SUMMARY_ROUTE || job.input_snapshot?.context?.cardId !== o.cardId) { r.errors.push(`job ${o.jobId} ownership mismatch`); continue; }
      if (job.status === "failed") { if (await store.release(o.userId, o.cardId, o.jobId, `worker failed: ${String(job.last_error ?? "").slice(0, 150)}`)) r.released++; continue; }
      if (job.status !== "completed") { r.pending++; continue; }
      const card = await store.getCard(o.userId, o.cardId);
      if (!card) continue;
      // Recompute the input hash from the CURRENT card; it must equal the one the job was built from (stored in the DB row at reserve and in the job).
      const plan = await planFor(store, card);
      if (job.input_snapshot?.context?.hash !== plan.hash) { r.stale++; await store.release(o.userId, o.cardId, o.jobId, "card changed since enqueue"); continue; }
      const questions = plan.custom ? [plan.custom] : await store.questionsFor(card);
      const parsed = parseSummary(String(job.result?.text ?? ""), questions, plan.custom);
      if (!parsed) { await store.release(o.userId, o.cardId, o.jobId, "result unparseable"); r.released++; continue; }
      const ok = await store.apply({ userId: o.userId, cardId: o.cardId, jobId: o.jobId, hash: plan.hash, summary: parsed.summary, answers: parsed.answers, title: plan.generateTitle ? parsed.title : null, customKey: plan.custom });
      if (ok) r.applied++; else { r.stale++; await store.release(o.userId, o.cardId, o.jobId, "apply refused (state/hash)"); }
    } catch (e) { r.errors.push(String((e as Error)?.message ?? e).slice(0, 200)); }
  }
  return r;
}

export async function enqueueNew(store: SummaryStore, userIds: string[]): Promise<{ enqueued: number; errors: string[] }> {
  const r = { enqueued: 0, errors: [] as string[] };
  for (const userId of userIds) {
    try {
      for (const card of await store.pendingCards(userId, MAX_CARDS_PER_TENANT_PER_TICK)) {
        const plan = await planFor(store, card);
        const jobId = crypto.randomUUID();
        if (!(await store.reserve(userId, card.id, jobId, plan.hash))) continue; // not pending anymore, attempt cap, or tenant open-cap
        try { await store.enqueue({ userId, cardId: card.id, jobId, hash: plan.hash, prompt: plan.prompt, generateTitle: plan.generateTitle }); r.enqueued++; }
        catch (e) { await store.unreserve(userId, card.id, jobId); r.errors.push(`enqueue failed: ${String((e as Error)?.message ?? e).slice(0, 150)}`); }
      }
    } catch (e) { r.errors.push(String((e as Error)?.message ?? e).slice(0, 200)); }
  }
  return r;
}

export async function tick(store: SummaryStore, opts: { userId?: string } = {}): Promise<TickResult> {
  const f = await finalizeOpen(store, opts.userId ?? null);
  const users = opts.userId ? [opts.userId] : await store.tenantsWithPending(MAX_TENANTS_PER_TICK);
  const e = await enqueueNew(store, users);
  return { ...f, enqueued: e.enqueued, errors: [...f.errors, ...e.errors] };
}

export function makeSupabaseStore(db: any): SummaryStore {
  const cols = "id, user_id, title, source_url, original_text, question_set_id, summary_custom_question";
  return {
    async tenantsWithPending(limit) {
      const { data } = await db.from("reference_cards").select("user_id").eq("summary_state", "pending").lt("summary_attempts", 3).limit(500);
      return [...new Set<string>((data ?? []).map((x: any) => x.user_id))].slice(0, limit);
    },
    async pendingCards(userId, limit) {
      const { data } = await db.from("reference_cards").select(cols).eq("user_id", userId).eq("summary_state", "pending").lt("summary_attempts", 3).order("created_at", { ascending: true }).limit(limit);
      return data ?? [];
    },
    async openRefs(userId) {
      let q = db.from("reference_cards").select("id, user_id, summary_job_id, updated_at").eq("summary_state", "queued").not("summary_job_id", "is", null).limit(500);
      if (userId) q = q.eq("user_id", userId);
      const { data } = await q;
      return (data ?? []).map((x: any) => ({ cardId: x.id, userId: x.user_id, jobId: x.summary_job_id, updatedAt: x.updated_at }));
    },
    async getCard(userId, cardId) {
      const { data } = await db.from("reference_cards").select(cols).eq("id", cardId).eq("user_id", userId).maybeSingle();
      return data ?? null;
    },
    async questionsFor(card) {
      let questions: string[] = [];
      if (card.question_set_id) {
        const { data: qs } = await db.from("question_sets").select("questions").eq("id", card.question_set_id).eq("user_id", card.user_id).maybeSingle();
        if (Array.isArray(qs?.questions)) questions = qs.questions;
      } else {
        const { data: t } = await db.from("reference_cards").select("reference_card_templates(custom_questions)").eq("id", card.id).eq("user_id", card.user_id).maybeSingle();
        const tq = t?.reference_card_templates?.custom_questions;
        if (Array.isArray(tq)) questions = tq;
      }
      if (!questions.length) {
        const { data: fb } = await db.from("question_sets").select("questions").eq("user_id", card.user_id).eq("is_active", true)
          .order("is_global", { ascending: false }).order("created_at", { ascending: true }).limit(1).maybeSingle();
        questions = Array.isArray(fb?.questions) && fb.questions.length ? fb.questions : ["What is the main argument?", "What evidence supports it?", "How is this relevant to my work?"];
      }
      return questions;
    },
    async getJob(jobId, userId) {
      const { data } = await db.from("claude_jobs").select("id, user_id, route, status, result, last_error, input_snapshot")
        .eq("request_id", `interactive:${SUMMARY_ROUTE}:${jobId}`).eq("user_id", userId).maybeSingle();
      return data ?? null;
    },
    async reserve(userId, cardId, jobId, hash) {
      const { data, error } = await db.rpc("reserve_summary_card", { p_user: userId, p_card: cardId, p_job: jobId, p_hash: hash });
      if (error) throw new Error(`reserve failed: ${error.message}`);
      return data === true;
    },
    async apply(a) {
      const { data, error } = await db.rpc("apply_summary", { p_user: a.userId, p_card: a.cardId, p_job: a.jobId, p_hash: a.hash, p_summary: a.summary, p_answers: a.answers, p_title: a.title, p_custom_key: a.customKey });
      if (error) throw new Error(`apply failed: ${error.message}`);
      return data === true;
    },
    async release(userId, cardId, jobId, reason) {
      const { data, error } = await db.rpc("release_summary", { p_user: userId, p_card: cardId, p_job: jobId, p_reason: reason });
      if (error) throw new Error(`release failed: ${error.message}`);
      return data ?? null;
    },
    async unreserve(userId, cardId, jobId) {
      const { data, error } = await db.rpc("unreserve_summary", { p_user: userId, p_card: cardId, p_job: jobId });
      if (error) throw new Error(`unreserve failed: ${error.message}`);
      return data === true;
    },
    async enqueue({ userId, cardId, jobId, hash, prompt, generateTitle }) {
      await enqueueInteractiveJob(db, { userId, route: SUMMARY_ROUTE, kind: "card_summary", prompt, system: SYSTEM_PROMPT, context: { cardId, hash, generateTitle }, idempotencyKey: jobId });
    },
  };
}
