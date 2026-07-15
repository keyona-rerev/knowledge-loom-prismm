import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Low-queue email alert. Two ways in, same split as scan-newsletter-health:
//   1. pg_cron, daily at 14:00 UTC, with the shared x-cron-secret header.
//      Checks EVERY user's queue, since that's the scheduled sweep.
//   2. A logged-in user with a normal bearer token (a future "check now"
//      button), which checks ONLY that user's queue.
//
// "Ready to publish" here is the exact same definition Dashboard.tsx uses
// for its threshold banner: approved, actually handed to the scheduler
// (publish_status = 'scheduled'), and still in the future right now. Stuck
// drafts (failed / needs_attention / never scheduled) do not count, for the
// same reason they don't count on the Dashboard: they aren't going anywhere
// until someone fixes them.
//
// The alert is a latch, not a daily nag. When the count drops below
// profiles.low_queue_email_threshold and the latch is clear, one email goes
// out and the latch is set. The latch clears itself the first daily run
// after the queue recovers, so the next dip alerts again. If RESEND_API_KEY
// isn't set yet, the run reports that and does NOT set the latch, so the
// first run after the key lands sends the email that was owed.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function alertHtml(count: number, threshold: number, appUrl: string): string {
  const reviewUrl = appUrl.replace(/\/$/, "") + "/review";
  return `<!DOCTYPE html><html><body style="font-family: Arial, Helvetica, sans-serif; color: #1b2b45; line-height: 1.6; max-width: 560px; margin: 0 auto; padding: 24px;">
    <h2 style="margin: 0 0 8px;">Your approved queue is running low</h2>
    <p style="margin: 0 0 16px;">Only <strong>${count}</strong> approved post${count === 1 ? " is" : "s are"} still queued to publish. Your alert threshold is ${threshold}.</p>
    <p style="margin: 0 0 20px;">Once the queue hits zero, scheduled slots start firing with nothing to publish. A few minutes in Review keeps the pipeline moving.</p>
    <p style="margin: 0 0 24px;"><a href="${reviewUrl}" style="background: #6658ea; color: #ffffff; padding: 10px 20px; border-radius: 6px; text-decoration: none; display: inline-block;">Go to Review</a></p>
    <p style="font-size: 12px; color: #6b7280; margin: 0;">Sent by Knowledge Loom. You get one email per dip below your threshold; it re-arms after the queue recovers. Adjust the threshold in Settings under Review pipeline.</p>
  </body></html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Entry path: real user JWT scopes to that user; otherwise require the
    // shared cron secret. (The cron's anon-key bearer is a valid JWT but has
    // no user, so it falls through to the secret check.)
    let scopedUserId: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) scopedUserId = user.id;
    }
    if (!scopedUserId) {
      const presented = req.headers.get("x-cron-secret") ?? "";
      const { data: cfg } = await supabase
        .from("automation_config").select("value").eq("key", "cron_fire_secret").maybeSingle();
      if (!cfg?.value || presented !== cfg.value) return json({ error: "Forbidden" }, 403);
    }

    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";

    const { data: appCfg } = await supabase
      .from("automation_config").select("value").eq("key", "app_url").maybeSingle();
    const appUrl = appCfg?.value || "#";

    const { data: fromCfg } = await supabase
      .from("automation_config").select("value").eq("key", "alert_from_email").maybeSingle();
    const fromAddress = fromCfg?.value || "Knowledge Loom <onboarding@resend.dev>";

    let profilesQuery = supabase
      .from("profiles")
      .select("user_id, email, low_queue_email_threshold, low_queue_alert_active");
    if (scopedUserId) profilesQuery = profilesQuery.eq("user_id", scopedUserId);
    const { data: profiles, error: profilesError } = await profilesQuery;
    if (profilesError) return json({ error: profilesError.message }, 500);

    const nowIso = new Date().toISOString();
    const results: Array<Record<string, unknown>> = [];

    for (const p of profiles || []) {
      const threshold = p.low_queue_email_threshold ?? 3;

      // Dashboard's "ready to publish" definition, verbatim in SQL form.
      const { count, error: countError } = await supabase
        .from("drafts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", p.user_id)
        .eq("approval_status", "approved")
        .eq("publish_status", "scheduled")
        .gt("scheduled_for", nowIso);
      if (countError) {
        results.push({ userId: p.user_id, error: countError.message });
        continue;
      }
      const approvedCount = count ?? 0;
      const below = approvedCount < threshold;

      if (!below) {
        if (p.low_queue_alert_active) {
          await supabase.from("profiles")
            .update({ low_queue_alert_active: false })
            .eq("user_id", p.user_id);
        }
        results.push({ userId: p.user_id, approvedCount, threshold, status: "healthy" });
        continue;
      }

      if (p.low_queue_alert_active) {
        results.push({ userId: p.user_id, approvedCount, threshold, status: "below_already_alerted" });
        continue;
      }

      if (!p.email) {
        results.push({ userId: p.user_id, approvedCount, threshold, status: "below_no_email_on_profile" });
        continue;
      }

      if (!resendKey) {
        // Don't set the latch: retry daily until the key exists, then send.
        console.error("RESEND_API_KEY not set; low-queue alert owed to", p.email);
        results.push({ userId: p.user_id, approvedCount, threshold, status: "below_resend_key_missing" });
        continue;
      }

      const subject = `Knowledge Loom: only ${approvedCount} approved post${approvedCount === 1 ? "" : "s"} left in the queue`;
      const sendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: fromAddress,
          to: [p.email],
          subject,
          html: alertHtml(approvedCount, threshold, appUrl),
        }),
      });

      if (!sendRes.ok) {
        const errText = await sendRes.text().catch(() => "");
        console.error("Resend send failed:", sendRes.status, errText);
        // Latch stays clear so tomorrow's run retries.
        results.push({ userId: p.user_id, approvedCount, threshold, status: "below_send_failed", providerStatus: sendRes.status });
        continue;
      }

      await supabase.from("profiles")
        .update({ low_queue_alert_active: true })
        .eq("user_id", p.user_id);

      await supabase.from("email_notifications").insert({
        user_id: p.user_id,
        draft_id: null,
        type: "low_approved_queue",
        sent_at: new Date().toISOString(),
      });

      results.push({ userId: p.user_id, approvedCount, threshold, status: "alert_sent", to: p.email });
    }

    console.log(`✅ Approved-queue check complete. ${results.length} profile(s) checked.${scopedUserId ? ` (scoped to user ${scopedUserId})` : " (global cron sweep)"}`);
    return json({ success: true, checked: results.length, results });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
