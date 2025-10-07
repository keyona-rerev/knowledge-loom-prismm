import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ArrowLeft, Plus, Edit, Trash2, ToggleLeft, ToggleRight } from "lucide-react";

const Feeds = () => {
  const navigate = useNavigate();
  const [feeds, setFeeds] = useState<any[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingFeed, setEditingFeed] = useState<any>(null);
  const [formData, setFormData] = useState({
    name: "",
    url: "",
    credibility_score: 5,
    topic_keywords: ""
  });

  const loadFeeds = async () => {
    const { data, error } = await supabase
      .from("source_feeds")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to load feeds");
    } else {
      setFeeds(data || []);
    }
  };

  useEffect(() => {
    loadFeeds();
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const keywords = formData.topic_keywords.split(",").map(k => k.trim()).filter(Boolean);

    if (editingFeed) {
      const { error } = await supabase
        .from("source_feeds")
        .update({
          name: formData.name,
          url: formData.url,
          credibility_score: formData.credibility_score,
          topic_keywords: keywords
        })
        .eq("id", editingFeed.id);

      if (error) {
        toast.error("Failed to update feed");
      } else {
        toast.success("Feed updated successfully");
        setIsDialogOpen(false);
        loadFeeds();
      }
    } else {
      const { error } = await supabase
        .from("source_feeds")
        .insert([{
          name: formData.name,
          url: formData.url,
          credibility_score: formData.credibility_score,
          topic_keywords: keywords
        }]);

      if (error) {
        toast.error("Failed to add feed");
      } else {
        toast.success("Feed added successfully");
        setIsDialogOpen(false);
        loadFeeds();
      }
    }

    setFormData({ name: "", url: "", credibility_score: 5, topic_keywords: "" });
    setEditingFeed(null);
  };

  const toggleFeed = async (feed: any) => {
    const { error } = await supabase
      .from("source_feeds")
      .update({ is_active: !feed.is_active })
      .eq("id", feed.id);

    if (error) {
      toast.error("Failed to toggle feed");
    } else {
      toast.success(feed.is_active ? "Feed disabled" : "Feed enabled");
      loadFeeds();
    }
  };

  const deleteFeed = async (id: string) => {
    const { error } = await supabase
      .from("source_feeds")
      .delete()
      .eq("id", id);

    if (error) {
      toast.error("Failed to delete feed");
    } else {
      toast.success("Feed deleted");
      loadFeeds();
    }
  };

  const openEditDialog = (feed: any) => {
    setEditingFeed(feed);
    setFormData({
      name: feed.name,
      url: feed.url,
      credibility_score: feed.credibility_score,
      topic_keywords: feed.topic_keywords?.join(", ") || ""
    });
    setIsDialogOpen(true);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <Button variant="ghost" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => { setEditingFeed(null); setFormData({ name: "", url: "", credibility_score: 5, topic_keywords: "" }); }}>
                <Plus className="mr-2 h-4 w-4" />
                Add Feed
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingFeed ? "Edit Feed" : "Add New Feed"}</DialogTitle>
                <DialogDescription>Configure your RSS feed source</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="name">Feed Name</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="url">Feed URL</Label>
                  <Input
                    id="url"
                    type="url"
                    value={formData.url}
                    onChange={(e) => setFormData(prev => ({ ...prev, url: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="credibility">Credibility Score (1-10)</Label>
                  <Input
                    id="credibility"
                    type="number"
                    min="1"
                    max="10"
                    value={formData.credibility_score}
                    onChange={(e) => setFormData(prev => ({ ...prev, credibility_score: parseInt(e.target.value) }))}
                  />
                </div>
                <div>
                  <Label htmlFor="keywords">Topic Keywords (comma-separated)</Label>
                  <Input
                    id="keywords"
                    value={formData.topic_keywords}
                    onChange={(e) => setFormData(prev => ({ ...prev, topic_keywords: e.target.value }))}
                    placeholder="AI, Technology, Healthcare"
                  />
                </div>
                <Button type="submit" className="w-full">
                  {editingFeed ? "Update Feed" : "Add Feed"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-8">Feed Manager</h1>

        <div className="grid gap-4">
          {feeds.map((feed) => (
            <Card key={feed.id}>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle>{feed.name}</CardTitle>
                    <CardDescription className="mt-1">{feed.url}</CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="icon" onClick={() => toggleFeed(feed)}>
                      {feed.is_active ? <ToggleRight className="h-5 w-5 text-primary" /> : <ToggleLeft className="h-5 w-5" />}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => openEditDialog(feed)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteFeed(feed.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2 mb-2">
                  <Badge variant={feed.health_status === "healthy" ? "default" : "destructive"}>
                    {feed.health_status}
                  </Badge>
                  <Badge variant="outline">Credibility: {feed.credibility_score}/10</Badge>
                  {feed.topic_keywords?.map((keyword: string) => (
                    <Badge key={keyword} variant="secondary">{keyword}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
};

export default Feeds;