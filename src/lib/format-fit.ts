// Format-vs-platform eligibility for the UI. Mirrors
// supabase/functions/_shared/publisher/platform-rules.ts (a parity test keeps
// them in sync). AVG_CHARS_PER_WORD is a typical-prose estimate, not a
// guarantee; the exact check is the real draft length at publish time.
const MAX_CHARS: Record<string, number> = { linkedin: 3000, instagram: 2200 };
export const AVG_CHARS_PER_WORD = 6;

export function formatFitsPlatform(
  format: { min_words?: number | null } | null | undefined,
  platform: string | null | undefined,
): { fits: boolean; estimatedMinChars: number | null; maxChars: number } {
  const maxChars = MAX_CHARS[platform ?? "linkedin"] ?? 3000;
  const minWords = Number(format?.min_words ?? 0);
  if (!Number.isFinite(minWords) || minWords <= 0) return { fits: true, estimatedMinChars: null, maxChars };
  const estimatedMinChars = Math.round(minWords * AVG_CHARS_PER_WORD);
  return { fits: estimatedMinChars <= maxChars, estimatedMinChars, maxChars };
}

export function unavailableFormatLabel(platformLabel: string, maxChars: number): string {
  return `not available for the ${platformLabel} feed (limit ${maxChars} characters)`;
}
