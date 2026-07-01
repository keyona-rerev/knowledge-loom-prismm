import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Save, X, Database } from "lucide-react";

interface InsightFormData {
  title: string;
  content: string;
  insight_type: string;
  context: string;
  priority: number;
  tags: string[];
}

const InsightDetail = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditing = Boolean(id);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [referenceCardId, setReferenceCardId] = useState<string | null>(null);

  const [formData, setFormData] = useState<InsightFormData>({
    title: "",
    content: "",
    insight_type: "observation",
    context: "",
    priority: 3,
    tags: []
  });

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/auth");
      }
    };
    checkAuth();

    if (isEditing) {
      loadInsight();
    }
  }, [navigate, id, isEditing]);

  const loadInsight = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();

    const { data, error } = await supabase
      .from("insight_cards")
      .select("*")
      .eq("id", id)
      .eq("user_id", session?.user?.id)
      .single();

    if (error) {
      console.error("Error loading insight:", error);
      toast.error("Failed to load insight");
      navigate("/feeds?tab=observations");
    } else if (data) {
      setFormData({
        title: data.title || "",
        content: data.content || "",
        insight_type: data.insight_type || "observation",
        context: data.context || "",
        priority: data.priority || 3,
        tags: data.tags || []
      });
      setReferenceCardId((data as any).reference_card_id || null);
    }
    setLoading(false);
  };

  // Keeps the insight's reference card (auto-created on first save) in sync.
  // Updates the existing card if one is already linked; creates one on first
  // save so capture and citable-source availability happen in the same flow,
  // no separate "convert" step. Approved true by default: capturing a journal
  // entry is already a deliberate act, source_type "observation" is what
  // distinguishes it from sourced/verified material in generation.
  const syncReferenceCard = async (insightId: string, userId: string) => {
    const payload = { title: formData.title, original_text: formData.content };
    if (referenceCardId) {
      await supabase.from("reference_cards").update(payload).eq("id", referenceCardId);
      return;
    }
    const { data, error } = await supabase
      .from("reference_cards")
      .insert({
        ...payload,
        user_id: userId,
        source_type: "observation",
        status: "active",
        approved: true,
      })
      .select("id")
      .single();
    if (error) {
      console.error("Failed to create reference card for insight:", error);
      return;
    }
    await supabase.from("insight_cards").update({ reference_card_id: data.id }).eq("id", insightId);
    setReferenceCardId(data.id);
  };

  const handleSave = async () => {
    if (!formData.title.trim() || !formData.content.trim()) {
      toast.error("Please fill in title and content");
      return;
    }

    setSaving(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) {
      toast.error("You must be logged in");
      setSaving(false);
      return;
    }

    try {
      let insightId = id;
      if (isEditing && id) {
        const { error } = await supabase
          .from("insight_cards")
          .update({
            ...formData,
            updated_at: new Date().toISOString()
          })
          .eq("id", id);

        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("insight_cards")
          .insert({
            ...formData,
            user_id: session.user.id,
            status: "active"
          })
          .select("id")
          .single();

        if (error) throw error;
        insightId = data.id;
      }

      if (insightId) await syncReferenceCard(insightId, session.user.id);

      toast.success(isEditing ? "Insight updated" : "Insight captured and added to your reference library");
      navigate("/feeds?tab=observations");
    } catch (error) {
      console.error("Error saving insight:", error);
      toast.error(`Failed to ${isEditing ? 'update' : 'create'} insight`);
    } finally {
      setSaving(false);
    }
  };

  const addTag = () => {
    const tag = tagInput.trim();
    if (tag && !formData.tags.includes(tag)) {
      setFormData(prev => ({
        ...prev,
        tags: [...prev.tags, tag]
      }));
      setTagInput("");
    }
  };

  const removeTag = (tagToRemove: string) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags.filter(tag => tag !== tagToRemove)
    }));
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag();
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b">
          <div className="container mx-auto px-4 py-4">
            <Button variant="ghost" onClick={() => navigate("/feeds?tab=observations")}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Sources
            </Button>
          </div>
        </header>
        <main className="container mx-auto px-4 py-8 max-w-2xl">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-1/3 mb-8"></div>
            <div className="space-y-4">
              <div className="h-12 bg-gray-200 rounded"></div>
              <div className="h-32 bg-gray-200 rounded"></div>
              <div className="h-24 bg-gray-200 rounded"></div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <Button variant="ghost" onClick={() => navigate("/feeds?tab=observations")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Sources
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">
            {isEditing ? "Edit Insight" : "New Insight"}
          </h1>
          <p className="text-muted-foreground">
            {isEditing
              ? "Update your insight card. Saving keeps its reference card in sync."
              : "Capture a new observation, thesis, or idea. Saving adds it to your reference library automatically, no separate convert step."}
          </p>
        </div>

        <Card>
          <CardContent className="p-6 space-y-6">
            {/* Title */}
            <div>
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                placeholder="Brief, descriptive title for your insight..."
                className="mt-2"
              />
            </div>

            {/* Content */}
            <div>
              <Label htmlFor="content">Content *</Label>
              <Textarea
                id="content"
                value={formData.content}
                onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
                placeholder="Describe your insight, observation, or idea in detail..."
                rows={6}
                className="mt-2"
              />
            </div>

            {/* Insight Type */}
            <div>
              <Label htmlFor="type">Insight Type</Label>
              <Select 
                value={formData.insight_type} 
                onValueChange={(value) => setFormData(prev => ({ ...prev, insight_type: value }))}
              >
                <SelectTrigger id="type" className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="thesis">Thesis Statement</SelectItem>
                  <SelectItem value="hook">Hook / Attention Grabber</SelectItem>
                  <SelectItem value="contrarian">Contrarian Argument</SelectItem>
                  <SelectItem value="closing">Closing Statement</SelectItem>
                  <SelectItem value="observation">Observation</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Priority */}
            <div>
              <Label htmlFor="priority">Priority</Label>
              <Select 
                value={formData.priority.toString()} 
                onValueChange={(value) => setFormData(prev => ({ ...prev, priority: parseInt(value) }))}
              >
                <SelectTrigger id="priority" className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 - Highest (Urgent/Foundation)</SelectItem>
                  <SelectItem value="2">2 - High (Important)</SelectItem>
                  <SelectItem value="3">3 - Medium (Standard)</SelectItem>
                  <SelectItem value="4">4 - Low (Background)</SelectItem>
                  <SelectItem value="5">5 - Lowest (Reference)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Context */}
            <div>
              <Label htmlFor="context">Context (Optional)</Label>
              <Input
                id="context"
                value={formData.context}
                onChange={(e) => setFormData(prev => ({ ...prev, context: e.target.value }))}
                placeholder="When/where did this insight occur? (e.g., 'During team meeting', 'While reading X')"
                className="mt-2"
              />
            </div>

            {/* Tags */}
            <div>
              <Label htmlFor="tags">Tags</Label>
              <div className="flex gap-2 mt-2">
                <Input
                  id="tags"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Add tags..."
                  className="flex-1"
                />
                <Button type="button" variant="outline" onClick={addTag}>
                  Add
                </Button>
              </div>
              
              {formData.tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {formData.tags.map((tag, index) => (
                    <Badge key={index} variant="secondary" className="flex items-center gap-1">
                      {tag}
                      <X 
                        className="h-3 w-3 cursor-pointer" 
                        onClick={() => removeTag(tag)}
                      />
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex justify-between pt-4">
              {isEditing && referenceCardId ? (
                <Button
                  variant="outline"
                  onClick={() => navigate(`/cards/${referenceCardId}`)}
                  type="button"
                >
                  <Database className="mr-2 h-4 w-4" />
                  View reference card
                </Button>
              ) : <div />}
              <div className={!isEditing ? "ml-auto" : ""}>
                <Button onClick={handleSave} disabled={saving}>
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? "Saving..." : (isEditing ? "Update Insight" : "Create Insight")}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default InsightDetail;