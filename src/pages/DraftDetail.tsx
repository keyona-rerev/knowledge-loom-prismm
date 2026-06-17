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
import { ArrowLeft, FileText, Clock, Edit, Save, Sparkles, ImageIcon, RotateCcw, Link2, Copy, Check } from "lucide-react";
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
  const [parentDraft, setParentDraft] = useState<any>(null);
  const [childDrafts, setChildDrafts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editedBody, setEditedBody] = useState("");
  const [editedSeedInsight, setEditedSeedInsight] = useState("");
  const [templates, setTemplates] = useState<ContentTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [regenerating, setRegenerating] = useState(false);
  const [revisions, setRevisions] = useState<any[]>([]);
  const [userId, setUserId] = useState<string>("");
  const [copied, setCopied] = useState(false);
  // Track which child post was just copied by id
  const [copiedChildId, setCopiedChildId] = useState<string | null>(null);

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
      return;
    }

    setDraft(data);
    setEditedBody(data.body || "");
    setEditedSeedInsight(data.seed_insight || "");
    setSelectedTemplate(data.autopilot_template_id || "");
    setLoading(false);

    if (data.parent_draft_id) {
      const { data: parent } = await supabase
        .from("drafts")
        .select("id, title, content_type, approval_status, reuse_count, max_reuse_count, reuse_angles_used")
        .eq("id", data.parent_draft_id)
        .single();
      setParentDraft(parent || null);
    } else {
      setParentDraft(null);
    }

    // Fetch body so child posts can be copied directly from this page
    const { data: children } = await supabase
      .from("drafts")
      .select("id, title, body, content_type, approval_status, created_at, seed_insight")
      .eq("parent_draft_id", id)
      .order("created_at", { ascending: true });
    setChildDrafts(children || []);
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
        if (error.code === "42P01") { setTemplates([]); return; }
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

  const handleCopy = async () => {
    if (!draft?.body) return;
    try {
      await navigator.clipboard.writeText(draft.body);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  };

  const handleCopyChild = async (e: React.MouseEvent, child: any) => {
    // Stop the row click from navigating to the child page
    e.stopPropagation();
    if (!child.body) {
      toast.error("This post has no content to copy");
      return;
    }
    try {
      await navigator.clipboard.writeText(child.body);
      setCopiedChildId(child.id);
      toast.success("Child post copied");
      setTimeout(() => setCopiedChildId(null), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  };

  const handleRegenerate = async () => {
    if (!draft || !selectedTemplate) { toast.error("Please select a template"); return; }
    setRegenerating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke("regenerate-draft-with-feedback", {
        body: { draftId: draft.id, templateId: selectedTemplate, userId: session?.user?.id, feedback: "Regenerate with selected template structure" },
      });
      if (error) throw error;
      if (data.success) { toast.success("Draft regenerated!"); await loadDraft(); } else { toast.error("Failed to regenerate draft"); }
    } catch (error) {
      toast.error("Failed to regenerate: " + (error as any)?.message);
    } finally {
      setRegenerating(false);
    }
  };

  const handleApprove = async () => {
    if (!draft) return;
    const { data: { session } } = await supabase.auth.getSession();
    const { error } = await supabase
      .from("drafts")
      .update({
        approval_status: "approved",
        reviewed_at: new Date().toISOString(),
        published_at: new Date().toISOString(),
      })
      .eq("id", draft.id);
    if (error) {
      toast.error("Failed to approve draft");
    } else {
      toast.success("Draft approved! Generating visual...");
      await loadDraft();
      if (session?.user?.id) {
        supabase.functions.invoke("generate-draft-visual", {
          body: { draftId: draft.id, userId: session.user.id }
        }).catch(err => console.error("Visual generation error:", err));
      }
      supabase.functions.invoke("publish-to-zernio", { body: { draftId: draft.id } })
        .then(({ data }) => {
          if (data?.status === "scheduled") {
            const when = new Date(data.scheduledFor).toLocaleString();
            toast.success(data.basis === "rescheduled"
              ? `Slot time had passed; rescheduled to publish ${when}`
              : `Scheduled to publish ${when}`);
          } else if (data?.status === "needs_attention") {
            toast.warning(`Not scheduled: ${data.error}`);
          } else if (data?.error) {
            toast.error(`Publish failed: ${data.error}`);
          }
          loadDraft();
        })
        .catch((err) => console.error("Publish error:", err));
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
  const reuseAngles = Array.isArray(draft.reuse_angles_used) ? draft.reuse_angles_used as string[] : [];
  const reuseRemaining = (draft.max_reuse_count || 0) - (draft.reuse_count || 0);

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
                    <Sparkles className="mr-2 h-4 w-4" />{regenerating ? "Regenerating..." : "Regenerate"}
                  </Button>
                )}
                <Button variant="outline" onClick={handleCopy}>
                  {copied ? <Check className="mr-2 h-4 w-4 text-green-500" /> : <Copy className="mr-2 h-4 w-4" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
                <Button variant="outline" onClick={handleApprove}>Approve</Button>
                <Button variant="destructive" onClick={handleReject}>Reject</Button>
                <Button onClick={() => setIsEditing(true)}><Edit className="mr-2 h-4 w-4" />Edit</Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl space-y-6">

        {parentDraft && (
          <Card className="border-muted bg-muted/20">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 mb-2">
                <Link2 className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Child post — generated from</span>
              </div>
              <div
                className="flex items-center justify-between cursor-pointer hover:opacity-80"
                onClick={() => navigate(`/drafts/${parentDraft.id}`)}
              >
                <div>
                  <p className="text-sm font-medium">{parentDraft.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{parentDraft.content_type}</p>
                  {draft.seed_insight && draft.seed_insight.startsWith("Reuse") && (
                    <p className="text-xs text-muted-foreground mt-0.5 italic">{draft.seed_insight}</p>
                  )}
                </div>
                <Badge variant={getApprovalBadgeVariant(parentDraft.approval_status)} className="ml-4 shrink-0">
                  {parentDraft.approval_status}
                </Badge>
              </div>
            </CardContent>
          </Card>
        )}

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
                <Label className="text-sm font-medium">Regenerate with Template</Label>
                <div className="flex gap-2 mt-1">
                  <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                    <SelectTrigger className="flex-1">
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
              </div>
            )}

            <div className="flex flex-wrap gap-2 mt-3">
              <Badge variant={getApprovalBadgeVariant(draft.approval_status)}>{(draft.approval_status || "pending").replace("_", " ")}</Badge>
              <Badge variant="default">{draft.status?.replace("_", " ") || "draft"}</Badge>
              <Badge variant="outline">{draft.content_type || "ad-hoc"}</Badge>
              {draft.revision_count > 0 && <Badge variant="secondary">v{draft.revision_count + 1}</Badge>}
              {(draft.max_reuse_count || 0) > 0 && (
                <Badge variant="secondary" className="flex items-center gap-1">
                  <RotateCcw className="h-3 w-3" />
                  {draft.reuse_count || 0}/{draft.max_reuse_count} reuses
                </Badge>
              )}
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            {(draft.seed_insight || isEditing) && (
              <div>
                <h3 className="font-semibold mb-2">Seed Insight</h3>
                {isEditing ? (
                  <Textarea value={editedSeedInsight} onChange={(e) => setEditedSeedInsight(e.target.value)} rows={3} className="text-sm" />
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

            {reuseAngles.length > 0 && (
              <div>
                <h3 className="font-semibold mb-2 flex items-center gap-2">
                  <RotateCcw className="h-4 w-4" />
                  Reuse history ({reuseAngles.length} of {draft.max_reuse_count})
                </h3>
                <div className="space-y-1">
                  {reuseAngles.map((angle, i) => (
                    <div key={i} className="flex items-start gap-2 p-2 bg-muted rounded text-sm">
                      <span className="text-xs text-muted-foreground shrink-0 mt-0.5">#{i + 1}</span>
                      <span>{angle}</span>
                    </div>
                  ))}
                  {reuseRemaining > 0 && (
                    <p className="text-xs text-muted-foreground pt-1">{reuseRemaining} reuse{reuseRemaining !== 1 ? "s" : ""} remaining in window</p>
                  )}
                </div>
              </div>
            )}

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

        {/* Child posts — copy button on each row, no navigation required */}
        {childDrafts.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Link2 className="h-4 w-4" />
                Child posts ({childDrafts.length})
              </CardTitle>
              <CardDescription>LinkedIn feed posts generated from this article. Copy any post directly.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {childDrafts.map((child, i) => (
                <div
                  key={child.id}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/30"
                >
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => navigate(`/drafts/${child.id}`)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground shrink-0">#{i + 1}</span>
                      <p className="text-sm font-medium truncate">{child.title}</p>
                    </div>
                    {child.seed_insight && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate italic">{child.seed_insight}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 ml-4 shrink-0">
                    <Badge variant={getApprovalBadgeVariant(child.approval_status)} className="text-xs">
                      {child.approval_status}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2"
                      onClick={(e) => handleCopyChild(e, child)}
                    >
                      {copiedChildId === child.id
                        ? <><Check className="h-3 w-3 mr-1 text-green-500" />Copied</>
                        : <><Copy className="h-3 w-3 mr-1" />Copy</>
                      }
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

      </main>
    </div>
  );
};

export default DraftDetail;
