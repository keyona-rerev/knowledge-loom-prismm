import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft, Save, ExternalLink, AlertCircle, Sparkles } from "lucide-react";

const CardDetail = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const [card, setCard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const [editedText, setEditedText] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);

  const loadCard = async () => {
    if (!id) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      navigate("/auth");
      return;
    }

    const { data, error } = await supabase
      .from("reference_cards")
      .select("*, source_feeds(name), reference_card_templates(custom_questions)")
      .eq("id", id)
      .single();

    if (error) {
      toast.error("Failed to load reference card");
      navigate("/cards");
    } else {
      setCard(data);
      setEditedTitle(data.title || "");
      setEditedText(data.original_text || "");
      await loadQuestions(data);
    }
    setLoading(false);
  };

  const loadQuestions = async (cardData: any) => {
    // Load questions from template or global settings
    if (cardData.reference_card_templates?.custom_questions) {
      const templateQuestions = cardData.reference_card_templates.custom_questions;
      if (Array.isArray(templateQuestions)) {
        setQuestions(templateQuestions.filter((q: any) => typeof q === 'string'));
      }
    } else {
      const { data: profile } = await supabase
        .from("profiles")
        .select("global_insight_questions, active_question_indices")
        .limit(1)
        .maybeSingle();

      if (profile?.global_insight_questions && Array.isArray(profile.global_insight_questions)) {
        if (profile.active_question_indices?.length) {
          const activeQuestions = profile.active_question_indices
            .map((idx: number) => profile.global_insight_questions[idx])
            .filter((q: any) => typeof q === 'string' && q);
          setQuestions(activeQuestions);
        } else {
          setQuestions(profile.global_insight_questions.filter((q: any) => typeof q === 'string'));
        }
      }
    }
  };

  const saveCard = async () => {
    const { error } = await supabase
      .from("reference_cards")
      .update({
        title: editedTitle,
        original_text: editedText,
        modified_by_user: true,
      })
      .eq("id", id);

    if (error) {
      toast.error("Failed to save changes");
    } else {
      toast.success("Changes saved");
      setEditing(false);
      loadCard();
    }
  };

  const processCard = async () => {
    setProcessing(true);
    toast.loading("Processing with AI...");

    const { data, error } = await supabase.functions.invoke("process-reference-card", {
      body: { cardId: id }
    });

    setProcessing(false);

    if (error) {
      console.error("Process card error:", error);
      toast.error("Failed to process card: " + (error.message || "Unknown error"));
    } else if (data?.error) {
      console.error("Process card data error:", data.error);
      toast.error("AI processing failed: " + data.error);
    } else {
      toast.success("Card processed successfully!");
      loadCard();
    }
  };

  useEffect(() => {
    loadCard();
  }, [id, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!card) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Card not found</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <Button variant="ghost" onClick={() => navigate("/cards")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Reference Cards
          </Button>
          <div className="flex gap-2">
            {!card.ai_summary && (
              <Button
                variant="outline"
                onClick={processCard}
                disabled={processing}
              >
                <Sparkles className="h-4 w-4 mr-1" />
                {processing ? "Processing..." : "Process with AI"}
              </Button>
            )}
            {editing ? (
              <>
                <Button variant="outline" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button onClick={saveCard}>
                  <Save className="mr-2 h-4 w-4" />
                  Save Changes
                </Button>
              </>
            ) : (
              <Button onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Card className="mb-6">
          <CardHeader>
            <div className="flex justify-between items-start">
              <div className="flex-1">
                {editing ? (
                  <Input
                    value={editedTitle}
                    onChange={(e) => setEditedTitle(e.target.value)}
                    className="text-2xl font-bold mb-2"
                  />
                ) : (
                  <CardTitle className="text-2xl mb-2">{card.title || "Untitled"}</CardTitle>
                )}
                <div className="flex flex-wrap gap-2 mt-3">
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
                  <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 mt-3">
                    <AlertCircle className="h-4 w-4" />
                    <span>{card.content_warning}</span>
                  </div>
                )}
              </div>
              {card.source_url && (
                <a
                  href={card.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:text-primary/80"
                >
                  <ExternalLink className="h-5 w-5" />
                </a>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {card.ai_summary && (
              <div className="mb-6 p-4 bg-muted rounded-md">
                <p className="text-sm font-medium mb-2">AI Summary:</p>
                <p className="text-sm text-muted-foreground">{card.ai_summary}</p>
              </div>
            )}

            <div className="mb-6">
              <Label className="text-base font-semibold mb-2 block">Full Article Content</Label>
              {editing ? (
                <Textarea
                  value={editedText}
                  onChange={(e) => setEditedText(e.target.value)}
                  className="min-h-[300px]"
                />
              ) : (
                <div className="prose max-w-none">
                  <p className="text-sm whitespace-pre-wrap">{card.original_text}</p>
                </div>
              )}
            </div>

            {card.insight_answers && Object.keys(card.insight_answers).length > 0 && (
              <div className="border-t pt-6">
                <h3 className="text-lg font-semibold mb-4">Processed Insights</h3>
                <div className="space-y-4">
                  {Object.entries(card.insight_answers).map(([key, value]) => {
                    const questionIndex = parseInt(key);
                    const question = questions[questionIndex];
                    return (
                      <Card key={key}>
                        <CardHeader>
                          <CardTitle className="text-base">
                            Q{questionIndex + 1}: {question || "Question not found"}
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm text-muted-foreground">{value as string}</p>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}

            {(!card.insight_answers || Object.keys(card.insight_answers).length === 0) && !card.ai_summary && (
              <div className="text-center py-8 text-muted-foreground">
                <p className="mb-2">This card hasn't been processed yet.</p>
                <p className="text-sm">Click "Process with AI" to analyze the content and answer insight questions.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default CardDetail;
