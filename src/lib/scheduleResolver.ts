// Schedule resolver: turns a content_schedules slot (a recurrence PATTERN) into a
// concrete publish instant (a UTC ISO timestamp), correctly across timezones and DST.
//
// This is the single source of truth for scheduling math. A byte-for-byte logic
// copy lives in supabase/functions/_shared/schedule-resolver.ts for the Deno edge
// functions (generation stamping + publish). Keep the two in sync.
//
// Dependency-free: uses only Intl + Date so it runs identically in the browser and
// in Deno. No date library.

export type Frequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "as_needed";

export interface SlotTiming {
  day_of_week: number; // 0 = Sunday .. 6 = Saturday
  frequency: Frequency;
  anchor: number | null; // nth weekday-occurrence for monthly/quarterly (1..4); null => 1st
  time_of_day: string; // "HH:MM" or "HH:MM:SS", wall-clock in `timezone`
  timezone: string; // IANA, e.g. "America/New_York"
}

export type ScheduleBasis = "on_time" | "rescheduled" | "as_needed";

export interface ResolveResult {
  scheduledFor: string | null; // ISO-8601 UTC instant; null only for as_needed
  timezone: string;
  basis: ScheduleBasis;
  localDisplay: string | null; // e.g. "Tue, Jul 7, 2026, 9:00 AM EDT"
}

function parseTimeOfDay(t: string): { hh: number; mm: number } {
  const [hh, mm] = (t || "09:00").split(":");
  return { hh: parseInt(hh, 10) || 0, mm: parseInt(mm, 10) || 0 };
}

// Offset (ms) of wall-clock time in `timeZone` relative to UTC, at the given instant.
function tzOffsetMs(timeZone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const m: Record<string, number> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== "literal") m[p.type] = parseInt(p.value, 10);
  }
  const asUTC = Date.UTC(m.year, m.month - 1, m.day, m.hour, m.minute, m.second);
  return asUTC - date.getTime();
}

// Wall-clock date/time in `timeZone` -> the corresponding UTC instant.
// Two iterations converge even when the wall time straddles a DST transition.
function zonedWallToUtc(
  y: number,
  moZeroBased: number,
  d: number,
  hh: number,
  mm: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(y, moZeroBased, d, hh, mm, 0);
  let utc = naive;
  for (let i = 0; i < 2; i++) {
    utc = naive - tzOffsetMs(timeZone, new Date(utc));
  }
  return new Date(utc);
}

// Local calendar parts (in timeZone) for an instant.
function localCalendar(date: Date, timeZone: string): { y: number; mo: number; d: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const m: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) m[p.type] = p.value;
  return { y: parseInt(m.year, 10), mo: parseInt(m.month, 10), d: parseInt(m.day, 10) };
}

function addCalendarDays(y: number, mo: number, d: number, n: number): { y: number; mo: number; d: number } {
  const dt = new Date(Date.UTC(y, mo - 1, d) + n * 86400000);
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function weekdayOf(y: number, mo: number, d: number): number {
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

function weekdayOccurrence(d: number): number {
  return Math.ceil(d / 7);
}

function isoWeek(y: number, mo: number, d: number): number {
  const date = new Date(Date.UTC(y, mo - 1, d));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  return 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86400000));
}

// Does a given local calendar date satisfy the slot's recurrence pattern?
// (Mirrors the day_of_week + frequency/anchor logic in fire-due-schedules,
// evaluated in the slot's own timezone rather than UTC.)
function matchesPattern(timing: SlotTiming, y: number, mo: number, d: number): boolean {
  if (weekdayOf(y, mo, d) !== timing.day_of_week) return false;
  switch (timing.frequency) {
    case "weekly":
      return true;
    case "biweekly":
      return isoWeek(y, mo, d) % 2 === 0;
    case "monthly":
      return weekdayOccurrence(d) === (timing.anchor ?? 1);
    case "quarterly":
      return [1, 4, 7, 10].includes(mo) && weekdayOccurrence(d) === (timing.anchor ?? 1);
    default:
      return false;
  }
}

function formatLocal(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

// Earliest slot instant at or after `from`. Null for as_needed (no cadence).
export function nextOccurrence(timing: SlotTiming, from: Date): Date | null {
  if (timing.frequency === "as_needed") return null;
  const { hh, mm } = parseTimeOfDay(timing.time_of_day);
  const start = localCalendar(from, timing.timezone);
  // 830 days covers the longest gap (quarterly with a specific week) plus a year of slack.
  for (let i = 0; i <= 830; i++) {
    const { y, mo, d } = addCalendarDays(start.y, start.mo, start.d, i);
    if (!matchesPattern(timing, y, mo, d)) continue;
    const instant = zonedWallToUtc(y, mo - 1, d, hh, mm, timing.timezone);
    if (instant.getTime() >= from.getTime()) return instant;
  }
  return null;
}

// Slot-only preview: the next time this slot would publish. Used by the Schedule UI.
export function resolveNext(timing: SlotTiming, from: Date = new Date()): ResolveResult {
  const occ = nextOccurrence(timing, from);
  return {
    scheduledFor: occ ? occ.toISOString() : null,
    timezone: timing.timezone,
    basis: timing.frequency === "as_needed" ? "as_needed" : "on_time",
    localDisplay: occ ? formatLocal(occ, timing.timezone) : null,
  };
}

// Approval-time resolution with late-approval handling.
//   intendedAt: the slot instant stamped on the draft at generation (ISO), or null
//               for ad-hoc drafts that have no slot.
//   approvedAt: when the human approved.
// Behavior:
//   - intended time still in the future  -> publish at the intended time (on_time)
//   - intended time already passed       -> next occurrence, flagged 'rescheduled'
//   - as_needed                          -> null (caller must flag, never auto-post)
// It never returns "now"/immediate.
export function resolveForApproval(
  timing: SlotTiming,
  intendedAt: string | null,
  approvedAt: Date = new Date(),
): ResolveResult {
  if (timing.frequency === "as_needed") {
    return { scheduledFor: null, timezone: timing.timezone, basis: "as_needed", localDisplay: null };
  }
  if (intendedAt && new Date(intendedAt).getTime() >= approvedAt.getTime()) {
    const d = new Date(intendedAt);
    return {
      scheduledFor: d.toISOString(),
      timezone: timing.timezone,
      basis: "on_time",
      localDisplay: formatLocal(d, timing.timezone),
    };
  }
  const occ = nextOccurrence(timing, approvedAt);
  return {
    scheduledFor: occ ? occ.toISOString() : null,
    timezone: timing.timezone,
    basis: intendedAt ? "rescheduled" : "on_time",
    localDisplay: occ ? formatLocal(occ, timing.timezone) : null,
  };
}
