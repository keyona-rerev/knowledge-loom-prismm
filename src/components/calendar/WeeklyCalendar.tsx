// src/components/calendar/WeeklyCalendar.tsx
//
// The "Upcoming" view: still-scheduled drafts (not yet posted — those live in
// the Posted tab) sourced from drafts joined to content_schedules, the real
// publish truth, not content_calendar. Days that have an active cadence slot
// are highlighted, matching the standing Mon/Wed/Fri-style pattern configured
// in the Cadence tab, so a post landing on its cadence day reads as expected.
//
// Dragging a card to a different day calls reschedule-draft for real (same
// function the "Edit time" dialog uses) — it keeps the draft's original
// time-of-day and only changes the date.
//
// The drafts query requires external_post_id to be set, not just
// publish_status = "scheduled". A draft can end up with publish_status
// "scheduled" in the DB without ever actually being scheduled with the
// provider (e.g. an interrupted write), and reschedule-draft immediately
// 409s on those with "Draft is not scheduled yet" — which looked, from drag
// and drop, exactly like reschedule silently being broken, when the real
// problem was this view showing a card that was never actually draggable in
// the first place. Those drafts still surface in Approved's "Needs
// attention" section; they just don't belong on a calendar of what's
// actually going out.
//
// The header shows two counts, not one raw "approved" count. A flat approved
// count is close to meaningless here: approval_status=approved covers drafts
// that already posted weeks ago, drafts permanently rejected by Zernio as
// duplicate content, and drafts stuck in needs_attention (e.g. over LinkedIn's
// character limit) that never got scheduled at all, none of which are
// "upcoming." scheduledCount is the real forward-looking number: approved,
// publish_status=scheduled, AND scheduled_for still in the future.
// needsAttentionCount surfaces the failed/needs_attention drafts directly
// here instead of only in Review's Approved tab, since those are exactly the
// approved-but-not-actually-going-out drafts that made the calendar look
// broken. Both counts are computed fresh on every load, not hardcoded.
//
// The drafts query intentionally does NOT embed content_schedules/formats.
// content_schedules has two separate foreign keys to formats (format_id and
// child_format_id, for the reuse/child-post feature), so an unqualified
// `format:formats(name)` embed is ambiguous and PostgREST rejects it outright
// rather than guessing — that's what previously surfaced as "Failed to load
// schedule" on every load. Nothing in this view renders that data anyway
// (ScheduleEntryCard only uses title/content_type/scheduled_for), so it's
// removed rather than disambiguated. If schedule frequency/format ever needs
// to be shown here, re-add it with an explicit FK hint, e.g.
// `format:formats!content_schedules_format_id_fkey(name)`.
import { useState, useEffect } from "react";
import { startOfWeek, addDays, setHours, setMinutes, setSeconds, setMilliseconds } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { describeInvokeError } from "@/lib/edgeFunctionError";
import { CalendarHeader } from "./CalendarHeader";
import { CalendarDayColumn } from "./CalendarDayColumn";
import { RescheduleDialog } from "./RescheduleDialog";
import { ScheduledDraft } from "./schedule-types";
import { toast } from "sonner";

export const WeeklyCalendar = () => {
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [drafts, setDrafts] = useState<ScheduledDraft[]>([]);
  const [cadenceDays, setCadenceDays] = useState<Set<number>>(new Set());
  const [scheduledCount, setScheduledCount] = useState<number | undefined>(undefined);
  const [needsAttentionCount, setNeedsAttentionCount] = useState<number | undefined>(undefined);
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
    const nowIso = new Date().toISOString();

    const [{ data, error }, { data: cadence }, { count: scheduled }, { count: needsAttention }] = await Promise.all([
      supabase.from("drafts")
        .select("id, title, body, content_type, publish_status, scheduled_for, external_post_id")
        .eq("user_id", session?.user?.id)
        .eq("publish_status", "scheduled")
        .not("external_post_id", "is", null)
        .gte("scheduled_for", weekStart.toISOString())
        .lt("scheduled_for", weekEnd.toISOString())
        .order("scheduled_for"),
      supabase.from("content_schedules")
        .select("day_of_week")
        .eq("user_id", session?.user?.id)
        .eq("is_active", true),
      supabase.from("drafts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", session?.user?.id)
        .eq("approval_status", "approved")
        .eq("publish_status", "scheduled")
        .gt("scheduled_for", nowIso),
      supabase.from("drafts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", session?.user?.id)
        .eq("approval_status", "approved")
        .in("publish_status", ["needs_attention", "failed"]),
    ]);

    if (error) {
      console.error("Error loading schedule:", error);
      toast.error("Failed to load schedule");
    } else {
      setDrafts((data || []) as unknown as ScheduledDraft[]);
    }
    setCadenceDays(new Set((cadence || []).map((c) => c.day_of_week)));
    setScheduledCount(scheduled ?? undefined);
    setNeedsAttentionCount(needsAttention ?? undefined);
    setLoading(false);
  };

  const getWeekDays = () => {
    const start = startOfWeek(currentWeek, { weekStartsOn: 0 });
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
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
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
    <div className="flex flex-col bg-gray-50">
      <CalendarHeader
        currentWeek={currentWeek}
        onWeekChange={setCurrentWeek}
        onRefresh={loadScheduled}
        scheduledCount={scheduledCount}
        needsAttentionCount={needsAttentionCount}
      />

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
        onRescheduled={() => { setRescheduling(null); loadScheduled(); }}
      />
    </div>
  );
};
