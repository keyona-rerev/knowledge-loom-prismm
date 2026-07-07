import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Clock, CheckCheck, Ban } from "lucide-react";
import { PendingTab } from "@/components/review/PendingTab";
import { ApprovedTab } from "@/components/review/ApprovedTab";
import { RejectedTab } from "@/components/review/RejectedTab";

const VALID_TABS = ["pending", "approved", "rejected"];

const Review = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab = VALID_TABS.includes(tabParam || "") ? tabParam! : "pending";

  const [counts, setCounts] = useState({ pending: 0, scheduled: 0, rejected: 0, needsRevision: 0 });

  useEffect(() => {
    const checkAuthAndLoadCounts = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/auth"); return; }
      const { data, error } = await supabase
        .from("drafts")
        .select("approval_status, publish_status, scheduled_for")
        .eq("user_id", session.user.id);
      if (!error && data) {
        // approval_status stays "approved" forever, even after a draft has
        // actually posted (published_now) or is stuck (needs_attention /
        // failed / never reached the scheduler at all) — so a raw count of
        // approval_status === "approved" is a lifetime total that only ever
        // grows, not "how many are actually still queued up to go out."
        // What matters here is genuinely scheduled AND still in the future
        // relative to right now (computed fresh on every load, not pinned
        // to any particular date) — the same definition ScheduleCalendar's
        // header badge uses.
        const nowMs = Date.now();
        const isScheduledForFuture = (d: { approval_status: string; publish_status: string | null; scheduled_for: string | null }) =>
          d.approval_status === "approved" &&
          d.publish_status === "scheduled" &&
          !!d.scheduled_for &&
          new Date(d.scheduled_for).getTime() > nowMs;

        setCounts({
          pending: data.filter(d => d.approval_status === "pending").length,
          scheduled: data.filter(isScheduledForFuture).length,
          rejected: data.filter(d => d.approval_status === "rejected").length,
          needsRevision: data.filter(d => d.approval_status === "needs_revision").length,
        });
      }
    };
    checkAuthAndLoadCounts();
  }, [navigate, activeTab]);

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
        <div className="flex justify-between items-start mb-6 flex-wrap gap-2">
          <div>
            <h1 className="text-3xl font-bold mb-2">Review</h1>
            <p className="text-muted-foreground">Manage and approve content from your automations</p>
          </div>
          <div className="text-sm text-muted-foreground">
            <span className="text-yellow-600 font-medium">{counts.pending} pending</span>{" • "}
            <span className="text-green-600 font-medium">{counts.scheduled} scheduled</span>{" • "}
            <span className="text-red-600 font-medium">{counts.rejected} rejected</span>
            {counts.needsRevision > 0 && (<>{" • "}<span className="text-blue-600 font-medium">{counts.needsRevision} needs revision</span></>)}
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setSearchParams({ tab: v })}>
          <TabsList className="mb-6">
            <TabsTrigger value="pending"><Clock className="h-4 w-4 mr-2" />Pending</TabsTrigger>
            <TabsTrigger value="approved"><CheckCheck className="h-4 w-4 mr-2" />Approved</TabsTrigger>
            <TabsTrigger value="rejected"><Ban className="h-4 w-4 mr-2" />Rejected</TabsTrigger>
          </TabsList>

          <TabsContent value="pending">
            <PendingTab />
          </TabsContent>

          <TabsContent value="approved">
            <ApprovedTab />
          </TabsContent>

          <TabsContent value="rejected">
            <RejectedTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Review;
