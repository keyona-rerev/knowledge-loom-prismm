import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  ArrowLeft, Plus, Trash2, RotateCcw, Upload, GripVertical,
  Palette, ListChecks, Ruler, LayoutGrid, ImageIcon, Loader2
} from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────

const DISPLAY_FONTS = [
  { label: "Bricolage Grotesque", value: "Bricolage Grotesque", weight: "800", stack: "'Bricolage Grotesque', sans-serif" },
  { label: "Syne", value: "Syne", weight: "800", stack: "'Syne', sans-serif" },
  { label: "Space Grotesk", value: "Space Grotesk", weight: "700", stack: "'Space Grotesk', sans-serif" },
  { label: "Familjen Grotesk", value: "Familjen Grotesk", weight: "700", stack: "'Familjen Grotesk', sans-serif" },
  { label: "Cabinet Grotesk", value: "Cabinet Grotesk", weight: "800", stack: "'Cabinet Grotesk', sans-serif" },
  { label: "DM Serif Display", value: "DM Serif Display", weight: "400", stack: "'DM Serif Display', serif" },
  { label: "Playfair Display", value: "Playfair Display", weight: "800", stack: "'Playfair Display', serif" },
  { label: "Fraunces", value: "Fraunces", weight: "700", stack: "'Fraunces', serif" },
];

const BODY_FONTS = [
  { label: "Hanken Grotesk", value: "Hanken Grotesk", weight: "400", stack: "'Hanken Grotesk', sans-serif" },
  { label: "Inter", value: "Inter", weight: "400", stack: "'Inter', sans-serif" },
  { label: "Plus Jakarta Sans", value: "Plus Jakarta Sans", weight: "400", stack: "'Plus Jakarta Sans', sans-serif" },
  { label: "DM Sans", value: "DM Sans", weight: "400", stack: "'DM Sans', sans-serif" },
  { label: "Outfit", value: "Outfit", weight: "400", stack: "'Outfit', sans-serif" },
];

const VISUAL_TYPES = [
  { key: "stat_graphic", label: "Stat graphic", desc: "Hero number with minimal context" },
  { key: "quote_card", label: "Quote card", desc: "Pull quote in display type" },
  { key: "pillar_statement", label: "Pillar statement", desc: "Single ownable thesis, full bleed" },
  { key: "human_moment", label: "Human moment", desc: "Narrative-forward, warm tone" },
  { key: "comparison", label: "Comparison", desc: "Before/after or with/without Prismm" },
  { key: "timeline", label: "Timeline", desc: "Wealth transfer window and urgency" },
  { key: "checklist", label: "Checklist", desc: "Preparedness pillar, action-oriented" },
  { key: "branded_announcement", label: "Branded announcement", desc: "Product news, wordmark lockup" },
];

const DEFAULT_COLORS = {
  navy: "#1b2b45",
  coral: "#f9655b",
  purple: "#6658ea",
  yellow: "#f5c070",
};

const DEFAULT_RULES: { text: string; tag: "do" | "avoid" }[] = [
  { text: "NO pill labels, category tags, eyebrow text, or text in a rounded badge shape.", tag: "avoid" },
  { text: "NO card boxes, bordered containers, or frosted overlays around text.", tag: "avoid" },
  { text: "Logo must be visually prominent — bottom-left, minimum 56px height.", tag: "do" },
  { text: "Typography does the heavy lifting. Large type on a clean background is the brand.", tag: "do" },
  { text: "Whitespace is intentional. Generous margins. Nothing crammed.", tag: "do" },
  { text: "Color accents used sparingly as punctuation, not decoration.", tag: "do" },
];

const DEFAULT_ENABLED_TYPES = ["stat_graphic", "quote_card", "pillar_statement", "comparison", "checklist", "branded_announcement"];

const GOOGLE_FONTS_URL =
  "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@700;800&family=Syne:wght@700;800&family=DM+Serif+Display&family=Playfair+Display:wght@700;800&family=Cabinet+Grotesk:wght@700;800&family=Space+Grotesk:wght@700&family=Fraunces:wght@700&family=Familjen+Grotesk:wght@700&family=Hanken+Grotesk:wght@400;500&family=Inter:wght@400;500&family=Plus+Jakarta+Sans:wght@400;500&family=DM+Sans:wght@400;500&family=Outfit:wght@400;500&display=swap";

// ─── Component ────────────────────────────────────────────────────────────────

const VisualStudio = () => {
  const navigate = useNavigate();
  const [userId, setUserId] = useState("");
  const [profileId, setProfileId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Brand tokens
  const [colors, setColors] = useState({ ...DEFAULT_COLORS });
  const [displayFont, setDisplayFont] = useState("Bricolage Grotesque");
  const [displayFontCustom, setDisplayFontCustom] = useState("");
  const [bodyFont, setBodyFont] = useState("Hanken Grotesk");
  const [bodyFontCustom, setBodyFontCustom] = useState("");

  // Logo
  const [logoUrl, setLogoUrl] = useState(
    "https://res.cloudinary.com/dialhpycd/image/upload/v1772044659/prismm-logo-dark-bright_2x-removebg-preview_ut98x4.png"
  );
  const [logoMinHeight, setLogoMinHeight] = useState(56);

  // Design rules
  const [rules, setRules] = useState<{ text: string; tag: "do" | "avoid" }[]>([...DEFAULT_RULES]);
  const [newRuleText, setNewRuleText] = useState("");
  const [newRuleTag, setNewRuleTag] = useState<"do" | "avoid">("do");

  // Visual types
  const [enabledTypes, setEnabledTypes] = useState<string[]>([...DEFAULT_ENABLED_TYPES]);

  // Load Google Fonts
  useEffect(() => {
    if (!document.getElementById("vs-gfonts")) {
      const link = document.createElement("link");
      link.id = "vs-gfonts";
      link.rel = "stylesheet";
      link.href = GOOGLE_FONTS_URL;
      document.head.appendChild(link);
    }
  }, []);

  // Load saved profile
  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/auth"); return; }
      setUserId(session.user.id);

      const { data } = await supabase
        .from("profiles")
        .select("id, visual_studio_config")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (data) {
        setProfileId(data.id);
        const cfg = (data as any).visual_studio_config;
        if (cfg) {
          if (cfg.colors) setColors({ ...DEFAULT_COLORS, ...cfg.colors });
          if (cfg.displayFont) setDisplayFont(cfg.displayFont);
          if (cfg.displayFontCustom) setDisplayFontCustom(cfg.displayFontCustom);
          if (cfg.bodyFont) setBodyFont(cfg.bodyFont);
          if (cfg.bodyFontCustom) setBodyFontCustom(cfg.bodyFontCustom);
          if (cfg.logoUrl) setLogoUrl(cfg.logoUrl);
          if (cfg.logoMinHeight) setLogoMinHeight(cfg.logoMinHeight);
          if (cfg.rules) setRules(cfg.rules);
          if (cfg.enabledTypes) setEnabledTypes(cfg.enabledTypes);
        }
      }
    };
    load();
  }, [navigate]);

  // ─── Derived values ──────────────────────────────────────────────────────

  const activeDisplayFont =
    displayFont === "__custom__"
      ? DISPLAY_FONTS[0]
      : DISPLAY_FONTS.find(f => f.value === displayFont) ?? DISPLAY_FONTS[0];

  const activeBodyFont =
    bodyFont === "__custom__"
      ? BODY_FONTS[0]
      : BODY_FONTS.find(f => f.value === bodyFont) ?? BODY_FONTS[0];

  const displayPreviewFamily =
    displayFont === "__custom__" && displayFontCustom
      ? `'${displayFontCustom}', sans-serif`
      : activeDisplayFont.stack;

  const bodyPreviewFamily =
    bodyFont === "__custom__" && bodyFontCustom
      ? `'${bodyFontCustom}', sans-serif`
      : activeBodyFont.stack;

  // ─── Handlers ────────────────────────────────────────────────────────────

  const addRule = () => {
    const text = newRuleText.trim();
    if (!text) return;
    setRules(prev => [...prev, { text, tag: newRuleTag }]);
    setNewRuleText("");
  };

  const removeRule = (i: number) => setRules(prev => prev.filter((_, idx) => idx !== i));

  const toggleType = (key: string) =>
    setEnabledTypes(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowed = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];
    if (!allowed.includes(file.type)) {
      toast.error("Upload a PNG, JPG, SVG, or WebP file.");
      return;
    }

    setUploading(true);
    try {
      // Read as base64 for GitHub API
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const ext = file.name.split(".").pop() ?? "png";
      const filename = `logo-${Date.now()}.${ext}`;
      const repoPath = `public/brand-assets/${filename}`;

      // Commit to GitHub via API
      const ghRes = await fetch(
        `https://api.github.com/repos/keyona-rerev/knowledge-loom-prismm/contents/${repoPath}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: `brand: upload logo ${filename}`,
            content: base64,
          }),
        }
      );

      if (!ghRes.ok) {
        // GitHub API requires auth — surface a helpful message
        const err = await ghRes.json();
        throw new Error(err.message || "GitHub upload failed");
      }

      const newUrl = `https://keyona-rerev.github.io/knowledge-loom-prismm/brand-assets/${filename}`;
      setLogoUrl(newUrl);
      toast.success("Logo uploaded. Save to apply.");
    } catch (err: any) {
      // Logo upload via browser requires a GitHub token — guide the user
      toast.error(
        "Logo upload needs a GitHub token. Paste the Pages URL directly into the Logo URL field instead, or upload via Codespace."
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleReset = () => {
    setColors({ ...DEFAULT_COLORS });
    setDisplayFont("Bricolage Grotesque");
    setDisplayFontCustom("");
    setBodyFont("Hanken Grotesk");
    setBodyFontCustom("");
    setLogoUrl("https://res.cloudinary.com/dialhpycd/image/upload/v1772044659/prismm-logo-dark-bright_2x-removebg-preview_ut98x4.png");
    setLogoMinHeight(56);
    setRules([...DEFAULT_RULES]);
    setEnabledTypes([...DEFAULT_ENABLED_TYPES]);
    toast.info("Reset to defaults. Save to apply.");
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const cfg = {
        colors,
        displayFont,
        displayFontCustom,
        bodyFont,
        bodyFontCustom,
        logoUrl,
        logoMinHeight,
        rules,
        enabledTypes,
      };

      const payload = { visual_studio_config: cfg } as any;

      let error;
      if (profileId) {
        ({ error } = await supabase.from("profiles").update(payload).eq("id", profileId));
      } else {
        ({ error } = await supabase.from("profiles").insert([{ ...payload, user_id: userId }]));
      }

      if (error) throw error;
      toast.success("Visual Studio saved. Regenerate any graphic to apply.");
    } catch (err: any) {
      toast.error("Failed to save: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

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
          Controls how VisualForge generates graphics. Every setting here is injected into the generation prompt and applied on the next Regenerate. No deploy needed.
        </p>

        {/* ── Brand Tokens ─────────────────────────────────────────────── */}
        <Card className="mb-5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Palette className="h-4 w-4 text-muted-foreground" />Brand tokens
            </CardTitle>
            <CardDescription>Colors and fonts injected into every graphic prompt.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">

            {/* Colors */}
            <div className="grid grid-cols-2 gap-3">
              {(Object.entries(colors) as [keyof typeof colors, string][]).map(([key, val]) => (
                <div key={key} className="space-y-1">
                  <label className="text-xs uppercase tracking-wider text-muted-foreground">
                    {key === "navy" ? "Navy · base" : key === "coral" ? "Coral · accent" : key.charAt(0).toUpperCase() + key.slice(1)}
                  </label>
                  <div className="flex items-center gap-2 border rounded-md px-3 py-2 bg-muted/40">
                    <input
                      type="color"
                      value={val}
                      onChange={e => setColors(prev => ({ ...prev, [key]: e.target.value }))}
                      className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent p-0"
                      aria-label={`${key} color`}
                    />
                    <Input
                      value={val}
                      onChange={e => setColors(prev => ({ ...prev, [key]: e.target.value }))}
                      className="border-0 bg-transparent p-0 h-auto text-sm font-mono focus-visible:ring-0"
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t pt-5 space-y-5">
              {/* Display font */}
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-wider text-muted-foreground">Display font</label>
                <select
                  value={displayFont}
                  onChange={e => setDisplayFont(e.target.value)}
                  className="w-full rounded-md border border-input bg-muted/40 px-3 py-2 text-sm"
                >
                  {DISPLAY_FONTS.map(f => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                  <option value="__custom__">+ Add custom font...</option>
                </select>
                {displayFont === "__custom__" && (
                  <Input
                    value={displayFontCustom}
                    onChange={e => setDisplayFontCustom(e.target.value)}
                    placeholder="Google Font name, e.g. Neue Haas Grotesk"
                    className="text-sm"
                  />
                )}
                {/* Live preview on navy */}
                <div
                  className="rounded-md px-4 py-3 text-white text-xl leading-snug"
                  style={{
                    background: colors.navy,
                    fontFamily: displayPreviewFamily,
                    fontWeight: activeDisplayFont.weight,
                  }}
                >
                  Half of deposits leave when children inherit.
                </div>
              </div>

              {/* Body font */}
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-wider text-muted-foreground">Body font</label>
                <select
                  value={bodyFont}
                  onChange={e => setBodyFont(e.target.value)}
                  className="w-full rounded-md border border-input bg-muted/40 px-3 py-2 text-sm"
                >
                  {BODY_FONTS.map(f => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                  <option value="__custom__">+ Add custom font...</option>
                </select>
                {bodyFont === "__custom__" && (
                  <Input
                    value={bodyFontCustom}
                    onChange={e => setBodyFontCustom(e.target.value)}
                    placeholder="Google Font name, e.g. Source Sans 3"
                    className="text-sm"
                  />
                )}
                {/* Live preview on navy */}
                <div
                  className="rounded-md px-4 py-3 text-sm leading-relaxed"
                  style={{
                    background: colors.navy,
                    color: "rgba(255,255,255,0.85)",
                    fontFamily: bodyPreviewFamily,
                    fontWeight: activeBodyFont.weight,
                  }}
                >
                  The gap lives in the checking account, the CD ladder, the savings account tied to a beneficiary designation not reviewed in eleven years.
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Design Rules ─────────────────────────────────────────────── */}
        <Card className="mb-5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="h-4 w-4 text-muted-foreground" />
              Design rules
              <Badge variant="secondary" className="ml-1 text-xs">{rules.length} active</Badge>
            </CardTitle>
            <CardDescription>Instructions read before every graphic is generated. Add rules about what to do and what to avoid.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              {rules.map((rule, i) => (
                <div key={i} className="flex items-start gap-2 bg-muted/40 border rounded-md px-3 py-2">
                  <GripVertical className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <span className="text-sm flex-1 leading-relaxed">{rule.text}</span>
                  <Badge
                    variant="outline"
                    className={`text-xs flex-shrink-0 mt-0.5 ${
                      rule.tag === "do"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-orange-50 text-orange-700 border-orange-200"
                    }`}
                  >
                    {rule.tag}
                  </Badge>
                  <button
                    onClick={() => removeRule(i)}
                    className="text-muted-foreground hover:text-destructive flex-shrink-0 mt-0.5"
                    aria-label="Remove rule"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            {/* Add rule */}
            <div className="border rounded-md overflow-hidden">
              <Input
                value={newRuleText}
                onChange={e => setNewRuleText(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); addRule(); } }}
                placeholder="Write a rule..."
                className="border-0 rounded-none focus-visible:ring-0 bg-muted/40 text-sm"
              />
              <div className="flex items-center gap-2 px-3 py-2 border-t bg-muted/20">
                <span className="text-xs text-muted-foreground">Tag as:</span>
                <button
                  onClick={() => setNewRuleTag("do")}
                  className={`text-xs px-2 py-1 rounded border ${
                    newRuleTag === "do"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  Do
                </button>
                <button
                  onClick={() => setNewRuleTag("avoid")}
                  className={`text-xs px-2 py-1 rounded border ${
                    newRuleTag === "avoid"
                      ? "bg-orange-50 text-orange-700 border-orange-200"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  Avoid
                </button>
                <span className="text-xs text-muted-foreground flex-1">Shift+Enter to add</span>
                <Button size="sm" onClick={addRule} className="h-7 text-xs">
                  <Plus className="h-3 w-3 mr-1" />Add
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Canvas & Logo ─────────────────────────────────────────────── */}
        <Card className="mb-5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Ruler className="h-4 w-4 text-muted-foreground" />Canvas & logo
            </CardTitle>
            <CardDescription>Output size and logo configuration. Upload a new logo and it gets hosted on GitHub Pages.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Logo row */}
            <div className="flex items-center gap-3 bg-muted/40 border rounded-md p-3">
              <div
                className="w-20 h-10 rounded flex items-center justify-center text-xs font-semibold tracking-widest flex-shrink-0"
                style={{ background: colors.navy, color: colors.yellow }}
              >
                LOGO
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Logo</p>
                <p className="text-xs text-muted-foreground truncate mt-0.5">{logoUrl}</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                className="hidden"
                onChange={handleLogoUpload}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Upload className="h-3 w-3 mr-1" />}
                Replace
              </Button>
            </div>

            {/* Logo URL manual override */}
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wider text-muted-foreground">Logo URL (paste to override)</label>
              <Input
                value={logoUrl}
                onChange={e => setLogoUrl(e.target.value)}
                className="text-xs font-mono"
                placeholder="https://..."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs uppercase tracking-wider text-muted-foreground">Canvas size (px)</label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 border rounded-md px-3 py-2 text-sm text-center bg-muted/20 text-muted-foreground">1200</div>
                  <span className="text-muted-foreground text-sm">×</span>
                  <div className="flex-1 border rounded-md px-3 py-2 text-sm text-center bg-muted/20 text-muted-foreground">627</div>
                  <span className="text-xs text-muted-foreground">LinkedIn</span>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs uppercase tracking-wider text-muted-foreground">Logo min-height (px)</label>
                <Input
                  type="number"
                  value={logoMinHeight}
                  onChange={e => setLogoMinHeight(Number(e.target.value))}
                  className="text-sm"
                  min={24}
                  max={200}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Visual Types ─────────────────────────────────────────────── */}
        <Card className="mb-5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <LayoutGrid className="h-4 w-4 text-muted-foreground" />Visual types
            </CardTitle>
            <CardDescription>Toggle which types the AI can choose from. Disabled types are removed from the prompt entirely.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2">
              {VISUAL_TYPES.map(vt => {
                const on = enabledTypes.includes(vt.key);
                return (
                  <button
                    key={vt.key}
                    onClick={() => toggleType(vt.key)}
                    className={`flex items-start gap-3 text-left p-3 rounded-lg border transition-colors ${
                      on
                        ? "border-violet-300 bg-violet-50 dark:bg-violet-950/30 dark:border-violet-700"
                        : "border-border bg-background"
                    }`}
                  >
                    <div className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                      on ? "border-violet-500 bg-violet-500" : "border-muted-foreground"
                    }`}>
                      {on && <div className="w-2 h-2 rounded-full bg-white" />}
                    </div>
                    <div>
                      <p className={`text-sm font-medium ${on ? "text-violet-900 dark:text-violet-100" : "text-foreground"}`}>
                        {vt.label}
                      </p>
                      <p className={`text-xs mt-0.5 ${on ? "text-violet-600 dark:text-violet-300" : "text-muted-foreground"}`}>
                        {vt.desc}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* ── Save row ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between pt-2">
          <Button variant="ghost" size="sm" onClick={handleReset} className="text-muted-foreground">
            <RotateCcw className="h-3 w-3 mr-2" />Reset all to defaults
          </Button>
          <Button onClick={handleSave} disabled={saving} size="lg">
            {saving ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving...</> : "Save Visual Studio"}
          </Button>
        </div>
      </main>
    </div>
  );
};

export default VisualStudio;
