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

const Settings = () => {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [deletingData, setDeletingData] = useState(false);
  const [customModel, setCustomModel] = useState("");
  const [profile, setProfile] = useState({
    business_name: "",
    business_description: "",
    target_audience: "",
    brand_voice: "",
    primary_color: "#9b87f5",
    secondary_color: "#7E69AB",
    accent_color: "#6E59A5",
    ai_provider: "google-ai",
    ai_model: "gemini-2.5-flash-lite",
    google_ai_api_key: "",
    custom_ai_endpoint: "",
    custom_ai_model_name: "",
    writing_examples: [] as string[],
    content_type_templates: [] as Array<{id: string, name: string, prompt: string}>,
    newsletter_domain: ""
  });

  const FREE_MODELS = [
    { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite (Free — Recommended)" },
    { value: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview (Free)" },
    { value: "gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash-Lite Preview (Free)" },
  ];

  const isCustomModel = !FREE_MODELS.find(m => m.value === profile.ai_model);

  useEffect(() => {
    const loadProfile = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/auth");
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (data) {
        const loadedModel = data.ai_model || "gemini-2.5-flash-lite";
        const isKnownFreeModel = FREE_MODELS.find(m => m.value === loadedModel);
        if (!isKnownFreeModel) setCustomModel(loadedModel);

        setProfile({
          business_name: data.business_name || "",
          business_description: data.business_description || "",
          target_audience: data.target_audience || "",
          brand_voice: data.brand_voice || "",
          primary_color: data.primary_color || "#9b87f5",
          secondary_color: data.secondary_color || "#7E69AB",
          accent_color: data.accent_color || "#6E59A5",
          ai_provider: data.ai_provider || "google-ai",
          ai_model: loadedModel,
          google_ai_api_key: data.google_ai_api_key || "",
          custom_ai_endpoint: data.custom_ai_endpoint || "",
          custom_ai_model_name: data.custom_ai_model_name || "",
          writing_examples: Array.isArray(data.writing_examples)
            ? data.writing_examples.filter((ex): ex is string => typeof ex === 'string')
            : [],
          content_type_templates: Array.isArray(data.content_type_templates)
            ? data.content_type_templates as Array<{id: string, name: string, prompt: string}>
            : [],
          newsletter_domain: data.newsletter_domain || ""
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
    if (!session) {
      toast.error("You must be logged in to save settings");
      setLoading(false);
      return;
    }

    // If custom model is selected, use the custom model string
    const profileToSave = {
      ...profile,
      ai_model: isCustomModel ? customModel : profile.ai_model,
    };

    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("user_id", session.user.id)
      .maybeSingle();

    let error;
    if (existingProfile) {
      const result = await supabase
        .from("profiles")
        .update(profileToSave)
        .eq("id", existingProfile.id);
      error = result.error;
    } else {
      const result = await supabase
        .from("profiles")
        .insert([{ ...profileToSave, user_id: session.user.id }]);
      error = result.error;
    }

    if (error) {
      toast.error("Failed to save settings");
    } else {
      toast.success("Settings saved successfully");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <Button variant="ghost" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
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
              <Input
                id="business-name"
                value={profile.business_name}
                onChange={(e) => setProfile(prev => ({ ...prev, business_name: e.target.value }))}
                placeholder="Your company name"
              />
            </div>
            <div>
              <Label htmlFor="business-desc">Business Description</Label>
              <Textarea
                id="business-desc"
                value={profile.business_description}
                onChange={(e) => setProfile(prev => ({ ...prev, business_description: e.target.value }))}
                placeholder="What does your business do?"
                rows={3}
              />
            </div>
            <div>
              <Label htmlFor="target-audience">Target Audience</Label>
              <Textarea
                id="target-audience"
                value={profile.target_audience}
                onChange={(e) => setProfile(prev => ({ ...prev, target_audience: e.target.value }))}
                placeholder="Describe your ideal readers/customers"
                rows={3}
              />
            </div>
            <div>
              <Label htmlFor="brand-voice">Brand Voice</Label>
              <Textarea
                id="brand-voice"
                value={profile.brand_voice}
                onChange={(e) => setProfile(prev => ({ ...prev, brand_voice: e.target.value }))}
                placeholder="Professional, casual, authoritative, etc."
                rows={2}
              />
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
                {theme === "dark" ? (
                  <Moon className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Sun className="h-4 w-4 text-muted-foreground" />
                )}
                <Switch
                  id="dark-mode"
                  checked={theme === "dark"}
                  onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
                />
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
                <Label htmlFor={`${colorKey}-color`}>
                  {colorKey.charAt(0).toUpperCase() + colorKey.slice(1)} Color
                </Label>
                <div className="flex items-center gap-3 mt-2">
                  <Input
                    id={`${colorKey}-color`}
                    type="color"
                    value={profile[`${colorKey}_color`]}
                    onChange={(e) => setProfile(prev => ({ ...prev, [`${colorKey}_color`]: e.target.value }))}
                    className="w-20 h-10 cursor-pointer"
                  />
                  <Input
                    type="text"
                    value={profile[`${colorKey}_color`]}
                    onChange={(e) => setProfile(prev => ({ ...prev, [`${colorKey}_color`]: e.target.value }))}
                    className="flex-1"
                  />
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
            <InstructionsToggle
              instructions={`**Training AI to Match Your Voice**\n\nThe AI uses these examples to understand your:\n• Writing style and tone (formal, casual, conversational)\n• Sentence structure and flow\n• Vocabulary and word choice\n\nBest practices:\n• Provide 2-4 diverse examples (different topics but same voice)\n• Use 200-500 words per example\n• Choose your best, most representative writing`}
            />
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor={`example-${index}`}>
                    Writing Example {index + 1} {index < 2 && "(Recommended)"}
                  </Label>
                  {profile.writing_examples[index] && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const newExamples = [...profile.writing_examples];
                        newExamples[index] = "";
                        setProfile(prev => ({ ...prev, writing_examples: newExamples }));
                      }}
                    >
                      Clear
                    </Button>
                  )}
                </div>
                <Textarea
                  id={`example-${index}`}
                  value={profile.writing_examples[index] || ""}
                  onChange={(e) => {
                    const newExamples = [...profile.writing_examples];
                    newExamples[index] = e.target.value;
                    setProfile(prev => ({ ...prev, writing_examples: newExamples }));
                  }}
                  placeholder="Paste a sample of your writing here (200-500 words recommended)..."
                  rows={6}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  {profile.writing_examples[index]?.length || 0} characters
                </p>
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
            <InstructionsToggle
              instructions={`**Content Type Templates**\n\nThese templates teach the AI what constitutes each content format:\n• STRUCTURE: How should content be organized?\n• TONE: What voice/style should be used?\n• REQUIREMENTS: What must be included?\n\nExamples:\n• LinkedIn: Concise, 1300-1500 characters with hook and CTA\n• Blog Post: SEO-optimized, 1200-2000 words with headers`}
            />
            {profile.content_type_templates.map((template, index) => (
              <div key={template.id} className="space-y-3 p-4 border rounded-lg">
                <div className="flex items-center justify-between">
                  <div className="flex-1 grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor={`template-name-${index}`}>Template Name</Label>
                      <Input
                        id={`template-name-${index}`}
                        value={template.name}
                        onChange={(e) => {
                          const newTemplates = [...profile.content_type_templates];
                          newTemplates[index].name = e.target.value;
                          setProfile(prev => ({ ...prev, content_type_templates: newTemplates }));
                        }}
                        placeholder="e.g., LinkedIn Post"
                      />
                    </div>
                    <div>
                      <Label htmlFor={`template-id-${index}`}>Template ID (read-only)</Label>
                      <Input
                        id={`template-id-${index}`}
                        value={template.id}
                        readOnly
                        disabled
                        className="bg-muted cursor-not-allowed"
                      />
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      const newTemplates = profile.content_type_templates.filter((_, i) => i !== index);
                      setProfile(prev => ({ ...prev, content_type_templates: newTemplates }));
                    }}
                    className="ml-2"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div>
                  <Label htmlFor={`template-prompt-${index}`}>Content Guidelines & Instructions</Label>
                  <Textarea
                    id={`template-prompt-${index}`}
                    value={template.prompt}
                    onChange={(e) => {
                      const newTemplates = [...profile.content_type_templates];
                      newTemplates[index].prompt = e.target.value;
                      setProfile(prev => ({ ...prev, content_type_templates: newTemplates }));
                    }}
                    placeholder="Describe structure, tone, length, required elements, formatting..."
                    rows={8}
                    className="text-sm"
                  />
                </div>
              </div>
            ))}
            <Button
              variant="outline"
              onClick={() => {
                const newTemplates = [...profile.content_type_templates, {
                  id: `custom_${Date.now()}`,
                  name: "New Template",
                  prompt: ""
                }];
                setProfile(prev => ({ ...prev, content_type_templates: newTemplates }));
              }}
              className="w-full"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Custom Content Type
            </Button>
          </CardContent>
        </Card>

        {/* AI Provider Configuration */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>AI Provider Configuration</CardTitle>
            <CardDescription>Configure which AI model powers your content generation</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="ai_provider" className="text-base font-semibold">Step 1: Choose Your AI Provider</Label>
              <Select
                value={profile.ai_provider}
                onValueChange={(value) => setProfile(prev => ({ ...prev, ai_provider: value }))}
              >
                <SelectTrigger id="ai_provider">
                  <SelectValue placeholder="Select AI provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="google-ai">Google AI (Recommended — Free tier available)</SelectItem>
                  <SelectItem value="custom">Custom AI Provider (Advanced)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {profile.ai_provider === 'google-ai' && (
              <Alert>
                <AlertDescription className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="google_ai_api_key" className="text-base font-semibold">
                      Step 2: Enter Your Google AI API Key
                    </Label>
                    <Input
                      id="google_ai_api_key"
                      type="password"
                      placeholder="AIza..."
                      value={profile.google_ai_api_key}
                      onChange={(e) => setProfile(prev => ({ ...prev, google_ai_api_key: e.target.value }))}
                    />
                    <p className="text-sm text-muted-foreground">
                      Get a free API key at:{" "}
                      <a
                        href="https://aistudio.google.com/app/apikey"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        aistudio.google.com/app/apikey
                      </a>
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ai_model" className="text-base font-semibold">
                      Step 3: Choose Your Model
                    </Label>
                    <Select
                      value={isCustomModel ? "custom" : profile.ai_model}
                      onValueChange={(value) => {
                        if (value === "custom") {
                          setProfile(prev => ({ ...prev, ai_model: "custom" }));
                        } else {
                          setCustomModel("");
                          setProfile(prev => ({ ...prev, ai_model: value }));
                        }
                      }}
                    >
                      <SelectTrigger id="ai_model">
                        <SelectValue placeholder="Select model" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="gemini-2.5-flash-lite">Gemini 2.5 Flash-Lite (Free — Recommended)</SelectItem>
                        <SelectItem value="gemini-3-flash-preview">Gemini 3 Flash Preview (Free)</SelectItem>
                        <SelectItem value="gemini-3.1-flash-lite-preview">Gemini 3.1 Flash-Lite Preview (Free)</SelectItem>
                        <SelectItem value="custom">Custom Model...</SelectItem>
                      </SelectContent>
                    </Select>

                    {(isCustomModel || profile.ai_model === "custom") && (
                      <div className="mt-2">
                        <Input
                          placeholder="Enter exact model string, e.g. gemini-3.1-pro-preview"
                          value={customModel}
                          onChange={(e) => setCustomModel(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          Find available model strings at{" "}
                          <a
                            href="https://ai.google.dev/gemini-api/docs/models"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
                            ai.google.dev/gemini-api/docs/models
                          </a>
                        </p>
                      </div>
                    )}
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {profile.ai_provider === 'custom' && (
              <Alert>
                <AlertDescription className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="custom_ai_endpoint" className="text-base font-semibold">Step 2: API Endpoint</Label>
                    <Input
                      id="custom_ai_endpoint"
                      type="text"
                      placeholder="https://api.example.com/v1/chat/completions"
                      value={profile.custom_ai_endpoint || ''}
                      onChange={(e) => setProfile(prev => ({ ...prev, custom_ai_endpoint: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="custom_ai_model_name" className="text-base font-semibold">Step 3: Model Name</Label>
                    <Input
                      id="custom_ai_model_name"
                      type="text"
                      placeholder="e.g. gpt-4o, claude-sonnet-4-5"
                      value={profile.custom_ai_model_name || ''}
                      onChange={(e) => setProfile(prev => ({ ...prev, custom_ai_model_name: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="custom_ai_api_key" className="text-base font-semibold">Step 4: API Key</Label>
                    <Input
                      id="custom_ai_api_key"
                      type="password"
                      placeholder="Your API key"
                      value={profile.google_ai_api_key || ''}
                      onChange={(e) => setProfile(prev => ({ ...prev, google_ai_api_key: e.target.value }))}
                    />
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Newsletter Configuration */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Newsletter Intake
            </CardTitle>
            <CardDescription>How newsletters are captured into your reference cards</CardDescription>
          </CardHeader>
          <CardContent>
            <Alert>
              <AlertDescription className="space-y-2">
                <p>
                  Newsletters are captured automatically through Gmail using the Knowledge Loom label system.
                </p>
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
              <Shield className="h-5 w-5" />
              Privacy & Data Management
            </CardTitle>
            <CardDescription>Manage your newsletter data and privacy settings</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-base font-semibold text-destructive">Delete Newsletter Data</Label>
              <p className="text-sm text-muted-foreground">
                Permanently deletes all newsletter-related data including received newsletter records and reference cards created from newsletters.
              </p>
              <Alert variant="destructive" className="mt-2">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  This action cannot be undone. Your other content (manual sources, drafts, etc.) will not be affected.
                </AlertDescription>
              </Alert>
              <Button
                variant="destructive"
                onClick={async () => {
                  if (!confirm("Are you sure you want to delete all your newsletter data? This cannot be undone.")) return;
                  setDeletingData(true);
                  try {
                    const { data, error } = await supabase.functions.invoke("delete-user-data");
                    if (error) {
                      toast.error("Failed to delete data: " + error.message);
                    } else {
                      toast.success(`Deleted ${data.details?.newsletter_emails?.deleted || 0} newsletters and ${data.details?.reference_cards_newsletter?.deleted || 0} reference cards`);
                    }
                  } catch (err) {
                    toast.error("Failed to delete data");
                    console.error(err);
                  } finally {
                    setDeletingData(false);
                  }
                }}
                disabled={deletingData}
                className="mt-2"
              >
                {deletingData ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete My Newsletter Data
                  </>
                )}
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
