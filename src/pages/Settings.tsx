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
    brand_voice: ""
  });
  const [aiProvider, setAiProvider] = useState("gemini");

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
          brand_voice: data.brand_voice || ""
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
            <CardTitle>AI Provider</CardTitle>
            <CardDescription>Select which AI model to use for content processing</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label>AI Model</Label>
              <Select value={aiProvider} onValueChange={setAiProvider}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gemini">Google Gemini 2.5 Flash (Recommended - Free)</SelectItem>
                  <SelectItem value="claude">Anthropic Claude (Coming Soon)</SelectItem>
                  <SelectItem value="openai">OpenAI GPT (Coming Soon)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                Note: Gemini is currently the only supported provider and is free to use.
              </p>
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