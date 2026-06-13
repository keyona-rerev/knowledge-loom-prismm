import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";

// Audience is the source of truth for who Prismm writes to and what pressure it
// answers. The profile is the thesis and fit. Lanes are the segments (one is the
// wedge). SWOT is the standing and triggered terrain. Readers are the people in
// the room, each carrying the questions a post has to answer. The schedule and the
// generator both read from here; lanes and readers are also slot dials on the schedule.

interface ProfileState {
  thesis: string;
  fit_criteria: string[];
  institution_type: string;
  asset_range: string;
  core_systems: string;
  language_use: string[];
  language_avoid: string[];
  channels: string[];
}

interface LaneRow {
  id: string;
  key: string;
  name: string;
  is_wedge: boolean;
  description: string;
  vocabulary: string[];
  sort_order: number;
  _isNew?: boolean;
}

interface SwotRow {
  id: string;
  quadrant: string;
  body: string;
  threat_class: string; // "" means none
  lane_local_id: string; // "" means none; refers to a LaneRow.id (temp or real)
  sort_order: number;
  _isNew?: boolean;
}

interface ReaderRow {
  id: string;
  key: string;
  role: string;
  who: string;
  side: string;
  is_published_to: boolean;
  lane_scope: string;
  activation_trigger: string;
  threat_local_id: string; // "" means none; refers to a SwotRow.id (temp or real)
  avatar_initials: string;
  questions: string[];
  sort_order: number;
  _isNew?: boolean;
}

const QUADRANT_OPTIONS = [
  { value: "strength", label: "Strength" },
  { value: "weakness", label: "Weakness" },
  { value: "opportunity", label: "Opportunity" },
  { value: "threat", label: "Threat" },
];
const THREAT_CLASS_OPTIONS = [
  { value: "standing", label: "Standing" },
  { value: "triggered", label: "Triggered" },
];
const SIDE_OPTIONS = [
  { value: "decision", label: "Decision maker" },
  { value: "end_user", label: "End user" },
];
const LANE_SCOPE_OPTIONS = [
  { value: "both", label: "Both lanes" },
  { value: "credit_union", label: "Credit union" },
  { value: "community_bank", label: "Community bank" },
];
const NONE = "__none__";

const toArray = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
const linesToArray = (s: string): string[] => s.split("\n").map((x) => x.trim()).filter(Boolean);
const csvToArray = (s: string): string[] => s.split(",").map((x) => x.trim()).filter(Boolean);
const slugify = (s: string): string =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || `item_${Date.now()}`;
const initialsOf = (s: string): string =>
  s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("") || "?";

const Audience = () => {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [profileRowId, setProfileRowId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [profile, setProfile] = useState<ProfileState>({
    thesis: "",
    fit_criteria: [],
    institution_type: "",
    asset_range: "",
    core_systems: "",
    language_use: [],
    language_avoid: [],
    channels: [],
  });

  const [lanes, setLanes] = useState<LaneRow[]>([]);
  const [swot, setSwot] = useState<SwotRow[]>([]);
  const [readers, setReaders] = useState<ReaderRow[]>([]);

  const [deletedLanes, setDeletedLanes] = useState<string[]>([]);
  const [deletedSwot, setDeletedSwot] = useState<string[]>([]);
  const [deletedReaders, setDeletedReaders] = useState<string[]>([]);

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/auth"); return; }
      const uid = session.user.id;
      setUserId(uid);

      const { data: prof } = await supabase
        .from("audience_profile").select("*").eq("user_id", uid).maybeSingle();
      if (prof) {
        setProfileRowId(prof.id);
        setProfile({
          thesis: prof.thesis || "",
          fit_criteria: toArray(prof.fit_criteria),
          institution_type: prof.institution_type || "",
          asset_range: prof.asset_range || "",
          core_systems: prof.core_systems || "",
          language_use: toArray(prof.language_use),
          language_avoid: toArray(prof.language_avoid),
          channels: toArray(prof.channels),
        });
      }

      const { data: ln } = await supabase
        .from("lanes").select("*").eq("user_id", uid).order("sort_order");
      setLanes((ln || []).map((l) => ({
        id: l.id, key: l.key, name: l.name, is_wedge: l.is_wedge,
        description: l.description || "", vocabulary: toArray(l.vocabulary), sort_order: l.sort_order,
      })));

      const { data: sw } = await supabase
        .from("swot_items").select("*").eq("user_id", uid).order("sort_order");
      setSwot((sw || []).map((s) => ({
        id: s.id, quadrant: s.quadrant, body: s.body, threat_class: s.threat_class || "",
        lane_local_id: s.lane_id || "", sort_order: s.sort_order,
      })));

      const { data: rd } = await supabase
        .from("readers").select("*").eq("user_id", uid).order("sort_order");
      const readerRows = rd || [];
      const { data: rq } = await supabase
        .from("reader_questions").select("*").eq("user_id", uid).order("sort_order");
      const questionsByReader = new Map<string, string[]>();
      (rq || []).forEach((q) => {
        const list = questionsByReader.get(q.reader_id) || [];
        list.push(q.question);
        questionsByReader.set(q.reader_id, list);
      });
      setReaders(readerRows.map((r) => ({
        id: r.id, key: r.key, role: r.role, who: r.who || "", side: r.side,
        is_published_to: r.is_published_to, lane_scope: r.lane_scope,
        activation_trigger: r.activation_trigger || "",
        threat_local_id: r.threat_item_id || "", avatar_initials: r.avatar_initials || "",
        questions: questionsByReader.get(r.id) || [], sort_order: r.sort_order,
      })));
    };
    load();
  }, [navigate]);

  const setLane = (i: number, patch: Partial<LaneRow>) =>
    setLanes((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const setSwotRow = (i: number, patch: Partial<SwotRow>) =>
    setSwot((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const setReader = (i: number, patch: Partial<ReaderRow>) =>
    setReaders((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const removeLane = (i: number) => {
    const row = lanes[i];
    if (!row._isNew) setDeletedLanes((d) => [...d, row.id]);
    // Clear references to this lane from SWOT so we never write a dangling id.
    setSwot((p) => p.map((s) => (s.lane_local_id === row.id ? { ...s, lane_local_id: "" } : s)));
    setLanes((p) => p.filter((_, idx) => idx !== i));
  };
  const removeSwot = (i: number) => {
    const row = swot[i];
    if (!row._isNew) setDeletedSwot((d) => [...d, row.id]);
    setReaders((p) => p.map((r) => (r.threat_local_id === row.id ? { ...r, threat_local_id: "" } : r)));
    setSwot((p) => p.filter((_, idx) => idx !== i));
  };
  const removeReader = (i: number) => {
    const row = readers[i];
    if (!row._isNew) setDeletedReaders((d) => [...d, row.id]);
    setReaders((p) => p.filter((_, idx) => idx !== i));
  };

  const addLane = () => setLanes((p) => [...p, {
    id: `new_${Date.now()}_${p.length}`, key: "", name: "", is_wedge: false,
    description: "", vocabulary: [], sort_order: p.length, _isNew: true,
  }]);
  const addSwot = () => setSwot((p) => [...p, {
    id: `new_${Date.now()}_${p.length}`, quadrant: "strength", body: "",
    threat_class: "", lane_local_id: "", sort_order: p.length, _isNew: true,
  }]);
  const addReader = () => setReaders((p) => [...p, {
    id: `new_${Date.now()}_${p.length}`, key: "", role: "", who: "", side: "decision",
    is_published_to: true, lane_scope: "both", activation_trigger: "", threat_local_id: "",
    avatar_initials: "", questions: [], sort_order: p.length, _isNew: true,
  }]);

  const threatItems = swot.filter((s) => s.quadrant === "threat");

  const handleSave = async () => {
    if (!userId) { toast.error("You must be logged in"); return; }
    setLoading(true);
    try {
      // Audience profile (singleton, unique on user_id)
      const profilePayload = {
        thesis: profile.thesis || null,
        fit_criteria: profile.fit_criteria,
        institution_type: profile.institution_type || null,
        asset_range: profile.asset_range || null,
        core_systems: profile.core_systems || null,
        language_use: profile.language_use,
        language_avoid: profile.language_avoid,
        channels: profile.channels,
        user_id: userId,
      };
      if (profileRowId) {
        const { error } = await supabase.from("audience_profile").update(profilePayload).eq("id", profileRowId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("audience_profile").insert([profilePayload]).select("id").single();
        if (error) throw error;
        if (data) setProfileRowId(data.id);
      }

      // Deletes, child-first so FKs never block. readers cascade their questions.
      if (deletedReaders.length) await supabase.from("readers").delete().in("id", deletedReaders);
      if (deletedSwot.length) await supabase.from("swot_items").delete().in("id", deletedSwot);
      if (deletedLanes.length) await supabase.from("lanes").delete().in("id", deletedLanes);

      // Lanes first; build local-id -> real-id map for SWOT references.
      const laneIdMap = new Map<string, string>();
      const savedLanes = [...lanes];
      for (let i = 0; i < savedLanes.length; i++) {
        const l = savedLanes[i];
        const payload = {
          key: l.key || slugify(l.name), name: l.name, is_wedge: l.is_wedge,
          description: l.description || null, vocabulary: l.vocabulary, sort_order: i,
        };
        if (l._isNew) {
          const { data, error } = await supabase.from("lanes").insert([{ ...payload, user_id: userId }]).select("id").single();
          if (error) throw error;
          laneIdMap.set(l.id, data.id);
        } else {
          const { error } = await supabase.from("lanes").update(payload).eq("id", l.id);
          if (error) throw error;
          laneIdMap.set(l.id, l.id);
        }
      }

      // SWOT second; resolve lane references, build map for reader threat references.
      const swotIdMap = new Map<string, string>();
      const savedSwot = [...swot];
      for (let i = 0; i < savedSwot.length; i++) {
        const s = savedSwot[i];
        const resolvedLane = s.lane_local_id ? laneIdMap.get(s.lane_local_id) ?? null : null;
        const payload = {
          quadrant: s.quadrant, body: s.body,
          threat_class: s.threat_class || null, lane_id: resolvedLane, sort_order: i,
        };
        if (s._isNew) {
          const { data, error } = await supabase.from("swot_items").insert([{ ...payload, user_id: userId }]).select("id").single();
          if (error) throw error;
          swotIdMap.set(s.id, data.id);
        } else {
          const { error } = await supabase.from("swot_items").update(payload).eq("id", s.id);
          if (error) throw error;
          swotIdMap.set(s.id, s.id);
        }
      }

      // Readers third; resolve threat references. Questions are replaced wholesale.
      const savedReaders = [...readers];
      for (let i = 0; i < savedReaders.length; i++) {
        const r = savedReaders[i];
        const resolvedThreat = r.threat_local_id ? swotIdMap.get(r.threat_local_id) ?? null : null;
        const payload = {
          key: r.key || slugify(r.role), role: r.role, who: r.who || null, side: r.side,
          is_published_to: r.is_published_to, lane_scope: r.lane_scope,
          activation_trigger: r.activation_trigger || null, threat_item_id: resolvedThreat,
          avatar_initials: r.avatar_initials || initialsOf(r.role), sort_order: i,
        };
        let readerId = r.id;
        if (r._isNew) {
          const { data, error } = await supabase.from("readers").insert([{ ...payload, user_id: userId }]).select("id").single();
          if (error) throw error;
          readerId = data.id;
        } else {
          const { error } = await supabase.from("readers").update(payload).eq("id", r.id);
          if (error) throw error;
          await supabase.from("reader_questions").delete().eq("reader_id", r.id);
        }
        if (r.questions.length) {
          const rows = r.questions.map((q, qi) => ({
            user_id: userId, reader_id: readerId, question: q, sort_order: qi,
          }));
          const { error } = await supabase.from("reader_questions").insert(rows);
          if (error) throw error;
        }
      }

      setDeletedLanes([]); setDeletedSwot([]); setDeletedReaders([]);
      toast.success("Audience saved");
      // Re-load so temp ids become real ids and references stay valid on next save.
      const reload = async () => {
        const { data: ln } = await supabase.from("lanes").select("*").eq("user_id", userId).order("sort_order");
        setLanes((ln || []).map((l) => ({
          id: l.id, key: l.key, name: l.name, is_wedge: l.is_wedge,
          description: l.description || "", vocabulary: toArray(l.vocabulary), sort_order: l.sort_order,
        })));
        const { data: sw } = await supabase.from("swot_items").select("*").eq("user_id", userId).order("sort_order");
        setSwot((sw || []).map((s) => ({
          id: s.id, quadrant: s.quadrant, body: s.body, threat_class: s.threat_class || "",
          lane_local_id: s.lane_id || "", sort_order: s.sort_order,
        })));
        const { data: rd } = await supabase.from("readers").select("*").eq("user_id", userId).order("sort_order");
        const { data: rq } = await supabase.from("reader_questions").select("*").eq("user_id", userId).order("sort_order");
        const qByReader = new Map<string, string[]>();
        (rq || []).forEach((q) => {
          const list = qByReader.get(q.reader_id) || [];
          list.push(q.question);
          qByReader.set(q.reader_id, list);
        });
        setReaders((rd || []).map((r) => ({
          id: r.id, key: r.key, role: r.role, who: r.who || "", side: r.side,
          is_published_to: r.is_published_to, lane_scope: r.lane_scope,
          activation_trigger: r.activation_trigger || "",
          threat_local_id: r.threat_item_id || "", avatar_initials: r.avatar_initials || "",
          questions: qByReader.get(r.id) || [], sort_order: r.sort_order,
        })));
      };
      await reload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Failed to save: " + msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <Button variant="ghost" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="mr-2 h-4 w-4" />Back to Dashboard
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <h1 className="text-3xl font-bold mb-1">Audience</h1>
        <p className="text-sm text-muted-foreground mb-8">
          Who Prismm writes to and what pressure each post answers. The schedule and the generator both read from here.
        </p>

        {/* Audience profile */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>The thesis and the fit. The first audience context the generator reads.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Thesis</Label>
              <Textarea rows={3} placeholder="The one sentence about who this is for and why it matters now" value={profile.thesis} onChange={(e) => setProfile((p) => ({ ...p, thesis: e.target.value }))} />
            </div>
            <div>
              <Label>Fit criteria (one per line)</Label>
              <Textarea rows={3} value={profile.fit_criteria.join("\n")} onChange={(e) => setProfile((p) => ({ ...p, fit_criteria: linesToArray(e.target.value) }))} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Institution type</Label>
                <Input value={profile.institution_type} onChange={(e) => setProfile((p) => ({ ...p, institution_type: e.target.value }))} />
              </div>
              <div>
                <Label>Asset range</Label>
                <Input value={profile.asset_range} onChange={(e) => setProfile((p) => ({ ...p, asset_range: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Core systems</Label>
              <Textarea rows={2} placeholder="The platforms and vendors they run on" value={profile.core_systems} onChange={(e) => setProfile((p) => ({ ...p, core_systems: e.target.value }))} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Language to use (one per line)</Label>
                <Textarea rows={3} value={profile.language_use.join("\n")} onChange={(e) => setProfile((p) => ({ ...p, language_use: linesToArray(e.target.value) }))} />
              </div>
              <div>
                <Label>Language to avoid (one per line)</Label>
                <Textarea rows={3} value={profile.language_avoid.join("\n")} onChange={(e) => setProfile((p) => ({ ...p, language_avoid: linesToArray(e.target.value) }))} />
              </div>
            </div>
            <div>
              <Label>Channels (comma separated)</Label>
              <Input placeholder="e.g. LinkedIn, conferences, trade press" value={profile.channels.join(", ")} onChange={(e) => setProfile((p) => ({ ...p, channels: csvToArray(e.target.value) }))} />
            </div>
          </CardContent>
        </Card>

        {/* Lanes */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Lanes</CardTitle>
            <CardDescription>The segments Prismm serves. Mark the wedge: the lane content leads with. Lanes are also a slot dial on the schedule.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {lanes.map((l, i) => (
              <div key={l.id} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <Input className="font-medium" placeholder="Lane name (e.g. Credit unions)" value={l.name} onChange={(e) => setLane(i, { name: e.target.value })} />
                  <Button variant="ghost" size="icon" onClick={() => removeLane(i)}><Trash2 className="h-4 w-4" /></Button>
                </div>
                <Textarea rows={2} placeholder="Description: what makes this lane distinct" value={l.description} onChange={(e) => setLane(i, { description: e.target.value })} />
                <div>
                  <Label className="text-xs">Vocabulary (comma separated)</Label>
                  <Input placeholder="The words this lane uses for itself" value={l.vocabulary.join(", ")} onChange={(e) => setLane(i, { vocabulary: csvToArray(e.target.value) })} />
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={l.is_wedge} onCheckedChange={(v) => setLane(i, { is_wedge: v })} />
                  <Label className="text-sm font-normal">Wedge lane (content leads with this one)</Label>
                </div>
              </div>
            ))}
            <Button variant="outline" className="w-full" onClick={addLane}><Plus className="h-4 w-4 mr-2" />Add lane</Button>
          </CardContent>
        </Card>

        {/* SWOT */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>SWOT</CardTitle>
            <CardDescription>The terrain. Threats can be standing (always live) or triggered (held until a moment fires). Threat items can be attached to a reader below.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {swot.map((s, i) => (
              <div key={s.id} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1">
                    <div>
                      <Label className="text-xs">Quadrant</Label>
                      <Select value={s.quadrant} onValueChange={(v) => setSwotRow(i, { quadrant: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{QUADRANT_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    {s.quadrant === "threat" && (
                      <div>
                        <Label className="text-xs">Threat class</Label>
                        <Select value={s.threat_class || NONE} onValueChange={(v) => setSwotRow(i, { threat_class: v === NONE ? "" : v })}>
                          <SelectTrigger><SelectValue placeholder="Unset" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>Unset</SelectItem>
                            {THREAT_CLASS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div>
                      <Label className="text-xs">Lane</Label>
                      <Select value={s.lane_local_id || NONE} onValueChange={(v) => setSwotRow(i, { lane_local_id: v === NONE ? "" : v })}>
                        <SelectTrigger><SelectValue placeholder="No lane" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>No lane</SelectItem>
                          {lanes.filter((l) => l.name.trim()).map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => removeSwot(i)}><Trash2 className="h-4 w-4" /></Button>
                </div>
                <Textarea rows={2} placeholder="The item" value={s.body} onChange={(e) => setSwotRow(i, { body: e.target.value })} />
              </div>
            ))}
            <Button variant="outline" className="w-full" onClick={addSwot}><Plus className="h-4 w-4 mr-2" />Add SWOT item</Button>
          </CardContent>
        </Card>

        {/* Readers */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Readers</CardTitle>
            <CardDescription>The people in the room. Each carries the questions a post has to answer. Readers are an optional slot dial on the schedule; leave a slot unset to rotate.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {readers.map((r, i) => (
              <div key={r.id} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <Input className="font-medium" placeholder="Role (e.g. CEO)" value={r.role} onChange={(e) => setReader(i, { role: e.target.value })} />
                  <Button variant="ghost" size="icon" onClick={() => removeReader(i)}><Trash2 className="h-4 w-4" /></Button>
                </div>
                <Textarea rows={2} placeholder="Who they are: the human behind the role" value={r.who} onChange={(e) => setReader(i, { who: e.target.value })} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Side</Label>
                    <Select value={r.side} onValueChange={(v) => setReader(i, { side: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{SIDE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Lane scope</Label>
                    <Select value={r.lane_scope} onValueChange={(v) => setReader(i, { lane_scope: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{LANE_SCOPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Activation trigger</Label>
                    <Input placeholder="What brings this reader into rotation" value={r.activation_trigger} onChange={(e) => setReader(i, { activation_trigger: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs">Attached threat</Label>
                    <Select value={r.threat_local_id || NONE} onValueChange={(v) => setReader(i, { threat_local_id: v === NONE ? "" : v })}>
                      <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>None</SelectItem>
                        {threatItems.filter((t) => t.body.trim()).map((t) => (
                          <SelectItem key={t.id} value={t.id}>{t.body.slice(0, 60)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Questions this reader needs answered (one per line)</Label>
                  <Textarea rows={3} value={r.questions.join("\n")} onChange={(e) => setReader(i, { questions: linesToArray(e.target.value) })} />
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={r.is_published_to} onCheckedChange={(v) => setReader(i, { is_published_to: v })} />
                  <Label className="text-sm font-normal">Published to (Prismm writes for this reader)</Label>
                </div>
              </div>
            ))}
            <Button variant="outline" className="w-full" onClick={addReader}><Plus className="h-4 w-4 mr-2" />Add reader</Button>
          </CardContent>
        </Card>

        <Button onClick={handleSave} disabled={loading} size="lg">
          {loading ? "Saving..." : "Save Audience"}
        </Button>
      </main>
    </div>
  );
};

export default Audience;
