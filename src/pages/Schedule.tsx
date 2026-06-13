import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  ArrowLeft, Plus, Trash2, Loader2, Play, RefreshCw, Calendar, Clock, RotateCcw, CalendarClock
} from "lucide-react";
import { resolveNext } from "@/lib/scheduleResolver";

// The schedule is a set of slots. Each slot is a standing instruction to the engine:
// on this day, at this frequency, produce a post of this format and nature for this
// job. Lane and reader are optional dials, null means both lanes / rotate the reader.
// Jobs offered here are engine jobs only; reference motions are run by hand.

const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAYS_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday-first display
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
// Timezones the slot's time_of_day can be expressed in. IANA strings, which is
// also the format Zernio's scheduler expects.
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
  time_of_day: string; // "HH:MM" wall-clock in `timezone`
  timezone: string; // IANA
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

interface CompletedDraft {
  id: string;
  title: string;
  content_type: string | null;
  approval_status: string;
  created_at: string;
  parent_draft_id: string | null;
}

type ViewMode = "schedule" | "completed";

const Schedule = () => {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<ViewMode>("schedule");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [slots, setSlots] = useState<Slot[]>([]);
  const [deletedSlots, setDeletedSlots] = useState<string[]>([]);
  const [formats, setFormats] = useState<NamedRow[]>([]);
  const [natures, setNatures] = useState<NamedRow[]>([]);
  const [jobs, setJobs] = useState<NamedRow[]>([]); // engine jobs only
  const [lanes, setLanes] = useState<NamedRow[]>([]);
  const [readers, setReaders] = useState<NamedRow[]>([]);

  const [eligibleParents, setEligibleParents] = useState<EligibleParent[]>([]);
  const [completedDrafts, setCompletedDrafts] = useState<CompletedDraft[]>([]);

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAll = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { navigate("/auth"); return; }
    const uid = session.user.id;
    setUserId(uid);

    const [fmt, nat, jb, ln, rd, sched] = await Promise.all([
      supabase.from("formats").select("id, name").eq("user_id", uid).eq("is_active", true).order("sort_order"),
      supabase.from("natures").select("id, name").eq("user_id", uid).eq("is_active", true).order("sort_order"),
      supabase.from("jobs").select("id, name").eq("user_id", uid).eq("kind", "engine_job").eq("is_active", true).order("sort_order"),
      supabase.from("lanes").select("id, name").eq("user_id", uid).eq("is_active", true).order("sort_order"),
      supabase.from("readers").select("id, role").eq("user_id", uid).eq("is_active", true).order("sort_order"),
      supabase.from("content_schedules").select("*").eq("user_id", uid).order("day_of_week"),
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

    // Eligible parents: published, within window, reuse remaining.
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

    const { data: completed } = await supabase
      .from("drafts")
      .select("id, title, content_type, approval_status, created_at, parent_draft_id")
      .eq("user_id", uid)
      .in("approval_status", ["approved", "pending"])
      .order("created_at", { ascending: false })
      .limit(50);
    setCompletedDrafts((completed || []) as CompletedDraft[]);

    setLoading(false);
  };

  const updateSlot = (id: string, patch: Partial<Slot>) =>
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const addSlot = () => {
    if (!formats.length || !natures.length || !jobs.length) {
      toast.error("Add at least one format, nature, and engine job in Strategy first");
      return;
    }
    setSlots((prev) => [...prev, {
      id: `new_${Date.now()}_${prev.length}`,
      format_id: formats[0].id, nature_id: natures[0].id, job_id: jobs[0].id,
      lane_id: null, reader_id: null, day_of_week: 1, frequency: "weekly", anchor: null,
      time_of_day: "09:00", timezone: "America/New_York",
      is_active: true, requires_child: false, child_format_id: null, child_nature_id: null,
      max_reuse_count: 0, reuse_window_days: 90, _isNew: true,
    }]);
  };

  const deleteSlot = (slot: Slot) => {
    if (!slot._isNew) setDeletedSlots((d) => [...d, slot.id]);
    setSlots((prev) => prev.filter((s) => s.id !== slot.id));
  };

  const saveSchedule = async () => {
    if (!userId) return;
    // Enforce: every slot needs a format, nature, and engine job.
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
      toast.success("Schedule saved");
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
    } catch (e) {
      toast.error("Run failed");
    }
    setRunning(null);
  };

  const nameOf = (rows: NamedRow[], id: string | null) => rows.find((r) => r.id === id)?.name;

  const slotsByDay = DAYS_ORDER.map((day) => ({
    day,
    daySlots: slots.filter((s) => s.day_of_week === day),
  }));

  if (loading) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Button variant="ghost" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="mr-2 h-4 w-4" />Back to Dashboard
          </Button>
          <div className="flex items-center gap-2">
            <Button variant={viewMode === "schedule" ? "default" : "outline"} size="sm" onClick={() => setViewMode("schedule")}>
              <Calendar className="h-4 w-4 mr-2" />Schedule
            </Button>
            <Button variant={viewMode === "completed" ? "default" : "outline"} size="sm" onClick={() => setViewMode("completed")}>
              <Clock className="h-4 w-4 mr-2" />Completed
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        {viewMode === "schedule" && (
          <>
            <div className="flex items-center justify-between mb-8">
              <div>
                <h1 className="text-3xl font-bold">Schedule</h1>
                <p className="text-muted-foreground mt-1">Standing slots the engine fills. Each slot picks a format, nature, and job; lane and reader are optional.</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={loadAll}><RefreshCw className="h-4 w-4 mr-2" />Refresh</Button>
                <Button onClick={saveSchedule} disabled={saving}>
                  {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</> : "Save Schedule"}
                </Button>
              </div>
            </div>

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
                      return (
                        <Card key={slot.id} className={`mb-3 ${!slot.is_active ? "opacity-60" : ""}`}>
                          <CardContent className="pt-4 space-y-4">
                            {/* Core dials */}
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

                            {/* Optional dials */}
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

                            {/* Timing + active + actions */}
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
                                <Button size="sm" variant="outline" onClick={() => runSlot(slot)} disabled={!!running || slot._isNew} title="Run now">
                                  {running === slot.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => deleteSlot(slot)}><Trash2 className="h-3 w-3" /></Button>
                              </div>
                            </div>

                            {/* Reuse + child */}
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

                            {/* Plain-language summary */}
                            <p className="text-xs text-muted-foreground">
                              {nameOf(natures, slot.nature_id)} {nameOf(formats, slot.format_id)} for {nameOf(jobs, slot.job_id)}
                              {slot.lane_id ? `, ${nameOf(lanes, slot.lane_id)} lane` : ", both lanes"}
                              {slot.reader_id ? `, aimed at ${nameOf(readers, slot.reader_id)}` : ", reader rotates"}.
                            </p>

                            {/* Next publish preview: the concrete instant this slot resolves to. */}
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
        )}

        {viewMode === "completed" && (
          <>
            <div className="flex items-center justify-between mb-8">
              <div>
                <h1 className="text-3xl font-bold">Completed Content</h1>
                <p className="text-muted-foreground mt-1">All drafts the engine produced, including child posts and reuses.</p>
              </div>
              <Button variant="outline" onClick={loadAll}><RefreshCw className="h-4 w-4 mr-2" />Refresh</Button>
            </div>

            <div className="space-y-2">
              {completedDrafts.map((draft) => (
                <div key={draft.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/30 cursor-pointer" onClick={() => navigate(`/drafts/${draft.id}`)}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {draft.parent_draft_id && <Badge variant="secondary" className="text-xs shrink-0">Child</Badge>}
                      <p className="text-sm font-medium truncate">{draft.title}</p>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {draft.content_type || "post"} · {new Date(draft.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge variant={draft.approval_status === "approved" ? "default" : "outline"} className="ml-4 shrink-0 text-xs">
                    {draft.approval_status}
                  </Badge>
                </div>
              ))}
              {completedDrafts.length === 0 && (
                <div className="text-center py-16 text-muted-foreground">
                  <Clock className="h-10 w-10 mx-auto mb-4 opacity-30" />
                  <p className="text-sm">No completed content yet.</p>
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
};

export default Schedule;
