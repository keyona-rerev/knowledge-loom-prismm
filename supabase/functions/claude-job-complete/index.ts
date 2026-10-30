// supabase/functions/claude-job-complete/index.ts - thin adapter over _shared/job-logic.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { completeJob, workerSecretOk } from "../_shared/job-logic.ts";
import { makeDb } from "../_shared/supabase-db.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!(await workerSecretOk(Deno.env.get("WORKER_SECRET"), req.headers.get("x-worker-secret"))))
    return json({ error: "unauthorized" }, 401);
  // Body cap BEFORE parse: visual jobs carry pngBase64 (cap 4MB decoded, so
  // ~5.6MB encoded). 8MB request bound rejects runaway bodies without parsing
  // them; non-visual payloads are kilobytes and unaffected.
  const rawBody = await req.text().catch(() => "");
  if (rawBody.length > 8 * 1024 * 1024) return json({ error: "body too large" }, 413);
  let parsed: any;
  try { parsed = JSON.parse(rawBody || "{}"); } catch { return json({ error: "invalid json" }, 400); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "invalid json" }, 400);
  const { job_id, completion_token, output, run_url } = parsed;
  // Wire contract: the worker (worker-workflow v5+) posts the render as
  // camelCase `pngBase64`; snake_case `png_base64` is accepted too. If both are
  // present they must agree, otherwise the request is ambiguous and refused.
  const png_snake = parsed.png_base64;
  const png_camel = parsed.pngBase64;
  if (png_snake !== undefined && typeof png_snake !== "string") return json({ error: "png_base64 must be a string" }, 400);
  if (png_camel !== undefined && typeof png_camel !== "string") return json({ error: "pngBase64 must be a string" }, 400);
  if (png_snake !== undefined && png_camel !== undefined && png_snake !== png_camel)
    return json({ error: "png_base64 and pngBase64 disagree" }, 400);
  const png_base64: string | undefined = png_camel ?? png_snake;
  if (!job_id || !completion_token || !output) return json({ error: "missing fields" }, 400);
  const db = makeDb(createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!));
  const r = await completeJob(db, { jobId: job_id, completionToken: completion_token, output, runUrl: run_url, pngBase64: png_base64 });
  return json(r.body, r.status);
});
