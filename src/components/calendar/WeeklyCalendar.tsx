// src/components/calendar/WeeklyCalendar.tsx
import { useState, useEffect } from 'react';
import { DragDropContext, DropResult } from '@hello-pangea/dnd';
import { format, startOfWeek, addDays } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { CalendarSlot } from './drag-drop-types';
import { CalendarHeader } from './CalendarHeader';
import { CalendarDayColumn } from './CalendarDayColumn';
import { ReadyToSchedule } from './ReadyToSchedule';
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
          approval_status,
          content_type
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

    // Check if this is a draft being dragged to calendar (starts with 'draft-')
    if (result.draggableId.startsWith('draft-')) {
      const draftId = result.draggableId.replace('draft-', '');
      const newDate = new Date(result.destination.droppableId);
      
      try {
        // First, get the draft details to know the content_type
        const { data: draftData, error: draftError } = await supabase
          .from('drafts')
          .select('content_type')
          .eq('id', draftId)
          .single();

        if (draftError) throw draftError;

        const { data: { session } } = await supabase.auth.getSession();
        
        // Create new calendar entry for the draft
        const { error } = await supabase
          .from('content_calendar')
          .insert({
            user_id: session?.user?.id,
            draft_id: draftId,
            scheduled_date: newDate.toISOString(),
            content_type: draftData.content_type || 'blog_post',
            status: 'scheduled'
          });

        if (error) throw error;

        toast.success('Content scheduled!');
        await loadCalendarSlots(); // Reload to show the new entry
        // Trigger refresh of ReadyToSchedule by dispatching an event
        window.dispatchEvent(new CustomEvent('calendar-updated'));
      } catch (error) {
        console.error('Error scheduling draft:', error);
        toast.error('Failed to schedule content');
      }
    } else {
      // Existing logic for moving existing calendar slots
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
        loadCalendarSlots();
      }
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
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="h-screen flex bg-gray-50">
        {/* Ready to Schedule Sidebar */}
        <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
          <div className="p-4 border-b">
            <h2 className="font-semibold text-lg">Ready to Schedule</h2>
            <p className="text-sm text-gray-600 mt-1">Drag approved drafts to calendar</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            <ReadyToSchedule />
          </div>
        </div>
        
        {/* Main Calendar */}
        <div className="flex-1 flex flex-col">
          <CalendarHeader 
            currentWeek={currentWeek}
            onWeekChange={setCurrentWeek}
            onRefresh={loadCalendarSlots}
          />
          
          <div className="flex-1 grid grid-cols-7 gap-4 p-6">
            {getWeekDays().map(day => (
              <CalendarDayColumn 
                key={day.toISOString()}
                date={day}
                slots={getSlotsForDay(day)}
                onSlotDeleted={() => {
                  loadCalendarSlots();
                  window.dispatchEvent(new CustomEvent('calendar-updated'));
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </DragDropContext>
  );
};