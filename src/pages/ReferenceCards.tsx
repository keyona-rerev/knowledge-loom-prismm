import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { ArrowLeft, Search, Edit2, ExternalLink, Trash2, ChevronDown, Sparkles, AlertCircle } from "lucide-react";
import { InstructionsToggle } from "@/components/InstructionsToggle";

const ReferenceCards = () => {
  const navigate = useNavigate();
  const [cards, setCards] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterSource, setFilterSource] = useState<string>("all");
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [processingCards, setProcessingCards] = useState<Set<string>>(new Set());

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
    
    const { error } = await supabase.functions.invoke("process-reference-card", {
      body: { cardId }
    });

    setProcessingCards(prev => {
      const next = new Set(prev);
      next.delete(cardId);
      return next;
    });

    if (error) {
      toast.error("Failed to process card: " + error.message);
    } else {
      toast.success("Card processed successfully");
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
    loadCards();
  }, [navigate, filterStatus, filterSource]);

  const filteredCards = cards.filter(card => 
    card.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    card.original_text?.toLowerCase().includes(searchTerm.toLowerCase())
  );

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
        <h1 className="text-3xl font-bold mb-4">Reference Cards</h1>

        <InstructionsToggle 
          instructions={`Reference Cards are insights extracted from your sources:

- Each card contains content and answers to your configured questions
- Use filters to find specific cards by status or source type
- Click "Process with AI" to analyze content and extract insights
- Content warnings show when full articles couldn't be accessed
- Click Edit to modify a card's content or answers`}
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
              <SelectItem value="needs_review">Needs Review</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterSource} onValueChange={setFilterSource}>
            <SelectTrigger className="w-full md:w-48">
              <SelectValue placeholder="Filter by source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              <SelectItem value="rss">RSS</SelectItem>
              <SelectItem value="journal">Journal</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-4">
          {filteredCards.map((card) => (
            <Card key={card.id} className="hover:shadow-md transition-shadow">
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-start gap-2 mb-2">
                      <CardTitle className="text-lg flex-1">{card.title || "Untitled"}</CardTitle>
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
                        <span>{card.content_warning}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
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
                    <Button variant="ghost" size="icon" onClick={() => navigate(`/cards/${card.id}/edit`)}>
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteCard(card.id, card.title || "Untitled")}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Collapsible open={expandedCards.has(card.id)} onOpenChange={() => toggleCardExpanded(card.id)}>
                  <div>
                    {card.ai_summary && (
                      <div className="mb-3 p-3 bg-muted rounded-md">
                        <p className="text-sm font-medium mb-1">AI Summary:</p>
                        <p className="text-sm text-muted-foreground">{card.ai_summary}</p>
                      </div>
                    )}
                    <p className="text-sm text-muted-foreground line-clamp-3">
                      {card.original_text}
                    </p>
                  </div>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="mt-2">
                      <ChevronDown className={`h-4 w-4 mr-1 transition-transform ${expandedCards.has(card.id) ? 'rotate-180' : ''}`} />
                      {expandedCards.has(card.id) ? 'Show Less' : 'Show More'}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-4 space-y-2">
                      <p className="text-sm whitespace-pre-wrap">{card.original_text}</p>
                      {card.insight_answers && Object.keys(card.insight_answers).length > 0 && (
                        <div className="mt-4 border-t pt-4">
                          <p className="text-sm font-medium mb-2">Insight Answers:</p>
                          {Object.entries(card.insight_answers).map(([key, value]) => (
                            <div key={key} className="text-sm mb-2">
                              <p className="font-medium">Q{parseInt(key) + 1}:</p>
                              <p className="text-muted-foreground">{value as string}</p>
                            </div>
                          ))}
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
            No reference cards found. Add RSS feeds or create manual entries to get started.
          </div>
        )}
      </main>
    </div>
  );
};

export default ReferenceCards;
