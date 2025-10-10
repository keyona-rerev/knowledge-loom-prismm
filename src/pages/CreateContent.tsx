import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { ArrowLeft, Sparkles, Lightbulb, FileText } from "lucide-react";
import { useEmailNotifications } from "@/hooks/useEmailNotifications";

// Define types based on existing patterns
interface ContentDirection {
  title: string;
  description: string;
  angle: string;
}

interface InsightCard {
  id: string;
  title: string;
  content: string;
  insight_type: string;
}

interface ContentTemplate {
  id: string;
  name: string;
  description: string;
  output_format: string;
  template_structure: any;
}

const CreateContent = () => {
  const navigate = useNavigate();
  const { sendDraftNotification } = useEmailNotifications();
  
  const [seedInsight, setSeedInsight] = useState("");
  const [seedCategory, setSeedCategory] = useState<string>("thesis");
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [templates, setTemplates] = useState<ContentTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"input" | "directions" | "cards">("input");

  // NEW STATE: Insight cards integration
  const [insightCards, setInsightCards] = useState<InsightCard[]>([]);
  const [selectedInsightCards, setSelectedInsightCards] = useState<string[]>([]);
  const [showInsightSelection, setShowInsightSelection] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        navigate("/auth");
      }
    };
    checkAuth();
  }, [navigate]);

  // NEW EFFECT: Load content templates
  useEffect(() => {
    const loadTemplates = async () => {
      try {
        const { data, error } = await supabase
          .from("content_templates")
          .select("*")
          .eq("is_active", true)
          .order("name");

        if (error) {
          console.error("Error loading templates:", error);
          // If table doesn't exist yet, fail gracefully
          if (error.code === '42P01') {
            console.log("Content templates table not created yet");
            setTemplates([]);
            return;
          }
          toast.error("Failed to load templates");
        } else {
          setTemplates(data || []);
          // Auto-select first template if available
          if (data && data.length > 0) {
            setSelectedTemplate(data[0].id);
          }
        }
      } catch (error) {
        console.error("Error loading templates:", error);
      }
    };

    loadTemplates();
  }, []);

  const [directions, setDirections] = useState<ContentDirection[]>([]);

  // NEW FUNCTION: Load user's insight cards
  const loadInsightCards = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    
    const { data, error } = await supabase
      .from("insight_cards")
      .select("id, title, content, insight_type")
      .eq("user_id", session?.user?.id)
      .eq("status", "active")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error loading insight cards:", error);
      // If table doesn't exist yet, fail gracefully
      if (error.code === '42P01') {
        console.log("Insight cards table not created yet - this is expected during initial deployment");
        setInsightCards([]);
        return;
      }
      toast.error("Failed to load insight cards");
    } else {
      setInsightCards(data || []);
    }
  };

  const handleGenerateDirections = async () => {
    if (!seedInsight.trim()) {
      toast.error("Please enter your insight");
      return;
    }

    setLoading(true);
    toast.info("Generating content directions...");

    const {
      data: { session },
    } = await supabase.auth.getSession();

    const { data, error } = await supabase.functions.invoke("generate-content-directions", {
      body: {
        seedInsight,
        seedCategory,
        userId: session?.user?.id,
      },
    });

    setLoading(false);

    if (error || !data) {
      toast.error("Failed to generate directions: " + (error?.message || "Unknown error"));
    } else {
      setDirections(data.directions || []);
      setStep("directions");
      
      // Load insight cards when directions are ready
      await loadInsightCards();
      
      toast.success("Directions generated!");
    }
  };

  // NEW FUNCTION: Enhanced content generation with insight cards AND templates
  const handleGenerateWithInsights = async (direction: ContentDirection) => {
    setLoading(true);
    toast.info("Creating enhanced draft...");

    const { data: { session } } = await supabase.auth.getSession();

    try {
      // Use the enhanced function with template support
      const { data, error } = await supabase.functions.invoke("generate-final-content", {
        body: {
          direction,
          seedInsight,
          seedCategory,
          insightCardIds: selectedInsightCards,
          templateId: selectedTemplate, // NEW: Pass template ID
          userId: session?.user?.id,
        },
      });

      if (error) {
        // If enhanced function fails, fall back to original
        console.warn("Enhanced content generation failed, falling back to basic:", error);
        await handleSelectDirection(direction);
        return;
      }

      // Get template name for the draft
      const selectedTemplateData = templates.find(t => t.id === selectedTemplate);
      
      // Create draft with enhanced content
      const { data: draftData, error: draftError } = await supabase
        .from("drafts")
        .insert({
          title: data.title || direction.title,
          seed_insight: data.title || direction.title,
          body: data.content,
          status: "draft",
          user_id: session?.user?.id,
          seed_category: seedCategory,
          selected_direction: direction,
          content_type: selectedTemplateData?.output_format || "blog_post",
          template_id: selectedTemplate,
          revision_count: 0,
          approval_status: "pending"
        } as any)
        .select()
        .single();

      if (draftError) {
        // Try without content_type if that fails
        const { data: draftData2, error: error2 } = await supabase
          .from("drafts")
          .insert({
            title: data.title || direction.title,
            seed_insight: data.title || direction.title,
            body: data.content,
            status: "draft",
            user_id: session?.user?.id,
            seed_category: seedCategory,
            selected_direction: direction,
            template_id: selectedTemplate,
            revision_count: 0,
            approval_status: "pending"
          } as any)
          .select()
          .single();

        if (error2) {
          throw error2;
        }

        // Send notification for the created draft
        sendDraftNotification(draftData2.id);
        
        toast.success("Enhanced draft created with your insights!");
        navigate("/drafts");
      } else {
        // Send notification for the created draft
        sendDraftNotification(draftData.id);
        
        toast.success("Enhanced draft created with your insights!");
        navigate("/drafts");
      }
    } catch (error) {
      console.error("Failed to create enhanced draft:", error);
      toast.error("Failed to create draft: " + (error as any)?.message);
    } finally {
      setLoading(false);
    }
  };

  // ORIGINAL FUNCTION: Modified to include template
  const handleSelectDirection = async (direction: ContentDirection) => {
    setLoading(true);
    toast.info("Creating draft from selected direction...");

    const {
      data: { session },
    } = await supabase.auth.getSession();

    const selectedTemplateData = templates.find(t => t.id === selectedTemplate);

    try {
      const { data: draftData, error } = await supabase
        .from("drafts")
        .insert({
          title: direction.title,
          seed_insight: direction.title,
          body: `# ${direction.title}\n\n${direction.description}\n\n**Angle:** ${direction.angle}\n\n**Original Insight:** ${seedInsight}`,
          status: "draft",
          user_id: session?.user?.id,
          seed_category: seedCategory,
          selected_direction: direction,
          content_type: selectedTemplateData?.output_format || "blog_post",
          template_id: selectedTemplate,
          revision_count: 0,
          approval_status: "pending"
        } as any)
        .select()
        .single();

      if (error) {
        // If that fails, try without content_type
        const { data: draftData2, error: error2 } = await supabase
          .from("drafts")
          .insert({
            title: direction.title,
            seed_insight: direction.title,
            body: `# ${direction.title}\n\n${direction.description}\n\n**Angle:** ${direction.angle}\n\n**Original Insight:** ${seedInsight}`,
            status: "draft",
            user_id: session?.user?.id,
            seed_category: seedCategory,
            selected_direction: direction,
            template_id: selectedTemplate,
            revision_count: 0,
            approval_status: "pending"
          } as any)
          .select()
          .single();

        if (error2) {
          throw error2;
        }

        // Send notification for the created draft
        sendDraftNotification(draftData2.id);
        
        toast.success("Draft created successfully!");
        navigate("/drafts");
      } else {
        // Send notification for the created draft
        sendDraftNotification(draftData.id);
        
        toast.success("Draft created successfully!");
        navigate("/drafts");
      }
    } catch (error) {
      console.error("Failed to create draft:", error);
      toast.error("Failed to create draft: " + (error as any)?.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleInsightCard = (insightId: string) => {
    setSelectedInsightCards(prev => 
      prev.includes(insightId) 
        ? prev.filter(id => id !== insightId)
        : [...prev, insightId]
    );
  };

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
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Create Content</h1>
          <p className="text-muted-foreground">Start with your seed insight</p>
        </div>

        {step === "input" && (
          <Card>
            <CardHeader>
              <CardTitle>Seed Insight</CardTitle>
              <CardDescription>What's the core idea you want to explore?</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="insight">Your Insight</Label>
                <Textarea
                  id="insight"
                  value={seedInsight}
                  onChange={(e) => setSeedInsight(e.target.value)}
                  placeholder="Enter your core idea, observation, or thesis..."
                  rows={6}
                  className="mt-2"
                />
              </div>

              <div>
                <Label htmlFor="category">Insight Type</Label>
                <Select value={seedCategory} onValueChange={setSeedCategory}>
                  <SelectTrigger id="category" className="mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="thesis">Thesis Statement</SelectItem>
                    <SelectItem value="hook">Hook / Attention Grabber</SelectItem>
                    <SelectItem value="closing">Closing Statement</SelectItem>
                    <SelectItem value="contrarian">Contrarian Argument</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* NEW: Template Selection */}
              {templates.length > 0 && (
                <div>
                  <Label htmlFor="template">Content Template</Label>
                  <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                    <SelectTrigger id="template" className="mt-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((template) => (
                        <SelectItem key={template.id} value={template.id}>
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4" />
                            {template.name}
                            <span className="text-xs text-muted-foreground ml-1">
                              ({template.output_format})
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedTemplate && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {templates.find(t => t.id === selectedTemplate)?.description}
                    </p>
                  )}
                </div>
              )}

              <Button onClick={handleGenerateDirections} disabled={loading} className="w-full" size="lg">
                <Sparkles className="mr-2 h-5 w-5" />
                {loading ? "Generating..." : "Generate Content Directions"}
              </Button>
            </CardContent>
          </Card>
        )}

        {step === "directions" && (
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <div>
                  <CardTitle>Content Directions</CardTitle>
                  <CardDescription>
                    Select the direction that resonates most
                    {insightCards.length > 0 && (
                      <span className="ml-2 text-sm">
                        • {selectedInsightCards.length} insights selected
                      </span>
                    )}
                    {selectedTemplate && (
                      <span className="ml-2 text-sm">
                        • Template: {templates.find(t => t.id === selectedTemplate)?.name}
                      </span>
                    )}
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  {insightCards.length > 0 && (
                    <Button 
                      variant="outline" 
                      onClick={() => setShowInsightSelection(!showInsightSelection)}
                    >
                      <Lightbulb className="mr-2 h-4 w-4" />
                      {showInsightSelection ? "Hide Insights" : "Add Insights"}
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => setStep("input")}>
                    Back
                  </Button>
                </div>
              </div>
            </CardHeader>
            
            <CardContent className="space-y-6">
              {/* NEW: Insight Card Selection Section */}
              {showInsightSelection && insightCards.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Select Insight Cards</CardTitle>
                    <CardDescription>
                      Choose relevant insights to enhance your content
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 max-h-60 overflow-y-auto">
                    {insightCards.map((insight) => (
                      <div key={insight.id} className="flex items-start space-x-3 p-3 border rounded-lg">
                        <Checkbox
                          checked={selectedInsightCards.includes(insight.id)}
                          onCheckedChange={() => toggleInsightCard(insight.id)}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium">{insight.title}</span>
                            <span className="text-xs bg-secondary text-secondary-foreground px-2 py-1 rounded">
                              {insight.insight_type}
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {insight.content}
                          </p>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Original Directions List - Enhanced */}
              <div className="space-y-4">
                {directions.map((dir, i) => (
                  <Card
                    key={i}
                    className="cursor-pointer hover:border-primary transition-colors"
                    onClick={() => handleGenerateWithInsights(dir)}
                  >
                    <CardContent className="p-4">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <h3 className="font-semibold mb-2">{dir.title}</h3>
                          <p className="text-sm text-muted-foreground mb-2">{dir.description}</p>
                          <p className="text-xs text-muted-foreground italic">Angle: {dir.angle}</p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          {selectedInsightCards.length > 0 && (
                            <div className="flex items-center gap-1 text-xs text-primary bg-primary/10 px-2 py-1 rounded">
                              <Lightbulb className="h-3 w-3" />
                              +{selectedInsightCards.length} insights
                            </div>
                          )}
                          {selectedTemplate && (
                            <div className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded">
                              <FileText className="h-3 w-3" />
                              {templates.find(t => t.id === selectedTemplate)?.name}
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
};

export default CreateContent;