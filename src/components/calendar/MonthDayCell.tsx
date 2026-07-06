// src/components/calendar/MonthDayCell.tsx
//
// Compact day cell for the month grid. Shows up to MAX_VISIBLE entries as
// small draggable chips; anything beyond that collapses into a "+N more"
// pill. Clicking "+N more" jumps the parent back to week view centered on
// that date (via onShowMore) rather than trying to cram an unbounded list
// into a ~110px cell — the week grid's full ScheduleEntryCard (with the
// "Edit time" button) is where precise-time editing lives; this cell only
// needs to support drag-to-reschedule and a click-through to the draft.
import { useState } from "react";
import { format, isToday, isSameMonth } from "date-fns";
import { ScheduledDraft } from "./schedule-types";
import { useNavigate } from "react-router-dom";

const MAX_VISIBLE = 3;

const CONTENT_TYPE_DOT: Record<string, string> = {
  blog_post: "bg-blue-500",
  newsletter: "bg-green-500",
  social_post: "bg-purple-500",
  video_script: "bg-orange-500",
};

interface MonthDayCellProps {
  date: Date;
  monthAnchor: Date;
  drafts: ScheduledDraft[];
  isCadenceDay: boolean;
  onDropDraft: (draftId: string, date: Date) => void;
  onShowMore: (date: Date) => void;
}

export const MonthDayCell = ({ date, monthAnchor, drafts, isCadenceDay, onDropDraft, onShowMore }: MonthDayCellProps) => {
  const navigate = useNavigate();
  const [isDragOver, setIsDragOver] = useState(false);
  const inMonth = isSameMonth(date, monthAnchor);
  const isTodayDate = isToday(date);
  const visible = drafts.slice(0, MAX_VISIBLE);
  const overflow = drafts.length - visible.length;

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        const draftId = e.dataTransfer.getData("text/plain");
        if (draftId) onDropDraft(draftId, date);
      }}
      className={`
        min-h-[110px] p-1.5 border-b border-r flex flex-col gap-1 transition-colors
        ${isDragOver ? "bg-blue-50/60 ring-1 ring-inset ring-blue-400" : !inMonth ? "bg-gray-50/60" : isCadenceDay ? "bg-purple-50/40" : "bg-white"}
      `}
    >
      <div className="flex items-center justify-between px-0.5">
        <span
          className={`
            text-xs font-semibold h-5 w-5 flex items-center justify-center rounded-full shrink-0
            ${isTodayDate ? "bg-blue-600 text-white" : !inMonth ? "text-gray-300" : "text-gray-600"}
          `}
        >
          {format(date, "d")}
        </span>
        {isCadenceDay && inMonth && (
          <span className="text-[9px] font-medium text-purple-600 uppercase tracking-wide">Cadence</span>
        )}
      </div>

      <div className="flex flex-col gap-1 flex-1">
        {visible.map((d) => (
          <div
            key={d.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", d.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onClick={() => navigate(`/drafts/${d.id}`)}
            className="text-[10px] leading-tight px-1 py-0.5 rounded border-l-2 border-l-gray-400 bg-gray-100 hover:bg-gray-200 cursor-grab active:cursor-grabbing truncate flex items-center gap-1"
            title={d.title || "Untitled draft"}
          >
            <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${CONTENT_TYPE_DOT[d.content_type || ""] || "bg-gray-400"}`} />
            <span className="truncate">{format(new Date(d.scheduled_for), "h:mmaaa")} {d.title || "Untitled draft"}</span>
          </div>
        ))}
        {overflow > 0 && (
          <button
            type="button"
            onClick={() => onShowMore(date)}
            className="text-[10px] text-left px-1 text-blue-600 hover:underline"
          >
            +{overflow} more
          </button>
        )}
      </div>
    </div>
  );
};
