import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Database, RefreshCw, Check, X, ExternalLink, AlertTriangle, AlertCircle } from "lucide-react";

interface RefCard {
  id: string;
  title: string | null;
  source_type: string | null;
  global_relevance_score: number | null;
  content_quality: string | null;
  approved: boolean;
  times_used: number;
  created_at: string;
}

type Filter = "unapproved" | "approved";

// Sits on the Sources page as its own block, not nested in a tab, because
// approval is the single gate that determines whether a card can ever be
// cited in generated content (reference_cards.approved: "Only approved cards
// are trusted, citable sources for generation"). Burying that action inside
// a tab made it easy to ingest 200+ cards and never get around to approving
// more than a handful, which is exactly what happened: 4 approved out of 228
// total, the same 4 facts cited in nearly every draft. This block exists to
// make "go approve more sources" a five-second action from the page's front
// door instead of a multi-click hunt.
export const ReferenceCardsBlock = () => {
  const navigate = useNavigate();
  const [cards, setCards] = useState<RefCard[]>([]);
  const [approvedCount, setApprovedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [filter, setFilter] = useState<Filter>("unapproved");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [brandColor, setBrandColor] = useState("#6658ea");

  useEffect(() => {
    loadBrandColor();
  }, []);

  useEffect(() => {
    loadCards();
  }, [filter]);

  const loadBrandColor = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const { data } = await supabase
      .from("profiles")
      .select("secondary_color")
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (data?.secondary_color) setBrandColor(data.secondary_color);
  };

  const loadCards = async () => {
    setLoading(true);

    const [{ count: approved }, { count: total }, { data, error }] = await Promise.all([
      supabase.from("reference_cards").select("id", { count: "exact", head: true }).eq("approved", true),
      supabase.from("reference_cards").select("id", { count: "exact", head: true }),
      supabase
        .from("reference_cards")
        .select("id,title,source_type,global_relevance_score,content_quality,approved,times_used,created_at")
        .eq("approved", filter === "approved")
        .order(filter === "unapproved" ? "global_relevance_score" : "last_used_at", { ascending: false })
        .limit(25),
    ]);

    setApprovedCount(approved ?? 0);
    setTotalCount(total ?? 0);
    if (error) {
      console.error("Failed to load reference cards:", error);
      toast.error("Failed to load reference cards");
    } else {
      setCards((data || []) as RefCard[]);
    }
    setLoading(false);
  };

  const toggleApproved = async (card: RefCard) => {
    setBusyId(card.id);
    const { error } = await supabase
      .from("reference_cards")
      .update({ approved: !card.approved })
      .eq("id", card.id);
    setBusyId(null);
    if (error) {
      toast.error("Failed to update approval status");
    } else {
      toast.success(card.approved ? "Unapproved" : "Approved — now citable in generated content");
      loadCards();
    }
  };

  const unapprovedCount = totalCount - approvedCount;

  return (
    <Card className="mb-8 border" style={{ backgroundColor: `${brandColor}1a`, borderColor: `${brandColor}55` }}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="rounded-lg p-2" style={{ backgroundColor: brandColor }}>
              <Database className="h-5 w-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-lg">Reference Cards</CardTitle>
              <CardDescription>
                {approvedCount} approved of {totalCount} total — only approved cards can be cited in generated content
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={filter === "unapproved" ? "default" : "outline"}
              onClick={() => setFilter("unapproved")}
            >
              Needs review ({unapprovedCount})
            </Button>
            <Button
              size="sm"
              variant={filter === "approved" ? "default" : "outline"}
              onClick={() => setFilter("approved")}
            >
              Approved ({approvedCount})
            </Button>
            <Button variant="ghost" size="sm" onClick={loadCards} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : cards.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground text-sm">
            {filter === "unapproved" ? "Nothing waiting on review." : "No approved cards yet."}
          </div>
        ) : (
          <div className="space-y-2">
            {cards.map((card) => (
              <div key={card.id} className="flex items-center justify-between gap-2 bg-white/60 rounded-md px-3 py-2">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {card.content_quality === "error" ? (
                    <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                  ) : card.content_quality === "partial" || card.content_quality === "title_only" ? (
                    <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                  ) : null}
                  <span className="text-sm truncate">{card.title || "Untitled"}</span>
                  <Badge variant="outline" className="text-xs shrink-0">{card.source_type || "manual"}</Badge>
                  {typeof card.global_relevance_score === "number" && (
                    <Badge variant="outline" className="text-xs shrink-0">score {card.global_relevance_score}</Badge>
                  )}
                  {card.times_used > 0 && (
                    <Badge variant="outline" className="text-xs shrink-0">used {card.times_used}×</Badge>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant={card.approved ? "outline" : "default"}
                    disabled={busyId === card.id}
                    onClick={() => toggleApproved(card)}
                  >
                    {card.approved ? <X className="h-3.5 w-3.5 mr-1" /> : <Check className="h-3.5 w-3.5 mr-1" />}
                    {card.approved ? "Unapprove" : "Approve"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => navigate(`/cards/${card.id}`)}>
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ReferenceCardsBlock;
