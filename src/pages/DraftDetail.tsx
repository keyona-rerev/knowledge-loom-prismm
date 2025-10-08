import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ArrowLeft, FileText, Clock, Edit, Save } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const DraftDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editedBody, setEditedBody] = useState("");

  const loadDraft = async () => {
    if (!id) return;

    const { data, error } = await supabase
      .from("drafts")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      toast.error("Failed to load draft");
      navigate("/drafts");
    } else {
      setDraft(data);
      setEditedBody(data.body || "");
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDraft();
  }, [id]);

  const handleSave = async () => {
    if (!draft) return;

    const { error } = await supabase
      .from("drafts")
      .update({ 
        body: editedBody,
        updated_at: new Date().toISOString()
      })
      .eq("id", draft.id);

    if (error) {
      toast.error("Failed to save draft");
    } else {
      toast.success("Draft saved");
      setIsEditing(false);
      loadDraft(); // Reload to get updated timestamp
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div>Loading draft...</div>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div>Draft not found</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <Button variant="ghost" onClick={() => navigate("/drafts")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Drafts
          </Button>
          <div className="flex gap-2">
            {isEditing ? (
              <>
                <Button variant="outline" onClick={() => setIsEditing(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSave}>
                  <Save className="mr-2 h-4 w-4" />
                  Save
                </Button>
              </>
            ) : (
              <Button onClick={() => setIsEditing(true)}>
                <Edit className="mr-2 h-4 w-4" />
                Edit
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <Card>
          <CardHeader>
            <div className="flex justify-between items-start">
              <div className="flex-1">
                <CardTitle className="text-2xl">{draft.title || "Untitled Draft"}</CardTitle>
                <CardDescription className="mt-1 flex items-center gap-2">
                  <Clock className="h-3 w-3" />
                  Last updated {formatDistanceToNow(new Date(draft.updated_at), { addSuffix: true })}
                </CardDescription>
              </div>
              <FileText className="h-6 w-6 text-muted-foreground" />
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <Badge variant="default">
                {draft.status.replace("_", " ")}
              </Badge>
              <Badge variant="outline">
                {draft.content_type || "ad-hoc"}
              </Badge>
              {draft.revision_count > 0 && (
                <Badge variant="secondary">
                  v{draft.revision_count + 1}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {draft.seed_insight && (
              <div>
                <h3 className="font-semibold mb-2">Seed Insight</h3>
                <p className="text-sm text-muted-foreground p-3 bg-muted rounded-lg">
                  {draft.seed_insight}
                </p>
              </div>
            )}

            <div>
              <h3 className="font-semibold mb-2">Content</h3>
              {isEditing ? (
                <Textarea
                  value={editedBody}
                  onChange={(e) => setEditedBody(e.target.value)}
                  rows={20}
                  className="font-mono text-sm"
                />
              ) : (
                <div className="p-4 bg-muted rounded-lg whitespace-pre-wrap font-mono text-sm">
                  {draft.body}
                </div>
              )}
            </div>

            {draft.selected_direction && (
              <div>
                <h3 className="font-semibold mb-2">Selected Direction</h3>
                <Card>
                  <CardContent className="p-4">
                    <h4 className="font-semibold mb-1">{draft.selected_direction.title}</h4>
                    <p className="text-sm text-muted-foreground mb-1">
                      {draft.selected_direction.description}
                    </p>
                    <p className="text-xs text-muted-foreground italic">
                      Angle: {draft.selected_direction.angle}
                    </p>
                  </CardContent>
                </Card>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default DraftDetail;
