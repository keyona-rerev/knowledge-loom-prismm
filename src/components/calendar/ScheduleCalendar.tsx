// src/components/calendar/ScheduleCalendar.tsx
//
// Top-level "Upcoming" schedule view (replaces the old standalone
// WeeklyCalendar). Owns the state both grids need: the current anchor date,
// which grid is showing, and the three counts/flags that aren't
// range-scoped — scheduledCount, needsAttentionCount, cadenceDays — fetched
// once here instead of on every week/month navigation, so switching Week
// <-> Month is instant and both grids always agree with the header.
//
// refreshToken is a manual bump (via the header's Refresh button or after a
// reschedule) that both WeekGrid and MonthGrid include in their effect
// deps, since currentDate alone won't change when you just want to force a
// reload of the same range.
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CalendarHeader, ScheduleViewMode } from "./CalendarHeader";
import { WeekGrid } from "./WeekGrid";
import { MonthGrid } from "./MonthGrid";

export const ScheduleCalendar = () => {
  const [viewMode, setViewMode] = useState<ScheduleViewMode>("week");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [cadenceDays, setCadenceDays] = useState<Set<number>>(new Set());
  const [scheduledCount, setScheduledCount] = useState<number | undefined>(undefined);
  const [needsAttentionCount, setNeedsAttentionCount] = useState<number | undefined>(undefined);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    loadCounts();
  }, []);

  const loadCounts = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const nowIso = new Date().toISOString();

    const [{ data: cadence }, { count: scheduled }, { count: needsAttention }] = await Promise.all([
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

    setCadenceDays(new Set((cadence || []).map((c) => c.day_of_week)));
    setScheduledCount(scheduled ?? undefined);
    setNeedsAttentionCount(needsAttention ?? undefined);
  };

  const handleRefresh = () => {
    loadCounts();
    setRefreshToken((t) => t + 1);
  };

  const handleJumpToWeek = (date: Date) => {
    setCurrentDate(date);
    setViewMode("week");
  };

  return (
    <div className="flex flex-col bg-gray-50">
      <CalendarHeader
        currentDate={currentDate}
        viewMode={viewMode}
        onDateChange={setCurrentDate}
        onViewModeChange={setViewMode}
        onRefresh={handleRefresh}
        scheduledCount={scheduledCount}
        needsAttentionCount={needsAttentionCount}
      />

      {viewMode === "week" ? (
        <WeekGrid
          currentDate={currentDate}
          cadenceDays={cadenceDays}
          refreshToken={refreshToken}
          onDraftsChanged={loadCounts}
        />
      ) : (
        <MonthGrid
          currentDate={currentDate}
          cadenceDays={cadenceDays}
          refreshToken={refreshToken}
          onDraftsChanged={loadCounts}
          onJumpToWeek={handleJumpToWeek}
        />
      )}
    </div>
  );
};
