// The real schedule, sourced from drafts (the publish truth) joined to
// content_schedules for slot context. Replaces the old content_calendar-backed
// CalendarSlot shape, which tracked a manual placement nothing downstream read.
export interface ScheduledDraft {
  id: string;
  title: string | null;
  body: string | null;
  content_type: string | null;
  publish_status: string | null;
  scheduled_for: string;
  external_post_id: string | null;
  schedule?: {
    frequency: string | null;
    format?: { name: string | null } | null;
  } | null;
}
