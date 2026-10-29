// Honest classification of a Discover candidate's reference card, from the card's own fields.
// relevance_state: null = legacy (pre-queue), 'unscored'|'queued' = waiting for the Claude queue,
// 'scored' = queue scored it, 'failed' = queue gave up. Scored cards below the cutoff are ARCHIVED.
export type CardClass = "awaiting" | "failed" | "archived" | "active" | "gone" | "review";
export interface CardFields { relevance_state?: string | null; status?: string | null; global_relevance_score?: number | null }

export function classifyCard(card: CardFields | null | undefined): CardClass {
  if (!card) return "gone"; // legacy trigger deleted it, or it is not visible to this user
  const st = card.relevance_state ?? null;
  if (st === "unscored" || st === "queued") return "awaiting";
  if (st === "failed") return "failed";
  if (card.status === "archived") return "archived";
  if (card.status !== "active") return "review";
  if (card.global_relevance_score === null || card.global_relevance_score === undefined) return "failed";
  return "active";
}

// Whether "Keep anyway" may touch this card: only an archived card, only by its exact id and owner.
export function canKeepAnyway(c: CardClass): boolean { return c === "archived"; }
