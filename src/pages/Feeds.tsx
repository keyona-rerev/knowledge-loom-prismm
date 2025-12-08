import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Copy,
  CheckCircle,
  Settings,
} from "lucide-react";
import { InstructionsToggle } from "@/components/InstructionsToggle";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { parsePDF } from "@/lib/pdf-parser";

const Feeds = () => {
  const navigate = useNavigate();
  const [feeds, setFeeds] = useState<any[]>([]);
  const [selectedQuestionSet, setSelectedQuestionSet] = useState("default");

  const [manualSourceDialogOpen, setManualSourceDialogOpen] = useState(false);
  const [manualSourceType, setManualSourceType] = useState<"url" | "pdf">("url");
  const [manualUrl, setManualUrl] = useState("");
  const [manualPdfFile, setManualPdfFile] = useState<File | null>(null);
  const [creatingManualSource, setCreatingManualSource] = useState(false);

  const [activeTab, setActiveTab] = useState<"newsletter" | "manual">("newsletter");
  const [expandedFeeds, setExpandedFeeds] = useState<Set<string>>(new Set());
  const [refCardsByFeed, setRefCardsByFeed] = useState<Record<string, any[]>>({});
  const [loadingRefs, setLoadingRefs] = useState(false);
  const [questionSets, setQuestionSets] = useState<any[]>([]);

  // Newsletter inbox state
  const [newsletterDomain, setNewsletterDomain] = useState<string | null>(null);
  const [userNewsletterEmail, setUserNewsletterEmail] = useState<string | null>(null);
  const [loadingNewsletter, setLoadingNewsletter] = useState(true);
  const [copied, setCopied] = useState(false);

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

  const loadNewsletterConfig = async () => {
    setLoadingNewsletter(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setLoadingNewsletter(false);
      return;
    }

    // Load profile to get newsletter_domain
    const { data: profile } = await supabase
      .from("profiles")
      .select("newsletter_domain")
      .eq("user_id", session.user.id)
      .single();

    const domain = profile?.newsletter_domain || null;
    setNewsletterDomain(domain);

    if (!domain) {
      setLoadingNewsletter(false);
      return;
    }

    // Check if user already has a newsletter email
    const { data: existingEmail } = await supabase
      .from("user_newsletter_emails")
      .select("email_address")
      .eq("user_id", session.user.id)
      .eq("is_active", true)
      .single();

    if (existingEmail) {
      setUserNewsletterEmail(existingEmail.email_address);
    } else {
      // Generate a new email with crypto-secure random prefix
      const prefix = `user-${crypto.randomUUID().slice(0, 12)}`;
      const email = `${prefix}@${domain}`;

      // Save to database
      const { error: insertError } = await supabase
        .from("user_newsletter_emails")
        .insert({
          user_id: session.user.id,
          email_address: email,
          email_prefix: prefix,
          is_active: true,
        });

      if (insertError) {
        console.error("Failed to save newsletter email:", insertError);
        toast.error("Failed to generate newsletter email");
      } else {
        setUserNewsletterEmail(email);
      }
    }

    setLoadingNewsletter(false);
  };

  useEffect(() => {
    loadFeeds();
    loadQuestionSets();
    loadNewsletterConfig();
  }, [navigate]);

  const deleteFeed = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete "${name}"? This action cannot be undone.`)) {
      return;
    }

    const { error } = await supabase.from("source_feeds").delete().eq("id", id);

    if (error) {
      toast.error("Failed to delete feed");
    } else {
      toast.success("Feed deleted");
      loadFeeds();
    }
  };

  const toggleFeedExpanded = (id: string) => {
    setExpandedFeeds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const createManualSource = async () => {
    if (manualSourceType === "url" && !manualUrl.trim()) {
      toast.error("Please enter a URL");
      return;
    }
    if (manualSourceType === "pdf" && !manualPdfFile) {
      toast.error("Please select a PDF file");
      return;
    }

    setCreatingManualSource(true);
    console.log("🟡 Starting manual source creation...");
    const toastId = toast.loading(
      manualSourceType === "pdf" 
        ? "Parsing PDF and creating reference card..." 
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
        console.log("📄 Parsing PDF...");
        toast.loading("Extracting text from PDF...", { id: toastId });
        
        try {
          const parseResult = await parsePDF(manualPdfFile);
          pdfText = parseResult.text;
          pdfTitle = parseResult.title;
          
          if (!pdfText || pdfText.length < 50) {
            toast.error("Could not extract sufficient text from PDF. The file may be image-based or protected.", { id: toastId });
            return;
          }
          
          console.log(`✅ PDF parsed: ${parseResult.pageCount} pages, ${pdfText.length} characters`);
          toast.loading("Creating reference card...", { id: toastId });
        } catch (parseError) {
          console.error("❌ PDF parse error:", parseError);
          toast.error(parseError instanceof Error ? parseError.message : "Failed to parse PDF file", { id: toastId });
          return;
        }
      }

      console.log("📤 Calling edge function with:", {
        type: manualSourceType,
        url: manualUrl,
        user_id: session.user.id,
        question_set_id: selectedQuestionSet,
        has_pdf_content: !!pdfText
      });

      const { data, error } = await supabase.functions.invoke("create-manual-source", {
        body: {
          type: manualSourceType,
          url: manualSourceType === "url" ? manualUrl : undefined,
          pdf_text: manualSourceType === "pdf" ? pdfText : undefined,
          pdf_title: manualSourceType === "pdf" ? pdfTitle : undefined,
          user_id: session.user.id,
          question_set_id: selectedQuestionSet,
        },
      });

      console.log("📥 Edge function response:", { data, error });

      if (error) {
        console.error("❌ Edge function error:", error);
        toast.error("Failed to create source: " + error.message, { id: toastId });
      } else {
        console.log("✅ Manual source created successfully:", data);
        toast.success("Reference card created and processing!", { id: toastId });
        setManualSourceDialogOpen(false);
        setManualUrl("");
        setManualPdfFile(null);
        setTimeout(() => {
          loadFeeds();
          navigate("/cards");
        }, 1500);
      }
    } catch (error: any) {
      console.error("💥 Unexpected error:", error);
      toast.error("Unexpected error: " + error.message, { id: toastId });
    } finally {
      setCreatingManualSource(false);
    }
  };

  const copyEmailToClipboard = async () => {
    if (!userNewsletterEmail) return;
    try {
      await navigator.clipboard.writeText(userNewsletterEmail);
      setCopied(true);
      toast.success("Email copied to clipboard!");
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error("Failed to copy email");
    }
  };

  const manualSources = feeds.filter((f) => f.feed_type === "manual");

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <Button variant="ghost" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
          <Dialog open={manualSourceDialogOpen} onOpenChange={setManualSourceDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Plus className="mr-2 h-4 w-4" />
                Manual Source
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Manual Source</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex gap-2">
                  <Button
                    variant={manualSourceType === "url" ? "default" : "outline"}
                    onClick={() => setManualSourceType("url")}
                  >
                    <LinkIcon className="mr-2 h-4 w-4" />
                    Article URL
                  </Button>
                  <Button
                    variant={manualSourceType === "pdf" ? "default" : "outline"}
                    onClick={() => setManualSourceType("pdf")}
                  >
                    <FileUp className="mr-2 h-4 w-4" />
                    Upload PDF
                  </Button>
                </div>

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

                <div className="space-y-2">
                  <Label>Question Set</Label>
                  <Select value={selectedQuestionSet} onValueChange={setSelectedQuestionSet}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select question set" />
                    </SelectTrigger>
                    <SelectContent>
                      {questionSets.map((set) => (
                        <SelectItem key={set.id} value={set.id}>
                          {set.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-sm text-muted-foreground">
                    Choose which questions to use for content from this source
                  </p>
                </div>

                {manualSourceType === "pdf" && (
                  <div className="space-y-2">
                    <Label>Upload PDF</Label>
                    <Input
                      type="file"
                      accept=".pdf"
                      onChange={(e) => setManualPdfFile(e.target.files?.[0] || null)}
                    />
                    <p className="text-sm text-muted-foreground">
                      Upload a PDF document to extract content and create a reference card
                    </p>
                  </div>
                )}

                <Button
                  onClick={createManualSource}
                  className="w-full"
                  disabled={creatingManualSource}
                >
                  {creatingManualSource ? (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create Reference Card"
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-4">🚀 Content Sources</h1>

        <InstructionsToggle
          instructions={`Content Sources helps you bring content into Insight Forge:

1. Newsletter Inbox: Subscribe to any newsletter using your unique email address
2. Manual Sources: Paste article links or upload PDFs directly

Reference cards are created from your sources and can be used for content generation.`}
        />

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "newsletter" | "manual")}>
          <TabsList className="mb-4">
            <TabsTrigger value="newsletter">
              <Mail className="h-4 w-4 mr-2" />
              Newsletter Inbox
            </TabsTrigger>
            <TabsTrigger value="manual">Manual Sources</TabsTrigger>
          </TabsList>

          <TabsContent value="newsletter">
            {loadingNewsletter ? (
              <Card>
                <CardContent className="py-8 text-center">
                  <RefreshCw className="h-8 w-8 mx-auto animate-spin text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Loading newsletter configuration...</p>
                </CardContent>
              </Card>
            ) : !newsletterDomain ? (
              <Card>
                <CardContent className="py-8 text-center">
                  <Mail className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">Newsletter Inbox Not Configured</h3>
                  <p className="text-muted-foreground mb-4 max-w-md mx-auto">
                    Set up your newsletter domain in Settings to enable automatic newsletter capture. 
                    Once configured, you'll get a unique email address to subscribe to any newsletter.
                  </p>
                  <Button onClick={() => navigate("/settings")}>
                    <Settings className="mr-2 h-4 w-4" />
                    Go to Settings
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Your Personal Newsletter Inbox</CardTitle>
                    <CardDescription>
                      Subscribe to <strong>any newsletter</strong> using the email below. 
                      Articles will automatically become reference cards.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center gap-2 p-4 bg-muted rounded-lg">
                      <code className="flex-1 text-lg font-mono break-all">{userNewsletterEmail}</code>
                      <Button onClick={copyEmailToClipboard} variant="outline" size="sm">
                        {copied ? (
                          <>
                            <CheckCircle className="h-4 w-4 mr-2 text-green-500" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-4 w-4 mr-2" />
                            Copy
                          </>
                        )}
                      </Button>
                    </div>

                    <div className="grid gap-2 text-sm">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-green-500" />
                        <span>Works with any newsletter (NY Times, Substack, Morning Brew, etc.)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-green-500" />
                        <span>Articles appear automatically as reference cards</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-green-500" />
                        <span>AI analyzes content and extracts insights</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-green-500" />
                        <span>Rate limited to 50 emails/hour for protection</span>
                      </div>
                    </div>

                    <Alert>
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        <strong>Privacy Note:</strong> This email is unique to your account. 
                        Only use it for newsletters you trust. Content is processed and stored in your account.
                      </AlertDescription>
                    </Alert>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          <TabsContent value="manual">
            <div className="grid gap-4">
              {manualSources.length === 0 && (
                <Card>
                  <CardContent className="py-8 text-center">
                    <FileUp className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-semibold mb-2">No Manual Sources Yet</h3>
                    <p className="text-muted-foreground mb-4">
                      Add articles or PDFs manually to create reference cards.
                    </p>
                    <Button onClick={() => setManualSourceDialogOpen(true)}>
                      <Plus className="mr-2 h-4 w-4" />
                      Add Manual Source
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
                        <CardDescription className="mt-1">{feed.url}</CardDescription>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => deleteFeed(feed.id, feed.name)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      Added: {new Date(feed.created_at).toLocaleDateString()}
                    </p>

                    <div className="mt-3">
                      <Button variant="ghost" size="sm" onClick={() => toggleFeedExpanded(feed.id)}>
                        <ChevronDown
                          className={`h-4 w-4 mr-1 transition-transform ${expandedFeeds.has(feed.id) ? "rotate-180" : ""}`}
                        />
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
                                      const { error } = await supabase.functions.invoke("process-reference-card", {
                                        body: { cardId: rc.id }
                                      });
                                      if (error) {
                                        toast.error("Failed to process: " + error.message, { id: toastId });
                                      } else {
                                        toast.success("Card processed successfully!", { id: toastId });
                                        loadFeeds();
                                      }
                                    }}
                                  >
                                    <Sparkles className="h-3 w-3" />
                                  </Button>
                                )}
                                <Button variant="outline" size="sm" onClick={() => navigate(`/cards/${rc.id}`)}>
                                  Open
                                </Button>
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
        </Tabs>
      </main>
    </div>
  );
};

export default Feeds;
