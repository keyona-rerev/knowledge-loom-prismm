// src/pages/ContentCalendar.tsx
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Plus } from "lucide-react";
import { WeeklyCalendar } from "@/components/calendar/WeeklyCalendar";

const ContentCalendar = () => {
  const navigate = useNavigate();

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
                Back to dashboard
              </Button>
              <div className="h-6 w-px bg-gray-200" />
              <h1 className="text-2xl font-bold text-gray-900">Content calendar</h1>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => navigate("/review")}
              >
                Review drafts
              </Button>
              <Button
                onClick={() => navigate("/create")}
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                Create content
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Real schedule, sourced from drafts + content_schedules */}
      <main className="container mx-auto">
        <WeeklyCalendar />
      </main>
    </div>
  );
};

export default ContentCalendar;
