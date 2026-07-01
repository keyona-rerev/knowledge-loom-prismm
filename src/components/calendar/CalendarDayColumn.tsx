import { useState } from "react";
import { format, isToday } from "date-fns";
import { ScheduledDraft } from "./schedule-types";
import { ScheduleEntryCard } from "./ScheduleEntryCard";
import { EmptyDayState } from "./EmptyDayState";

interface CalendarDayColumnProps {
  date: Date;
  drafts: ScheduledDraft[];
  isCadenceDay: boolean;
  onEditTime: (draft: ScheduledDraft) => void;
  onDropDraft: (draftId: string, date: Date) => void;
}

export const CalendarDayColumn = ({ date, drafts, isCadenceDay, onEditTime, onDropDraft }: CalendarDayColumnProps) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const isTodayDate = isToday(date);
  const isWeekend = date.getDay() === 0 || date.getDay() === 6;

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
        bg-white rounded-lg shadow-sm border min-h-[400px] transition-colors
        ${isDragOver ? "border-blue-400 bg-blue-50/50" : isCadenceDay ? "border-purple-200" : "border-gray-200"}
        ${isWeekend && !isCadenceDay ? "bg-gray-50" : ""}
      `}
    >
      <div className={`
        p-3 border-b rounded-t-lg
        ${isTodayDate ? "bg-blue-600 text-white" : isCadenceDay ? "bg-purple-50" : "bg-white text-gray-900"}
      `}>
        <div className={`flex items-center justify-between font-semibold ${isTodayDate ? "text-blue-100" : "text-gray-500"}`}>
          <span>{format(date, "EEE")}</span>
          {isCadenceDay && !isTodayDate && (
            <span className="text-[10px] font-medium text-purple-600 uppercase tracking-wide">Cadence</span>
          )}
        </div>
        <div className={`text-2xl font-bold ${isTodayDate ? "text-white" : "text-gray-900"}`}>
          {format(date, "d")}
        </div>
        <div className={`text-sm ${isTodayDate ? "text-blue-100" : "text-gray-500"}`}>
          {format(date, "MMM yyyy")}
        </div>
      </div>

      <div className="p-2 space-y-2">
        {drafts.map((d) => (
          <ScheduleEntryCard key={d.id} draft={d} onEditTime={() => onEditTime(d)} />
        ))}
        {drafts.length === 0 && <EmptyDayState date={date} />}
      </div>
    </div>
  );
};
