import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Rss, FileEdit, Settings, MessageCircleQuestion, LogOut,
  CheckCheck, Lightbulb, Target, CalendarClock, AlertTriangle, Database, Plus,
} from "lucide-react";
import { InstructionsToggle } from "@/components/InstructionsToggle";
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
      color: "text-orange-500",
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
      title: "Schedule",
      description: "Cadence, upcoming posts, and what's already gone out",
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

        <div className="space-y-8">
          {/* Review tier */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <CheckCheck className="h-5 w-5 text-primary" />
              <h3 className="text-xl font-semibold">Review</h3>
            </div>
            <div className="max-w-sm">
              <Card
                className={`cursor-pointer hover:shadow-lg transition-shadow ${stats.pendingReviews > 0 ? "border-2 border-yellow-300 bg-yellow-50" : "border-2 border-primary/20"}`}
                onClick={() => navigate("/review")}
              >
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CheckCheck className="h-8 w-8 text-primary" />
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
            </div>
          </section>

          {/* Capture tier */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Lightbulb className="h-5 w-5 text-primary" />
              <h3 className="text-xl font-semibold">Capture</h3>
            </div>
            <div className="grid grid-cols-1 gap-4">
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
