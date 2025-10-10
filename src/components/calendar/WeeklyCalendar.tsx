// src/components/calendar/WeeklyCalendar.tsx
import { useState, useEffect } from 'react';
import { DragDropContext, DropResult } from '@hello-pangea/dnd';
import { format, startOfWeek, addDays } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { CalendarSlot } from './drag-drop-types';
import { CalendarHeader } from './CalendarHeader';
import { CalendarDayColumn } from './CalendarDayColumn';
import { toast } from 'sonner';

export const WeeklyCalendar = () => {
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [calendarSlots, setCalendarSlots] = useState<CalendarSlot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCalendarSlots();
  }, [currentWeek]);

  const loadCalendarSlots = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    
    const weekStart = startOfWeek(currentWeek, { weekStartsOn: 0 });
    const weekEnd = addDays(weekStart, 7);

    const { data, error } = await supabase
      .from('content_calendar')
      .select(`
        *,
        draft:drafts (
          id,
          title,
          body,
          approval_status
        )
      `)
      .eq('user_id', session?.user?.id)
      .gte('scheduled_date', weekStart.toISOString())
      .lt('scheduled_date', weekEnd.toISOString())
      .order('scheduled_date');

    if (error) {
      console.error('Error loading calendar slots:', error);
      toast.error('Failed to load calendar');
    } else {
      setCalendarSlots(data || []);
    }
    setLoading(false);
  };

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination) return;

    const slotId = result.draggableId;
    const newDate = new Date(result.destination.droppableId);
    
    try {
      const { error } = await supabase
        .from('content_calendar')
        .update({ scheduled_date: newDate.toISOString() })
        .eq('id', slotId);

      if (error) throw error;

      // Optimistically update UI
      setCalendarSlots(prev => prev.map(slot =>
        slot.id === slotId 
          ? { ...slot, scheduled_date: newDate.toISOString() }
          : slot
      ));

      toast.success('Content rescheduled!');
    } catch (error) {
      console.error('Error rescheduling:', error);
      toast.error('Failed to reschedule');
      // Reload to reset UI state
      loadCalendarSlots();
    }
  };

  const getWeekDays = () => {
    const start = startOfWeek(currentWeek, { weekStartsOn: 0 });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  };

  const getSlotsForDay = (date: Date) => {
    return calendarSlots.filter(slot => {
      const slotDate = new Date(slot.scheduled_date);
      return slotDate.toDateString() === date.toDateString();
    });
  };

  if (loading) {
    return (
      <div className="h-96 flex items-center justify-center">
        <div className="animate-pulse text-lg text-gray-600">Loading calendar...</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <CalendarHeader 
        currentWeek={currentWeek}
        onWeekChange={setCurrentWeek}
        onRefresh={loadCalendarSlots}
      />
      
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="flex-1 grid grid-cols-7 gap-4 p-6">
          {getWeekDays().map(day => (
            <CalendarDayColumn 
              key={day.toISOString()}
              date={day}
              slots={getSlotsForDay(day)}
            />
          ))}
        </div>
      </DragDropContext>
    </div>
  );
};