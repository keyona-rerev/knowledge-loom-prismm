import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import DOMPurify from "dompurify";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ArrowLeft, Check, X, Clock, Filter, CheckCheck, Ban, MessageCircle, AlertTriangle, RefreshCw, ExternalLink, Send } from "lucide-react";

interface Draft {
  id: string;
  title: string;
  body: string;
  status: string;
  approval_status: string;
  seed_insight: string;
  seed_category: string;
  selected_direction: any;
  created_at: string;
  content_type: string;
  publish_status?: string | null;
  publish_error?: string | null;
  external_post_id?: string | null;
  scheduled_for?: string | null;
  stat_attributions?: { figure: string; source: string }[] | null;
  stat_flag?: string | null;
}

const Review = () => {
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>("pending");
  const [selectedDrafts, setSelectedDrafts] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState<string>("");
  const [rejectNote, setRejectNote] = useState("");
  const [postingNowId, setPostingNowId] = useState<string | null>(null);

  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [selectedDraft, setSelectedDraft] = useState<Draft | null>(null);
  const [rejectionFeedback, setRejectionFeedback] = useState("");
  const [requestRevision, setRequestRevision] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) navigate("/auth");
    };
    checkAuth();
    loadDrafts();
  }, [navigate]);

  const loadDrafts = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    const { data, error } = await supabase
      .from("drafts")
      .select("*")
      .eq("user_id", session?.user?.id)
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Failed to load drafts");
    } else {
      setDrafts(data || []);
    }
    setLoading(false);
  };

  const handleApprove = async (draftId: string) => {
    const { data: { session } } = await supabase.auth.getSession();

    // Optimistically update the UI so the button becomes moot immediately
    setDrafts(prev => prev.map(d =>
      d.id === draftId ? { ...d, approval_status: "approved" } : d
    ));
    setSelectedDrafts(prev => prev.filter(id => id !== draftId));

    const { error } = await supabase
      .from("drafts")
      .update({ approval_status: "approved", reviewed_at: new Date().toISOString() })
      .eq("id", draftId);

    if (error) {
      toast.error("Failed to approve draft");
      loadDrafts();
      return;
    }

    toast.success("Draft approved! Generating visual...");

    if (session?.user?.id) {
      supabase.functions.invoke("generate-draft-visual", {
        body: { draftId, userId: session.user.id }
      }).catch(err => console.error("Visual generation error:", err));
    }

    supabase.functions.invoke("publish-to-zernio", { body: { draftId } })
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
        loadDrafts();
      })
      .catch((err) => console.error("Publish error:", err));
  };

  const handlePostNow = async (draft: Draft) => {
    // If not yet approved, approve first
    if (draft.approval_status !== "approved") {
      await handleApprove(draft.id);
    }

    setPostingNowId(draft.id);
    try {
      const { data, error } = await supabase.functions.invoke("post-now", {
        body: { draftId: draft.id },
      });
      if (error) throw error;
      if (data?.ok || data?.alreadyPosted) {
        toast.success(data.alreadyPosted
          ? "Already posted to LinkedIn."
          : "Posted to LinkedIn! Goes live within ~60 seconds.");
        loadDrafts();
      } else {
        toast.error(data?.error || "Post Now failed — check LinkedIn connection in Settings.");
      }
    } catch (err) {
      toast.error("Post Now failed: " + (err as any)?.message);
    } finally {
      setPostingNowId(null);
    }
  };

  const handleRetrySchedule = async (draftId: string) => {
    toast.info("Retrying schedule...");
    const { data, error } = await supabase.functions.invoke("publish-to-zernio", { body: { draftId } });
    if (error) { toast.error("Retry could not reach the scheduler"); return; }
    if (data?.status === "scheduled") {
      const when = new Date(data.scheduledFor).toLocaleString();
      toast.success(data.basis === "rescheduled"
        ? `Slot time had passed; rescheduled to publish ${when}`
        : `Scheduled to publish ${when}`);
    } else if (data?.status === "needs_attention") {
      toast.warning(`Still needs attention: ${data.error}`);
    } else if (data?.status === "failed" || data?.error) {
      toast.error(`Still failing: ${data.error}`);
    } else if (data?.alreadyScheduled) {
      toast.info("This draft is already scheduled.");
    }
    loadDrafts();
  };

  const handleSmartReject = (draft: Draft) => {
    setSelectedDraft(draft);
    setRejectionFeedback("");
    setRequestRevision(true);
    setRejectModalOpen(true);
  };

  const submitSmartRejection = async () => {
    if (!selectedDraft) return;
    try {
      if (requestRevision && rejectionFeedback.trim()) {
        const { error } = await supabase
          .from("drafts")
          .update({
            approval_status: 'needs_revision',
            review_notes: rejectionFeedback,
            revision_feedback: rejectionFeedback,
            reviewed_at: new Date().toISOString()
          })
          .eq('id', selectedDraft.id);
        if (error) { toast.error("Failed to request revision"); return; }
        const { error: functionError } = await supabase.functions.invoke('regenerate-draft-with-feedback', {
          body: { draftId: selectedDraft.id, feedback: rejectionFeedback }
        });
        if (functionError) {
          toast.success("Revision requested! The draft will be updated shortly.");
        } else {
          toast.success("Revision requested! AI is regenerating with your feedback.");
        }
      } else {
        const { error } = await supabase
          .from("drafts")
          .update({ approval_status: "rejected", review_notes: rejectionFeedback, reviewed_at: new Date().toISOString() })
          .eq("id", selectedDraft.id);
        if (error) { toast.error("Failed to reject draft"); } else { toast.success("Draft rejected."); }
      }
      setRejectModalOpen(false);
      setRejectionFeedback("");
      setRequestRevision(true);
      loadDrafts();
      setSelectedDrafts(prev => prev.filter(id => id !== selectedDraft.id));
    } catch (error) {
      toast.error("Something went wrong");
    }
  };

  const handleReject = async (draftId: string, note?: string) => {
    const { error } = await supabase
      .from("drafts")
      .update({ approval_status: "rejected", review_notes: note, reviewed_at: new Date().toISOString() })
      .eq("id", draftId);
    if (error) { toast.error("Failed to reject draft"); } else {
      toast.success("Draft rejected");
      loadDrafts();
      setSelectedDrafts(prev => prev.filter(id => id !== draftId));
      setRejectNote("");
    }
  };

  const handleBulkAction = async () => {
    if (!bulkAction || selectedDrafts.length === 0) { toast.error("Please select an action and at least one draft"); return; }
    if (bulkAction === "reject" && !rejectNote.trim()) { toast.error("Please provide a reason for rejection"); return; }
    for (const draftId of selectedDrafts) {
      const { error } = await supabase
        .from("drafts")
        .update({ approval_status: bulkAction, review_notes: bulkAction === "reject" ? rejectNote : null, reviewed_at: new Date().toISOString() })
        .eq("id", draftId);
      if (error) { toast.error(`Failed to update draft ${draftId}`); return; }
      if (bulkAction === "approve") {
        supabase.functions.invoke("publish-to-zernio", { body: { draftId } })
          .catch((err) => console.error("Publish error:", err));
      }
    }
    toast.success(`${selectedDrafts.length} drafts ${bulkAction}ed`);
    setSelectedDrafts([]);
    setBulkAction("");
    setRejectNote("");
    loadDrafts();
  };

  const toggleSelectDraft = (draftId: string) => {
    setSelectedDrafts(prev => prev.includes(draftId) ? prev.filter(id => id !== draftId) : [...prev, draftId]);
  };

  const toggleSelectAll = () => {
    if (selectedDrafts.length === filteredDrafts.length) { setSelectedDrafts([]); } else { setSelectedDrafts(filteredDrafts.map(d => d.id)); }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending": return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200"><Clock className="h-3 w-3 mr-1" />Pending Review</Badge>;
      case "approved": return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200"><CheckCheck className="h-3 w-3 mr-1" />Approved</Badge>;
      case "rejected": return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200"><Ban className="h-3 w-3 mr-1" />Rejected</Badge>;
      case "needs_revision": return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200"><MessageCircle className="h-3 w-3 mr-1" />Needs Revision</Badge>;
      default: return <Badge variant="outline">Unknown</Badge>;
    }
  };

  const getScheduleLabel = (draft: Draft) => {
    if (draft.publish_status === "published_now") {
      return <span className="text-xs font-medium" style={{ color: "#f9655b" }}>Posted to LinkedIn</span>;
    }
    if (draft.publish_status === "scheduled" && draft.scheduled_for) {
      const when = new Date(draft.scheduled_for).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      return <span className="text-xs text-muted-foreground">Scheduled {when}</span>;
    }
    return null;
  };

  const filteredDrafts = drafts.filter(draft => filterStatus === "all" ? true : draft.approval_status === filterStatus);
  const pendingCount = drafts.filter(d => d.approval_status === "pending").length;
  const approvedCount = drafts.filter(d => d.approval_status === "approved").length;
  const rejectedCount = drafts.filter(d => d.approval_status === "rejected").length;
  const revisionCount = drafts.filter(d => d.approval_status === "needs_revision").length;
  const attentionDrafts = drafts.filter(d => d.publish_status === "needs_attention" || d.publish_status === "failed");

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b"><div className="container mx-auto px-4 py-4"><Button variant="ghost" onClick={() => navigate("/dashboard")}><ArrowLeft className="mr-2 h-4 w-4" />Back to Dashboard</Button></div></header>
        <main className="container mx-auto px-4 py-8"><div className="animate-pulse"><div className="h-8 bg-gray-200 rounded w-1/4 mb-2"></div><div className="h-4 bg-gray-200 rounded w-1/2 mb-8"></div>{[...Array(3)].map((_, i) => (<div key={i} className="h-32 bg-gray-200 rounded mb-4"></div>))}</div></main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <Button variant="ghost" onClick={() => navigate("/dashboard")}><ArrowLeft className="mr-2 h-4 w-4" />Back to Dashboard</Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-2">Review Drafts</h1>
            <p className="text-muted-foreground">Manage and approve content from your automations</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-sm text-muted-foreground">
              <span className="text-yellow-600 font-medium">{pendingCount} pending</span>{" • "}
              <span className="text-green-600 font-medium">{approvedCount} approved</span>{" • "}
              <span className="text-red-600 font-medium">{rejectedCount} rejected</span>
              {revisionCount > 0 && (<>{" • "}<span className="text-blue-600 font-medium">{revisionCount} needs revision</span></>)}
              {attentionDrafts.length > 0 && (<>{" • "}<span className="text-amber-700 font-medium">{attentionDrafts.length} needs attention</span></>)}
            </div>
          </div>
        </div>

        {attentionDrafts.length > 0 && (
          <Card className="mb-6 border-amber-300 bg-amber-50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-amber-900 text-lg">
                <AlertTriangle className="h-5 w-5" />
                Needs attention ({attentionDrafts.length})
              </CardTitle>
              <CardDescription className="text-amber-800">
                These drafts were approved but did not schedule. Fix the cause, then retry. Nothing here has posted.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {attentionDrafts.map((draft) => (
                <div key={draft.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-md border border-amber-200 bg-white p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className={draft.publish_status === "failed" ? "bg-red-50 text-red-700 border-red-200" : "bg-amber-100 text-amber-800 border-amber-300"}>
                        {draft.publish_status === "failed" ? "Provider error" : "Not scheduled"}
                      </Badge>
                      <span className="font-medium truncate">{draft.title || draft.seed_insight}</span>
                    </div>
                    <p className="text-sm text-amber-900">{draft.publish_error || "No reason recorded."}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => navigate(`/drafts/${draft.id}`)}>
                      <ExternalLink className="h-4 w-4 mr-1" />View
                    </Button>
                    <Button size="sm" onClick={() => handleRetrySchedule(draft.id)}>
                      <RefreshCw className="h-4 w-4 mr-1" />Retry
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {selectedDrafts.length > 0 && (
          <Card className="mb-6 border-blue-200 bg-blue-50">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                <div className="flex items-center gap-2">
                  <Checkbox checked={selectedDrafts.length > 0} onCheckedChange={toggleSelectAll} />
                  <span className="text-sm font-medium">{selectedDrafts.length} draft(s) selected</span>
                </div>
                <Select value={bulkAction} onValueChange={setBulkAction}>
                  <SelectTrigger className="w-[140px]"><SelectValue placeholder="Action" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="approve">Approve</SelectItem>
                    <SelectItem value="reject">Reject</SelectItem>
                  </SelectContent>
                </Select>
                {bulkAction === "reject" && (
                  <div className="flex-1">
                    <Label htmlFor="reject-note" className="text-sm">Rejection Reason</Label>
                    <Textarea id="reject-note" value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="Why are you rejecting these drafts?" className="mt-1" rows={2} />
                  </div>
                )}
                <Button onClick={handleBulkAction} disabled={!bulkAction || (bulkAction === "reject" && !rejectNote.trim())}>Apply to {selectedDrafts.length} draft(s)</Button>
                <Button variant="outline" onClick={() => setSelectedDrafts([])}>Clear</Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-[180px]"><SelectValue placeholder="Filter by status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Drafts</SelectItem>
                  <SelectItem value="pending">Pending Review</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="needs_revision">Needs Revision</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {filteredDrafts.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12">
              <CheckCheck className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">{filterStatus === "pending" ? "No drafts pending review" : "No drafts found"}</h3>
              <p className="text-muted-foreground mb-6">{filterStatus === "pending" ? "New drafts from your automations will appear here for review." : "Try adjusting your filters to see more drafts."}</p>
              <Button onClick={() => navigate("/schedule")}>Manage Schedule</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredDrafts.map((draft) => {
              const isApproved = draft.approval_status === "approved";
              const isPostedNow = draft.publish_status === "published_now";
              const isPostingNow = postingNowId === draft.id;

              return (
                <Card key={draft.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                      <Checkbox checked={selectedDrafts.includes(draft.id)} onCheckedChange={() => toggleSelectDraft(draft.id)} className="mt-1" />
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex-1">
                            <h3
                              className="font-semibold text-lg mb-2 cursor-pointer hover:underline hover:text-[#f9655b] transition-colors"
                              onClick={() => navigate(`/drafts/${draft.id}`)}
                            >
                              {draft.title || draft.seed_insight}
                            </h3>
                            <div className="flex flex-wrap gap-2 items-center mb-1">
                              {getStatusBadge(draft.approval_status)}
                              <Badge variant="outline">{draft.content_type || "blog_post"}</Badge>
                            </div>
                            {getScheduleLabel(draft) && (
                              <div className="mt-1 mb-1">{getScheduleLabel(draft)}</div>
                            )}
                          </div>

                          {/* Action buttons */}
                          <div className="flex gap-2 ml-4 shrink-0">
                            {!isApproved && (
                              <>
                                <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => handleSmartReject(draft)}>
                                  <X className="h-4 w-4 mr-1" />Reject
                                </Button>
                                <Button size="sm" onClick={() => handleApprove(draft.id)}>
                                  <Check className="h-4 w-4 mr-1" />Approve
                                </Button>
                              </>
                            )}
                            {isApproved && (
                              <>
                                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 flex items-center gap-1 px-3">
                                  <CheckCheck className="h-3 w-3" />Approved
                                </Badge>
                                {!isPostedNow && (
                                  <Button
                                    size="sm"
                                    disabled={isPostingNow}
                                    onClick={() => handlePostNow(draft)}
                                    style={{ backgroundColor: "#f9655b", color: "#ffffff" }}
                                  >
                                    <Send className="h-4 w-4 mr-1" />
                                    {isPostingNow ? "Posting..." : "Post Now"}
                                  </Button>
                                )}
                                {isPostedNow && (
                                  <Badge style={{ backgroundColor: "#f9655b", color: "#ffffff" }} className="flex items-center gap-1 px-3">
                                    <Send className="h-3 w-3" />Posted
                                  </Badge>
                                )}
                              </>
                            )}
                          </div>
                        </div>

                        {draft.stat_flag && (
                          <div className="flex items-start gap-2 mb-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                            <span>{draft.stat_flag}</span>
                          </div>
                        )}
                        <div className="prose prose-sm max-w-none mb-4">
                          <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize((draft.body || '').replace(/\n/g, '<br/>'), { ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'b', 'i', 'u', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'blockquote', 'code', 'pre', 'span', 'div'], ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'id'], FORBID_ATTR: ['style', 'onclick', 'onload', 'onerror', 'onmouseover'] }) }} />
                        </div>
                        {Array.isArray(draft.stat_attributions) && draft.stat_attributions.length > 0 && (
                          <div className="text-sm border-t pt-3 mb-1">
                            <p className="font-medium mb-2">Figures and their sources</p>
                            <ul className="space-y-1">
                              {draft.stat_attributions.map((a, i) => (
                                <li key={i} className="text-muted-foreground">
                                  <span className="font-medium text-foreground">{a.figure || "(figure)"}</span>
                                  {" "}from {a.source || "(no source given)"}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {draft.selected_direction && (
                          <div className="text-sm text-muted-foreground border-t pt-3">
                            <strong>Direction:</strong> {draft.selected_direction.angle}
                          </div>
                        )}
                        <div className="text-xs text-muted-foreground mt-3">
                          Created {new Date(draft.created_at).toLocaleDateString()}
                          {draft.approval_status !== "pending" && (draft as any).reviewed_at && (
                            <span className="ml-2">• {draft.approval_status} on {new Date((draft as any).reviewed_at).toLocaleDateString()}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <Dialog open={rejectModalOpen} onOpenChange={setRejectModalOpen}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Reject Draft</DialogTitle>
              <DialogDescription>Provide feedback for {selectedDraft?.title || "this draft"}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="rejection-feedback">Feedback</Label>
                <Textarea id="rejection-feedback" placeholder="What needs to be improved? Be specific so the AI can revise it effectively..." value={rejectionFeedback} onChange={(e) => setRejectionFeedback(e.target.value)} rows={4} />
                <p className="text-sm text-muted-foreground">Clear feedback helps generate better revisions.</p>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox id="request-revision" checked={requestRevision} onCheckedChange={(checked) => setRequestRevision(checked as boolean)} />
                <Label htmlFor="request-revision" className="text-sm font-medium leading-none">Request revision with this feedback</Label>
              </div>
              {!requestRevision && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
                  <p className="text-sm text-yellow-800">If unchecked, this draft will be permanently rejected without revision.</p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRejectModalOpen(false)}>Cancel</Button>
              <Button onClick={submitSmartRejection} disabled={!rejectionFeedback.trim()} className={requestRevision ? "bg-blue-600 hover:bg-blue-700" : "bg-red-600 hover:bg-red-700"}>
                {requestRevision ? (<><MessageCircle className="h-4 w-4 mr-2" />Request Revision</>) : (<><Ban className="h-4 w-4 mr-2" />Reject Permanently</>)}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
};

export default Review;
