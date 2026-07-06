import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  ArrowLeft, Plus, Trash2, RotateCcw, Palette, ListChecks,
  LayoutGrid, Ruler, Upload, GripVertical, ExternalLink, Sparkles, ImageIcon
} from "lucide-react";

interface DesignRule {
  id: string;
  text: string;
  tag: "do" | "avoid";
}

interface VisualConfig {
  color_navy: string;
  color_coral: string;
  color_purple: string;
  color_yellow: string;
  display_font: string;
  body_font: string;
  logo_url: string;
  logo_min_height: number;
  canvas_width: number;
  canvas_height: number;
  design_rules: DesignRule[];
  enabled_visual_types: string[];
}

interface DraftOption { id: string; title: string | null; }

const SAMPLE_OPTION_VALUE = "__sample__";

const DISPLAY_FONTS = [
  { label: "Bricolage Grotesque", value: "Bricolage Grotesque", weight: "800", category: "Grotesque" },
  { label: "Syne", value: "Syne", weight: "800", category: "Geometric" },
  { label: "Space Grotesk", value: "Space Grotesk", weight: "700", category: "Grotesque" },
  { label: "Familjen Grotesk", value: "Familjen Grotesk", weight: "700", category: "Grotesque" },
  { label: "Cabinet Grotesk", value: "Cabinet Grotesk", weight: "800", category: "Grotesque" },
  { label: "DM Serif Display", value: "DM Serif Display", weight: "400", category: "Serif" },
  { label: "Playfair Display", value: "Playfair Display", weight: "800", category: "Serif" },
  { label: "Fraunces", value: "Fraunces", weight: "700", category: "Serif" },
];

const BODY_FONTS = [
  { label: "Hanken Grotesk", value: "Hanken Grotesk", weight: "400" },
  { label: "Inter", value: "Inter", weight: "400" },
  { label: "Plus Jakarta Sans", value: "Plus Jakarta Sans", weight: "400" },
  { label: "DM Sans", value: "DM Sans", weight: "400" },
  { label: "Outfit", value: "Outfit", weight: "400" },
];

// These 4 are the ONLY visual types the AI actually knows how to produce
// (see supabase/functions/_shared/visual-prompt.ts, the single source of
// truth both this toggle list and the real prompt draw from). This used to
// list 8 different types (stat_graphic, quote_card, pillar_statement,
// human_moment, comparison, timeline, checklist, branded_announcement)
// that had no connection to the AI's real logic at all — toggling them did
// nothing. Rather than build prompt support for 8 types (a real scope
// decision) or leave decorative toggles that lie about having an effect,
// this list was cut down to exactly what's real. Toggling one of these
// off now genuinely removes it from what the AI can choose.
const ALL_VISUAL_TYPES = [
  { id: "hero_number", label: "Hero number", desc: "One large stat or number dominates the canvas, short statement below" },
  { id: "before_after", label: "Before / after", desc: "Canvas split into two halves showing contrast" },
  { id: "logic_diagram", label: "Logic diagram", desc: "2-3 connected nodes or steps showing how something works" },
  { id: "transformation", label: "Transformation", desc: "A single symbolic visual at large scale showing change or direction" },
];

const DEFAULT_RULES: DesignRule[] = [
  { id: "r1", text: "NO pill labels, category tags, eyebrow text, or text in a rounded badge shape.", tag: "avoid" },
  { id: "r2", text: "NO card boxes, bordered containers, or frosted overlays around text.", tag: "avoid" },
  { id: "r3", text: "Logo must be visually prominent — bottom-left, minimum 56px height.", tag: "do" },
  { id: "r4", text: "Typography does the heavy lifting. Large type on a clean background is the brand.", tag: "do" },
  { id: "r5", text: "Whitespace is intentional. Generous margins. Nothing crammed.", tag: "do" },
  { id: "r6", text: "Color accents used sparingly as punctuation, not decoration.", tag: "do" },
];

const DEFAULT_CONFIG: VisualConfig = {
  color_navy: "#1b2b45",
  color_coral: "#f9655b",
  color_purple: "#6658ea",
  color_yellow: "#f5c070",
  display_font: "Bricolage Grotesque",
  body_font: "Hanken Grotesk",
  logo_url: "https://res.cloudinary.com/dialhpycd/image/upload/v1772044659/prismm-logo-dark-bright_2x-removebg-preview_ut98x4.png",
  logo_min_height: 56,
  canvas_width: 1200,
  canvas_height: 627,
  design_rules: DEFAULT_RULES,
  enabled_visual_types: ["hero_number", "before_after", "logic_diagram", "transformation"],
};

function loadGoogleFont(family: string) {
  const id = "gf-" + family.replace(/\s+/g, "-").toLowerCase();
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;500;600;700;800&display=swap`;
  document.head.appendChild(link);
}

const VisualStudio = () => {
  const navigate = useNavigate();
  const [config, setConfig] = useState<VisualConfig>(DEFAULT_CONFIG);
  const [newRuleText, setNewRuleText] = useState("");
  const [newRuleTag, setNewRuleTag] = useState<"do" | "avoid">("do");
  const [customDisplayFont, setCustomDisplayFont] = useState("");
  const [customBodyFont, setCustomBodyFont] = useState("");
  const [showCustomDisplay, setShowCustomDisplay] = useState(false);
  const [showCustomBody, setShowCustomBody] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Live preview: generates against the CURRENT in-memory config (including
  // unsaved edits), never against what's saved in the DB, and never
  // persists anything. This is the missing piece that made Visual Studio a
  // page of swatches and font-preview text rather than somewhere you could
  // actually see what a real graphic would look like before committing to it.
  const [draftOptions, setDraftOptions] = useState<DraftOption[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string>(SAMPLE_OPTION_VALUE);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    [...DISPLAY_FONTS, ...BODY_FONTS].forEach(f => loadGoogleFont(f.value));
  }, []);

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/auth"); return; }
      const { data } = await supabase
        .from("profiles")
        .select("visual_studio_config")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (data && (data as any).visual_studio_config) {
        try {
          const saved = JSON.parse((data as any).visual_studio_config);
          const validTypeIds = new Set(ALL_VISUAL_TYPES.map(t => t.id));
          const merged = { ...DEFAULT_CONFIG, ...saved };
          // Migrate away from the old 8-type vocabulary: if a saved config
          // has stale ids (or none valid), fall back to all 4 real types
          // rather than carrying forward toggles that never did anything.
          const savedTypes: string[] = Array.isArray(saved.enabled_visual_types) ? saved.enabled_visual_types : [];
          const stillValid = savedTypes.filter((id: string) => validTypeIds.has(id));
          merged.enabled_visual_types = stillValid.length > 0 ? stillValid : DEFAULT_CONFIG.enabled_visual_types;
          setConfig(merged);
        } catch { /* stay on defaults */ }
      }

      const { data: drafts } = await supabase
        .from("drafts")
        .select("id, title")
        .eq("user_id", session.user.id)
        .in("approval_status", ["pending", "approved"])
        .order("created_at", { ascending: false })
        .limit(15);
      setDraftOptions((drafts || []) as DraftOption[]);
    };
    load();
  }, [navigate]);

  useEffect(() => {
    if (customDisplayFont.trim()) loadGoogleFont(customDisplayFont.trim());
  }, [customDisplayFont]);

  useEffect(() => {
    if (customBodyFont.trim()) loadGoogleFont(customBodyFont.trim());
  }, [customBodyFont]);

  const activeDisplayFont = showCustomDisplay && customDisplayFont.trim()
    ? customDisplayFont.trim() : config.display_font;
  const activeBodyFont = showCustomBody && customBodyFont.trim()
    ? customBodyFont.trim() : config.body_font;
  const displayWeight = DISPLAY_FONTS.find(f => f.value === config.display_font)?.weight ?? "700";

  const buildCurrentConfig = (): VisualConfig => ({
    ...config,
    display_font: showCustomDisplay && customDisplayFont.trim() ? customDisplayFont.trim() : config.display_font,
    body_font: showCustomBody && customBodyFont.trim() ? customBodyFont.trim() : config.body_font,
  });

  const handleGeneratePreview = async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const { data, error } = await supabase.functions.invoke("preview-visual", {
        body: {
          config: buildCurrentConfig(),
          draftId: selectedDraftId === SAMPLE_OPTION_VALUE ? undefined : selectedDraftId,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setPreviewImage(data?.imageBase64 || null);
      setPreviewHtml(data?.html || null);
      if (!data?.imageBase64 && !data?.html) {
        setPreviewError("Preview generated but returned no content.");
      }
    } catch (err: any) {
      setPreviewError(err.message || "Preview failed");
      setPreviewImage(null);
      setPreviewHtml(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleAddRule = () => {
    if (!newRuleText.trim()) return;
    const rule: DesignRule = { id: Date.now().toString(), text: newRuleText.trim(), tag: newRuleTag };
    setConfig(c => ({ ...c, design_rules: [...c.design_rules, rule] }));
    setNewRuleText("");
  };

  const handleDeleteRule = (id: string) => {
    setConfig(c => ({ ...c, design_rules: c.design_rules.filter(r => r.id !== id) }));
  };

  const toggleVisualType = (id: string) => {
    setConfig(c => ({
      ...c,
      enabled_visual_types: c.enabled_visual_types.includes(id)
        ? c.enabled_visual_types.filter(t => t !== id)
        : [...c.enabled_visual_types, id],
    }));
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Please upload an image file"); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error("Image must be under 2 MB"); return; }
    setUploading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const filename = "logo-" + Date.now() + "." + file.name.split(".").pop();
      const path = "public/brand-assets/" + filename;
      let existingSha: string | undefined;
      try {
        const checkRes = await fetch(
          `https://api.github.com/repos/keyona-rerev/knowledge-loom-prismm/contents/${path}`,
          { headers: { Accept: "application/vnd.github+json" } }
        );
        if (checkRes.ok) { const ex = await checkRes.json(); existingSha = ex.sha; }
      } catch { /* new file */ }
      const body: Record<string, string> = { message: "feat: upload brand asset " + filename, content: base64 };
      if (existingSha) body.sha = existingSha;
      const res = await fetch(
        `https://api.github.com/repos/keyona-rerev/knowledge-loom-prismm/contents/${path}`,
        { method: "PUT", headers: { Accept: "application/vnd.github+json", "Content-Type": "application/json" }, body: JSON.stringify(body) }
      );
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || "GitHub upload failed"); }
      const liveUrl = `https://keyona-rerev.github.io/knowledge-loom-prismm/brand-assets/${filename}`;
      setConfig(c => ({ ...c, logo_url: liveUrl }));
      toast.success("Logo uploaded. Pages will rebuild in ~60 seconds.");
    } catch (err: any) {
      toast.error("Upload failed: " + err.message);
    } finally {
      setUploading(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { toast.error("Not logged in"); return; }
      const finalConfig = buildCurrentConfig();
      const { data: existing } = await supabase.from("profiles").select("id").eq("user_id", session.user.id).maybeSingle();
      const payload = { visual_studio_config: JSON.stringify(finalConfig) } as any;
      let error;
      if (existing) {
        ({ error } = await supabase.from("profiles").update(payload).eq("id", (existing as any).id));
      } else {
        ({ error } = await supabase.from("profiles").insert([{ ...payload, user_id: session.user.id }]));
      }
      if (error) throw error;
      // Once saved, this config is the permanent source for every future
      // generate-draft-visual call — there is no path back to the old
      // hardcoded prompt short of clearing visual_studio_config directly in
      // the database. No auto-revert, no silent reset.
      toast.success("Visual Studio saved. This is now the permanent source for every new graphic — no reverting.");
    } catch (err: any) {
      toast.error("Save failed: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (!confirm("Reset all Visual Studio settings to defaults? This won't save automatically — you'll still need to hit Save Visual Studio to make it permanent.")) return;
    setConfig(DEFAULT_CONFIG);
    setCustomDisplayFont(""); setCustomBodyFont("");
    setShowCustomDisplay(false); setShowCustomBody(false);
    toast.info("Reset to defaults. Save to apply.");
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

      <main className="container mx-auto px-4 py-8 max-w-3xl">
        <h1 className="text-3xl font-bold mb-1">Visual Studio</h1>
        <p className="text-sm text-muted-foreground mb-8">
          Controls how VisualForge generates graphics. Every setting is injected into the generation prompt and applied on the next Regenerate. No deploy needed. Nothing here becomes permanent until you hit Save — the preview below always reflects what's currently on screen, saved or not.
        </p>

        {/* LIVE PREVIEW */}
        <Card className="mb-6 border-purple-200 bg-purple-50/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ImageIcon className="h-5 w-5" />Preview</CardTitle>
            <CardDescription>
              See a real graphic generated from your current settings below — including anything you haven't saved yet — against a real post or the built-in sample.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
              <select
                className="flex-1 rounded-md border bg-muted px-3 py-2 text-sm text-foreground outline-none"
                value={selectedDraftId}
                onChange={e => setSelectedDraftId(e.target.value)}
              >
                <option value={SAMPLE_OPTION_VALUE}>Sample post (built-in, works even with no drafts)</option>
                {draftOptions.map(d => (
                  <option key={d.id} value={d.id}>{d.title || "Untitled draft"}</option>
                ))}
              </select>
              <Button onClick={handleGeneratePreview} disabled={previewLoading} className="shrink-0">
                <Sparkles className="h-4 w-4 mr-2" />
                {previewLoading ? "Generating..." : "Generate preview"}
              </Button>
            </div>

            <div
              className="rounded-md border overflow-hidden bg-white flex items-center justify-center"
              style={{ aspectRatio: `${config.canvas_width} / ${config.canvas_height}` }}
            >
              {previewLoading ? (
                <p className="text-sm text-muted-foreground">Generating a real graphic with these settings...</p>
              ) : previewImage ? (
                <img src={`data:image/png;base64,${previewImage}`} alt="Preview" className="w-full h-full object-contain" />
              ) : previewHtml ? (
                <iframe
                  title="Visual preview"
                  srcDoc={previewHtml}
                  className="w-full h-full border-0"
                  style={{ width: config.canvas_width, height: config.canvas_height, transform: "scale(1)" }}
                />
              ) : (
                <p className="text-sm text-muted-foreground px-4 text-center">
                  {previewError ? previewError : "Click Generate preview to see a real graphic with your current settings."}
                </p>
              )}
            </div>
            {previewError && previewImage === null && previewHtml === null && (
              <p className="text-xs text-red-600">{previewError}</p>
            )}
          </CardContent>
        </Card>

        {/* BRAND TOKENS */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Palette className="h-5 w-5" />Brand tokens</CardTitle>
            <CardDescription>Colors and fonts injected into every graphic prompt. Edit hex values directly.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                { key: "color_navy", label: "Navy · base" },
                { key: "color_coral", label: "Coral · accent" },
                { key: "color_purple", label: "Purple" },
                { key: "color_yellow", label: "Yellow" },
              ].map(({ key, label }) => (
                <div key={key} className="space-y-1">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">{label}</Label>
                  <div className="flex items-center gap-2 rounded-md border bg-muted px-3 py-2">
                    <div className="h-4 w-4 rounded-sm border flex-shrink-0" style={{ background: (config as any)[key] }} />
                    <input
                      className="flex-1 bg-transparent text-sm outline-none min-w-0 font-mono"
                      value={(config as any)[key]}
                      onChange={e => setConfig(c => ({ ...c, [key]: e.target.value }))}
                      maxLength={7}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t pt-5 space-y-5">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Display font</Label>
                <select
                  className="w-full rounded-md border bg-muted px-3 py-2 text-sm text-foreground outline-none"
                  value={showCustomDisplay ? "__custom__" : config.display_font}
                  onChange={e => {
                    if (e.target.value === "__custom__") { setShowCustomDisplay(true); }
                    else { setShowCustomDisplay(false); setConfig(c => ({ ...c, display_font: e.target.value })); }
                  }}
                >
                  {DISPLAY_FONTS.map(f => <option key={f.value} value={f.value}>{f.label} · {f.category}</option>)}
                  <option value="__custom__">+ Add custom font...</option>
                </select>
                {showCustomDisplay && (
                  <div className="flex gap-2">
                    <Input placeholder="Google Font name, e.g. Neue Haas Grotesk" value={customDisplayFont} onChange={e => setCustomDisplayFont(e.target.value)} className="text-sm" />
                    <Button variant="outline" size="sm" asChild>
                      <a href="https://fonts.google.com" target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3 w-3 mr-1" />Browse</a>
                    </Button>
                  </div>
                )}
                <div
                  className="rounded-md px-4 py-3 text-white text-xl leading-snug"
                  style={{ background: config.color_navy, fontFamily: `'${activeDisplayFont}', sans-serif`, fontWeight: displayWeight }}
                >
                  Half of deposits leave when children inherit.
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Body font</Label>
                <select
                  className="w-full rounded-md border bg-muted px-3 py-2 text-sm text-foreground outline-none"
                  value={showCustomBody ? "__custom__" : config.body_font}
                  onChange={e => {
                    if (e.target.value === "__custom__") { setShowCustomBody(true); }
                    else { setShowCustomBody(false); setConfig(c => ({ ...c, body_font: e.target.value })); }
                  }}
                >
                  {BODY_FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                  <option value="__custom__">+ Add custom font...</option>
                </select>
                {showCustomBody && (
                  <div className="flex gap-2">
                    <Input placeholder="Google Font name, e.g. Source Sans 3" value={customBodyFont} onChange={e => setCustomBodyFont(e.target.value)} className="text-sm" />
                    <Button variant="outline" size="sm" asChild>
                      <a href="https://fonts.google.com" target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3 w-3 mr-1" />Browse</a>
                    </Button>
                  </div>
                )}
                <div
                  className="rounded-md px-4 py-3 leading-relaxed"
                  style={{ background: config.color_navy, color: "rgba(255,255,255,0.85)", fontFamily: `'${activeBodyFont}', sans-serif`, fontWeight: "400", fontSize: "15px" }}
                >
                  The gap lives in the checking account, the CD ladder, the savings account tied to a beneficiary designation not reviewed in eleven years.
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* DESIGN RULES */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ListChecks className="h-5 w-5" />Design rules
              <Badge variant="secondary">{config.design_rules.length} active</Badge>
            </CardTitle>
            <CardDescription>Instructions read before every graphic is generated. Add rules about what to do and what to avoid.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {config.design_rules.map(rule => (
              <div key={rule.id} className="flex items-start gap-3 rounded-md border bg-muted/40 px-3 py-2.5">
                <GripVertical className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                <span className="flex-1 text-sm leading-relaxed">{rule.text}</span>
                <Badge
                  variant="outline"
                  className={rule.tag === "do"
                    ? "text-xs border-green-300 bg-green-50 text-green-700 flex-shrink-0 dark:bg-green-950/30 dark:text-green-400 dark:border-green-700"
                    : "text-xs border-orange-300 bg-orange-50 text-orange-700 flex-shrink-0 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-700"}
                >
                  {rule.tag}
                </Badge>
                <button onClick={() => handleDeleteRule(rule.id)} className="text-muted-foreground hover:text-destructive flex-shrink-0 mt-0.5" aria-label="Delete rule">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <div className="rounded-md border overflow-hidden mt-1">
              <Input
                placeholder="Write a rule..."
                value={newRuleText}
                onChange={e => setNewRuleText(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); handleAddRule(); } }}
                className="border-0 rounded-none text-sm focus-visible:ring-0 bg-muted/30"
              />
              <div className="flex items-center gap-2 px-3 py-2 border-t bg-muted/20">
                <span className="text-xs text-muted-foreground">Tag as:</span>
                <button
                  onClick={() => setNewRuleTag("do")}
                  className={`text-xs px-2 py-1 rounded border transition-colors ${newRuleTag === "do" ? "bg-green-50 text-green-700 border-green-300 dark:bg-green-950/30 dark:text-green-400 dark:border-green-700" : "border-border text-muted-foreground"}`}
                >Do</button>
                <button
                  onClick={() => setNewRuleTag("avoid")}
                  className={`text-xs px-2 py-1 rounded border transition-colors ${newRuleTag === "avoid" ? "bg-orange-50 text-orange-700 border-orange-300 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-700" : "border-border text-muted-foreground"}`}
                >Avoid</button>
                <span className="text-xs text-muted-foreground flex-1">Shift+Enter to add</span>
                <Button size="sm" onClick={handleAddRule} className="h-7 text-xs">
                  <Plus className="h-3 w-3 mr-1" />Add
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* CANVAS & LOGO */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Ruler className="h-5 w-5" />Canvas & logo</CardTitle>
            <CardDescription>Output size and logo. Upload a replacement and it is hosted on GitHub Pages automatically.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4 rounded-md border bg-muted/30 p-3">
              <div
                className="w-20 h-10 rounded flex items-center justify-center text-xs font-medium tracking-widest flex-shrink-0"
                style={{ background: config.color_navy, color: config.color_yellow }}
              >LOGO</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Current logo</p>
                <p className="text-xs text-muted-foreground truncate mt-0.5">{config.logo_url}</p>
              </div>
              <div>
                <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                <Button variant="outline" size="sm" disabled={uploading} onClick={() => logoInputRef.current?.click()}>
                  <Upload className="h-3 w-3 mr-1" />{uploading ? "Uploading..." : "Replace"}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Uploaded images go to <code>public/brand-assets/</code> in the repo and are served from GitHub Pages. Rebuild takes about 60 seconds.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">Canvas size (px)</Label>
                <div className="flex items-center gap-2">
                  <div className="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground flex-1 text-center">{config.canvas_width}</div>
                  <span className="text-muted-foreground text-sm">x</span>
                  <div className="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground flex-1 text-center">{config.canvas_height}</div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">LinkedIn</span>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">Logo min-height (px)</Label>
                <input
                  type="number" min={24} max={120}
                  className="w-24 rounded-md border bg-muted px-3 py-2 text-sm outline-none"
                  value={config.logo_min_height}
                  onChange={e => setConfig(c => ({ ...c, logo_min_height: Number(e.target.value) }))}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* VISUAL TYPES */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><LayoutGrid className="h-5 w-5" />Visual types</CardTitle>
            <CardDescription>Toggle which types the AI can choose from. Disabled types are removed from the prompt entirely — these 4 are the only types the AI actually knows how to produce.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {ALL_VISUAL_TYPES.map(vt => {
                const enabled = config.enabled_visual_types.includes(vt.id);
                return (
                  <button
                    key={vt.id}
                    onClick={() => toggleVisualType(vt.id)}
                    className={`flex items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-colors ${enabled ? "border-purple-300 bg-purple-50/60 dark:bg-purple-950/20 dark:border-purple-700" : "border-border bg-background hover:bg-muted/40"}`}
                  >
                    <div className="flex-1">
                      <p className={`text-sm font-medium ${enabled ? "text-purple-800 dark:text-purple-200" : ""}`}>{vt.label}</p>
                      <p className={`text-xs mt-0.5 ${enabled ? "text-purple-600 dark:text-purple-400" : "text-muted-foreground"}`}>{vt.desc}</p>
                    </div>
                    <div className={`relative w-8 h-4 rounded-full mt-1 flex-shrink-0 transition-colors ${enabled ? "bg-purple-500" : "bg-muted-foreground/30"}`}>
                      <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${enabled ? "right-0.5" : "left-0.5"}`} />
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* FOOTER */}
        <div className="flex items-center justify-between pt-2 pb-8">
          <Button variant="ghost" onClick={handleReset} className="text-muted-foreground">
            <RotateCcw className="h-4 w-4 mr-2" />Reset all to defaults
          </Button>
          <Button onClick={handleSave} disabled={saving} size="lg">
            {saving ? "Saving..." : "Save Visual Studio"}
          </Button>
        </div>
      </main>
    </div>
  );
};

export default VisualStudio;
