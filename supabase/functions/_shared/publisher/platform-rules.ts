// Per-platform publishing rules. One place to add a platform's constraints
// instead of duplicating them across every function that calls the publisher.

export const DEFAULT_PLATFORM = "linkedin";

// Zernio's own platform docs: LinkedIn posts up to 3000 chars, Instagram
// captions up to 2200 (the first 125 are what shows before the "more" fold,
// but the hard limit is 2200).
const CHAR_LIMITS: Record<string, number> = {
  linkedin: 3000,
  instagram: 2200,
};

// Platforms that reject a post with no image/video attached. Confirmed
// against Zernio's Instagram docs: "Media is required for all posts, no
// text-only." LinkedIn has no such requirement, so a draft with no visual
// yet can still publish there.
const MEDIA_REQUIRED: Record<string, boolean> = {
  instagram: true,
};

export function charLimitFor(platform: string): number {
  return CHAR_LIMITS[platform] ?? CHAR_LIMITS[DEFAULT_PLATFORM];
}

export function requiresMedia(platform: string): boolean {
  return MEDIA_REQUIRED[platform] ?? false;
}

export function platformLabel(platform: string): string {
  return platform.charAt(0).toUpperCase() + platform.slice(1);
}

// A draft's platform lives on its format (formats.platform), not on the
// draft itself. Drafts with no format_id, or whose format has since been
// deleted, fall back to linkedin — the only platform that existed before
// formats.platform was wired up to anything.
export async function resolveDraftPlatform(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  formatId: string | null,
): Promise<string> {
  if (!formatId) return DEFAULT_PLATFORM;
  const { data } = await supabase
    .from("formats")
    .select("platform")
    .eq("id", formatId)
    .maybeSingle();
  return data?.platform || DEFAULT_PLATFORM;
}
