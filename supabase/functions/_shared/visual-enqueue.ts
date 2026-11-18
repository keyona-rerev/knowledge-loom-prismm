// supabase/functions/_shared/visual-enqueue.ts
// Visual generation on the Claude subscription queue (no API key anywhere).
// The app side of the draft-visual path: build the render prompt, bind a
// fingerprint of every render input, admit the draft_visuals placeholder,
// and enqueue ONE interactive job of kind "draft-visual". The worker writes
// {visual_type, html}, renders the PNG inside its sandbox, and posts both to
// claude-job-complete, where completeVisualJob (visual-logic.ts) validates
// the PNG and flips the placeholder to 'ready'.
//
// Preview (Visual Studio) is a plain interactive job of kind "visual-preview":
// it persists nothing and returns html only. The client shows it in a
// sandboxed iframe.
import type { Db } from "./job-logic.ts";
import { admitVisualPlaceholder } from "./visual-logic.ts";
import {
  buildSystemPromptFromConfig, buildVisualPrompt, canvasDimsForPlatform,
  SAMPLE_DRAFT, visualSourceFingerprint, type VisualConfig,
} from "./visual-prompt.ts";
import { DEFAULT_PLATFORM, normalizeRowPlatform } from "./publisher/platform-config.ts";
import type { InteractiveJobArgs, InteractiveJobHandle, QueueDb } from "./claude-queue.ts";

export type Enqueue = (db: QueueDb, args: InteractiveJobArgs) => Promise<InteractiveJobHandle>;

// Server-side availability switch, one per install. Unset = OFF, so an
// instance that has not opted in keeps its current behavior.
export function visualsEnabled(get: (k: string) => string | undefined): boolean {
  return (get("VISUALS_ENABLED") ?? "").trim().toLowerCase() === "true";
}

// deno-lint-ignore no-explicit-any
export function visualUserPrompt(draft: any): string {
  const content = `TITLE: ${draft.title || "Untitled"}\n\nBODY:\n${draft.body || ""}\n\nSEED INSIGHT: ${draft.seed_insight || ""}`;
  return `DRAFT CONTENT:\n${content}\n\nRead the draft. Extract the single most important idea. Choose the visual type that makes that idea land without words. Write a statement of 10 words or fewer that declares the idea - do not quote or restate the post opening. Generate the complete branded HTML visual following all design rules. Return only the JSON object with "visual_type" and "html" keys.`;
}

// Platform rule shared with completion: a known row value wins; else the
// format's platform (resolved by the caller); else the default. The same
// value is bound into the job context, and completeVisualJob falls back to
// ctx.platform, so admit and completion fingerprint identical inputs.
export function resolveVisualPlatform(rowPlatform: unknown, formatPlatform?: string | null): string {
  return normalizeRowPlatform(rowPlatform) ?? normalizeRowPlatform(formatPlatform) ?? DEFAULT_PLATFORM;
}

export async function requestDraftVisual(db: Db, queueDb: QueueDb, enqueue: Enqueue, args: {
  authUserId: string; draftId: string; formatPlatform?: string | null;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const draft = await db.getDraft(args.draftId);
  if (!draft) return { status: 404, body: { error: "Draft not found" } };
  if (draft.user_id !== args.authUserId) return { status: 403, body: { error: "Draft not found or access denied" } };

  const profile = await db.getProfileVisualConfig(args.authUserId);
  const platform = resolveVisualPlatform(draft.platform, args.formatPlatform);
  const { systemPrompt, canvasWidth, canvasHeight } = buildVisualPrompt(profile, platform);
  const sourceHash = await visualSourceFingerprint(draft, systemPrompt, platform, canvasWidth, canvasHeight);

  const admit = await admitVisualPlaceholder(db, {
    authUserId: args.authUserId, draftId: args.draftId,
    canvasW: canvasWidth, canvasH: canvasHeight, sourceHash,
  });
  if (admit.status !== 200) return { status: admit.status, body: admit.body };
  const visualId = admit.body.visual_id as string;

  // One job per placeholder: the key is the visual id, so a double click or a
  // retry reattaches to the same job. A failed job has already flipped its
  // placeholder to 'error', so the next click admits a NEW visual id and a
  // new key - never a silent replay of a dead job.
  const handle = await enqueue(queueDb, {
    userId: args.authUserId,
    route: "generate-draft-visual",
    kind: "draft-visual",
    prompt: visualUserPrompt(draft),
    system: systemPrompt,
    context: {
      draft_id: args.draftId, visual_id: visualId, preview: false,
      canvas: { w: canvasWidth, h: canvasHeight }, source_hash: sourceHash, platform,
    },
    idempotencyKey: `visual:${visualId}`,
    noRotateFailed: true,
  });
  return { status: 202, body: { queued: true, jobId: handle.jobId, visualId, created: handle.created } };
}

// Visual Studio preview: current (possibly unsaved) config from the browser,
// a real draft or the fixed sample. Nothing is written except the job row.
export async function requestVisualPreview(queueDb: QueueDb, enqueue: Enqueue, args: {
  authUserId: string; config: VisualConfig | null; platform?: string | null;
  // deno-lint-ignore no-explicit-any
  draft?: any | null; businessName?: string | null; businessDescription?: string | null;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!args.config || typeof args.config !== "object") return { status: 400, body: { error: "config is required" } };
  const platform = normalizeRowPlatform(args.platform) ?? DEFAULT_PLATFORM;
  const systemPrompt = buildSystemPromptFromConfig(args.config, args.businessName ?? null, args.businessDescription ?? null, platform);
  const dims = canvasDimsForPlatform(args.config, platform);
  const draft = args.draft ?? SAMPLE_DRAFT;
  const handle = await enqueue(queueDb, {
    userId: args.authUserId,
    route: "preview-visual",
    kind: "visual-preview",
    prompt: visualUserPrompt(draft),
    system: systemPrompt,
    context: { preview: true, canvas: { w: dims.width, h: dims.height }, platform },
  });
  return { status: 202, body: { queued: true, jobId: handle.jobId, canvas: { w: dims.width, h: dims.height } } };
}
