import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Plus, ToggleLeft, ToggleRight, Edit, Trash2, Clock, CheckCheck, Play } from "lucide-react";

const AutopilotTemplates = () => {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<any[]>([]);
  const [templateCount, setTemplateCount] = useState(0);
  const [draftStats, setDraftStats] = useState<{[key: string]: number}>({});
  const MAX_TEMPLATES = 12;

  const loadTemplates = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      navigate("/auth");
      return;
    }

    const { data, error, count } = await supabase
      .from("autopilot_templates")
      .select("*", { count: "exact" })
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to load templates");
    } else {
      setTemplates(data || []);
      setTemplateCount(count || 0);
      loadDraftStats(data || []);
    }
  };

  const loadDraftStats = async (templates: any[]) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const templateIds = templates.map(t => t.id);
    if (templateIds.length === 0) return;

    const { data, error } = await supabase
      .from("drafts")
      .select("autopilot_template_id, approval_status")
      .in("autopilot_template_id", templateIds);

    if (error) {
      console.error("Error loading draft stats:", error);
      return;
    }

    const stats: {[key: string]: number} = {};
    templates.forEach(template => {
      const templateDrafts = data?.filter(d => d.autopilot_template_id === template.id) || [];
      stats[template.id] = templateDrafts.filter(d => d.approval_status === 'pending').length;
    });

    setDraftStats(stats);
  };

  useEffect(() => {
    loadTemplates();
  }, [navigate]);

  const toggleTemplate = async (template: any) => {
    const { error } = await supabase
      .from("autopilot_templates")
      .update({ is_active: !template.is_active })
      .eq("id", template.id);

    if (error) {
      toast.error("Failed to toggle template");
    } else {
      toast.success(template.is_active ? "Template disabled" : "Template enabled");
      loadTemplates();
    }
  };

  const deleteTemplate = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete "${name}"? This action cannot be undone.`)) {
      return;
    }

    const { error } = await supabase
      .from("autopilot_templates")
      .delete()
      .eq("id", id);

    if (error) {
      toast.error("Failed to delete template");
    } else {
      toast.success("Template deleted");
      loadTemplates();
    }
  };

 // ❌ REPLACE THIS WHOLE FUNCTION (lines ~78-100):
const testRunTemplate = async (template: any) => {
  toast.info("Running test generation...");
  
  try {
    const { data, error } = await supabase.functions.invoke("pull-rss-feed", {
      body: {
        templateId: template.id,
        isTestRun: true
      }
    });

    if (error) {
      throw error;
    }

    if (data.success) {
      toast.success("Test run completed! Check your review queue for the new draft.");
      loadTemplates(); // Refresh to show new draft count
    } else {
      toast.error("Test run failed: " + (data.error || "Unknown error"));
    }
  } catch (error) {
    console.error("Test run error:", error);
    toast.error("Test run failed");
  }
};

// ✅ WITH THIS UPDATED VERSION:
const testRunTemplate = async (template: any) => {
  toast.info("Running test generation...");
  
  try {
    const { data, error } = await supabase.functions.invoke("execute-autopilot-template", {
      body: {
        templateId: template.id,
        isTestRun: true
      }
    });

    if (error) {
      throw error;
    }

    if (data.success) {
      toast.success(`Test run completed! Created ${data.draftsCreated} draft(s). Check your review queue.`);
      loadTemplates(); // Refresh to show new draft count
    } else {
      toast.error("Test run failed: " + (data.error || "Unknown error"));
    }
  } catch (error) {
    console.error("Test run error:", error);
    toast.error("Test run failed");
  }
};

  const getNextRunTime = (template: any) => {
    if (!template.is_active) return "Paused";
    if (template.next_run_at) {
      return new Date(template.next_run_at).toLocaleDateString();
    }
    
    // Fallback calculation based on frequency
    const now = new Date();
    switch (template.frequency) {
      case 'daily': return 'Tomorrow';
      case 'weekly': return 'Next week';
      case 'biweekly': return 'In 2 weeks';
      case 'monthly': return 'Next month';
      default: return 'Soon';
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <Button variant="ghost" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              {templateCount}/{MAX_TEMPLATES} templates
            </span>
            <Button 
              onClick={() => navigate("/autopilot/new")}
              disabled={templateCount >= MAX_TEMPLATES}
            >
              <Plus className="mr-2 h-4 w-4" />
              New Template
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Autopilot Templates</h1>
          <p className="text-muted-foreground">
            Manage your automated content generation templates
          </p>
        </div>

        <div className="grid gap-4">
          {templates.map((template) => (
            <Card key={template.id} className="hover:shadow-md transition-shadow">
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <CardTitle>{template.name}</CardTitle>
                      {draftStats[template.id] > 0 && (
                        <Badge variant="destructive" className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {draftStats[template.id]} pending
                        </Badge>
                      )}
                    </div>
                    <CardDescription className="mt-1">
                      {template.frequency} • {template.output_format} • Next run: {getNextRunTime(template)}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button 
                      variant="outline"
                      size="sm"
                      onClick={() => testRunTemplate(template)}
                    >
                      <Play className="h-4 w-4 mr-1" />
                      Test Run
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => toggleTemplate(template)}
                    >
                      {template.is_active ? 
                        <ToggleRight className="h-5 w-5 text-primary" /> : 
                        <ToggleLeft className="h-5 w-5" />
                      }
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => navigate(`/autopilot/${template.id}/edit`)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => deleteTemplate(template.id, template.name)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2 mb-3">
                  <Badge variant={template.is_active ? "default" : "secondary"}>
                    {template.is_active ? "Active" : "Inactive"}
                  </Badge>
                  <Badge variant="outline">
                    Requires Approval
                  </Badge>
                  {template.topic_filters?.map((topic: string) => (
                    <Badge key={topic} variant="outline">{topic}</Badge>
                  ))}
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">
                    {template.source_feed_ids?.length || 0} feeds configured
                  </span>
                  {draftStats[template.id] > 0 && (
                    <Button 
                      variant="default" 
                      size="sm"
                      onClick={() => navigate("/review")}
                    >
                      <CheckCheck className="h-4 w-4 mr-1" />
                      Review Drafts
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {templates.length === 0 && (
          <div className="text-center py-12">
            <h3 className="text-lg font-semibold mb-2">No autopilot templates yet</h3>
            <p className="text-muted-foreground mb-4">
              Create your first template to automate content generation
            </p>
            <Button onClick={() => navigate("/autopilot/new")}>
              <Plus className="mr-2 h-4 w-4" />
              Create Template
            </Button>
          </div>
        )}
      </main>
    </div>
  );
};

export default AutopilotTemplates;