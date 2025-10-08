import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { InstructionsToggle } from "@/components/InstructionsToggle";

const QuestionSettings = () => {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<any[]>([]);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [questions, setQuestions] = useState<{ [key: string]: string[] }>({});

  const loadTemplates = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      navigate("/auth");
      return;
    }

    const { data, error } = await supabase
      .from("reference_card_templates")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to load templates");
    } else {
      setTemplates(data || []);
      const questionsMap: { [key: string]: string[] } = {};
      data?.forEach(template => {
        const customQuestions = template.custom_questions;
        if (Array.isArray(customQuestions)) {
          questionsMap[template.id] = customQuestions as string[];
        } else {
          questionsMap[template.id] = [];
        }
      });
      setQuestions(questionsMap);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, []);

  const createTemplate = async () => {
    if (!newTemplateName.trim()) {
      toast.error("Please enter a template name");
      return;
    }

    // Get actual user session
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast.error("You must be logged in to create templates");
      return;
    }

    const { error } = await supabase
      .from("reference_card_templates")
      .insert([{ 
        name: newTemplateName, 
        custom_questions: [],
        user_id: session.user.id
      }]);

    if (error) {
      toast.error("Failed to create template");
    } else {
      toast.success("Template created");
      setNewTemplateName("");
      loadTemplates();
    }
  };

  const addQuestion = async (templateId: string) => {
    const newQuestion = prompt("Enter your question:");
    if (!newQuestion) return;

    const currentQuestions = questions[templateId] || [];
    const updatedQuestions = [...currentQuestions, newQuestion];

    const { error } = await supabase
      .from("reference_card_templates")
      .update({ custom_questions: updatedQuestions })
      .eq("id", templateId);

    if (error) {
      toast.error("Failed to add question");
    } else {
      setQuestions(prev => ({ ...prev, [templateId]: updatedQuestions }));
      toast.success("Question added");
    }
  };

  const removeQuestion = async (templateId: string, questionIndex: number, question: string) => {
    if (!confirm(`Are you sure you want to delete this question: "${question}"?`)) {
      return;
    }

    const currentQuestions = questions[templateId] || [];
    const updatedQuestions = currentQuestions.filter((_, i) => i !== questionIndex);

    const { error } = await supabase
      .from("reference_card_templates")
      .update({ custom_questions: updatedQuestions })
      .eq("id", templateId);

    if (error) {
      toast.error("Failed to remove question");
    } else {
      setQuestions(prev => ({ ...prev, [templateId]: updatedQuestions }));
      toast.success("Question removed");
    }
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

      <main className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-4">Reference Card Questions</h1>
        
        <InstructionsToggle 
          instructions={`Set up custom questions that will be asked when creating reference cards from your sources.

1. Create a template with a name
2. Add questions to each template
3. Assign templates to feeds or use when creating manual reference cards

These questions help extract insights from your content automatically.`}
        />

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Create New Template</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Input
                placeholder="Template name..."
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createTemplate()}
              />
              <Button onClick={createTemplate}>
                <Plus className="h-4 w-4 mr-2" />
                Create
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4">
          {templates.map((template) => (
            <Card key={template.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  {template.name}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => addQuestion(template.id)}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Question
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {questions[template.id]?.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No questions yet. Add some!</p>
                ) : (
                  <ul className="space-y-2">
                    {questions[template.id]?.map((q, i) => (
                      <li key={i} className="flex items-center justify-between p-2 border rounded">
                        <span className="text-sm">{q}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeQuestion(template.id, i, q)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
};

export default QuestionSettings;
