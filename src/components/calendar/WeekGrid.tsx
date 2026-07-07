// src/components/calendar/WeekGrid.tsx
//
// Week-view grid for the "Upcoming" schedule. Renders 7 day columns for the
// week containing `currentDate`. cadenceDays is passed down from
// ScheduleCalendar since it isn't week-scoped (same active cadence slots
// regardless of which week you're looking at) — only the drafts-in-range
// query below is specific to this view.
//
// Same drafts source/filter logic as the original WeeklyCalendar: sourced
// from drafts joined conceptually to content_schedules (the real publish
// truth, not content_calendar), requiring external_post_id to be set so a
// draft that never actually got scheduled with the provider doesn't show up
// as draggable here (those still surface via needsAttentionCount in the
// header, sourced in ScheduleCalendar).
import { useState, useEffect } from "react";
import { startOfWeek, addDays, setHours, setMinutes, setSeconds, setMilliseconds } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { describeInvokeError } from "@/lib/edgeFunctionError";
import { useDefaultTimezone } from "@/hooks/useDefaultTimezone";
import { CalendarDayColumn } from "./CalendarDayColumn";
import { RescheduleDialog } from "./RescheduleDialog";
import { ScheduledDraft } from "./schedule-types";
import { toast } from "sonner";

interface WeekGridProps {
  currentDate: Date;
  cadenceDays: Set<number>;
  refreshToken: number;
  onDraftsChanged: () => void; // tell parent to refresh the shared header counts
}

export const WeekGrid = ({ currentDate, cadenceDays, refreshToken, onDraftsChanged }: WeekGridProps) => {
  const [drafts, setDrafts] = useState<ScheduledDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [rescheduling, setRescheduling] = useState<ScheduledDraft | null>(null);
  const defaultTimezone = useDefaultTimezone();

  useEffect(() => {
    loadScheduled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDate, refreshToken]);

  const loadScheduled = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();

    const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 });
    const weekEnd = addDays(weekStart, 7);

    const { data, error } = await supabase.from("drafts")
      .select("id, title, body, content_type, publish_status, scheduled_for, external_post_id")
      .eq("user_id", session?.user?.id)
      .eq("publish_status", "scheduled")
      .not("external_post_id", "is", null)
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
    const start = startOfWeek(currentDate, { weekStartsOn: 0 });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  };

  const getDraftsForDay = (date: Date) =>
    drafts.filter((d) => new Date(d.scheduled_for).toDateString() === date.toDateString());

  const handleDropDraft = async (draftId: string, targetDate: Date) => {
    const draft = drafts.find((d) => d.id === draftId);
    if (!draft) return;
    const original = new Date(draft.scheduled_for);
    if (original.toDateString() === targetDate.toDateString()) return; // dropped on its own day

    // Keep the original time-of-day, just move the date.
    const newDate = setMilliseconds(setSeconds(setMinutes(setHours(targetDate, original.getHours()), original.getMinutes()), original.getSeconds()), 0);
    if (newDate.getTime() <= Date.now()) {
      toast.error("Can't move a post into the past");
      return;
    }

    // Optimistic update so the card doesn't snap back while the request is in flight.
    setDrafts((prev) => prev.map((d) => (d.id === draftId ? { ...d, scheduled_for: newDate.toISOString() } : d)));

    try {
      const timezone = defaultTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const { data, error } = await supabase.functions.invoke("reschedule-draft", {
        body: { draftId, newScheduledFor: newDate.toISOString(), timezone },
      });
      if (error) {
        toast.error("Reschedule failed: " + (await describeInvokeError(error)));
      } else if (data?.ok) {
        toast.success("Rescheduled");
      } else {
        toast.error(data?.error || "Reschedule failed");
      }
    } catch (err) {
      toast.error("Reschedule failed: " + (err as Error)?.message);
    } finally {
      loadScheduled();
      onDraftsChanged();
    }
  };

  if (loading) {
    return (
      <div className="h-96 flex items-center justify-center">
        <div className="animate-pulse text-lg text-gray-600">Loading schedule...</div>
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 grid grid-cols-7 gap-4 p-6">
        {getWeekDays().map((day) => (
          <CalendarDayColumn
            key={day.toISOString()}
            date={day}
            drafts={getDraftsForDay(day)}
            isCadenceDay={cadenceDays.has(day.getDay())}
            onEditTime={setRescheduling}
            onDropDraft={handleDropDraft}
          />
        ))}
      </div>

      <RescheduleDialog
        draft={rescheduling}
        onClose={() => setRescheduling(null)}
        onRescheduled={() => { setRescheduling(null); loadScheduled(); onDraftsChanged(); }}
      />
    </>
  );
};
