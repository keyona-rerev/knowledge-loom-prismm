import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Sparkles } from "lucide-react";

const CreateContent = () => {
  const navigate = useNavigate();
  const [seedInsight, setSeedInsight] = useState("");
  const [seedCategory, setSeedCategory] = useState<string>("thesis");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"input" | "directions" | "cards">("input");

  useEffect(() => {
    const checkAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        navigate("/auth");
      }
    };
    checkAuth();
  }, [navigate]);

  const [directions, setDirections] = useState<any[]>([]);

  const handleGenerateDirections = async () => {
    if (!seedInsight.trim()) {
      toast.error("Please enter your insight");
      return;
    }

    setLoading(true);
    toast.info("Generating content directions...");

    const {
      data: { session },
    } = await supabase.auth.getSession();

    const { data, error } = await supabase.functions.invoke("generate-content-directions", {
      body: {
        seedInsight,
        seedCategory,
        userId: session?.user?.id,
      },
    });

    setLoading(false);

    if (error || !data) {
      toast.error("Failed to generate directions: " + (error?.message || "Unknown error"));
    } else {
      setDirections(data.directions || []);
      setStep("directions");
      toast.success("Directions generated!");
    }
  };

  const handleSelectDirection = async (direction: any) => {
    setLoading(true);
    toast.info("Creating draft from selected direction...");

    const {
      data: { session },
    } = await supabase.auth.getSession();

    try {
      // Try different content_type values that might be allowed
      const { data: draftData, error } = await supabase
        .from("drafts")
        .insert({
          title: direction.title,
          body: `# ${direction.title}\n\n${direction.description}\n\n**Angle:** ${direction.angle}\n\n**Original Insight:** ${seedInsight}`,
          status: "draft",
          user_id: session?.user?.id,
          seed_insight: seedInsight,
          seed_category: seedCategory,
          selected_direction: direction,
          content_type: "blog_post", // Try this common value
          revision_count: 0,
        })
        .select()
        .single();

      if (error) {
        // If that fails, try without content_type
        const { data: draftData2, error: error2 } = await supabase
          .from("drafts")
          .insert({
            title: direction.title,
            body: `# ${direction.title}\n\n${direction.description}\n\n**Angle:** ${direction.angle}\n\n**Original Insight:** ${seedInsight}`,
            status: "draft",
            user_id: session?.user?.id,
            seed_insight: seedInsight,
            seed_category: seedCategory,
            selected_direction: direction,
            revision_count: 0,
            // Omit content_type entirely
          })
          .select()
          .single();

        if (error2) {
          throw error2;
        }

        toast.success("Draft created successfully!");
        navigate("/drafts");
      } else {
        toast.success("Draft created successfully!");
        navigate("/drafts");
      }
    } catch (error) {
      console.error("Failed to create draft:", error);
      toast.error("Failed to create draft: " + (error as any)?.message);
    } finally {
      setLoading(false);
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

      <main className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Create Content</h1>
          <p className="text-muted-foreground">Start with your seed insight</p>
        </div>

        {step === "input" && (
          <Card>
            <CardHeader>
              <CardTitle>Seed Insight</CardTitle>
              <CardDescription>What's the core idea you want to explore?</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="insight">Your Insight</Label>
                <Textarea
                  id="insight"
                  value={seedInsight}
                  onChange={(e) => setSeedInsight(e.target.value)}
                  placeholder="Enter your core idea, observation, or thesis..."
                  rows={6}
                  className="mt-2"
                />
              </div>

              <div>
                <Label htmlFor="category">Insight Type</Label>
                <Select value={seedCategory} onValueChange={setSeedCategory}>
                  <SelectTrigger id="category" className="mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="thesis">Thesis Statement</SelectItem>
                    <SelectItem value="hook">Hook / Attention Grabber</SelectItem>
                    <SelectItem value="closing">Closing Statement</SelectItem>
                    <SelectItem value="contrarian">Contrarian Argument</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button onClick={handleGenerateDirections} disabled={loading} className="w-full" size="lg">
                <Sparkles className="mr-2 h-5 w-5" />
                {loading ? "Generating..." : "Generate Content Directions"}
              </Button>
            </CardContent>
          </Card>
        )}

        {step === "directions" && (
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <div>
                  <CardTitle>Content Directions</CardTitle>
                  <CardDescription>Select the direction that resonates most</CardDescription>
                </div>
                <Button variant="outline" onClick={() => setStep("input")}>
                  Back
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {directions.map((dir, i) => (
                  <Card
                    key={i}
                    className="cursor-pointer hover:border-primary transition-colors"
                    onClick={() => handleSelectDirection(dir)}
                  >
                    <CardContent className="p-4">
                      <h3 className="font-semibold mb-2">{dir.title}</h3>
                      <p className="text-sm text-muted-foreground mb-2">{dir.description}</p>
                      <p className="text-xs text-muted-foreground italic">Angle: {dir.angle}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
};

export default CreateContent;
