import { Button } from "@/components/ui/button";
import { CalendarPlus, Upload } from "lucide-react";
import { format, isToday, isBefore, isAfter } from "date-fns";

interface EmptyDayStateProps {
  date: Date;
  onAddContent?: () => void;
}

export const EmptyDayState = ({ date, onAddContent }: EmptyDayStateProps) => {
  const isTodayDate = isToday(date);
  const isPastDate = isBefore(date, new Date()) && !isTodayDate;
  const isFutureDate = isAfter(date, new Date());

  const getMessage = () => {
    if (isPastDate) return "No content scheduled";
    if (isTodayDate) return "Schedule content for today";
    return "Drag approved drafts here";
  };

  const getSubMessage = () => {
    if (isPastDate) return "This day has passed";
    if (isTodayDate) return "Add content to publish today";
    return "Drop content to schedule";
  };

  return (
    <div className={`
      text-center p-6 border-2 border-dashed rounded-lg transition-all
      hover:border-gray-400 group
      ${isPastDate 
        ? 'border-gray-200 bg-gray-50' 
        : 'border-gray-300 bg-white hover:shadow-sm'
      }
    `}>
      <CalendarPlus className={`
        h-8 w-8 mx-auto mb-3 transition-colors
        ${isPastDate ? 'text-gray-400' : 'text-gray-500 group-hover:text-blue-500'}
      `} />
      
      <p className={`
        text-sm font-medium mb-1
        ${isPastDate ? 'text-gray-500' : 'text-gray-700'}
      `}>
        {getMessage()}
      </p>
      
      <p className={`
        text-xs mb-4
        ${isPastDate ? 'text-gray-400' : 'text-gray-500'}
      `}>
        {getSubMessage()}
      </p>

      {!isPastDate && onAddContent && (
        <Button
          variant="outline"
          size="sm"
          onClick={onAddContent}
          className="gap-2"
        >
          <Upload className="h-3 w-3" />
          Add Content
        </Button>
      )}
    </div>
  );
};