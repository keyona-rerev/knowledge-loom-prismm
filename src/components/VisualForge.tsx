import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Download, Loader2, ImageIcon, RefreshCw } from "lucide-react";
import { capturePngDataUrl } from "@/lib/visualCapture";

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

// The AI's real, actually-implemented visual types (see
// supabase/functions/_shared/visual-prompt.ts, VISUAL_TYPES -- the single
// source of truth). This used to list the old 8-type vocabulary that
// Visual Studio's toggles were cut over from; since that decision was made
// this map was never updated to match, so every real generated visual fell
// through to showing its raw snake_case type instead of a label.
const VISUAL_TYPE_LABELS: Record<string, string> = {
  hero_number: "Hero Number",
  before_after: "Before / After",
  logic_diagram: "Logic Diagram",
  transformation: "Transformation",
  generating: "Generating...",
};

const DEFAULT_NAVY = "#1b2b45";
const DEFAULT_CORAL = "#f9655b";
const DEFAULT_YELLOW = "#f5c070";

export const VisualForge = ({ draftId, userId }: VisualForgeProps) => {
  const [visual, setVisual] = useState<DraftVisual | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  // Previously hardcoded navy/coral/yellow directly in this file's spinner,
  // type badge, and download button, disconnected from Visual Studio
  // (profiles.visual_studio_config) even though this component exists
  // specifically to display that config's output. Now reads the same
  // config Visual Studio saves, falling back to the old hardcoded values
  // for anyone who hasn't configured Visual Studio yet.
  const [colors, setColors] = useState({ navy: DEFAULT_NAVY, coral: DEFAULT_CORAL, yellow: DEFAULT_YELLOW });
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
      if (data.status === "ready" || data.status === "error") {
        if (pollRef.current) clearInterval(pollRef.current);
      }
    }
    setLoading(false);
  };

  const loadColors = async () => {
    const { data } = await supabase
      .from("profiles")
      .select("visual_studio_config")
      .eq("user_id", userId)
      .maybeSingle();
    const raw = (data as any)?.visual_studio_config as string | null | undefined;
    if (!raw) return;
    try {
      const config = JSON.parse(raw);
      setColors({
        navy: config.color_navy || DEFAULT_NAVY,
        coral: config.color_coral || DEFAULT_CORAL,
        yellow: config.color_yellow || DEFAULT_YELLOW,
      });
    } catch {
      // Malformed config -- keep the defaults rather than fail the component.
    }
  };

  useEffect(() => {
    loadVisual();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [draftId]);

  useEffect(() => {
    loadColors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

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
        body: { draftId, userId },
      });
      if (error) throw error;
      toast.success("Regenerating visual...");
      setVisual((prev) => (prev ? { ...prev, status: "generating" } : null));
      pollRef.current = setInterval(loadVisual, 3000);
    } catch {
      toast.error("Failed to regenerate visual");
    } finally {
      setRegenerating(false);
    }
  };

  const handleDownloadPng = async () => {
    if (!visual?.html_content) return;
    setDownloading(true);
    try {
      const dataUrl = await capturePngDataUrl(visual.html_content);
      const filename = `visual-${visual.visual_type}-${visual.id.slice(0, 8)}.png`;
      const link = document.createElement("a");
      link.download = filename;
      link.href = dataUrl;
      link.click();
      toast.success("PNG downloaded — check your Downloads folder.");
    } catch (err) {
      toast.error("PNG capture failed: " + ((err as Error)?.message || "unknown error"));
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
          {regenerating ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Generate Visual
        </Button>
      </div>
    );
  }

  if (visual.status === "generating") {
    return (
      <div className="rounded-lg border bg-muted/30 p-6">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin" style={{ color: colors.coral }} />
          <div>
            <p className="text-sm font-medium">Generating visual...</p>
            <p className="text-xs text-muted-foreground">
              AI is designing a branded graphic for this draft
            </p>
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
          {regenerating ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
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
            style={{ backgroundColor: colors.navy, color: colors.yellow, border: "none" }}
            className="text-xs uppercase tracking-wider"
          >
            {VISUAL_TYPE_LABELS[visual.visual_type] || visual.visual_type}
          </Badge>
          <span className="text-xs text-muted-foreground">LinkedIn 1200x627</span>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={handleRegenerate} disabled={regenerating}>
            {regenerating ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <RefreshCw className="h-3 w-3 mr-1" />
            )}
            Regenerate
          </Button>
          <Button
            size="sm"
            onClick={handleDownloadPng}
            disabled={downloading}
            style={{ backgroundColor: colors.coral, color: "#ffffff" }}
          >
            {downloading ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <Download className="h-3 w-3 mr-1" />
            )}
            {downloading ? "Capturing..." : "Download PNG"}
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
          title="Draft visual"
          sandbox="allow-same-origin"
        />
      </div>
    </div>
  );
};

export default VisualForge;
