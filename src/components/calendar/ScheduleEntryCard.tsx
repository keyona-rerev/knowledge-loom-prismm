import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScheduledDraft } from "./schedule-types";
import { format } from "date-fns";
import { FileText, Send, Clock } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface ScheduleEntryCardProps {
  draft: ScheduledDraft;
  onEditTime: () => void;
}

const CONTENT_TYPE_COLORS: Record<string, string> = {
  blog_post: "border-l-blue-500 bg-blue-50 hover:bg-blue-100 text-blue-900",
  newsletter: "border-l-green-500 bg-green-50 hover:bg-green-100 text-green-900",
  social_post: "border-l-purple-500 bg-purple-50 hover:bg-purple-100 text-purple-900",
  video_script: "border-l-orange-500 bg-orange-50 hover:bg-orange-100 text-orange-900",
};

export const ScheduleEntryCard = ({ draft, onEditTime }: ScheduleEntryCardProps) => {
  const navigate = useNavigate();
  const isPosted = draft.publish_status === "published_now";
  const colorClass = CONTENT_TYPE_COLORS[draft.content_type || ""] || "border-l-gray-500 bg-gray-50 text-gray-900";

  return (
    <div
      className={`p-3 rounded-lg border border-l-4 shadow-sm hover:shadow-md transition-shadow cursor-pointer ${colorClass}`}
      onClick={() => navigate(`/drafts/${draft.id}`)}
    >
      <div className="flex justify-between items-start gap-2 mb-2">
        <h4 className="font-medium text-sm line-clamp-2 leading-tight flex-1">
          {draft.title || "Untitled draft"}
        </h4>
        {isPosted ? (
          <Badge style={{ backgroundColor: "#f9655b", color: "#ffffff" }} className="text-xs shrink-0 flex items-center gap-1">
            <Send className="h-3 w-3" />Posted
          </Badge>
        ) : (
          <Badge variant="outline" className="text-xs shrink-0 bg-green-50 text-green-700 border-green-200">
            Scheduled
          </Badge>
        )}
      </div>

      <div className="flex justify-between items-center text-xs">
        <Badge variant="outline" className="capitalize bg-white/50">
          <span className="flex items-center gap-1">
            <FileText className="h-3 w-3" />
            {(draft.content_type || "post").replace("_", " ")}
          </span>
        </Badge>
        <span className="font-medium opacity-75">{format(new Date(draft.scheduled_for), "h:mm a")}</span>
      </div>

      {!isPosted && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full mt-2 h-7 text-xs"
          onClick={(e) => { e.stopPropagation(); onEditTime(); }}
        >
          <Clock className="h-3 w-3 mr-1" />Edit time
        </Button>
      )}
    </div>
  );
};
