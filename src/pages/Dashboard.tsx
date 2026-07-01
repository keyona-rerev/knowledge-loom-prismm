import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Calendar, Rss, FileEdit, Settings, MessageCircleQuestion, LogOut,
  CheckCheck, Clock, Lightbulb, Target, CalendarClock, AlertTriangle, Send, Database, Plus,
  RefreshCw, ThumbsUp, MessageSquare, Eye,
} from "lucide-react";
import { InstructionsToggle } from "@/components/InstructionsToggle";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useState, useEffect } from "react";

interface RecentlyPosted {
  id: string;
  title: string | null;
  publish_status: string | null;
  scheduled_for: string | null;
  metric_likes: number | null;
  metric_comments: number | null;
  metric_impressions: number | null;
  metrics_synced_at: string | null;
  metrics_error: string | null;
}

const Dashboard = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    pendingReviews: 0,
    approvedDrafts: 0,
    postedCount: 0,
    minApprovedThreshold: 12,
  });
  const [recentlyPosted, setRecentlyPosted] = useState<RecentlyPosted[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingMetrics, setSyncingMetrics] = useState(false);

  useEffect(() => {
    loadDashboardStats();
  }, []);

  const loadDashboardStats = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      setLoading(false);
      return;
    }
    const userId = session.user.id;

    try {
      const nowIso = new Date().toISOString();
      const postedFilter = `publish_status.eq.published_now,and(publish_status.eq.scheduled,scheduled_for.lt.${nowIso})`;

      const [
        { count: pendingReviews },
        { count: approvedDrafts },
        { count: postedCount },
        { data: recent },
        { data: profile },
      ] = await Promise.all([
        supabase.from("drafts").select("id", { count: "exact", head: true })
          .eq("user_id", userId).eq("approval_status", "pending"),
        supabase.from("drafts").select("id", { count: "exact", head: true })
          .eq("user_id", userId).eq("approval_status", "approved"),
        supabase.from("drafts").select("id", { count: "exact", head: true })
          .eq("user_id", userId).or(postedFilter),
        supabase.from("drafts").select("id, title, publish_status, scheduled_for, metric_likes, metric_comments, metric_impressions, metrics_synced_at, metrics_error")
          .eq("user_id", userId).or(postedFilter)
          .order("scheduled_for", { ascending: false }).limit(5),
        supabase.from("profiles").select("min_approved_threshold")
          .eq("user_id", userId).maybeSingle(),
      ]);

      setStats({
        pendingReviews: pendingReviews || 0,
        approvedDrafts: approvedDrafts || 0,
        postedCount: postedCount || 0,
        minApprovedThreshold: (profile as any)?.min_approved_threshold ?? 12,
      });
      setRecentlyPosted(recent || []);
    } catch (error) {
      console.error("Error loading dashboard stats:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error("Failed to sign out");
    } else {
      toast.success("Signed out successfully");
      navigate("/auth");
    }
  };

  const handleSyncMetrics = async () => {
    setSyncingMetrics(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-post-analytics", { body: {} });
      if (error) throw error;
      if (data?.failed > 0) {
        toast.warning(`Synced ${data.synced}, ${data.failed} failed. Zernio's analytics may need a plan upgrade.`);
      } else {
        toast.success(`Synced metrics for ${data?.synced ?? 0} post(s)`);
      }
      loadDashboardStats();
    } catch (err) {
      toast.error("Metrics sync failed: " + (err as Error)?.message);
    } finally {
      setSyncingMetrics(false);
    }
  };

  const captureTier = [
    {
      title: "Sources",
      description: "Google Alerts and manual sources that feed the engine",
      icon: Rss,
      path: "/feeds",
      color: "text-orange-500",
    },
    {
      title: "Journal",
      description: "Capture observations; they're citable as soon as you save them",
      icon: Lightbulb,
      path: "/insights",
      color: "text-amber-500",
    },
  ];

  const configureTier = [
    {
      title: "Strategy",
      description: "Brand, voice, audience, lanes, and the formats library",
      icon: Target,
      path: "/strategy",
      color: "text-rose-500",
    },
    {
      title: "Cadence",
      description: "Standing slots the engine fills on a recurring schedule",
      icon: CalendarClock,
      path: "/schedule",
      color: "text-amber-500",
    },
    {
      title: "Settings",
      description: "AI provider, LinkedIn connection, and review pipeline",
      icon: Settings,
      path: "/settings",
      color: "text-gray-500",
    },
  ];

  const moreLinks = [
    { title: "All drafts", path: "/drafts", icon: FileEdit },
    { title: "Reference cards", path: "/cards", icon: Database },
    { title: "Content calendar", path: "/calendar", icon: Calendar },
    { title: "Create content", path: "/create", icon: Plus },
    { title: "Question settings", path: "/questions", icon: MessageCircleQuestion },
  ];

  const belowThreshold = stats.approvedDrafts < stats.minApprovedThreshold;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-6 flex justify-between items-center">
          <h1 className="text-3xl font-bold">Insight Forge</h1>
          <Button variant="ghost" onClick={handleLogout}>
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="mb-8">
          <h2 className="text-2xl font-semibold mb-2">Welcome to Insight Forge</h2>
          <p className="text-muted-foreground">
            Your central hub for content creation and management
          </p>
        </div>

        <InstructionsToggle
          instructions={`Getting started:
1. Set up a source in Sources, or capture an observation directly in Journal
2. Create content from your insights
3. Approve drafts in Review; approval automatically schedules them to LinkedIn
4. Edit a scheduled time from Content calendar if a slot needs to move

The dashboard shows your review pipeline and quick access to everything else.`}
        />

        {!loading && belowThreshold && (
          <Card className="mb-8 border-amber-300 bg-amber-50">
            <CardContent className="p-4 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-700 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="font-medium text-amber-900">
                  Only {stats.approvedDrafts} of your goal of {stats.minApprovedThreshold} approved drafts are ready to publish.
                </p>
                <p className="text-sm text-amber-800 mt-0.5">
                  Approve more drafts in Review to keep the publishing pipeline healthy.
                </p>
              </div>
              <Button size="sm" onClick={() => navigate("/review")} className="shrink-0">
                Go to Review
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="space-y-8">
          {/* Review tier */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <CheckCheck className="h-5 w-5 text-primary" />
              <h3 className="text-xl font-semibold">Review</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <Card
                className={`cursor-pointer hover:shadow-lg transition-shadow ${stats.pendingReviews > 0 ? "border-2 border-yellow-300 bg-yellow-50" : "border-2 border-primary/20"}`}
                onClick={() => navigate("/review")}
              >
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Clock className="h-8 w-8 text-yellow-500" />
                      <CardTitle className="text-lg">Pending</CardTitle>
                    </div>
                    <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
                      {stats.pendingReviews}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription>Drafts awaiting your approval</CardDescription>
                </CardContent>
              </Card>

              <Card className="cursor-pointer hover:shadow-lg transition-shadow border-2 border-primary/20" onClick={() => navigate("/drafts")}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CheckCheck className="h-8 w-8 text-green-500" />
                      <CardTitle className="text-lg">Approved</CardTitle>
                    </div>
                    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                      {stats.approvedDrafts} of {stats.minApprovedThreshold} goal
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription>Approved and scheduled to publish</CardDescription>
                </CardContent>
              </Card>

              <Card className="cursor-pointer hover:shadow-lg transition-shadow border-2 border-primary/20" onClick={() => navigate("/calendar")}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Send className="h-8 w-8" style={{ color: "#f9655b" }} />
                      <CardTitle className="text-lg">Posted</CardTitle>
                    </div>
                    <Badge style={{ backgroundColor: "#f9655b", color: "#ffffff" }}>{stats.postedCount}</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription>Live on LinkedIn</CardDescription>
                </CardContent>
              </Card>
            </div>

            {recentlyPosted.length > 0 && (
              <Card>
                <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base">Recently posted</CardTitle>
                  <Button variant="outline" size="sm" onClick={handleSyncMetrics} disabled={syncingMetrics}>
                    <RefreshCw className={`h-3.5 w-3.5 mr-2 ${syncingMetrics ? "animate-spin" : ""}`} />
                    {syncingMetrics ? "Syncing..." : "Sync metrics"}
                  </Button>
                </CardHeader>
                <CardContent className="space-y-2">
                  {recentlyPosted.map((draft) => (
                    <div
                      key={draft.id}
                      className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/30 cursor-pointer gap-4"
                      onClick={() => navigate(`/drafts/${draft.id}`)}
                    >
                      <span className="text-sm font-medium truncate flex-1">{draft.title || "Untitled draft"}</span>
                      {draft.metrics_synced_at ? (
                        <span className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                          <span className="flex items-center gap-1"><ThumbsUp className="h-3 w-3" />{draft.metric_likes ?? 0}</span>
                          <span className="flex items-center gap-1"><MessageSquare className="h-3 w-3" />{draft.metric_comments ?? 0}</span>
                          <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{draft.metric_impressions ?? 0}</span>
                        </span>
                      ) : draft.metrics_error ? (
                        <span className="text-xs text-amber-700 shrink-0">Metrics unavailable</span>
                      ) : (
                        <span className="text-xs text-muted-foreground shrink-0">Not synced yet</span>
                      )}
                      <span className="text-xs text-muted-foreground shrink-0">
                        {draft.scheduled_for ? new Date(draft.scheduled_for).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </section>

          {/* Capture tier */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Lightbulb className="h-5 w-5 text-primary" />
              <h3 className="text-xl font-semibold">Capture</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {captureTier.map((item) => (
                <Card
                  key={item.path}
                  className="cursor-pointer hover:shadow-lg transition-shadow border-2 border-primary/20"
                  onClick={() => navigate(item.path)}
                >
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <item.icon className={`h-8 w-8 ${item.color}`} />
                      <CardTitle className="text-lg">{item.title}</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <CardDescription>{item.description}</CardDescription>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          {/* Configure tier */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Settings className="h-5 w-5 text-primary" />
              <h3 className="text-xl font-semibold">Configure</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {configureTier.map((item) => (
                <Card
                  key={item.path}
                  className="cursor-pointer hover:shadow-lg transition-shadow border-2 border-primary/20"
                  onClick={() => navigate(item.path)}
                >
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <item.icon className={`h-8 w-8 ${item.color}`} />
                      <CardTitle className="text-lg">{item.title}</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <CardDescription>{item.description}</CardDescription>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          {/* Everything else */}
          <section>
            <h3 className="text-sm font-medium text-muted-foreground mb-3">More</h3>
            <div className="flex flex-wrap gap-2">
              {moreLinks.map((item) => (
                <Button key={item.path} variant="outline" size="sm" onClick={() => navigate(item.path)}>
                  <item.icon className="h-3.5 w-3.5 mr-2" />
                  {item.title}
                </Button>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
