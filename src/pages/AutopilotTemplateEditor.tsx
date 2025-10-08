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
import { ArrowLeft, Save, X } from "lucide-react";

const AutopilotTemplateEditor = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [isEditing] = useState(!!id); // If we have an ID, we're editing
  const [availableFeeds, setAvailableFeeds] = useState<any[]>([]);
  const [availableTemplates, setAvailableTemplates] = useState<any[]>([]);

  const [formData, setFormData] = useState({
    name: "",
    is_active: true,
    frequency: "weekly",
    source_feed_ids: [] as string[],
    topic_filters: [] as string[],
    output_format: "blog_post",
    use_global_questions: true,
    custom_template_id: null as string | null,
  });

  const [newTopic, setNewTopic] = useState("");

  // Load available feeds and templates
  const loadData = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;

    // Load feeds
    const { data: feedsData } = await supabase
      .from("source_feeds")
      .select("id, name")
      .eq("user_id", session.user.id)
      .eq("is_active", true);

    setAvailableFeeds(feedsData || []);

    // Load reference card templates
    const { data: templatesData } = await supabase
      .from("reference_card_templates")
      .select("id, name")
      .eq("user_id", session.user.id);

    setAvailableTemplates(templatesData || []);
  };

  // Load template data if editing
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
        output_format: data.output_format || "blog_post",
        use_global_questions: data.use_global_questions ?? true,
        custom_template_id: data.custom_template_id || null,
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
        // Update existing template
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
        // Create new template
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
                      <SelectItem value="blog_post">Blog Post</SelectItem>
                      <SelectItem value="newsletter">Newsletter</SelectItem>
                      <SelectItem value="social_media">Social Media</SelectItem>
                      <SelectItem value="report">Report</SelectItem>
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

              <div className="flex items-center space-x-2">
                <Switch
                  checked={formData.use_global_questions}
                  onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, use_global_questions: checked }))}
                />
                <Label>Use Global Questions</Label>
              </div>

              {!formData.use_global_questions && (
                <div>
                  <Label htmlFor="custom_template">Custom Question Template</Label>
                  <Select
                    value={formData.custom_template_id || ""}
                    onValueChange={(value) => setFormData((prev) => ({ ...prev, custom_template_id: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a template" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableTemplates.map((template) => (
                        <SelectItem key={template.id} value={template.id}>
                          {template.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

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
