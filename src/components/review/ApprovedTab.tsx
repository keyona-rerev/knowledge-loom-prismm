import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCheck, Send, AlertTriangle, RefreshCw, ExternalLink } from "lucide-react";
import { ensureVisualImageUploaded } from "@/lib/ensureVisualImage";

interface Draft {
  id: string;
  title: string;
  seed_insight: string;
  content_type: string;
  created_at: string;
  reviewed_at?: string | null;
  publish_status?: string | null;
  publish_error?: string | null;
  scheduled_for?: string | null;
}

// Approved tab: everything the user has said yes to. Includes drafts that
// haven't posted yet, drafts scheduled or posted, and the ones that got
// stuck (needs_attention / failed) — those still need a fix + retry, so
// they stay visible here rather than disappearing once approved.
export const ApprovedTab = () => {
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [postingNowId, setPostingNowId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  useEffect(() => {
    loadDrafts();
  }, []);

  const loadDrafts = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setLoading(false); return; }
    const { data, error } = await supabase
      .from("drafts")
      .select("id, title, seed_insight, content_type, created_at, reviewed_at, publish_status, publish_error, scheduled_for")
      .eq("user_id", session.user.id)
      .eq("approval_status", "approved")
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Failed to load approved drafts");
    } else {
      setDrafts(data || []);
    }
    setLoading(false);
  };

  const handlePostNow = async (draft: Draft) => {
    setPostingNowId(draft.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) { toast.error("You must be logged in"); return; }
      await ensureVisualImageUploaded(draft.id, session.user.id, { timeoutMs: 30000 });
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
    if (retryingId) return;
    setRetryingId(draftId);
    toast.info("Retrying schedule...");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) {
        await ensureVisualImageUploaded(draftId, session.user.id, { timeoutMs: 10000 });
      }
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
    } finally {
      setRetryingId(null);
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

  const attentionDrafts = drafts.filter(d => d.publish_status === "needs_attention" || d.publish_status === "failed");

  if (loading) {
    return <div className="text-center py-16 text-muted-foreground">Loading approved drafts...</div>;
  }

  return (
    <>
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
                  <Button size="sm" onClick={() => handleRetrySchedule(draft.id)} disabled={retryingId === draft.id}>
                    <RefreshCw className="h-4 w-4 mr-1" />{retryingId === draft.id ? "Retrying..." : "Retry"}
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {drafts.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <CheckCheck className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No approved drafts yet</h3>
            <p className="text-muted-foreground mb-6">Approve drafts from the Pending tab to see them here.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {drafts.map((draft) => {
            const isPostedNow = draft.publish_status === "published_now";
            const isPostingNow = postingNowId === draft.id;
            return (
              <div
                key={draft.id}
                className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/30 gap-4"
              >
                <div
                  className="flex-1 min-w-0 cursor-pointer"
                  onClick={() => navigate(`/drafts/${draft.id}`)}
                >
                  <p className="text-sm font-medium truncate hover:text-[#f9655b] transition-colors">{draft.title || draft.seed_insight}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline">{draft.content_type || "blog_post"}</Badge>
                    {getScheduleLabel(draft)}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isPostedNow ? (
                    <Badge style={{ backgroundColor: "#f9655b", color: "#ffffff" }} className="flex items-center gap-1 px-3">
                      <Send className="h-3 w-3" />Posted
                    </Badge>
                  ) : (
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
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
};

export default ApprovedTab;
