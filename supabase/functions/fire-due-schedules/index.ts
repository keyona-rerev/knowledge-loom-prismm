import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// The auto-fire cron entrypoint. pg_cron calls this once a day with a shared secret.
// It finds every active slot that is due today and hands each to execute-autopilot-template
// as a trusted internal call (service-role bearer plus the slot's user id). It does not
// generate anything itself; all generation lives in one place.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// nth occurrence of this weekday within its month (1..5).
const weekdayOccurrence = (d: Date): number => Math.ceil(d.getUTCDate() / 7);

// ISO week number, used only for biweekly parity.
function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  return 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86400000));
}

// Is a slot due on this date? day_of_week already matched by the query.
function isDue(slot: { frequency: string; anchor: number | null }, now: Date): boolean {
  const occ = weekdayOccurrence(now);
  switch (slot.frequency) {
    case "weekly":
      return true;
    case "biweekly":
      return isoWeek(now) % 2 === 0;
    case "monthly":
      return occ === (slot.anchor ?? 1);
    case "quarterly":
      return [0, 3, 6, 9].includes(now.getUTCMonth()) && occ === (slot.anchor ?? 1);
    case "as_needed":
    default:
      return false;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Shared-secret check. The expected value lives in automation_config, readable only
    // with the service role, and is handed to pg_cron when the job is scheduled.
    const presented = req.headers.get("x-cron-secret") ?? "";
    const { data: cfg } = await supabase
      .from("automation_config").select("value").eq("key", "cron_fire_secret").maybeSingle();
    if (!cfg?.value || presented !== cfg.value) return json({ error: "Forbidden" }, 403);

    const now = new Date();
    const dow = now.getUTCDay();

    const { data: slots, error } = await supabase
      .from("content_schedules")
      .select("id, user_id, frequency, anchor")
      .eq("is_active", true)
      .eq("day_of_week", dow);
    if (error) return json({ error: error.message }, 500);

    const due = (slots || []).filter((s) => isDue(s as any, now));

    const results: Array<{ scheduleId: string; ok: boolean; draftsCreated?: number; error?: string }> = [];
    for (const slot of due) {
      try {
        const { data, error: invokeError } = await supabase.functions.invoke("execute-autopilot-template", {
          body: { scheduleId: slot.id, userId: slot.user_id, isTestRun: false },
          headers: { Authorization: `Bearer ${serviceRoleKey}` },
        });
        if (invokeError) results.push({ scheduleId: slot.id, ok: false, error: invokeError.message });
        else results.push({ scheduleId: slot.id, ok: true, draftsCreated: data?.draftsCreated ?? 0 });
      } catch (e) {
        results.push({ scheduleId: slot.id, ok: false, error: e instanceof Error ? e.message : "Unknown error" });
      }
    }

    return json({ success: true, dow, considered: slots?.length ?? 0, fired: due.length, results });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
