import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Rss, FileEdit, Settings, MessageCircleQuestion, LogOut,
  CheckCheck, Lightbulb, Target, CalendarClock, AlertTriangle, Database, Plus, ChevronDown,
} from "lucide-react";
import { InstructionsToggle } from "@/components/InstructionsToggle";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useState, useEffect } from "react";

const Dashboard = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    pendingReviews: 0,
    approvedDrafts: 0,
    minApprovedThreshold: 12,
  });
  const [loading, setLoading] = useState(true);
  const [flaggedNewsletters, setFlaggedNewsletters] = useState<any[]>([]);
  const [healthOpen, setHealthOpen] = useState(false);
  const [brandColors, setBrandColors] = useState({
    primary_color: "#f9655b",
    secondary_color: "#6658ea",
    accent_color: "#f5c070",
  });

  useEffect(() => {
    loadDashboardStats();
    loadNewsletterHealth();
    loadBrandColors();
  }, []);

  const loadBrandColors = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const { data } = await supabase
      .from("profiles")
      .select("primary_color, secondary_color, accent_color")
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (data) {
      setBrandColors({
        primary_color: data.primary_color || "#f9655b",
        secondary_color: data.secondary_color || "#6658ea",
        accent_color: data.accent_color || "#f5c070",
      });
    }
  };

  const loadNewsletterHealth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const { data, error } = await supabase
      .from("newsletter_health")
      .select("sender_address, avg_score, card_count, recommendation, reason")
      .eq("user_id", session.user.id)
      .neq("recommendation", "healthy")
      .order("avg_score", { ascending: true });
    if (error) { console.error("Failed to load newsletter health:", error); return; }
    setFlaggedNewsletters(data || []);
  };

  const loadDashboardStats = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      setLoading(false);
      return;
    }
    const userId = session.user.id;

    try {
      const isPosted = (d: { publish_status: string | null; scheduled_for: string | null }) =>
        d.publish_status === "published_now" ||
        (d.publish_status === "scheduled" && !!d.scheduled_for && new Date(d.scheduled_for).getTime() < Date.now());

      const [
        { data: allDrafts, error: draftsError },
        { data: profile, error: profileError },
      ] = await Promise.all([
        supabase.from("drafts").select("id, approval_status, publish_status, scheduled_for")
          .eq("user_id", userId),
        supabase.from("profiles").select("min_approved_threshold")
          .eq("user_id", userId).maybeSingle(),
      ]);
      if (draftsError) throw draftsError;
      if (profileError) throw profileError;

      const drafts = allDrafts || [];
      const pendingReviews = drafts.filter(d => d.approval_status === "pending" || d.approval_status === "needs_revision").length;
      // "Approved" here means still waiting to go out. approval_status stays
      // "approved" forever, even after publish_status flips to published_now,
      // so without excluding already-posted drafts this count (and the
      // threshold banner built on it) would only ever grow and never reflect
      // an actually-thinning queue.
      const approvedDrafts = drafts.filter(d => d.approval_status === "approved" && !isPosted(d)).length;

      setStats({
        pendingReviews,
        approvedDrafts,
        minApprovedThreshold: (profile as any)?.min_approved_threshold ?? 12,
      });
    } catch (error) {
      console.error("Error loading dashboard stats:", error);
      toast.error("Failed to load dashboard stats");
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

  const captureTier = [
    {
      title: "Sources",
      description: "Newsletters, RSS, manual sources, and journal observations — everything that feeds the engine",
      icon: Rss,
      path: "/feeds",
    },
  ];

  const configureTier = [
    {
      title: "Strategy",
      description: "Brand, voice, audience, lanes, and the formats library",
      icon: Target,
      path: "/strategy",
    },
    {
      title: "Schedule",
      description: "Cadence, upcoming posts, and what's already gone out",
      icon: CalendarClock,
      path: "/schedule",
    },
    {
      title: "Settings",
      description: "AI provider, LinkedIn connection, and review pipeline",
      icon: Settings,
      path: "/settings",
    },
  ];

  const moreLinks = [
    { title: "All drafts", path: "/drafts", icon: FileEdit },
    { title: "Reference cards", path: "/cards", icon: Database },
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
1. Set up a source or capture an observation directly in Sources
2. Create content from your insights
3. Approve drafts in Review; approval automatically schedules them to LinkedIn
4. Drag a post to a different day on the Schedule page's Upcoming tab if a time needs to move

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

        {flaggedNewsletters.length > 0 && (
          <Card className="mb-8 border-orange-300 bg-orange-50">
            <Collapsible open={healthOpen} onOpenChange={setHealthOpen}>
              <CollapsibleTrigger asChild>
                <button className="w-full text-left">
                  <CardContent className="p-4 flex items-center gap-3">
                    <AlertTriangle className="h-5 w-5 text-orange-700 shrink-0" />
                    <div className="flex-1">
                      <p className="font-medium text-orange-900">
                        {flaggedNewsletters.length} source{flaggedNewsletters.length === 1 ? "" : "s"} flagged by the weekly health scan
                      </p>
                      <p className="text-sm text-orange-800 mt-0.5">
                        Consistently low relevance to your Strategy page. Checked every 7 days.
                      </p>
                    </div>
                    <ChevronDown className={`h-4 w-4 text-orange-700 shrink-0 transition-transform ${healthOpen ? "rotate-180" : ""}`} />
                  </CardContent>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="px-4 pb-4 pt-0">
                  <div className="space-y-2">
                    {flaggedNewsletters.map((n) => (
                      <div key={n.sender_address} className="flex items-center justify-between gap-3 text-sm bg-white/60 rounded-md px-3 py-2">
                        <div className="min-w-0">
                          <span className="font-medium truncate block">{n.sender_address}</span>
                          <span className="text-orange-800">{n.reason}</span>
                        </div>
                        <Badge
                          variant="outline"
                          className={n.recommendation === "unsubscribe" ? "border-destructive text-destructive shrink-0" : "border-orange-400 text-orange-700 shrink-0"}
                        >
                          {n.recommendation === "unsubscribe" ? "Consider unsubscribing" : "Watch"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => navigate("/feeds")} className="mt-3">
                    Go to Sources
                  </Button>
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Review tier */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <CheckCheck className="h-5 w-5" style={{ color: brandColors.primary_color }} />
              <h3 className="text-xl font-semibold">Review</h3>
            </div>
            <Card
              className={`cursor-pointer hover:shadow-lg transition-shadow ${stats.pendingReviews > 0 ? "border-2 border-yellow-300 bg-yellow-50" : "border"}`}
              style={stats.pendingReviews > 0 ? undefined : { backgroundColor: `${brandColors.primary_color}1a`, borderColor: `${brandColors.primary_color}55` }}
              onClick={() => navigate("/review")}
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg p-2" style={{ backgroundColor: brandColors.primary_color }}>
                      <CheckCheck className="h-6 w-6 text-white" />
                    </div>
                    <CardTitle className="text-lg">Review</CardTitle>
                  </div>
                  {stats.pendingReviews > 0 && (
                    <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
                      {stats.pendingReviews} pending
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription>Pending drafts, approved queue, and the rejection log</CardDescription>
              </CardContent>
            </Card>
          </section>

          {/* Capture tier */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Lightbulb className="h-5 w-5" style={{ color: brandColors.secondary_color }} />
              <h3 className="text-xl font-semibold">Capture</h3>
            </div>
            <div className="space-y-4">
              {captureTier.map((item) => (
                <Card
                  key={item.path}
                  className="cursor-pointer hover:shadow-lg transition-shadow border"
                  style={{ backgroundColor: `${brandColors.secondary_color}1a`, borderColor: `${brandColors.secondary_color}55` }}
                  onClick={() => navigate(item.path)}
                >
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg p-2" style={{ backgroundColor: brandColors.secondary_color }}>
                        <item.icon className="h-6 w-6 text-white" />
                      </div>
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
              <Settings className="h-5 w-5" style={{ color: brandColors.accent_color }} />
              <h3 className="text-xl font-semibold">Configure</h3>
            </div>
            <div className="space-y-4">
              {configureTier.map((item) => (
                <Card
                  key={item.path}
                  className="cursor-pointer hover:shadow-lg transition-shadow border"
                  style={{ backgroundColor: `${brandColors.accent_color}1a`, borderColor: `${brandColors.accent_color}66` }}
                  onClick={() => navigate(item.path)}
                >
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg p-2" style={{ backgroundColor: brandColors.accent_color }}>
                        <item.icon className="h-6 w-6 text-white" />
                      </div>
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
        </div>

        <section className="mt-8">
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
      </main>
    </div>
  );
};

export default Dashboard;
