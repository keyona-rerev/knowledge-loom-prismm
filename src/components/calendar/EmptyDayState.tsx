import { CalendarX } from "lucide-react";
import { isToday, isBefore } from "date-fns";

interface EmptyDayStateProps {
  date: Date;
}

export const EmptyDayState = ({ date }: EmptyDayStateProps) => {
  const isPastDate = isBefore(date, new Date()) && !isToday(date);

  return (
    <div className={`
      text-center p-6 border-2 border-dashed rounded-lg
      ${isPastDate ? "border-gray-200 bg-gray-50" : "border-gray-300 bg-white"}
    `}>
      <CalendarX className="h-8 w-8 mx-auto mb-2 text-gray-400" />
      <p className="text-sm text-gray-500">Nothing scheduled</p>
    </div>
  );
};
