// src/components/calendar/MonthGrid.tsx
//
// Month-view grid for the "Upcoming" schedule. Renders a full padded grid
// (leading/trailing days from adjacent months, dimmed) for the month
// containing `currentDate`, so week rows never shift height between months
// with 4 vs 5 vs 6 weeks. Drafts are fetched for the full padded range (not
// just the calendar month) so a post scheduled on a leading/trailing day
// still shows correctly.
//
// Same drafts source/filter as WeekGrid (drafts joined conceptually to
// content_schedules, requiring external_post_id so never-actually-scheduled
// drafts don't show as draggable). Precise time editing (RescheduleDialog)
// intentionally isn't wired to individual cells here — cells are too small
// for it — clicking "+N more" jumps back to week view via onJumpToWeek
// instead, where the full ScheduleEntryCard + "Edit time" flow lives.
import { useState, useEffect } from "react";
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, differenceInCalendarDays, setHours, setMinutes, setSeconds, setMilliseconds } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { describeInvokeError } from "@/lib/edgeFunctionError";
import { useDefaultTimezone } from "@/hooks/useDefaultTimezone";
import { MonthDayCell } from "./MonthDayCell";
import { ScheduledDraft } from "./schedule-types";
import { toast } from "sonner";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface MonthGridProps {
  currentDate: Date;
  cadenceDays: Set<number>;
  refreshToken: number;
  onDraftsChanged: () => void;
  onJumpToWeek: (date: Date) => void;
}

export const MonthGrid = ({ currentDate, cadenceDays, refreshToken, onDraftsChanged, onJumpToWeek }: MonthGridProps) => {
  const [drafts, setDrafts] = useState<ScheduledDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const defaultTimezone = useDefaultTimezone();

  const gridStart = startOfWeek(startOfMonth(currentDate), { weekStartsOn: 0 });
  const gridEnd = endOfWeek(endOfMonth(currentDate), { weekStartsOn: 0 });
  const dayCount = differenceInCalendarDays(gridEnd, gridStart) + 1;

  useEffect(() => {
    loadScheduled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridStart.getTime(), gridEnd.getTime(), refreshToken]);

  const loadScheduled = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();

    const { data, error } = await supabase.from("drafts")
      .select("id, title, body, content_type, publish_status, scheduled_for, external_post_id")
      .eq("user_id", session?.user?.id)
      .eq("publish_status", "scheduled")
      .not("external_post_id", "is", null)
      .gte("scheduled_for", gridStart.toISOString())
      .lt("scheduled_for", addDays(gridEnd, 1).toISOString())
      .order("scheduled_for");

    if (error) {
      console.error("Error loading month schedule:", error);
      toast.error("Failed to load schedule");
    } else {
      setDrafts((data || []) as unknown as ScheduledDraft[]);
    }
    setLoading(false);
  };

  const getDays = () => Array.from({ length: dayCount }, (_, i) => addDays(gridStart, i));

  const getDraftsForDay = (date: Date) =>
    drafts
      .filter((d) => new Date(d.scheduled_for).toDateString() === date.toDateString())
      .sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime());

  const handleDropDraft = async (draftId: string, targetDate: Date) => {
    const draft = drafts.find((d) => d.id === draftId);
    if (!draft) return;
    const original = new Date(draft.scheduled_for);
    if (original.toDateString() === targetDate.toDateString()) return;

    const newDate = setMilliseconds(setSeconds(setMinutes(setHours(targetDate, original.getHours()), original.getMinutes()), original.getSeconds()), 0);
    if (newDate.getTime() <= Date.now()) {
      toast.error("Can't move a post into the past");
      return;
    }

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
    <div className="p-6">
      <div className="grid grid-cols-7 border-t border-l rounded-t-lg overflow-hidden">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="bg-white border-b border-r px-2 py-1.5 text-xs font-semibold text-gray-500 text-center">
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 border-l rounded-b-lg overflow-hidden">
        {getDays().map((day) => (
          <MonthDayCell
            key={day.toISOString()}
            date={day}
            monthAnchor={currentDate}
            drafts={getDraftsForDay(day)}
            isCadenceDay={cadenceDays.has(day.getDay())}
            onDropDraft={handleDropDraft}
            onShowMore={onJumpToWeek}
          />
        ))}
      </div>
    </div>
  );
};
