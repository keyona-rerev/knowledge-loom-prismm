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
