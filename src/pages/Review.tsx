import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { ArrowLeft, Check, X, Clock, Filter, CheckCheck, Ban } from "lucide-react";

interface Draft {
  id: string;
  title: string;
  body: string;
  status: string;
  approval_status: string;
  seed_insight: string;
  seed_category: string;
  selected_direction: any;
  created_at: string;
  content_type: string;
  autopilot_template_id?: string;
  autopilot_templates?: {
    name: string;
  };
}

const Review = () => {
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>("pending");
  const [selectedDrafts, setSelectedDrafts] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState<string>("");
  const [rejectNote, setRejectNote] = useState("");

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/auth");
      }
    };
    checkAuth();
    loadDrafts();
  }, [navigate]);

  const loadDrafts = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();

    const { data, error } = await supabase
      .from("drafts")
      .select(`
        *,
        autopilot_templates (
          name
        )
      `)
      .eq("user_id", session?.user?.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error loading drafts:", error);
      toast.error("Failed to load drafts");
    } else {
      setDrafts(data || []);
    }
    setLoading(false);
  };

  const handleApprove = async (draftId: string) => {
    const { error } = await supabase
      .from("drafts")
      .update({
        approval_status: "approved",
        reviewed_at: new Date().toISOString()
      })
      .eq("id", draftId);

    if (error) {
      toast.error("Failed to approve draft");
    } else {
      toast.success("Draft approved!");
      loadDrafts();
      setSelectedDrafts(prev => prev.filter(id => id !== draftId));
    }
  };

  const handleReject = async (draftId: string, note?: string) => {
    const { error } = await supabase
      .from("drafts")
      .update({
        approval_status: "rejected",
        review_notes: note,
        reviewed_at: new Date().toISOString()
      })
      .eq("id", draftId);

    if (error) {
      toast.error("Failed to reject draft");
    } else {
      toast.success("Draft rejected");
      loadDrafts();
      setSelectedDrafts(prev => prev.filter(id => id !== draftId));
      setRejectNote("");
    }
  };

  const handleBulkAction = async () => {
    if (!bulkAction || selectedDrafts.length === 0) {
      toast.error("Please select an action and at least one draft");
      return;
    }

    if (bulkAction === "reject" && !rejectNote.trim()) {
      toast.error("Please provide a reason for rejection");
      return;
    }

    const updates = selectedDrafts.map(draftId => ({
      id: draftId,
      approval_status: bulkAction,
      review_notes: bulkAction === "reject" ? rejectNote : null,
      reviewed_at: new Date().toISOString()
    }));

    for (const update of updates) {
      const { error } = await supabase
        .from("drafts")
        .update({
          approval_status: update.approval_status,
          review_notes: update.review_notes,
          reviewed_at: update.reviewed_at
        })
        .eq("id", update.id);

      if (error) {
        toast.error(`Failed to update draft ${update.id}`);
        return;
      }
    }

    toast.success(`${selectedDrafts.length} drafts ${bulkAction}ed`);
    setSelectedDrafts([]);
    setBulkAction("");
    setRejectNote("");
    loadDrafts();
  };

  const toggleSelectDraft = (draftId: string) => {
    setSelectedDrafts(prev => 
      prev.includes(draftId) 
        ? prev.filter(id => id !== draftId)
        : [...prev, draftId]
    );
  };

  const toggleSelectAll = () => {
    if (selectedDrafts.length === filteredDrafts.length) {
      setSelectedDrafts([]);
    } else {
      setSelectedDrafts(filteredDrafts.map(d => d.id));
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
          <Clock className="h-3 w-3 mr-1" />
          Pending Review
        </Badge>;
      case "approved":
        return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
          <CheckCheck className="h-3 w-3 mr-1" />
          Approved
        </Badge>;
      case "rejected":
        return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
          <Ban className="h-3 w-3 mr-1" />
          Rejected
        </Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  const filteredDrafts = drafts.filter(draft => {
    if (filterStatus === "all") return true;
    return draft.approval_status === filterStatus;
  });

  const pendingCount = drafts.filter(d => d.approval_status === "pending").length;
  const approvedCount = drafts.filter(d => d.approval_status === "approved").length;
  const rejectedCount = drafts.filter(d => d.approval_status === "rejected").length;

  if (loading) {
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
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-1/4 mb-2"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2 mb-8"></div>
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-32 bg-gray-200 rounded mb-4"></div>
            ))}
          </div>
        </main>
      </div>
    );
  }

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
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-2">Review Drafts</h1>
            <p className="text-muted-foreground">
              Manage and approve content from your automations
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-sm text-muted-foreground">
              <span className="text-yellow-600 font-medium">{pendingCount} pending</span>
              {" • "}
              <span className="text-green-600 font-medium">{approvedCount} approved</span>
              {" • "}
              <span className="text-red-600 font-medium">{rejectedCount} rejected</span>
            </div>
          </div>
        </div>

        {/* Bulk Actions */}
        {selectedDrafts.length > 0 && (
          <Card className="mb-6 border-blue-200 bg-blue-50">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={selectedDrafts.length > 0}
                    onCheckedChange={toggleSelectAll}
                  />
                  <span className="text-sm font-medium">
                    {selectedDrafts.length} draft(s) selected
                  </span>
                </div>
                
                <Select value={bulkAction} onValueChange={setBulkAction}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="Action" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="approve">Approve</SelectItem>
                    <SelectItem value="reject">Reject</SelectItem>
                  </SelectContent>
                </Select>

                {bulkAction === "reject" && (
                  <div className="flex-1">
                    <Label htmlFor="reject-note" className="text-sm">Rejection Reason</Label>
                    <Textarea
                      id="reject-note"
                      value={rejectNote}
                      onChange={(e) => setRejectNote(e.target.value)}
                      placeholder="Why are you rejecting these drafts?"
                      className="mt-1"
                      rows={2}
                    />
                  </div>
                )}

                <Button 
                  onClick={handleBulkAction}
                  disabled={!bulkAction || (bulkAction === "reject" && !rejectNote.trim())}
                >
                  Apply to {selectedDrafts.length} draft(s)
                </Button>

                <Button variant="outline" onClick={() => setSelectedDrafts([])}>
                  Clear
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Drafts</SelectItem>
                  <SelectItem value="pending">Pending Review</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Drafts List */}
        {filteredDrafts.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12">
              <CheckCheck className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">
                {filterStatus === "pending" ? "No drafts pending review" : "No drafts found"}
              </h3>
              <p className="text-muted-foreground mb-6">
                {filterStatus === "pending" 
                  ? "New drafts from your automations will appear here for review."
                  : "Try adjusting your filters to see more drafts."}
              </p>
              <Button onClick={() => navigate("/autopilot")}>
                Manage Automations
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredDrafts.map((draft) => (
              <Card key={draft.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <Checkbox
                      checked={selectedDrafts.includes(draft.id)}
                      onCheckedChange={() => toggleSelectDraft(draft.id)}
                      className="mt-1"
                    />
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex-1">
                          <h3 className="font-semibold text-lg mb-2">{draft.title || draft.seed_insight}</h3>
                          <div className="flex flex-wrap gap-2 items-center mb-3">
                            {getStatusBadge(draft.approval_status)}
                            {draft.autopilot_templates && (
                              <Badge variant="secondary">
                                From: {draft.autopilot_templates.name}
                              </Badge>
                            )}
                            <Badge variant="outline">
                              {draft.content_type || "blog_post"}
                            </Badge>
                          </div>
                        </div>
                        
                        {draft.approval_status === "pending" && (
                          <div className="flex gap-2 ml-4">
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-red-600 border-red-200 hover:bg-red-50"
                              onClick={() => {
                                const note = prompt("Reason for rejection (optional):");
                                handleReject(draft.id, note || "");
                              }}
                            >
                              <X className="h-4 w-4 mr-1" />
                              Reject
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handleApprove(draft.id)}
                            >
                              <Check className="h-4 w-4 mr-1" />
                              Approve
                            </Button>
                          </div>
                        )}
                      </div>
                      
                      <div className="prose prose-sm max-w-none mb-4">
                        <div dangerouslySetInnerHTML={{ __html: draft.body.replace(/\n/g, '<br/>') }} />
                      </div>

                      {draft.selected_direction && (
                        <div className="text-sm text-muted-foreground border-t pt-3">
                          <strong>Direction:</strong> {draft.selected_direction.angle}
                        </div>
                      )}
                      
                      <div className="text-xs text-muted-foreground mt-3">
                        Created {new Date(draft.created_at).toLocaleDateString()}
                        {draft.approval_status !== "pending" && (
                          <span className="ml-2">
                            • {draft.approval_status} on {new Date(draft.reviewed_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default Review;