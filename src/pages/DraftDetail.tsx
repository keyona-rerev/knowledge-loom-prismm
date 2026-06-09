import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { ArrowLeft, FileText, Clock, Edit, Save, Sparkles, ImageIcon } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { VisualForge } from "@/components/VisualForge";

interface ContentTemplate {
  id: string;
  name: string;
  description: string;
  content_type: string;
  template_structure: any;
}

const DraftDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editedBody, setEditedBody] = useState("");
  const [editedSeedInsight, setEditedSeedInsight] = useState("");
  const [templates, setTemplates] = useState<ContentTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [regenerating, setRegenerating] = useState(false);
  const [revisions, setRevisions] = useState<any[]>([]);
  const [userId, setUserId] = useState<string>("");

  const getApprovalBadgeVariant = (status?: string) => {
    switch (status) {
      case "approved": return "default";
      case "rejected": return "destructive";
      case "pending":
      default: return "secondary";
    }
  };

  const loadDraft = async () => {
    if (!id) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.id) setUserId(session.user.id);

    const { data, error } = await supabase
      .from("drafts")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      toast.error("Failed to load draft");
      navigate("/drafts");
    } else {
      setDraft(data);
      setEditedBody(data.body || "");
      setEditedSeedInsight(data.seed_insight || "");
      setSelectedTemplate(data.autopilot_template_id || "");
      setLoading(false);
    }
  };

  const loadRevisions = async () => {
    if (!id) return;
    const { data, error } = await supabase
      .from("draft_revisions")
      .select("*")
      .eq("draft_id", id)
      .order("version", { ascending: false });
    if (!error && data) setRevisions(data);
  };

  const loadTemplates = async () => {
    try {
      const { data, error } = await supabase
        .from("content_templates")
        .select("*")
        .eq("is_active", true)
        .order("name");
      if (error) {
        if (error.code === '42P01') { setTemplates([]); return; }
      } else {
        setTemplates(data || []);
      }
    } catch (error) {
      console.error("Error loading templates:", error);
    }
  };

  useEffect(() => {
    loadDraft();
    loadTemplates();
    loadRevisions();
  }, [id]);

  const handleSave = async () => {
    if (!draft) return;
    const { error } = await supabase
      .from("drafts")
      .update({ body: editedBody, seed_insight: editedSeedInsight, updated_at: new Date().toISOString() })
      .eq("id", draft.id);
    if (error) { toast.error("Failed to save draft"); } else {
      toast.success("Draft saved");
      setIsEditing(false);
      loadDraft();
      loadRevisions();
    }
  };

  const handleRegenerate = async () => {
    if (!draft || !selectedTemplate) { toast.error("Please select a template"); return; }
    setRegenerating(true);
    toast.info("Regenerating draft with template...");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke("regenerate-draft-with-feedback", {
        body: { draftId: draft.id, templateId: selectedTemplate, userId: session?.user?.id, feedback: "Regenerate with selected template structure" },
      });
      if (error) throw error;
      if (data.success) { toast.success("Draft regenerated with template!"); await loadDraft(); } else { toast.error("Failed to regenerate draft"); }
    } catch (error) {
      toast.error("Failed to regenerate draft: " + (error as any)?.message);
    } finally {
      setRegenerating(false);
    }
  };

  const handleApprove = async () => {
    if (!draft) return;
    const { data: { session } } = await supabase.auth.getSession();
    const { error } = await supabase
      .from("drafts")
      .update({ approval_status: "approved", reviewed_at: new Date().toISOString() })
      .eq("id", draft.id);
    if (error) {
      toast.error("Failed to approve draft");
    } else {
      toast.success("Draft approved! Generating visual...");
      await loadDraft();
      // Trigger visual generation in background
      if (session?.user?.id) {
        supabase.functions.invoke("generate-draft-visual", {
          body: { draftId: draft.id, userId: session.user.id }
        }).catch(err => console.error("Visual generation error:", err));
      }
    }
  };

  const handleReject = async () => {
    if (!draft) return;
    const { error } = await supabase
      .from("drafts")
      .update({ approval_status: "rejected", reviewed_at: new Date().toISOString() })
      .eq("id", draft.id);
    if (error) { toast.error("Failed to reject draft"); } else { toast.success("Draft rejected"); await loadDraft(); }
  };

  if (loading) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><div>Loading draft...</div></div>;
  }

  if (!draft) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><div>Draft not found</div></div>;
  }

  const isApproved = draft.approval_status === "approved";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <Button variant="ghost" onClick={() => navigate("/drafts")}>
            <ArrowLeft className="mr-2 h-4 w-4" />Back to Drafts
          </Button>
          <div className="flex gap-2">
            {isEditing ? (
              <>
                <Button variant="outline" onClick={() => setIsEditing(false)}>Cancel</Button>
                <Button onClick={handleSave}><Save className="mr-2 h-4 w-4" />Save</Button>
              </>
            ) : (
              <>
                {templates.length > 0 && (
                  <Button onClick={handleRegenerate} disabled={regenerating} variant="outline">
                    <Sparkles className="mr-2 h-4 w-4" />{regenerating ? "Regenerating..." : "Regenerate with Template"}
                  </Button>
                )}
                <Button variant="outline" onClick={handleApprove}>Approve</Button>
                <Button variant="destructive" onClick={handleReject}>Reject</Button>
                <Button onClick={() => setIsEditing(true)}><Edit className="mr-2 h-4 w-4" />Edit</Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <Card>
          <CardHeader>
            <div className="flex justify-between items-start">
              <div className="flex-1">
                <CardTitle className="text-2xl">{draft.title || "Untitled Draft"}</CardTitle>
                <CardDescription className="mt-1 flex items-center gap-2">
                  <Clock className="h-3 w-3" />
                  Last updated {formatDistanceToNow(new Date(draft.updated_at), { addSuffix: true })}
                </CardDescription>
              </div>
              <FileText className="h-6 w-6 text-muted-foreground" />
            </div>

            {templates.length > 0 && !isEditing && (
              <div className="mt-4">
                <Label htmlFor="regenerate-template" className="text-sm font-medium">Regenerate with Template</Label>
                <div className="flex gap-2 mt-1">
                  <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                    <SelectTrigger id="regenerate-template" className="flex-1">
                      <SelectValue placeholder="Select template..." />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((template) => (
                        <SelectItem key={template.id} value={template.id}>
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4" />{template.name}
                            <span className="text-xs text-muted-foreground ml-1">({template.content_type})</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {selectedTemplate && (
                  <p className="text-sm text-muted-foreground mt-1">{templates.find(t => t.id === selectedTemplate)?.description}</p>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2 mt-3">
              <Badge variant={getApprovalBadgeVariant(draft.approval_status)}>{(draft.approval_status || "pending").replace("_", " ")}</Badge>
              <Badge variant="default">{draft.status?.replace("_", " ") || "draft"}</Badge>
              <Badge variant="outline">{draft.content_type || "ad-hoc"}</Badge>
              {draft.autopilot_template_id && (
                <Badge variant="secondary">Template: {templates.find(t => t.id === draft.autopilot_template_id)?.name || "Unknown"}</Badge>
              )}
              {draft.revision_count > 0 && <Badge variant="secondary">v{draft.revision_count + 1}</Badge>}
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            {(draft.seed_insight || isEditing) && (
              <div>
                <h3 className="font-semibold mb-2">Seed Insight</h3>
                {isEditing ? (
                  <Textarea value={editedSeedInsight} onChange={(e) => setEditedSeedInsight(e.target.value)} rows={3} placeholder="Enter the seed insight for this draft..." className="text-sm" />
                ) : (
                  <p className="text-sm text-muted-foreground p-3 bg-muted rounded-lg">{draft.seed_insight}</p>
                )}
              </div>
            )}

            <div>
              <h3 className="font-semibold mb-2">Content</h3>
              {isEditing ? (
                <Textarea value={editedBody} onChange={(e) => setEditedBody(e.target.value)} rows={20} className="font-mono text-sm" />
              ) : (
                <div className="p-4 bg-muted rounded-lg whitespace-pre-wrap font-mono text-sm">{draft.body}</div>
              )}
            </div>

            {draft.selected_direction && (
              <div>
                <h3 className="font-semibold mb-2">Selected Direction</h3>
                <Card>
                  <CardContent className="p-4">
                    <h4 className="font-semibold mb-1">{draft.selected_direction.title || "No title"}</h4>
                    <p className="text-sm text-muted-foreground mb-1">{draft.selected_direction.description || "No description"}</p>
                    {draft.selected_direction.angle && (
                      <p className="text-xs text-muted-foreground italic">Angle: {draft.selected_direction.angle}</p>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {/* VisualForge — only shown for approved drafts */}
            {isApproved && userId && (
              <>
                <Separator />
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <ImageIcon className="h-5 w-5 text-muted-foreground" />
                    <h3 className="font-semibold">Visual</h3>
                    <span className="text-xs text-muted-foreground">Auto-generated on approval</span>
                  </div>
                  <VisualForge draftId={draft.id} userId={userId} />
                </div>
              </>
            )}

            {revisions.length > 0 && (
              <div>
                <h3 className="font-semibold mb-2">Version History ({revisions.length + 1} versions)</h3>
                <div className="space-y-2">
                  <Card className="border-2 border-primary">
                    <CardContent className="p-3">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium">Current Version (v{(draft.revision_count || 0) + 1})</span>
                        <Badge>Latest</Badge>
                      </div>
                    </CardContent>
                  </Card>
                  {revisions.map((revision) => (
                    <Card key={revision.id}>
                      <CardContent className="p-3">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-sm font-medium">Version {revision.version}</span>
                          <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(revision.created_at), { addSuffix: true })}</span>
                        </div>
                        {revision.changes_summary && (
                          <p className="text-xs text-muted-foreground mt-1">{revision.changes_summary}</p>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default DraftDetail;
