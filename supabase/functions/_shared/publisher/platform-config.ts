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

// A draft carries no platform column of its own; it's reachable only via
// its format. Falls back to the default platform for drafts with no format
// (ad-hoc/legacy drafts predating the format system).
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
  return data?.platform ?? DEFAULT_PLATFORM;
}
