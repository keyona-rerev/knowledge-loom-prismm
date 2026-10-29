// supabase/functions/_shared/interactive-bindings.ts
// Batch13 (v4.1 contract): normalized replay-binding helpers shared by the
// interactive routes (directions/final) and consume-final-job.
//
// Normalization rules:
// - missing/undefined -> null (absent is a value, never dropped from compare)
// - insightCardIds compared as an ORDER-INSENSITIVE set (sorted strings)
// - nested objects compared by stable key order (canonical stringify)
// A stored job with NO binding (legacy one-shot form) reattaches by key only
// (documented gap in the contract, accepted).

export const PENDING_STATUSES = ["queued", "claimed", "completing", "paused_auth", "paused_quota"];

export function normalizeCardIds(ids: unknown): string[] | null {
  if (!Array.isArray(ids) || ids.length === 0) return null;
  return ids.map(String).slice().sort();
}

function canonical(v: unknown): string {
  // Arrays compare order-insensitively: the only array field in either route's
  // compare set is insightCardIds, which the contract defines as a set.
  if (Array.isArray(v)) return "[" + v.map(canonical).sort().join(",") + "]";
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + canonical(o[k])).join(",") + "}";
  }
  return JSON.stringify(v ?? null);
}

// Full-key compare over the normalized binding; both sides must carry the
// same key set. Missing-vs-null is NOT equal (a dropped field is a change).
export function bindingsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every((k) => canonical(a[k]) === canonical(b[k]));
}

// P1 parser (contract G4): extract the JSON payload INSIDE result.text,
// tolerating the existing fence/preamble contract - the same tolerance as the
// routes' and client's parseJSON. Throws on unparseable text; callers map that
// to 422 LEGACY_CONTENT_UNDERIVABLE.
export function parseJsonPayload(text: string): any {
  let content = text.trim();
  const fence = content.match(/```(?:\w*)?\s*([\s\S]*?)\s*```/i);
  if (fence) content = fence[1].trim();
  const jsonMatch = content.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) content = jsonMatch[1];
  return JSON.parse(content);
}

// Admission validation: strategy/format/nature/card ids must be UUID-shaped
// when present so queued metadata is coherent (400 before any enqueue).
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): boolean => typeof v === "string" && UUID_RE.test(v);
