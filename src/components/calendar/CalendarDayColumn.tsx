import { Droppable } from "@hello-pangea/dnd";
import { format, isToday, isSameDay } from "date-fns";
import { CalendarSlot } from "./drag-drop-types";
import { CalendarSlotCard } from "./CalendarSlotCard";
import { EmptyDayState } from "./EmptyDayState";

interface CalendarDayColumnProps {
  date: Date;
  slots: CalendarSlot[];
}

export const CalendarDayColumn = ({ date, slots }: CalendarDayColumnProps) => {
  const isTodayDate = isToday(date);
  const isWeekend = date.getDay() === 0 || date.getDay() === 6;

  return (
    <Droppable droppableId={date.toISOString()}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.droppableProps}
          className={`
            bg-white rounded-lg shadow-sm border min-h-[600px] transition-colors
            ${snapshot.isDraggingOver ? 'bg-blue-50 border-blue-200' : 'border-gray-200'}
            ${isWeekend ? 'bg-gray-50' : ''}
          `}
        >
          {/* Day Header */}
          <div className={`
            p-3 border-b rounded-t-lg transition-colors
            ${isTodayDate 
              ? 'bg-blue-600 text-white' 
              : 'bg-white text-gray-900'
            }
          `}>
            <div className={`font-semibold ${isTodayDate ? 'text-blue-100' : 'text-gray-500'}`}>
              {format(date, 'EEE')}
            </div>
            <div className={`text-2xl font-bold ${isTodayDate ? 'text-white' : 'text-gray-900'}`}>
              {format(date, 'd')}
            </div>
            <div className={`text-sm ${isTodayDate ? 'text-blue-100' : 'text-gray-500'}`}>
              {format(date, 'MMM yyyy')}
            </div>
          </div>

          {/* Content Slots */}
          <div className="p-2 space-y-2">
            {slots.map((slot, index) => (
              <CalendarSlotCard 
                key={slot.id}
                slot={slot}
                index={index}
              />
            ))}
            
            {slots.length === 0 && (
              <EmptyDayState date={date} />
            )}
            
            {provided.placeholder}
          </div>
        </div>
      )}
    </Droppable>
  );
};