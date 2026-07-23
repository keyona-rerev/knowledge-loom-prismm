// Display labels for the platform values stored on formats.platform /
// social_connections.platform. New platforms just need an entry here;
// anything else falls back to its raw value capitalized.

export const KNOWN_PLATFORMS = ["linkedin", "instagram"] as const;

const PLATFORM_LABELS: Record<string, string> = {
  linkedin: "LinkedIn",
  instagram: "Instagram",
};

export function platformLabel(platform: string | null | undefined): string {
  if (!platform) return PLATFORM_LABELS.linkedin;
  return PLATFORM_LABELS[platform] ?? platform.charAt(0).toUpperCase() + platform.slice(1);
}
