import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Plus, Search, Filter, Lightbulb, Edit, Trash2, FileText } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

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
}

const Insights = () => {
  const navigate = useNavigate();
  const [insights, setInsights] = useState<InsightCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [questionSets, setQuestionSets] = useState<Array<{ id: string; name: string }>>([]);
  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [selectedInsightId, setSelectedInsightId] = useState<string | null>(null);
  const [selectedQuestionSetId, setSelectedQuestionSetId] = useState<string>("none");

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/auth");
      }
    };
    checkAuth();
    loadInsights();
    loadQuestionSets();
  }, [navigate]);

  const loadInsights = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();

    const { data, error } = await supabase
      .from("insight_cards")
      .select("*")
      .eq("user_id", session?.user?.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error loading insights:", error);
      toast.error("Failed to load insights");
    } else {
      setInsights(data || []);
    }
    setLoading(false);
  };

  const loadQuestionSets = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    
    const { data, error } = await supabase
      .from("question_sets")
      .select("id, name")
      .eq("user_id", session?.user?.id)
      .eq("is_active", true)
      .order("name");

    if (!error && data) {
      setQuestionSets(data);
    }
  };

  const handleConvertToReferenceCard = async (insightId: string, questionSetId?: string) => {
    const insight = insights.find(i => i.id === insightId);
    if (!insight) return;

    const { data: { session } } = await supabase.auth.getSession();

    try {
      // Create the reference card
      const { data, error } = await supabase
        .from("reference_cards")
        .insert({
          user_id: session?.user?.id,
          title: insight.title,
          original_text: insight.content,
          source_type: "observation",
          status: "active",
          question_set_id: questionSetId && questionSetId !== "none" ? questionSetId : null,
          content_quality: "good"
        })
        .select()
        .single();

      if (error) throw error;

      // Process the card with AI if question set is provided
      if (questionSetId && questionSetId !== "none") {
        toast.info("Processing reference card with AI...");
        const { error: processError } = await supabase.functions.invoke("process-reference-card", {
          body: { cardId: data.id }
        });

        if (processError) {
          console.error("AI processing error:", processError);
          toast.warning("Reference card created but AI processing failed");
        } else {
          toast.success("Insight converted and processed with AI!");
        }
      } else {
        toast.success("Insight converted to reference card");
      }

      setConvertDialogOpen(false);
      setSelectedInsightId(null);
      setSelectedQuestionSetId("none");
      navigate(`/reference-cards/${data.id}`);
    } catch (error) {
      console.error(error);
      toast.error("Failed to convert insight to reference card");
    }
  };

  const openConvertDialog = (insightId: string) => {
    setSelectedInsightId(insightId);
    setConvertDialogOpen(true);
  };

  const handleDeleteInsight = async (insightId: string) => {
    if (!confirm("Are you sure you want to delete this insight?")) {
      return;
    }

    const { error } = await supabase
      .from("insight_cards")
      .delete()
      .eq("id", insightId);

    if (error) {
      toast.error("Failed to delete insight");
    } else {
      toast.success("Insight deleted");
      loadInsights();
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
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-1/4 mb-2"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2 mb-8"></div>
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-32 bg-gray-200 rounded mb-4"></div>
            ))}
          </div>
        </main>
      </div>
    );
  }

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
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-2">Observation Journal</h1>
            <p className="text-muted-foreground">
              Capture insights that can become reference cards for content generation. Record thesis statements, hooks, contrarian arguments, and key observations. Click "Convert to a Reference Card" to transform insights into processed reference material with optional question sets for AI analysis.
            </p>
          </div>
          <Button onClick={() => navigate("/insights/new")}>
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
              <h3 className="text-lg font-semibold mb-2">No insights yet</h3>
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
                        onClick={() => openConvertDialog(insight.id)}
                      >
                        <FileText className="h-4 w-4 mr-1" />
                        Convert to a Reference Card
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

        {/* Convert to Reference Card Dialog */}
        <Dialog open={convertDialogOpen} onOpenChange={setConvertDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Convert to Reference Card</DialogTitle>
              <DialogDescription>
                This will create a reference card from your insight. You can optionally apply a question set for AI processing.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <label className="text-sm font-medium mb-2 block">
                  Question Set (Optional)
                </label>
                <Select value={selectedQuestionSetId} onValueChange={setSelectedQuestionSetId}>
                  <SelectTrigger>
                    <SelectValue placeholder="No question set (convert only)" />
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
                <Button variant="outline" onClick={() => setConvertDialogOpen(false)}>
                  Cancel
                </Button>
                <Button 
                  onClick={() => selectedInsightId && handleConvertToReferenceCard(selectedInsightId, selectedQuestionSetId !== "none" ? selectedQuestionSetId : undefined)}
                >
                  Convert to Reference Card
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
};

export default Insights;