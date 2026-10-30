// Per-platform publishing rules. This is the single seam for platform-
// specific limits so no edge function has to hardcode them.
//
// TO ADD A NEW PLATFORM, in order:
//   1. Add it to the `platform` CHECK constraint on content_schedules and
//      drafts (migration).
//   2. Add its char limit to PLATFORM_MAX_CHARS below (check the provider's
//      docs -- don't guess).
//   3. Add it to PLATFORM_REQUIRES_MEDIA if the platform rejects or
//      effectively can't run text-only posts.
//   4. Add a label to platformLabel() below.
//   5. Probe the provider's /connect/{platform} and /accounts responses
//      live before trusting field names -- see zernio.ts header for why.
//   6. Frontend: add a platform option to the schedule-creation UI and a
//      connect button in Settings.
// That's the whole list. Nothing else in this codebase needs to change --
// zernio-connect, publish-to-zernio, and post-now all read platform off the
// draft/schedule and these maps, not a hardcoded string.

export const PLATFORM_MAX_CHARS: Record<string, number> = {
  linkedin: 3000,
  instagram: 2200,
};

// Platforms that reject (or can't meaningfully do) a text-only post.
export const PLATFORM_REQUIRES_MEDIA = new Set<string>(["instagram"]);

export function maxCharsFor(platform: string): number {
  return PLATFORM_MAX_CHARS[platform] ?? 3000;
}

// Format-vs-platform eligibility. A format declares a target word range; a
// platform has a hard character limit. AVG_CHARS_PER_WORD is a typical-prose
// ESTIMATE (English averages roughly 5 letters plus a space), used only to
// decide whether a format's declared MINIMUM length is realistic for the
// platform. It is not a guarantee about any single draft: the exact check is
// draftLengthFit(), applied to the real text. Keep in sync with
// src/lib/format-fit.ts (a parity test enforces it).
// Same fallback rule as the publisher (platformSpec): a known platform key wins,
// anything empty or unknown resolves to linkedin.
export function feedPlatform(p: unknown): string {
  return typeof p === "string" && p && PLATFORM_MAX_CHARS[p] ? p : "linkedin";
}

export const AVG_CHARS_PER_WORD = 6;

export interface FormatFit { fits: boolean; estimatedMinChars: number | null; maxChars: number; platform: string }

export function formatFitsPlatform(
  format: { min_words?: number | null } | null | undefined,
  platform: string,
): FormatFit {
  const maxChars = maxCharsFor(platform);
  const minWords = Number(format?.min_words ?? 0);
  if (!Number.isFinite(minWords) || minWords <= 0) return { fits: true, estimatedMinChars: null, maxChars, platform };
  const estimatedMinChars = Math.round(minWords * AVG_CHARS_PER_WORD);
  return { fits: estimatedMinChars <= maxChars, estimatedMinChars, maxChars, platform };
}

// Which format of an autopilot slot is bound for the LinkedIn/Instagram feed?
// Article parent + Feed child: only the CHILD publishes to the feed (the parent
// is long-form and not feed-published), so only the child is checked. Reusing
// an existing parent writes only the child. A slot with no child writes its own
// format to the feed. Returns which side is blocked, or null.
export function slotFeedBlock(args: {
  format: { min_words?: number | null; platform?: string | null } | null;
  childFormat: { min_words?: number | null; platform?: string | null } | null;
  requiresChild: boolean; hasChildFormat: boolean; reuse: boolean;
  slotPlatform?: string | null; // schedule platform: drafts inherit it, and it wins over the format (row-first, like the publisher)
}): "format" | "child_format" | null {
  const known = (p: unknown) => typeof p === "string" && !!p && !!PLATFORM_MAX_CHARS[p];
  const plat = (f: { platform?: string | null } | null) => known(args.slotPlatform) ? (args.slotPlatform as string) : feedPlatform(f?.platform);
  const childBound = args.reuse || (args.requiresChild && args.hasChildFormat);
  if (childBound) {
    return args.childFormat && !formatFitsPlatform(args.childFormat, plat(args.childFormat)).fits ? "child_format" : null;
  }
  return args.format && !formatFitsPlatform(args.format, plat(args.format)).fits ? "format" : null;
}

export function requiresMedia(platform: string): boolean {
  return PLATFORM_REQUIRES_MEDIA.has(platform);
}

export function platformLabel(platform: string): string {
  switch (platform) {
    case "linkedin":
      return "LinkedIn";
    case "instagram":
      return "Instagram";
    default:
      return platform;
  }
}
