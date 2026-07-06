// src/components/calendar/WeeklyCalendar.tsx
//
// Deprecated standalone name. The "Upcoming" tab now renders
// <ScheduleCalendar /> directly (see ScheduleCalendar.tsx), which handles
// both week and month views via WeekGrid.tsx and MonthGrid.tsx. This file
// is kept only as a compatibility re-export so any stray import of
// `WeeklyCalendar` still resolves to the same (now week+month-aware)
// calendar instead of breaking the build.
export { ScheduleCalendar as WeeklyCalendar } from "./ScheduleCalendar";
