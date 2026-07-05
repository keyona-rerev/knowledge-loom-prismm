import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { ArrowLeft, Search, Edit2, ExternalLink, Trash2, ChevronDown, Sparkles, AlertCircle, Plus, CheckCircle2, ArrowUpDown } from "lucide-react";
import { InstructionsToggle } from "@/components/InstructionsToggle";

type SortOrder = "newest" | "score_desc" | "score_asc";
type ApprovalFilter = "all" | "approved" | "unapproved";

const ReferenceCards = () => {
  const navigate = useNavigate();
  const [cards, setCards] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterSource, setFilterSource] = useState<string>("all");
  // Separate from filterStatus (the processing pipeline state — processing/
  // active/archived/needs_review, which is set to "active" automatically
  // once a card finishes AI processing regardless of approval). This filters
  // on reference_cards.approved directly, which is the field that actually
  // gates whether a card is citable in generated content. Conflating the two
  // is exactly why "Needs Review" (a status filter) showed nothing even
  // though most cards are correctly unapproved.
  const [filterApproval, setFilterApproval] = useState<ApprovalFilter>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [processingCards, setProcessingCards] = useState<Set<string>>(new Set());
  const [selectedCards, setSelectedCards] = useState<Set<string>>(new Set());
  const [questionSets, setQuestionSets] = useState<any[]>([]);

  const loadCards = async () => {
    let query = supabase
      .from("reference_cards")
      .select("*, source_feeds(name)")
      .order("created_at", { ascending: false });

    if (filterStatus !== "all") {
      query = query.eq("status", filterStatus);
    }
    if (filterSource !== "all") {
      query = query.eq("source_type", filterSource);
    }

    const { data, error } = await query;

    if (error) {
      toast.error("Failed to load reference cards");
    } else {
      setCards(data || []);
    }
  };

  const deleteCard = async (id: string, title: string) => {
    if (!confirm(`Are you sure you want to delete "${title}"? This action cannot be undone.`)) {
      return;
    }

    const { error } = await supabase
      .from("reference_cards")
      .delete()
      .eq("id", id);

    if (error) {
      toast.error("Failed to delete card");
    } else {
      toast.success("Card deleted");
      loadCards();
    }
  };

  const processCard = async (cardId: string) => {
    setProcessingCards(prev => new Set(prev).add(cardId));
    toast.loading("Processing with AI...");
    
    const { data, error } = await supabase.functions.invoke("process-reference-card", {
      body: { cardId }
    });

    setProcessingCards(prev => {
      const next = new Set(prev);
      next.delete(cardId);
      return next;
    });

    if (error) {
      console.error("Process card error:", error);
      toast.error("Failed to process card: " + (error.message || "Unknown error"));
    } else if (data?.error) {
      console.error("Process card data error:", data.error);
      toast.error("AI processing failed: " + data.error);
    } else {
      toast.success("Card processed successfully!");
      loadCards();
    }
  };

  // Deliberate approval. Only approved cards are trusted, citable sources for
  // generation. Toggled here for quick management; never set automatically on ingest.
  const toggleApproved = async (card: any) => {
    const next = !card.approved;
    const { error } = await supabase
      .from("reference_cards")
      .update({ approved: next })
      .eq("id", card.id);
    if (error) {
      toast.error("Failed to update approval");
    } else {
      toast.success(next ? "Source approved" : "Approval removed");
      loadCards();
    }
  };

  const toggleCardSelection = (cardId: string) => {
    setSelectedCards(prev => {
      const next = new Set(prev);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        next.add(cardId);
      }
      return next;
    });
  };

  const toggleAllCards = () => {
    if (selectedCards.size === filteredCards.length) {
      setSelectedCards(new Set());
    } else {
      setSelectedCards(new Set(filteredCards.map(c => c.id)));
    }
  };

  const bulkDeleteCards = async () => {
    if (selectedCards.size === 0) {
      toast.error("No cards selected");
      return;
    }

    if (!confirm(`Delete ${selectedCards.size} selected card(s)? This action cannot be undone.`)) {
      return;
    }

    const { error } = await supabase
      .from("reference_cards")
      .delete()
      .in("id", Array.from(selectedCards));

    if (error) {
      toast.error("Failed to delete cards");
    } else {
      toast.success(`${selectedCards.size} card(s) deleted`);
      setSelectedCards(new Set());
      loadCards();
    }
  };

  const toggleCardExpanded = (cardId: string) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        next.add(cardId);
      }
      return next;
    });
  };
  useEffect(() => {
    // TODO: Replace with actual query when table exists
    const mockQuestionSets = [
      { id: "default", name: "Default Questions" },
      { id: "set1", name: "Question Set 1" },
      { id: "set2", name: "Question Set 2" },
    ];
    setQuestionSets(mockQuestionSets);
  }, []);
  useEffect(() => {
    const checkAuthAndLoad = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/auth");
        return;
      }
      loadCards();
    };
    checkAuthAndLoad();
  }, [navigate, filterStatus, filterSource]);

  const filteredCards = cards
    .filter(card =>
      card.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      card.original_text?.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .filter(card => {
      if (filterApproval === "approved") return card.approved === true;
      if (filterApproval === "unapproved") return card.approved !== true;
      return true;
    })
    .sort((a, b) => {
      if (sortOrder === "score_desc") return (b.global_relevance_score ?? 0) - (a.global_relevance_score ?? 0);
      if (sortOrder === "score_asc") return (a.global_relevance_score ?? 0) - (b.global_relevance_score ?? 0);
      return 0; // "newest" — already ordered this way by the query itself
    });

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

      <main className="container mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-3xl font-bold">Reference Cards</h1>
          <Button onClick={() => navigate("/feeds")}>
            <Plus className="mr-2 h-4 w-4" />
            Add New Source
          </Button>
        </div>

        <InstructionsToggle 
          instructions={`Reference Cards are insights extracted from your sources:

- Cards are created from Google Alerts, manual sources, and observations
- Each card contains content and answers to your configured questions
- Use filters to find specific cards by status or source type
- The Approval filter shows approved vs. not-approved cards — this is the field that controls what's citable in generated content, separate from processing Status
- Sort by relevance score to surface your best (or weakest) candidates first
- Click "Process with AI" to analyze content and extract insights
- Content warnings show when full articles couldn't be accessed
- Click "View Details" to see the full card`}
        />

        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search cards..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-full md:w-48">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="needs_review">Needs Review (processing)</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterSource} onValueChange={setFilterSource}>
            <SelectTrigger className="w-full md:w-48">
              <SelectValue placeholder="Filter by source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              <SelectItem value="rss">Google Alert</SelectItem>
              <SelectItem value="journal">Journal</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
              <SelectItem value="perplexity">Perplexity</SelectItem>
              <SelectItem value="observation">Observation Journal</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterApproval} onValueChange={(v) => setFilterApproval(v as ApprovalFilter)}>
            <SelectTrigger className="w-full md:w-48">
              <SelectValue placeholder="Filter by approval" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Approval States</SelectItem>
              <SelectItem value="unapproved">Not Approved</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as SortOrder)}>
            <SelectTrigger className="w-full md:w-56">
              <ArrowUpDown className="h-3.5 w-3.5 mr-2 shrink-0" />
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="score_desc">Highest score first</SelectItem>
              <SelectItem value="score_asc">Lowest score first</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {filteredCards.length > 0 && (
          <div className="flex items-center gap-4 mb-4 p-4 bg-muted rounded-lg">
            <Checkbox 
              checked={selectedCards.size === filteredCards.length}
              onCheckedChange={toggleAllCards}
            />
            <span className="text-sm font-medium">
              {selectedCards.size > 0 ? `${selectedCards.size} selected` : "Select all"}
            </span>
            {selectedCards.size > 0 && (
              <Button 
                variant="destructive" 
                size="sm"
                onClick={bulkDeleteCards}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Delete Selected
              </Button>
            )}
          </div>
        )}

        <div className="grid gap-4">
          {filteredCards.map((card) => (
            <Card key={card.id} className="hover:shadow-md transition-shadow overflow-hidden">
              <CardHeader>
                <div className="flex justify-between items-start gap-3">
                  <Checkbox 
                    checked={selectedCards.has(card.id)}
                    onCheckedChange={() => toggleCardSelection(card.id)}
                    className="mt-1"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2 mb-2">
                      <CardTitle className="text-lg flex-1 break-words">{card.title || "Untitled"}</CardTitle>
                      {card.source_url && (
                        <a 
                          href={card.source_url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-primary hover:text-primary/80"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 mb-2">
                      <Badge variant={card.status === "active" ? "default" : "secondary"}>
                        {card.status}
                      </Badge>
                      <Badge variant="outline">{card.source_type}</Badge>
                      <Badge variant="outline">Score: {card.global_relevance_score}/10</Badge>
                      <Badge variant={card.approved ? "default" : "outline"}>
                        {card.approved ? "Approved source" : "Not approved"}
                      </Badge>
                      {card.content_quality === "title_only" && (
                        <Badge variant="destructive">Title Only</Badge>
                      )}
                      {card.content_quality === "partial" && (
                        <Badge variant="outline">Partial Content</Badge>
                      )}
                      {card.content_quality === "error" && (
                        <Badge variant="destructive">Error</Badge>
                      )}
                      {card.modified_by_user && <Badge variant="secondary">User Modified</Badge>}
                      {card.source_feeds?.name && (
                        <Badge variant="outline" className="gap-1">
                          <ExternalLink className="h-3 w-3" />
                          {card.source_feeds.name}
                        </Badge>
                      )}
                    </div>
                    {card.content_warning && (
                      <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                        <AlertCircle className="h-4 w-4" />
                        <span className="break-words">{card.content_warning}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant={card.approved ? "default" : "outline"}
                      size="sm"
                      onClick={() => toggleApproved(card)}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                      {card.approved ? "Approved" : "Approve"}
                    </Button>
                    {!card.ai_summary && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => processCard(card.id)}
                        disabled={processingCards.has(card.id)}
                      >
                        <Sparkles className="h-4 w-4 mr-1" />
                        {processingCards.has(card.id) ? "Processing..." : "Process with AI"}
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => navigate(`/cards/${card.id}`)}>
                      View Details
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteCard(card.id, card.title || "Untitled")}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="min-w-0">
                <Collapsible open={expandedCards.has(card.id)} onOpenChange={() => toggleCardExpanded(card.id)}>
                  <div className="min-w-0">
                    {card.ai_summary && (
                      <div className="mb-3 p-3 bg-muted rounded-md min-w-0">
                        <p className="text-sm font-medium mb-1">AI Summary:</p>
                        <p className="text-sm text-muted-foreground break-words">{card.ai_summary}</p>
                      </div>
                    )}
                    <p className="text-sm text-muted-foreground line-clamp-3 break-words">
                      {card.original_text}
                    </p>
                  </div>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="mt-2">
                      <ChevronDown className={`h-4 w-4 mr-1 transition-transform ${expandedCards.has(card.id) ? 'rotate-180' : ''}`} />
                      {expandedCards.has(card.id) ? 'Hide full article' : 'Read full article'}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-4 space-y-2 min-w-0">
                      <p className="text-sm whitespace-pre-wrap break-words">{card.original_text}</p>
                      {card.insight_answers && Object.keys(card.insight_answers).length > 0 && (
                        <div className="mt-4 border-t pt-4">
                          <p className="text-sm font-medium mb-2">Insight Answers:</p>
                          {Object.entries(card.insight_answers).map(([key, value]) => {
                            // insight_answers is keyed by the literal question
                            // text itself (see process-reference-card's
                            // prompt: "answers": {"<question>": "answer"}),
                            // not by numeric index. Rendering key directly.
                            const isCustom = typeof value === "object" && value !== null && "question" in (value as any);
                            const label = isCustom ? `Custom: ${(value as any).question}` : key;
                            const answerText = isCustom ? (value as any).answer : (value as string);
                            return (
                              <div key={key} className="text-sm mb-2">
                                <p className="font-medium">{label}</p>
                                <p className="text-muted-foreground break-words">{answerText}</p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </CardContent>
            </Card>
          ))}
        </div>

        {filteredCards.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            No reference cards found. Set up Google Alerts or add manual sources to get started.
          </div>
        )}
      </main>
    </div>
  );
};

export default ReferenceCards;
