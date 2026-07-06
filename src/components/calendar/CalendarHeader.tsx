import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, CalendarCheck, AlertTriangle, CalendarDays, CalendarRange } from "lucide-react";
import { format, startOfWeek, addWeeks, subWeeks, addMonths, subMonths } from "date-fns";
import { useNavigate } from "react-router-dom";

export type ScheduleViewMode = "week" | "month";

interface CalendarHeaderProps {
  currentDate: Date;
  viewMode: ScheduleViewMode;
  onDateChange: (date: Date) => void;
  onViewModeChange: (mode: ScheduleViewMode) => void;
  onRefresh?: () => void;
  scheduledCount?: number;
  needsAttentionCount?: number;
}

// Generalized over week/month so both grids share one nav+toggle+counts
// bar. Label and step size are derived from viewMode rather than the caller
// computing them, so ScheduleCalendar just hands over the current anchor
// date and doesn't need to know week/month date-math itself.
export const CalendarHeader = ({
  currentDate,
  viewMode,
  onDateChange,
  onViewModeChange,
  onRefresh,
  scheduledCount,
  needsAttentionCount,
}: CalendarHeaderProps) => {
  const navigate = useNavigate();

  const label = viewMode === "week"
    ? (() => {
        const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 });
        const weekEnd = addWeeks(weekStart, 1);
        return `${format(weekStart, "MMM d")} - ${format(weekEnd, "MMM d, yyyy")}`;
      })()
    : format(currentDate, "MMMM yyyy");

  const goToPrevious = () => onDateChange(viewMode === "week" ? subWeeks(currentDate, 1) : subMonths(currentDate, 1));
  const goToNext = () => onDateChange(viewMode === "week" ? addWeeks(currentDate, 1) : addMonths(currentDate, 1));
  const goToToday = () => onDateChange(new Date());

  return (
    <div className="flex items-center justify-between p-6 border-b bg-white flex-wrap gap-4">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={goToPrevious}>
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <div className="text-lg font-semibold min-w-[200px] text-center">
            {label}
          </div>

          <Button variant="outline" size="sm" onClick={goToNext}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center rounded-md border overflow-hidden">
          <Button
            type="button"
            variant={viewMode === "week" ? "default" : "ghost"}
            size="sm"
            className="rounded-none"
            onClick={() => onViewModeChange("week")}
          >
            <CalendarRange className="h-3.5 w-3.5 mr-1.5" />Week
          </Button>
          <Button
            type="button"
            variant={viewMode === "month" ? "default" : "ghost"}
            size="sm"
            className="rounded-none"
            onClick={() => onViewModeChange("month")}
          >
            <CalendarDays className="h-3.5 w-3.5 mr-1.5" />Month
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {typeof scheduledCount === "number" && (
          <Badge
            variant="outline"
            className="bg-green-50 text-green-700 border-green-200 px-3 py-1.5 cursor-pointer hover:bg-green-100"
            onClick={() => navigate("/review?tab=approved")}
          >
            <CalendarCheck className="h-3.5 w-3.5 mr-1.5" />
            {scheduledCount} scheduled
          </Badge>
        )}
        {typeof needsAttentionCount === "number" && needsAttentionCount > 0 && (
          <Badge
            variant="outline"
            className="bg-amber-50 text-amber-800 border-amber-300 px-3 py-1.5 cursor-pointer hover:bg-amber-100"
            onClick={() => navigate("/review?tab=approved")}
          >
            <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />
            {needsAttentionCount} needs attention
          </Badge>
        )}
        <Button variant="outline" onClick={goToToday}>Today</Button>
        {onRefresh && (
          <Button variant="outline" onClick={onRefresh}>Refresh</Button>
        )}
      </div>
    </div>
  );
};
