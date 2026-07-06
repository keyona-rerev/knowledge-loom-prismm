import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { ArrowLeft, Save, ExternalLink, AlertCircle, Sparkles, MessageSquare, CheckCircle2, Trash2 } from "lucide-react";

const CardDetail = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const [card, setCard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const [editedText, setEditedText] = useState("");
  const [editedFromCompany, setEditedFromCompany] = useState(false);
  const [editedApproved, setEditedApproved] = useState(false);
  const [questions, setQuestions] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [questionSets, setQuestionSets] = useState<any[]>([]);
  const [selectedQuestionSetId, setSelectedQuestionSetId] = useState<string>("");
  const [customQuestion, setCustomQuestion] = useState("");
  const [askingCustomQuestion, setAskingCustomQuestion] = useState(false);

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
      setEditedFromCompany(data.from_company ?? false);
      setEditedApproved(data.approved ?? false);
      await loadQuestions(data);
    }
    setLoading(false);
  };

  const loadQuestions = async (cardData: any) => {
    // Load questions from template or question set
    if (cardData.reference_card_templates?.custom_questions) {
      const templateQuestions = cardData.reference_card_templates.custom_questions;
      if (Array.isArray(templateQuestions)) {
        setQuestions(templateQuestions.filter((q: any) => typeof q === 'string'));
      }
    } else if (cardData.question_set_id) {
      // Load from question set
      setSelectedQuestionSetId(cardData.question_set_id);
      const { data: questionSet } = await supabase
        .from("question_sets")
        .select("questions")
        .eq("id", cardData.question_set_id)
        .single();
      
      if (questionSet?.questions && Array.isArray(questionSet.questions)) {
        setQuestions(questionSet.questions.filter((q: any) => typeof q === 'string'));
      }
    } else {
      // Load default question set for user
      const { data: { session } } = await supabase.auth.getSession();
      const { data: defaultSet } = await supabase
        .from("question_sets")
        .select("questions")
        .eq("user_id", session?.user?.id)
        .eq("name", "Default Questions")
        .single();
      
      if (defaultSet?.questions && Array.isArray(defaultSet.questions)) {
        setQuestions(defaultSet.questions.filter((q: any) => typeof q === 'string'));
      }
    }
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

  const saveCard = async () => {
    const { error } = await supabase
      .from("reference_cards")
      .update({
        title: editedTitle,
        original_text: editedText,
        from_company: editedFromCompany,
        approved: editedApproved,
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

  // Quick approve/reject right from the header, independent of Edit mode —
  // entering Edit, flipping a switch, and Saving just to approve a card was
  // several clicks for something that should be one.
  const toggleApproved = async () => {
    setApproving(true);
    const next = !card.approved;
    const { error } = await supabase.from("reference_cards").update({ approved: next }).eq("id", id);
    setApproving(false);
    if (error) { toast.error("Failed to update approval"); return; }
    setCard((prev: any) => ({ ...prev, approved: next }));
    setEditedApproved(next);
    toast.success(next ? "Approved — citable in generated content now." : "Approval removed.");
  };

  // Deletes the card outright. "Reject" here means the source shouldn't
  // exist, not just "not approved" (already every new card's default).
  const rejectCard = async () => {
    if (!confirm(`Delete "${card.title || "this card"}"? This action cannot be undone.`)) return;
    setRejecting(true);
    const { error } = await supabase.from("reference_cards").delete().eq("id", id);
    setRejecting(false);
    if (error) { toast.error("Failed to delete card"); return; }
    toast.success("Card deleted");
    navigate("/cards");
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
    } else if (data?.deleted) {
      // The card scored below the user's configured auto-delete threshold
      // (see process-reference-card) and no longer exists — nothing left
      // here to reload, so leave the detail page entirely.
      toast.warning(data.reason || "Card auto-deleted for low relevance score");
      navigate("/cards");
    } else {
      toast.success("Card processed successfully!");
      loadCard();
    }
  };

  const reprocessWithQuestionSet = async () => {
    if (!selectedQuestionSetId) {
      toast.error("Please select a question set");
      return;
    }

    // Update the card's question set
    const { error: updateError } = await supabase
      .from("reference_cards")
      .update({ question_set_id: selectedQuestionSetId })
      .eq("id", id);

    if (updateError) {
      toast.error("Failed to update question set");
      return;
    }

    // Reprocess the card
    await processCard();
  };

  const askCustomQuestion = async () => {
    if (!customQuestion.trim()) {
      toast.error("Please enter a question");
      return;
    }

    setAskingCustomQuestion(true);
    toast.loading("Getting answer...");

    const { data, error } = await supabase.functions.invoke("process-reference-card", {
      body: { 
        cardId: id,
        customQuestion: customQuestion.trim()
      }
    });

    setAskingCustomQuestion(false);

    if (error) {
      console.error("Custom question error:", error);
      toast.error("Failed to get answer: " + (error.message || "Unknown error"));
    } else if (data?.error) {
      console.error("Custom question data error:", data.error);
      toast.error("AI processing failed: " + data.error);
    } else if (data?.deleted) {
      // Answering a custom question still rescoring the card through the
      // same relevance check — a card below the auto-delete threshold gets
      // removed rather than answered. Surface why, since the question
      // itself never got saved anywhere.
      toast.warning(data.reason || "Card auto-deleted for low relevance score before the question could be answered");
      navigate("/cards");
    } else {
      toast.success("Custom question answered and saved to card!");
      setCustomQuestion("");
      loadCard();
    }
  };

  useEffect(() => {
    loadCard();
    loadQuestionSets();
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
        <div className="container mx-auto px-4 py-4 flex justify-between items-center flex-wrap gap-2">
          <Button variant="ghost" onClick={() => navigate("/cards")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Reference Cards
          </Button>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant={card.approved ? "outline" : "default"}
              onClick={toggleApproved}
              disabled={approving}
            >
              <CheckCircle2 className="h-4 w-4 mr-1" />
              {approving ? "Updating..." : card.approved ? "Unapprove" : "Approve"}
            </Button>
            <Button
              variant="outline"
              className="text-red-600 border-red-200 hover:bg-red-50"
              onClick={rejectCard}
              disabled={rejecting}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              {rejecting ? "Deleting..." : "Reject"}
            </Button>
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
              <Button variant="outline" onClick={() => setEditing(true)}>
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
                  <Badge variant={card.approved ? "default" : "outline"}>
                    {card.approved ? "Approved source" : "Not approved"}
                  </Badge>
                  {card.from_company && <Badge variant="default">From the company</Badge>}
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

            {editing && (
              <div className="mb-6 space-y-3">
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5 pr-3">
                    <Label>Approved source</Label>
                    <p className="text-sm text-muted-foreground">
                      Only approved cards are trusted, citable sources for generation. Approval is deliberate and never set automatically on ingest.
                    </p>
                  </div>
                  <Switch checked={editedApproved} onCheckedChange={setEditedApproved} />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5 pr-3">
                    <Label>From the company (first-party)</Label>
                    <p className="text-sm text-muted-foreground">
                      Mark this as Prismm's own material so the writer can weight and anchor on it.
                    </p>
                  </div>
                  <Switch checked={editedFromCompany} onCheckedChange={setEditedFromCompany} />
                </div>
              </div>
            )}

            {card.insight_answers && Object.keys(card.insight_answers).length > 0 && (
              <div className="border-t pt-6">
                <h3 className="text-lg font-semibold mb-4">Processed Insights</h3>
                <div className="space-y-4">
                  {Object.entries(card.insight_answers).map(([key, value]) => {
                    // Check if this is a custom question (has question property)
                    const isCustom = typeof value === 'object' && value !== null && 'question' in value;
                    
                    if (isCustom) {
                      const customData = value as { question: string; answer: string; timestamp: string };
                      return (
                        <Card key={key} className="border-l-4 border-l-blue-500">
                          <CardHeader>
                            <div className="flex items-start justify-between">
                              <CardTitle className="text-base flex items-center gap-2">
                                <MessageSquare className="h-4 w-4 text-blue-500" />
                                Custom: {customData.question}
                              </CardTitle>
                              <Badge variant="secondary" className="text-xs">
                                {new Date(customData.timestamp).toLocaleDateString()}
                              </Badge>
                            </div>
                          </CardHeader>
                          <CardContent>
                            <p className="text-sm text-muted-foreground">{customData.answer}</p>
                          </CardContent>
                        </Card>
                      );
                    } else {
                      // Standard question from a question set. insight_answers
                      // is keyed by the literal question text itself (see
                      // process-reference-card's prompt construction:
                      // "answers": {"<question text>": "answer"}), not a
                      // numeric index — the key IS the question, so it's
                      // rendered directly rather than looked up by parseInt
                      // against the locally-loaded questions array (which
                      // silently produced "QNaN" for every card, since a
                      // full sentence never parses as a number).
                      return (
                        <Card key={key}>
                          <CardHeader>
                            <CardTitle className="text-base">
                              {key}
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <p className="text-sm text-muted-foreground">{value as string}</p>
                          </CardContent>
                        </Card>
                      );
                    }
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

        {/* Reprocess with Question Set */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Reprocess with Different Question Set</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Select value={selectedQuestionSetId} onValueChange={setSelectedQuestionSetId}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select a question set..." />
                </SelectTrigger>
                <SelectContent>
                  {questionSets.map((qs) => (
                    <SelectItem key={qs.id} value={qs.id}>
                      {qs.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button 
                onClick={reprocessWithQuestionSet}
                disabled={processing || !selectedQuestionSetId}
              >
                <Sparkles className="h-4 w-4 mr-1" />
                Reprocess
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Ask Custom Question */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Ask a Custom Question</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Textarea
                value={customQuestion}
                onChange={(e) => setCustomQuestion(e.target.value)}
                placeholder="Enter your custom question about this content..."
                rows={3}
              />
              <Button 
                onClick={askCustomQuestion}
                disabled={askingCustomQuestion || !customQuestion.trim()}
                className="w-full"
              >
                <MessageSquare className="h-4 w-4 mr-1" />
                {askingCustomQuestion ? "Getting Answer..." : "Ask Question"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default CardDetail;
