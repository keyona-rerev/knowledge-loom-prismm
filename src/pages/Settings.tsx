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
import { ArrowLeft, Plus, Trash2, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

const Settings = () => {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState({
    business_name: "",
    business_description: "",
    target_audience: "",
    brand_voice: "",
    primary_color: "#9b87f5",
    secondary_color: "#7E69AB",
    accent_color: "#6E59A5",
    ai_provider: "google-ai",
    ai_model: "gemini-2.0-flash-exp",
    google_ai_api_key: "",
    custom_ai_endpoint: "",
    custom_ai_model_name: "",
    writing_examples: [] as string[],
    content_type_templates: [] as Array<{id: string, name: string, prompt: string}>
  });

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
        setProfile({
          business_name: data.business_name || "",
          business_description: data.business_description || "",
          target_audience: data.target_audience || "",
          brand_voice: data.brand_voice || "",
          primary_color: data.primary_color || "#9b87f5",
          secondary_color: data.secondary_color || "#7E69AB",
          accent_color: data.accent_color || "#6E59A5",
          ai_provider: data.ai_provider || "google-ai",
          ai_model: data.ai_model || "gemini-2.0-flash-exp",
          google_ai_api_key: data.google_ai_api_key || "",
          custom_ai_endpoint: data.custom_ai_endpoint || "",
          custom_ai_model_name: data.custom_ai_model_name || "",
          writing_examples: Array.isArray(data.writing_examples) 
            ? (data.writing_examples.filter((ex): ex is string => typeof ex === 'string'))
            : [],
          content_type_templates: Array.isArray(data.content_type_templates)
            ? data.content_type_templates as Array<{id: string, name: string, prompt: string}>
            : []
        });
      } else if (error && error.code !== "PGRST116") {
        toast.error("Failed to load profile");
      }
    };
    loadProfile();
  }, []);

  const handleSave = async () => {
    setLoading(true);

    // Get current user
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast.error("You must be logged in to save settings");
      setLoading(false);
      return;
    }

    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("user_id", session.user.id)
      .maybeSingle();

    let error;
    if (existingProfile) {
      const result = await supabase
        .from("profiles")
        .update(profile)
        .eq("id", existingProfile.id);
      error = result.error;
    } else {
      // Include user_id when creating new profile
      const result = await supabase
        .from("profiles")
        .insert([{ ...profile, user_id: session.user.id }]);
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

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>Customize how the app looks</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="dark-mode" className="text-base">Dark Mode</Label>
                <p className="text-sm text-muted-foreground">
                  Toggle between light and dark theme
                </p>
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

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Colors & Branding</CardTitle>
            <CardDescription>Customize your app's color scheme</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="primary-color">Primary Color</Label>
              <div className="flex items-center gap-3 mt-2">
                <Input
                  id="primary-color"
                  type="color"
                  value={profile.primary_color}
                  onChange={(e) => setProfile(prev => ({ ...prev, primary_color: e.target.value }))}
                  className="w-20 h-10 cursor-pointer"
                />
                <Input
                  type="text"
                  value={profile.primary_color}
                  onChange={(e) => setProfile(prev => ({ ...prev, primary_color: e.target.value }))}
                  placeholder="#9b87f5"
                  className="flex-1"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="secondary-color">Secondary Color</Label>
              <div className="flex items-center gap-3 mt-2">
                <Input
                  id="secondary-color"
                  type="color"
                  value={profile.secondary_color}
                  onChange={(e) => setProfile(prev => ({ ...prev, secondary_color: e.target.value }))}
                  className="w-20 h-10 cursor-pointer"
                />
                <Input
                  type="text"
                  value={profile.secondary_color}
                  onChange={(e) => setProfile(prev => ({ ...prev, secondary_color: e.target.value }))}
                  placeholder="#7E69AB"
                  className="flex-1"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="accent-color">Accent Color</Label>
              <div className="flex items-center gap-3 mt-2">
                <Input
                  id="accent-color"
                  type="color"
                  value={profile.accent_color}
                  onChange={(e) => setProfile(prev => ({ ...prev, accent_color: e.target.value }))}
                  className="w-20 h-10 cursor-pointer"
                />
                <Input
                  type="text"
                  value={profile.accent_color}
                  onChange={(e) => setProfile(prev => ({ ...prev, accent_color: e.target.value }))}
                  placeholder="#6E59A5"
                  className="flex-1"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Writing Style & Voice Training</CardTitle>
            <CardDescription>Provide up to 4 examples of your writing so AI can match your tone and style</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <InstructionsToggle 
              instructions={`**Training AI to Match Your Voice**

The AI uses these examples to understand your:
• Writing style and tone (formal, casual, conversational)
• Sentence structure and flow
• Vocabulary and word choice
• How you present ideas and arguments

IMPORTANT: The AI will reference the STRUCTURE, TONE, and VOICE from your examples but will NOT use the actual content/substance. Your examples teach style, not topics.

Best practices:
• Provide 2-4 diverse examples (different topics but same voice)
• Use 200-500 words per example
• Choose your best, most representative writing
• Examples can be blog posts, articles, emails, or any written content in your natural voice`}
            />
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor={`example-${index}`}>Writing Example {index + 1} {index < 2 && "(Recommended)"}</Label>
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
                  placeholder={`Paste a sample of your writing here (200-500 words recommended)...`}
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

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Content Type Templates</CardTitle>
            <CardDescription>Define what makes great content for each format - structure, tone, and requirements</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <InstructionsToggle 
              instructions={`**Content Type Templates**

These templates teach the AI what constitutes each content format:
• STRUCTURE: How should content be organized? (sections, length, flow)
• TONE: What voice/style should be used? (professional, casual, analytical)
• REQUIREMENTS: What must be included? (metrics, examples, CTAs)

The AI will use these guidelines when generating content to ensure it matches the expected format.

Examples:
• LinkedIn: Concise, engaging, 1300-1500 characters with hook and CTA
• Blog Post: Comprehensive, SEO-optimized, 1200-2000 words with headers
• Case Study: Detailed, results-focused, 1500-2500 words with metrics

You can edit existing templates or add custom ones for your specific needs.`}
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
                      <p className="text-xs text-muted-foreground mt-1">
                        This ID is used internally and cannot be changed
                      </p>
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
                  <p className="text-xs text-muted-foreground mt-1">
                    Be specific: Include ideal length, tone, structure, what to include/exclude, formatting style
                  </p>
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

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>AI Provider Configuration</CardTitle>
            <CardDescription>Configure which AI model powers your content generation</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <InstructionsToggle 
              instructions={
                profile.ai_provider === 'google-ai' 
                  ? `**Using Google AI (Recommended)**

Step 1: Get Your Google AI API Key
• Go to https://aistudio.google.com/app/apikey
• Sign in with your Google account
• Click "Create API Key"
• Copy the key (starts with AIza...)

Step 2: Enter API Key Below
• Paste your API key in the field
• This ONE key works with ALL Gemini models

Step 3: Choose Your Model
• Select which Gemini model to use for content generation
• Recommended: Gemini 2.0 Flash (Experimental) for best balance

Step 4: Save Settings
• Click "Save Settings" to apply
• Test by creating content - uses YOUR quota!`
                  : `**Custom AI Provider (Advanced)**

Step 1: Prepare Your AI Service
• Have your AI API endpoint ready (e.g., OpenAI, Anthropic, Hugging Face)
• Ensure you have a valid API key
• Know your model name (e.g., gpt-4, claude-3-5-sonnet)

Step 2: Configure Below
• Select "Custom AI Provider"
• Enter your API endpoint URL
• Enter the exact model name
• Paste your API key
• Click "Save Settings"

Step 3: Compatibility
• Endpoint should be OpenAI-compatible format
• Must support /chat/completions or similar
• Contact the developer if you need help with integration

**Note:** This is an advanced option for users who want to use AI providers other than Google Gemini.`
              }
              autoShowDuration={15000}
            />

            <div className="space-y-2">
              <Label htmlFor="ai_provider" className="text-base font-semibold">Step 1: Choose Your AI Provider</Label>
              <Select
                value={profile.ai_provider}
                onValueChange={(value) => 
                  setProfile(prev => ({ ...prev, ai_provider: value }))
                }
              >
                <SelectTrigger id="ai_provider">
                  <SelectValue placeholder="Select AI provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="google-ai">Google AI (Use your own Gemini account)</SelectItem>
                  <SelectItem value="custom">Custom AI Provider (Advanced)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {profile.ai_provider === 'google-ai' && (
              <Alert>
                <AlertDescription className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="google_ai_api_key" className="text-base font-semibold">Step 2: Enter Your API Key</Label>
                    <Input
                      id="google_ai_api_key"
                      type="password"
                      placeholder="AIza..."
                      value={profile.google_ai_api_key}
                      onChange={(e) => setProfile(prev => ({ ...prev, google_ai_api_key: e.target.value }))}
                    />
                    <p className="text-sm text-muted-foreground">
                      One API key works with all Gemini models. Get yours at: <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">https://aistudio.google.com/app/apikey</a>
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ai_model" className="text-base font-semibold">Step 3: Choose Your Preferred Model</Label>
                    <Select
                      value={profile.ai_model}
                      onValueChange={(value) => setProfile(prev => ({ ...prev, ai_model: value }))}
                    >
                      <SelectTrigger id="ai_model">
                        <SelectValue placeholder="Select model" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="gemini-2.0-flash-exp">Gemini 2.0 Flash (Experimental) - Recommended</SelectItem>
                        <SelectItem value="gemini-1.5-flash">Gemini 1.5 Flash</SelectItem>
                        <SelectItem value="gemini-1.5-pro">Gemini 1.5 Pro</SelectItem>
                        <SelectItem value="gemini-2.0-flash-thinking-exp-1219">Gemini 2.0 Flash Thinking (Experimental)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-sm text-muted-foreground">
                      Your API key works with all models above. Choose which to use for content generation.
                    </p>
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
                    <p className="text-sm text-muted-foreground">
                      Enter the full URL to your AI provider's chat completions endpoint
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="custom_ai_model_name" className="text-base font-semibold">Step 3: Model Name</Label>
                    <Input
                      id="custom_ai_model_name"
                      type="text"
                      placeholder="gpt-4, claude-3-5-sonnet, etc."
                      value={profile.custom_ai_model_name || ''}
                      onChange={(e) => setProfile(prev => ({ ...prev, custom_ai_model_name: e.target.value }))}
                    />
                    <p className="text-sm text-muted-foreground">
                      The exact model identifier from your provider's documentation
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="custom_ai_api_key" className="text-base font-semibold">Step 4: API Key</Label>
                    <Input
                      id="custom_ai_api_key"
                      type="password"
                      placeholder="Your custom provider API key"
                      value={profile.google_ai_api_key || ''}
                      onChange={(e) => setProfile(prev => ({ ...prev, google_ai_api_key: e.target.value }))}
                    />
                    <p className="text-sm text-muted-foreground">
                      Your API key is encrypted and stored securely
                    </p>
                  </div>
                </AlertDescription>
              </Alert>
            )}
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