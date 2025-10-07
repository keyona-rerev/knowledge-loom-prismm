import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Sparkles, Rss, Database, FileEdit, Settings, Plus, MessageCircleQuestion } from "lucide-react";
import { InstructionsToggle } from "@/components/InstructionsToggle";

const Dashboard = () => {
  const navigate = useNavigate();

  const gettingStarted = [
    {
      title: "Feed Manager",
      description: "Add RSS feeds or manually create sources",
      icon: Rss,
      path: "/feeds",
      color: "text-orange-500",
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
        <div className="container mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold">Insight Forge</h1>
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
2. Configure questions to extract insights from content
3. Create content using your collected insights

The dashboard is organized into sections to help you navigate easily.`}
        />

        <div className="space-y-8">
          {/* Getting Started Section */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Plus className="h-5 w-5 text-primary" />
              <h3 className="text-xl font-semibold">Getting Started</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
