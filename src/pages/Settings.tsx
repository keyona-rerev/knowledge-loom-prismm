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
import { ArrowLeft, Plus, Trash2, Moon, Sun, AlertTriangle, Mail, Shield, Loader2 } from "lucide-react";
import { useTheme } from "next-themes";

const AI_PROVIDERS = [
  { value: "anthropic", label: "Claude (Anthropic)", keyLabel: "Anthropic API Key", keyPlaceholder: "sk-ant-...", modelPlaceholder: "claude-sonnet-4-20250514", docsUrl: "https://console.anthropic.com/settings/keys", docsLabel: "console.anthropic.com" },
  { value: "google-ai", label: "Gemini (Google AI)", keyLabel: "Google AI API Key", keyPlaceholder: "AIza...", modelPlaceholder: "gemini-2.0-flash-exp", docsUrl: "https://aistudio.google.com/app/apikey", docsLabel: "aistudio.google.com" },
  { value: "openai", label: "OpenAI (GPT)", keyLabel: "OpenAI API Key", keyPlaceholder: "sk-...", modelPlaceholder: "gpt-4o", docsUrl: "https://platform.openai.com/api-keys", docsLabel: "platform.openai.com" },
  { value: "grok", label: "Grok (xAI)", keyLabel: "xAI API Key", keyPlaceholder: "xai-...", modelPlaceholder: "grok-3", docsUrl: "https://console.x.ai", docsLabel: "console.x.ai" },
  { value: "deepseek", label: "DeepSeek", keyLabel: "DeepSeek API Key", keyPlaceholder: "sk-...", modelPlaceholder: "deepseek-chat", docsUrl: "https://platform.deepseek.com", docsLabel: "platform.deepseek.com" },
  { value: "custom", label: "Custom (OpenAI-compatible)", keyLabel: "API Key", keyPlaceholder: "Your API key", modelPlaceholder: "your-model-name", docsUrl: "", docsLabel: "" },
];

const Settings = () => {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [deletingData, setDeletingData] = useState(false);
  const [profile, setProfile] = useState({
    business_name: "",
    business_description: "",
    target_audience: "",
    brand_voice: "",
    primary_color: "#f9655b",
    secondary_color: "#6658ea",
    accent_color: "#f5c070",
    ai_provider: "anthropic",
    ai_model: "claude-sonnet-4-20250514",
    ai_api_key: "",
    ai_endpoint: "",
    writing_examples: [] as string[],
    content_type_templates: [] as Array<{id: string, name: string, prompt: string}>,
  });

  const currentProvider = AI_PROVIDERS.find(p => p.value === profile.ai_provider) || AI_PROVIDERS[0];

  useEffect(() => {
    const loadProfile = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/auth"); return; }

      const { data, error } = await supabase.from("profiles").select("*").eq("user_id", session.user.id).maybeSingle();

      if (data) {
        setProfile({
          business_name: data.business_name || "",
          business_description: data.business_description || "",
          target_audience: data.target_audience || "",
          brand_voice: data.brand_voice || "",
          primary_color: data.primary_color || "#f9655b",
          secondary_color: data.secondary_color || "#6658ea",
          accent_color: data.accent_color || "#f5c070",
          ai_provider: data.ai_provider || "anthropic",
          ai_model: data.ai_model || "claude-sonnet-4-20250514",
          ai_api_key: data.ai_api_key || "",
          ai_endpoint: data.ai_endpoint || "",
          writing_examples: Array.isArray(data.writing_examples)
            ? data.writing_examples.filter((ex): ex is string => typeof ex === 'string')
            : [],
          content_type_templates: Array.isArray(data.content_type_templates)
            ? data.content_type_templates as Array<{id: string, name: string, prompt: string}>
            : [],
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
    if (!session) { toast.error("You must be logged in to save settings"); setLoading(false); return; }

    const { data: existingProfile } = await supabase.from("profiles").select("id").eq("user_id", session.user.id).maybeSingle();

    let error;
    if (existingProfile) {
      const result = await supabase.from("profiles").update(profile).eq("id", existingProfile.id);
      error = result.error;
    } else {
      const result = await supabase.from("profiles").insert([{ ...profile, user_id: session.user.id }]);
      error = result.error;
    }

    if (error) { toast.error("Failed to save settings: " + error.message); } else { toast.success("Settings saved"); }
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

        {/* Writing Style */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Writing Style & Voice Training</CardTitle>
            <CardDescription>Provide up to 4 examples of your writing so AI can match your tone and style</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <InstructionsToggle instructions={`**Training AI to Match Your Voice**\n\nThe AI uses these examples to understand your writing style, tone, and vocabulary.\n\nBest practices:\n• Provide 2-4 diverse examples (different topics, same voice)\n• Use 200-500 words per example\n• Choose your best, most representative writing`} />
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor={`example-${index}`}>Writing Example {index + 1} {index < 2 && "(Recommended)"}</Label>
                  {profile.writing_examples[index] && (
                    <Button variant="ghost" size="sm" onClick={() => { const e = [...profile.writing_examples]; e[index] = ""; setProfile(prev => ({ ...prev, writing_examples: e })); }}>Clear</Button>
                  )}
                </div>
                <Textarea
                  id={`example-${index}`}
                  value={profile.writing_examples[index] || ""}
                  onChange={(e) => { const ex = [...profile.writing_examples]; ex[index] = e.target.value; setProfile(prev => ({ ...prev, writing_examples: ex })); }}
                  placeholder="Paste a sample of your writing here (200-500 words recommended)..."
                  rows={6}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">{profile.writing_examples[index]?.length || 0} characters</p>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Content Type Templates */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Content Type Templates</CardTitle>
            <CardDescription>Define what makes great content for each format</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <InstructionsToggle instructions={`**Content Type Templates**\n\nThese templates teach the AI what constitutes each content format:\n• STRUCTURE: How should content be organized?\n• TONE: What voice/style should be used?\n• REQUIREMENTS: What must be included?`} />
            {profile.content_type_templates.map((template, index) => (
              <div key={template.id} className="space-y-3 p-4 border rounded-lg">
                <div className="flex items-center justify-between">
                  <div className="flex-1 grid grid-cols-2 gap-3">
                    <div>
                      <Label>Template Name</Label>
                      <Input value={template.name} onChange={(e) => { const t = [...profile.content_type_templates]; t[index].name = e.target.value; setProfile(prev => ({ ...prev, content_type_templates: t })); }} placeholder="e.g., LinkedIn Post" />
                    </div>
                    <div>
                      <Label>Template ID (read-only)</Label>
                      <Input value={template.id} readOnly disabled className="bg-muted cursor-not-allowed" />
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => { const t = profile.content_type_templates.filter((_, i) => i !== index); setProfile(prev => ({ ...prev, content_type_templates: t })); }} className="ml-2">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div>
                  <Label>Content Guidelines & Instructions</Label>
                  <Textarea value={template.prompt} onChange={(e) => { const t = [...profile.content_type_templates]; t[index].prompt = e.target.value; setProfile(prev => ({ ...prev, content_type_templates: t })); }} placeholder="Describe structure, tone, length, required elements..." rows={8} className="text-sm" />
                </div>
              </div>
            ))}
            <Button variant="outline" onClick={() => { const t = [...profile.content_type_templates, { id: `custom_${Date.now()}`, name: "New Template", prompt: "" }]; setProfile(prev => ({ ...prev, content_type_templates: t })); }} className="w-full">
              <Plus className="h-4 w-4 mr-2" />Add Custom Content Type
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
              <Input
                type="password"
                placeholder={currentProvider.keyPlaceholder}
                value={profile.ai_api_key}
                onChange={(e) => setProfile(prev => ({ ...prev, ai_api_key: e.target.value }))}
              />
              {currentProvider.docsUrl && (
                <p className="text-sm text-muted-foreground">
                  Get your key at:{" "}
                  <a href={currentProvider.docsUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    {currentProvider.docsLabel}
                  </a>
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-base font-semibold">Model</Label>
              <Input
                placeholder={currentProvider.modelPlaceholder}
                value={profile.ai_model}
                onChange={(e) => setProfile(prev => ({ ...prev, ai_model: e.target.value }))}
              />
              <p className="text-sm text-muted-foreground">Enter the exact model string for your provider.</p>
            </div>

            {profile.ai_provider === "custom" && (
              <div className="space-y-2">
                <Label className="text-base font-semibold">Custom Endpoint URL</Label>
                <Input
                  placeholder="https://api.example.com/v1/chat/completions"
                  value={profile.ai_endpoint || ""}
                  onChange={(e) => setProfile(prev => ({ ...prev, ai_endpoint: e.target.value }))}
                />
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
                  } catch (err) {
                    toast.error("Failed to delete data");
                  } finally {
                    setDeletingData(false);
                  }
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
