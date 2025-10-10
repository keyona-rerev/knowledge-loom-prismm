import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, FileText, Sparkles, Rss, Database, FileEdit, Settings, Plus, MessageCircleQuestion, LogOut, CheckCheck, Clock, Ban, Lightbulb } from "lucide-react";import { InstructionsToggle } from "@/components/InstructionsToggle";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useState, useEffect } from "react";

const Dashboard = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    pendingReviews: 0,
    approvedDrafts: 0,
    rejectedDrafts: 0,
    totalInsights: 0,
    activeTemplates: 0,
    scheduledCount: 0 // ✅ Add this
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardStats();
  }, []);

  const loadDashboardStats = async () => {
    
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();

    try {
      // Get draft counts by approval status
      const { data: drafts, error: draftsError } = await supabase
        .from("drafts")
        .select("approval_status")
        .eq("user_id", session?.user?.id);

      if (draftsError) throw draftsError;

      const pendingReviews = drafts?.filter(d => d.approval_status === "pending").length || 0;
      const approvedDrafts = drafts?.filter(d => d.approval_status === "approved").length || 0;
      const rejectedDrafts = drafts?.filter(d => d.approval_status === "rejected").length || 0;

      // Get insight cards count
      const { data: insights, error: insightsError } = await supabase
        .from("insight_cards")
        .select("id")
        .eq("user_id", session?.user?.id)
        .eq("status", "active");

      if (insightsError && insightsError.code !== '42P01') throw insightsError;

      // Get active templates count
      const { data: templates, error: templatesError } = await supabase
        .from("autopilot_templates")
        .select("id")
        .eq("user_id", session?.user?.id)
        .eq("is_active", true);

      if (templatesError) throw templatesError;

         // ✅ GET SCHEDULED CONTENT COUNT - ADD THIS BEFORE setStats
      const { data: scheduled, error: scheduledError } = await supabase
        .from("content_calendar")
        .select("id")
        .eq("user_id", session?.user?.id)
        .eq("status", "scheduled");

      setStats({
        pendingReviews,
        approvedDrafts,
        rejectedDrafts,
        totalInsights: insights?.length || 0,
        activeTemplates: templates?.length || 0,
        scheduledCount: scheduled?.length || 0 // ✅ Add this
      });
    } catch (error) {
      console.error("Error loading dashboard stats:", error);
    } finally {
      setLoading(false);
    }
          // Get scheduled content count
      const { data: scheduled, error: scheduledError } = await supabase
        .from("content_calendar")
        .select("id")
        .eq("user_id", session?.user?.id)
        .eq("status", "scheduled");

    
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

  const approvalPipeline = [
    {
      title: "Pending Review",
      count: stats.pendingReviews,
      description: "Drafts awaiting your approval",
      icon: Clock,
      path: "/review",
      color: "text-yellow-500",
      badgeVariant: "outline" as const,
      badgeClass: "bg-yellow-50 text-yellow-700 border-yellow-200"
    },
    {
      title: "Approved",
      count: stats.approvedDrafts,
      description: "Drafts ready for publishing",
      icon: CheckCheck,
      path: "/drafts",
      color: "text-green-500",
      badgeVariant: "outline" as const,
      badgeClass: "bg-green-50 text-green-700 border-green-200"
    },
    {
      title: "Rejected",
      count: stats.rejectedDrafts,
      description: "Drafts that need revision",
      icon: Ban,
      path: "/drafts",
      color: "text-red-500",
      badgeVariant: "outline" as const,
      badgeClass: "bg-red-50 text-red-700 border-red-200"
    }
  ];

  const gettingStarted = [
    {
      title: "Feed Manager",
      description: "Add RSS feeds or manually create sources",
      icon: Rss,
      path: "/feeds",
      color: "text-orange-500",
    },
    {
      title: "Observation Journal",
      description: "Capture and manage your insights",
      icon: Lightbulb,
      path: "/insights",
      color: "text-amber-500",
    },
    {
      title: "Question Settings",
      description: "Configure questions for extracting insights",
      icon: MessageCircleQuestion,
      path: "/questions",
      color: "text-cyan-500",
    },
    {
      title: "Create Content",
      description: "Generate new content from your insights",
      icon: FileText,
      path: "/create",
      color: "text-blue-500",
    },
  ];

  const existingContent = [
    {
      title: "Reference Cards",
      description: "View and manage your reference cards",
      icon: Database,
      path: "/cards",
      color: "text-green-500",
    },
    {
      title: "Drafts",
      description: "View and edit your drafts",
      icon: FileEdit,
      path: "/drafts",
      color: "text-yellow-500",
    
    },
    
  ];

  const automation = [
    {
      title: "Autopilot Templates",
      description: "Set up automated content generation",
      icon: Sparkles,
      path: "/autopilot",
      color: "text-purple-500",
    },
    {
      title: "Review Queue",
      description: "Approve or reject automated drafts",
      icon: CheckCheck,
      path: "/review",
      color: "text-blue-500",
    },
    {
      title: "Content Calendar",
      description: "Schedule and visualize your content pipeline",
      icon: Calendar,
      path: "/calendar",
      color: "text-blue-500",
    },
  ];

  const configuration = [
    {
      title: "Settings",
      description: "Configure your business profile and preferences",
      icon: Settings,
      path: "/settings",
      color: "text-gray-500",
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-6 flex justify-between items-center">
          <h1 className="text-3xl font-bold">Insight Forge</h1>
          <Button variant="ghost" onClick={handleLogout}>
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
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
          instructions={`Getting Started:
1. Add your first RSS feed or create a manual source
2. Capture insights in your Observation Journal
3. Configure questions to extract insights from content
4. Create content using your collected insights
5. Set up automations and review generated drafts

The dashboard shows your content pipeline and quick access to all features.`}
        />

        <div className="space-y-8">
          {/* Approval Pipeline Section */}
          {stats.pendingReviews > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <CheckCheck className="h-5 w-5 text-primary" />
                <h3 className="text-xl font-semibold">Approval Pipeline</h3>
                {stats.pendingReviews > 0 && (
                  <Badge variant="destructive" className="ml-2">
                    {stats.pendingReviews} needs attention
                  </Badge>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {approvalPipeline.map((item) => (
                  <Card
                    key={item.path}
                    className={`cursor-pointer hover:shadow-lg transition-shadow ${
                      item.title === "Pending Review" && item.count > 0 
                        ? "border-2 border-yellow-300 bg-yellow-50" 
                        : "border-2 border-primary/20"
                    }`}
                    onClick={() => navigate(item.path)}
                  >
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <item.icon className={`h-8 w-8 ${item.color}`} />
                          <CardTitle className="text-lg">{item.title}</CardTitle>
                        </div>
                        <Badge 
                          variant={item.badgeVariant} 
                          className={item.badgeClass}
                        >
                          {item.count}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <CardDescription>{item.description}</CardDescription>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {/* Quick Stats */}
          <section>
            <h3 className="text-xl font-semibold mb-4">At a Glance</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold text-blue-600">{stats.totalInsights}</div>
                  <div className="text-sm text-muted-foreground">Insight Cards</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold text-purple-600">{stats.activeTemplates}</div>
                  <div className="text-sm text-muted-foreground">Active Automations</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold text-yellow-600">{stats.pendingReviews}</div>
                  <div className="text-sm text-muted-foreground">Pending Reviews</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold text-green-600">{stats.approvedDrafts}</div>
                  <div className="text-sm text-muted-foreground">Approved Drafts</div>
                </CardContent>
              </Card>
              // In the Quick Stats section, add this card:
              <Card>
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold text-orange-600">{stats.scheduledCount || 0}</div>
                  <div className="text-sm text-muted-foreground">Scheduled Posts</div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="mt-2 w-full"
                    onClick={() => navigate('/calendar')}
                  >
                    View Calendar
                  </Button>
                </CardContent>
              </Card>
            </div>
          </section>

          {/* Getting Started Section */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Plus className="h-5 w-5 text-primary" />
              <h3 className="text-xl font-semibold">Getting Started</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {gettingStarted.map((item) => (
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

          {/* Existing Content Section */}
          <section>
            <h3 className="text-xl font-semibold mb-4">Your Content</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {existingContent.map((item) => (
                <Card
                  key={item.path}
                  className="cursor-pointer hover:shadow-lg transition-shadow"
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

          {/* Automation Section */}
          <section>
            <h3 className="text-xl font-semibold mb-4">Automation</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {automation.map((item) => (
                <Card
                  key={item.path}
                  className="cursor-pointer hover:shadow-lg transition-shadow"
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

          {/* Configuration Section */}
          <section>
            <h3 className="text-xl font-semibold mb-4">Configuration</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {configuration.map((item) => (
                <Card
                  key={item.path}
                  className="cursor-pointer hover:shadow-lg transition-shadow"
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
        </div>
      </main>
    </div>
  );
};

export default Dashboard;