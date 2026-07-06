import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
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
type CandidateStatus = "checking" | "kept" | "filtered" | "failed" | "removed";

interface CandidateRow {
  title: string;
  url: string;
  reason: string;
  status: CandidateStatus;
  cardId?: string;
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

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/auth"); return; }
      userIdRef.current = session.user.id;

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
        const savedRows = (s.rows as CandidateRow[]) || [];
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

  const checkOneCandidate = async (c: { title: string; url: string; reason: string }, forceKeep: boolean) => {
    const { data: createData, error: createError } = await supabase.functions.invoke("create-manual-source", {
      body: {
        type: "url",
        url: c.url,
        question_set_id: defaultQuestionSetId || undefined,
        from_company: false,
        force_keep: forceKeep,
      },
    });

    if (createError || createData?.error) {
      return { status: "failed" as const, error: createError?.message || createData?.error };
    }

    const cardId = createData?.cardId;
    if (forceKeep) {
      // We told the pipeline to bypass the threshold, so if the insert
      // succeeded the card is definitely still there.
      return { status: "kept" as const, cardId };
    }

    // create-manual-source already awaits process-reference-card
    // internally, so by the time it returns the card has either a
    // real score (survived or was auto-deleted by the threshold
    // trigger) or, if that internal call itself failed (e.g. the AI
    // provider's own rate limit under back-to-back calls), the row
    // still exists but with global_relevance_score left null — never
    // actually judged. Checking existence alone can't tell those
    // apart, so the score itself is the real signal: null means
    // "failed to process," not "passed."
    const { data: stillThere } = await supabase
      .from("reference_cards")
      .select("id, global_relevance_score")
      .eq("id", cardId)
      .maybeSingle();

    if (stillThere && stillThere.global_relevance_score !== null) {
      return { status: "kept" as const, cardId };
    } else if (stillThere) {
      return {
        status: "failed" as const,
        cardId,
        error: "Created but never scored — likely hit an AI rate limit. Use \"Process with AI\" on the card to retry.",
      };
    }
    return { status: "filtered" as const };
  };

  const retryRow = async (row: CandidateRow) => {
    setBusyUrl(row.url);
    upsertRow(row.url, { status: "checking", error: undefined }, running);
    try {
      const result = await checkOneCandidate(row, false);
      upsertRow(row.url, { ...result }, running);
      if (result.status === "kept") toast.success("Kept after retry.");
      else if (result.status === "failed") toast.error("Retry failed again: " + (result.error || "unknown error"));
      else toast.info("Retried — scored too low again.");
    } finally {
      setBusyUrl(null);
    }
  };

  const keepAnyway = async (row: CandidateRow) => {
    setBusyUrl(row.url);
    upsertRow(row.url, { status: "checking", error: undefined }, running);
    try {
      // The original card was already deleted by the auto-delete trigger
      // the moment it scored too low, so this recreates it — this time
      // with force_keep set, which tells that same trigger to leave it
      // alone regardless of score.
      const result = await checkOneCandidate(row, true);
      upsertRow(row.url, { ...result }, running);
      if (result.status === "kept") {
        toast.success("Kept — this source now bypasses the score threshold.", {
          description: "Head to Reference Cards to review and approve it.",
        });
      } else {
        toast.error("Couldn't recreate this source: " + (result.error || "unknown error"));
      }
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
    let totalTried = 0;
    const maxCandidates = candidateCap(targetCount);

    try {
      // Phase model: search for exactly the number still needed, pause,
      // then score that whole batch one at a time before ever searching
      // again. No overlap between "finding candidates" and "vetting
      // candidates" — each batch fully finishes one phase before the next
      // starts, and a new search round only happens if the batch just
      // scored didn't produce enough keepers.
      while (kept < targetCount && round < MAX_ROUNDS && totalTried < maxCandidates) {
        round++;
        const stillNeeded = targetCount - kept;

        const { data, error } = await supabase.functions.invoke("search-sources", {
          body: { targetCount: stillNeeded, excludeUrls: Array.from(seenUrls) },
        });

        if (error) {
          // supabase-js's default error.message for a failed function call
          // is a generic "Edge Function returned a non-2xx status code" —
          // it doesn't surface the actual JSON body search-sources sent
          // back (e.g. the real Anthropic API error). Pull the real reason
          // out of the response context when it's available so failures
          // are actually diagnosable instead of a dead end.
          let detail = error.message;
          try {
            const body = await error.context?.json?.();
            if (body?.error) detail = body.error;
          } catch {
            // context wasn't readable JSON — fall back to the generic message
          }
          toast.error("Search failed: " + detail);
          break;
        }
        if (data?.error) {
          toast.error(data.error);
          break;
        }

        const candidates: { title: string; url: string; reason: string }[] = (data?.candidates || [])
          .filter((c: any) => !seenUrls.has(c.url));
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

          const result = await checkOneCandidate(c, false);
          if (result.status === "kept") kept++;
          upsertRow(c.url, { ...result }, true);

          // Paced, not rushed: each candidate fires two AI calls back-to-back
          // (summary+answers, then relevance scoring). This pause between
          // candidates is what keeps the scoring phase from looking like
          // everything happening on top of itself, and gives the provider's
          // own rate limit real breathing room.
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
            completed_at: completedAt,
            last_target: targetCount,
            last_kept: kept,
            last_checked: totalTried,
          },
          { onConflict: "user_id" }
        );
      }
      setLastRun({ completedAt, target: targetCount, kept, checked: totalTried });
    }

    if (kept === 0 && totalTried === 0) {
      toast.error("No candidates found — try again in a moment, or check that your Strategy/Audience pages have enough context to search against.");
    } else if (kept === 0) {
      toast.error(`Checked ${totalTried} candidate${totalTried === 1 ? "" : "s"} but kept none — see the results below for why (scored too low, or never got scored). Try again, or check Reference Cards Settings for how strict your threshold is.`);
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
        return <Badge variant="secondary" className="gap-1"><XCircle className="h-3 w-3" />Scored too low</Badge>;
      case "removed":
        return <Badge variant="outline" className="gap-1 text-muted-foreground"><Trash2 className="h-3 w-3" />Removed</Badge>;
      case "failed":
        return row.cardId
          ? <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />Never scored</Badge>
          : <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />Couldn't fetch</Badge>;
    }
  };

  const keptCount = rows.filter((r) => r.status === "kept").length;

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
- It searches the live web (via your existing Anthropic key's built-in web search — no separate account needed) using your Strategy and Audience pages as the brief
- Every candidate gets fetched and scored through the exact same pipeline as any other source — the same relevance scorer, the same auto-delete threshold you set in Reference Cards' Settings
- Anything that doesn't score well enough is dropped automatically, but the row stays in this list — use "Keep anyway" on a "Scored too low" row to override that and keep it regardless
- If a candidate couldn't be fetched or never got scored, use "Retry" on that row to try it again without re-running the whole search
- Click a "Kept" row to expand it — read the summary and Approve or Remove it right here, no need to leave this page
- If not enough candidates clear the bar, it searches again for more, up to a few rounds, so you get close to what you asked for without needing to babysit it
- Results stay here across navigation until you hit "Clear results" — come back anytime to review or override what was found
- Kept cards land in Reference Cards exactly like any other source — approve them from there, or right here, before they can be cited`}
        />

        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="h-4 w-4" />Find new sources
            </CardTitle>
            <CardDescription>
              Searches for real, live sources matching your Strategy and Audience pages, and only keeps the ones that score well.
            </CardDescription>
          </CardHeader>
          <CardContent>
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
              <Button onClick={runDiscovery} disabled={running} className="ml-auto">
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
                Results {running ? "(in progress...)" : `— ${keptCount} kept of ${rows.length} checked`}
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
                        {row.reason && <p className="text-xs text-muted-foreground mt-0.5 truncate">{row.reason}</p>}
                        {row.error && <p className="text-xs text-destructive mt-0.5">{row.error}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                        {statusBadge(row)}
                        {row.status === "failed" && row.cardId && (
                          <Button size="sm" variant="outline" onClick={() => navigate(`/cards/${row.cardId}`)}>
                            View
                          </Button>
                        )}
                        {row.status === "failed" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1"
                            disabled={busyUrl === row.url || running}
                            onClick={() => retryRow(row)}
                          >
                            {busyUrl === row.url ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                            Retry
                          </Button>
                        )}
                        {row.status === "filtered" && (
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
            <p className="text-sm">No searches run yet.</p>
            <p className="text-xs mt-1">Set a number above and hit Search now.</p>
          </div>
        )}
      </main>
    </div>
  );
};

export default DiscoverSources;
