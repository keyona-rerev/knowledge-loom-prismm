import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, RefreshCw, HeartPulse, Rss } from "lucide-react";

interface HealthRow {
  id: string;
  sender_address: string;
  card_count: number;
  avg_score: number | null;
  last_score: number | null;
  recommendation: "healthy" | "watch" | "unsubscribe";
  reason: string | null;
  last_scanned_at: string | null;
}

const ALL = "__all__";

// Health tab: every newsletter sender that's produced reference cards
// recently, not just the ones the weekly cron happened to flag. Dashboard's
// banner only ever surfaces the flagged subset as a passive heads-up; this
// is the actual place to review the full picture and re-run the check
// on-demand rather than waiting for next Monday's cron.
export const HealthTab = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<HealthRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [filter, setFilter] = useState<string>(ALL);

  useEffect(() => {
    loadHealth();
  }, []);

  const loadHealth = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setLoading(false); return; }
    const { data, error } = await supabase
      .from("newsletter_health")
      .select("id, sender_address, card_count, avg_score, last_score, recommendation, reason, last_scanned_at")
      .eq("user_id", session.user.id)
      .order("avg_score", { ascending: true, nullsFirst: false });
    if (error) {
      toast.error("Failed to load newsletter health");
    } else {
      setRows((data || []) as HealthRow[]);
    }
    setLoading(false);
  };

  const handleScanNow = async () => {
    setScanning(true);
    try {
      const { data, error } = await supabase.functions.invoke("scan-newsletter-health", { body: {} });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!data?.sendersScanned) {
        toast.info("No newsletter senders found in the last 60 days to scan.");
      } else {
        toast.success(`Scanned ${data.sendersScanned} sender(s), ${data.flagged ?? 0} flagged.`);
      }
      await loadHealth();
    } catch (err: any) {
      toast.error("Scan failed: " + err.message);
    } finally {
      setScanning(false);
    }
  };

  const meta = {
    unsubscribe: { label: "Unsubscribe", badgeClass: "border-destructive text-destructive bg-red-50", icon: AlertTriangle },
    watch: { label: "Watch", badgeClass: "border-orange-400 text-orange-700 bg-orange-50", icon: AlertTriangle },
    healthy: { label: "Healthy", badgeClass: "border-green-400 text-green-700 bg-green-50", icon: CheckCircle2 },
  } as const;

  const visibleRows = filter === ALL ? rows : rows.filter((r) => r.recommendation === filter);
  const counts = {
    unsubscribe: rows.filter((r) => r.recommendation === "unsubscribe").length,
    watch: rows.filter((r) => r.recommendation === "watch").length,
    healthy: rows.filter((r) => r.recommendation === "healthy").length,
  };

  if (loading) {
    return <div className="text-center py-16 text-muted-foreground">Loading newsletter health...</div>;
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            Every newsletter sender that's produced reference cards in the last 60 days, rolled up by average relevance score. Automatic sweep runs weekly, every Monday.
          </p>
        </div>
        <Button size="sm" onClick={handleScanNow} disabled={scanning} className="shrink-0">
          <RefreshCw className={`h-3.5 w-3.5 mr-2 ${scanning ? "animate-spin" : ""}`} />
          {scanning ? "Scanning..." : "Run scan now"}
        </Button>
      </div>

      {rows.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="Filter by recommendation" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All senders ({rows.length})</SelectItem>
              <SelectItem value="unsubscribe">Unsubscribe ({counts.unsubscribe})</SelectItem>
              <SelectItem value="watch">Watch ({counts.watch})</SelectItem>
              <SelectItem value="healthy">Healthy ({counts.healthy})</SelectItem>
            </SelectContent>
          </Select>
          {filter !== ALL && (
            <Button variant="ghost" size="sm" onClick={() => setFilter(ALL)}>Clear filter</Button>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <HeartPulse className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No newsletter senders scanned yet</h3>
            <p className="text-muted-foreground mb-6">
              Once newsletter emails have produced reference cards, run a scan to see how each sender is performing.
            </p>
            <Button onClick={handleScanNow} disabled={scanning}>
              <RefreshCw className={`h-4 w-4 mr-2 ${scanning ? "animate-spin" : ""}`} />
              {scanning ? "Scanning..." : "Run scan now"}
            </Button>
          </CardContent>
        </Card>
      ) : visibleRows.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-sm">No senders match this filter.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {visibleRows.map((row) => {
            const m = meta[row.recommendation];
            const Icon = m.icon;
            return (
              <div key={row.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border rounded-lg">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Badge variant="outline" className={m.badgeClass}>
                      <Icon className="h-3 w-3 mr-1" />{m.label}
                    </Badge>
                    <span className="font-medium truncate">{row.sender_address}</span>
                    {typeof row.avg_score === "number" && (
                      <span className="text-xs text-muted-foreground shrink-0">{row.avg_score.toFixed(1)}/10 avg · {row.card_count} card{row.card_count === 1 ? "" : "s"}</span>
                    )}
                  </div>
                  {row.reason && <p className="text-sm text-muted-foreground">{row.reason}</p>}
                  {row.last_scanned_at && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Last scanned {new Date(row.last_scanned_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </p>
                  )}
                </div>
                <Button size="sm" variant="outline" onClick={() => navigate("/feeds")} className="shrink-0">
                  <Rss className="h-4 w-4 mr-1" />View in Sources
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
};

export default HealthTab;
