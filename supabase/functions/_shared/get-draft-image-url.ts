// Looks up the public image URL for a draft's generated visual, if one has
// finished rendering and been uploaded (see src/lib/ensureVisualImage.ts,
// which captures the AI-generated HTML to PNG client-side and writes the
// resulting storage URL onto draft_visuals.image_url). Returns undefined
// when no visual exists yet, or it hasn't been captured to an image yet, so
// callers can still publish text-only rather than blocking on this.

// deno-lint-ignore no-explicit-any
export async function getDraftImageUrl(supabase: any, draftId: string): Promise<string | undefined> {
  const { data } = await supabase
    .from("draft_visuals")
    .select("image_url")
    .eq("draft_id", draftId)
    .eq("status", "ready")
    .not("image_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.image_url ?? undefined;
}
