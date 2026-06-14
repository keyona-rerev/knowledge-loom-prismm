import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Trash2, Moon, Sun, AlertTriangle, Shield, Loader2, Linkedin, CheckCircle2 } from "lucide-react";
import { useTheme } from "next-themes";

// Settings is now appearance plus the AI provider only. Brand, voice, audience, and
// the content-type libraries moved to Strategy and Audience.

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
  const [liConn, setLiConn] = useState<any>(null);
  const [liBusy, setLiBusy] = useState(false);
  const [profile, setProfile] = useState({
    ai_provider: "anthropic",
    ai_model: "claude-sonnet-4-20250514",
    ai_api_key: "",
    ai_endpoint: "",
  });

  const currentProvider = AI_PROVIDERS.find(p => p.value === profile.ai_provider) || AI_PROVIDERS[0];

  useEffect(() => {
    const loadProfile = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/auth"); return; }
      const { data, error } = await supabase.from("profiles").select("ai_provider, ai_model, ai_api_key, ai_endpoint").eq("user_id", session.user.id).maybeSingle();
      if (data) {
        setProfile({
          ai_provider: data.ai_provider || "anthropic",
          ai_model: data.ai_model || "claude-sonnet-4-20250514",
          ai_api_key: data.ai_api_key || "",
          ai_endpoint: data.ai_endpoint || "",
        });
      } else if (error && error.code !== "PGRST116") {
        toast.error("Failed to load settings");
      }
    };
    loadProfile();
  }, [navigate]);

  // LinkedIn-via-provider connection. start -> OAuth redirect; sync -> read back
  // the connected account on return; status -> show current connection.
  const callConnect = async (action: "status" | "start" | "sync") => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    if (action === "start") {
      const redirectUrl = `${window.location.origin}${import.meta.env.BASE_URL}settings?zernio=connected`;
      const { data, error } = await supabase.functions.invoke("zernio-connect", { body: { action: "start", redirectUrl } });
      if (error || !data?.authorizationUrl) {
        toast.error("Could not start LinkedIn connect: " + (error?.message || data?.error || "unknown"));
        return;
      }
      window.location.href = data.authorizationUrl;
      return;
    }
    const { data, error } = await supabase.functions.invoke("zernio-connect", { body: { action } });
    if (error) { if (action === "sync") toast.error("Sync failed: " + error.message); return; }
    if (action === "sync") {
      if (data?.connected) toast.success("LinkedIn connected");
      else toast.warning(data?.error || "No LinkedIn account found yet");
    }
    setLiConn(data?.connection ?? null);
  };

  useEffect(() => {
    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get("zernio") === "connected") {
        await callConnect("sync");
        window.history.replaceState({}, "", window.location.pathname);
      } else {
        await callConnect("status");
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { toast.error("You must be logged in"); setLoading(false); return; }
    // Only touch the AI provider columns. Brand and library fields are owned by Strategy and Audience.
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
        <h1 className="text-3xl font-bold mb-1">Settings</h1>
        <p className="text-sm text-muted-foreground mb-8">
          Appearance and the AI provider. Brand, voice, audience, and the content libraries live on Strategy and Audience.
        </p>

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

        {/* AI Provider Configuration */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>AI Provider Configuration</CardTitle>
            <CardDescription>Configure which AI model powers your content generation. Switch providers any time, no code changes needed.</CardDescription>
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

        {/* Publishing destination, LinkedIn company page via the provider */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Linkedin className="h-5 w-5" />Publishing, LinkedIn
            </CardTitle>
            <CardDescription>
              Approved posts are scheduled to your LinkedIn company page at each slot's time. Connect the page once here.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {liConn?.external_account_id ? (
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span>Connected{liConn.account_label ? `: ${liConn.account_label}` : ""}</span>
                  <Badge variant="outline">{liConn.status}</Badge>
                </div>
                <Button variant="outline" size="sm" onClick={() => callConnect("sync")}>Refresh</Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No LinkedIn account connected yet.</p>
            )}
            <Button onClick={async () => { setLiBusy(true); await callConnect("start"); setLiBusy(false); }} disabled={liBusy}>
              {liBusy
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Connecting...</>
                : (liConn?.external_account_id ? "Reconnect LinkedIn" : "Connect LinkedIn")}
            </Button>
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
                    const { error } = await supabase.functions.invoke("delete-user-data");
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
