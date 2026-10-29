// src/lib/discoverCandidates.ts
// Client-side twin of supabase/functions/_shared/discover-candidates.ts (same rules,
// same tests). Needed because on the 202 path the browser receives the worker's raw
// text from claude-job-status, so candidates must be re-validated here before use.
export const MAX_CANDIDATES = 25;
export interface Candidate { title: string; url: string; reason: string }

// Hosts that must never be fetched on a candidate's behalf (internal/loopback).
const INTERNAL_SUFFIXES = ["localhost", "local", "internal", "lan", "home", "corp", "intranet", "private", "localdomain", "home.arpa"];
function isPrivateHost(h: string): boolean {
  // Normalize: lowercase, strip IPv6 brackets and ANY trailing dots ("localhost." is localhost).
  const host = h.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  if (!host) return true;
  if (host.includes(":")) return true;                       // any IPv6 literal
  if (!host.includes(".")) return true;                       // single-label host
  if (INTERNAL_SUFFIXES.some((s) => host === s || host.endsWith("." + s))) return true;
  const tld = host.slice(host.lastIndexOf(".") + 1);
  if (!/[a-z]/.test(tld)) return true;                        // numeric TLD = IPv4 literal in any notation
  if (/^[0-9.]+$/.test(host) || /^0x[0-9a-f.]+$/i.test(host)) return true;
  return false;
}

// Returns a normalized http(s) URL string, or null if unacceptable.
export function safeUrl(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s || s.length > 2000) return null;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== "80" && u.port !== "443") return null;
  if (isPrivateHost(u.hostname)) return null;
  u.hash = "";
  return u.toString();
}

function parseJsonText(text: string): any {
  let content = (text ?? "").trim();
  const fence = content.match(/```(?:\w*)?\s*([\s\S]*?)\s*```/i);
  if (fence) content = fence[1].trim();
  const m = content.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (m) content = m[1];
  return JSON.parse(content);
}

// Parse + validate the worker's text. Throws on unparseable output.
// Validate a raw candidate array (untrusted). Drops non-http(s), internal hosts, dupes and excluded URLs.
export function sanitizeCandidates(raw: unknown, exclude: string[] = [], max = MAX_CANDIDATES): Candidate[] {
  const list: any[] = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>(exclude.map((u) => safeUrl(u) ?? u));
  const out: Candidate[] = [];
  for (const c of list) {
    const url = safeUrl(c?.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({
      title: String(c?.title ?? "").replace(/[\u0000-\u001f]/g, " ").slice(0, 300).trim(),
      url,
      reason: String(c?.reason ?? "").replace(/[\u0000-\u001f]/g, " ").slice(0, 200).trim(),
    });
    if (out.length >= max) break;
  }
  return out;
}

// Parse + validate the worker's text. Throws on unparseable output.
export function parseCandidates(text: string, exclude: string[] = [], max = MAX_CANDIDATES): Candidate[] {
  return sanitizeCandidates(parseJsonText(text)?.candidates, exclude, max);
}

// Normalize for provenance comparison (same rules as safeUrl; null if unacceptable).
export function normUrl(raw: unknown): string | null { return safeUrl(raw); }

// Provenance: keep only candidates whose URL appears in the set of URLs the worker
// workflow itself extracted from successful WebSearch tool results (never model-written).
// FAILS CLOSED: no verified URLs at all (tool denied/unavailable/not used) throws.
export function verifyCandidates(cands: Candidate[], verifiedUrls: unknown): Candidate[] {
  const set = new Set<string>();
  if (Array.isArray(verifiedUrls)) for (const u of verifiedUrls.slice(0, 500)) { const n = safeUrl(u); if (n) set.add(n); }
  if (set.size === 0) throw new Error("Search provenance unavailable: the worker did not return verified web search results");
  return cands.filter((c) => set.has(c.url));
}

export function cleanTopics(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  for (const t of list) {
    const v = String(t ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    if (v && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
    if (out.length >= 8) break;
  }
  return out;
}
