import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { CheckCheck, Send, AlertTriangle, RefreshCw, ExternalLink, ListRestart } from "lucide-react";
import { ensureVisualImageUploaded } from "@/lib/ensureVisualImage";
import { platformLabel } from "@/lib/platform";

interface Draft {
  id: string;
  title: string;
  seed_insight: string;
  content_type: string;
  created_at: string;
  format_id: string | null;
  reviewed_at?: string | null;
  publish_status?: string | null;
  publish_error?: string | null;
  scheduled_for?: string | null;
}

interface FormatRow { id: string; name: string; platform: string; }

const ALL = "__all__";
const FALLBACK_ACCENT = "#f9655b";

// Approved tab: everything the user has said yes to. Includes drafts that
// haven't posted yet, drafts scheduled or posted, and the ones that got
// stuck (needs_attention / failed / silently never-handed-off) — those
// still need a fix + retry, so they stay visible here rather than
// disappearing once approved.
export const ApprovedTab = () => {
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [postingNowId, setPostingNowId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryingAll, setRetryingAll] = useState(false);
  // Previously hardcoded to Prismm's coral (#f9655b) directly in this file
  // in four places, while Dashboard.tsx correctly reads the same value from
  // profiles.primary_color. Switching businesses would leave this tab
  // showing the wrong brand color even after Dashboard picked up the new
  // one. Now reads the same profile column, with the old Prismm coral kept
  // only as a fallback for profiles that haven't set a primary_color yet.
  const [accentColor, setAccentColor] = useState(FALLBACK_ACCENT);

  // Same platform/post-type filter as Pending — formats.platform is real
  // per-format data, not a hardcoded channel list.
  const [formats, setFormats] = useState<FormatRow[]>([]);
  const [platformFilter, setPlatformFilter] = useState<string>(ALL);
  const [formatFilter, setFormatFilter] = useState<string>(ALL);

  useEffect(() => {
    loadDrafts();
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

  const loadDrafts = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setLoading(false); return; }
    const [{ data, error }, { data: fmt }] = await Promise.all([
      supabase
        .from("drafts")
        .select("id, title, seed_insight, content_type, created_at, format_id, reviewed_at, publish_status, publish_error, scheduled_for")
        .eq("user_id", session.user.id)
        .eq("approval_status", "approved")
        .order("created_at", { ascending: false }),
      supabase.from("formats").select("id, name, platform").eq("user_id", session.user.id).order("platform").order("sort_order"),
    ]);
    if (error) {
      toast.error("Failed to load approved drafts");
    } else {
      setDrafts(data || []);
    }
    setFormats((fmt || []) as FormatRow[]);
    setLoading(false);
  };

  const handlePostNow = async (draft: Draft) => {
    setPostingNowId(draft.id);
    const label = platformLabel(formats.find((f) => f.id === draft.format_id)?.platform);
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
          ? `Already posted to ${label}.`
          : `Posted to ${label}! Goes live within ~60 seconds.`);
        loadDrafts();
      } else {
        toast.error(data?.error || `Post Now failed — check ${label} connection in Settings.`);
      }
    } catch (err) {
      toast.error("Post Now failed: " + (err as any)?.message);
    } finally {
      setPostingNowId(null);
    }
  };

  const describeRetryResult = (data: any) => {
    if (data?.status === "scheduled") {
      const when = new Date(data.scheduledFor).toLocaleString();
      if (data.basis === "queued") return `That slot was already taken; queued for the next open one, publishing ${when}`;
      if (data.basis === "rescheduled") return `Slot time had passed; rescheduled to publish ${when}`;
      return `Scheduled to publish ${when}`;
    }
    if (data?.status === "needs_attention") return `Still needs attention: ${data.error}`;
    if (data?.status === "failed" || data?.error) return `Still failing: ${data.error}`;
    if (data?.alreadyScheduled) return "This draft is already scheduled.";
    return null;
  };

  const handleRetrySchedule = async (draftId: string) => {
    if (retryingId || retryingAll) return;
    setRetryingId(draftId);
    toast.info("Retrying schedule...");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) {
        await ensureVisualImageUploaded(draftId, session.user.id, { timeoutMs: 10000 });
      }
      const { data, error } = await supabase.functions.invoke("publish-to-zernio", { body: { draftId } });
      if (error) { toast.error("Retry could not reach the scheduler"); return; }
      const message = describeRetryResult(data);
      if (message) {
        if (data?.status === "scheduled") toast.success(message);
        else if (data?.status === "needs_attention") toast.warning(message);
        else if (data?.status === "failed" || data?.error) toast.error(message);
        else toast.info(message);
      }
      loadDrafts();
    } finally {
      setRetryingId(null);
    }
  };

  // Retries every stuck draft in the Needs attention card, one at a time,
  // oldest-approved first. This is what actually clears a backlog of
  // same-slot stuck drafts correctly: publish-to-zernio's occupancy check
  // only sees a prior draft's slot as claimed once that draft's write has
  // landed, so running them sequentially (await, not Promise.all) is what
  // sequences them onto consecutive open cadence slots instead of every one
  // independently resolving to the same next occurrence.
  const handleRetryAll = async () => {
    if (retryingAll || retryingId) return;
    setRetryingAll(true);
    const queue = [...attentionDrafts].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    let succeeded = 0;
    let stillStuck = 0;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      for (const draft of queue) {
        setRetryingId(draft.id);
        try {
          if (session?.user?.id) {
            await ensureVisualImageUploaded(draft.id, session.user.id, { timeoutMs: 10000 });
          }
          const { data, error } = await supabase.functions.invoke("publish-to-zernio", { body: { draftId: draft.id } });
          if (!error && data?.status === "scheduled") succeeded++;
          else stillStuck++;
        } catch {
          stillStuck++;
        }
      }
    } finally {
      setRetryingId(null);
      setRetryingAll(false);
      if (succeeded > 0 && stillStuck === 0) {
        toast.success(`Scheduled all ${succeeded} into open cadence slots.`);
      } else if (succeeded > 0) {
        toast.warning(`Scheduled ${succeeded}, ${stillStuck} still need attention.`);
      } else {
        toast.error("None of them scheduled — check the reasons below.");
      }
      loadDrafts();
    }
  };

  const getScheduleLabel = (draft: Draft) => {
    if (draft.publish_status === "published_now") {
      const label = platformLabel(formats.find((f) => f.id === draft.format_id)?.platform);
      return <span className="text-xs font-medium" style={{ color: accentColor }}>Posted to {label}</span>;
    }
    if (draft.publish_status === "scheduled" && draft.scheduled_for) {
      const when = new Date(draft.scheduled_for).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      return <span className="text-xs text-muted-foreground">Scheduled {when}</span>;
    }
    return null;
  };

  // "Stuck" covers three shapes, all meaning the same thing to the user
  // (approved, but nothing is actually going out) even though they arrive
  // differently:
  //  - failed: publish-to-zernio ran and the provider rejected it
  //  - needs_attention: publish-to-zernio ran and caught a known blocker
  //    (char limit, platform not connected, no schedule slot, etc.)
  //  - null publish_status: publish-to-zernio never actually ran to
  //    completion at all — the approve action's fire-and-forget invoke()
  //    call dropped (network blip, tab closed, cold-start timeout) before
  //    the function's own status-writing logic ever executed. This is the
  //    "silent limbo" case: scheduled_for can still be populated (stamped
  //    at generation time, independent of the handoff), which is what made
  //    it look superficially like a real schedule.
  // Note: a draft sits in the null-status bucket for the few seconds
  // between approval and publish-to-zernio actually completing even in the
  // success case — a brief false positive here is expected and harmless
  // (Retry is idempotent against an in-flight or already-succeeded call);
  // the alternative (silently missing real limbo cases) is worse.
  const isStuck = (d: Draft) =>
    d.publish_status === "needs_attention" || d.publish_status === "failed" || !d.publish_status;

  const attentionDrafts = drafts.filter(isStuck);
  const attentionIds = new Set(attentionDrafts.map((d) => d.id));

  const getAttentionMeta = (draft: Draft) => {
    if (draft.publish_status === "failed") {
      return { label: "Provider error", badgeClass: "bg-red-50 text-red-700 border-red-200", message: draft.publish_error || "No reason recorded." };
    }
    if (draft.publish_status === "needs_attention") {
      return { label: "Not scheduled", badgeClass: "bg-amber-100 text-amber-800 border-amber-300", message: draft.publish_error || "No reason recorded." };
    }
    // publish_status is null/undefined — never actually reached the scheduler.
    return {
      label: "Never sent to scheduler",
      badgeClass: "bg-orange-100 text-orange-800 border-orange-300",
      message: draft.publish_error || "Approved, but the request to schedule it never completed (dropped network request, closed tab, or a timed-out request during approval). Nothing has posted — retry below.",
    };
  };

  const formatById = new Map(formats.map((f) => [f.id, f]));
  const platforms = Array.from(new Set(formats.map((f) => f.platform))).sort();
  const formatOptionsForPlatform = platformFilter === ALL ? formats : formats.filter((f) => f.platform === platformFilter);
  const visibleDrafts = drafts.filter((d) => {
    if (attentionIds.has(d.id)) return false; // already shown in the Needs attention card above
    const fmt = d.format_id ? formatById.get(d.format_id) : undefined;
    if (platformFilter !== ALL && fmt?.platform !== platformFilter) return false;
    if (formatFilter !== ALL && d.format_id !== formatFilter) return false;
    return true;
  });

  if (loading) {
    return <div className="text-center py-16 text-muted-foreground">Loading approved drafts...</div>;
  }

  return (
    <>
      {attentionDrafts.length > 0 && (
        <Card className="mb-6 border-amber-300 bg-amber-50">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <CardTitle className="flex items-center gap-2 text-amber-900 text-lg">
                  <AlertTriangle className="h-5 w-5" />
                  Needs attention ({attentionDrafts.length})
                </CardTitle>
                <CardDescription className="text-amber-800">
                  These drafts were approved but did not schedule. Fix the cause, then retry. Nothing here has posted.
                </CardDescription>
              </div>
              {attentionDrafts.length > 1 && (
                <Button size="sm" variant="outline" onClick={handleRetryAll} disabled={retryingAll || !!retryingId} className="shrink-0 bg-white">
                  <ListRestart className="h-4 w-4 mr-1" />
                  {retryingAll ? `Retrying ${retryingId ? attentionDrafts.findIndex(d => d.id === retryingId) + 1 : 1} of ${attentionDrafts.length}...` : `Retry all ${attentionDrafts.length}`}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {attentionDrafts.map((draft) => {
              const meta = getAttentionMeta(draft);
              return (
                <div key={draft.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-md border border-amber-200 bg-white p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className={meta.badgeClass}>
                        {meta.label}
                      </Badge>
                      <span className="font-medium truncate">{draft.title || draft.seed_insight}</span>
                    </div>
                    <p className="text-sm text-amber-900">{meta.message}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => navigate(`/drafts/${draft.id}`)}>
                      <ExternalLink className="h-4 w-4 mr-1" />View
                    </Button>
                    <Button size="sm" onClick={() => handleRetrySchedule(draft.id)} disabled={retryingId === draft.id || retryingAll}>
                      <RefreshCw className="h-4 w-4 mr-1" />{retryingId === draft.id ? "Retrying..." : "Retry"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {formats.length > 0 && drafts.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap mb-4">
          <Label className="text-sm text-muted-foreground whitespace-nowrap">Filter</Label>
          <Select value={platformFilter} onValueChange={(v) => { setPlatformFilter(v); setFormatFilter(ALL); }}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Platform" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All platforms</SelectItem>
              {platforms.map((p) => <SelectItem key={p} value={p}>{platformLabel(p)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={formatFilter} onValueChange={setFormatFilter}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="Post type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All post types</SelectItem>
              {formatOptionsForPlatform.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {(platformFilter !== ALL || formatFilter !== ALL) && (
            <Button variant="ghost" size="sm" onClick={() => { setPlatformFilter(ALL); setFormatFilter(ALL); }}>Clear filter</Button>
          )}
          {(platformFilter !== ALL || formatFilter !== ALL) && (
            <span className="text-xs text-muted-foreground">{visibleDrafts.length} of {drafts.length - attentionDrafts.length} shown</span>
          )}
        </div>
      )}

      {drafts.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <CheckCheck className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No approved drafts yet</h3>
            <p className="text-muted-foreground mb-6">Approve drafts from the Pending tab to see them here.</p>
          </CardContent>
        </Card>
      ) : visibleDrafts.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-sm">{attentionDrafts.length > 0 && drafts.length === attentionDrafts.length ? "Every approved draft needs attention right now (see above)." : "No approved drafts match this filter."}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {visibleDrafts.map((draft) => {
            const isPostedNow = draft.publish_status === "published_now";
            const isPostingNow = postingNowId === draft.id;
            return (
              <div
                key={draft.id}
                className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/30 gap-4"
              >
                <div
                  className="flex-1 min-w-0 cursor-pointer"
                  style={{ "--kl-accent": accentColor } as React.CSSProperties}
                  onClick={() => navigate(`/drafts/${draft.id}`)}
                >
                  <p className="text-sm font-medium truncate hover:text-[var(--kl-accent)] transition-colors">{draft.title || draft.seed_insight}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline">{draft.content_type || "blog_post"}</Badge>
                    {getScheduleLabel(draft)}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isPostedNow ? (
                    <Badge style={{ backgroundColor: accentColor, color: "#ffffff" }} className="flex items-center gap-1 px-3">
                      <Send className="h-3 w-3" />Posted
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      disabled={isPostingNow}
                      onClick={() => handlePostNow(draft)}
                      style={{ backgroundColor: accentColor, color: "#ffffff" }}
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
