import { useEffect, useState, useRef, type Dispatch, type SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, Play, RefreshCw, Calendar, RotateCcw, CalendarClock, Pencil, Save as SaveIcon, FastForward, ChevronRight } from "lucide-react";
import { resolveNext, nextOccurrence } from "@/lib/scheduleResolver";
import { ScheduleWeekGrid } from "@/components/ScheduleWeekGrid";

const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAYS_ORDER = [1, 2, 3, 4, 5, 6, 0];
const FREQUENCIES = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Bi-weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "as_needed", label: "As needed" },
];
const ANCHOR_OPTIONS = [
  { value: "1", label: "1st" },
  { value: "2", label: "2nd" },
  { value: "3", label: "3rd" },
  { value: "4", label: "4th" },
];
const TIMEZONES = [
  { value: "America/New_York", label: "Eastern (New York)" },
  { value: "America/Chicago", label: "Central (Chicago)" },
  { value: "America/Denver", label: "Mountain (Denver)" },
  { value: "America/Phoenix", label: "Mountain, no DST (Phoenix)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { value: "America/Anchorage", label: "Alaska (Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii (Honolulu)" },
  { value: "UTC", label: "UTC" },
];
const NONE = "__none__";
const ANY = "__any__";
const TZ_ABBR: Record<string, string> = {
  "America/New_York": "ET",
  "America/Chicago": "CT",
  "America/Denver": "MT",
  "America/Phoenix": "MT",
  "America/Los_Angeles": "PT",
  "America/Anchorage": "AKT",
  "Pacific/Honolulu": "HST",
  "UTC": "UTC",
};

// If a saved fastforward_runs row still says "running" but hasn't been
// touched in this long, treat it as abandoned (tab closed or reloaded
// mid-run) rather than showing a live progress bar forever.
const FF_STALE_MS = 3 * 60 * 1000;

function fmtTime12(time: string): string {
  if (!time) return "";
  const [hStr, mStr] = time.split(":");
  const h = parseInt(hStr, 10);
  const m = mStr ?? "00";
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${ampm}`;
}

// Per-slot expand/collapse. Collapsed slots show a one-line summary;
// expanded slots show the full form. Purely a UI state - the page-level
// "Save now" button still does the real persist.
const expandRow = (setExpanded: Dispatch<SetStateAction<Set<string>>>, id: string) =>
  setExpanded((prev) => new Set(prev).add(id));
const collapseRow = (setExpanded: Dispatch<SetStateAction<Set<string>>>, id: string) =>
  setExpanded((prev) => { const next = new Set(prev); next.delete(id); return next; });

interface Slot {
  id: string;
  format_id: string;
  nature_id: string;
  job_id: string;
  lane_id: string | null;
  reader_id: string | null;
  day_of_week: number;
  frequency: string;
  anchor: number | null;
  time_of_day: string;
  timezone: string;
  is_active: boolean;
  requires_child: boolean;
  child_format_id: string | null;
  child_nature_id: string | null;
  max_reuse_count: number;
  reuse_window_days: number;
  _isNew?: boolean;
}

interface NamedRow { id: string; name: string; }

interface EligibleParent {
  id: string;
  title: string;
  content_type: string | null;
  published_at: string;
  reuse_count: number;
  max_reuse_count: number | null;
  reuse_window_days: number | null;
}

// One future occurrence of one slot, produced by walking the slot's own
// cadence forward from now. This is the unit the fast-forward queue is built
// from: each item becomes exactly one execute-autopilot-template call,
// stamped with that specific date instead of always "the next one."
interface QueueItem {
  slot: Slot;
  date: Date;
}

// Walks every active, non-"as needed" slot's own cadence forward from now
// and collects every future occurrence within `daysAhead`, capped per slot
// at `perSlotCap` so one slot with a dense pattern can't crowd out the
// others. Sorted chronologically across all slots combined, so approving
// in order later lines up with the order the posts will actually go out.
function buildUpcomingQueue(activeSlots: Slot[], daysAhead = 90, perSlotCap = 12): QueueItem[] {
  const items: QueueItem[] = [];
  const horizon = new Date(Date.now() + daysAhead * 86400000);
  for (const slot of activeSlots) {
    if (slot.frequency === "as_needed") continue;
    let from = new Date();
    for (let i = 0; i < perSlotCap; i++) {
      const occ = nextOccurrence(
        {
          day_of_week: slot.day_of_week,
          frequency: slot.frequency as never,
          anchor: slot.anchor,
          time_of_day: slot.time_of_day,
          timezone: slot.timezone,
        },
        from,
      );
      if (!occ || occ.getTime() > horizon.getTime()) break;
      items.push({ slot, date: occ });
      from = new Date(occ.getTime() + 1000);
    }
  }
  items.sort((a, b) => a.date.getTime() - b.date.getTime());
  return items;
}

export const CadenceTab = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [slots, setSlots] = useState<Slot[]>([]);
  const [expandedSlots, setExpandedSlots] = useState<Set<string>>(new Set());
  const [deletedSlots, setDeletedSlots] = useState<string[]>([]);
  const [formats, setFormats] = useState<NamedRow[]>([]);
  const [natures, setNatures] = useState<NamedRow[]>([]);
  const [jobs, setJobs] = useState<NamedRow[]>([]);
  const [lanes, setLanes] = useState<NamedRow[]>([]);
  const [readers, setReaders] = useState<NamedRow[]>([]);

  const [eligibleParents, setEligibleParents] = useState<EligibleParent[]>([]);

  // Fast-forward: run a batch of upcoming cadence slot-occurrences right
  // now, instead of waiting on the daily cron or clicking "Run" on one slot
  // at a time. The number entered is how many scheduled occurrences to work
  // through (not a total draft count — a slot with a required child produces
  // two drafts per occurrence, so the actual draft count can run higher).
  // Each occurrence is stamped with a real, distinct upcoming date (see
  // buildUpcomingQueue), so approving them later schedules each one on its
  // own day rather than piling every draft onto the same next occurrence.
  const [batchTarget, setBatchTarget] = useState<number>(12);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number; label: string } | null>(null);

  // Last-run summary line, persisted so it survives navigating away and
  // back — both while a run is still in progress (so it doesn't look like
  // nothing is happening) and after it finishes (so "did that work" always
  // has a visible, timestamped answer instead of only a toast you might
  // have missed).
  const [lastRun, setLastRun] = useState<{
    completedAt: string | null; created: number; attempted: number; failed: number;
  } | null>(null);
  const startedHereRef = useRef(false);

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If batchRunning is true but this exact mount didn't start the loop
  // (resumed from a saved row after navigating back), poll for progress
  // instead of sitting on stale numbers until a manual refresh.
  useEffect(() => {
    if (!batchRunning || startedHereRef.current || !userId) return;
    const interval = setInterval(async () => {
      const { data: row } = await supabase
        .from("fastforward_runs" as any)
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (!row) { setBatchRunning(false); return; }
      const r = row as any;
      if (r.running) {
        setBatchProgress({ done: r.done ?? 0, total: r.total ?? 0, label: r.current_label ?? "" });
      } else {
        setBatchRunning(false);
        setBatchProgress(null);
        setLastRun({
          completedAt: r.completed_at,
          created: r.last_created ?? 0,
          attempted: r.last_attempted ?? 0,
          failed: r.last_failed ?? 0,
        });
        loadAll();
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [batchRunning, userId]);

  const persistFF = async (uid: string, patch: Record<string, unknown>) => {
    await supabase.from("fastforward_runs" as any).upsert(
      { user_id: uid, ...patch },
      { onConflict: "user_id" }
    );
  };

  const loadAll = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { navigate("/auth"); return; }
    const uid = session.user.id;
    setUserId(uid);

    const [fmt, nat, jb, ln, rd, sched, ffRow] = await Promise.all([
      supabase.from("formats").select("id, name").eq("user_id", uid).eq("is_active", true).order("sort_order"),
      supabase.from("natures").select("id, name").eq("user_id", uid).eq("is_active", true).order("sort_order"),
      supabase.from("jobs").select("id, name").eq("user_id", uid).eq("kind", "engine_job").eq("is_active", true).order("sort_order"),
      supabase.from("lanes").select("id, name").eq("user_id", uid).eq("is_active", true).order("sort_order"),
      supabase.from("readers").select("id, role").eq("user_id", uid).eq("is_active", true).order("sort_order"),
      supabase.from("content_schedules").select("*").eq("user_id", uid).order("day_of_week"),
      supabase.from("fastforward_runs" as any).select("*").eq("user_id", uid).maybeSingle(),
    ]);

    setFormats((fmt.data || []) as NamedRow[]);
    setNatures((nat.data || []) as NamedRow[]);
    setJobs((jb.data || []) as NamedRow[]);
    setLanes((ln.data || []) as NamedRow[]);
    setReaders((rd.data || []).map((r) => ({ id: r.id, name: r.role })));
    setSlots((sched.data || []).map((s) => ({
      id: s.id, format_id: s.format_id, nature_id: s.nature_id, job_id: s.job_id,
      lane_id: s.lane_id, reader_id: s.reader_id, day_of_week: s.day_of_week,
      frequency: s.frequency, anchor: s.anchor,
      time_of_day: (s.time_of_day || "09:00:00").slice(0, 5),
      timezone: s.timezone || "America/New_York",
      is_active: s.is_active,
      requires_child: s.requires_child, child_format_id: s.child_format_id,
      child_nature_id: s.child_nature_id, max_reuse_count: s.max_reuse_count,
      reuse_window_days: s.reuse_window_days,
    })));

    const ff = ffRow.data as any;
    if (ff) {
      const updatedAt = new Date(ff.updated_at as string).getTime();
      const stale = ff.running && Date.now() - updatedAt > FF_STALE_MS;
      if (ff.running && !stale) {
        setBatchRunning(true);
        setBatchProgress({ done: ff.done ?? 0, total: ff.total ?? 0, label: ff.current_label ?? "" });
        if (ff.target_count) setBatchTarget(ff.target_count);
      } else {
        if (ff.running && stale) {
          await persistFF(uid, { running: false });
          toast.info("A previous fast-forward looks like it was interrupted.");
        }
        if (ff.completed_at) {
          setLastRun({
            completedAt: ff.completed_at,
            created: ff.last_created ?? 0,
            attempted: ff.last_attempted ?? 0,
            failed: ff.last_failed ?? 0,
          });
        }
      }
    }

    const { data: parents } = await supabase
      .from("drafts")
      .select("id, title, content_type, published_at, reuse_count, max_reuse_count, reuse_window_days")
      .eq("user_id", uid)
      .eq("approval_status", "approved")
      .is("parent_draft_id", null)
      .not("published_at", "is", null)
      .gt("max_reuse_count", 0)
      .order("published_at", { ascending: true });
    const eligible = (parents || []).filter((p) => {
      const max = p.max_reuse_count ?? 0;
      if (p.reuse_count >= max) return false;
      const windowDays = p.reuse_window_days ?? 90;
      const windowEnd = new Date(new Date(p.published_at as string).getTime() + windowDays * 86400000);
      return new Date() <= windowEnd;
    });
    setEligibleParents(eligible as EligibleParent[]);

    setIsDirty(false);
    setLoading(false);
  };

  const updateSlot = (id: string, patch: Partial<Slot>) => {
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    setIsDirty(true);
  };

  const addSlot = () => {
    if (!formats.length || !natures.length || !jobs.length) {
      toast.error("Add at least one format, nature, and engine job in Strategy first");
      return;
    }
    const id = `new_${Date.now()}_${slots.length}`;
    setSlots((prev) => [...prev, {
      id,
      format_id: formats[0].id, nature_id: natures[0].id, job_id: jobs[0].id,
      lane_id: null, reader_id: null, day_of_week: 1, frequency: "weekly", anchor: null,
      time_of_day: "09:00", timezone: "America/New_York",
      is_active: true, requires_child: false, child_format_id: null, child_nature_id: null,
      max_reuse_count: 0, reuse_window_days: 90, _isNew: true,
    }]);
    expandRow(setExpandedSlots, id);
    setIsDirty(true);
  };

  const deleteSlot = (slot: Slot) => {
    if (!slot._isNew) setDeletedSlots((d) => [...d, slot.id]);
    setSlots((prev) => prev.filter((s) => s.id !== slot.id));
    setIsDirty(true);
  };

  const saveSchedule = async () => {
    if (!userId) return;
    const incomplete = slots.find((s) => !s.format_id || !s.nature_id || !s.job_id);
    if (incomplete) { toast.error("Every slot needs a format, nature, and job"); return; }

    setSaving(true);
    try {
      if (deletedSlots.length) await supabase.from("content_schedules").delete().in("id", deletedSlots);
      for (const s of slots) {
        const isWeekly = s.frequency === "weekly" || s.frequency === "as_needed";
        const payload = {
          format_id: s.format_id, nature_id: s.nature_id, job_id: s.job_id,
          lane_id: s.lane_id, reader_id: s.reader_id, day_of_week: s.day_of_week,
          frequency: s.frequency, anchor: isWeekly ? null : s.anchor,
          time_of_day: s.time_of_day, timezone: s.timezone,
          is_active: s.is_active, requires_child: s.requires_child,
          child_format_id: s.requires_child ? s.child_format_id : null,
          child_nature_id: s.requires_child ? s.child_nature_id : null,
          max_reuse_count: s.max_reuse_count, reuse_window_days: s.reuse_window_days,
        };
        if (s._isNew) {
          const { error } = await supabase.from("content_schedules").insert([{ ...payload, user_id: userId }]);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("content_schedules").update(payload).eq("id", s.id);
          if (error) throw error;
        }
      }
      setDeletedSlots([]);
      setIsDirty(false);
      toast.success("Cadence saved");
      await loadAll();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Failed to save: " + msg);
    } finally {
      setSaving(false);
    }
  };

  const runSlot = async (slot: Slot) => {
    setRunning(slot.id);
    try {
      const { data, error } = await supabase.functions.invoke("execute-autopilot-template", {
        body: { scheduleId: slot.id, isTestRun: false },
      });
      if (error) { toast.error("Run failed: " + error.message); }
      else { toast.success(`Generated ${data?.draftsCreated ?? 0} draft(s)`); await loadAll(); }
    } catch {
      toast.error("Run failed");
    }
    setRunning(null);
  };

  const nameOf = (rows: NamedRow[], id: string | null) => rows.find((r) => r.id === id)?.name;

  // Fills the whole target count at once, using every active weekly/recurring
  // slot's own cadence walked forward. Runs are sequential (not parallel) on
  // purpose: each one is a real AI call, and a live progress line here is
  // more honest than a spinner with no feedback for a couple of minutes.
  // A single failed run is logged and skipped rather than aborting the rest
  // of the batch.
  const runFastForward = async () => {
    if (!userId) return;
    if (isDirty) {
      toast.error("You have unsaved cadence changes — save them first so fast-forward uses the current setup");
      return;
    }
    const activeSlots = slots.filter((s) => s.is_active && !s._isNew && s.frequency !== "as_needed");
    if (!activeSlots.length) {
      toast.error("No active weekly/recurring slots to fast-forward. Add or activate one below first.");
      return;
    }
    const queue = buildUpcomingQueue(activeSlots);
    if (!queue.length) {
      toast.error("Couldn't find upcoming occurrences for your active slots.");
      return;
    }

    startedHereRef.current = true;
    setBatchRunning(true);
    setLastRun(null);
    let created = 0;
    let attempted = 0;
    let failed = 0;
    await persistFF(userId, {
      running: true, target_count: batchTarget, done: 0, total: batchTarget,
      current_label: "", started_at: new Date().toISOString(),
    });

    try {
      for (const item of queue) {
        if (attempted >= batchTarget) break;
        attempted++;
        const label = `${nameOf(natures, item.slot.nature_id) ?? "…"} ${nameOf(formats, item.slot.format_id) ?? "…"} — ${item.date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`;
        setBatchProgress({ done: created, total: batchTarget, label });
        await persistFF(userId, { done: created, total: batchTarget, current_label: label });

        const { data, error } = await supabase.functions.invoke("execute-autopilot-template", {
          body: { scheduleId: item.slot.id, isTestRun: false, scheduledForOverride: item.date.toISOString() },
        });

        if (error) {
          console.error("Fast-forward run failed for slot", item.slot.id, error);
          failed++;
          continue;
        }
        created += data?.draftsCreated ?? 0;
      }
    } finally {
      setBatchRunning(false);
      setBatchProgress(null);
      startedHereRef.current = false;
      const completedAt = new Date().toISOString();
      await persistFF(userId, {
        running: false, done: created, total: batchTarget, completed_at: completedAt,
        last_created: created, last_attempted: attempted, last_failed: failed,
      });
      setLastRun({ completedAt, created, attempted, failed });
    }

    if (created === 0) {
      toast.error("No drafts were generated — check the AI provider key in Settings and try again.");
    } else {
      toast.success(`Generated ${created} draft${created === 1 ? "" : "s"} across ${attempted} run${attempted === 1 ? "" : "s"}${failed ? `, ${failed} run${failed === 1 ? "" : "s"} failed` : ""}`, {
        description: "Review them in Review > Pending, then approve — each one keeps the future date it was generated for.",
      });
    }
    await loadAll();
  };

  const slotsByDay = DAYS_ORDER.map((day) => ({
    day,
    daySlots: slots.filter((s) => s.day_of_week === day),
  }));

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <p className="text-muted-foreground">Standing slots the engine fills. Each slot picks a format, nature, and job; lane and reader are optional.</p>
        <div className="flex gap-2 items-center shrink-0 ml-4">
          <Button variant="outline" onClick={loadAll}><RefreshCw className="h-4 w-4 mr-2" />Refresh</Button>
          <Button
            onClick={saveSchedule}
            disabled={saving}
            variant={isDirty ? "default" : "outline"}
            className={isDirty ? "border-2 border-orange-400 bg-orange-500 hover:bg-orange-600 text-white" : ""}
          >
            {saving ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</>
            ) : isDirty ? (
              "Unsaved changes — Save now"
            ) : (
              "Cadence saved"
            )}
          </Button>
        </div>
      </div>

      <Card className="mb-6 border-primary/40 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FastForward className="h-4 w-4" />Fast-forward: generate upcoming posts now
          </CardTitle>
          <CardDescription>
            Runs your active cadence slots ahead of schedule, right now, instead of waiting on the daily run. Each occurrence is stamped with a real future date from that slot's own cadence, so approving them later schedules each one on its own day.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 flex-wrap">
            <Label htmlFor="batch-target" className="text-sm font-medium whitespace-nowrap">Go through the next</Label>
            <Input
              id="batch-target"
              type="number"
              min={1}
              max={40}
              value={batchTarget}
              onChange={(e) => setBatchTarget(Math.max(1, Math.min(40, parseInt(e.target.value) || 1)))}
              className="w-20"
              disabled={batchRunning}
            />
            <span className="text-sm text-muted-foreground">scheduled slot-occurrences, across all active slots, in cadence order</span>
            <Button onClick={runFastForward} disabled={batchRunning} className="ml-auto">
              {batchRunning ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating...</>
              ) : (
                <><FastForward className="h-4 w-4 mr-2" />Generate now</>
              )}
            </Button>
          </div>
          {batchProgress && (
            <p className="text-xs text-muted-foreground mt-3">
              {batchProgress.done} of {batchProgress.total} so far — working on: {batchProgress.label}
            </p>
          )}
          {!batchRunning && lastRun && (
            <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
              <span>
                Last fast-forward: {lastRun.completedAt ? new Date(lastRun.completedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "unknown time"}
                {" — "}generated {lastRun.created} draft{lastRun.created === 1 ? "" : "s"} across {lastRun.attempted} run{lastRun.attempted === 1 ? "" : "s"}
                {lastRun.failed ? `, ${lastRun.failed} failed` : ""}
              </span>
              <button
                onClick={() => navigate("/review")}
                className="inline-flex items-center gap-0.5 text-primary hover:underline shrink-0"
              >
                Go to Review queue<ChevronRight className="h-3 w-3" />
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Week-at-a-glance grid — only renders when there are active slots */}
      <ScheduleWeekGrid
        slots={slots}
        formats={formats}
        natures={natures}
        jobs={jobs}
      />

      {eligibleParents.length > 0 && (
        <Card className="mb-6 border-primary/30 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <RotateCcw className="h-4 w-4" />Content eligible for reuse ({eligibleParents.length})
            </CardTitle>
            <CardDescription>These published pieces are within their reuse window and have reuses remaining. The engine draws from these before generating fresh content.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {eligibleParents.map((parent) => {
                const max = parent.max_reuse_count ?? 0;
                const remaining = max - parent.reuse_count;
                const windowDays = parent.reuse_window_days ?? 90;
                const windowEnd = new Date(new Date(parent.published_at).getTime() + windowDays * 86400000);
                const daysLeft = Math.ceil((windowEnd.getTime() - Date.now()) / 86400000);
                return (
                  <div key={parent.id} className="flex items-center justify-between p-3 bg-background rounded-md border">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{parent.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {parent.content_type || "post"} · Published {new Date(parent.published_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 ml-4 shrink-0">
                      <Badge variant="outline" className="text-xs">{remaining} reuse{remaining !== 1 ? "s" : ""} left</Badge>
                      <Badge variant="outline" className="text-xs">{daysLeft}d window</Badge>
                      <Button size="sm" variant="outline" onClick={() => navigate(`/drafts/${parent.id}`)}>View</Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-6">
        {slotsByDay.map(({ day, daySlots }) => (
          daySlots.length > 0 && (
            <div key={day}>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">{DAYS_OF_WEEK[day]}</h3>
              {daySlots.map((slot) => {
                const isWeekly = slot.frequency === "weekly" || slot.frequency === "as_needed";
                const expanded = expandedSlots.has(slot.id);
                const summaryLine = `${nameOf(natures, slot.nature_id) ?? "…"} ${nameOf(formats, slot.format_id) ?? "…"} for ${nameOf(jobs, slot.job_id) ?? "…"}`
                  + `${slot.lane_id ? `, ${nameOf(lanes, slot.lane_id)} lane` : ", both lanes"}`
                  + `${slot.reader_id ? `, aimed at ${nameOf(readers, slot.reader_id)}` : ", reader rotates"}`
                  + ` — ${DAYS_OF_WEEK[slot.day_of_week]} ${fmtTime12(slot.time_of_day)} ${TZ_ABBR[slot.timezone] ?? slot.timezone}.`;
                return (
                  <Card key={slot.id} className={`mb-3 ${!slot.is_active ? "opacity-60" : ""} ${slot._isNew ? "border-orange-300" : ""}`}>
                    {!expanded && (
                      <CardContent className="py-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm flex-1 min-w-0 truncate">{summaryLine}</p>
                          <Button size="sm" variant="outline" onClick={() => expandRow(setExpandedSlots, slot.id)}>
                            <Pencil className="h-3.5 w-3.5 mr-1.5" />Edit
                          </Button>
                        </div>
                      </CardContent>
                    )}
                    <Collapsible open={expanded}>
                    <CollapsibleContent>
                    <CardContent className="pt-4 space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <Label className="text-xs">Format</Label>
                          <Select value={slot.format_id} onValueChange={(v) => updateSlot(slot.id, { format_id: v })}>
                            <SelectTrigger><SelectValue placeholder="Format" /></SelectTrigger>
                            <SelectContent>{formats.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs">Nature</Label>
                          <Select value={slot.nature_id} onValueChange={(v) => updateSlot(slot.id, { nature_id: v })}>
                            <SelectTrigger><SelectValue placeholder="Nature" /></SelectTrigger>
                            <SelectContent>{natures.map((n) => <SelectItem key={n.id} value={n.id}>{n.name}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs">Job</Label>
                          <Select value={slot.job_id} onValueChange={(v) => updateSlot(slot.id, { job_id: v })}>
                            <SelectTrigger><SelectValue placeholder="Job" /></SelectTrigger>
                            <SelectContent>{jobs.map((j) => <SelectItem key={j.id} value={j.id}>{j.name}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs">Lane</Label>
                          <Select value={slot.lane_id ?? NONE} onValueChange={(v) => updateSlot(slot.id, { lane_id: v === NONE ? null : v })}>
                            <SelectTrigger><SelectValue placeholder="Both lanes" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>Both lanes</SelectItem>
                              {lanes.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs">Reader</Label>
                          <Select value={slot.reader_id ?? NONE} onValueChange={(v) => updateSlot(slot.id, { reader_id: v === NONE ? null : v })}>
                            <SelectTrigger><SelectValue placeholder="Rotate" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>Rotate</SelectItem>
                              {readers.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="flex items-end gap-3 flex-wrap pt-1 border-t">
                        <div className="w-[130px]">
                          <Label className="text-xs">Day</Label>
                          <Select value={String(slot.day_of_week)} onValueChange={(v) => updateSlot(slot.id, { day_of_week: parseInt(v) })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>{DAYS_OF_WEEK.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div className="w-[130px]">
                          <Label className="text-xs">Frequency</Label>
                          <Select value={slot.frequency} onValueChange={(v) => updateSlot(slot.id, { frequency: v })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>{FREQUENCIES.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        {!isWeekly && (
                          <div className="w-[120px]">
                            <Label className="text-xs">Which week</Label>
                            <Select value={slot.anchor ? String(slot.anchor) : ANY} onValueChange={(v) => updateSlot(slot.id, { anchor: v === ANY ? null : parseInt(v) })}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value={ANY}>Any</SelectItem>
                                {ANCHOR_OPTIONS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                        <div className="w-[110px]">
                          <Label className="text-xs">Time</Label>
                          <Input type="time" value={slot.time_of_day} onChange={(e) => updateSlot(slot.id, { time_of_day: e.target.value })} className="h-9" />
                        </div>
                        <div className="w-[200px]">
                          <Label className="text-xs">Timezone</Label>
                          <Select value={slot.timezone} onValueChange={(v) => updateSlot(slot.id, { timezone: v })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>{TIMEZONES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div className="flex items-center gap-2 pb-1">
                          <Label className="text-xs">Active</Label>
                          <Switch checked={slot.is_active} onCheckedChange={(v) => updateSlot(slot.id, { is_active: v })} />
                        </div>
                        <div className="flex gap-1 pb-1 ml-auto">
                          <Button size="sm" onClick={() => collapseRow(setExpandedSlots, slot.id)}>
                            <SaveIcon className="h-3.5 w-3.5 mr-1.5" />Save
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => runSlot(slot)} disabled={!!running || slot._isNew} title={slot._isNew ? "Save cadence first to enable run" : "Run now"}>
                            {running === slot.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => deleteSlot(slot)}><Trash2 className="h-3 w-3" /></Button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1 border-t">
                        <div>
                          <Label className="text-xs">Max reuses</Label>
                          <Input type="number" min={0} max={20} value={slot.max_reuse_count} onChange={(e) => updateSlot(slot.id, { max_reuse_count: parseInt(e.target.value) || 0 })} className="h-8 text-sm" />
                        </div>
                        <div>
                          <Label className="text-xs">Window (days)</Label>
                          <Input type="number" min={1} max={365} value={slot.reuse_window_days} onChange={(e) => updateSlot(slot.id, { reuse_window_days: parseInt(e.target.value) || 90 })} disabled={slot.max_reuse_count === 0} className="h-8 text-sm" />
                        </div>
                        <div className="flex items-end gap-2 pb-1">
                          <div>
                            <Label className="text-xs">Requires child</Label>
                            <div className="mt-2"><Switch checked={slot.requires_child} onCheckedChange={(v) => updateSlot(slot.id, { requires_child: v })} /></div>
                          </div>
                        </div>
                        {slot.requires_child && (
                          <>
                            <div>
                              <Label className="text-xs">Child format</Label>
                              <Select value={slot.child_format_id ?? NONE} onValueChange={(v) => updateSlot(slot.id, { child_format_id: v === NONE ? null : v })}>
                                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={NONE}>Same as parent</SelectItem>
                                  {formats.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label className="text-xs">Child nature</Label>
                              <Select value={slot.child_nature_id ?? NONE} onValueChange={(v) => updateSlot(slot.id, { child_nature_id: v === NONE ? null : v })}>
                                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={NONE}>Same as parent</SelectItem>
                                  {natures.map((n) => <SelectItem key={n.id} value={n.id}>{n.name}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                          </>
                        )}
                      </div>

                      {slot._isNew && (
                        <p className="text-xs text-orange-500 font-medium">New slot — save cadence to activate the run button.</p>
                      )}

                      <p className="text-xs text-muted-foreground">
                        {nameOf(natures, slot.nature_id)} {nameOf(formats, slot.format_id)} for {nameOf(jobs, slot.job_id)}
                        {slot.lane_id ? `, ${nameOf(lanes, slot.lane_id)} lane` : ", both lanes"}
                        {slot.reader_id ? `, aimed at ${nameOf(readers, slot.reader_id)}` : ", reader rotates"}.
                      </p>

                      {(() => {
                        const r = resolveNext({
                          day_of_week: slot.day_of_week,
                          frequency: slot.frequency as never,
                          anchor: slot.anchor,
                          time_of_day: slot.time_of_day,
                          timezone: slot.timezone,
                        });
                        return (
                          <p className="text-xs flex items-center gap-1.5 text-foreground/80">
                            <CalendarClock className="h-3.5 w-3.5 shrink-0 text-primary" />
                            {r.basis === "as_needed"
                              ? <span><span className="font-medium">As needed</span> — no fixed publish time; set on approval.</span>
                              : r.localDisplay
                                ? <span>Next publish: <span className="font-medium">{r.localDisplay}</span> <span className="text-muted-foreground">({r.scheduledFor})</span></span>
                                : <span className="text-muted-foreground">No upcoming occurrence found.</span>}
                          </p>
                        );
                      })()}
                    </CardContent>
                    </CollapsibleContent>
                    </Collapsible>
                  </Card>
                );
              })}
            </div>
          )
        ))}

        {slots.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <Calendar className="h-10 w-10 mx-auto mb-4 opacity-30" />
            <p className="text-sm">No slots yet.</p>
            <p className="text-xs mt-1">Add a slot below to put the engine to work.</p>
          </div>
        )}

        <Button variant="outline" onClick={addSlot} className="w-full">
          <Plus className="h-4 w-4 mr-2" />Add slot
        </Button>
      </div>
    </>
  );
};

export default CadenceTab;
