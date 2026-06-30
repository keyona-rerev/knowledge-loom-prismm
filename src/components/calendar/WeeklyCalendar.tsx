// src/components/calendar/WeeklyCalendar.tsx
//
// Real schedule view: sourced from drafts (publish_status in scheduled /
// published_now), the actual publish truth, joined to content_schedules for
// slot context. The old version read/wrote content_calendar, a table nothing
// in publish-to-zernio ever consulted, so dragging a draft onto it had zero
// effect on what Zernio actually posted.
//
// Scheduling itself now happens automatically at approval (publish-to-zernio
// resolves the slot's next occurrence), so there's no "place this draft on a
// date" interaction left to support. This view is read + edit (time only),
// not a placement tool, so drag-and-drop is gone along with it.
import { useState, useEffect } from "react";
import { startOfWeek, addDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { CalendarHeader } from "./CalendarHeader";
import { CalendarDayColumn } from "./CalendarDayColumn";
import { RescheduleDialog } from "./RescheduleDialog";
import { ScheduledDraft } from "./schedule-types";
import { toast } from "sonner";

export const WeeklyCalendar = () => {
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [drafts, setDrafts] = useState<ScheduledDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [rescheduling, setRescheduling] = useState<ScheduledDraft | null>(null);

  useEffect(() => {
    loadScheduled();
  }, [currentWeek]);

  const loadScheduled = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();

    const weekStart = startOfWeek(currentWeek, { weekStartsOn: 0 });
    const weekEnd = addDays(weekStart, 7);

    const { data, error } = await supabase
      .from("drafts")
      .select(`
        id, title, body, content_type, publish_status, scheduled_for, external_post_id,
        schedule:content_schedules ( frequency, format:formats ( name ) )
      `)
      .eq("user_id", session?.user?.id)
      .in("publish_status", ["scheduled", "published_now"])
      .gte("scheduled_for", weekStart.toISOString())
      .lt("scheduled_for", weekEnd.toISOString())
      .order("scheduled_for");

    if (error) {
      console.error("Error loading schedule:", error);
      toast.error("Failed to load schedule");
    } else {
      setDrafts((data || []) as unknown as ScheduledDraft[]);
    }
    setLoading(false);
  };

  const getWeekDays = () => {
    const start = startOfWeek(currentWeek, { weekStartsOn: 0 });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  };

  const getDraftsForDay = (date: Date) =>
    drafts.filter((d) => new Date(d.scheduled_for).toDateString() === date.toDateString());

  if (loading) {
    return (
      <div className="h-96 flex items-center justify-center">
        <div className="animate-pulse text-lg text-gray-600">Loading schedule...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-gray-50">
      <CalendarHeader currentWeek={currentWeek} onWeekChange={setCurrentWeek} onRefresh={loadScheduled} />

      <div className="flex-1 grid grid-cols-7 gap-4 p-6">
        {getWeekDays().map((day) => (
          <CalendarDayColumn
            key={day.toISOString()}
            date={day}
            drafts={getDraftsForDay(day)}
            onEditTime={setRescheduling}
          />
        ))}
      </div>

      <RescheduleDialog
        draft={rescheduling}
        onClose={() => setRescheduling(null)}
        onRescheduled={() => { setRescheduling(null); loadScheduled(); }}
      />
    </div>
  );
};
