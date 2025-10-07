import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { ArrowLeft, Plus, Edit, Trash2, Play, Link as LinkIcon, FileUp, ToggleLeft, ToggleRight, RefreshCw, AlertTriangle, AlertCircle, ChevronDown } from "lucide-react";
import { InstructionsToggle } from "@/components/InstructionsToggle";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const Feeds = () => {
  const navigate = useNavigate();
  const [feeds, setFeeds] = useState<any[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingFeed, setEditingFeed] = useState<any>(null);
  const [formData, setFormData] = useState({
    name: "",
    url: "",
    credibility_score: 5,
    topic_keywords: ""
  });

  const [manualSourceDialogOpen, setManualSourceDialogOpen] = useState(false);
  const [manualSourceType, setManualSourceType] = useState<"url" | "pdf">("url");
  const [manualUrl, setManualUrl] = useState("");
  const [manualPdfFile, setManualPdfFile] = useState<File | null>(null);

  const [activeTab, setActiveTab] = useState<"rss" | "manual">("rss");
  const [expandedFeeds, setExpandedFeeds] = useState<Set<string>>(new Set());
  const [refCardsByFeed, setRefCardsByFeed] = useState<Record<string, any[]>>({});
  const [loadingRefs, setLoadingRefs] = useState(false);

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
    const { data, error } = await supabase
      .from("source_feeds")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to load feeds");
    } else {
      setFeeds(data || []);
      const ids = (data || []).map((f: any) => f.id);
      await loadReferenceCards(ids);
    }
  };

  useEffect(() => {
    loadFeeds();
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const keywords = formData.topic_keywords.split(",").map(k => k.trim()).filter(Boolean);

    if (editingFeed) {
      const { error } = await supabase
        .from("source_feeds")
        .update({
          name: formData.name,
          url: formData.url,
          credibility_score: formData.credibility_score,
          topic_keywords: keywords
        })
        .eq("id", editingFeed.id);

      if (error) {
        toast.error("Failed to update feed");
      } else {
        toast.success("Feed updated successfully");
        setIsDialogOpen(false);
        loadFeeds();
      }
    } else {
      const { data: inserted, error } = await supabase
        .from("source_feeds")
        .insert([{
          name: formData.name,
          url: formData.url,
          credibility_score: formData.credibility_score,
          topic_keywords: keywords
        }])
        .select()
        .single();

      if (error) {
        toast.error("Failed to add feed");
      } else {
        toast.success("Feed added — testing and pulling now...");
        setIsDialogOpen(false);
        if (inserted?.id) {
          await triggerFeedPull(inserted.id);
        }
        loadFeeds();
      }
    }

    setFormData({ name: "", url: "", credibility_score: 5, topic_keywords: "" });
    setEditingFeed(null);
  };

  const toggleFeed = async (feed: any) => {
    const { error } = await supabase
      .from("source_feeds")
      .update({ is_active: !feed.is_active })
      .eq("id", feed.id);

    if (error) {
      toast.error("Failed to toggle feed");
    } else {
      toast.success(feed.is_active ? "Feed disabled" : "Feed enabled");
      loadFeeds();
    }
  };

  const deleteFeed = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete "${name}"? This action cannot be undone.`)) {
      return;
    }
    
    const { error } = await supabase
      .from("source_feeds")
      .delete()
      .eq("id", id);

    if (error) {
      toast.error("Failed to delete feed");
    } else {
      toast.success("Feed deleted");
      loadFeeds();
    }
  };

  const openEditDialog = (feed: any) => {
    setEditingFeed(feed);
    setFormData({
      name: feed.name,
      url: feed.url,
      credibility_score: feed.credibility_score,
      topic_keywords: feed.topic_keywords?.join(", ") || ""
    });
    setIsDialogOpen(true);
  };

  const triggerFeedPull = async (feedId: string) => {
    toast.loading("Creating reference cards from feed...");
    
    const { error } = await supabase.functions.invoke("pull-rss-feed", {
      body: { feedId }
    });

    if (error) {
      toast.error("Failed to pull feed: " + error.message);
    } else {
      toast.success("Reference cards created successfully!");
      loadFeeds();
    }
  };

  const toggleFeedExpanded = (id: string) => {
    setExpandedFeeds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
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

    toast.loading("Creating reference card from source...");

    const { error } = await supabase.functions.invoke("create-manual-source", {
      body: {
        type: manualSourceType,
        url: manualSourceType === "url" ? manualUrl : undefined,
      }
    });

    if (error) {
      toast.error("Failed to create source: " + error.message);
    } else {
      toast.success("Reference card created!");
      setManualSourceDialogOpen(false);
      setManualUrl("");
      setManualPdfFile(null);
      loadFeeds();
    }
  };

  const rssFeeds = feeds.filter(f => f.feed_type === 'rss');
  const manualSources = feeds.filter(f => f.feed_type === 'manual');

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <Button variant="ghost" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
          <div className="flex gap-2">
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

                  {manualSourceType === "pdf" && (
                    <div className="space-y-2">
                      <Label>Upload PDF (Coming Soon)</Label>
                      <Input
                        type="file"
                        accept=".pdf"
                        onChange={(e) => setManualPdfFile(e.target.files?.[0] || null)}
                        disabled
                      />
                      <p className="text-sm text-muted-foreground">PDF upload support coming soon!</p>
                    </div>
                  )}

                  <Button onClick={createManualSource} className="w-full" disabled={manualSourceType === "pdf"}>
                    Create Reference Card
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={() => { setEditingFeed(null); setFormData({ name: "", url: "", credibility_score: 5, topic_keywords: "" }); }}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add RSS Feed
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editingFeed ? "Edit Feed" : "Add New Feed"}</DialogTitle>
                  <DialogDescription>Configure your RSS feed source</DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <Label htmlFor="name">Feed Name</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="url">Feed URL</Label>
                    <Input
                      id="url"
                      type="url"
                      value={formData.url}
                      onChange={(e) => setFormData(prev => ({ ...prev, url: e.target.value }))}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="credibility">Credibility Score (1-10)</Label>
                    <Input
                      id="credibility"
                      type="number"
                      min="1"
                      max="10"
                      value={formData.credibility_score}
                      onChange={(e) => setFormData(prev => ({ ...prev, credibility_score: parseInt(e.target.value) }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="keywords">Topic Keywords (comma-separated)</Label>
                    <Input
                      id="keywords"
                      value={formData.topic_keywords}
                      onChange={(e) => setFormData(prev => ({ ...prev, topic_keywords: e.target.value }))}
                      placeholder="AI, Technology, Healthcare"
                    />
                  </div>
                  <Button type="submit" className="w-full">
                    {editingFeed ? "Update Feed" : "Add Feed"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-4">Feed Manager</h1>

        <InstructionsToggle 
          instructions={`Feed Manager helps you bring content into Insight Forge:

1. RSS Feeds: Add RSS feed URLs to automatically pull articles
2. Manual Sources: Paste article links or upload PDFs directly
3. Toggle feeds on/off with the toggle button
4. Click "Pull Now" to manually create reference cards from a feed
5. Configure questions in Question Settings to extract insights

Reference cards are created from your sources and can be used for content generation.`}
        />

        <div className="mb-6">
          <Card>
            <CardContent className="py-4 flex flex-wrap gap-4 items-center">
              <div className="flex items-center gap-2 text-sm">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <span>Error: unable to access content</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <AlertCircle className="h-4 w-4 text-amber-500" />
                <span>Partial/Title-only content</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="outline">Good</Badge>
                <span>Full content fetched</span>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "rss" | "manual")}> 
          <TabsList className="mb-4">
            <TabsTrigger value="rss">RSS Feeds</TabsTrigger>
            <TabsTrigger value="manual">Manual Sources</TabsTrigger>
          </TabsList>

          <TabsContent value="rss">
            <div className="grid gap-4">
              {rssFeeds.map((feed) => (
                <Card key={feed.id}>
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <CardTitle>{feed.name}</CardTitle>
                        <CardDescription className="mt-1">{feed.url}</CardDescription>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" onClick={() => toggleFeed(feed)}>
                          {feed.is_active ? (
                            <ToggleRight className="h-5 w-5 text-primary" />
                          ) : (
                            <ToggleLeft className="h-5 w-5" />
                          )}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => triggerFeedPull(feed.id)} disabled={!feed.is_active}>
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => openEditDialog(feed)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => deleteFeed(feed.id, feed.name)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2 mb-3">
                      <Badge variant={feed.is_active ? "default" : "secondary"}>
                        {feed.is_active ? "Active" : "Inactive"}
                      </Badge>
                      <Badge variant="outline">Credibility: {feed.credibility_score}/10</Badge>
                      {feed.topic_keywords?.map((keyword: string) => (
                        <Badge key={keyword} variant="outline">{keyword}</Badge>
                      ))}
                    </div>
                    {feed.last_pulled_at && (
                      <p className="text-sm text-muted-foreground">
                        Last pulled: {new Date(feed.last_pulled_at).toLocaleDateString()}
                      </p>
                    )}

                    <div className="mt-3">
                      <Button variant="ghost" size="sm" onClick={() => toggleFeedExpanded(feed.id)}>
                        <ChevronDown className={`h-4 w-4 mr-1 transition-transform ${expandedFeeds.has(feed.id) ? 'rotate-180' : ''}`} />
                        Reference Cards ({refCardsByFeed[feed.id]?.length ?? 0})
                      </Button>
                      {expandedFeeds.has(feed.id) && (
                        <div className="mt-3 space-y-2">
                          {(refCardsByFeed[feed.id] ?? []).map((rc: any) => (
                            <div key={rc.id} className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                {rc.content_quality === 'error' ? (
                                  <AlertTriangle className="h-4 w-4 text-destructive" />
                                ) : rc.content_quality === 'partial' || rc.content_quality === 'title_only' ? (
                                  <AlertCircle className="h-4 w-4 text-amber-500" />
                                ) : (
                                  <Badge variant="outline">Good</Badge>
                                )}
                                <span className="text-sm">{rc.title || 'Untitled'}</span>
                              </div>
                              <Button variant="outline" size="sm" onClick={() => navigate(`/cards/${rc.id}/edit`)}>
                                Open
                              </Button>
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

          <TabsContent value="manual">
            <div className="grid gap-4">
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
                    <p className="text-sm text-muted-foreground">Added: {new Date(feed.created_at).toLocaleDateString()}</p>

                    <div className="mt-3">
                      <Button variant="ghost" size="sm" onClick={() => toggleFeedExpanded(feed.id)}>
                        <ChevronDown className={`h-4 w-4 mr-1 transition-transform ${expandedFeeds.has(feed.id) ? 'rotate-180' : ''}`} />
                        Reference Cards ({refCardsByFeed[feed.id]?.length ?? 0})
                      </Button>
                      {expandedFeeds.has(feed.id) && (
                        <div className="mt-3 space-y-2">
                          {(refCardsByFeed[feed.id] ?? []).map((rc: any) => (
                            <div key={rc.id} className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                {rc.content_quality === 'error' ? (
                                  <AlertTriangle className="h-4 w-4 text-destructive" />
                                ) : rc.content_quality === 'partial' || rc.content_quality === 'title_only' ? (
                                  <AlertCircle className="h-4 w-4 text-amber-500" />
                                ) : (
                                  <Badge variant="outline">Good</Badge>
                                )}
                                <span className="text-sm">{rc.title || 'Untitled'}</span>
                              </div>
                              <Button variant="outline" size="sm" onClick={() => navigate(`/cards/${rc.id}/edit`)}>
                                Open
                              </Button>
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
