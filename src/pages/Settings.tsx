import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowLeft, Plus, X } from "lucide-react";

const Settings = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState({
    business_name: "",
    business_description: "",
    target_audience: "",
    brand_voice: "",
    global_insight_questions: [] as string[]
  });

  useEffect(() => {
    const loadProfile = async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .limit(1)
        .single();

      if (data) {
        const questions = Array.isArray(data.global_insight_questions) 
          ? data.global_insight_questions.filter((q): q is string => typeof q === 'string')
          : [];
        
        setProfile({
          business_name: data.business_name || "",
          business_description: data.business_description || "",
          target_audience: data.target_audience || "",
          brand_voice: data.brand_voice || "",
          global_insight_questions: questions
        });
      } else if (error && error.code !== "PGRST116") {
        toast.error("Failed to load profile");
      }
    };
    loadProfile();
  }, []);

  const handleSave = async () => {
    setLoading(true);

    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id")
      .limit(1)
      .single();

    const { error } = await supabase
      .from("profiles")
      .upsert({
        id: existingProfile?.id,
        ...profile
      });

    if (error) {
      toast.error("Failed to save settings");
    } else {
      toast.success("Settings saved successfully");
    }
    setLoading(false);
  };

  const addQuestion = () => {
    setProfile(prev => ({
      ...prev,
      global_insight_questions: [...prev.global_insight_questions, ""]
    }));
  };

  const updateQuestion = (index: number, value: string) => {
    setProfile(prev => ({
      ...prev,
      global_insight_questions: prev.global_insight_questions.map((q, i) => i === index ? value : q)
    }));
  };

  const removeQuestion = (index: number) => {
    setProfile(prev => ({
      ...prev,
      global_insight_questions: prev.global_insight_questions.filter((_, i) => i !== index)
    }));
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
            <CardTitle>Global Insight Questions</CardTitle>
            <CardDescription>Questions used to extract insights from all content sources</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {profile.global_insight_questions.map((question, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  value={question}
                  onChange={(e) => updateQuestion(index, e.target.value)}
                  placeholder={`Question ${index + 1}`}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeQuestion(index)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" onClick={addQuestion}>
              <Plus className="mr-2 h-4 w-4" />
              Add Question
            </Button>
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