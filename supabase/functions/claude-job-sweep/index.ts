// supabase/functions/claude-job-sweep/index.ts - expired-claim recovery + re-dispatch list.
// Invoked by the enqueue path (fire-due-schedules patch) and the Settings resume action;
// the CALLER performs the repository_dispatch POST per returned job (GitHub credential
// stays dispatcher-side).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sweepJobs, workerSecretOk } from "../_shared/job-logic.ts";
import { makeDb } from "../_shared/supabase-db.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  // The dispatcher authenticates with its own secret, distinct from the worker's.
  if (!(await workerSecretOk(Deno.env.get("DISPATCHER_SECRET"), req.headers.get("x-dispatcher-secret"))))
    return json({ error: "unauthorized" }, 401);
  const db = makeDb(createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!));
  return json(await sweepJobs(db, {}));
});
