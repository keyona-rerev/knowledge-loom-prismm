import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { RefreshCw, Send, ThumbsUp, MessageSquare, Eye, Clock, ShieldCheck } from "lucide-react";

interface PostedDraft {
  id: string;
  title: string | null;
  content_type: string | null;
  publish_status: string | null;
  scheduled_for: string | null;
  metric_likes: number | null;
  metric_comments: number | null;
  metric_impressions: number | null;
  metrics_synced_at: string | null;
  metrics_error: string | null;
}

const FALLBACK_ACCENT = "#f9655b";

export const PostedTab = () => {
  const navigate = useNavigate();
  const [posted, setPosted] = useState<PostedDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  // Previously hardcoded to Prismm's coral (#f9655b) directly for the
  // "Posted" badge, while Dashboard.tsx correctly reads the same value from
  // profiles.primary_color. Now reads the same column, with the old Prismm
  // coral kept only as a fallback for profiles that haven't set a
  // primary_color yet.
  const [accentColor, setAccentColor] = useState(FALLBACK_ACCENT);

  useEffect(() => {
    load();
    loadAccentColor();
  }, []);

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

  const load = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const nowIso = new Date().toISOString();
    const postedFilter = `publish_status.eq.published_now,and(publish_status.eq.scheduled,scheduled_for.lt.${nowIso})`;

    const { data, error } = await supabase
      .from("drafts")
      .select("id, title, content_type, publish_status, scheduled_for, metric_likes, metric_comments, metric_impressions, metrics_synced_at, metrics_error")
      .eq("user_id", session.user.id)
      .or(postedFilter)
      .order("scheduled_for", { ascending: false });

    if (error) {
      console.error("Error loading posted drafts:", error);
      toast.error("Failed to load posted content");
    } else {
      setPosted(data || []);
    }
    setLoading(false);
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-post-analytics", { body: {} });
      if (error) throw error;
      if (data?.failed > 0) {
        toast.warning(`Synced ${data.synced}, ${data.failed} failed. Zernio's analytics may need a plan upgrade.`);
      } else {
        toast.success(`Synced metrics for ${data?.synced ?? 0} post(s)`);
      }
      await load();
    } catch (err) {
      toast.error("Metrics sync failed: " + (err as Error)?.message);
    } finally {
      setSyncing(false);
    }
  };

  // The rows in this tab whose publish_status is 'scheduled' with a past
  // scheduled_for are shown as "posted" purely by assumption — the time
  // passed, so it's treated as gone out. Nothing has ever actually
  // confirmed that with Zernio. This calls reconcile-scheduled-posts, which
  // asks Zernio directly per post: confirmed-posted rows get normalized to
  // published_now (so they stop depending on the clock at all going
  // forward); confirmed-NOT-posted rows move to publish_status='failed' and
  // disappear from this list, but reappear in Approved's Needs attention
  // card since that's where anything approved-but-not-actually-out belongs.
  const handleReconcile = async () => {
    setReconciling(true);
    try {
      const { data, error } = await supabase.functions.invoke("reconcile-scheduled-posts", { body: {} });
      if (error) throw error;
      if (!data?.checked) {
        toast.info("Nothing to reconcile — no assumed-posted drafts to check right now.");
      } else if (data.confirmedNotPosted > 0) {
        toast.warning(
          `Checked ${data.checked}: ${data.confirmedPosted} confirmed posted, ${data.confirmedNotPosted} did NOT actually post (moved to Needs attention)${data.stillAmbiguous ? `, ${data.stillAmbiguous} still ambiguous` : ""}.`
        );
      } else {
        toast.success(
          `Checked ${data.checked}: all ${data.confirmedPosted} confirmed posted with Zernio${data.stillAmbiguous ? `, ${data.stillAmbiguous} still ambiguous` : ""}.`
        );
      }
      await load();
    } catch (err) {
      toast.error("Reconciliation failed: " + (err as Error)?.message);
    } finally {
      setReconciling(false);
    }
  };

  if (loading) {
    return <div className="text-center py-16 text-muted-foreground">Loading posted content...</div>;
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <p className="text-muted-foreground">Posts that have actually gone out on LinkedIn.</p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleReconcile} disabled={reconciling}>
            <ShieldCheck className={`h-3.5 w-3.5 mr-2 ${reconciling ? "animate-pulse" : ""}`} />
            {reconciling ? "Reconciling..." : "Reconcile with Zernio"}
          </Button>
          <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
            <RefreshCw className={`h-3.5 w-3.5 mr-2 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing..." : "Sync metrics"}
          </Button>
        </div>
      </div>

      {posted.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Send className="h-10 w-10 mx-auto mb-4 opacity-30" />
          <p className="text-sm">Nothing posted yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {posted.map((draft) => (
            <div
              key={draft.id}
              className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/30 cursor-pointer gap-4"
              onClick={() => navigate(`/drafts/${draft.id}`)}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{draft.title || "Untitled draft"}</p>
                <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {draft.scheduled_for ? new Date(draft.scheduled_for).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}
                </p>
              </div>
              {draft.metrics_synced_at ? (
                <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                  <span className="flex items-center gap-1"><ThumbsUp className="h-3 w-3" />{draft.metric_likes ?? 0}</span>
                  <span className="flex items-center gap-1"><MessageSquare className="h-3 w-3" />{draft.metric_comments ?? 0}</span>
                  <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{draft.metric_impressions ?? 0}</span>
                </div>
              ) : draft.metrics_error ? (
                <span className="text-xs text-amber-700 shrink-0">Metrics unavailable</span>
              ) : (
                <span className="text-xs text-muted-foreground shrink-0">Not synced yet</span>
              )}
              <Badge style={{ backgroundColor: accentColor, color: "#ffffff" }} className="text-xs shrink-0">
                <Send className="h-3 w-3 mr-1" />Posted
              </Badge>
            </div>
          ))}
        </div>
      )}
    </>
  );
};

export default PostedTab;
