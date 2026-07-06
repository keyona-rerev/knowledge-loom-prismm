import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import DOMPurify from "dompurify";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Check, X, Clock, CheckCheck, Ban, MessageCircle, AlertTriangle, Loader2, CheckCircle2 } from "lucide-react";
import { ensureVisualImageUploaded } from "@/lib/ensureVisualImage";

interface Draft {
  id: string;
  title: string;
  body: string;
  approval_status: string;
  seed_insight: string;
  content_type: string;
  created_at: string;
  stat_attributions?: { figure: string; source: string }[] | null;
  stat_flag?: string | null;
}

// A draft mid-decision: "approving"/"rejecting" cover the moment between the
// click and the DB write finishing; "approved"/"rejected" is a brief hold
// afterward so the outcome is visible before the row actually leaves the
// list. Without this, clicking Approve made the post vanish from the page
// instantly, with nothing on screen to confirm the click had done anything.
type TransitionState = "approving" | "approved" | "rejecting" | "rejected";

// How long the "Approved -- moving to your queue" (or rejected) state stays
// visible before the row is actually removed from the list.
const SETTLE_MS = 900;

// Pending tab: drafts awaiting a first decision, plus drafts that were sent
// back for AI revision (needs_revision) and haven't resurfaced as pending
// yet. Both land here because both still need something from the user —
// either a decision or, if regeneration stalled, a nudge.
export const PendingTab = () => {
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDrafts, setSelectedDrafts] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState<string>("");
  const [rejectNote, setRejectNote] = useState("");
  const [transitioning, setTransitioning] = useState<Record<string, TransitionState>>({});

  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [selectedDraft, setSelectedDraft] = useState<Draft | null>(null);
  const [rejectionFeedback, setRejectionFeedback] = useState("");
  const [requestRevision, setRequestRevision] = useState(true);

  useEffect(() => {
    loadDrafts();
  }, []);

  const loadDrafts = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setLoading(false); return; }
    const { data, error } = await supabase
      .from("drafts")
      .select("id, title, body, approval_status, seed_insight, content_type, created_at, stat_attributions, stat_flag")
      .eq("user_id", session.user.id)
      .in("approval_status", ["pending", "needs_revision"])
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Failed to load pending drafts");
    } else {
      setDrafts(data || []);
    }
    setLoading(false);
  };

  const setTransition = (draftId: string, state: TransitionState) => {
    setTransitioning(prev => ({ ...prev, [draftId]: state }));
  };

  const clearTransition = (draftId: string) => {
    setTransitioning(prev => {
      const next = { ...prev };
      delete next[draftId];
      return next;
    });
  };

  // Removes the row locally after the settle delay, without a full
  // loadDrafts() re-fetch — a re-fetch mid-delay would immediately drop the
  // row (it no longer matches the pending/needs_revision filter) and
  // skip the visible hold entirely.
  const settleAndRemove = (draftId: string) => {
    setTimeout(() => {
      setDrafts(prev => prev.filter(d => d.id !== draftId));
      setSelectedDrafts(prev => prev.filter(id => id !== draftId));
      clearTransition(draftId);
    }, SETTLE_MS);
  };

  const handleApprove = async (draftId: string) => {
    if (transitioning[draftId]) return; // already mid-decision
    const { data: { session } } = await supabase.auth.getSession();

    setTransition(draftId, "approving");

    const { error } = await supabase
      .from("drafts")
      .update({ approval_status: "approved", reviewed_at: new Date().toISOString() })
      .eq("id", draftId);

    if (error) {
      clearTransition(draftId);
      toast.error("Failed to approve draft");
      return;
    }

    setTransition(draftId, "approved");
    toast.success("Draft approved! Generating visual...");
    settleAndRemove(draftId);

    (async () => {
      if (session?.user?.id) {
        try {
          await supabase.functions.invoke("generate-draft-visual", {
            body: { draftId, userId: session.user.id }
          });
          await ensureVisualImageUploaded(draftId, session.user.id);
        } catch (err) {
          console.error("Visual generation error:", err);
        }
      }
      try {
        const { data } = await supabase.functions.invoke("publish-to-zernio", { body: { draftId } });
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
      } catch (err) {
        console.error("Publish error:", err);
      }
    })();
  };

  const handleSmartReject = (draft: Draft) => {
    setSelectedDraft(draft);
    setRejectionFeedback("");
    setRequestRevision(true);
    setRejectModalOpen(true);
  };

  const submitSmartRejection = async () => {
    if (!selectedDraft) return;
    const draftId = selectedDraft.id;
    try {
      if (requestRevision && rejectionFeedback.trim()) {
        const { error } = await supabase
          .from("drafts")
          .update({
            approval_status: "needs_revision",
            review_notes: rejectionFeedback,
            revision_feedback: rejectionFeedback,
            reviewed_at: new Date().toISOString()
          })
          .eq("id", draftId);
        if (error) { toast.error("Failed to request revision"); return; }
        const { error: functionError } = await supabase.functions.invoke("regenerate-draft-with-feedback", {
          body: { draftId, feedback: rejectionFeedback }
        });
        if (functionError) {
          toast.success("Revision requested! The draft will be updated shortly.");
        } else {
          toast.success("Revision requested! AI is regenerating with your feedback.");
        }
        // needs_revision still matches this tab's own filter, so the row
        // staying put through a normal reload is correct here (unlike the
        // permanent-reject branch below, which needs the settle delay
        // instead of an immediate reload).
        setRejectModalOpen(false);
        setRejectionFeedback("");
        setRequestRevision(true);
        loadDrafts();
      } else {
        setTransition(draftId, "rejecting");
        const { error } = await supabase
          .from("drafts")
          .update({ approval_status: "rejected", review_notes: rejectionFeedback, reviewed_at: new Date().toISOString() })
          .eq("id", draftId);
        if (error) {
          clearTransition(draftId);
          toast.error("Failed to reject draft");
          return;
        }
        setTransition(draftId, "rejected");
        toast.success("Draft rejected.");
        setRejectModalOpen(false);
        setRejectionFeedback("");
        setRequestRevision(true);
        settleAndRemove(draftId);
      }
    } catch (error) {
      toast.error("Something went wrong");
    }
  };

  const handleBulkAction = async () => {
    if (!bulkAction || selectedDrafts.length === 0) { toast.error("Please select an action and at least one draft"); return; }
    if (bulkAction === "reject" && !rejectNote.trim()) { toast.error("Please provide a reason for rejection"); return; }
    const { data: { session } } = await supabase.auth.getSession();
    for (const draftId of selectedDrafts) {
      const { error } = await supabase
        .from("drafts")
        .update({ approval_status: bulkAction, review_notes: bulkAction === "reject" ? rejectNote : null, reviewed_at: new Date().toISOString() })
        .eq("id", draftId);
      if (error) { toast.error(`Failed to update draft ${draftId}`); return; }
      if (bulkAction === "approve" && session?.user?.id) {
        (async () => {
          try {
            await supabase.functions.invoke("generate-draft-visual", {
              body: { draftId, userId: session.user.id }
            });
            await ensureVisualImageUploaded(draftId, session.user.id);
          } catch (err) {
            console.error("Visual generation error:", err);
          }
          supabase.functions.invoke("publish-to-zernio", { body: { draftId } })
            .catch((err) => console.error("Publish error:", err));
        })();
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
    if (selectedDrafts.length === drafts.length) { setSelectedDrafts([]); } else { setSelectedDrafts(drafts.map(d => d.id)); }
  };

  if (loading) {
    return <div className="text-center py-16 text-muted-foreground">Loading pending drafts...</div>;
  }

  return (
    <>
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

      {drafts.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <CheckCheck className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No drafts pending review</h3>
            <p className="text-muted-foreground mb-6">New drafts from your automations will appear here for review.</p>
            <Button onClick={() => navigate("/schedule")}>Manage Schedule</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {drafts.map((draft) => {
            const state = transitioning[draft.id];
            const isRejectSide = state === "rejecting" || state === "rejected";
            const isSettled = state === "approved" || state === "rejected";
            return (
              <Card
                key={draft.id}
                className={`hover:shadow-md transition-all duration-500 ${isSettled ? "opacity-60 scale-[0.99]" : ""}`}
              >
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <Checkbox
                      checked={selectedDrafts.includes(draft.id)}
                      onCheckedChange={() => toggleSelectDraft(draft.id)}
                      disabled={!!state}
                      className="mt-1"
                    />
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
                            {draft.approval_status === "needs_revision" ? (
                              <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200"><MessageCircle className="h-3 w-3 mr-1" />Needs Revision</Badge>
                            ) : (
                              <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200"><Clock className="h-3 w-3 mr-1" />Pending Review</Badge>
                            )}
                            <Badge variant="outline">{draft.content_type || "blog_post"}</Badge>
                          </div>
                        </div>

                        {state ? (
                          <div
                            className={`flex items-center gap-2 ml-4 shrink-0 rounded-md border px-3 py-2 text-sm font-medium ${
                              isRejectSide
                                ? "bg-red-50 text-red-700 border-red-200"
                                : "bg-green-50 text-green-700 border-green-200"
                            }`}
                          >
                            {(state === "approving" || state === "rejecting") ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <CheckCircle2 className="h-4 w-4" />
                            )}
                            {state === "approving" && "Approving..."}
                            {state === "approved" && "Approved — moving to your queue"}
                            {state === "rejecting" && "Rejecting..."}
                            {state === "rejected" && "Rejected — leaving review"}
                          </div>
                        ) : (
                          <div className="flex gap-2 ml-4 shrink-0">
                            <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => handleSmartReject(draft)}>
                              <X className="h-4 w-4 mr-1" />Reject
                            </Button>
                            <Button size="sm" onClick={() => handleApprove(draft.id)}>
                              <Check className="h-4 w-4 mr-1" />Approve
                            </Button>
                          </div>
                        )}
                      </div>

                      {draft.stat_flag && (
                        <div className="flex items-start gap-2 mb-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                          <span>{draft.stat_flag}</span>
                        </div>
                      )}
                      <div className="prose prose-sm max-w-none mb-4">
                        <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize((draft.body || "").replace(/\n/g, "<br/>"), { ALLOWED_TAGS: ["p", "br", "strong", "em", "b", "i", "u", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "a", "blockquote", "code", "pre", "span", "div"], ALLOWED_ATTR: ["href", "target", "rel", "class", "id"], FORBID_ATTR: ["style", "onclick", "onload", "onerror", "onmouseover"] }) }} />
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
                      <div className="text-xs text-muted-foreground mt-3">
                        Created {new Date(draft.created_at).toLocaleDateString()}
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
              <p className="text-sm text-muted-foreground">Clear feedback helps generate better revisions, and shows up in the Rejected log if you reject permanently.</p>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox id="request-revision" checked={requestRevision} onCheckedChange={(checked) => setRequestRevision(checked as boolean)} />
              <Label htmlFor="request-revision" className="text-sm font-medium leading-none">Request revision with this feedback</Label>
            </div>
            {!requestRevision && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
                <p className="text-sm text-yellow-800">If unchecked, this draft will be permanently rejected without revision and move to the Rejected tab.</p>
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
    </>
  );
};

export default PendingTab;
