import { supabase } from "@/integrations/supabase/client";
import { capturePngDataUrl, dataUrlToBlob } from "./visualCapture";

interface DraftVisualRow {
  id: string;
  status: string;
  html_content: string;
  image_url?: string | null;
}

async function fetchLatestVisual(draftId: string): Promise<DraftVisualRow | null> {
  const { data } = await supabase
    .from("draft_visuals")
    .select("*")
    .eq("draft_id", draftId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as unknown as DraftVisualRow) || null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Waits for the draft's AI-generated visual to finish, captures it to a PNG,
// and uploads it to the draft-visuals storage bucket so publish-to-zernio and
// post-now have an image URL to attach. Best-effort and never throws: if the
// visual isn't ready in time, or capture/upload fails, callers should still
// publish without an image rather than block on this indefinitely.
export async function ensureVisualImageUploaded(
  draftId: string,
  userId: string,
  opts: { timeoutMs?: number } = {}
): Promise<string | null> {
  const timeoutMs = opts.timeoutMs ?? 30000;
  const start = Date.now();

  let visual = await fetchLatestVisual(draftId);
  while (visual?.status === "generating" && Date.now() - start < timeoutMs) {
    await sleep(2000);
    visual = await fetchLatestVisual(draftId);
  }

  if (!visual || visual.status !== "ready") return null;
  if (visual.image_url) return visual.image_url;

  try {
    const dataUrl = await capturePngDataUrl(visual.html_content);
    const blob = dataUrlToBlob(dataUrl);
    const path = `${userId}/${visual.id}.png`;

    const { error: uploadError } = await supabase.storage
      .from("draft-visuals")
      .upload(path, blob, { contentType: "image/png", upsert: true });
    if (uploadError) {
      console.error("Visual upload failed:", uploadError);
      return null;
    }

    const { data: pub } = supabase.storage.from("draft-visuals").getPublicUrl(path);
    if (!pub?.publicUrl) return null;

    await supabase.from("draft_visuals").update({ image_url: pub.publicUrl }).eq("id", visual.id);
    return pub.publicUrl;
  } catch (err) {
    console.error("Visual capture failed:", err);
    return null;
  }
}
