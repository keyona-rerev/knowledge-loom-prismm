// src/pages/ContentCalendar.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Plus } from "lucide-react";
import { WeeklyCalendar } from "@/components/calendar/WeeklyCalendar";
import { useToast } from "@/components/ui/use-toast";

const ContentCalendar = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleNavigateToDrafts = () => {
    navigate("/review");
  };

  const handleNavigateToCreate = () => {
    navigate("/create");
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="border-b bg-white">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button 
                variant="ghost" 
                onClick={() => navigate("/dashboard")}
                className="gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Dashboard
              </Button>
              <div className="h-6 w-px bg-gray-200" />
              <h1 className="text-2xl font-bold text-gray-900">Content Calendar</h1>
            </div>
            
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={handleNavigateToDrafts}
              >
                Review Drafts
              </Button>
              <Button
                onClick={handleNavigateToCreate}
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                Create Content
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Calendar */}
      <main className="container mx-auto">
        <WeeklyCalendar key={refreshTrigger} />
      </main>
    </div>
  );
};

export default ContentCalendar;