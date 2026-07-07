import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, RefreshCw, HeartPulse, Rss, BarChart3 } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ReferenceLine,
  PieChart, Pie,
} from "recharts";

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

// These match the thresholds scan-newsletter-health's recommend() actually
// uses (avg <= 3.5 -> unsubscribe, avg <= 5.5 -> watch, else healthy) — the
// chart's reference lines and colors are drawn from the same boundaries the
// backend scores against, not separately chosen "looks about right" values.
const RECOMMENDATION_COLOR: Record<HealthRow["recommendation"], string> = {
  unsubscribe: "#dc2626",
  watch: "#ea580c",
  healthy: "#16a34a",
};

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

  // Bar chart data: only senders with a real score, worst-first (same order
  // as the list below, since rows is already sorted avg_score ascending).
  // Sender addresses are truncated for the axis label; the tooltip shows
  // the full address plus card count.
  const chartData = rows
    .filter((r) => typeof r.avg_score === "number")
    .map((r) => ({
      sender: r.sender_address,
      shortSender: r.sender_address.length > 22 ? r.sender_address.slice(0, 20) + "…" : r.sender_address,
      avg_score: r.avg_score as number,
      card_count: r.card_count,
      recommendation: r.recommendation,
    }));

  const pieData = [
    { name: "Healthy", value: counts.healthy, color: RECOMMENDATION_COLOR.healthy },
    { name: "Watch", value: counts.watch, color: RECOMMENDATION_COLOR.watch },
    { name: "Unsubscribe", value: counts.unsubscribe, color: RECOMMENDATION_COLOR.unsubscribe },
  ].filter((d) => d.value > 0);

  const chartHeight = Math.max(160, chartData.length * 32);

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

      {chartData.length > 0 && (
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4" />
              Relevance score by sender
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-center">
              <div className="lg:col-span-2" style={{ height: chartHeight }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" domain={[0, 10]} tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="shortSender" width={140} tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(value: number, _name, props: any) => [`${value.toFixed(1)}/10 (${props.payload.card_count} cards)`, props.payload.sender]}
                      labelFormatter={() => ""}
                    />
                    {/* Recommendation thresholds — the exact boundaries
                        scan-newsletter-health's recommend() uses, not
                        separately eyeballed values. */}
                    <ReferenceLine x={3.5} stroke="#dc2626" strokeDasharray="4 4" />
                    <ReferenceLine x={5.5} stroke="#ea580c" strokeDasharray="4 4" />
                    <Bar dataKey="avg_score" radius={[0, 4, 4, 0]}>
                      {chartData.map((entry, i) => (
                        <Cell key={i} fill={RECOMMENDATION_COLOR[entry.recommendation]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col items-center gap-3">
                {pieData.length > 0 && (
                  <div style={{ width: "100%", height: 140 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={35} outerRadius={60} paddingAngle={2}>
                          {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
                <div className="flex flex-col gap-1.5 text-xs w-full">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: RECOMMENDATION_COLOR.healthy }} />Healthy</span>
                    <span className="font-medium">{counts.healthy}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: RECOMMENDATION_COLOR.watch }} />Watch</span>
                    <span className="font-medium">{counts.watch}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: RECOMMENDATION_COLOR.unsubscribe }} />Unsubscribe</span>
                    <span className="font-medium">{counts.unsubscribe}</span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

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
