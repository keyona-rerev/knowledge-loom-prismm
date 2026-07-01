import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Ban, ExternalLink } from "lucide-react";

interface RejectedDraft {
  id: string;
  title: string | null;
  seed_insight: string | null;
  review_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
}

// Rejected tab: a plain log, not a workflow. Just what was rejected, why
// (review_notes, the reason typed into the reject dialog), when, and a link
// back to the draft. No actions here on purpose — a rejected draft is done;
// if it needs another shot, that happens by creating new content, not by
// reviving this one.
export const RejectedTab = () => {
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState<RejectedDraft[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setLoading(false); return; }
    const { data, error } = await supabase
      .from("drafts")
      .select("id, title, seed_insight, review_notes, reviewed_at, created_at")
      .eq("user_id", session.user.id)
      .eq("approval_status", "rejected")
      .order("reviewed_at", { ascending: false, nullsFirst: false });
    if (error) {
      toast.error("Failed to load rejection log");
    } else {
      setDrafts(data || []);
    }
    setLoading(false);
  };

  if (loading) {
    return <div className="text-center py-16 text-muted-foreground">Loading rejection log...</div>;
  }

  if (drafts.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Ban className="h-10 w-10 mx-auto mb-4 opacity-30" />
        <p className="text-sm">Nothing's been rejected.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {drafts.map((draft) => (
        <div
          key={draft.id}
          className="flex items-start justify-between gap-4 p-4 border rounded-lg hover:bg-muted/30"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">{draft.title || draft.seed_insight || "Untitled draft"}</span>
              <span className="text-xs text-muted-foreground shrink-0">
                {draft.reviewed_at ? new Date(draft.reviewed_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "date unknown"}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {draft.review_notes?.trim() ? draft.review_notes : "No reason recorded."}
            </p>
          </div>
          <button
            onClick={() => navigate(`/drafts/${draft.id}`)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-[#f9655b] transition-colors shrink-0 mt-0.5"
          >
            <ExternalLink className="h-3.5 w-3.5" />View draft
          </button>
        </div>
      ))}
    </div>
  );
};

export default RejectedTab;
