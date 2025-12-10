import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { ArrowLeft, Save, X, CheckCheck } from "lucide-react";

const AutopilotTemplateEditor = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [isEditing] = useState(!!id);
  const [availableFeeds, setAvailableFeeds] = useState<any[]>([]);
  const [availableTemplates, setAvailableTemplates] = useState<any[]>([]);

  const [formData, setFormData] = useState({
    name: "",
    is_active: true,
    frequency: "weekly",
    source_feed_ids: [] as string[],
    topic_filters: [] as string[],
    output_format: "text",
    use_global_questions: true,
    custom_template_id: null as string | null,
    approval_required: true,
  });

  const [newTopic, setNewTopic] = useState("");

  const loadData = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;

    const { data: feedsData } = await supabase
      .from("source_feeds")
      .select("id, name")
      .eq("user_id", session.user.id)
      .eq("is_active", true);

    setAvailableFeeds(feedsData || []);

    // Load question sets for custom template selection
    const { data: questionSetsData } = await supabase
      .from("question_sets")
      .select("id, name")
      .eq("user_id", session.user.id)
      .eq("is_active", true);

    setAvailableTemplates(questionSetsData || []);
  };

  const loadTemplate = async () => {
    if (!id) return;

    const { data, error } = await supabase.from("autopilot_templates").select("*").eq("id", id).single();

    if (error) {
      toast.error("Failed to load template");
      navigate("/autopilot");
    } else {
      setFormData({
        name: data.name || "",
        is_active: data.is_active ?? true,
        frequency: data.frequency || "weekly",
        source_feed_ids: data.source_feed_ids || [],
        topic_filters: data.topic_filters || [],
        output_format: data.output_format || "text",
        use_global_questions: data.use_global_questions ?? true,
        custom_template_id: data.custom_template_id || null,
        approval_required: data.approval_required !== false,
      });
    }
  };

  useEffect(() => {
    loadData();
    if (id) {
      loadTemplate();
    }
  }, [id]);

  const addTopic = () => {
    if (newTopic.trim() && !formData.topic_filters.includes(newTopic.trim())) {
      setFormData((prev) => ({
        ...prev,
        topic_filters: [...prev.topic_filters, newTopic.trim()],
      }));
      setNewTopic("");
    }
  };

  const removeTopic = (topic: string) => {
    setFormData((prev) => ({
      ...prev,
      topic_filters: prev.topic_filters.filter((t) => t !== topic),
    }));
  };

  const toggleFeed = (feedId: string) => {
    setFormData((prev) => ({
      ...prev,
      source_feed_ids: prev.source_feed_ids.includes(feedId)
        ? prev.source_feed_ids.filter((id) => id !== feedId)
        : [...prev.source_feed_ids, feedId],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      toast.error("You must be logged in");
      setLoading(false);
      return;
    }

    try {
      console.log("🟡 Saving template with data:", formData);

      if (isEditing) {
        const { data, error } = await supabase
          .from("autopilot_templates")
          .update({
            name: formData.name,
            is_active: formData.is_active,
            frequency: formData.frequency,
            source_feed_ids: formData.source_feed_ids,
            topic_filters: formData.topic_filters,
            output_format: formData.output_format,
            use_global_questions: formData.use_global_questions,
            custom_template_id: formData.custom_template_id,
            approval_required: formData.approval_required,
            updated_at: new Date().toISOString(),
          })
          .eq("id", id)
          .select();

        if (error) {
          console.error("❌ Update error:", error);
          throw error;
        }
        console.log("✅ Template updated:", data);
        toast.success("Template updated successfully");
      } else {
        const { data, error } = await supabase
          .from("autopilot_templates")
          .insert([
            {
              name: formData.name,
              is_active: formData.is_active,
              frequency: formData.frequency,
              source_feed_ids: formData.source_feed_ids,
              topic_filters: formData.topic_filters,
              output_format: formData.output_format,
              use_global_questions: formData.use_global_questions,
              custom_template_id: formData.custom_template_id,
              approval_required: formData.approval_required,
              user_id: session.user.id,
            },
          ])
          .select();

        if (error) {
          console.error("❌ Insert error:", error);
          throw error;
        }
        console.log("✅ Template created:", data);
        toast.success("Template created successfully");
      }

      navigate("/autopilot");
    } catch (error: any) {
      console.error("💥 Failed to save template:", error);
      toast.error(`Failed to save template: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <Button variant="ghost" onClick={() => navigate("/autopilot")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Templates
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>{isEditing ? "Edit Template" : "Create New Template"}</CardTitle>
            <CardDescription>Configure your automated content generation settings</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <Label htmlFor="name">Template Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Weekly Tech Insights"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="frequency">Frequency</Label>
                  <Select
                    value={formData.frequency}
                    onValueChange={(value) => setFormData((prev) => ({ ...prev, frequency: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="biweekly">Bi-weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="format">Output Format</Label>
                  <Select
                    value={formData.output_format}
                    onValueChange={(value) => setFormData((prev) => ({ ...prev, output_format: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="text">Text Content</SelectItem>
                      <SelectItem value="visual">Visual Content</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, is_active: checked }))}
                />
                <Label>Template Active</Label>
              </div>

              <div>
                <Label>Topic Filters</Label>
                <div className="flex gap-2 mb-2">
                  <Input
                    value={newTopic}
                    onChange={(e) => setNewTopic(e.target.value)}
                    placeholder="Add a topic..."
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTopic())}
                  />
                  <Button type="button" onClick={addTopic}>
                    Add
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {formData.topic_filters.map((topic) => (
                    <Badge key={topic} variant="secondary" className="flex items-center gap-1">
                      {topic}
                      <X className="h-3 w-3 cursor-pointer" onClick={() => removeTopic(topic)} />
                    </Badge>
                  ))}
                </div>
              </div>

              <div>
                <Label>Source Feeds</Label>
                <div className="space-y-2 mt-2 max-h-40 overflow-y-auto border rounded-md p-3">
                  {availableFeeds.map((feed) => (
                    <div key={feed.id} className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id={`feed-${feed.id}`}
                        checked={formData.source_feed_ids.includes(feed.id)}
                        onChange={() => toggleFeed(feed.id)}
                        className="rounded border-gray-300"
                      />
                      <Label htmlFor={`feed-${feed.id}`} className="text-sm">
                        {feed.name}
                      </Label>
                    </div>
                  ))}
                  {availableFeeds.length === 0 && (
                    <p className="text-sm text-muted-foreground">No active feeds available</p>
                  )}
                </div>
              </div>

              <div>
                <Label htmlFor="custom_template">Question Set</Label>
                <Select
                  value={formData.custom_template_id || "none"}
                  onValueChange={(value) => setFormData((prev) => ({ ...prev, custom_template_id: value === "none" ? null : value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a question set" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No question set</SelectItem>
                    {availableTemplates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {availableTemplates.length === 0 && (
                  <p className="text-sm text-muted-foreground mt-1">
                    No question sets available. Create one in Settings → Question Sets.
                  </p>
                )}
              </div>

              {/* Approval Settings Section */}
              <div className="border-t pt-6">
                <CardTitle className="text-lg mb-4">Approval Settings</CardTitle>
                
                <div className="flex items-center space-x-2 mb-4">
                  <Switch
                    checked={formData.approval_required}
                    onCheckedChange={(checked) => setFormData((prev) => ({ 
                      ...prev, 
                      approval_required: checked 
                    }))}
                  />
                  <Label className="flex items-center gap-2">
                    Require approval before publishing
                    <Badge variant="outline" className="text-xs">
                      Recommended
                    </Badge>
                  </Label>
                </div>

                {formData.approval_required && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <CheckCheck className="h-5 w-5 text-blue-600 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-blue-900 mb-1">
                          Human-in-the-Loop Workflow
                        </p>
                        <p className="text-sm text-blue-700">
                          Drafts will be created with 'pending' status and appear in your review queue for approval before publishing.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => navigate("/autopilot")}>
                  Cancel
                </Button>
                <Button type="submit" disabled={loading}>
                  <Save className="mr-2 h-4 w-4" />
                  {loading ? "Saving..." : isEditing ? "Update Template" : "Create Template"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default AutopilotTemplateEditor;