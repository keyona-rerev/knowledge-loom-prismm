import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Search, Filter, Lightbulb, Edit, Trash2, Sparkles, Database } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface InsightCard {
  id: string;
  title: string;
  content: string;
  insight_type: string;
  context: string;
  priority: number;
  tags: string[];
  created_at: string;
  status: string;
  reference_card_id: string | null;
}

export const ObservationsTab = () => {
  const navigate = useNavigate();
  const [insights, setInsights] = useState<InsightCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [questionSets, setQuestionSets] = useState<Array<{ id: string; name: string }>>([]);
  const [processDialogOpen, setProcessDialogOpen] = useState(false);
  const [selectedInsightId, setSelectedInsightId] = useState<string | null>(null);
  const [selectedQuestionSetId, setSelectedQuestionSetId] = useState<string>("none");

  useEffect(() => {
    const initialize = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await Promise.all([
        loadInsightsWithSession(session.user.id),
        loadQuestionSetsWithSession(session.user.id),
      ]);
    };
    initialize();
  }, []);

  const loadInsightsWithSession = async (userId: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from("insight_cards")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error loading insights:", error);
      toast.error("Failed to load insights");
    } else {
      setInsights(data || []);
    }
    setLoading(false);
  };

  const loadQuestionSetsWithSession = async (userId: string) => {
    const { data, error } = await supabase
      .from("question_sets")
      .select("id, name")
      .or(`user_id.eq.${userId},is_global.eq.true`)
      .eq("is_active", true)
      .order("name");

    if (!error && data) {
      setQuestionSets(data);
    } else if (error) {
      console.error("Failed to load question sets:", error);
    }
  };

  // Insights auto-get a reference card on save (InsightDetail.tsx), so this
  // no longer creates one, it runs AI extraction on the card the insight
  // already has, for insights that want deeper processing than fast capture
  // gives them by default. Falls back to creating the card here only for
  // insights captured before that auto-link existed and never got backfilled.
  const handleProcessWithAI = async (insightId: string, questionSetId?: string) => {
    const insight = insights.find(i => i.id === insightId);
    if (!insight) return;

    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.user?.id) {
      toast.error("You must be logged in");
      return;
    }

    try {
      let cardId = insight.reference_card_id;
      if (!cardId) {
        const { data, error } = await supabase
          .from("reference_cards")
          .insert({
            user_id: session.user.id,
            title: insight.title,
            original_text: insight.content,
            source_type: "observation",
            status: "active",
            approved: true,
          })
          .select("id")
          .single();
        if (error) throw new Error(error.message || "Insert failed");
        cardId = data.id;
        await supabase.from("insight_cards").update({ reference_card_id: cardId }).eq("id", insightId);
      }

      if (questionSetId && questionSetId !== "none") {
        await supabase.from("reference_cards").update({ question_set_id: questionSetId }).eq("id", cardId);
      }

      toast.info("Processing with AI...");
      const { error: processError } = await supabase.functions.invoke("process-reference-card", {
        body: { cardId }
      });

      if (processError) {
        console.error("AI processing error:", processError);
        toast.warning("AI processing failed");
      } else {
        toast.success("Processed with AI");
      }

      setProcessDialogOpen(false);
      setSelectedInsightId(null);
      setSelectedQuestionSetId("none");
      loadInsightsWithSession(session.user.id);
    } catch (error: any) {
      console.error("Process error:", error);
      toast.error(`Failed to process: ${error?.message || 'Unknown error'}`);
    }
  };

  const openProcessDialog = (insightId: string) => {
    setSelectedInsightId(insightId);
    setProcessDialogOpen(true);
  };

  const handleDeleteInsight = async (insightId: string) => {
    if (!confirm("Are you sure you want to delete this insight?")) {
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    const insight = insights.find(i => i.id === insightId);

    const { error } = await supabase
      .from("insight_cards")
      .delete()
      .eq("id", insightId);

    if (error) {
      toast.error("Failed to delete insight");
    } else {
      // The reference card only exists because this insight auto-created it;
      // deleting the insight should take its reference-library copy with it
      // rather than leaving an orphaned, still-approved, still-citable card.
      if (insight?.reference_card_id) {
        await supabase.from("reference_cards").delete().eq("id", insight.reference_card_id);
      }
      toast.success("Insight deleted");
      if (session?.user?.id) {
        loadInsightsWithSession(session.user.id);
      }
    }
  };

  const getPriorityColor = (priority: number) => {
    switch (priority) {
      case 1: return "bg-red-100 text-red-800 border-red-200";
      case 2: return "bg-orange-100 text-orange-800 border-orange-200";
      case 3: return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case 4: return "bg-blue-100 text-blue-800 border-blue-200";
      case 5: return "bg-gray-100 text-gray-800 border-gray-200";
      default: return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "thesis": return "bg-purple-100 text-purple-800 border-purple-200";
      case "hook": return "bg-green-100 text-green-800 border-green-200";
      case "contrarian": return "bg-red-100 text-red-800 border-red-200";
      case "closing": return "bg-blue-100 text-blue-800 border-blue-200";
      default: return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const filteredInsights = insights.filter(insight => {
    const matchesSearch = insight.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         insight.content.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = filterType === "all" || insight.insight_type === filterType;
    const matchesPriority = filterPriority === "all" || insight.priority.toString() === filterPriority;

    return matchesSearch && matchesType && matchesPriority;
  });

  if (loading) {
    return (
      <div className="animate-pulse">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-32 bg-gray-200 rounded mb-4"></div>
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="flex justify-between items-start mb-6 gap-4">
        <p className="text-muted-foreground max-w-2xl">
          Capture thesis statements, hooks, contrarian arguments, and observations. Every insight is added to your reference library as soon as you save it. Use "Process with AI" on any insight for deeper extraction with a question set.
        </p>
        <Button onClick={() => navigate("/insights/new")} className="shrink-0">
          <Plus className="mr-2 h-4 w-4" />
          New Insight
        </Button>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search insights..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-[180px]">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="thesis">Thesis</SelectItem>
                <SelectItem value="hook">Hook</SelectItem>
                <SelectItem value="contrarian">Contrarian</SelectItem>
                <SelectItem value="closing">Closing</SelectItem>
                <SelectItem value="observation">Observation</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterPriority} onValueChange={setFilterPriority}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priorities</SelectItem>
                <SelectItem value="1">Priority 1 (Highest)</SelectItem>
                <SelectItem value="2">Priority 2</SelectItem>
                <SelectItem value="3">Priority 3</SelectItem>
                <SelectItem value="4">Priority 4</SelectItem>
                <SelectItem value="5">Priority 5 (Lowest)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Insights Grid */}
      {filteredInsights.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <Lightbulb className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No observations yet</h3>
            <p className="text-muted-foreground mb-6">
              {searchTerm || filterType !== "all" || filterPriority !== "all"
                ? "No insights match your filters. Try adjusting your search."
                : "Start capturing your thoughts, observations, and ideas."}
            </p>
            <Button onClick={() => navigate("/insights/new")}>
              <Plus className="mr-2 h-4 w-4" />
              Create Your First Insight
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {filteredInsights.map((insight) => (
            <Card key={insight.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex-1">
                    <h3 className="font-semibold text-lg mb-2">{insight.title}</h3>
                    <div className="flex flex-wrap gap-2 mb-3">
                      <Badge variant="outline" className={getTypeColor(insight.insight_type)}>
                        {insight.insight_type}
                      </Badge>
                      <Badge variant="outline" className={getPriorityColor(insight.priority)}>
                        Priority {insight.priority}
                      </Badge>
                      {insight.reference_card_id && (
                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                          <Database className="h-3 w-3 mr-1" />In reference library
                        </Badge>
                      )}
                      {insight.tags?.map((tag, index) => (
                        <Badge key={index} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2 ml-4">
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => openProcessDialog(insight.id)}
                    >
                      <Sparkles className="h-4 w-4 mr-1" />
                      Process with AI
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/insights/${insight.id}`)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDeleteInsight(insight.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <p className="text-muted-foreground mb-3 whitespace-pre-wrap">
                  {insight.content}
                </p>

                {insight.context && (
                  <div className="text-sm text-muted-foreground border-t pt-3">
                    <strong>Context:</strong> {insight.context}
                  </div>
                )}

                <div className="text-xs text-muted-foreground mt-3">
                  Created {new Date(insight.created_at).toLocaleDateString()}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Process with AI Dialog */}
      <Dialog open={processDialogOpen} onOpenChange={setProcessDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Process with AI</DialogTitle>
            <DialogDescription>
              Runs AI extraction on this insight's reference card. Optionally apply a question set for deeper extraction.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium mb-2 block">
                Question Set (Optional)
              </label>
              <Select value={selectedQuestionSetId} onValueChange={setSelectedQuestionSetId}>
                <SelectTrigger>
                  <SelectValue placeholder="No question set" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No question set</SelectItem>
                  {questionSets.map((qs) => (
                    <SelectItem key={qs.id} value={qs.id}>
                      {qs.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setProcessDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => selectedInsightId && handleProcessWithAI(selectedInsightId, selectedQuestionSetId !== "none" ? selectedQuestionSetId : undefined)}
              >
                Process with AI
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ObservationsTab;
