import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";

// Strategy is the source of truth for who Prismm is and what its content does.
// Brand lives on profiles (the app themes from these colors). The libraries
// (formats, natures, jobs) live in their own tables and feed both the schedule
// and the generator. Audience lives on its own page.

interface FormatRow {
  id: string;
  key: string;
  name: string;
  definition: string;
  min_words: number | null;
  max_words: number | null;
  writing_samples: string[];
  sort_order: number;
  _isNew?: boolean;
}

interface NatureRow {
  id: string;
  key: string;
  name: string;
  move: string;
  evidence_type: string;
  fit: string;
  rotation_mode: string;
  absorbs: string[];
  writing_samples: string[];
  sort_order: number;
  _isNew?: boolean;
}

interface JobRow {
  id: string;
  key: string;
  name: string;
  description: string;
  funnel_stage: string;
  kind: string;
  sort_order: number;
  _isNew?: boolean;
}

// Hard rules: the editable do-not-say and framing rules the generator and the
// stat trust both read at generation time. They live in the Brand section.
interface HardRuleRow {
  id: string;
  body: string;
  is_active: boolean;
  sort_order: number;
  _isNew?: boolean;
}

const FIT_OPTIONS = [
  { value: "high", label: "High fit" },
  { value: "medium", label: "Medium fit" },
  { value: "low", label: "Low fit" },
];
const ROTATION_OPTIONS = [
  { value: "evergreen", label: "Evergreen" },
  { value: "triggered", label: "Triggered (held out of rotation)" },
];
const STAGE_OPTIONS = [
  { value: "tofu", label: "TOFU" },
  { value: "mofu", label: "MOFU" },
  { value: "bofu", label: "BOFU" },
];
const KIND_OPTIONS = [
  { value: "engine_job", label: "Engine job (slots pick this)" },
  { value: "reference_motion", label: "Reference motion (run by hand)" },
];

const toArray = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
const linesToArray = (s: string): string[] => s.split("\n").map((x) => x.trim()).filter(Boolean);
const csvToArray = (s: string): string[] => s.split(",").map((x) => x.trim()).filter(Boolean);
const slugify = (s: string): string =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || `item_${Date.now()}`;

const Strategy = () => {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [brand, setBrand] = useState({
    business_name: "",
    business_description: "",
    brand_voice: "",
    primary_color: "#f9655b",
    secondary_color: "#6658ea",
    accent_color: "#f5c070",
  });

  // The four generation faders. Defaults match the profiles column defaults.
  const [gen, setGen] = useState({
    gen_source_reliance: 3,
    gen_first_party_weight: 4,
    gen_nature_intensity: 4,
    gen_voice_adherence: 5,
  });

  const [hardRules, setHardRules] = useState<HardRuleRow[]>([]);
  const [formats, setFormats] = useState<FormatRow[]>([]);
  const [natures, setNatures] = useState<NatureRow[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);

  const [deletedHardRules, setDeletedHardRules] = useState<string[]>([]);
  const [deletedFormats, setDeletedFormats] = useState<string[]>([]);
  const [deletedNatures, setDeletedNatures] = useState<string[]>([]);
  const [deletedJobs, setDeletedJobs] = useState<string[]>([]);

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/auth"); return; }
      setUserId(session.user.id);

      const { data: profile } = await supabase
        .from("profiles").select("*").eq("user_id", session.user.id).maybeSingle();
      if (profile) {
        setProfileId(profile.id);
        setBrand({
          business_name: profile.business_name || "",
          business_description: profile.business_description || "",
          brand_voice: profile.brand_voice || "",
          primary_color: profile.primary_color || "#f9655b",
          secondary_color: profile.secondary_color || "#6658ea",
          accent_color: profile.accent_color || "#f5c070",
        });
        setGen({
          gen_source_reliance: profile.gen_source_reliance ?? 3,
          gen_first_party_weight: profile.gen_first_party_weight ?? 4,
          gen_nature_intensity: profile.gen_nature_intensity ?? 4,
          gen_voice_adherence: profile.gen_voice_adherence ?? 5,
        });
      }

      const { data: hr } = await supabase
        .from("hard_rules").select("*").eq("user_id", session.user.id).order("sort_order");
      setHardRules((hr || []).map((r) => ({
        id: r.id, body: r.body || "", is_active: r.is_active ?? true, sort_order: r.sort_order,
      })));

      const { data: fmt } = await supabase
        .from("formats").select("*").eq("user_id", session.user.id).order("sort_order");
      setFormats((fmt || []).map((f) => ({
        id: f.id, key: f.key, name: f.name, definition: f.definition || "",
        min_words: f.min_words, max_words: f.max_words,
        writing_samples: toArray(f.writing_samples), sort_order: f.sort_order,
      })));

      const { data: nat } = await supabase
        .from("natures").select("*").eq("user_id", session.user.id).order("sort_order");
      setNatures((nat || []).map((n) => ({
        id: n.id, key: n.key, name: n.name, move: n.move || "",
        evidence_type: n.evidence_type || "", fit: n.fit, rotation_mode: n.rotation_mode,
        absorbs: toArray(n.absorbs), writing_samples: toArray(n.writing_samples), sort_order: n.sort_order,
      })));

      const { data: jb } = await supabase
        .from("jobs").select("*").eq("user_id", session.user.id).order("sort_order");
      setJobs((jb || []).map((j) => ({
        id: j.id, key: j.key, name: j.name, description: j.description || "",
        funnel_stage: j.funnel_stage, kind: j.kind, sort_order: j.sort_order,
      })));
    };
    load();
  }, [navigate]);

  const setHardRule = (i: number, patch: Partial<HardRuleRow>) =>
    setHardRules((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeHardRule = (i: number) => {
    const row = hardRules[i];
    if (!row._isNew) setDeletedHardRules((d) => [...d, row.id]);
    setHardRules((p) => p.filter((_, idx) => idx !== i));
  };
  const addHardRule = () => setHardRules((p) => [...p, {
    id: `new_${Date.now()}`, body: "", is_active: true, sort_order: p.length, _isNew: true,
  }]);

  const setFormat = (i: number, patch: Partial<FormatRow>) =>
    setFormats((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const setNature = (i: number, patch: Partial<NatureRow>) =>
    setNatures((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const setJob = (i: number, patch: Partial<JobRow>) =>
    setJobs((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const removeFormat = (i: number) => {
    const row = formats[i];
    if (!row._isNew) setDeletedFormats((d) => [...d, row.id]);
    setFormats((p) => p.filter((_, idx) => idx !== i));
  };
  const removeNature = (i: number) => {
    const row = natures[i];
    if (!row._isNew) setDeletedNatures((d) => [...d, row.id]);
    setNatures((p) => p.filter((_, idx) => idx !== i));
  };
  const removeJob = (i: number) => {
    const row = jobs[i];
    if (!row._isNew) setDeletedJobs((d) => [...d, row.id]);
    setJobs((p) => p.filter((_, idx) => idx !== i));
  };

  const addFormat = () => setFormats((p) => [...p, {
    id: `new_${Date.now()}`, key: "", name: "", definition: "",
    min_words: null, max_words: null, writing_samples: [], sort_order: p.length, _isNew: true,
  }]);
  const addNature = () => setNatures((p) => [...p, {
    id: `new_${Date.now()}`, key: "", name: "", move: "", evidence_type: "",
    fit: "medium", rotation_mode: "evergreen", absorbs: [], writing_samples: [], sort_order: p.length, _isNew: true,
  }]);
  const addJob = () => setJobs((p) => [...p, {
    id: `new_${Date.now()}`, key: "", name: "", description: "",
    funnel_stage: "tofu", kind: "engine_job", sort_order: p.length, _isNew: true,
  }]);

  const handleSave = async () => {
    if (!userId) { toast.error("You must be logged in"); return; }
    setLoading(true);
    try {
      // Brand and the generation faders to profiles
      const brandPayload = { ...brand, ...gen, user_id: userId };
      if (profileId) {
        const { error } = await supabase.from("profiles").update(brandPayload).eq("id", profileId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("profiles").insert([brandPayload]).select("id").single();
        if (error) throw error;
        if (data) setProfileId(data.id);
      }

      // Deletes
      if (deletedHardRules.length) await supabase.from("hard_rules").delete().in("id", deletedHardRules);
      if (deletedFormats.length) await supabase.from("formats").delete().in("id", deletedFormats);
      if (deletedNatures.length) await supabase.from("natures").delete().in("id", deletedNatures);
      if (deletedJobs.length) await supabase.from("jobs").delete().in("id", deletedJobs);

      // Hard rules
      for (let i = 0; i < hardRules.length; i++) {
        const r = hardRules[i];
        if (!r.body.trim()) continue;
        const payload = { body: r.body.trim(), is_active: r.is_active, sort_order: i };
        if (r._isNew) {
          const { error } = await supabase.from("hard_rules").insert([{ ...payload, user_id: userId }]);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("hard_rules").update(payload).eq("id", r.id);
          if (error) throw error;
        }
      }

      // Formats
      for (let i = 0; i < formats.length; i++) {
        const f = formats[i];
        const payload = {
          key: f.key || slugify(f.name), name: f.name, definition: f.definition || null,
          min_words: f.min_words, max_words: f.max_words,
          writing_samples: f.writing_samples, sort_order: i,
        };
        if (f._isNew) {
          const { error } = await supabase.from("formats").insert([{ ...payload, user_id: userId }]);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("formats").update(payload).eq("id", f.id);
          if (error) throw error;
        }
      }

      // Natures
      for (let i = 0; i < natures.length; i++) {
        const n = natures[i];
        const payload = {
          key: n.key || slugify(n.name), name: n.name, move: n.move || null,
          evidence_type: n.evidence_type || null, fit: n.fit, rotation_mode: n.rotation_mode,
          absorbs: n.absorbs, writing_samples: n.writing_samples, sort_order: i,
        };
        if (n._isNew) {
          const { error } = await supabase.from("natures").insert([{ ...payload, user_id: userId }]);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("natures").update(payload).eq("id", n.id);
          if (error) throw error;
        }
      }

      // Jobs
      for (let i = 0; i < jobs.length; i++) {
        const j = jobs[i];
        const payload = {
          key: j.key || slugify(j.name), name: j.name, description: j.description || null,
          funnel_stage: j.funnel_stage, kind: j.kind, sort_order: i,
        };
        if (j._isNew) {
          const { error } = await supabase.from("jobs").insert([{ ...payload, user_id: userId }]);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("jobs").update(payload).eq("id", j.id);
          if (error) throw error;
        }
      }

      setDeletedHardRules([]); setDeletedFormats([]); setDeletedNatures([]); setDeletedJobs([]);
      toast.success("Strategy saved");
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
        <h1 className="text-3xl font-bold mb-1">Strategy</h1>
        <p className="text-sm text-muted-foreground mb-8">
          The source of truth for who Prismm is and what its content does. The schedule and the generator both read from here.
        </p>

        {/* Brand */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Brand</CardTitle>
            <CardDescription>Who Prismm is and how it sounds. The first context the generator reads. The app also themes from these colors.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Business name</Label>
              <Input value={brand.business_name} onChange={(e) => setBrand((b) => ({ ...b, business_name: e.target.value }))} />
            </div>
            <div>
              <Label>Business description</Label>
              <Textarea rows={4} value={brand.business_description} onChange={(e) => setBrand((b) => ({ ...b, business_description: e.target.value }))} />
            </div>
            <div>
              <Label>Brand voice</Label>
              <Textarea rows={4} value={brand.brand_voice} onChange={(e) => setBrand((b) => ({ ...b, brand_voice: e.target.value }))} />
            </div>

            {/* Hard rules: edited here, read by the generator and the stat trust on every run. */}
            <div className="space-y-3 rounded-lg border p-4">
              <div>
                <Label className="text-base">Hard rules</Label>
                <p className="text-sm text-muted-foreground">
                  The non-negotiable do-not-say and framing rules. The generator holds these on every run, no fader overrides them.
                </p>
              </div>
              {hardRules.map((r, i) => (
                <div key={r.id} className="flex items-start gap-2">
                  <Textarea
                    rows={2}
                    className="flex-1"
                    placeholder={'e.g. Never say "digital vault."'}
                    value={r.body}
                    onChange={(e) => setHardRule(i, { body: e.target.value })}
                  />
                  <Button variant="ghost" size="icon" onClick={() => removeHardRule(i)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              {hardRules.length === 0 && (
                <p className="text-sm text-muted-foreground">No hard rules yet. Add the do-not-say and framing rules the writer must always hold.</p>
              )}
              <Button variant="outline" className="w-full" onClick={addHardRule}><Plus className="h-4 w-4 mr-2" />Add rule</Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {(["primary", "secondary", "accent"] as const).map((k) => (
                <div key={k}>
                  <Label>{k.charAt(0).toUpperCase() + k.slice(1)} color</Label>
                  <div className="flex items-center gap-2 mt-2">
                    <Input type="color" value={brand[`${k}_color`]} onChange={(e) => setBrand((b) => ({ ...b, [`${k}_color`]: e.target.value }))} className="w-16 h-10 cursor-pointer p-1" />
                    <Input type="text" value={brand[`${k}_color`]} onChange={(e) => setBrand((b) => ({ ...b, [`${k}_color`]: e.target.value }))} className="flex-1" />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Generation console */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Generation console</CardTitle>
            <CardDescription>How the writer leans while it drafts. These shape tone and source use, not the rules.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            {([
              { key: "gen_source_reliance", label: "Source reliance", low: "Strategy only", high: "Source-led" },
              { key: "gen_first_party_weight", label: "First-party weight", low: "By relevance", high: "Company first" },
              { key: "gen_nature_intensity", label: "Nature intensity", low: "Gentle", high: "Full commit" },
              { key: "gen_voice_adherence", label: "Voice adherence", low: "Loose", high: "Locked" },
            ] as const).map((f) => (
              <div key={f.key} className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>{f.label}</Label>
                  <span className="text-sm text-muted-foreground tabular-nums">{gen[f.key]} / 5</span>
                </div>
                <Slider
                  min={1}
                  max={5}
                  step={1}
                  value={[gen[f.key]]}
                  onValueChange={(v) => setGen((g) => ({ ...g, [f.key]: v[0] }))}
                />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{f.low}</span>
                  <span>{f.high}</span>
                </div>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Hard brand rules always apply and are not controlled here.
            </p>
          </CardContent>
        </Card>

        {/* Formats */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Formats</CardTitle>
            <CardDescription>The platform-native artifact and how it is written. The schedule turns these on; the definitions live here.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {formats.map((f, i) => (
              <div key={f.id} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <Input className="font-medium" placeholder="Format name (e.g. Feed post)" value={f.name} onChange={(e) => setFormat(i, { name: e.target.value })} />
                  <Button variant="ghost" size="icon" onClick={() => removeFormat(i)}><Trash2 className="h-4 w-4" /></Button>
                </div>
                <Textarea rows={2} placeholder="Definition: how this format is written" value={f.definition} onChange={(e) => setFormat(i, { definition: e.target.value })} />
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs">Min words</Label><Input type="number" value={f.min_words ?? ""} onChange={(e) => setFormat(i, { min_words: e.target.value ? parseInt(e.target.value) : null })} /></div>
                  <div><Label className="text-xs">Max words</Label><Input type="number" value={f.max_words ?? ""} onChange={(e) => setFormat(i, { max_words: e.target.value ? parseInt(e.target.value) : null })} /></div>
                </div>
                <div>
                  <Label className="text-xs">Writing samples (one per line)</Label>
                  <Textarea rows={3} className="font-mono text-xs" value={f.writing_samples.join("\n")} onChange={(e) => setFormat(i, { writing_samples: linesToArray(e.target.value) })} />
                </div>
              </div>
            ))}
            <Button variant="outline" className="w-full" onClick={addFormat}><Plus className="h-4 w-4 mr-2" />Add format</Button>
          </CardContent>
        </Card>

        {/* Natures */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Natures</CardTitle>
            <CardDescription>The rhetorical angle: how a post argues and what evidence it leans on. Fit is how well it lands with a banking committee.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {natures.map((n, i) => (
              <div key={n.id} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <Input className="font-medium" placeholder="Nature name (e.g. Stat or data point)" value={n.name} onChange={(e) => setNature(i, { name: e.target.value })} />
                  <Button variant="ghost" size="icon" onClick={() => removeNature(i)}><Trash2 className="h-4 w-4" /></Button>
                </div>
                <Textarea rows={2} placeholder="The move: what the post does" value={n.move} onChange={(e) => setNature(i, { move: e.target.value })} />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">Evidence type</Label>
                    <Input placeholder="e.g. a statistic" value={n.evidence_type} onChange={(e) => setNature(i, { evidence_type: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs">Fit</Label>
                    <Select value={n.fit} onValueChange={(v) => setNature(i, { fit: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{FIT_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Rotation</Label>
                    <Select value={n.rotation_mode} onValueChange={(v) => setNature(i, { rotation_mode: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{ROTATION_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Absorbs (comma separated)</Label>
                  <Input placeholder="e.g. myth-buster, data story" value={n.absorbs.join(", ")} onChange={(e) => setNature(i, { absorbs: csvToArray(e.target.value) })} />
                </div>
                <div>
                  <Label className="text-xs">Writing samples (one per line)</Label>
                  <Textarea rows={3} className="font-mono text-xs" value={n.writing_samples.join("\n")} onChange={(e) => setNature(i, { writing_samples: linesToArray(e.target.value) })} />
                </div>
              </div>
            ))}
            <Button variant="outline" className="w-full" onClick={addNature}><Plus className="h-4 w-4 mr-2" />Add nature</Button>
          </CardContent>
        </Card>

        {/* Jobs and funnel motions */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Jobs &amp; funnel strategy</CardTitle>
            <CardDescription>The funnel role a post performs. Engine jobs are picked by scheduled slots. Reference motions are run by hand and shown here for context.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {jobs.map((j, i) => (
              <div key={j.id} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <Input className="font-medium" placeholder="Job name (e.g. Symptom-awareness)" value={j.name} onChange={(e) => setJob(i, { name: e.target.value })} />
                  <Button variant="ghost" size="icon" onClick={() => removeJob(i)}><Trash2 className="h-4 w-4" /></Button>
                </div>
                <Textarea rows={2} placeholder="Prescription: what this post is meant to do" value={j.description} onChange={(e) => setJob(i, { description: e.target.value })} />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Funnel stage</Label>
                    <Select value={j.funnel_stage} onValueChange={(v) => setJob(i, { funnel_stage: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{STAGE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Kind</Label>
                    <Select value={j.kind} onValueChange={(v) => setJob(i, { kind: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{KIND_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            ))}
            <Button variant="outline" className="w-full" onClick={addJob}><Plus className="h-4 w-4 mr-2" />Add job or motion</Button>
          </CardContent>
        </Card>

        <Button onClick={handleSave} disabled={loading} size="lg">
          {loading ? "Saving..." : "Save Strategy"}
        </Button>
      </main>
    </div>
  );
};

export default Strategy;
