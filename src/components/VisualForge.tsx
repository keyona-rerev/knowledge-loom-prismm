import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Download, Loader2, ImageIcon, RefreshCw } from "lucide-react";

interface VisualForgeProps {
  draftId: string;
  userId: string;
}

interface DraftVisual {
  id: string;
  visual_type: string;
  html_content: string;
  status: string;
  error_message?: string;
  created_at: string;
}

const VISUAL_TYPE_LABELS: Record<string, string> = {
  stat_graphic: "Stat Graphic",
  quote_card: "Quote Card",
  pillar_statement: "Pillar Statement",
  human_moment: "Human Moment",
  timeline: "Timeline",
  comparison: "Comparison",
  checklist: "Checklist",
  branded_announcement: "Announcement",
  generating: "Generating..."
};

export const VisualForge = ({ draftId, userId }: VisualForgeProps) => {
  const [visual, setVisual] = useState<DraftVisual | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const loadVisual = async () => {
    const { data, error } = await supabase
      .from("draft_visuals")
      .select("*")
      .eq("draft_id", draftId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      setVisual(data as DraftVisual);
      // Stop polling if ready or error
      if (data.status === "ready" || data.status === "error") {
        if (pollRef.current) clearInterval(pollRef.current);
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    loadVisual();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [draftId]);

  // Poll while generating
  useEffect(() => {
    if (visual?.status === "generating") {
      pollRef.current = setInterval(loadVisual, 3000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [visual?.status]);

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      const { error } = await supabase.functions.invoke("generate-draft-visual", {
        body: { draftId, userId }
      });
      if (error) throw error;
      toast.success("Regenerating visual...");
      // Start polling
      setVisual(prev => prev ? { ...prev, status: "generating" } : null);
      pollRef.current = setInterval(loadVisual, 3000);
    } catch (e) {
      toast.error("Failed to regenerate visual");
    } finally {
      setRegenerating(false);
    }
  };

  const handleDownload = async () => {
    if (!visual?.html_content || !iframeRef.current) return;
    setDownloading(true);

    try {
      // Open the HTML in a new window and trigger print-to-save
      // Since html2canvas can't run in iframe, we use a blob URL approach
      const blob = new Blob([visual.html_content], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `prismm-visual-${visual.visual_type}-${visual.id.slice(0, 8)}.html`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Downloaded as HTML — open in browser to screenshot or print.");
    } catch (e) {
      toast.error("Download failed");
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-4">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading visual...</span>
      </div>
    );
  }

  if (!visual) {
    return (
      <div className="rounded-lg border border-dashed border-muted p-6 text-center">
        <ImageIcon className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground mb-3">No visual generated yet</p>
        <Button size="sm" variant="outline" onClick={handleRegenerate} disabled={regenerating}>
          {regenerating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Generate Visual
        </Button>
      </div>
    );
  }

  if (visual.status === "generating") {
    return (
      <div className="rounded-lg border bg-muted/30 p-6">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-[#f9655b]" />
          <div>
            <p className="text-sm font-medium">Generating visual...</p>
            <p className="text-xs text-muted-foreground">AI is designing a branded card for this draft</p>
          </div>
        </div>
      </div>
    );
  }

  if (visual.status === "error") {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-700 mb-3">
          Visual generation failed: {visual.error_message || "Unknown error"}
        </p>
        <Button size="sm" variant="outline" onClick={handleRegenerate} disabled={regenerating}>
          {regenerating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge
            style={{ backgroundColor: "#1b2b45", color: "#f5c070", border: "none" }}
            className="text-xs uppercase tracking-wider"
          >
            {VISUAL_TYPE_LABELS[visual.visual_type] || visual.visual_type}
          </Badge>
          <span className="text-xs text-muted-foreground">
            LinkedIn 1200x627
          </span>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleRegenerate}
            disabled={regenerating}
          >
            {regenerating
              ? <Loader2 className="h-3 w-3 animate-spin mr-1" />
              : <RefreshCw className="h-3 w-3 mr-1" />
            }
            Regenerate
          </Button>
          <Button
            size="sm"
            onClick={handleDownload}
            disabled={downloading}
            style={{ backgroundColor: "#f9655b", color: "#ffffff" }}
          >
            <Download className="h-3 w-3 mr-1" />
            Download HTML
          </Button>
        </div>
      </div>

      {/* Visual preview */}
      <div
        className="rounded-lg overflow-hidden border"
        style={{ aspectRatio: "1200/627" }}
      >
        <iframe
          ref={iframeRef}
          srcDoc={visual.html_content}
          className="w-full h-full"
          style={{ border: "none", pointerEvents: "none" }}
          title="Prismm Visual"
          sandbox="allow-same-origin"
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Download the HTML file, open it in Chrome, and use Cmd+Shift+4 (Mac) or Win+Shift+S (Windows) to screenshot at full resolution.
      </p>
    </div>
  );
};

export default VisualForge;
