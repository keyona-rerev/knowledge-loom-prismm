// PROPOSED: supabase/functions/_shared/novelty.ts
// Cross-batch duplicate guard. Compares a candidate draft against the novelty
// window on FOUR signals, not title alone: title, hook/angle, framework name,
// lead stat. Used by claude-job-complete before any insert.

export interface NoveltyWindowRow {
  title: string; body?: string | null; seed_insight?: string | null;
  stat_attributions?: { figure?: string }[] | null;
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

export interface Collision { kind: "title" | "framework" | "stat"; withTitle: string; score?: number; detail?: string; }

export function findCollision(
  cand: { title: string; body: string; stat_attributions?: { figure?: string }[] },
  window: NoveltyWindowRow[],
  opts = { titleThreshold: 0.6 },
): Collision | null {
  const ct = tokens(cand.title);
  const candFrameworks = new Set(frameworkNames(cand.title + "\n" + cand.body));
  const candStats = new Set((cand.stat_attributions ?? []).map(a => normalizeFigure(a.figure ?? "")).filter(Boolean));
  for (const row of window) {
    const sim = jaccard(ct, tokens(row.title));
    if (sim >= opts.titleThreshold) return { kind: "title", withTitle: row.title, score: sim };
    for (const f of frameworkNames(row.title + "\n" + (row.seed_insight ?? "") + "\n" + (row.body ?? ""))) {
      if (candFrameworks.has(f)) return { kind: "framework", withTitle: row.title, detail: f };
    }
    for (const a of row.stat_attributions ?? []) {
      const fig = normalizeFigure(a.figure ?? "");
      if (fig && candStats.has(fig)) return { kind: "stat", withTitle: row.title, detail: fig };
    }
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
