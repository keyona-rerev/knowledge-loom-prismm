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
  ArrowLeft, Plus, Trash2, Loader2, Play, RefreshCw, Calendar, Clock, RotateCcw
} from "lucide-react";

const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const FREQUENCIES = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Bi-weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "as_needed", label: "As needed" },
];

interface ScheduleEntry {
  id: string;
  content_type_id: string;
  content_type_name: string;
  day_of_week: number;
  frequency: string;
  is_active: boolean;
  requires_child: boolean;
  child_content_type_id: string;
  max_reuse_count: number;
  reuse_window_days: number;
}

interface EligibleParent {
  id: string;
  title: string;
  content_type: string;
  published_at: string;
  reuse_count: number;
  max_reuse_count: number;
  reuse_window_days: number;
  reuse_angles_used: string[];
}

interface CompletedDraft {
  id: string;
  title: string;
  content_type: string;
  approval_status: string;
  created_at: string;
  parent_draft_id: string | null;
}

type ViewMode = "schedule" | "completed";

const ContentSchedule = () => {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<ViewMode>("schedule");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [scheduleEntries, setScheduleEntries] = useState<ScheduleEntry[]>([]);
  const [eligibleParents, setEligibleParents] = useState<EligibleParent[]>([]);
  const [completedDrafts, setCompletedDrafts] = useState<CompletedDraft[]>([]);
  const [contentTypes, setContentTypes] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { navigate("/auth"); return; }

    // Load content types from profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("content_type_templates")
      .eq("user_id", session.user.id)
      .maybeSingle();

    const types = Array.isArray(profile?.content_type_templates)
      ? (profile.content_type_templates as any[]).map(t => ({ id: t.id, name: t.name }))
      : [];
    setContentTypes(types);

    // Load schedule entries
    const { data: entries } = await supabase
      .from("content_schedules")
      .select("*")
      .eq("user_id", session.user.id)
      .order("day_of_week", { ascending: true });
    setScheduleEntries((entries || []) as ScheduleEntry[]);

    // Load eligible parents (published, within window, reuse remaining)
    const now = new Date().toISOString();
    const { data: parents } = await supabase
      .from("drafts")
      .select("id, title, content_type, published_at, reuse_count, max_reuse_count, reuse_window_days, reuse_angles_used")
      .eq("user_id", session.user.id)
      .eq("approval_status", "approved")
      .is("parent_draft_id", null)
      .not("published_at", "is", null)
      .gt("max_reuse_count", 0)
      .order("published_at", { ascending: true });

    // Filter to within window and not exhausted
    const eligible = (parents || []).filter((p: any) => {
      if (p.reuse_count >= p.max_reuse_count) return false;
      const publishedAt = new Date(p.published_at);
      const windowEnd = new Date(publishedAt.getTime() + (p.reuse_window_days || 90) * 24 * 60 * 60 * 1000);
      return new Date() <= windowEnd;
    });
    setEligibleParents(eligible as EligibleParent[]);

    // Load completed drafts
    const { data: completed } = await supabase
      .from("drafts")
      .select("id, title, content_type, approval_status, created_at, parent_draft_id")
      .eq("user_id", session.user.id)
      .in("approval_status", ["approved", "pending"])
      .order("created_at", { ascending: false })
      .limit(50);
    setCompletedDrafts((completed || []) as CompletedDraft[]);

    setLoading(false);
  };

  const saveSchedule = async () => {
    setSaving(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setSaving(false); return; }

    for (const entry of scheduleEntries) {
      if (entry.id.startsWith("new_")) {
        // Insert
        const { id: _id, ...rest } = entry;
        const { error } = await supabase.from("content_schedules").insert({ ...rest, user_id: session.user.id });
        if (error) { toast.error(`Failed to save ${entry.content_type_name}: ${error.message}`); setSaving(false); return; }
      } else {
        // Update
        const { error } = await supabase.from("content_schedules").update({
          content_type_id: entry.content_type_id,
          content_type_name: entry.content_type_name,
          day_of_week: entry.day_of_week,
          frequency: entry.frequency,
          is_active: entry.is_active,
          requires_child: entry.requires_child,
          child_content_type_id: entry.child_content_type_id,
          max_reuse_count: entry.max_reuse_count,
          reuse_window_days: entry.reuse_window_days,
          updated_at: new Date().toISOString(),
        }).eq("id", entry.id);
        if (error) { toast.error(`Failed to update ${entry.content_type_name}: ${error.message}`); setSaving(false); return; }
      }
    }
    toast.success("Schedule saved");
    await loadAll();
    setSaving(false);
  };

  const deleteEntry = async (entry: ScheduleEntry) => {
    if (entry.id.startsWith("new_")) {
      setScheduleEntries(prev => prev.filter(e => e.id !== entry.id));
      return;
    }
    const { error } = await supabase.from("content_schedules").delete().eq("id", entry.id);
    if (error) { toast.error("Failed to delete"); return; }
    setScheduleEntries(prev => prev.filter(e => e.id !== entry.id));
    toast.success("Entry removed");
  };

  const runEntry = async (entry: ScheduleEntry) => {
    setRunning(entry.id);
    try {
      const { data, error } = await supabase.functions.invoke("execute-autopilot-template", {
        body: { scheduleEntryId: entry.id, isTestRun: false },
      });
      if (error) { toast.error("Run failed: " + error.message); }
      else { toast.success(`Generated ${data.draftsCreated} draft(s)`); await loadAll(); }
    } catch (e) {
      toast.error("Run failed");
    }
    setRunning(null);
  };

  const updateEntry = (id: string, field: keyof ScheduleEntry, value: any) => {
    setScheduleEntries(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e));
  };

  const addEntry = () => {
    const newEntry: ScheduleEntry = {
      id: `new_${Date.now()}`,
      content_type_id: "",
      content_type_name: "",
      day_of_week: 1,
      frequency: "weekly",
      is_active: true,
      requires_child: false,
      child_content_type_id: "",
      max_reuse_count: 0,
      reuse_window_days: 90,
    };
    setScheduleEntries(prev => [...prev, newEntry]);
  };

  const daysOrder = [1, 2, 3, 4, 5, 6, 0]; // Mon-Sun display order
  const entriesByDay = daysOrder.map(day => ({
    day,
    entries: scheduleEntries.filter(e => e.day_of_week === day),
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
            <Button
              variant={viewMode === "schedule" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewMode("schedule")}
            >
              <Calendar className="h-4 w-4 mr-2" />Schedule
            </Button>
            <Button
              variant={viewMode === "completed" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewMode("completed")}
            >
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
                <h1 className="text-3xl font-bold">Content Schedule</h1>
                <p className="text-muted-foreground mt-1">Configure when and how content is generated. Every setting here drives a real system decision.</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={loadAll}><RefreshCw className="h-4 w-4 mr-2" />Refresh</Button>
                <Button onClick={saveSchedule} disabled={saving}>
                  {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</> : "Save Schedule"}
                </Button>
              </div>
            </div>

            {/* Eligible parents panel */}
            {eligibleParents.length > 0 && (
              <Card className="mb-6 border-primary/30 bg-primary/5">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <RotateCcw className="h-4 w-4" />
                    Content eligible for reuse ({eligibleParents.length})
                  </CardTitle>
                  <CardDescription>These published pieces are within their reuse window and have reuses remaining. Autopilot will draw from these before generating fresh content.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {eligibleParents.map(parent => {
                      const remaining = parent.max_reuse_count - parent.reuse_count;
                      const windowEnd = new Date(new Date(parent.published_at).getTime() + parent.reuse_window_days * 24 * 60 * 60 * 1000);
                      const daysLeft = Math.ceil((windowEnd.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
                      return (
                        <div key={parent.id} className="flex items-center justify-between p-3 bg-background rounded-md border">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{parent.title}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {parent.content_type} · Published {new Date(parent.published_at).toLocaleDateString()}
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

            {/* Schedule grid by day */}
            <div className="space-y-4">
              {entriesByDay.map(({ day, entries: dayEntries }) => (
                <div key={day}>
                  {dayEntries.length > 0 && (
                    <div className="mb-2">
                      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{DAYS_OF_WEEK[day]}</h3>
                    </div>
                  )}
                  {dayEntries.map(entry => {
                    const otherTypes = contentTypes.filter(t => t.id !== entry.content_type_id);
                    return (
                      <Card key={entry.id} className={`mb-3 ${!entry.is_active ? "opacity-60" : ""}`}>
                        <CardContent className="pt-4 space-y-4">

                          {/* Row 1: Type, Day, Frequency, Active toggle, Delete */}
                          <div className="flex items-end gap-3 flex-wrap">
                            <div className="flex-1 min-w-[160px]">
                              <Label className="text-xs">Content Type</Label>
                              <Select
                                value={entry.content_type_id}
                                onValueChange={(value) => {
                                  const type = contentTypes.find(t => t.id === value);
                                  updateEntry(entry.id, "content_type_id", value);
                                  updateEntry(entry.id, "content_type_name", type?.name || value);
                                }}
                              >
                                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                                <SelectContent>
                                  {contentTypes.map(t => (
                                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="w-[140px]">
                              <Label className="text-xs">Day</Label>
                              <Select
                                value={String(entry.day_of_week)}
                                onValueChange={(v) => updateEntry(entry.id, "day_of_week", parseInt(v))}
                              >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {DAYS_OF_WEEK.map((d, i) => (
                                    <SelectItem key={i} value={String(i)}>{d}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="w-[140px]">
                              <Label className="text-xs">Frequency</Label>
                              <Select
                                value={entry.frequency}
                                onValueChange={(v) => updateEntry(entry.id, "frequency", v)}
                              >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {FREQUENCIES.map(f => (
                                    <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="flex items-center gap-2 pb-1">
                              <Label className="text-xs">Active</Label>
                              <Switch
                                checked={entry.is_active}
                                onCheckedChange={(v) => updateEntry(entry.id, "is_active", v)}
                              />
                            </div>

                            <div className="flex gap-1 pb-1">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => runEntry(entry)}
                                disabled={!!running || entry.id.startsWith("new_") || !entry.content_type_id}
                                title="Run now"
                              >
                                {running === entry.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => deleteEntry(entry)}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>

                          {/* Row 2: Reuse config */}
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1 border-t">
                            <div>
                              <Label className="text-xs">Max reuses</Label>
                              <Input
                                type="number"
                                min={0}
                                max={20}
                                value={entry.max_reuse_count}
                                onChange={(e) => updateEntry(entry.id, "max_reuse_count", parseInt(e.target.value) || 0)}
                                className="h-8 text-sm"
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Window (days)</Label>
                              <Input
                                type="number"
                                min={1}
                                max={365}
                                value={entry.reuse_window_days}
                                onChange={(e) => updateEntry(entry.id, "reuse_window_days", parseInt(e.target.value) || 90)}
                                disabled={entry.max_reuse_count === 0}
                                className="h-8 text-sm"
                              />
                            </div>
                            <div className="flex items-end gap-2 pb-0.5">
                              <div>
                                <Label className="text-xs">Requires child</Label>
                                <div className="mt-2">
                                  <Switch
                                    checked={entry.requires_child}
                                    onCheckedChange={(v) => updateEntry(entry.id, "requires_child", v)}
                                  />
                                </div>
                              </div>
                            </div>
                            {entry.requires_child && (
                              <div>
                                <Label className="text-xs">Child type</Label>
                                <Select
                                  value={entry.child_content_type_id}
                                  onValueChange={(v) => updateEntry(entry.id, "child_content_type_id", v)}
                                >
                                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                                  <SelectContent>
                                    {otherTypes.map(t => (
                                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                          </div>

                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              ))}

              {scheduleEntries.length === 0 && (
                <div className="text-center py-16 text-muted-foreground">
                  <Calendar className="h-10 w-10 mx-auto mb-4 opacity-30" />
                  <p className="text-sm">No schedule entries yet.</p>
                  <p className="text-xs mt-1">Add a content type below to get started.</p>
                </div>
              )}

              <Button variant="outline" onClick={addEntry} className="w-full">
                <Plus className="h-4 w-4 mr-2" />Add Schedule Entry
              </Button>
            </div>
          </>
        )}

        {viewMode === "completed" && (
          <>
            <div className="flex items-center justify-between mb-8">
              <div>
                <h1 className="text-3xl font-bold">Completed Content</h1>
                <p className="text-muted-foreground mt-1">All drafts generated by the system, including child posts and reuses.</p>
              </div>
              <Button variant="outline" onClick={loadAll}><RefreshCw className="h-4 w-4 mr-2" />Refresh</Button>
            </div>

            <div className="space-y-2">
              {completedDrafts.map(draft => (
                <div
                  key={draft.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/30 cursor-pointer"
                  onClick={() => navigate(`/drafts/${draft.id}`)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {draft.parent_draft_id && (
                        <Badge variant="secondary" className="text-xs shrink-0">Child</Badge>
                      )}
                      <p className="text-sm font-medium truncate">{draft.title}</p>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {draft.content_type} · {new Date(draft.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge
                    variant={draft.approval_status === "approved" ? "default" : "outline"}
                    className="ml-4 shrink-0 text-xs"
                  >
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

export default ContentSchedule;
