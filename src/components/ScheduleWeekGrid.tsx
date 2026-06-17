import { Badge } from "@/components/ui/badge";

// Day order: Monday-first display, matching Schedule.tsx DAYS_ORDER
const DAYS_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const FREQ_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  weekly:     { bg: "bg-purple-50 dark:bg-purple-950/20",  text: "text-purple-800 dark:text-purple-200", label: "Weekly" },
  biweekly:   { bg: "bg-teal-50 dark:bg-teal-950/20",     text: "text-teal-800 dark:text-teal-200",     label: "Bi-weekly" },
  monthly:    { bg: "bg-amber-50 dark:bg-amber-950/20",   text: "text-amber-800 dark:text-amber-200",   label: "Monthly" },
  quarterly:  { bg: "bg-muted",                            text: "text-muted-foreground",                label: "Quarterly" },
  as_needed:  { bg: "bg-muted",                            text: "text-muted-foreground",                label: "As needed" },
};

interface NamedRow { id: string; name: string; }

interface SlotMin {
  id: string;
  format_id: string;
  nature_id: string;
  job_id: string;
  day_of_week: number;
  frequency: string;
  time_of_day: string;
  is_active: boolean;
}

interface ScheduleWeekGridProps {
  slots: SlotMin[];
  formats: NamedRow[];
  natures: NamedRow[];
  jobs: NamedRow[];
}

export const ScheduleWeekGrid = ({ slots, formats, natures, jobs }: ScheduleWeekGridProps) => {
  const activeSlots = slots.filter(s => s.is_active);
  const todayDow = new Date().getDay();

  // Summary stats
  const weeklyCount = activeSlots.filter(s => s.frequency === "weekly" || s.frequency === "as_needed").length;
  const activeDays = [...new Set(activeSlots.map(s => s.day_of_week))];
  const times = activeSlots.map(s => s.time_of_day).sort();
  const timeRange = times.length > 1
    ? `${fmt12(times[0])} – ${fmt12(times[times.length - 1])}`
    : times.length === 1 ? fmt12(times[0]) : "—";

  if (activeSlots.length === 0) return null;

  return (
    <div className="mb-8">
      {/* Summary stats */}
      <div className="flex flex-wrap gap-3 mb-4">
        {[
          { value: String(activeSlots.length), label: "active slots" },
          { value: String(weeklyCount), label: "posts/week" },
          { value: activeDays.map(d => DAY_LABELS[d]).join(", ") || "—", label: "publish days" },
          { value: timeRange, label: "time window" },
        ].map(({ value, label }) => (
          <div key={label} className="bg-muted rounded-lg px-4 py-2 min-w-0">
            <div className="text-lg font-medium text-foreground leading-tight truncate">{value}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>

      {/* Week grid */}
      <div className="border rounded-lg overflow-hidden bg-background">
        {/* Header row */}
        <div className="grid border-b" style={{ gridTemplateColumns: "48px repeat(7, minmax(0, 1fr))" }}>
          <div className="border-r" />
          {DAYS_ORDER.map(dow => {
            const isToday = dow === todayDow;
            return (
              <div
                key={dow}
                className={`py-2 text-center text-xs font-medium border-r last:border-r-0 ${isToday ? "bg-purple-50 text-purple-700 dark:bg-purple-950/30 dark:text-purple-300" : "text-muted-foreground"}`}
              >
                {DAY_LABELS[dow]}
                {isToday && <div className="text-[10px] font-normal opacity-75">today</div>}
              </div>
            );
          })}
        </div>

        {/* Slots row */}
        <div className="grid" style={{ gridTemplateColumns: "48px repeat(7, minmax(0, 1fr))" }}>
          <div className="border-r flex items-start justify-end pr-2 pt-2">
            <span className="text-[10px] text-muted-foreground">slots</span>
          </div>
          {DAYS_ORDER.map(dow => {
            const daySlots = activeSlots.filter(s => s.day_of_week === dow);
            const isToday = dow === todayDow;
            return (
              <div
                key={dow}
                className={`p-1.5 border-r last:border-r-0 flex flex-col gap-1.5 min-h-[56px] ${isToday ? "bg-purple-50/30 dark:bg-purple-950/10" : ""}`}
              >
                {daySlots.map(slot => {
                  const style = FREQ_STYLES[slot.frequency] ?? FREQ_STYLES.as_needed;
                  const formatName = formats.find(f => f.id === slot.format_id)?.name ?? "";
                  const natureName = natures.find(n => n.id === slot.nature_id)?.name ?? "";
                  const jobName = jobs.find(j => j.id === slot.job_id)?.name ?? "";
                  return (
                    <div
                      key={slot.id}
                      title={`${formatName} · ${natureName} · ${jobName} · ${fmt12(slot.time_of_day)}`}
                      className={`rounded px-1.5 py-1 text-[11px] font-medium leading-tight cursor-default ${style.bg} ${style.text}`}
                    >
                      <div className="truncate">{natureName}</div>
                      <div className="truncate font-normal opacity-75">{fmt12(slot.time_of_day)}</div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 px-3 py-2 border-t bg-muted/30">
          {Object.entries(FREQ_STYLES).filter(([k]) => k !== "as_needed").map(([key, style]) => (
            <div key={key} className="flex items-center gap-1.5">
              <div className={`w-2.5 h-2.5 rounded-sm ${style.bg} border border-current opacity-60`} />
              <span className="text-[11px] text-muted-foreground">{style.label}</span>
            </div>
          ))}
          <span className="text-[11px] text-muted-foreground ml-auto">hover a chip for full detail</span>
        </div>
      </div>
    </div>
  );
};

function fmt12(time: string): string {
  if (!time) return "";
  const [hStr, mStr] = time.split(":");
  const h = parseInt(hStr, 10);
  const m = mStr ?? "00";
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${ampm}`;
}

export default ScheduleWeekGrid;
