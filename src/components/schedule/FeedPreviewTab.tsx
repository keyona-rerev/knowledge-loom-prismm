import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RefreshCw,
  Globe,
  ThumbsUp,
  MessageSquare,
  Repeat2,
  Send,
  Linkedin,
} from "lucide-react";

// LinkedIn-style preview of the upcoming publishing queue: approved drafts
// already handed to the scheduler (publish_status='scheduled') with a future
// slot, rendered roughly the way they will appear in the LinkedIn feed, so
// the text and image of each upcoming post can be experienced together
// before it goes out. Read-only: nothing here approves, edits or publishes.
//
// Fidelity notes: the card approximates LinkedIn's desktop feed layout
// (truncation after about three lines with a "more" expansion, full-width
// image, standard action row). LinkedIn's exact truncation and rendering
// vary by device and surface, so this is a preview, not a pixel guarantee.
// Posts without a ready visual publish text-only, so their cards show no
// image block at all rather than a placeholder that would never ship.

interface PreviewDraft {
  id: string;
  title: string | null;
  body: string | null;
  content_type: string | null;
  scheduled_for: string;
}

// Same fallback convention as PostedTab: Prismm coral, only until the
// profile's own primary_color has loaded.
const FALLBACK_ACCENT = "#f9655b";

// Roughly where LinkedIn's feed truncation lands (~3 lines on desktop).
const TRUNCATE_AT = 260;

const initialsFor = (name: string): string => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "P";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
};

const PreviewCard = ({
  draft,
  imageUrl,
  pageName,
  accentColor,
  onOpen,
}: {
  draft: PreviewDraft;
  imageUrl: string | null;
  pageName: string;
  accentColor: string;
  onOpen: () => void;
}) => {
  const [expanded, setExpanded] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const body = (draft.body ?? "").trim();
  const isLong = body.length > TRUNCATE_AT;
  const shown = expanded || !isLong ? body : body.slice(0, TRUNCATE_AT).trimEnd();

  return (
    <article
      className="bg-white rounded-lg border border-gray-200 overflow-hidden cursor-pointer hover:shadow-sm transition-shadow"
      onClick={onOpen}
      title="Open this draft"
    >
      <div className="flex items-start gap-3 px-4 pt-3 pb-2">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center text-white font-semibold text-sm shrink-0"
          style={{ backgroundColor: accentColor }}
        >
          {initialsFor(pageName)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900 truncate">{pageName}</p>
          <p className="text-xs text-gray-500 truncate">Company page</p>
          <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
            Scheduled for {format(new Date(draft.scheduled_for), "EEE, MMM d 'at' h:mm a")}
            <span aria-hidden>·</span>
            <Globe className="h-3 w-3" />
          </p>
        </div>
      </div>

      <div className="px-4 pb-2">
        <p className="text-sm text-gray-900 whitespace-pre-wrap break-words">
          {shown}
          {isLong && !expanded && (
            <button
              type="button"
              className="text-gray-500 hover:text-blue-700 font-medium ml-1"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(true);
              }}
            >
              …more
            </button>
          )}
        </p>
        {isLong && expanded && (
          <button
            type="button"
            className="text-xs text-gray-500 hover:text-blue-700 font-medium"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(false);
            }}
          >
            Show less
          </button>
        )}
      </div>

      {imageUrl && !imgFailed && (
        <img
          src={imageUrl}
          alt=""
          className="w-full object-cover"
          loading="lazy"
          onError={() => setImgFailed(true)}
        />
      )}

      <div className="flex items-center justify-around border-t border-gray-100 mt-2 px-2 py-1">
        {[
          { icon: ThumbsUp, label: "Like" },
          { icon: MessageSquare, label: "Comment" },
          { icon: Repeat2, label: "Repost" },
          { icon: Send, label: "Send" },
        ].map(({ icon: Icon, label }) => (
          <span
            key={label}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-500 px-2 py-1.5"
          >
            <Icon className="h-4 w-4" />
            {label}
          </span>
        ))}
      </div>
    </article>
  );
};

export const FeedPreviewTab = () => {
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState<PreviewDraft[]>([]);
  const [imagesByDraft, setImagesByDraft] = useState<Record<string, string>>({});
  const [pageName, setPageName] = useState("Your page");
  const [accentColor, setAccentColor] = useState(FALLBACK_ACCENT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setLoading(false);
      return;
    }
    const nowIso = new Date().toISOString();

    const [draftsRes, profileRes] = await Promise.all([
      supabase
        .from("drafts")
        .select("id, title, body, content_type, scheduled_for")
        .eq("user_id", session.user.id)
        .eq("approval_status", "approved")
        .eq("publish_status", "scheduled")
        .gt("scheduled_for", nowIso)
        .order("scheduled_for", { ascending: true })
        .limit(50),
      supabase
        .from("profiles")
        .select("business_name, primary_color")
        .eq("user_id", session.user.id)
        .maybeSingle(),
    ]);

    if (draftsRes.error) {
      console.error("Error loading scheduled drafts for preview:", draftsRes.error);
      setDrafts([]);
      setError("Couldn’t load the scheduled posts. Check your connection and try again.");
      setLoading(false);
      return;
    }
    setError(null);

    const rows = (draftsRes.data || []).filter(
      (d): d is PreviewDraft => typeof d.scheduled_for === "string" && !!d.scheduled_for
    );
    setDrafts(rows);

    if (profileRes.data?.business_name) setPageName(profileRes.data.business_name);
    if (profileRes.data?.primary_color) setAccentColor(profileRes.data.primary_color);

    if (rows.length > 0) {
      const { data: visuals } = await supabase
        .from("draft_visuals")
        .select("draft_id, image_url, created_at")
        .in("draft_id", rows.map((d) => d.id))
        .eq("status", "ready")
        .order("created_at", { ascending: false });
      const map: Record<string, string> = {};
      for (const v of visuals || []) {
        if (v.image_url && !map[v.draft_id]) map[v.draft_id] = v.image_url;
      }
      setImagesByDraft(map);
    } else {
      setImagesByDraft({});
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const headerNote = useMemo(
    () =>
      drafts.length === 1
        ? "1 upcoming post, shown the way it will look in the LinkedIn feed."
        : `${drafts.length} upcoming posts, shown the way they will look in the LinkedIn feed.`,
    [drafts.length]
  );

  if (loading) {
    return (
      <div className="max-w-[550px] mx-auto space-y-3 py-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
            <div className="flex items-center gap-3">
              <Skeleton className="w-12 h-12 rounded-full" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </div>
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-40 w-full" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="-mx-4 px-4 py-4 bg-[#f4f2ee] rounded-md">
      <div className="max-w-[550px] mx-auto">
        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          <p className="text-sm text-gray-600">{headerNote} Preview only — nothing here publishes from this view.</p>
          <Button variant="outline" size="sm" onClick={load} className="bg-white">
            <RefreshCw className="h-3.5 w-3.5 mr-2" />
            Refresh
          </Button>
        </div>

        {error ? (
          <div className="text-center py-16 text-gray-500 bg-white rounded-lg border border-gray-200">
            <p className="text-sm font-medium text-gray-700">{error}</p>
            <Button variant="outline" size="sm" onClick={load} className="mt-4">
              <RefreshCw className="h-3.5 w-3.5 mr-2" />
              Try again
            </Button>
          </div>
        ) : drafts.length === 0 ? (
          <div className="text-center py-16 text-gray-500 bg-white rounded-lg border border-gray-200">
            <Linkedin className="h-10 w-10 mx-auto mb-4 opacity-30" />
            <p className="text-sm font-medium text-gray-700">No scheduled posts yet</p>
            <p className="text-xs mt-1">Approved posts appear here before they go out.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {drafts.map((draft) => (
              <PreviewCard
                key={draft.id}
                draft={draft}
                imageUrl={imagesByDraft[draft.id] ?? null}
                pageName={pageName}
                accentColor={accentColor}
                onOpen={() => navigate(`/drafts/${draft.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default FeedPreviewTab;
