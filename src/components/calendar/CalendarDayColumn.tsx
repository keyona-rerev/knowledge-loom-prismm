import { format, isToday } from "date-fns";
import { ScheduledDraft } from "./schedule-types";
import { ScheduleEntryCard } from "./ScheduleEntryCard";
import { EmptyDayState } from "./EmptyDayState";

interface CalendarDayColumnProps {
  date: Date;
  drafts: ScheduledDraft[];
  onEditTime: (draft: ScheduledDraft) => void;
}

export const CalendarDayColumn = ({ date, drafts, onEditTime }: CalendarDayColumnProps) => {
  const isTodayDate = isToday(date);
  const isWeekend = date.getDay() === 0 || date.getDay() === 6;

  return (
    <div className={`
      bg-white rounded-lg shadow-sm border min-h-[400px]
      ${isWeekend ? "bg-gray-50" : "border-gray-200"}
    `}>
      <div className={`
        p-3 border-b rounded-t-lg
        ${isTodayDate ? "bg-blue-600 text-white" : "bg-white text-gray-900"}
      `}>
        <div className={`font-semibold ${isTodayDate ? "text-blue-100" : "text-gray-500"}`}>
          {format(date, "EEE")}
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
