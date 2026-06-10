import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { InstructionsToggle } from "@/components/InstructionsToggle";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, Moon, Sun, AlertTriangle, Mail, Shield, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { useTheme } from "next-themes";

const AI_PROVIDERS = [
  { value: "anthropic", label: "Claude (Anthropic)", keyLabel: "Anthropic API Key", keyPlaceholder: "sk-ant-...", modelPlaceholder: "claude-sonnet-4-20250514", docsUrl: "https://console.anthropic.com/settings/keys", docsLabel: "console.anthropic.com" },
  { value: "google-ai", label: "Gemini (Google AI)", keyLabel: "Google AI API Key", keyPlaceholder: "AIza...", modelPlaceholder: "gemini-2.0-flash-exp", docsUrl: "https://aistudio.google.com/app/apikey", docsLabel: "aistudio.google.com" },
  { value: "openai", label: "OpenAI (GPT)", keyLabel: "OpenAI API Key", keyPlaceholder: "sk-...", modelPlaceholder: "gpt-4o", docsUrl: "https://platform.openai.com/api-keys", docsLabel: "platform.openai.com" },
  { value: "grok", label: "Grok (xAI)", keyLabel: "xAI API Key", keyPlaceholder: "xai-...", modelPlaceholder: "grok-3", docsUrl: "https://console.x.ai", docsLabel: "console.x.ai" },
  { value: "deepseek", label: "DeepSeek", keyLabel: "DeepSeek API Key", keyPlaceholder: "sk-...", modelPlaceholder: "deepseek-chat", docsUrl: "https://platform.deepseek.com", docsLabel: "platform.deepseek.com" },
  { value: "custom", label: "Custom (OpenAI-compatible)", keyLabel: "API Key", keyPlaceholder: "Your API key", modelPlaceholder: "your-model-name", docsUrl: "", docsLabel: "" },
];

const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const FREQUENCIES = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Bi-weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "as_needed", label: "As needed" },
];

export interface ContentTypeTemplate {
  id: string;
  name: string;
  prompt: string;
  // Per-type writing samples (up to 3)
  writing_samples: string[];
  // Reuse config
  requires_child: boolean;
  child_content_type_id: string;
  max_reuse_count: number;
  reuse_window_days: number;
}

const DEFAULT_TEMPLATE: Omit<ContentTypeTemplate, "id" | "name"> = {
  prompt: "",
  writing_samples: [],
  requires_child: false,
  child_content_type_id: "",
  max_reuse_count: 0,
  reuse_window_days: 90,
};

const Settings = () => {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [deletingData, setDeletingData] = useState(false);
  const [expandedTemplates, setExpandedTemplates] = useState<Record<string, boolean>>({});
  const [profile, setProfile] = useState({
    business_name: "",
    business_description: "",
    target_audience: "",
    brand_voice: "",
    primary_color: "#6366f1",
    secondary_color: "#8b5cf6",
    accent_color: "#06b6d4",
    ai_provider: "anthropic",
    ai_model: "claude-sonnet-4-20250514",
    ai_api_key: "",
    ai_endpoint: "",
    content_type_templates: [] as ContentTypeTemplate[],
  });

  const currentProvider = AI_PROVIDERS.find(p => p.value === profile.ai_provider) || AI_PROVIDERS[0];

  const updateTemplate = (index: number, field: keyof ContentTypeTemplate, value: any) => {
    const t = [...profile.content_type_templates];
    (t[index] as any)[field] = value;
    setProfile(prev => ({ ...prev, content_type_templates: t }));
  };

  const updateWritingSample = (templateIndex: number, sampleIndex: number, value: string) => {
    const t = [...profile.content_type_templates];
    const samples = [...(t[templateIndex].writing_samples || [])];
    samples[sampleIndex] = value;
    t[templateIndex].writing_samples = samples;
    setProfile(prev => ({ ...prev, content_type_templates: t }));
  };

  useEffect(() => {
    const loadProfile = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/auth"); return; }
      const { data, error } = await supabase.from("profiles").select("*").eq("user_id", session.user.id).maybeSingle();
      if (data) {
        const rawTemplates = Array.isArray(data.content_type_templates) ? data.content_type_templates : [];
        // Migrate any existing templates that lack the new fields
        const migratedTemplates: ContentTypeTemplate[] = rawTemplates.map((t: any) => ({
          id: t.id || `custom_${Date.now()}`,
          name: t.name || "",
          prompt: t.prompt || "",
          writing_samples: Array.isArray(t.writing_samples) ? t.writing_samples : [],
          requires_child: t.requires_child || false,
          child_content_type_id: t.child_content_type_id || "",
          max_reuse_count: t.max_reuse_count ?? 0,
          reuse_window_days: t.reuse_window_days ?? 90,
        }));
        setProfile({
          business_name: data.business_name || "",
          business_description: data.business_description || "",
          target_audience: data.target_audience || "",
          brand_voice: data.brand_voice || "",
          primary_color: data.primary_color || "#6366f1",
          secondary_color: data.secondary_color || "#8b5cf6",
          accent_color: data.accent_color || "#06b6d4",
          ai_provider: data.ai_provider || "anthropic",
          ai_model: data.ai_model || "claude-sonnet-4-20250514",
          ai_api_key: data.ai_api_key || "",
          ai_endpoint: data.ai_endpoint || "",
          content_type_templates: migratedTemplates,
        });
      } else if (error && error.code !== "PGRST116") {
        toast.error("Failed to load profile");
      }
    };
    loadProfile();
  }, []);

  const handleSave = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { toast.error("You must be logged in"); setLoading(false); return; }
    const { data: existingProfile } = await supabase.from("profiles").select("id").eq("user_id", session.user.id).maybeSingle();
    let error;
    if (existingProfile) {
      ({ error } = await supabase.from("profiles").update(profile).eq("id", existingProfile.id));
    } else {
      ({ error } = await supabase.from("profiles").insert([{ ...profile, user_id: session.user.id }]));
    }
    if (error) { toast.error("Failed to save: " + error.message); } else { toast.success("Settings saved"); }
    setLoading(false);
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
        <h1 className="text-3xl font-bold mb-8">Settings</h1>

        {/* Business Information */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Business Information</CardTitle>
            <CardDescription>This information helps AI understand your audience and brand</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="business-name">Business Name</Label>
              <Input id="business-name" value={profile.business_name} onChange={(e) => setProfile(prev => ({ ...prev, business_name: e.target.value }))} placeholder="Your company name" />
            </div>
            <div>
              <Label htmlFor="business-desc">Business Description</Label>
              <Textarea id="business-desc" value={profile.business_description} onChange={(e) => setProfile(prev => ({ ...prev, business_description: e.target.value }))} placeholder="What does your business do?" rows={3} />
            </div>
            <div>
              <Label htmlFor="target-audience">Target Audience</Label>
              <Textarea id="target-audience" value={profile.target_audience} onChange={(e) => setProfile(prev => ({ ...prev, target_audience: e.target.value }))} placeholder="Describe your ideal readers/customers" rows={3} />
            </div>
            <div>
              <Label htmlFor="brand-voice">Brand Voice</Label>
              <Textarea id="brand-voice" value={profile.brand_voice} onChange={(e) => setProfile(prev => ({ ...prev, brand_voice: e.target.value }))} placeholder="Professional, casual, authoritative, etc." rows={2} />
            </div>
          </CardContent>
        </Card>

        {/* Appearance */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>Customize how the app looks</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="dark-mode" className="text-base">Dark Mode</Label>
                <p className="text-sm text-muted-foreground">Toggle between light and dark theme</p>
              </div>
              <div className="flex items-center gap-2">
                {theme === "dark" ? <Moon className="h-4 w-4 text-muted-foreground" /> : <Sun className="h-4 w-4 text-muted-foreground" />}
                <Switch id="dark-mode" checked={theme === "dark"} onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Colors & Branding */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Colors & Branding</CardTitle>
            <CardDescription>Customize your app's color scheme</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(["primary", "secondary", "accent"] as const).map((colorKey) => (
              <div key={colorKey}>
                <Label htmlFor={`${colorKey}-color`}>{colorKey.charAt(0).toUpperCase() + colorKey.slice(1)} Color</Label>
                <div className="flex items-center gap-3 mt-2">
                  <Input id={`${colorKey}-color`} type="color" value={profile[`${colorKey}_color`]} onChange={(e) => setProfile(prev => ({ ...prev, [`${colorKey}_color`]: e.target.value }))} className="w-20 h-10 cursor-pointer" />
                  <Input type="text" value={profile[`${colorKey}_color`]} onChange={(e) => setProfile(prev => ({ ...prev, [`${colorKey}_color`]: e.target.value }))} className="flex-1" />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Content Type Templates */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Content Types</CardTitle>
            <CardDescription>Define each content format, its writing samples, and its reuse behavior. These drive every generation and scheduling decision in the system.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <InstructionsToggle instructions={`**Content Types are the engine of the system.**\n\nEach type has:\n• Format guidelines — structure, tone, length requirements\n• Writing samples (up to 3) — examples specific to this format so AI matches your voice accurately\n• Reuse config — whether published pieces of this type should generate new child posts over time, and how many times\n• Child type — which format the child post should be\n\nAll decisions here are saved and used every time the system generates or schedules content.`} />

            {profile.content_type_templates.map((template, index) => {
              const isExpanded = expandedTemplates[template.id] ?? false;
              const otherTypes = profile.content_type_templates.filter(t => t.id !== template.id);

              return (
                <div key={template.id} className="border rounded-lg overflow-hidden">
                  {/* Collapsed header */}
                  <div
                    className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50"
                    onClick={() => setExpandedTemplates(prev => ({ ...prev, [template.id]: !isExpanded }))}
                  >
                    <div className="flex items-center gap-3">
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      <span className="font-medium">{template.name || "Unnamed type"}</span>
                      <span className="text-xs text-muted-foreground font-mono">{template.id}</span>
                      {template.requires_child && template.child_content_type_id && (
                        <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                          Generates child
                        </span>
                      )}
                      {template.max_reuse_count > 0 && (
                        <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                          Reuse ×{template.max_reuse_count}
                        </span>
                      )}
                    </div>
                    <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); const t = profile.content_type_templates.filter((_, i) => i !== index); setProfile(prev => ({ ...prev, content_type_templates: t })); }}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Expanded body */}
                  {isExpanded && (
                    <div className="p-4 pt-0 border-t space-y-5">

                      {/* Name + ID */}
                      <div className="grid grid-cols-2 gap-3 pt-4">
                        <div>
                          <Label>Type Name</Label>
                          <Input value={template.name} onChange={(e) => updateTemplate(index, "name", e.target.value)} placeholder="e.g., LinkedIn Article" />
                        </div>
                        <div>
                          <Label>Type ID (read-only)</Label>
                          <Input value={template.id} readOnly disabled className="bg-muted cursor-not-allowed font-mono text-xs" />
                        </div>
                      </div>

                      {/* Format guidelines */}
                      <div>
                        <Label>Format Guidelines</Label>
                        <p className="text-xs text-muted-foreground mb-2">Structure, tone, length, required elements. This is injected into every generation for this type.</p>
                        <Textarea
                          value={template.prompt}
                          onChange={(e) => updateTemplate(index, "prompt", e.target.value)}
                          placeholder="Describe structure, tone, length, required elements..."
                          rows={6}
                          className="text-sm"
                        />
                      </div>

                      {/* Writing samples */}
                      <div>
                        <Label>Writing Samples (up to 3)</Label>
                        <p className="text-xs text-muted-foreground mb-3">Examples specific to this format. The AI uses these to match your voice for this content type only.</p>
                        {[0, 1, 2].map((sampleIndex) => (
                          <div key={sampleIndex} className="mb-3">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs text-muted-foreground">Sample {sampleIndex + 1}{sampleIndex === 0 ? " (recommended)" : ""}</span>
                              {template.writing_samples?.[sampleIndex] && (
                                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => updateWritingSample(index, sampleIndex, "")}>Clear</Button>
                              )}
                            </div>
                            <Textarea
                              value={template.writing_samples?.[sampleIndex] || ""}
                              onChange={(e) => updateWritingSample(index, sampleIndex, e.target.value)}
                              placeholder="Paste an example of this content type in your voice..."
                              rows={4}
                              className="font-mono text-xs"
                            />
                            <p className="text-xs text-muted-foreground mt-1">{(template.writing_samples?.[sampleIndex] || "").length} characters</p>
                          </div>
                        ))}
                      </div>

                      {/* Reuse config */}
                      <div className="border rounded-md p-4 space-y-4 bg-muted/30">
                        <div>
                          <p className="text-sm font-medium mb-1">Content Reuse</p>
                          <p className="text-xs text-muted-foreground">When a piece of this type is published and approved, how many times should it be resurfaced with a new child post? Set to 0 to disable reuse.</p>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label>Max reuses per piece</Label>
                            <Input
                              type="number"
                              min={0}
                              max={20}
                              value={template.max_reuse_count}
                              onChange={(e) => updateTemplate(index, "max_reuse_count", parseInt(e.target.value) || 0)}
                            />
                            <p className="text-xs text-muted-foreground mt-1">0 = no reuse</p>
                          </div>
                          <div>
                            <Label>Reuse window (days)</Label>
                            <Input
                              type="number"
                              min={1}
                              max={365}
                              value={template.reuse_window_days}
                              onChange={(e) => updateTemplate(index, "reuse_window_days", parseInt(e.target.value) || 90)}
                              disabled={template.max_reuse_count === 0}
                            />
                            <p className="text-xs text-muted-foreground mt-1">Days after publish to stay eligible</p>
                          </div>
                        </div>

                        <div className="flex items-center justify-between">
                          <div>
                            <Label>Requires a child post</Label>
                            <p className="text-xs text-muted-foreground mt-0.5">Generate a corresponding post every time this type is created or reused</p>
                          </div>
                          <Switch
                            checked={template.requires_child}
                            onCheckedChange={(checked) => updateTemplate(index, "requires_child", checked)}
                          />
                        </div>

                        {template.requires_child && (
                          <div>
                            <Label>Child content type</Label>
                            <Select
                              value={template.child_content_type_id}
                              onValueChange={(value) => updateTemplate(index, "child_content_type_id", value)}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select which type the child should be" />
                              </SelectTrigger>
                              <SelectContent>
                                {otherTypes.map(t => (
                                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground mt-1">The child will be generated as this type, using that type's guidelines and writing samples.</p>
                          </div>
                        )}
                      </div>

                    </div>
                  )}
                </div>
              );
            })}

            <Button
              variant="outline"
              onClick={() => {
                const newId = `type_${Date.now()}`;
                const t = [...profile.content_type_templates, { id: newId, name: "", ...DEFAULT_TEMPLATE }];
                setProfile(prev => ({ ...prev, content_type_templates: t }));
                setExpandedTemplates(prev => ({ ...prev, [newId]: true }));
              }}
              className="w-full"
            >
              <Plus className="h-4 w-4 mr-2" />Add Content Type
            </Button>
          </CardContent>
        </Card>

        {/* AI Provider Configuration */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>AI Provider Configuration</CardTitle>
            <CardDescription>Configure which AI model powers your content generation. Switch providers any time — no code changes needed.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-base font-semibold">Provider</Label>
              <Select value={profile.ai_provider} onValueChange={(value) => setProfile(prev => ({ ...prev, ai_provider: value }))}>
                <SelectTrigger><SelectValue placeholder="Select AI provider" /></SelectTrigger>
                <SelectContent>
                  {AI_PROVIDERS.map(p => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-base font-semibold">{currentProvider.keyLabel}</Label>
              <Input type="password" placeholder={currentProvider.keyPlaceholder} value={profile.ai_api_key} onChange={(e) => setProfile(prev => ({ ...prev, ai_api_key: e.target.value }))} />
              {currentProvider.docsUrl && (
                <p className="text-sm text-muted-foreground">Get your key at: <a href={currentProvider.docsUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{currentProvider.docsLabel}</a></p>
              )}
            </div>
            <div className="space-y-2">
              <Label className="text-base font-semibold">Model</Label>
              <Input placeholder={currentProvider.modelPlaceholder} value={profile.ai_model} onChange={(e) => setProfile(prev => ({ ...prev, ai_model: e.target.value }))} />
              <p className="text-sm text-muted-foreground">Enter the exact model string for your provider.</p>
            </div>
            {profile.ai_provider === "custom" && (
              <div className="space-y-2">
                <Label className="text-base font-semibold">Custom Endpoint URL</Label>
                <Input placeholder="https://api.example.com/v1/chat/completions" value={profile.ai_endpoint || ""} onChange={(e) => setProfile(prev => ({ ...prev, ai_endpoint: e.target.value }))} />
                <p className="text-sm text-muted-foreground">Must be an OpenAI-compatible chat completions endpoint.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Newsletter Configuration */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />Newsletter Intake
            </CardTitle>
            <CardDescription>How newsletters are captured into your reference cards</CardDescription>
          </CardHeader>
          <CardContent>
            <Alert>
              <AlertDescription className="space-y-2">
                <p>Newsletters are captured automatically through Gmail using the Knowledge Loom label system.</p>
                <p className="text-sm text-muted-foreground">
                  To add a newsletter: open it in Gmail, apply the <strong>loom-queue</strong> label, and it will appear as a reference card within 5 minutes. To process newsletters automatically going forward, set up a Gmail filter that applies <strong>loom-queue</strong> to emails from your chosen senders.
                </p>
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>

        {/* Privacy & Data Management */}
        <Card className="mb-6 border-destructive/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />Privacy & Data Management
            </CardTitle>
            <CardDescription>Manage your newsletter data and privacy settings</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-base font-semibold text-destructive">Delete Newsletter Data</Label>
              <p className="text-sm text-muted-foreground">Permanently deletes all newsletter-related data including received newsletter records and reference cards created from newsletters.</p>
              <Alert variant="destructive" className="mt-2">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>This action cannot be undone. Your other content will not be affected.</AlertDescription>
              </Alert>
              <Button
                variant="destructive"
                onClick={async () => {
                  if (!confirm("Are you sure you want to delete all your newsletter data?")) return;
                  setDeletingData(true);
                  try {
                    const { data, error } = await supabase.functions.invoke("delete-user-data");
                    if (error) { toast.error("Failed to delete data: " + error.message); } else { toast.success("Newsletter data deleted."); }
                  } catch (err) { toast.error("Failed to delete data"); }
                  finally { setDeletingData(false); }
                }}
                disabled={deletingData}
                className="mt-2"
              >
                {deletingData ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Deleting...</> : <><Trash2 className="h-4 w-4 mr-2" />Delete My Newsletter Data</>}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Button onClick={handleSave} disabled={loading} size="lg">
          {loading ? "Saving..." : "Save Settings"}
        </Button>
      </main>
    </div>
  );
};

export default Settings;
