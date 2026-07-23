// Renders a self-contained HTML visual (as produced by generate-draft-visual)
// to a PNG by injecting html2canvas into a hidden iframe and capturing on
// load. There is no server-side renderer available (Supabase edge functions
// run in Deno with no headless browser), so this only works client-side.

// LinkedIn's landscape size, kept as the default so any existing caller that
// doesn't pass dimensions renders byte-identical to before. Instagram (and
// anything else) passes its own width/height explicitly, read from the
// draft_visuals row's canvas_width/canvas_height (see generate-draft-visual,
// which now stamps the actual render size onto that row per platform).
const DEFAULT_CAPTURE_WIDTH = 1200;
const DEFAULT_CAPTURE_HEIGHT = 627;

function buildCapturePage(html: string, width: number, height: number): string {
  const script = `
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"><\/script>
<script>
window.addEventListener('load', function() {
  setTimeout(function() {
    html2canvas(document.body, {
      scale: 2,
      useCORS: true,
      backgroundColor: null,
      logging: false,
      width: ${width},
      height: ${height}
    }).then(function(canvas) {
      window.parent.postMessage({ type: 'PRISMM_PNG', dataUrl: canvas.toDataURL('image/png') }, '*');
    }).catch(function(err) {
      window.parent.postMessage({ type: 'PRISMM_PNG_ERROR', error: err.message }, '*');
    });
  }, 600);
});
<\/script>`;
  if (html.includes("</body>")) return html.replace("</body>", script + "\n</body>");
  return html + "\n" + script;
}

export function capturePngDataUrl(
  html: string,
  timeoutMs = 15000,
  width: number = DEFAULT_CAPTURE_WIDTH,
  height: number = DEFAULT_CAPTURE_HEIGHT,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const capturePage = buildCapturePage(html, width, height);
    const blob = new Blob([capturePage], { type: "text/html" });
    const blobUrl = URL.createObjectURL(blob);

    const frame = document.createElement("iframe");
    frame.style.cssText = `position:fixed;left:-9999px;top:-9999px;width:${width}px;height:${height}px;border:none;visibility:hidden;`;
    frame.src = blobUrl;

    let settled = false;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      URL.revokeObjectURL(blobUrl);
      frame.remove();
    };
    const onMessage = (evt: MessageEvent) => {
      if (settled) return;
      if (evt.data?.type === "PRISMM_PNG") {
        settled = true;
        cleanup();
        resolve(evt.data.dataUrl);
      } else if (evt.data?.type === "PRISMM_PNG_ERROR") {
        settled = true;
        cleanup();
        reject(new Error(evt.data.error || "PNG capture failed"));
      }
    };
    window.addEventListener("message", onMessage);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("PNG capture timed out"));
    }, timeoutMs);

    document.body.appendChild(frame);
  });
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, base64] = dataUrl.split(",");
  const mime = meta.match(/:(.*?);/)?.[1] || "image/png";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
