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
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, Pencil, Save as SaveIcon, TrendingUp, AlertTriangle, Lightbulb, ShieldAlert, Crown, Building2, Briefcase, LineChart, Users, Headphones, User } from "lucide-react";
import { KNOWN_PLATFORMS, platformLabel } from "@/lib/platform";

// Strategy is the single source of truth for who the business is, who it writes to,
// and what its content does. Formerly split across Strategy and Audience
// pages; merged here because both fed the same schedule and generator and
// there was no reason for a reader to context-switch between them.
//
// Sections, top to bottom: Brand/voice, Generation console, Audience (thesis,
// fit, SWOT, institution context, language), Lanes & readers, and the
// Formats/natures/jobs library. Brand lives on profiles (the app themes from
// these colors); audience lives on audience_profile; lanes/SWOT/readers and
// formats/natures/jobs are their own tables that feed both the schedule and
// the generator.

interface FormatRow {
  id: string;
  key: string;
  name: string;
  platform: string;
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

interface AudienceProfileState {
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
  avatar_initials: string;
  questions: string[];
  sort_order: number;
  _isNew?: boolean;
}

const FIT_OPTIONS = [
  { value: "high", label: "High fit" },
  { value: "medium", label: "Medium fit" },
  { value: "low", label: "Low fit" },
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
const QUADRANT_OPTIONS = [
  { value: "strength", label: "Strength" },
  { value: "weakness", label: "Weakness" },
  { value: "opportunity", label: "Opportunity" },
  { value: "threat", label: "Threat" },
];
// Standard SWOT convention: green/red for internal (strength/weakness),
// blue/amber for external (opportunity/threat). Same four colors used in
// both the read-state grid and the edit-state grid below so the mental
// map carries over between the two.
const QUADRANT_COLORS: Record<string, { border: string; bg: string; text: string; icon: typeof TrendingUp }> = {
  strength: { border: "border-green-300", bg: "bg-green-50", text: "text-green-800", icon: TrendingUp },
  weakness: { border: "border-red-300", bg: "bg-red-50", text: "text-red-800", icon: AlertTriangle },
  opportunity: { border: "border-blue-300", bg: "bg-blue-50", text: "text-blue-800", icon: Lightbulb },
  threat: { border: "border-amber-300", bg: "bg-amber-50", text: "text-amber-800", icon: ShieldAlert },
};
const THREAT_CLASS_OPTIONS = [
  { value: "standing", label: "Standing" },
  { value: "triggered", label: "Triggered" },
];
const SIDE_OPTIONS = [
  { value: "decision", label: "Decision maker" },
  { value: "end_user", label: "End user" },
];
// Reader avatars: keyword-matched icon per role, colored by side (decision
// maker vs end user) so the Readers grid reads at a glance instead of as a
// plain bulleted list. Falls back to a generic person icon for roles that
// don't match a known keyword.
const READER_ICON_RULES: { test: RegExp; icon: typeof User }[] = [
  { test: /ceo|president/i, icon: Crown },
  { test: /retail|deposit|bank/i, icon: Building2 },
  { test: /business development|bdo/i, icon: Briefcase },
  { test: /wealth|trust/i, icon: LineChart },
  { test: /heir|family/i, icon: Users },
  { test: /frontline|staff/i, icon: Headphones },
];
const getReaderIcon = (role: string) =>
  READER_ICON_RULES.find((r) => r.test.test(role))?.icon ?? User;
const SIDE_COLORS: Record<string, { avatarBg: string; avatarText: string; badgeBg: string; badgeText: string }> = {
  decision: { avatarBg: "bg-purple-50", avatarText: "text-purple-700", badgeBg: "bg-purple-50", badgeText: "text-purple-800" },
  end_user: { avatarBg: "bg-teal-50", avatarText: "text-teal-700", badgeBg: "bg-teal-50", badgeText: "text-teal-800" },
};
// Jump-to-section nav for this otherwise very long page. Each id matches a
// section Card below (which carries a matching scroll-mt so the sticky nav
// doesn't cover its heading when scrolled to).
const STRATEGY_SECTIONS = [
  { id: "brand", label: "Brand" },
  { id: "generation", label: "Generation" },
  { id: "audience", label: "Audience" },
  { id: "swot", label: "SWOT" },
  { id: "lanes", label: "Lanes" },
  { id: "readers", label: "Readers" },
  { id: "formats", label: "Formats" },
  { id: "natures", label: "Natures" },
  { id: "jobs", label: "Jobs" },
];
const scrollToSection = (id: string) =>
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

const NONE = "__none__";

const toArray = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
const linesToArray = (s: string): string[] => s.split("\n").map((x) => x.trim()).filter(Boolean);
const csvToArray = (s: string): string[] => s.split(",").map((x) => x.trim()).filter(Boolean);
const slugify = (s: string): string =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || `item_${Date.now()}`;
const initialsOf = (s: string): string =>
  s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("") || "?";

const wordRangeText = (min: number | null, max: number | null): string =>
  min == null && max == null ? "no word range set" : `${min ?? "?"}-${max ?? "?"} words`;

const Strategy = () => {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [audienceProfileId, setAudienceProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [brandEditing, setBrandEditing] = useState(false);

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

  // Voice profile: structured voice rules plus the inline-attribution instruction.
  // Lives on profiles.voice_profile (jsonb), read by the generator every run
  // alongside the free-text brand_voice above. Previously seeded by migration
  // only, with no UI control; edited here now.
  const [voiceProfile, setVoiceProfile] = useState<{ rules: string[]; inline_attribution: string }>({
    rules: [],
    inline_attribution: "",
  });

  const [hardRules, setHardRules] = useState<HardRuleRow[]>([]);
  const [formats, setFormats] = useState<FormatRow[]>([]);
  const [natures, setNatures] = useState<NatureRow[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);

  const [hardRulesEditing, setHardRulesEditing] = useState(false);
  const [voiceProfileEditing, setVoiceProfileEditing] = useState(false);
  const [formatsEditing, setFormatsEditing] = useState(false);
  const [naturesEditing, setNaturesEditing] = useState(false);
  const [jobsEditing, setJobsEditing] = useState(false);

  const [deletedHardRules, setDeletedHardRules] = useState<string[]>([]);
  const [deletedFormats, setDeletedFormats] = useState<string[]>([]);
  const [deletedNatures, setDeletedNatures] = useState<string[]>([]);
  const [deletedJobs, setDeletedJobs] = useState<string[]>([]);

  const [audienceProfile, setAudienceProfile] = useState<AudienceProfileState>({
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

  const [audienceProfileEditing, setAudienceProfileEditing] = useState(false);
  const [lanesEditing, setLanesEditing] = useState(false);
  const [swotEditing, setSwotEditing] = useState(false);
  const [readersEditing, setReadersEditing] = useState(false);

  const [deletedLanes, setDeletedLanes] = useState<string[]>([]);
  const [deletedSwot, setDeletedSwot] = useState<string[]>([]);
  const [deletedReaders, setDeletedReaders] = useState<string[]>([]);

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/auth"); return; }
      const uid = session.user.id;
      setUserId(uid);

      const { data: profile } = await supabase
        .from("profiles").select("*").eq("user_id", uid).maybeSingle();
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
        const vp = (profile.voice_profile && typeof profile.voice_profile === "object") ? profile.voice_profile as any : null;
        setVoiceProfile({
          rules: toArray(vp?.rules),
          inline_attribution: vp?.inline_attribution || "",
        });
      }

      const { data: hr } = await supabase
        .from("hard_rules").select("*").eq("user_id", uid).order("sort_order");
      setHardRules((hr || []).map((r) => ({
        id: r.id, body: r.body || "", is_active: r.is_active ?? true, sort_order: r.sort_order,
      })));

      const { data: fmt } = await supabase
        .from("formats").select("*").eq("user_id", uid).order("sort_order");
      setFormats((fmt || []).map((f) => ({
        id: f.id, key: f.key, name: f.name, platform: f.platform || "linkedin", definition: f.definition || "",
        min_words: f.min_words, max_words: f.max_words,
        writing_samples: toArray(f.writing_samples), sort_order: f.sort_order,
      })));

      const { data: nat } = await supabase
        .from("natures").select("*").eq("user_id", uid).order("sort_order");
      setNatures((nat || []).map((n) => ({
        id: n.id, key: n.key, name: n.name, move: n.move || "",
        evidence_type: n.evidence_type || "", fit: n.fit,
        writing_samples: toArray(n.writing_samples), sort_order: n.sort_order,
      })));

      const { data: jb } = await supabase
        .from("jobs").select("*").eq("user_id", uid).order("sort_order");
      setJobs((jb || []).map((j) => ({
        id: j.id, key: j.key, name: j.name, description: j.description || "",
        funnel_stage: j.funnel_stage, kind: j.kind, sort_order: j.sort_order,
      })));

      const { data: aprof } = await supabase
        .from("audience_profile").select("*").eq("user_id", uid).maybeSingle();
      if (aprof) {
        setAudienceProfileId(aprof.id);
        setAudienceProfile({
          thesis: aprof.thesis || "",
          fit_criteria: toArray(aprof.fit_criteria),
          institution_type: aprof.institution_type || "",
          asset_range: aprof.asset_range || "",
          core_systems: aprof.core_systems || "",
          language_use: toArray(aprof.language_use),
          language_avoid: toArray(aprof.language_avoid),
          channels: toArray(aprof.channels),
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
        avatar_initials: r.avatar_initials || "",
        questions: questionsByReader.get(r.id) || [], sort_order: r.sort_order,
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
  const addHardRule = () => {
    const id = `new_${Date.now()}`;
    setHardRules((p) => [...p, { id, body: "", is_active: true, sort_order: p.length, _isNew: true }]);
  };

  const setVoiceRule = (i: number, value: string) =>
    setVoiceProfile((p) => ({ ...p, rules: p.rules.map((r, idx) => (idx === i ? value : r)) }));
  const removeVoiceRule = (i: number) =>
    setVoiceProfile((p) => ({ ...p, rules: p.rules.filter((_, idx) => idx !== i) }));
  const addVoiceRule = () =>
    setVoiceProfile((p) => ({ ...p, rules: [...p.rules, ""] }));

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

  const addFormat = () => {
    const id = `new_${Date.now()}`;
    setFormats((p) => [...p, {
      id, key: "", name: "", platform: "linkedin", definition: "",
      min_words: null, max_words: null, writing_samples: [], sort_order: p.length, _isNew: true,
    }]);
  };
  const addNature = () => {
    const id = `new_${Date.now()}`;
    setNatures((p) => [...p, {
      id, key: "", name: "", move: "", evidence_type: "",
      fit: "medium", writing_samples: [], sort_order: p.length, _isNew: true,
    }]);
  };
  const addJob = () => {
    const id = `new_${Date.now()}`;
    setJobs((p) => [...p, {
      id, key: "", name: "", description: "",
      funnel_stage: "tofu", kind: "engine_job", sort_order: p.length, _isNew: true,
    }]);
  };

  const setLane = (i: number, patch: Partial<LaneRow>) =>
    setLanes((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const setSwotRow = (id: string, patch: Partial<SwotRow>) =>
    setSwot((p) => p.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const setReader = (i: number, patch: Partial<ReaderRow>) =>
    setReaders((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const removeLane = (i: number) => {
    const row = lanes[i];
    if (!row._isNew) setDeletedLanes((d) => [...d, row.id]);
    // Clear references to this lane from SWOT so we never write a dangling id.
    setSwot((p) => p.map((s) => (s.lane_local_id === row.id ? { ...s, lane_local_id: "" } : s)));
    setLanes((p) => p.filter((_, idx) => idx !== i));
  };
  const removeSwot = (id: string) => {
    const row = swot.find((s) => s.id === id);
    if (!row) return;
    if (!row._isNew) setDeletedSwot((d) => [...d, row.id]);
    setSwot((p) => p.filter((s) => s.id !== id));
  };
  const removeReader = (i: number) => {
    const row = readers[i];
    if (!row._isNew) setDeletedReaders((d) => [...d, row.id]);
    setReaders((p) => p.filter((_, idx) => idx !== i));
  };

  const addLane = () => {
    const id = `new_${Date.now()}_${lanes.length}`;
    setLanes((p) => [...p, {
      id, key: "", name: "", is_wedge: false,
      description: "", vocabulary: [], sort_order: p.length, _isNew: true,
    }]);
  };
  // quadrant is fixed at creation since new SWOT items are always added from
  // inside a specific quadrant's section now, not picked from a dropdown.
  const addSwot = (quadrant: string) => {
    const id = `new_${Date.now()}_${swot.length}`;
    setSwot((p) => [...p, {
      id, quadrant, body: "",
      threat_class: "", lane_local_id: "", sort_order: p.length, _isNew: true,
    }]);
  };
  const addReader = () => {
    const id = `new_${Date.now()}_${readers.length}`;
    setReaders((p) => [...p, {
      id, key: "", role: "", who: "", side: "decision",
      is_published_to: true, lane_scope: "both",
      avatar_initials: "", questions: [], sort_order: p.length, _isNew: true,
    }]);
  };

  const handleSave = async () => {
    if (!userId) { toast.error("You must be logged in"); return; }
    setLoading(true);
    try {
      // Brand and the generation faders to profiles
      const brandPayload = {
        ...brand,
        ...gen,
        voice_profile: {
          rules: voiceProfile.rules.map((r) => r.trim()).filter(Boolean),
          inline_attribution: voiceProfile.inline_attribution.trim() || null,
        },
        user_id: userId,
      };
      if (profileId) {
        const { error } = await supabase.from("profiles").update(brandPayload).eq("id", profileId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("profiles").insert([brandPayload]).select("id").single();
        if (error) throw error;
        if (data) setProfileId(data.id);
      }

      // Deletes (strategy library)
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
          key: f.key || slugify(f.name), name: f.name, platform: f.platform || "linkedin", definition: f.definition || null,
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
          evidence_type: n.evidence_type || null, fit: n.fit,
          writing_samples: n.writing_samples, sort_order: i,
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

      // Audience profile (singleton, unique on user_id)
      const audiencePayload = {
        thesis: audienceProfile.thesis || null,
        fit_criteria: audienceProfile.fit_criteria,
        institution_type: audienceProfile.institution_type || null,
        asset_range: audienceProfile.asset_range || null,
        core_systems: audienceProfile.core_systems || null,
        language_use: audienceProfile.language_use,
        language_avoid: audienceProfile.language_avoid,
        channels: audienceProfile.channels,
        user_id: userId,
      };
      if (audienceProfileId) {
        const { error } = await supabase.from("audience_profile").update(audiencePayload).eq("id", audienceProfileId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("audience_profile").insert([audiencePayload]).select("id").single();
        if (error) throw error;
        if (data) setAudienceProfileId(data.id);
      }

      // Deletes (audience), child-first so FKs never block. readers cascade their questions.
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

      // SWOT second; resolve lane references.
      const savedSwot = [...swot];
      for (let i = 0; i < savedSwot.length; i++) {
        const s = savedSwot[i];
        const resolvedLane = s.lane_local_id ? laneIdMap.get(s.lane_local_id) ?? null : null;
        const payload = {
          quadrant: s.quadrant, body: s.body,
          threat_class: s.threat_class || null, lane_id: resolvedLane, sort_order: i,
        };
        if (s._isNew) {
          const { error } = await supabase.from("swot_items").insert([{ ...payload, user_id: userId }]);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("swot_items").update(payload).eq("id", s.id);
          if (error) throw error;
        }
      }

      // Readers third. Questions are replaced wholesale.
      const savedReaders = [...readers];
      for (let i = 0; i < savedReaders.length; i++) {
        const r = savedReaders[i];
        const payload = {
          key: r.key || slugify(r.role), role: r.role, who: r.who || null, side: r.side,
          is_published_to: r.is_published_to, lane_scope: r.lane_scope,
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

      setDeletedHardRules([]); setDeletedFormats([]); setDeletedNatures([]); setDeletedJobs([]);
      setDeletedLanes([]); setDeletedSwot([]); setDeletedReaders([]);
      toast.success("Strategy saved");

      // Re-load lanes/SWOT/readers so temp ids become real ids and references
      // stay valid on next save.
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
        avatar_initials: r.avatar_initials || "",
        questions: qByReader.get(r.id) || [], sort_order: r.sort_order,
      })));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Failed to save: " + msg);
    } finally {
      setLoading(false);
    }
  };

  // Descriptive copy below used to say "Prismm" literally in four places,
  // hardcoded independently of the business_name field this same page
  // edits above. Falls back to a generic label for anyone who hasn't set
  // a business name yet.
  const businessLabel = brand.business_name || "the business";

  // A reader's "lane scope" used to be a fixed dropdown of Prismm's original
  // two lanes (credit_union/community_bank), disconnected from the actual
  // Lanes list above -- a business with different lanes had no way to scope
  // a reader to any of them. Now built from the real lanes, using the same
  // key a lane would save under (key || slugify(name)) so it stays correct
  // even for a lane that hasn't been saved yet.
  const laneScopeOptions = [
    { value: "both", label: "Both lanes" },
    ...lanes.filter((l) => l.name.trim()).map((l) => ({ value: l.key || slugify(l.name), label: l.name })),
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <Button variant="ghost" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="mr-2 h-4 w-4" />Back to dashboard
          </Button>
        </div>
      </header>

      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b">
        <nav className="container mx-auto px-4 max-w-4xl py-2 flex flex-wrap gap-1">
          {STRATEGY_SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => scrollToSection(s.id)}
              className="px-3 py-1.5 text-sm rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              {s.label}
            </button>
          ))}
        </nav>
      </div>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <h1 className="text-3xl font-bold mb-1">Strategy</h1>
        <p className="text-sm text-muted-foreground mb-8">
          Who {businessLabel} is, who it writes to, and what its content does. The schedule and the generator both read from here.
        </p>

        {/* Brand */}
        <Card id="brand" className="mb-6 scroll-mt-20">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>Brand</CardTitle>
                <CardDescription>Who {businessLabel} is and how it sounds. The first context the generator reads. The app also themes from these colors.</CardDescription>
              </div>
              {brandEditing ? (
                <Button size="sm" onClick={() => setBrandEditing(false)} className="shrink-0">
                  <SaveIcon className="h-3.5 w-3.5 mr-1.5" />Save
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setBrandEditing(true)} className="shrink-0">
                  <Pencil className="h-3.5 w-3.5 mr-1.5" />Edit brand
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {brandEditing ? (
              <>
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
              </>
            ) : (
              <>
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Business name</p>
                  <p className="text-sm">{brand.business_name || "(not set)"}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Business description</p>
                  <p className="text-sm whitespace-pre-wrap">{brand.business_description || "(not set)"}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Brand voice</p>
                  <p className="text-sm whitespace-pre-wrap">{brand.brand_voice || "(not set)"}</p>
                </div>
              </>
            )}

            {/* Hard rules: edited here, read by the generator and the stat trust on every run. */}
            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Label className="text-base">Hard rules</Label>
                  <p className="text-sm text-muted-foreground">
                    The non-negotiable do-not-say and framing rules. The generator holds these on every run, no fader overrides them.
                  </p>
                </div>
                {hardRulesEditing ? (
                  <Button size="sm" onClick={() => setHardRulesEditing(false)} className="shrink-0">
                    <SaveIcon className="h-3.5 w-3.5 mr-1.5" />Save
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setHardRulesEditing(true)} className="shrink-0">
                    <Pencil className="h-3.5 w-3.5 mr-1.5" />Edit
                  </Button>
                )}
              </div>
              {hardRulesEditing ? (
                <>
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
                  <Button variant="outline" className="w-full" onClick={addHardRule}><Plus className="h-4 w-4 mr-2" />Add rule</Button>
                </>
              ) : hardRules.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hard rules yet. Add the do-not-say and framing rules the writer must always hold.</p>
              ) : (
                <ul className="list-disc pl-5 space-y-1 text-sm">
                  {hardRules.map((r) => (
                    <li key={r.id}>{r.body || "(empty)"}</li>
                  ))}
                </ul>
              )}
            </div>

            {/* Voice profile: structured rules plus the inline-attribution instruction, read
                by the generator every run alongside the free-text Brand voice above. */}
            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Label className="text-base">Voice profile</Label>
                  <p className="text-sm text-muted-foreground">
                    Structured tone and register rules, held alongside brand voice above. The generator reads these every run.
                  </p>
                </div>
                {voiceProfileEditing ? (
                  <Button size="sm" onClick={() => setVoiceProfileEditing(false)} className="shrink-0">
                    <SaveIcon className="h-3.5 w-3.5 mr-1.5" />Save
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setVoiceProfileEditing(true)} className="shrink-0">
                    <Pencil className="h-3.5 w-3.5 mr-1.5" />Edit
                  </Button>
                )}
              </div>
              {voiceProfileEditing ? (
                <>
                  {voiceProfile.rules.map((rule, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <Textarea
                        rows={2}
                        className="flex-1"
                        placeholder={'e.g. Calm authority. Trusted financial software with a human pulse.'}
                        value={rule}
                        onChange={(e) => setVoiceRule(i, e.target.value)}
                      />
                      <Button variant="ghost" size="icon" onClick={() => removeVoiceRule(i)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                  <Button variant="outline" className="w-full" onClick={addVoiceRule}><Plus className="h-4 w-4 mr-2" />Add voice rule</Button>
                  <div>
                    <Label className="text-xs">Inline attribution instruction</Label>
                    <Textarea
                      rows={2}
                      placeholder={'e.g. Weave citations into the prose, never as a parenthetical footnote.'}
                      value={voiceProfile.inline_attribution}
                      onChange={(e) => setVoiceProfile((p) => ({ ...p, inline_attribution: e.target.value }))}
                    />
                  </div>
                </>
              ) : (
                <>
                  {voiceProfile.rules.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No voice rules yet. Add the tone and register rules the writer must hold.</p>
                  ) : (
                    <ul className="list-disc pl-5 space-y-1 text-sm">
                      {voiceProfile.rules.map((rule, i) => (
                        <li key={i}>{rule || "(empty)"}</li>
                      ))}
                    </ul>
                  )}
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Inline attribution instruction</p>
                    <p className="text-sm">{voiceProfile.inline_attribution || "(not set)"}</p>
                  </div>
                </>
              )}
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
        <Card id="generation" className="mb-6 scroll-mt-20">
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

        {/* Audience */}
        <h2 className="text-xl font-semibold mt-10 mb-4">Audience</h2>

        <Card id="audience" className="mb-6 scroll-mt-20">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>Profile</CardTitle>
                <CardDescription>The thesis and the fit. The first audience context the generator reads.</CardDescription>
              </div>
              {audienceProfileEditing ? (
                <Button size="sm" onClick={() => setAudienceProfileEditing(false)} className="shrink-0">
                  <SaveIcon className="h-3.5 w-3.5 mr-1.5" />Save
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setAudienceProfileEditing(true)} className="shrink-0">
                  <Pencil className="h-3.5 w-3.5 mr-1.5" />Edit profile
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {audienceProfileEditing ? (
              <>
                <div>
                  <Label>Thesis</Label>
                  <Textarea rows={3} placeholder="The one sentence about who this is for and why it matters now" value={audienceProfile.thesis} onChange={(e) => setAudienceProfile((p) => ({ ...p, thesis: e.target.value }))} />
                </div>
                <div>
                  <Label>Fit criteria (one per line)</Label>
                  <Textarea rows={3} value={audienceProfile.fit_criteria.join("\n")} onChange={(e) => setAudienceProfile((p) => ({ ...p, fit_criteria: linesToArray(e.target.value) }))} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label>Institution type</Label>
                    <Input value={audienceProfile.institution_type} onChange={(e) => setAudienceProfile((p) => ({ ...p, institution_type: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Asset range</Label>
                    <Input value={audienceProfile.asset_range} onChange={(e) => setAudienceProfile((p) => ({ ...p, asset_range: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <Label>Core systems</Label>
                  <Textarea rows={2} placeholder="The platforms and vendors they run on" value={audienceProfile.core_systems} onChange={(e) => setAudienceProfile((p) => ({ ...p, core_systems: e.target.value }))} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label>Language to use (one per line)</Label>
                    <Textarea rows={3} value={audienceProfile.language_use.join("\n")} onChange={(e) => setAudienceProfile((p) => ({ ...p, language_use: linesToArray(e.target.value) }))} />
                  </div>
                  <div>
                    <Label>Language to avoid (one per line)</Label>
                    <Textarea rows={3} value={audienceProfile.language_avoid.join("\n")} onChange={(e) => setAudienceProfile((p) => ({ ...p, language_avoid: linesToArray(e.target.value) }))} />
                  </div>
                </div>
                <div>
                  <Label>Channels (comma separated)</Label>
                  <Input placeholder="e.g. LinkedIn, conferences, trade press" value={audienceProfile.channels.join(", ")} onChange={(e) => setAudienceProfile((p) => ({ ...p, channels: csvToArray(e.target.value) }))} />
                </div>
              </>
            ) : (
              <>
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Thesis</p>
                  <p className="text-sm whitespace-pre-wrap">{audienceProfile.thesis || "(not set)"}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Fit criteria</p>
                  {audienceProfile.fit_criteria.length === 0 ? (
                    <p className="text-sm text-muted-foreground">(none)</p>
                  ) : (
                    <ul className="list-disc pl-5 space-y-1 text-sm">
                      {audienceProfile.fit_criteria.map((c, i) => <li key={i}>{c}</li>)}
                    </ul>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">Institution type</p>
                    <p className="text-sm">{audienceProfile.institution_type || "(not set)"}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">Asset range</p>
                    <p className="text-sm">{audienceProfile.asset_range || "(not set)"}</p>
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Core systems</p>
                  <p className="text-sm whitespace-pre-wrap">{audienceProfile.core_systems || "(not set)"}</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">Language to use</p>
                    {audienceProfile.language_use.length === 0 ? (
                      <p className="text-sm text-muted-foreground">(none)</p>
                    ) : (
                      <ul className="list-disc pl-5 space-y-1 text-sm">
                        {audienceProfile.language_use.map((c, i) => <li key={i}>{c}</li>)}
                      </ul>
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">Language to avoid</p>
                    {audienceProfile.language_avoid.length === 0 ? (
                      <p className="text-sm text-muted-foreground">(none)</p>
                    ) : (
                      <ul className="list-disc pl-5 space-y-1 text-sm">
                        {audienceProfile.language_avoid.map((c, i) => <li key={i}>{c}</li>)}
                      </ul>
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Channels</p>
                  <p className="text-sm">{audienceProfile.channels.length ? audienceProfile.channels.join(", ") : "(not set)"}</p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card id="swot" className="mb-6 scroll-mt-20">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>SWOT</CardTitle>
                <CardDescription>The terrain. Threats can be standing (always live) or triggered (held until a moment fires). Threat items can be attached to a reader below.</CardDescription>
              </div>
              {swotEditing ? (
                <Button size="sm" onClick={() => setSwotEditing(false)} className="shrink-0">
                  <SaveIcon className="h-3.5 w-3.5 mr-1.5" />Save
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setSwotEditing(true)} className="shrink-0">
                  <Pencil className="h-3.5 w-3.5 mr-1.5" />Edit SWOT
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {swotEditing ? (
              <div className="space-y-4">
                {QUADRANT_OPTIONS.map((q) => {
                  const colors = QUADRANT_COLORS[q.value];
                  const Icon = colors.icon;
                  const items = swot.filter((s) => s.quadrant === q.value);
                  return (
                    <div key={q.value} className={`rounded-lg border p-4 space-y-3 ${colors.border} ${colors.bg}`}>
                      <p className={`text-sm font-medium flex items-center gap-1.5 ${colors.text}`}>
                        <Icon className="h-4 w-4" aria-hidden="true" />{q.label}
                      </p>
                      {items.map((s) => (
                        <div key={s.id} className="bg-background rounded-md border p-3 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <Textarea rows={2} className="flex-1" placeholder="The item" value={s.body} onChange={(e) => setSwotRow(s.id, { body: e.target.value })} />
                            <Button variant="ghost" size="icon" onClick={() => removeSwot(s.id)}><Trash2 className="h-4 w-4" /></Button>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {q.value === "threat" && (
                              <div>
                                <Label className="text-xs">Threat class</Label>
                                <Select value={s.threat_class || NONE} onValueChange={(v) => setSwotRow(s.id, { threat_class: v === NONE ? "" : v })}>
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
                              <Select value={s.lane_local_id || NONE} onValueChange={(v) => setSwotRow(s.id, { lane_local_id: v === NONE ? "" : v })}>
                                <SelectTrigger><SelectValue placeholder="No lane" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={NONE}>No lane</SelectItem>
                                  {lanes.filter((l) => l.name.trim()).map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        </div>
                      ))}
                      <Button variant="outline" size="sm" className="w-full" onClick={() => addSwot(q.value)}>
                        <Plus className="h-3.5 w-3.5 mr-1.5" />Add {q.label.toLowerCase()}
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : swot.length === 0 ? (
              <p className="text-sm text-muted-foreground">No SWOT items yet.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {QUADRANT_OPTIONS.map((q) => {
                  const colors = QUADRANT_COLORS[q.value];
                  const Icon = colors.icon;
                  const items = swot.filter((s) => s.quadrant === q.value);
                  return (
                    <div key={q.value} className={`rounded-lg border p-4 ${colors.border} ${colors.bg}`}>
                      <p className={`text-sm font-medium mb-2 flex items-center gap-1.5 ${colors.text}`}>
                        <Icon className="h-4 w-4" aria-hidden="true" />{q.label}
                      </p>
                      {items.length === 0 ? (
                        <p className="text-sm text-muted-foreground">None yet.</p>
                      ) : (
                        <ul className="list-disc pl-5 space-y-1 text-sm">
                          {items.map((s) => <li key={s.id}>{s.body || "(empty)"}</li>)}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Lanes & readers */}
        <h2 className="text-xl font-semibold mt-10 mb-4">Lanes &amp; readers</h2>

        <Card id="lanes" className="mb-6 scroll-mt-20">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>Lanes</CardTitle>
                <CardDescription>The segments {businessLabel} serves. Mark the wedge: the lane content leads with. Lanes are also a slot dial on the schedule.</CardDescription>
              </div>
              {lanesEditing ? (
                <Button size="sm" onClick={() => setLanesEditing(false)} className="shrink-0">
                  <SaveIcon className="h-3.5 w-3.5 mr-1.5" />Save
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setLanesEditing(true)} className="shrink-0">
                  <Pencil className="h-3.5 w-3.5 mr-1.5" />Edit lanes
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {lanesEditing ? (
              <>
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
              </>
            ) : lanes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No lanes yet.</p>
            ) : (
              <ul className="list-disc pl-5 space-y-1 text-sm">
                {lanes.map((l) => (
                  <li key={l.id} className="flex items-center gap-2">
                    <span className="font-medium">{l.name || "Untitled lane"}</span>
                    {l.is_wedge && <Badge variant="outline">Wedge</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card id="readers" className="mb-6 scroll-mt-20">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>Readers</CardTitle>
                <CardDescription>The people in the room. Each carries the questions a post has to answer. Readers are an optional slot dial on the schedule; leave a slot unset to rotate.</CardDescription>
              </div>
              {readersEditing ? (
                <Button size="sm" onClick={() => setReadersEditing(false)} className="shrink-0">
                  <SaveIcon className="h-3.5 w-3.5 mr-1.5" />Save
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setReadersEditing(true)} className="shrink-0">
                  <Pencil className="h-3.5 w-3.5 mr-1.5" />Edit readers
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {readersEditing ? (
              <>
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
                          <SelectContent>{laneScopeOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Questions this reader needs answered (one per line)</Label>
                      <Textarea rows={3} value={r.questions.join("\n")} onChange={(e) => setReader(i, { questions: linesToArray(e.target.value) })} />
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch checked={r.is_published_to} onCheckedChange={(v) => setReader(i, { is_published_to: v })} />
                      <Label className="text-sm font-normal">Published to ({businessLabel} writes for this reader)</Label>
                    </div>
                  </div>
                ))}
                <Button variant="outline" className="w-full" onClick={addReader}><Plus className="h-4 w-4 mr-2" />Add reader</Button>
              </>
            ) : readers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No readers yet.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {readers.map((r) => {
                  const Icon = getReaderIcon(r.role);
                  const sideLabel = SIDE_OPTIONS.find((o) => o.value === r.side)?.label ?? r.side;
                  const colors = SIDE_COLORS[r.side] ?? SIDE_COLORS.decision;
                  return (
                    <div key={r.id} className="border rounded-xl p-3 flex flex-col items-center text-center gap-2">
                      <div className={`w-11 h-11 rounded-full flex items-center justify-center ${colors.avatarBg} ${colors.avatarText}`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <p className="text-sm font-medium leading-tight">{r.role || "Untitled reader"}</p>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${colors.badgeBg} ${colors.badgeText}`}>{sideLabel}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Formats, natures & jobs library */}
        <h2 className="text-xl font-semibold mt-10 mb-4">Formats, natures &amp; jobs library</h2>

        <Card id="formats" className="mb-6 scroll-mt-20">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>Formats</CardTitle>
                <CardDescription>The platform-native artifact and how it is written. The schedule turns these on; the definitions live here.</CardDescription>
              </div>
              {formatsEditing ? (
                <Button size="sm" onClick={() => setFormatsEditing(false)} className="shrink-0">
                  <SaveIcon className="h-3.5 w-3.5 mr-1.5" />Save
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setFormatsEditing(true)} className="shrink-0">
                  <Pencil className="h-3.5 w-3.5 mr-1.5" />Edit formats
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {formatsEditing ? (
              <>
                {formats.map((f, i) => (
                  <div key={f.id} className="border rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <Input className="font-medium" placeholder="Format name (e.g. Feed post)" value={f.name} onChange={(e) => setFormat(i, { name: e.target.value })} />
                      <Select value={f.platform || "linkedin"} onValueChange={(v) => setFormat(i, { platform: v })}>
                        <SelectTrigger className="w-36 shrink-0"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {KNOWN_PLATFORMS.map((p) => (
                            <SelectItem key={p} value={p}>{platformLabel(p)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
              </>
            ) : formats.length === 0 ? (
              <p className="text-sm text-muted-foreground">No formats yet.</p>
            ) : (
              <ul className="list-disc pl-5 space-y-1 text-sm">
                {formats.map((f) => (
                  <li key={f.id}>
                    <span className="font-medium">{f.name || "Untitled format"}</span>
                    {" · "}
                    <Badge variant="outline" className="text-xs align-middle">{platformLabel(f.platform)}</Badge>
                    {" · "}
                    <span className="text-muted-foreground">{wordRangeText(f.min_words, f.max_words)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card id="natures" className="mb-6 scroll-mt-20">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>Natures</CardTitle>
                <CardDescription>The rhetorical angle: how a post argues and what evidence it leans on. Fit is how well it lands with a banking committee.</CardDescription>
              </div>
              {naturesEditing ? (
                <Button size="sm" onClick={() => setNaturesEditing(false)} className="shrink-0">
                  <SaveIcon className="h-3.5 w-3.5 mr-1.5" />Save
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setNaturesEditing(true)} className="shrink-0">
                  <Pencil className="h-3.5 w-3.5 mr-1.5" />Edit natures
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {naturesEditing ? (
              <>
                {natures.map((n, i) => (
                  <div key={n.id} className="border rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <Input className="font-medium" placeholder="Nature name (e.g. Stat or data point)" value={n.name} onChange={(e) => setNature(i, { name: e.target.value })} />
                      <Button variant="ghost" size="icon" onClick={() => removeNature(i)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                    <Textarea rows={2} placeholder="The move: what the post does" value={n.move} onChange={(e) => setNature(i, { move: e.target.value })} />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                    </div>
                    <div>
                      <Label className="text-xs">Writing samples (one per line)</Label>
                      <Textarea rows={3} className="font-mono text-xs" value={n.writing_samples.join("\n")} onChange={(e) => setNature(i, { writing_samples: linesToArray(e.target.value) })} />
                    </div>
                  </div>
                ))}
                <Button variant="outline" className="w-full" onClick={addNature}><Plus className="h-4 w-4 mr-2" />Add nature</Button>
              </>
            ) : natures.length === 0 ? (
              <p className="text-sm text-muted-foreground">No natures yet.</p>
            ) : (
              <ul className="list-disc pl-5 space-y-1 text-sm">
                {natures.map((n) => (
                  <li key={n.id}>
                    <span className="font-medium">{n.name || "Untitled nature"}</span>
                    {" · "}
                    <span className="text-muted-foreground">{FIT_OPTIONS.find((o) => o.value === n.fit)?.label ?? n.fit}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card id="jobs" className="mb-6 scroll-mt-20">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>Jobs &amp; funnel strategy</CardTitle>
                <CardDescription>The funnel role a post performs. Engine jobs are picked by scheduled slots. Reference motions are run by hand and shown here for context.</CardDescription>
              </div>
              {jobsEditing ? (
                <Button size="sm" onClick={() => setJobsEditing(false)} className="shrink-0">
                  <SaveIcon className="h-3.5 w-3.5 mr-1.5" />Save
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setJobsEditing(true)} className="shrink-0">
                  <Pencil className="h-3.5 w-3.5 mr-1.5" />Edit jobs
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {jobsEditing ? (
              <>
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
              </>
            ) : jobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No jobs yet.</p>
            ) : (
              <ul className="list-disc pl-5 space-y-1 text-sm">
                {jobs.map((j) => (
                  <li key={j.id}>
                    <span className="font-medium">{j.name || "Untitled job"}</span>
                    {" · "}
                    <span className="text-muted-foreground">{STAGE_OPTIONS.find((o) => o.value === j.funnel_stage)?.label ?? j.funnel_stage}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Button onClick={handleSave} disabled={loading} size="lg">
          {loading ? "Saving..." : "Save strategy"}
        </Button>
      </main>
    </div>
  );
};

export default Strategy;
