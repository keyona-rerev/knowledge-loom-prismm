// PROPOSED: supabase/functions/_shared/novelty.ts
// Cross-batch duplicate guard. Compares a candidate draft against the novelty
// window on SIX signals, not title alone: title, hook/angle, framework name,
// lead stat, source reuse, and theme overlap. Used by claude-job-complete
// before any insert. Source and theme signals added 2026-11-19 after live
// output showed two posts a week apart citing different figures from the
// same report (Journey Advisory) with the same argument: figure-level checks
// passed them both.

export interface NoveltyWindowRow {
  title: string; body?: string | null; seed_insight?: string | null;
  stat_attributions?: { figure?: string; source?: string }[] | null;
}

const STOP = new Set(["the","a","an","of","to","and","in","on","for","your","you","is","are","it","that","this","at","by","or","not","no","be","how","why","what","when","where","who"]);

export function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9%\s]/g, " ").split(/\s+/)
    .filter(w => w.length > 2 && !STOP.has(w)));
}

// Normalize a stat figure so "70 percent", "70 Percent", and "70%" compare equal (F8).
export function normalizeFigure(s: string): string {
  return s.toLowerCase().replace(/(\d+(?:\.\d+)?)\s*percent\b/g, "$1%").replace(/[^0-9%a-z ]/g, "").replace(/\s+/g, " ").trim();
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

const FRAMEWORK_RE = /\b(three|four|five|two|3|4|5|2)[-\s](stage|moment|step|phase|layer|place|part)s?\b/gi;

// Normalize numeric-vs-word number forms so '4 Moments' collides with 'Four Moments'.
const NUM: Record<string, string> = { '2': 'two', '3': 'three', '4': 'four', '5': 'five' };

export function frameworkNames(text: string): string[] {
  return [...text.matchAll(FRAMEWORK_RE)].map(m =>
    `${NUM[m[1].toLowerCase()] ?? m[1].toLowerCase()}-${m[2].toLowerCase()}`);
}

// Normalize a source name so "Journey Advisory Group", "journey advisory
// group", and "Journey-Advisory Group" compare equal.
export function normalizeSource(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

export interface Collision { kind: "title" | "framework" | "stat" | "source" | "theme"; withTitle: string; score?: number; detail?: string; }

export function findCollision(
  cand: { title: string; body: string; stat_attributions?: { figure?: string; source?: string }[] },
  window: NoveltyWindowRow[],
  opts = { titleThreshold: 0.6, themeThreshold: 0.55 },
): Collision | null {
  const ct = tokens(cand.title);
  const candFrameworks = new Set(frameworkNames(cand.title + "\n" + cand.body));
  const candStats = new Set((cand.stat_attributions ?? []).map(a => normalizeFigure(a.figure ?? "")).filter(Boolean));
  const candSources = new Set((cand.stat_attributions ?? []).map(a => normalizeSource(a.source ?? "")).filter(Boolean));
  const candBodyTokens = tokens(cand.body);
  for (const row of window) {
    const sim = jaccard(ct, tokens(row.title));
    if (sim >= opts.titleThreshold) return { kind: "title", withTitle: row.title, score: sim };
    for (const f of frameworkNames(row.title + "\n" + (row.seed_insight ?? "") + "\n" + (row.body ?? ""))) {
      if (candFrameworks.has(f)) return { kind: "framework", withTitle: row.title, detail: f };
    }
    for (const a of row.stat_attributions ?? []) {
      const fig = normalizeFigure(a.figure ?? "");
      if (fig && candStats.has(fig)) return { kind: "stat", withTitle: row.title, detail: fig };
      const src = normalizeSource(a.source ?? "");
      if (src && candSources.has(src)) return { kind: "source", withTitle: row.title, detail: src };
    }
    // Theme: whole-argument overlap. Same-niche vocabulary keeps body
    // jaccard moderate, so this needs a high threshold. Check seed_insight
    // (the angle) and body separately; a match against either counts.
    const seedSim = (row.seed_insight ?? "").trim() ? jaccard(candBodyTokens, tokens(row.seed_insight ?? "")) : 0;
    const bodySim = (row.body ?? "").trim() ? jaccard(candBodyTokens, tokens(row.body ?? "")) : 0;
    const tsim = Math.max(seedSim, bodySim);
    if (tsim >= opts.themeThreshold) return { kind: "theme", withTitle: row.title, score: tsim };
  }
  return null;
}

export interface CollisionVerdict {
  action: "accept" | "requeue" | "fail";
  reason?: string;
}

// Pure decision used by claude-job-complete: a collision re-queues the job once
// with the collision named; a second collision fails honestly.
export function collisionVerdict(hit: Collision | null, retries: number): CollisionVerdict {
  if (!hit) return { action: "accept" };
  const label = `novelty collision (${hit.kind}${hit.detail ? ": " + hit.detail : ""}) with "${hit.withTitle}"`;
  if (retries < 1) return { action: "requeue", reason: label };
  return { action: "fail", reason: label + " after retry" };
}
