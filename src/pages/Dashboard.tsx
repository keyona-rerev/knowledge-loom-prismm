import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles, FileText, Settings, Rss, BookOpen, Zap } from "lucide-react";

const Dashboard = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold">Insight Forge</h1>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h2 className="text-3xl font-bold mb-2">Welcome Back</h2>
          <p className="text-muted-foreground">Transform insights into compelling content</p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigate("/create")}>
            <CardHeader>
              <Sparkles className="w-8 h-8 mb-2 text-primary" />
              <CardTitle>Create Content</CardTitle>
              <CardDescription>Start with a seed insight</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Generate targeted content from your ideas with AI-powered direction suggestions
              </p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigate("/autopilot")}>
            <CardHeader>
              <Zap className="w-8 h-8 mb-2 text-primary" />
              <CardTitle>Autopilot Templates</CardTitle>
              <CardDescription>Manage automated content</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Set up and manage up to 12 autopilot templates for scheduled content generation
              </p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigate("/feeds")}>
            <CardHeader>
              <Rss className="w-8 h-8 mb-2 text-primary" />
              <CardTitle>Feed Manager</CardTitle>
              <CardDescription>Manage content sources</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Add, edit, and monitor RSS feeds for passive content curation
              </p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigate("/cards")}>
            <CardHeader>
              <BookOpen className="w-8 h-8 mb-2 text-primary" />
              <CardTitle>Reference Cards</CardTitle>
              <CardDescription>Browse your insights</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                View and edit all reference cards with dual relevance scoring
              </p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigate("/drafts")}>
            <CardHeader>
              <FileText className="w-8 h-8 mb-2 text-primary" />
              <CardTitle>Drafts</CardTitle>
              <CardDescription>Review your content</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Review, rate, and revise all drafts with version history
              </p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigate("/settings")}>
            <CardHeader>
              <Settings className="w-8 h-8 mb-2 text-primary" />
              <CardTitle>Settings</CardTitle>
              <CardDescription>Configure your workspace</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Update business info, insight questions, and card templates
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
};

export default Dashboard;