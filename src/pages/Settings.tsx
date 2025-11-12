import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

const Settings = () => {
  const navigate = useNavigate();
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
    custom_ai_model_name: ""
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
          custom_ai_model_name: data.custom_ai_model_name || ""
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
            <CardTitle>AI Provider Configuration</CardTitle>
            <CardDescription>Configure which AI model to use for content generation</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <Label>AI Provider</Label>
              <Select value={profile.ai_provider} onValueChange={(value) => setProfile(prev => ({ ...prev, ai_provider: value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="google-ai">Google AI (Use your own Gemini account)</SelectItem>
                  <SelectItem value="custom">Custom AI Provider (Advanced)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {profile.ai_provider === "google-ai" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="ai-model">Model</Label>
                  <Select value={profile.ai_model} onValueChange={(value) => setProfile(prev => ({ ...prev, ai_model: value }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gemini-2.0-flash-exp">Gemini 2.0 Flash (Experimental - Recommended)</SelectItem>
                      <SelectItem value="gemini-1.5-flash">Gemini 1.5 Flash (Stable)</SelectItem>
                      <SelectItem value="gemini-1.5-pro">Gemini 1.5 Pro (Advanced)</SelectItem>
                      <SelectItem value="gemini-2.0-flash-thinking-exp">Gemini 2.0 Flash Thinking (Experimental)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="google-api-key">Google AI API Key</Label>
                  <Input
                    id="google-api-key"
                    type="password"
                    value={profile.google_ai_api_key}
                    onChange={(e) => setProfile(prev => ({ ...prev, google_ai_api_key: e.target.value }))}
                    placeholder="AIza..."
                  />
                  <p className="text-sm text-muted-foreground">
                    Get your API key at <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-primary underline">Google AI Studio</a>
                  </p>
                </div>
              </>
            )}

            {profile.ai_provider === "custom" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="custom-endpoint">API Endpoint</Label>
                  <Input
                    id="custom-endpoint"
                    value={profile.custom_ai_endpoint}
                    onChange={(e) => setProfile(prev => ({ ...prev, custom_ai_endpoint: e.target.value }))}
                    placeholder="https://api.example.com/v1/chat/completions"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="custom-model">Model Name</Label>
                  <Input
                    id="custom-model"
                    value={profile.custom_ai_model_name}
                    onChange={(e) => setProfile(prev => ({ ...prev, custom_ai_model_name: e.target.value }))}
                    placeholder="gpt-4"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="custom-api-key">API Key</Label>
                  <Input
                    id="custom-api-key"
                    type="password"
                    value={profile.google_ai_api_key}
                    onChange={(e) => setProfile(prev => ({ ...prev, google_ai_api_key: e.target.value }))}
                    placeholder="sk-..."
                  />
                  <p className="text-sm text-muted-foreground">
                    Your API key is stored securely and used only for your content generation.
                  </p>
                </div>
              </>
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