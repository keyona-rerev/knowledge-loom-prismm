import { classifyCard, type CardClass } from "@/lib/discoverClassify";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { invokeQueued } from "@/lib/invokeQueued";
import { cleanTopics, sanitizeCandidates, parseCandidates, verifyCandidates } from "@/lib/discoverCandidates";

// Durable handle for an in-flight source search, so a reload or poll timeout reattaches
// to the same job instead of starting a duplicate query.
const HANDLE_KEY = "loom.discover.search";
const readHandle = (): { jobId?: string; requestKey: string } | null => {
  try { const h = JSON.parse(localStorage.getItem(HANDLE_KEY) ?? "null"); return h?.requestKey ? h : null; } catch { return null; }
};
const writeHandle = (h: { jobId?: string; requestKey: string } | null) => {
  try { h ? localStorage.setItem(HANDLE_KEY, JSON.stringify(h)) : localStorage.removeItem(HANDLE_KEY); } catch { /* storage unavailable */ }
};
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { ArrowLeft, Search, Loader2, CheckCircle2, XCircle, ExternalLink, RotateCcw, ShieldCheck, Trash2, ChevronDown, ChevronRight, X } from "lucide-react";
import { InstructionsToggle } from "@/components/InstructionsToggle";

// One candidate URL as it moves through the pipeline on screen:
// found -> checking (fetching + scoring via the existing
// create-manual-source + process-reference-card pipeline) -> kept (survived
// the auto-delete threshold, now a real reference card) or filtered
// (auto-deleted for scoring too low, same as any other low-scoring source).
// "removed" is a kept row whose card was deleted right here on this page
// after an inline review.
type CandidateStatus = "checking" | "kept" | "filtered" | "failed" | "removed" | "awaiting" | "exists" | "review";

interface CandidateRow {
  title: string;
  url: string;
  reason: string;
  status: CandidateStatus;
  cardId?: string;
  reused?: boolean;
  error?: string;
}

// Cached reference_cards fields for the inline expand panel on a "kept"
// row, so approving/rejecting a source doesn't require leaving this page.
interface CardDetail {
  id: string;
  title: string;
  ai_summary: string | null;
  original_text: string | null;
  source_url: string | null;
  approved: boolean;
}

interface LastRun {
  completedAt: string | null;
  target: number;
  kept: number;
  checked: number;
}

// The old flat cap of 30 meant a request for even 1-2 sources could still
// burn through 30 candidates if scoring was strict. The cap now scales with
// what was actually asked for — twice the requested count — so "find 3"
// tries at most 6, not 30. Still floored at a sane ceiling so a request for
// the max (15) doesn't run away either.
const MAX_ROUNDS = 3;
const candidateCap = (targetCount: number) => Math.min(targetCount * 2, 15);

// If a saved session still says "running" but hasn't been touched in this
// long, treat it as abandoned (tab closed or reloaded mid-run) rather than
// leaving the UI stuck on "Searching..." forever.
const STALE_RUN_MS = 90_000;

const DiscoverSources = () => {
  const navigate = useNavigate();
  const [targetCount, setTargetCount] = useState<number>(5);
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<CandidateRow[]>([]);
  const [defaultQuestionSetId, setDefaultQuestionSetId] = useState<string>("");
  const [existingUrls, setExistingUrls] = useState<Set<string>>(new Set());
  // Per-row action in flight ("Retry" or "Keep anyway"), separate from the
  // main `running` search loop so a single-row retry doesn't disable the
  // whole page.
  const [busyUrl, setBusyUrl] = useState<string | null>(null);
  // Public search terms. Unconfigured by default; nothing is searched until saved on purpose.
  const [topicsText, setTopicsText] = useState("");
  const [savedTopics, setSavedTopics] = useState<string[]>([]);
  const [savingTopics, setSavingTopics] = useState(false);

  // Inline card review, so a "kept" row's Approve/Reject can happen right
  // here instead of navigating to Reference Cards and back. expandedUrl is
  // which row (by url) is currently open; cardDetails caches what's been
  // fetched so re-expanding a row doesn't re-fetch; cardBusy is the cardId
  // currently mid-Approve/Reject.
  const [expandedUrl, setExpandedUrl] = useState<string | null>(null);
  const [cardDetails, setCardDetails] = useState<Record<string, CardDetail>>({});
  const [cardBusy, setCardBusy] = useState<string | null>(null);

  // Standing "last run" summary, independent of the live rows list, so
  // hitting Clear results doesn't also erase the answer to "did this run
  // recently and find anything." Same idea as Cadence's Fast-forward line.
  const [lastRun, setLastRun] = useState<LastRun | null>(null);
  const [attemptState, setAttemptState] = useState<"pending" | "failed" | null>(null);

  // Source of truth for "what's on screen right now," kept outside React
  // state so the search loop (a single long-running async function) always
  // persists the latest rows to Supabase even across renders, and so a
  // fresh mount of this page can tell "I started this run" apart from "I'm
  // just resuming a view of one already in progress elsewhere."
  const liveRowsRef = useRef<CandidateRow[]>([]);
  const startedHereRef = useRef(false);
  const userIdRef = useRef<string>("");

  const persistSession = async (rowsSnapshot: CandidateRow[], runningFlag: boolean, count: number) => {
    if (!userIdRef.current) return;
    await supabase.from("discover_sessions" as any).upsert(
      {
        user_id: userIdRef.current,
        target_count: count,
        running: runningFlag,
        rows: rowsSnapshot as any,
      },
      { onConflict: "user_id" }
    );
  };

  const commitRows = (newRows: CandidateRow[], runningFlag: boolean) => {
    liveRowsRef.current = newRows;
    setRows(newRows);
    persistSession(newRows, runningFlag, targetCount);
  };

  const saveTopics = async () => {
    const t = cleanTopics(topicsText.split(/[\n,;]+/));
    setSavingTopics(true);
    const uid = userIdRef.current;
    const { data: existing } = await supabase.from("audience_profile").select("id").eq("user_id", uid).maybeSingle();
    const { error } = existing?.id
      ? await supabase.from("audience_profile").update({ discovery_topics: t } as any).eq("id", existing.id)
      : await supabase.from("audience_profile").insert([{ user_id: uid, discovery_topics: t }] as any);
    setSavingTopics(false);
    if (error) { toast.error("Could not save topics: " + error.message); return; }
    setSavedTopics(t); setTopicsText(t.join("\n"));
    toast.success(t.length ? "Search topics saved." : "Search topics cleared. Search is off.");
  };

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/auth"); return; }
      userIdRef.current = session.user.id;
      const { data: ap } = await supabase.from("audience_profile").select("discovery_topics").eq("user_id", session.user.id).maybeSingle();
      const t = cleanTopics((ap as any)?.discovery_topics);
      setSavedTopics(t); setTopicsText(t.join("\n"));

      // Default question set: same "is_global first, then oldest active"
      // rule process-reference-card falls back to, so discovered cards get
      // asked the same questions as everything else by default.
      const { data: qs } = await supabase
        .from("question_sets")
        .select("id")
        .eq("user_id", session.user.id)
        .eq("is_active", true)
        .order("is_global", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (qs?.id) setDefaultQuestionSetId(qs.id);

      const { data: existing } = await supabase
        .from("reference_cards")
        .select("source_url")
        .eq("user_id", session.user.id)
        .not("source_url", "is", null);
      setExistingUrls(new Set((existing || []).map((r: any) => r.source_url).filter(Boolean)));

      // Restore whatever was last found, so leaving this page and coming
      // back doesn't throw away results worth reviewing or overriding.
      const { data: saved } = await supabase
        .from("discover_sessions" as any)
        .select("*")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (saved) {
        const s = saved as any;
        const savedRows = await Promise.all(((s.rows as CandidateRow[]) || []).map(async (row) => {
          if (!row.cardId) return row;
          try { return { ...row, ...fromClass(await readCard(row.cardId), row.cardId) }; }
          catch { return { ...row, status: "failed" as const, error: "Could not read current scoring state. Open Reference Cards to inspect it." }; }
        }));
        liveRowsRef.current = savedRows;
        setRows(savedRows);
        if (s.target_count) setTargetCount(s.target_count);

        if (s.completed_at) {
          setLastRun({ completedAt: s.completed_at, target: s.last_target ?? 0, kept: s.last_kept ?? 0, checked: s.last_checked ?? 0 });
        }

        const updatedAt = new Date(s.updated_at as string).getTime();
        const stale = s.running && Date.now() - updatedAt > STALE_RUN_MS;

        if (s.running && !stale) {
          // Plausibly still running (e.g. resumed after navigating within
          // the app) — reflect that and poll for updates below.
          setRunning(true);
        } else if (s.running && stale) {
          await supabase.from("discover_sessions" as any).update({ running: false }).eq("user_id", session.user.id);
          toast.info("A previous search looks like it was interrupted — showing what it found so far.");
        }
      }
    };
    init();
  }, [navigate]);

  // If we're showing "running" but didn't start the loop in this exact
  // mount (resumed from a saved session), poll the DB for progress instead
  // of just sitting on stale results until the user refreshes.
  useEffect(() => {
    if (!running || startedHereRef.current) return;
    const interval = setInterval(async () => {
      if (!userIdRef.current) return;
      const { data: saved } = await supabase
        .from("discover_sessions" as any)
        .select("*")
        .eq("user_id", userIdRef.current)
        .maybeSingle();
      if (!saved) { setRunning(false); return; }
      const s = saved as any;
      const savedRows = (s.rows as CandidateRow[]) || [];
      liveRowsRef.current = savedRows;
      setRows(savedRows);
      if (!s.running) {
        setRunning(false);
        if (s.completed_at) {
          setLastRun({ completedAt: s.completed_at, target: s.last_target ?? 0, kept: s.last_kept ?? 0, checked: s.last_checked ?? 0 });
        }
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [running]);

  const upsertRow = (url: string, patch: Partial<CandidateRow>, runningFlag: boolean = true) => {
    const updated = liveRowsRef.current.map((r) => (r.url === url ? { ...r, ...patch } : r));
    commitRows(updated, runningFlag);
  };

  // Only clears the visible list, not the standing "last run" summary —
  // those are two different questions ("what did it just find" vs "did
  // this run recently at all").
  const clearResults = async () => {
    liveRowsRef.current = [];
    setRows([]);
    setExpandedUrl(null);
    if (userIdRef.current) {
      await supabase.from("discover_sessions" as any).update({ rows: [] as any }).eq("user_id", userIdRef.current);
    }
  };

  // Reads ONE card by exact id AND owner (never by URL alone) and classifies it honestly.
  const readCard = async (cardId: string): Promise<CardClass> => {
    const { data, error } = await supabase
      .from("reference_cards")
      .select("id, global_relevance_score, relevance_state, status")
      .eq("id", cardId)
      .eq("user_id", userIdRef.current)
      .maybeSingle();
    if (error) throw new Error("Could not read the card: " + error.message);
    return classifyCard(data as any);
  };

  const fromClass = (cls: CardClass, cardId: string) => {
    switch (cls) {
      case "awaiting": return { status: "awaiting" as const, cardId };
      case "active": return { status: "kept" as const, cardId };
      case "archived": return { status: "filtered" as const, cardId };
      case "gone": return { status: "filtered" as const };
      case "review": return { status: "review" as const, cardId };
      default: return {
        status: "failed" as const,
        cardId,
        error: "Scoring did not complete for this card. The queue exhausted its scoring attempts; use View to inspect the card.",
      };
    }
  };

  const checkOneCandidate = async (c: { title: string; url: string; reason: string }) => {
    // Never create a second card for a URL this user already has: reuse it.
    const { data: existing, error: lookupError } = await supabase
      .from("reference_cards")
      .select("id")
      .eq("user_id", userIdRef.current)
      .eq("source_url", c.url)
      .limit(1)
      .maybeSingle();
    if (lookupError) throw new Error("Could not check existing cards: " + lookupError.message);
    if (existing?.id) {
      return { ...fromClass(await readCard(existing.id), existing.id), reused: true };
    }

    const { data: createData, error: createError } = await supabase.functions.invoke("create-manual-source", {
      body: {
        type: "url",
        url: c.url,
        question_set_id: defaultQuestionSetId || undefined,
        from_company: false,
        discovery: true,
      },
    });
    if (createError || createData?.error) {
      return { status: "failed" as const, error: createError?.message || createData?.error };
    }
    const cardId = createData?.cardId as string;
    return { ...fromClass(await readCard(cardId), cardId), reused: createData?.reused === true };
  };

  // Retry never inserts. With a card it re-reads it, and for awaiting/failed rows runs the same
  // per-user "Score now" as Reference Cards. Without a card (fetch failed) it re-runs the
  // duplicate-safe create path.
  const retryRow = async (row: CandidateRow) => {
    setBusyUrl(row.url);
    upsertRow(row.url, { status: "checking", error: undefined }, running);
    try {
      let result: any;
      if (row.cardId) {
        const before = await readCard(row.cardId);
        if (before === "awaiting") {
          const { error, data } = await supabase.functions.invoke("score-relevance", { body: {} });
          if (error || data?.error) throw new Error(error?.message || data.error);
        }
        result = fromClass(await readCard(row.cardId), row.cardId);
      } else {
        // Fetch/transport errors can happen after insertion; the DB admission reattaches by owner+URL.
        result = await checkOneCandidate(row);
      }
      upsertRow(row.url, { ...result }, running);
      if (result.status === "kept") toast.success("Kept.");
      else if (result.status === "awaiting") toast.info("Still awaiting scoring. Results appear once the queue scores it; nothing failed.");
      else if (result.status === "exists") toast.info("This URL is already in your library.");
      else if (result.status === "failed") toast.error("Not scored yet: " + (result.error || "unknown error"));
      else toast.info("This card is below your cutoff, unavailable, or needs review. Nothing was inserted.");
    } catch (e) {
      upsertRow(row.url, { status: row.status, error: String((e as Error).message) }, running);
      toast.error(String((e as Error).message));
    } finally {
      setBusyUrl(null);
    }
  };

  // Keep anyway: only an ARCHIVED card, by exact id and owner. Sets force_keep and restores
  // status archived -> active in one conditional update, then verifies. Never inserts.
  const keepAnyway = async (row: CandidateRow) => {
    if (!row.cardId) return;
    setBusyUrl(row.url);
    try {
      const cls = await readCard(row.cardId);
      if (cls !== "archived") {
        upsertRow(row.url, fromClass(cls, row.cardId) as any, running);
        toast.info("This card is no longer archived, so nothing was changed.");
        return;
      }
      const { error } = await supabase
        .from("reference_cards")
        .update({ force_keep: true, status: "active" })
        .eq("id", row.cardId)
        .eq("user_id", userIdRef.current)
        .eq("status", "archived");
      const after = await readCard(row.cardId);
      if (error || after !== "active") {
        toast.error("Couldn't restore this card: " + (error?.message || "it is still archived"));
        return;
      }
      upsertRow(row.url, { status: "kept", cardId: row.cardId }, running);
      toast.success("Restored. This card now bypasses the relevance cutoff.", {
        description: "Head to Reference Cards to review and approve it.",
      });
    } catch (e) {
      toast.error(String((e as Error).message));
    } finally {
      setBusyUrl(null);
    }
  };

  // Toggles the inline review panel open/closed for a "kept" row, fetching
  // the card's live approved state the first time (cached after that, so
  // re-opening doesn't hit the DB again until an action changes it).
  const toggleExpanded = async (row: CandidateRow) => {
    if (expandedUrl === row.url) { setExpandedUrl(null); return; }
    setExpandedUrl(row.url);
    if (!row.cardId || cardDetails[row.cardId]) return;
    const { data } = await supabase
      .from("reference_cards")
      .select("id, title, ai_summary, original_text, source_url, approved")
      .eq("id", row.cardId)
      .maybeSingle();
    if (data) setCardDetails((prev) => ({ ...prev, [data.id]: data as CardDetail }));
  };

  const approveCard = async (cardId: string) => {
    setCardBusy(cardId);
    const { error } = await supabase.from("reference_cards").update({ approved: true }).eq("id", cardId);
    setCardBusy(null);
    if (error) { toast.error("Failed to approve"); return; }
    setCardDetails((prev) => ({ ...prev, [cardId]: { ...prev[cardId], approved: true } }));
    toast.success("Approved — citable in generated content now.");
  };

  const unapproveCard = async (cardId: string) => {
    setCardBusy(cardId);
    const { error } = await supabase.from("reference_cards").update({ approved: false }).eq("id", cardId);
    setCardBusy(null);
    if (error) { toast.error("Failed to update"); return; }
    setCardDetails((prev) => ({ ...prev, [cardId]: { ...prev[cardId], approved: false } }));
    toast.info("Approval removed.");
  };

  // Rejecting here means the source shouldn't exist at all, not just
  // "not approved" (which is already the default for every new card) — so
  // this deletes the reference card outright rather than leaving an
  // unapproved one sitting around to review again later.
  const rejectCard = async (row: CandidateRow) => {
    if (!row.cardId) return;
    if (!confirm("Remove this source? This permanently deletes the reference card.")) return;
    setCardBusy(row.cardId);
    const { error } = await supabase.from("reference_cards").delete().eq("id", row.cardId);
    setCardBusy(null);
    if (error) { toast.error("Failed to remove card"); return; }
    upsertRow(row.url, { status: "removed" }, running);
    setExpandedUrl(null);
    toast.success("Source removed.");
  };

  const runDiscovery = async () => {
    startedHereRef.current = true;
    setRunning(true);
    commitRows([], true);
    setExpandedUrl(null);

    const seenUrls = new Set<string>(existingUrls);
    let kept = 0;
    let round = 0;
    let searchStopped = false;
    setAttemptState(null);
    let totalTried = 0;
    let awaiting = 0; // candidates created but not yet scored by the queue
    const maxCandidates = candidateCap(targetCount);

    try {
      // Search for the number still needed, ingest the batch, then inspect its
      // current states. Pending queue work is not a rejected candidate.
      // Stop searching once anything is awaiting scoring: yield is unknown until the queue scores it,
      // and each further round is another subscription search.
      while (kept < targetCount && awaiting === 0 && round < MAX_ROUNDS && totalTried < maxCandidates) {
        round++;
        const stillNeeded = targetCount - kept;

        // Runs on the Claude subscription queue: 200 when the worker answers in
        // time, otherwise 202 and we poll claude-job-status (up to ~12 min, the
        // worker's own timeout). Results are re-validated below either way.
        // Reuse the stored handle if a search is still in flight (same requestKey and,
        // once known, the same jobId); otherwise start a new one with a fresh key.
        const handle = readHandle() ?? { requestKey: crypto.randomUUID() };
        writeHandle(handle);
        const { data, error } = await invokeQueued(
          "search-sources",
          { targetCount: stillNeeded, requestKey: handle.requestKey },
          { pollMs: 5000, maxPolls: 150, resumeJobId: handle.jobId, raw: true,
            onJobId: (jobId) => writeHandle({ ...handle, jobId }) },
        );
        if (!error || !(error as any).stillRunning) writeHandle(null); // terminal: result or error consumed
        if (error && (error as any).stillRunning) {
          toast.message(error.message, { description: "The search handle is kept. Click Search now after signing in or when status is available to resume without a second search." });
          searchStopped = true;
          setAttemptState("pending");
          break;
        }

        if (error) {
          // supabase-js's default error.message for a failed function call
          // is a generic "Edge Function returned a non-2xx status code" —
          // it doesn't surface the actual JSON body search-sources sent
          // back (e.g. the real Anthropic API error). Pull the real reason
          // out of the response context when it's available so failures
          // are actually diagnosable instead of a dead end.
          let detail = error.message;
          try {
            const body = await (error as any).context?.json?.();
            if (body?.error) detail = body.error;
          } catch {
            // context wasn't readable JSON — fall back to the generic message
          }
          toast.error("Search failed: " + detail);
          searchStopped = true;
          setAttemptState("failed");
          break;
        }
        if (data?.error) {
          toast.error(data.error);
          searchStopped = true;
          setAttemptState("failed");
          break;
        }

        let candidates;
        try {
          // 200 path: server already verified. 202 path: raw worker result, verified here
          // against the workflow-extracted search URLs; fails closed without them.
          candidates = Array.isArray(data?.candidates)
            ? sanitizeCandidates(data.candidates, Array.from(seenUrls))
            : verifyCandidates(parseCandidates(String(data?.text ?? ""), Array.from(seenUrls)), data?.verified_urls);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Could not read the search results");
          searchStopped = true;
          setAttemptState("failed");
          break;
        }
        if (!candidates.length) break; // nothing new found this round

        // Brief pause between the search phase finishing and scoring
        // starting, so the two phases read as genuinely sequential rather
        // than blurring together.
        await new Promise((r) => setTimeout(r, 400));

        // Scoring phase: work through this batch fully, one candidate at a
        // time, before the loop is allowed to search again.
        for (const c of candidates) {
          if (kept >= targetCount || totalTried >= maxCandidates) break;
          seenUrls.add(c.url);
          totalTried++;

          commitRows([...liveRowsRef.current, { ...c, status: "checking" }], true);

          const result = await checkOneCandidate(c);
          if (result.status === "kept" && !result.reused) kept++;
          if (result.status === "awaiting") awaiting++;
          upsertRow(c.url, { ...result }, true);

          // Pace ingestion calls. Summary and relevance are asynchronous queue work;
          // this pause does not make either result ready.
          await new Promise((r) => setTimeout(r, 1200));
        }
      }
    } finally {
      setRunning(false);
      startedHereRef.current = false;
      const completedAt = new Date().toISOString();
      if (userIdRef.current) {
        await supabase.from("discover_sessions" as any).upsert(
          {
            user_id: userIdRef.current,
            target_count: targetCount,
            running: false,
            rows: liveRowsRef.current as any,
            ...(searchStopped ? {} : { completed_at: completedAt, last_target: targetCount, last_kept: kept, last_checked: totalTried }),
          },
          { onConflict: "user_id" }
        );
      }
      if (!searchStopped) setLastRun({ completedAt, target: targetCount, kept, checked: totalTried });
    }

    if (searchStopped) return;
    if (awaiting > 0) {
      toast.info(`Added ${awaiting} source${awaiting === 1 ? "" : "s"} awaiting scoring.`, {
        description: "They are queued for relevance scoring and will show their result in Reference Cards once scoring completes. The search stopped after this round.",
      });
    } else if (kept === 0 && totalTried === 0) {
      toast.error("No candidates found — try again in a moment, or check that your saved public search topics are specific enough.");
    } else if (kept === 0) {
      toast.error(`Checked ${totalTried} candidate${totalTried === 1 ? "" : "s"} but kept none — see the results below for why (below your relevance cutoff, or scoring did not complete). Try again, or check Reference Cards Settings for the cutoff.`);
    } else if (kept < targetCount) {
      toast.warning(`Kept ${kept} of ${targetCount} requested — ran out of qualifying candidates after ${round} search round${round === 1 ? "" : "s"}.`);
    } else {
      toast.success(`Kept ${kept} new reference card${kept === 1 ? "" : "s"}.`, {
        description: "Head to Reference Cards to review and approve them.",
      });
    }
  };

  const statusBadge = (row: CandidateRow) => {
    switch (row.status) {
      case "checking":
        return <Badge variant="outline" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />Checking</Badge>;
      case "kept":
        return <Badge className="gap-1 bg-green-600 hover:bg-green-600"><CheckCircle2 className="h-3 w-3" />Kept</Badge>;
      case "filtered":
        return <Badge variant="secondary" className="gap-1"><XCircle className="h-3 w-3" />{row.cardId ? "Archived (below cutoff)" : "Removed (below cutoff)"}</Badge>;
      case "awaiting":
        return <Badge variant="outline" className="gap-1"><Loader2 className="h-3 w-3" />Awaiting scoring</Badge>;
      case "review":
        return <Badge variant="outline">Needs review</Badge>;
      case "exists":
        return <Badge variant="secondary" className="gap-1">Already in library</Badge>;
      case "removed":
        return <Badge variant="outline" className="gap-1 text-muted-foreground"><Trash2 className="h-3 w-3" />Removed</Badge>;
      case "failed":
        return row.cardId
          ? <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />Scoring failed</Badge>
          : <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />Couldn't fetch</Badge>;
    }
  };

  const keptCount = rows.filter((r) => r.status === "kept").length;
  const awaitingCount = rows.filter((r) => r.status === "awaiting").length;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <Button variant="ghost" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-3xl">
        <h1 className="text-3xl font-bold mb-4">Discover Sources</h1>

        <InstructionsToggle
          instructions={`Discover Sources finds new reference cards for you, instead of you finding them:

- Enter how many high-quality sources you want, then Search
- It searches the live web (through your Claude subscription worker; no separate account or API key) using only the public topics you save on this page
- Every candidate becomes a reference card and is scored by the same queue as any other source. Scoring is not instant: new rows show "Awaiting scoring" until the queue runs (or you press "Score now" in Reference Cards or on the row). Awaiting is not a rejection
- Cards that score below your cutoff are archived, not deleted. Use "Keep anyway" on an "Archived" row to restore that same card (no duplicate is created)
- A URL already in your library is shown as "Already in library" and is never added twice
- If a fetch failed use "Retry"; if scoring is pending use "Score now"; a failed card has exhausted its scoring attempts, so use "View" to inspect it
- Click a "Kept" row to expand it — read the summary and Approve or Remove it right here, no need to leave this page
- A search stops after a round if anything is awaiting scoring, because yield is unknown until it is scored; it may search again only when a whole round was scored or rejected
- Results stay here across navigation until you hit "Clear results" — come back anytime to review or override what was found
- Kept cards land in Reference Cards exactly like any other source — approve them from there, or right here, before they can be cited`}
        />

        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="h-4 w-4" />Find new sources
            </CardTitle>
            <CardDescription>
              Searches public sources on the topics you save below, adds candidates for queued scoring, and archives cards below your relevance cutoff.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 space-y-2" data-testid="discovery-topics">
              <Label htmlFor="discovery-topics" className="text-sm font-medium">Public search topics</Label>
              <textarea
                id="discovery-topics"
                className="w-full rounded-md border bg-background p-2 text-sm"
                rows={3}
                placeholder="One topic per line, e.g. community bank liquidity"
                value={topicsText}
                onChange={(e) => setTopicsText(e.target.value)}
                disabled={running || savingTopics}
              />
              <p className="text-xs text-muted-foreground">
                These topics guide public web searches. An AI turns them into search queries, and the search engines see those queries, which may use related wording beyond your exact terms. Do not enter client names, private plans or anything confidential. Nothing from your Strategy or Audience pages is sent. Up to 8 topics.
              </p>
              <Button size="sm" variant="outline" onClick={saveTopics} disabled={running || savingTopics}>
                {savingTopics ? "Saving..." : "Save topics"}
              </Button>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <Label htmlFor="target-count" className="text-sm font-medium whitespace-nowrap">Find</Label>
              <Input
                id="target-count"
                type="number"
                min={1}
                max={15}
                value={targetCount}
                onChange={(e) => setTargetCount(Math.max(1, Math.min(15, parseInt(e.target.value) || 1)))}
                className="w-20"
                disabled={running}
              />
              <span className="text-sm text-muted-foreground">high-quality sources</span>
              <Button onClick={runDiscovery} disabled={running || savedTopics.length === 0} className="ml-auto" title={savedTopics.length === 0 ? "Save at least one public search topic first" : undefined}>
                {running ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Searching...</>
                ) : (
                  <><Search className="h-4 w-4 mr-2" />Search now</>
                )}
              </Button>
            </div>
            {!running && lastRun && (
              <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
                <span>
                  Last search: {lastRun.completedAt ? new Date(lastRun.completedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "unknown time"}
                  {" — "}kept {lastRun.kept} of {lastRun.checked} checked (asked for {lastRun.target})
                </span>
                <button
                  onClick={() => navigate("/cards")}
                  className="inline-flex items-center gap-0.5 text-primary hover:underline shrink-0"
                >
                  Go to Reference Cards<ChevronRight className="h-3 w-3" />
                </button>
              </div>
            )}
          </CardContent>
        </Card>

        {rows.length > 0 && (
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between gap-3 space-y-0">
              <CardTitle className="text-base">
                Results {running ? "(in progress...)" : `- ${keptCount} kept${awaitingCount ? `, ${awaitingCount} awaiting scoring` : ""} of ${rows.length} checked`}
              </CardTitle>
              <Button
                size="sm"
                variant="ghost"
                onClick={clearResults}
                disabled={running}
                className="text-muted-foreground gap-1"
              >
                <Trash2 className="h-3.5 w-3.5" />Clear results
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {rows.map((row) => {
                const canExpand = row.status === "kept" && !!row.cardId;
                const isExpanded = expandedUrl === row.url;
                const detail = row.cardId ? cardDetails[row.cardId] : undefined;
                return (
                  <div key={row.url} className="bg-muted/40 rounded-md overflow-hidden">
                    <div
                      className={`flex items-center justify-between gap-3 p-3 ${canExpand ? "cursor-pointer" : ""}`}
                      onClick={canExpand ? () => toggleExpanded(row) : undefined}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {canExpand && (
                            <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                          )}
                          <a
                            href={row.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-sm font-medium truncate hover:underline flex items-center gap-1"
                          >
                            {row.title || row.url}
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                        </div>
                        {row.reason && <p className="text-xs text-muted-foreground mt-0.5 truncate">{row.reason}{row.reused ? " (existing card reused)" : ""}</p>}
                        {row.error && <p className="text-xs text-destructive mt-0.5">{row.error}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                        {statusBadge(row)}
                        {(row.status === "failed" || row.status === "awaiting" || row.status === "review" || row.status === "exists") && row.cardId && (
                          <Button size="sm" variant="outline" onClick={() => navigate(`/cards/${row.cardId}`)}>
                            View
                          </Button>
                        )}
                        {((row.status === "failed" && !row.cardId) || row.status === "awaiting") && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1"
                            disabled={busyUrl === row.url || running}
                            onClick={() => retryRow(row)}
                          >
                            {busyUrl === row.url ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                            {row.cardId ? "Score now" : "Retry"}
                          </Button>
                        )}
                        {row.status === "filtered" && row.cardId && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1"
                            disabled={busyUrl === row.url || running}
                            onClick={() => keepAnyway(row)}
                          >
                            {busyUrl === row.url ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
                            Keep anyway
                          </Button>
                        )}
                      </div>
                    </div>

                    {canExpand && (
                      <Collapsible open={isExpanded}>
                        <CollapsibleContent>
                          <div className="px-3 pb-3 pt-0 border-t border-background">
                            {!detail ? (
                              <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
                                <Loader2 className="h-3 w-3 animate-spin" />Loading card...
                              </div>
                            ) : (
                              <div className="pt-3 space-y-2">
                                {detail.ai_summary && (
                                  <p className="text-sm text-foreground/90">{detail.ai_summary}</p>
                                )}
                                {!detail.ai_summary && detail.original_text && (
                                  <p className="text-sm text-muted-foreground line-clamp-3">{detail.original_text}</p>
                                )}
                                <div className="flex items-center gap-2 pt-1">
                                  <Badge variant={detail.approved ? "default" : "outline"}>
                                    {detail.approved ? "Approved source" : "Not approved"}
                                  </Badge>
                                  <Button
                                    size="sm"
                                    variant={detail.approved ? "outline" : "default"}
                                    disabled={cardBusy === detail.id}
                                    onClick={() => detail.approved ? unapproveCard(detail.id) : approveCard(detail.id)}
                                    className="gap-1"
                                  >
                                    {cardBusy === detail.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                                    {detail.approved ? "Unapprove" : "Approve"}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="gap-1 text-red-600 border-red-200 hover:bg-red-50"
                                    disabled={cardBusy === detail.id}
                                    onClick={() => rejectCard(row)}
                                  >
                                    <X className="h-3 w-3" />Reject
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={() => navigate(`/cards/${detail.id}`)}>
                                    Full card
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {!running && rows.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <Search className="h-10 w-10 mx-auto mb-4 opacity-30" />
            <p className="text-sm">{attemptState === "pending" ? "Search queued or running. No results yet." : attemptState === "failed" ? "Search could not return verified results." : "No search results yet."}</p>
            <p className="text-xs mt-1">{attemptState === "pending" ? "Click Search now to resume the same search, without starting a second job." : attemptState === "failed" ? "No candidates were added." : "Set a number above and hit Search now."}</p>
          </div>
        )}
      </main>
    </div>
  );
};

export default DiscoverSources;
