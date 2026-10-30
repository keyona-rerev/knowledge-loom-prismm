// Per-platform publishing rules. Single source of truth for character
// limits, whether a post requires an image before it can go out, and the
// default visual canvas size for a platform. Previously each publish
// function (publish-to-zernio, post-now, reschedule-draft) duplicated its
// own LINKEDIN_MAX_CHARS constant and hardcoded "linkedin" everywhere; this
// is the one place that changes when a platform is added or a limit moves.
//
// Instagram's caption limit (2200 chars) and its media requirement (feed
// posts need an image) come from Instagram's own published rules, not from
// a Zernio probe like the LinkedIn figures were.

export interface PlatformSpec {
  label: string; // display name, e.g. "Instagram"
  maxChars: number;
  requiresImage: boolean;
  canvasWidth: number;
  canvasHeight: number;
}

export const DEFAULT_PLATFORM = "linkedin";

const PLATFORM_SPECS: Record<string, PlatformSpec> = {
  linkedin: {
    label: "LinkedIn",
    maxChars: 3000, // confirmed from Zernio's LinkedIn platform page
    requiresImage: false,
    canvasWidth: 1200,
    canvasHeight: 627,
  },
  instagram: {
    label: "Instagram",
    maxChars: 2200, // Instagram's caption limit
    requiresImage: true, // Instagram feed posts require an image or video
    canvasWidth: 1080,
    canvasHeight: 1080,
  },
};

export function platformSpec(platform: string | null | undefined): PlatformSpec {
  if (platform && PLATFORM_SPECS[platform]) return PLATFORM_SPECS[platform];
  return PLATFORM_SPECS[DEFAULT_PLATFORM];
}

// Row-first platform precedence (all paths agree, 2026-10-29): drafts carry
// a denormalized platform column (set_draft_platform_from_schedule trigger);
// a persisted user-authorized change lives there. normalizeRowPlatform is the
// ONE normalization rule everywhere: a row/input value wins only when it is a
// known, non-empty platform key; empty strings and unknown values fall
// through identically (no "||" cosmetics guessing differently per path).
export function normalizeRowPlatform(p: unknown): string | null {
  return typeof p === "string" && p && PLATFORM_SPECS[p] ? p : null;
}

// Format lookup: the draft's format names a platform for rows whose platform
// column is empty (ad-hoc/legacy drafts predating the denormalized column).
export async function resolveDraftPlatform(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  formatId: string | null | undefined,
): Promise<string> {
  if (!formatId) return DEFAULT_PLATFORM;
  const { data } = await supabase
    .from("formats")
    .select("platform")
    .eq("id", formatId)
    .maybeSingle();
  // C1 (v11): the format value goes through the SAME normalizeRowPlatform
  // rule as every row value. A raw unknown/empty format platform (e.g. a
  // legacy "twitter") must NOT leak through here: admit bound fingerprints
  // with this result while completion normalized it away, deterministically
  // terminal-staling every draft carrying such a format.
  return normalizeRowPlatform(data?.platform) ?? DEFAULT_PLATFORM;
}
