import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { ArrowLeft, FileText, Clock, Edit, Save, Sparkles, ImageIcon, RotateCcw, Link2, Copy, Check, Send, CalendarCheck, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { VisualForge } from "@/components/VisualForge";
import { ensureVisualImageUploaded } from "@/lib/ensureVisualImage";
import { platformLabel } from "@/lib/platform";

const FALLBACK_ACCENT = "#f9655b";

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
  const [feedback, setFeedback] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [revisions, setRevisions] = useState<any[]>([]);
  const [userId, setUserId] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [copiedChildId, setCopiedChildId] = useState<string | null>(null);
  const [postingNow, setPostingNow] = useState(false);
  const [cancellingSchedule, setCancellingSchedule] = useState(false);
  // Previously hardcoded to Prismm's coral (#f9655b) directly in three
  // places on this page, while Dashboard.tsx correctly reads the same
  // value from profiles.primary_color. Now reads the same column, with the
  // old Prismm coral kept only as a fallback for profiles that haven't set
  // a primary_color yet.
  const [accentColor, setAccentColor] = useState(FALLBACK_ACCENT);
  const [platform, setPlatform] = useState<string>("linkedin");

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
      navigate("/review");
      return;
    }

    setDraft(data);
    setEditedBody(data.body || "");
    setEditedSeedInsight(data.seed_insight || "");
    setLoading(false);

    if (data.format_id) {
      const { data: format } = await supabase
        .from("formats")
        .select("platform")
        .eq("id", data.format_id)
        .maybeSingle();
      setPlatform(format?.platform || "linkedin");
    } else {
      setPlatform("linkedin");
    }

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

  const loadAccentColor = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const { data } = await supabase
      .from("profiles")
      .select("primary_color")
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (data?.primary_color) setAccentColor(data.primary_color);
  };

  useEffect(() => {
    loadDraft();
    loadRevisions();
    loadAccentColor();
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
    if (!draft || !feedback.trim()) { toast.error("Please describe what should change"); return; }
    setRegenerating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke("regenerate-draft-with-feedback", {
        body: { draftId: draft.id, feedback: feedback.trim(), userId: session?.user?.id },
      });
      if (error) throw error;
      if (data.success) {
        toast.success("Draft regenerated!");
        setFeedback("");
        await Promise.all([loadDraft(), loadRevisions()]);
      } else {
        toast.error("Failed to regenerate draft");
      }
    } catch (error) {
      toast.error("Failed to regenerate: " + (error as any)?.message);
    } finally {
      setRegenerating(false);
    }
  };

  // Fallback status written when the fire-and-forget publish-to-zernio call
  // below throws before the edge function's own status-writing logic ever
  // runs (network drop, tab closed, cold-start timeout). Without this the
  // draft is left with scheduled_for stamped at generation time but
  // publish_status/external_post_id still null — invisible to Approved's
  // needs_attention filter. Guarded on both columns still being null so it
  // never clobbers a real result from a concurrent/retried call.
  const markUnreachedScheduler = async (draftId: string) => {
    await supabase.from("drafts")
      .update({
        publish_status: "needs_attention",
        publish_error: "Approval didn't reach the scheduler (the request failed before a response came back). Retry from the Approved tab.",
      })
      .eq("id", draftId)
      .is("publish_status", null)
      .is("external_post_id", null);
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
      (async () => {
        if (session?.user?.id) {
          try {
            await supabase.functions.invoke("generate-draft-visual", {
              body: { draftId: draft.id, userId: session.user.id }
            });
            await ensureVisualImageUploaded(draft.id, session.user.id);
          } catch (err) {
            console.error("Visual generation error:", err);
          }
        }
        try {
          const { data } = await supabase.functions.invoke("publish-to-zernio", { body: { draftId: draft.id } });
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
        } catch (err) {
          console.error("Publish error:", err);
          await markUnreachedScheduler(draft.id);
          loadDraft();
        }
      })();
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

  const handleCancelSchedule = async () => {
    if (!draft) return;
    setCancellingSchedule(true);
    try {
      const { data, error } = await supabase.functions.invoke("cancel-schedule", {
        body: { draftId: draft.id },
      });
      if (error) throw error;
      if (data?.ok) {
        toast.success("Schedule cancelled. You can now Post Now.");
        await loadDraft();
      } else {
        toast.error(data?.error || "Failed to cancel schedule.");
      }
    } catch (err) {
      toast.error("Cancel failed: " + (err as any)?.message);
    } finally {
      setCancellingSchedule(false);
    }
  };

  const handlePostNow = async () => {
    if (!draft) return;

    setPostingNow(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) { toast.error("You must be logged in"); return; }

      if (draft.approval_status !== "approved") {
        const { error: approveError } = await supabase
          .from("drafts")
          .update({
            approval_status: "approved",
            reviewed_at: new Date().toISOString(),
            published_at: new Date().toISOString(),
          })
          .eq("id", draft.id);
        if (approveError) {
          toast.error("Failed to approve draft before posting");
          return;
        }
        // Awaited (not fire-and-forget) so ensureVisualImageUploaded below
        // never polls before the visual's placeholder row exists — it would
        // otherwise see no row at all and return immediately without
        // waiting, publishing with no image.
        try {
          await supabase.functions.invoke("generate-draft-visual", {
            body: { draftId: draft.id, userId: session.user.id }
          });
        } catch (err) {
          console.error("Visual generation error:", err);
        }
      }

      await ensureVisualImageUploaded(draft.id, session.user.id, { timeoutMs: 30000 });
      const { data, error } = await supabase.functions.invoke("post-now", {
        body: { draftId: draft.id },
      });
      if (error) throw error;
      if (data?.ok) {
        if (data.alreadyPosted) {
          toast.success(`This post has already been sent to ${platformLabel(platform)}.`);
        } else {
          toast.success(`Posted to ${platformLabel(platform)}! It will go live within ~60 seconds.`);
        }
        await loadDraft();
      } else {
        toast.error(data?.error || `Post Now failed — check ${platformLabel(platform)} connection in Settings.`);
      }
    } catch (err) {
      toast.error("Post Now failed: " + (err as any)?.message);
    } finally {
      setPostingNow(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><div>Loading draft...</div></div>;
  }

  if (!draft) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><div>Draft not found</div></div>;
  }

  const isApproved = draft.approval_status === "approved";
  const isPostedNow = draft.publish_status === "published_now";
  // A "scheduled" post whose scheduled_for has already passed has, in
  // practice, already gone out — Zernio fired it. Posted tab already treats
  // this case as posted (its filter is publish_status=published_now OR
  // (scheduled AND scheduled_for < now)); this page needs to agree with that
  // definition, or it keeps showing Approve/Reject/Cancel Schedule/Post Now
  // as live actions on something that's already posted.
  const isPastScheduled = draft.publish_status === "scheduled" && !!draft.scheduled_for && new Date(draft.scheduled_for).getTime() < Date.now();
  const isActuallyPosted = isPostedNow || isPastScheduled;
  const isScheduled = draft.publish_status === "scheduled" && draft.scheduled_for && !isPastScheduled;
  const reuseAngles = Array.isArray(draft.reuse_angles_used) ? draft.reuse_angles_used as string[] : [];
  const reuseRemaining = (draft.max_reuse_count || 0) - (draft.reuse_count || 0);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <Button variant="ghost" onClick={() => navigate("/review")}>
            <ArrowLeft className="mr-2 h-4 w-4" />Back to Review
          </Button>
          <div className="flex gap-2">
            {isEditing ? (
              <>
                <Button variant="outline" onClick={() => setIsEditing(false)}>Cancel</Button>
                <Button onClick={handleSave}><Save className="mr-2 h-4 w-4" />Save</Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={handleCopy}>
                  {copied ? <Check className="mr-2 h-4 w-4 text-green-500" /> : <Copy className="mr-2 h-4 w-4" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
                {!isActuallyPosted && (
                  <>
                    <Button variant="outline" onClick={handleApprove}>Approve</Button>
                    <Button variant="destructive" onClick={handleReject}>Reject</Button>
                  </>
                )}
                <Button
                  onClick={handlePostNow}
                  disabled={postingNow || isActuallyPosted}
                  style={{ backgroundColor: accentColor, color: "#ffffff" }}
                >
                  <Send className="mr-2 h-4 w-4" />
                  {postingNow ? "Posting..." : isActuallyPosted ? "Posted" : "Post Now"}
                </Button>
                {!isActuallyPosted && (
                  <Button onClick={() => setIsEditing(true)}><Edit className="mr-2 h-4 w-4" />Edit</Button>
                )}
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
                {isActuallyPosted && (
                  <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold" style={{ color: accentColor }}>
                    <Send className="h-4 w-4" />
                    Posted to {platformLabel(platform)}
                  </p>
                )}
                {!isActuallyPosted && isScheduled && (
                  <div className="mt-2 flex items-center gap-3">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-green-700">
                      <CalendarCheck className="h-4 w-4" />
                      Scheduled for {new Date(draft.scheduled_for).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-xs text-red-600 border-red-200 hover:bg-red-50"
                      disabled={cancellingSchedule}
                      onClick={handleCancelSchedule}
                    >
                      <X className="h-3 w-3 mr-1" />
                      {cancellingSchedule ? "Cancelling..." : "Cancel Schedule"}
                    </Button>
                  </div>
                )}
              </div>
              <FileText className="h-6 w-6 text-muted-foreground" />
            </div>

            {!isEditing && (
              <div className="mt-4">
                <Label className="text-sm font-medium">Revise with feedback</Label>
                <div className="flex gap-2 mt-1">
                  <Textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="What should change? e.g. 'make the hook punchier' or 'cut the third paragraph'"
                    rows={2}
                    className="flex-1 text-sm"
                  />
                  <Button onClick={handleRegenerate} disabled={regenerating || !feedback.trim()} variant="outline" className="shrink-0">
                    <Sparkles className="mr-2 h-4 w-4" />{regenerating ? "Regenerating..." : "Regenerate"}
                  </Button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2 mt-3">
              <Badge variant={getApprovalBadgeVariant(draft.approval_status)}>{(draft.approval_status || "pending").replace("_", " ")}</Badge>
              <Badge variant="default">{draft.status?.replace("_", " ") || "draft"}</Badge>
              <Badge variant="outline">{draft.content_type || "ad-hoc"}</Badge>
              {draft.revision_count > 0 && <Badge variant="secondary">v{draft.revision_count + 1}</Badge>}
              {isActuallyPosted && (
                <Badge style={{ backgroundColor: accentColor, color: "#ffffff" }}>
                  Posted to {platformLabel(platform)}
                </Badge>
              )}
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
                  <VisualForge draftId={draft.id} userId={userId} platformLabel={platformLabel(platform)} />
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

        {childDrafts.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Link2 className="h-4 w-4" />
                Child posts ({childDrafts.length})
              </CardTitle>
              <CardDescription>Feed posts generated from this article. Copy any post directly.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {childDrafts.map((child, i) => (
                <div key={child.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/30">
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate(`/drafts/${child.id}`)}>
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
                    <Button size="sm" variant="outline" className="h-7 px-2" onClick={(e) => handleCopyChild(e, child)}>
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
