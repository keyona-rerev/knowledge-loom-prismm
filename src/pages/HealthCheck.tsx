import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { HealthTab } from "@/components/review/HealthTab";

// Standalone page, not a Review tab — sits alongside Review in the
// Dashboard's Review column as its own subpage, since newsletter source
// health is a distinct concern from draft approval even though both feed
// off the same content pipeline.
const HealthCheck = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <Button variant="ghost" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="mr-2 h-4 w-4" />Back to Dashboard
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-5xl">
        <h1 className="text-3xl font-bold mb-2">Health check</h1>
        <p className="text-muted-foreground mb-6">How your newsletter sources are performing over time.</p>
        <HealthTab />
      </main>
    </div>
  );
};

export default HealthCheck;
