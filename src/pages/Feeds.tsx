import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Link as LinkIcon,
  FileUp,
  RefreshCw,
  AlertTriangle,
  AlertCircle,
  ChevronDown,
  Sparkles,
  Mail,
  ExternalLink,
  ClipboardPaste,
  Rss,
  Lightbulb,
} from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InstructionsToggle } from "@/components/InstructionsToggle";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { parsePDF } from "@/lib/pdf-parser";
import { ObservationsTab } from "@/components/sources/ObservationsTab";
import { ReferenceCardsBlock } from "@/components/sources/ReferenceCardsBlock";

const VALID_TABS = ["automated", "manual", "observations"];

const Feeds = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab = VALID_TABS.includes(tabParam || "") ? tabParam! : "automated";
  const [feeds, setFeeds] = useState<any[]>([]);
  const [selectedQuestionSet, setSelectedQuestionSet] = useState("default");

  const [manualSourceDialogOpen, setManualSourceDialogOpen] = useState(false);
  const [manualSourceType, setManualSourceType] = useState<"url" | "pdf" | "paste">("url");
  const [manualUrl, setManualUrl] = useState("");
  const [manualPdfFile, setManualPdfFile] = useState<File | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [pasteTitle, setPasteTitle] = useState("");
  const [manualFromCompany, setManualFromCompany] = useState(false);
  const [creatingManualSource, setCreatingManualSource] = useState(false);

  const [expandedFeeds, setExpandedFeeds] = useState<Set<string>>(new Set());
  const [refCardsByFeed, setRefCardsByFeed] = useState<Record<string, any[]>>({});
  const [loadingRefs, setLoadingRefs] = useState(false);
  const [questionSets, setQuestionSets] = useState<any[]>([]);

  const [recentEmails, setRecentEmails] = useState<any[]>([]);
  const [loadingEmails, setLoadingEmails] = useState(false);

  // Automated reference cards (rss + newsletter) are queried directly by
  // source_type rather than through source_feeds, since newsletter-sourced
  // cards never get a source_feed_id (there's no per-newsletter feed row) -
  // grouping by feed was hiding them entirely.
  const [automatedCards, setAutomatedCards] = useState<any[]>([]);
  const [loadingAutomatedCards, setLoadingAutomatedCards] = useState(false);

  const loadReferenceCards = async (feedIds: string[]) => {
    if (!feedIds.length) return;
    setLoadingRefs(true);
    const { data, error } = await supabase
      .from("reference_cards")
      .select("id,title,content_quality,content_warning,ai_summary,created_at,source_feed_id")
      .in("source_feed_id", feedIds);
    setLoadingRefs(false);
    if (error) {
      console.error("Failed to load reference cards by feed:", error);
      return;
    }
    const grouped: Record<string, any[]> = {};
    (data || []).forEach((c: any) => {
      if (!grouped[c.source_feed_id]) grouped[c.source_feed_id] = [];
      grouped[c.source_feed_id].push(c);
    });
    setRefCardsByFeed(grouped);
  };

  const loadFeeds = async () => {
    const { data, error } = await supabase.from("source_feeds").select("*").order("created_at", { ascending: false });
    if (error) {
      toast.error("Failed to load feeds");
    } else {
      setFeeds(data || []);
      const ids = (data || []).map((f: any) => f.id);
      await loadReferenceCards(ids);
    }
  };

  const loadQuestionSets = async () => {
    const { data, error } = await supabase
      .from("question_sets")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      console.error("Failed to load question sets:", error);
    } else {
      setQuestionSets(data || []);
      if (data && data.length > 0) {
        setSelectedQuestionSet(data[0].id);
      }
    }
  };

  const loadRecentEmails = async () => {
    setLoadingEmails(true);
    const { data, error } = await supabase
      .from("newsletter_emails")
      .select("id, subject, from_address, received_at, processing_status, reference_card_id")
      .order("received_at", { ascending: false })
      .limit(10);
    if (error) { console.error("Failed to load recent emails:", error); }
    else { setRecentEmails(data || []); }
    setLoadingEmails(false);
  };

  const loadAutomatedCards = async () => {
    setLoadingAutomatedCards(true);
    const { data, error } = await supabase
      .from("reference_cards")
      .select("id,title,content_quality,content_warning,ai_summary,status,source_type,created_at")
      .in("source_type", ["rss", "newsletter"])
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) { console.error("Failed to load automated reference cards:", error); }
    else { setAutomatedCards(data || []); }
    setLoadingAutomatedCards(false);
  };

  useEffect(() => {
    loadFeeds();
    loadQuestionSets();
    loadRecentEmails();
    loadAutomatedCards();
  }, [navigate]);

  const deleteFeed = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete "${name}"? This action cannot be undone.`)) return;
    const { error } = await supabase.from("source_feeds").delete().eq("id", id);
    if (error) { toast.error("Failed to delete feed"); }
    else { toast.success("Feed deleted"); loadFeeds(); }
  };

  const toggleFeedExpanded = (id: string) => {
    setExpandedFeeds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const resetDialog = () => {
    setManualUrl("");
    setManualPdfFile(null);
    setPasteText("");
    setPasteTitle("");
    setManualFromCompany(false);
    setManualSourceType("url");
  };

  const createManualSource = async () => {
    if (manualSourceType === "url" && !manualUrl.trim()) {
      toast.error("Please enter a URL"); return;
    }
    if (manualSourceType === "pdf" && !manualPdfFile) {
      toast.error("Please select a PDF file"); return;
    }
    if (manualSourceType === "paste" && !pasteText.trim()) {
      toast.error("Please paste some text"); return;
    }

    setCreatingManualSource(true);
    const toastId = toast.loading(
      manualSourceType === "pdf"
        ? "Parsing PDF and creating reference card..."
        : manualSourceType === "paste"
          ? "Creating reference card from pasted text..."
          : "Creating reference card from source..."
    );

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("You must be logged in to create sources", { id: toastId });
        setCreatingManualSource(false);
        return;
      }

      let pdfText = "";
      let pdfTitle = "";

      if (manualSourceType === "pdf" && manualPdfFile) {
        toast.loading("Extracting text from PDF...", { id: toastId });
        try {
          const parseResult = await parsePDF(manualPdfFile);
          pdfText = parseResult.text;
          pdfTitle = parseResult.title;
          if (!pdfText || pdfText.length < 50) {
            toast.error("Could not extract sufficient text from PDF. The file may be image-based or protected.", { id: toastId });
            return;
          }
          toast.loading("Creating reference card...", { id: toastId });
        } catch (parseError) {
          toast.error(parseError instanceof Error ? parseError.message : "Failed to parse PDF file", { id: toastId });
          return;
        }
      }

      const body: Record<string, any> = {
        type: manualSourceType,
        user_id: session.user.id,
        question_set_id: selectedQuestionSet,
        from_company: manualFromCompany,
      };

      if (manualSourceType === "url") {
        body.url = manualUrl;
      } else if (manualSourceType === "pdf") {
        body.pdf_text = pdfText;
        body.pdf_title = pdfTitle;
      } else if (manualSourceType === "paste") {
        body.paste_text = pasteText.trim();
        body.paste_title = pasteTitle.trim() || undefined;
      }

      const { data, error } = await supabase.functions.invoke("create-manual-source", { body });

      if (error) {
        toast.error("Failed to create source: " + error.message, { id: toastId });
      } else {
        toast.success("Reference card created and processing!", { id: toastId });
        setManualSourceDialogOpen(false);
        resetDialog();
        setTimeout(() => { loadFeeds(); navigate("/cards"); }, 1500);
      }
    } catch (error: any) {
      toast.error("Unexpected error: " + error.message, { id: toastId });
    } finally {
      setCreatingManualSource(false);
    }
  };

  const manualSources = feeds.filter((f) => f.feed_type === "manual");

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <Button variant="ghost" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="mr-2 h-4 w-4" />Back to Dashboard
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-4">Sources</h1>

        <InstructionsToggle
          instructions={`Sources brings everything that feeds the engine into one place:

1. Automated: Newsletters are ingested automatically via the Gmail label watcher. Reference cards appear here automatically - an AI relevance gate filters out noise before a card is ever created.
2. Manual: Paste article links, upload PDFs, or paste full article text directly
3. Observations: Capture thesis statements, hooks, and other journal entries - each one becomes a citable reference card as soon as you save it

Reference cards are created from your sources and used for content generation. Only approved reference cards are actually citable — approve them in the Reference Cards block below.`}
        />

        <ReferenceCardsBlock />

        <Tabs value={activeTab} onValueChange={(v) => setSearchParams({ tab: v })}>
          <TabsList className="mb-4">
            <TabsTrigger value="automated">
              <Rss className="h-4 w-4 mr-2" />Automated
            </TabsTrigger>
            <TabsTrigger value="manual">Manual</TabsTrigger>
            <TabsTrigger value="observations">
              <Lightbulb className="h-4 w-4 mr-2" />Observations
            </TabsTrigger>
          </TabsList>

          <TabsContent value="automated">
            <p className="text-sm text-muted-foreground mb-4">
              Newsletters are ingested automatically via the Gmail label watcher — no setup needed here.
            </p>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-lg">Recent Incoming Emails</CardTitle>
                    <CardDescription>Emails received and processed into reference cards</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={loadRecentEmails} disabled={loadingEmails}>
                    <RefreshCw className={`h-3.5 w-3.5 mr-2 ${loadingEmails ? "animate-spin" : ""}`} />Refresh
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {loadingEmails ? (
                  <div className="flex items-center justify-center py-4">
                    <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : recentEmails.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground">
                    <Mail className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No emails received yet.</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Subject</TableHead>
                        <TableHead>From</TableHead>
                        <TableHead>Received</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recentEmails.map((email) => (
                        <TableRow key={email.id}>
                          <TableCell className="font-medium max-w-[200px] truncate">{email.subject || "No subject"}</TableCell>
                          <TableCell className="text-muted-foreground max-w-[150px] truncate">{email.from_address || "Unknown"}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">{email.received_at ? new Date(email.received_at).toLocaleDateString() : "-"}</TableCell>
                          <TableCell>
                            <Badge variant={email.processing_status === "success" ? "default" : "secondary"} className={email.processing_status === "success" ? "bg-green-500/10 text-green-600 border-green-500/20" : ""}>
                              {(email.processing_status || "pending").replace(/_/g, " ")}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {email.reference_card_id && (
                              <Button variant="ghost" size="sm" onClick={() => navigate(`/cards/${email.reference_card_id}`)}>
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card className="mt-4">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-lg">Reference Cards</CardTitle>
                    <CardDescription>Cards created from ingested newsletters</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={loadAutomatedCards} disabled={loadingAutomatedCards}>
                    <RefreshCw className={`h-3.5 w-3.5 mr-2 ${loadingAutomatedCards ? "animate-spin" : ""}`} />Refresh
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {loadingAutomatedCards ? (
                  <div className="flex items-center justify-center py-4">
                    <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : automatedCards.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground">
                    <Rss className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No automated reference cards yet.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {automatedCards.map((rc: any) => (
                      <div key={rc.id} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          {rc.content_quality === "error" ? (
                            <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                          ) : rc.content_quality === "partial" || rc.content_quality === "title_only" ? (
                            <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                          ) : rc.source_type === "newsletter" ? (
                            <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                          ) : (
                            <Rss className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                          <span className="text-sm truncate">{rc.title || "Untitled"}</span>
                          <Badge variant="outline" className="text-xs shrink-0">{rc.source_type}</Badge>
                          <Badge variant="outline" className="text-xs shrink-0">{rc.status}</Badge>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          {(rc.status === "needs_review" || rc.content_quality === "error") && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={async () => {
                                const toastId = toast.loading("Processing with AI...");
                                const { error } = await supabase.functions.invoke("process-reference-card", { body: { cardId: rc.id } });
                                if (error) { toast.error("Failed to process: " + error.message, { id: toastId }); }
                                else { toast.success("Card processed successfully!", { id: toastId }); loadAutomatedCards(); }
                              }}
                            >
                              <Sparkles className="h-3 w-3" />
                            </Button>
                          )}
                          <Button variant="outline" size="sm" onClick={() => navigate(`/cards/${rc.id}`)}>Open</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="manual">
            <div className="mb-6">
              <h2 className="text-xl font-semibold mb-3">Manual Sources</h2>
              <Dialog open={manualSourceDialogOpen} onOpenChange={(open) => { setManualSourceDialogOpen(open); if (!open) resetDialog(); }}>
                <DialogTrigger asChild>
                  <Button variant="outline"><Plus className="mr-2 h-4 w-4" />Manual Sources</Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Create Manual Source</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    {/* Source type selector */}
                    <div className="flex gap-2">
                      <Button
                        variant={manualSourceType === "url" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setManualSourceType("url")}
                      >
                        <LinkIcon className="mr-2 h-4 w-4" />Article URL
                      </Button>
                      <Button
                        variant={manualSourceType === "pdf" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setManualSourceType("pdf")}
                      >
                        <FileUp className="mr-2 h-4 w-4" />Upload PDF
                      </Button>
                      <Button
                        variant={manualSourceType === "paste" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setManualSourceType("paste")}
                      >
                        <ClipboardPaste className="mr-2 h-4 w-4" />Paste text
                      </Button>
                    </div>

                    {/* URL input */}
                    {manualSourceType === "url" && (
                      <div className="space-y-2">
                        <Label>Article URL</Label>
                        <Input
                          placeholder="https://example.com/article"
                          value={manualUrl}
                          onChange={(e) => setManualUrl(e.target.value)}
                        />
                      </div>
                    )}

                    {/* PDF upload */}
                    {manualSourceType === "pdf" && (
                      <div className="space-y-2">
                        <Label>Upload PDF</Label>
                        <Input
                          type="file"
                          accept=".pdf"
                          onChange={(e) => setManualPdfFile(e.target.files?.[0] || null)}
                        />
                        <p className="text-xs text-muted-foreground">
                          Upload a PDF to extract its content and create a reference card.
                        </p>
                      </div>
                    )}

                    {/* Paste text */}
                    {manualSourceType === "paste" && (
                      <div className="space-y-3">
                        <div className="space-y-2">
                          <Label>Title <span className="text-muted-foreground font-normal">(optional)</span></Label>
                          <Input
                            placeholder="Article title or headline..."
                            value={pasteTitle}
                            onChange={(e) => setPasteTitle(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Article text</Label>
                          <Textarea
                            placeholder="Paste the full article text here..."
                            value={pasteText}
                            onChange={(e) => setPasteText(e.target.value)}
                            rows={10}
                            className="resize-y font-mono text-sm"
                          />
                          <p className="text-xs text-muted-foreground">
                            {pasteText.length > 0
                              ? `${pasteText.length.toLocaleString()} characters · ${Math.round(pasteText.split(/\s+/).filter(Boolean).length)} words`
                              : "Copy the full article text from your browser and paste it here."}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Question set */}
                    <div className="space-y-2">
                      <Label>Question Set</Label>
                      <Select value={selectedQuestionSet} onValueChange={setSelectedQuestionSet}>
                        <SelectTrigger><SelectValue placeholder="Select question set" /></SelectTrigger>
                        <SelectContent>
                          {questionSets.map((set) => (
                            <SelectItem key={set.id} value={set.id}>{set.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Choose which questions to run against this source.
                      </p>
                    </div>

                    {/* From company toggle */}
                    <div className="flex items-center justify-between rounded-lg border p-3">
                      <div className="space-y-0.5 pr-3">
                        <Label>From the company (first-party)</Label>
                        <p className="text-sm text-muted-foreground">
                          Mark this as Prismm's own material so the writer can weight and anchor on it.
                        </p>
                      </div>
                      <Switch checked={manualFromCompany} onCheckedChange={setManualFromCompany} />
                    </div>

                    <Button onClick={createManualSource} className="w-full" disabled={creatingManualSource}>
                      {creatingManualSource
                        ? <><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Creating...</>
                        : "Create Reference Card"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            <div className="grid gap-4">
              {manualSources.length === 0 && (
                <Card>
                  <CardContent className="py-8 text-center">
                    <FileUp className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-semibold mb-2">No Manual Sources Yet</h3>
                    <p className="text-muted-foreground mb-4">Add articles by URL, PDF, or pasted text.</p>
                    <Button onClick={() => setManualSourceDialogOpen(true)}>
                      <Plus className="mr-2 h-4 w-4" />Add Manual Source
                    </Button>
                  </CardContent>
                </Card>
              )}
              {manualSources.map((feed) => (
                <Card key={feed.id}>
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <CardTitle>{feed.name}</CardTitle>
                        <CardDescription className="mt-1">{feed.url || "Pasted or uploaded content"}</CardDescription>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => deleteFeed(feed.id, feed.name)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">Added: {new Date(feed.created_at).toLocaleDateString()}</p>
                    <div className="mt-3">
                      <Button variant="ghost" size="sm" onClick={() => toggleFeedExpanded(feed.id)}>
                        <ChevronDown className={`h-4 w-4 mr-1 transition-transform ${expandedFeeds.has(feed.id) ? "rotate-180" : ""}`} />
                        Reference Cards ({refCardsByFeed[feed.id]?.length ?? 0})
                      </Button>
                      {expandedFeeds.has(feed.id) && (
                        <div className="mt-3 space-y-2">
                          {(refCardsByFeed[feed.id] ?? []).map((rc: any) => (
                            <div key={rc.id} className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 flex-1">
                                {rc.content_quality === "error" ? (
                                  <AlertTriangle className="h-4 w-4 text-destructive" />
                                ) : rc.content_quality === "partial" || rc.content_quality === "title_only" ? (
                                  <AlertCircle className="h-4 w-4 text-amber-500" />
                                ) : (
                                  <Badge variant="outline">Good</Badge>
                                )}
                                <span className="text-sm truncate">{rc.title || "Untitled"}</span>
                                <Badge variant="outline" className="text-xs">{rc.status}</Badge>
                              </div>
                              <div className="flex gap-1">
                                {(rc.status === "needs_review" || rc.content_quality === "error") && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={async () => {
                                      const toastId = toast.loading("Processing with AI...");
                                      const { error } = await supabase.functions.invoke("process-reference-card", { body: { cardId: rc.id } });
                                      if (error) { toast.error("Failed to process: " + error.message, { id: toastId }); }
                                      else { toast.success("Card processed successfully!", { id: toastId }); loadFeeds(); }
                                    }}
                                  >
                                    <Sparkles className="h-3 w-3" />
                                  </Button>
                                )}
                                <Button variant="outline" size="sm" onClick={() => navigate(`/cards/${rc.id}`)}>Open</Button>
                              </div>
                            </div>
                          ))}
                          {loadingRefs && <p className="text-sm text-muted-foreground">Loading reference cards...</p>}
                          {!loadingRefs && (refCardsByFeed[feed.id]?.length ?? 0) === 0 && (
                            <p className="text-sm text-muted-foreground">No reference cards yet.</p>
                          )}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="observations">
            <ObservationsTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Feeds;
