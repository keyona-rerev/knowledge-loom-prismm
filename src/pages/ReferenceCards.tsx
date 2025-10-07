import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Search, Edit2, ExternalLink } from "lucide-react";
import { InstructionsToggle } from "@/components/InstructionsToggle";

const ReferenceCards = () => {
  const navigate = useNavigate();
  const [cards, setCards] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterSource, setFilterSource] = useState<string>("all");

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
- Click Edit to modify a card's content or answers
- Cards with higher relevance scores are prioritized for content generation
- "User Modified" badge shows cards you've manually edited`}
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
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={card.status === "active" ? "default" : "secondary"}>
                        {card.status}
                      </Badge>
                      <Badge variant="outline">{card.source_type}</Badge>
                      <Badge variant="outline">Score: {card.global_relevance_score}/10</Badge>
                      {card.modified_by_user && <Badge variant="secondary">User Modified</Badge>}
                      {card.source_feeds?.name && (
                        <Badge variant="outline" className="gap-1">
                          <ExternalLink className="h-3 w-3" />
                          {card.source_feeds.name}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => navigate(`/cards/${card.id}/edit`)}>
                    <Edit2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground line-clamp-3">
                  {card.original_text}
                </p>
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