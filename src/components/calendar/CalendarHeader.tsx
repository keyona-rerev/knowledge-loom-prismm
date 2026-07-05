import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, CheckCheck } from "lucide-react";
import { format, startOfWeek, addWeeks, subWeeks } from "date-fns";

interface CalendarHeaderProps {
  currentWeek: Date;
  onWeekChange: (date: Date) => void;
  onRefresh?: () => void;
  approvedCount?: number;
}

export const CalendarHeader = ({ currentWeek, onWeekChange, onRefresh, approvedCount }: CalendarHeaderProps) => {
  const weekStart = startOfWeek(currentWeek, { weekStartsOn: 0 });
  const weekEnd = addWeeks(weekStart, 1);

  const goToPreviousWeek = () => {
    onWeekChange(subWeeks(currentWeek, 1));
  };

  const goToNextWeek = () => {
    onWeekChange(addWeeks(currentWeek, 1));
  };

  const goToToday = () => {
    onWeekChange(new Date());
  };

  return (
    <div className="flex items-center justify-between p-6 border-b bg-white">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={goToPreviousWeek}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          
          <div className="text-lg font-semibold min-w-[200px] text-center">
            {format(weekStart, 'MMM d')} - {format(weekEnd, 'MMM d, yyyy')}
          </div>
          
          <Button
            variant="outline"
            size="sm"
            onClick={goToNextWeek}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {typeof approvedCount === "number" && (
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 px-3 py-1.5">
            <CheckCheck className="h-3.5 w-3.5 mr-1.5" />
            {approvedCount} approved
          </Badge>
        )}
        <Button
          variant="outline"
          onClick={goToToday}
        >
          Today
        </Button>
        {onRefresh && (
          <Button
            variant="outline"
            onClick={onRefresh}
          >
            Refresh
          </Button>
        )}
      </div>
    </div>
  );
};
