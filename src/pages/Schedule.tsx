import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, CalendarClock, CalendarDays, Send } from "lucide-react";
import { CadenceTab } from "@/components/schedule/CadenceTab";
import { WeeklyCalendar } from "@/components/calendar/WeeklyCalendar";
import { PostedTab } from "@/components/schedule/PostedTab";

const VALID_TABS = ["cadence", "upcoming", "posted"];

const Schedule = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab = VALID_TABS.includes(tabParam || "") ? tabParam! : "cadence";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <Button variant="ghost" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="mr-2 h-4 w-4" />Back to dashboard
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-5xl">
        <h1 className="text-3xl font-bold mb-6">Schedule</h1>

        <Tabs value={activeTab} onValueChange={(v) => setSearchParams({ tab: v })}>
          <TabsList className="mb-6">
            <TabsTrigger value="cadence"><CalendarClock className="h-4 w-4 mr-2" />Cadence</TabsTrigger>
            <TabsTrigger value="upcoming"><CalendarDays className="h-4 w-4 mr-2" />Upcoming</TabsTrigger>
            <TabsTrigger value="posted"><Send className="h-4 w-4 mr-2" />Posted</TabsTrigger>
          </TabsList>

          <TabsContent value="cadence">
            <CadenceTab />
          </TabsContent>

          <TabsContent value="upcoming">
            <div className="-mx-4">
              <WeeklyCalendar />
            </div>
          </TabsContent>

          <TabsContent value="posted">
            <PostedTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Schedule;
