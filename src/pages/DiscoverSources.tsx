import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Search, Loader2, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { InstructionsToggle } from "@/components/InstructionsToggle";

// One candidate URL as it moves through the pipeline on screen:
// found -> checking (fetching + scoring via the existing
// create-manual-source + process-reference-card pipeline) -> kept (survived
// the auto-delete threshold, now a real reference card) or filtered
// (auto-deleted for scoring too low, same as any other low-scoring source).
type CandidateStatus = "checking" | "kept" | "filtered" | "failed";

interface CandidateRow {
  title: string;
  url: string;
  reason: string;
  status: CandidateStatus;
  cardId?: string;
  error?: string;
}

// The old flat cap of 30 meant a request for even 1-2 sources could still
// burn through 30 candidates if scoring was strict. The cap now scales with
// what was actually asked for — twice the requested count — so "find 3"
// tries at most 6, not 30. Still floored at a sane ceiling so a request for
// the max (15) doesn't run away either.
const MAX_ROUNDS = 3;
const candidateCap = (targetCount: number) => Math.min(targetCount * 2, 15);

const DiscoverSources = () => {
  const navigate = useNavigate();
  const [targetCount, setTargetCount] = useState<number>(5);
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<CandidateRow[]>([]);
  const [defaultQuestionSetId, setDefaultQuestionSetId] = useState<string>("");
  const [existingUrls, setExistingUrls] = useState<Set<string>>(new Set());

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/auth"); return; }

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
    };
    init();
  }, [navigate]);

  const upsertRow = (url: string, patch: Partial<CandidateRow>) => {
    setRows((prev) => prev.map((r) => (r.url === url ? { ...r, ...patch } : r)));
  };

  const runDiscovery = async () => {
    setRunning(true);
    setRows([]);

    const seenUrls = new Set<string>(existingUrls);
    let kept = 0;
    let round = 0;
    let totalTried = 0;
    const maxCandidates = candidateCap(targetCount);

    try {
      while (kept < targetCount && round < MAX_ROUNDS && totalTried < maxCandidates) {
        round++;
        const { data, error } = await supabase.functions.invoke("search-sources", {
          body: { targetCount: targetCount - kept, excludeUrls: Array.from(seenUrls) },
        });

        if (error) {
          toast.error("Search failed: " + error.message);
          break;
        }
        if (data?.error) {
          toast.error(data.error);
          break;
        }

        const candidates: { title: string; url: string; reason: string }[] = data?.candidates || [];
        if (!candidates.length) break; // nothing more to try this round

        for (const c of candidates) {
          if (kept >= targetCount || totalTried >= maxCandidates) break;
          if (seenUrls.has(c.url)) continue; // dedupe against existing cards + already-tried this run
          seenUrls.add(c.url);
          totalTried++;

          setRows((prev) => [...prev, { ...c, status: "checking" }]);

          const { data: createData, error: createError } = await supabase.functions.invoke("create-manual-source", {
            body: {
              type: "url",
              url: c.url,
              question_set_id: defaultQuestionSetId || undefined,
              from_company: false,
            },
          });

          if (createError || createData?.error) {
            upsertRow(c.url, { status: "failed", error: createError?.message || createData?.error });
            continue;
          }

          const cardId = createData?.cardId;
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
            kept++;
            upsertRow(c.url, { status: "kept", cardId });
          } else if (stillThere) {
            upsertRow(c.url, { status: "failed", cardId, error: "Created but never scored — likely hit an AI rate limit. Use \"Process with AI\" on the card to retry." });
          } else {
            upsertRow(c.url, { status: "filtered" });
          }

          // A short pause between candidates. Each one triggers two AI
          // calls back-to-back (summary+answers, then relevance scoring);
          // firing the next candidate immediately after is exactly what
          // produced a burst of provider rate-limit failures in testing.
          await new Promise((r) => setTimeout(r, 600));
        }
      }
    } finally {
      setRunning(false);
    }

    if (kept === 0) {
      toast.error("Found candidates but none scored well enough to keep — try again, or check Reference Cards Settings for how strict your threshold is.");
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
- Anything that doesn't score well enough is dropped automatically. You only ever see what's kept.
- If not enough candidates clear the bar, it searches again for more, up to a few rounds, so you get close to what you asked for without needing to babysit it
- Kept cards land in Reference Cards exactly like any other source — approve them from there before they can be cited`}
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
          </CardContent>
        </Card>

        {rows.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Results {running ? "(in progress...)" : `— ${keptCount} kept of ${rows.length} checked`}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {rows.map((row) => (
                <div key={row.url} className="flex items-center justify-between gap-3 p-3 bg-muted/40 rounded-md">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <a
                        href={row.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium truncate hover:underline flex items-center gap-1"
                      >
                        {row.title || row.url}
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    </div>
                    {row.reason && <p className="text-xs text-muted-foreground mt-0.5 truncate">{row.reason}</p>}
                    {row.error && <p className="text-xs text-destructive mt-0.5">{row.error}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {statusBadge(row)}
                    {(row.status === "kept" || row.status === "failed") && row.cardId && (
                      <Button size="sm" variant="outline" onClick={() => navigate(`/cards/${row.cardId}`)}>
                        View
                      </Button>
                    )}
                  </div>
                </div>
              ))}
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
