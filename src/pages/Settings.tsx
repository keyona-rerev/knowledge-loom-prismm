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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { ArrowLeft, Trash2, Moon, Sun, AlertTriangle, Shield, Loader2, Linkedin, Instagram, CheckCircle2, DollarSign, Eye, ChevronDown, Clock } from "lucide-react";
import { useTheme } from "next-themes";
import { KNOWN_PLATFORMS, platformLabel } from "@/lib/platform";

const PLATFORM_ICONS: Record<string, typeof Linkedin> = {
  linkedin: Linkedin,
  instagram: Instagram,
};

const PLATFORM_DESTINATION_COPY: Record<string, string> = {
  linkedin: "your LinkedIn company page",
  instagram: "your Instagram business account",
};

// Settings: appearance, queue status and account preferences.
// Brand, voice, audience, and content libraries live on Strategy and Audience.
// Visual generation controls live on Visual Studio (/visual-studio).

// Current implementation status. Queue deployment is separate from organic lifecycle proof.
const AI_USAGE = [
  { name: "Scheduled and manual draft generation", trigger: "Draft generation uses the Claude subscription queue. Jobs are asynchronous; a queued job is not yet a draft.", fn: "execute-autopilot-template / generate-content-directions / generate-final-content", status: "subscription" },
  { name: "Draft revision", trigger: "Feedback and prose-cleanup revisions use the Claude subscription queue.", fn: "regenerate-draft-with-feedback / revise-draft", status: "subscription" },
  { name: "Reference card summary and relevance", trigger: "Card summaries and relevance scoring use separate queue jobs. Results are applied when settled; low-scoring queue cards are archived. Deployment is complete; organic lifecycle verification is still pending.", fn: "process-reference-card / score-relevance", status: "subscription" },
  { name: "Public source discovery", trigger: "The subscription search route is deployed. Live WebSearch capability is not yet verified; search stays disabled until public topics are deliberately saved.", fn: "search-sources", status: "unverified" },
  { name: "Branded visuals", trigger: "The visual migration remains off and unmerged. No renders are being initiated as part of this migration. Renderer costs and activation are separate decisions.", fn: "generate-draft-visual / preview-visual", status: "unavailable" },
];

// Same list CadenceTab uses for per-slot timezone. This one sets the
// account-wide default: new cadence slots and reschedule actions (drag on
// the calendar, the Edit-time dialog) fall back to this instead of a
// hardcoded "America/New_York" or whatever the browser happens to report.
const TIMEZONES = [
  { value: "America/New_York", label: "Eastern (New York)" },
  { value: "America/Chicago", label: "Central (Chicago)" },
  { value: "America/Denver", label: "Mountain (Denver)" },
  { value: "America/Phoenix", label: "Mountain, no DST (Phoenix)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { value: "America/Anchorage", label: "Alaska (Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii (Honolulu)" },
  { value: "UTC", label: "UTC" },
];

interface NamedRow { id: string; name: string; }

interface PromptPreview {
  system: string;
  contextBlock: string;
  hardRuleCount: number;
  inactiveHardRuleCount: number;
  trustedSourceCount: number;
}

const Settings = () => {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [deletingData, setDeletingData] = useState(false);
  const [connections, setConnections] = useState<Record<string, any>>({});
  const [connectBusy, setConnectBusy] = useState<Record<string, boolean>>({});
  const [profile, setProfile] = useState({
    min_approved_threshold: 12,
    low_queue_email_threshold: 3,
    default_timezone: "America/New_York",
    default_post_time: "09:00",
  });

  // Prompt Inspector: pick a real format/nature/job from the Strategy
  // library and see the literal system prompt that combination would send
  // through execute-autopilot-template — not a description of it. Answers
  // "is my hard rule actually in there" and "did editing Strategy actually
  // change anything" directly, instead of requiring trust that it did.
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [formats, setFormats] = useState<NamedRow[]>([]);
  const [natures, setNatures] = useState<NamedRow[]>([]);
  const [jobs, setJobs] = useState<NamedRow[]>([]);
  const [lanes, setLanes] = useState<NamedRow[]>([]);
  const [inspectorFormat, setInspectorFormat] = useState<string>("");
  const [inspectorNature, setInspectorNature] = useState<string>("");
  const [inspectorJob, setInspectorJob] = useState<string>("");
  const [inspectorLane, setInspectorLane] = useState<string>("");
  const [inspectorLoading, setInspectorLoading] = useState(false);
  const [inspectorResult, setInspectorResult] = useState<PromptPreview | null>(null);


  useEffect(() => {
    const loadProfile = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/auth"); return; }
      const { data, error } = await supabase
        .from("profiles")
        .select("min_approved_threshold, low_queue_email_threshold, default_timezone, default_post_time")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (data) {
        setProfile({
          min_approved_threshold: (data as any).min_approved_threshold ?? 12,
          low_queue_email_threshold: (data as any).low_queue_email_threshold ?? 3,
          default_timezone: (data as any).default_timezone || "America/New_York",
          default_post_time: ((data as any).default_post_time || "09:00:00").slice(0, 5),
        });
      } else if (error && error.code !== "PGRST116") {
        toast.error("Failed to load settings");
      }

      const [fmt, nat, jb, ln] = await Promise.all([
        supabase.from("formats").select("id, name").eq("user_id", session.user.id).eq("is_active", true).order("sort_order"),
        supabase.from("natures").select("id, name").eq("user_id", session.user.id).eq("is_active", true).order("sort_order"),
        supabase.from("jobs").select("id, name").eq("user_id", session.user.id).eq("kind", "engine_job").eq("is_active", true).order("sort_order"),
        supabase.from("lanes").select("id, name").eq("user_id", session.user.id).eq("is_active", true).order("sort_order"),
      ]);
      const fmtRows = (fmt.data || []) as NamedRow[];
      const natRows = (nat.data || []) as NamedRow[];
      const jbRows = (jb.data || []) as NamedRow[];
      setFormats(fmtRows);
      setNatures(natRows);
      setJobs(jbRows);
      setLanes((ln.data || []) as NamedRow[]);
      if (fmtRows[0]) setInspectorFormat(fmtRows[0].id);
      if (natRows[0]) setInspectorNature(natRows[0].id);
      if (jbRows[0]) setInspectorJob(jbRows[0].id);
    };
    loadProfile();
  }, [navigate]);

  const callConnect = async (action: "status" | "start" | "sync", platform: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const label = platformLabel(platform);
    if (action === "start") {
      const redirectUrl = `${window.location.origin}${import.meta.env.BASE_URL}settings?zernio=connected&platform=${platform}`;
      const { data, error } = await supabase.functions.invoke("zernio-connect", { body: { action: "start", redirectUrl, platform } });
      if (error || !data?.authorizationUrl) {
        toast.error(`Could not start ${label} connect: ` + (error?.message || data?.error || "unknown"));
        return;
      }
      window.location.href = data.authorizationUrl;
      return;
    }
    const { data, error } = await supabase.functions.invoke("zernio-connect", { body: { action, platform } });
    if (error) { if (action === "sync") toast.error("Sync failed: " + error.message); return; }
    if (action === "sync") {
      if (data?.connected) toast.success(`${label} connected`);
      else toast.warning(data?.error || `No ${label} account found yet`);
    }
    setConnections((c) => ({ ...c, [platform]: data?.connection ?? null }));
  };

  useEffect(() => {
    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get("zernio") === "connected") {
        const returnedPlatform = params.get("platform") || "linkedin";
        await callConnect("sync", returnedPlatform);
        window.history.replaceState({}, "", window.location.pathname);
        await Promise.all(KNOWN_PLATFORMS.filter((p) => p !== returnedPlatform).map((p) => callConnect("status", p)));
      } else {
        await Promise.all(KNOWN_PLATFORMS.map((p) => callConnect("status", p)));
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { toast.error("You must be logged in"); setLoading(false); return; }
    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("user_id", session.user.id)
      .maybeSingle();
    const payload = { ...profile, default_post_time: `${profile.default_post_time}:00` };
    let error;
    if (existingProfile) {
      ({ error } = await supabase.from("profiles").update(payload).eq("id", existingProfile.id));
    } else {
      ({ error } = await supabase.from("profiles").insert([{ ...payload, user_id: session.user.id }]));
    }
    if (error) { toast.error("Failed to save: " + error.message); } else { toast.success("Settings saved"); }
    setLoading(false);
  };

  const runPromptPreview = async () => {
    if (!inspectorFormat || !inspectorNature || !inspectorJob) {
      toast.error("Pick a format, nature, and job first");
      return;
    }
    setInspectorLoading(true);
    setInspectorResult(null);
    const { data, error } = await supabase.functions.invoke("preview-prompt", {
      body: {
        formatId: inspectorFormat,
        natureId: inspectorNature,
        jobId: inspectorJob,
        laneId: inspectorLane || undefined,
      },
    });
    setInspectorLoading(false);
    if (error || data?.error) {
      toast.error("Couldn't render the prompt: " + (error?.message || data?.error || "unknown error"));
      return;
    }
    setInspectorResult(data as PromptPreview);
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
          Appearance, queue status and account preferences. Brand, voice, and audience live on Strategy and Audience. Visual generation controls live on <button className="underline text-foreground" onClick={() => navigate("/visual-studio")}>Visual Studio</button>.
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

        {/* Posting defaults */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />Posting defaults
            </CardTitle>
            <CardDescription>
              Your preferred timezone and time of day. New Cadence slots start with these instead of a hardcoded default, and dragging a post to a new day on the Schedule calendar (or using its Edit-time dialog) uses this timezone rather than guessing from your browser.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-base font-semibold">Timezone</Label>
                <Select value={profile.default_timezone} onValueChange={(v) => setProfile(prev => ({ ...prev, default_timezone: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TIMEZONES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-base font-semibold">Default post time</Label>
                <Input
                  type="time"
                  value={profile.default_post_time}
                  onChange={(e) => setProfile(prev => ({ ...prev, default_post_time: e.target.value }))}
                />
              </div>
            </div>
            <Button onClick={handleSave} disabled={loading}>
              {loading ? "Saving..." : "Save Settings"}
            </Button>
          </CardContent>
        </Card>

        {/* Review pipeline */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Review pipeline</CardTitle>
            <CardDescription>The dashboard warns you when your approved, ready-to-publish queue drops below your goal. The daily queue check can send an alert email when email delivery is configured and the queue drops below the second number. Without email delivery configuration, the alert may not arrive.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-base font-semibold">Minimum approved drafts</Label>
                <Input
                  type="number"
                  min={0}
                  value={profile.min_approved_threshold}
                  onChange={(e) => setProfile(prev => ({ ...prev, min_approved_threshold: Math.max(0, Number(e.target.value) || 0) }))}
                  className="max-w-[120px]"
                />
                <p className="text-sm text-muted-foreground">Dashboard banner goal.</p>
              </div>
              <div className="space-y-2">
                <Label className="text-base font-semibold">Email alert threshold</Label>
                <Input
                  type="number"
                  min={0}
                  value={profile.low_queue_email_threshold}
                  onChange={(e) => setProfile(prev => ({ ...prev, low_queue_email_threshold: Math.max(0, Number(e.target.value) || 0) }))}
                  className="max-w-[120px]"
                />
                <p className="text-sm text-muted-foreground">One alert per dip when email delivery is configured; re-arms once the queue recovers.</p>
              </div>
            </div>
            <Button onClick={handleSave} disabled={loading}>
              {loading ? "Saving..." : "Save Settings"}
            </Button>
          </CardContent>
        </Card>

        {/* AI Provider */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Claude subscription</CardTitle>
            <CardDescription>Supported text AI features use your existing Claude subscription queue. API provider, key, endpoint and model controls are not offered here.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border p-3 space-y-1">
              <p className="font-medium">Claude Code (your Claude subscription)</p>
              <p className="text-sm">Drafts are written by a Claude Code worker running in GitHub Actions on your Claude subscription. A queued job has not completed yet. No API key is needed for this path.</p>
              <p className="text-sm text-muted-foreground">Source discovery is deployed with live capability still unverified. Visual generation remains off while its migration and rendering cost controls are reviewed.</p>
            </div>
            <Button onClick={handleSave} disabled={loading}>
              {loading ? "Saving..." : "Save Settings"}
            </Button>
          </CardContent>
        </Card>

        {/* How generation actually runs today */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>How content generation runs</CardTitle>
            <CardDescription>The real path a scheduled post takes today, end to end.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg border p-3">
              <p className="font-medium">Generation: Claude Code worker on your subscription</p>
              <p className="text-sm text-muted-foreground mt-1">Each scheduled slot enqueues a job; a Claude Code worker in GitHub Actions claims it and writes the draft. Scheduled generation costs $0 in API spend. Drafts land in Review for approval.</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="font-medium">Publishing: daily sweep at 13:20 UTC</p>
              <p className="text-sm text-muted-foreground mt-1">A daily sweep fires at 13:20 UTC year-round - 8:20 AM Central in daylight time, 7:20 AM Central after the November clock change - and schedules every approved post to your connected platform at its slot time. Scheduled posts can be repaired in place with read-back verification, without cancelling and republishing.</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="font-medium">Current operating state (as of October 29, 2026)</p>
              <p className="text-sm text-muted-foreground mt-1">Draft generation and revisions use the subscription queue. Card summary and relevance queue releases are deployed, with organic lifecycle verification still pending. Source discovery is deployed with live WebSearch capability still unverified; visual generation remains off. Deployment status is not proof that a queued job has completed.</p>
            </div>
          </CardContent>
        </Card>

        {/* AI usage */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />Where AI calls happen
            </CardTitle>
            <CardDescription>
              Text AI uses the existing Claude subscription rather than a metered API fallback. Queue jobs complete asynchronously. The list distinguishes deployed queue paths from features still under review or off; it is not a measured spending report.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {AI_USAGE.map((item) => (
              <div key={item.fn} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <p className="font-medium">{item.name}</p>
                  {item.status === "subscription" ? (
                    <Badge variant="outline" className="font-mono text-xs">Claude subscription queue</Badge>
                  ) : item.status === "unverified" ? (
                    <Badge variant="outline" className="font-mono text-xs">Deployed - live proof pending</Badge>
                  ) : item.status === "unavailable" ? (
                    <Badge variant="outline" className="font-mono text-xs">Not activated</Badge>
                  ) : null}
                </div>
                <p className="text-sm text-muted-foreground mt-1">{item.trigger}</p>
                <p className="text-xs text-muted-foreground mt-1 font-mono">{item.fn}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Prompt Inspector */}
        <Collapsible open={inspectorOpen} onOpenChange={setInspectorOpen} className="mb-6">
          <Card>
            <CollapsibleTrigger asChild>
              <button className="w-full text-left">
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Eye className="h-5 w-5" />Prompt Inspector
                    </CardTitle>
                    <CardDescription className="mt-1.5">
                      See the literal system prompt "Scheduled draft generation" sends for a given format, nature, and job — not a description of it, the actual text, including your Hard Rules exactly as written.
                    </CardDescription>
                  </div>
                  <ChevronDown className={`h-5 w-5 text-muted-foreground shrink-0 transition-transform ${inspectorOpen ? "rotate-180" : ""}`} />
                </CardHeader>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-4 border-t pt-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">Format</Label>
                    <Select value={inspectorFormat} onValueChange={setInspectorFormat}>
                      <SelectTrigger><SelectValue placeholder="Format" /></SelectTrigger>
                      <SelectContent>{formats.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Nature</Label>
                    <Select value={inspectorNature} onValueChange={setInspectorNature}>
                      <SelectTrigger><SelectValue placeholder="Nature" /></SelectTrigger>
                      <SelectContent>{natures.map((n) => <SelectItem key={n.id} value={n.id}>{n.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Job</Label>
                    <Select value={inspectorJob} onValueChange={setInspectorJob}>
                      <SelectTrigger><SelectValue placeholder="Job" /></SelectTrigger>
                      <SelectContent>{jobs.map((j) => <SelectItem key={j.id} value={j.id}>{j.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                {lanes.length > 0 && (
                  <div className="max-w-xs">
                    <Label className="text-xs">Lane (optional)</Label>
                    <Select value={inspectorLane || "__any__"} onValueChange={(v) => setInspectorLane(v === "__any__" ? "" : v)}>
                      <SelectTrigger><SelectValue placeholder="Both lanes" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__any__">Both lanes</SelectItem>
                        {lanes.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <Button onClick={runPromptPreview} disabled={inspectorLoading}>
                  {inspectorLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Rendering...</> : <><Eye className="h-4 w-4 mr-2" />Show the actual prompt</>}
                </Button>

                {inspectorResult && (
                  <div className="space-y-3 pt-2">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">{inspectorResult.hardRuleCount} active hard rule{inspectorResult.hardRuleCount === 1 ? "" : "s"}</Badge>
                      {inspectorResult.inactiveHardRuleCount > 0 && (
                        <Badge variant="destructive">{inspectorResult.inactiveHardRuleCount} hard rule{inspectorResult.inactiveHardRuleCount === 1 ? "" : "s"} turned off, not sent</Badge>
                      )}
                      <Badge variant="outline">{inspectorResult.trustedSourceCount} approved source{inspectorResult.trustedSourceCount === 1 ? "" : "s"} citable</Badge>
                    </div>
                    <div>
                      <Label className="text-xs font-semibold">System prompt (Hard Rules, Voice, and Trusted Sources)</Label>
                      <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border bg-muted p-3 text-xs font-mono">{inspectorResult.system}</pre>
                    </div>
                    <div>
                      <Label className="text-xs font-semibold">Context block for this format/nature/job</Label>
                      <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border bg-muted p-3 text-xs font-mono">{inspectorResult.contextBlock}</pre>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      This is a direct render of the same Hard Rules, Voice, and Trusted Sources data the real generation reads at run time — if a rule isn't showing up here, it isn't reaching the AI either. The full prompt also includes a seed premise and, depending on your Source Reliance fader, specific reference cards chosen at generation time, neither of which is fixed ahead of time the way this part is.
                    </p>
                  </div>
                )}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Publishing connections, one card per platform */}
        {KNOWN_PLATFORMS.map((platform) => {
          const label = platformLabel(platform);
          const Icon = PLATFORM_ICONS[platform] ?? Linkedin;
          const conn = connections[platform];
          const busy = !!connectBusy[platform];
          return (
            <Card className="mb-6" key={platform}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Icon className="h-5 w-5" />Publishing, {label}
                </CardTitle>
                <CardDescription>
                  Approved posts are scheduled to {PLATFORM_DESTINATION_COPY[platform] ?? `your ${label} account`}. Connect once here.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {conn?.external_account_id ? (
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <span>Connected{conn.account_label ? `: ${conn.account_label}` : ""}</span>
                      <Badge variant="outline">{conn.status}</Badge>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => callConnect("sync", platform)}>Refresh</Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No {label} account connected yet.</p>
                )}
                <Button
                  onClick={async () => {
                    setConnectBusy((b) => ({ ...b, [platform]: true }));
                    await callConnect("start", platform);
                    setConnectBusy((b) => ({ ...b, [platform]: false }));
                  }}
                  disabled={busy}
                >
                  {busy
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Connecting...</>
                    : (conn?.external_account_id ? `Reconnect ${label}` : `Connect ${label}`)}
                </Button>
              </CardContent>
            </Card>
          );
        })}

        {/* Privacy */}
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
                  } catch { toast.error("Failed to delete data"); }
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
      </main>
    </div>
  );
};

export default Settings;
