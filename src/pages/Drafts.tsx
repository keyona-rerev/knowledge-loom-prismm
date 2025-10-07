import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, FileText, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const Drafts = () => {
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState<any[]>([]);

  const loadDrafts = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      navigate("/auth");
      return;
    }

    const { data, error } = await supabase
      .from("drafts")
      .select("*")
      .eq("user_id", session.user.id)
      .order("updated_at", { ascending: false });

    if (error) {
      toast.error("Failed to load drafts");
    } else {
      setDrafts(data || []);
    }
  };

  useEffect(() => {
    loadDrafts();
  }, [navigate]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "draft": return "default";
      case "in_revision": return "secondary";
      case "final": return "outline";
      case "published": return "default";
      default: return "outline";
    }
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

      <main className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-8">Drafts</h1>

        <div className="grid gap-4">
          {drafts.map((draft) => (
            <Card 
              key={draft.id} 
              className="hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => navigate(`/drafts/${draft.id}`)}
            >
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <CardTitle className="text-xl">{draft.title || "Untitled Draft"}</CardTitle>
                    <CardDescription className="mt-1 flex items-center gap-2">
                      <Clock className="h-3 w-3" />
                      {formatDistanceToNow(new Date(draft.updated_at), { addSuffix: true })}
                    </CardDescription>
                  </div>
                  <FileText className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  <Badge variant={getStatusColor(draft.status)}>
                    {draft.status.replace("_", " ")}
                  </Badge>
                  <Badge variant="outline">
                    {draft.content_type === "autopilot" ? "Autopilot" : "Ad-Hoc"}
                  </Badge>
                  {draft.revision_count > 0 && (
                    <Badge variant="secondary">
                      v{draft.revision_count + 1}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {draft.seed_insight && (
                  <p className="text-sm text-muted-foreground mb-2">
                    <span className="font-medium">Seed: </span>
                    {draft.seed_insight.substring(0, 150)}...
                  </p>
                )}
                {draft.body && (
                  <p className="text-sm line-clamp-2">
                    {draft.body.substring(0, 200)}...
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {drafts.length === 0 && (
          <div className="text-center py-12">
            <FileText className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No drafts yet</h3>
            <p className="text-muted-foreground mb-4">
              Create your first piece of content to see it here
            </p>
            <Button onClick={() => navigate("/create")}>
              Create Content
            </Button>
          </div>
        )}
      </main>
    </div>
  );
};

export default Drafts;