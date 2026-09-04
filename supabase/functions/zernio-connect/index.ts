import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";
import { getPublisher } from "../_shared/publisher/index.ts";
import { platformLabel } from "../_shared/publisher/platform-rules.ts";

// Connect a social account for publishing, via the configured provider.
// Three actions:
//   start  -> returns an authorization URL to send the user to (OAuth).
//   sync   -> after the user returns, read the connected account from the
//             provider and upsert it into social_connections.
//   status -> return the stored connection for this user/platform.
//
// `platform` is passed in the request body (e.g. "linkedin", "instagram").
// Defaults to "linkedin" for backward compatibility with any caller that
// hasn't been updated to pass it yet. To add a new platform here, no code
// change is needed in this file -- it's already platform-agnostic; see the
// platform-onboarding checklist in platform-rules.ts for the other steps.
//
// The provider API key lives only in this server (env), never in the client.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authentication required" }, 401);

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return json({ error: "Invalid or expired token" }, 401);
    const userId = user.id;

    const { action, redirectUrl, platform } = await req.json().catch(() => ({ action: "status" }));
    const PLATFORM = platform ?? "linkedin";
    const publisher = getPublisher();
    const provider = publisher.name;

    if (action === "start") {
      if (!redirectUrl) return json({ error: "redirectUrl is required" }, 400);
      // Zernio organizes accounts under a profile; reuse the default one.
      const profileId = (await publisher.getDefaultProfileId()) ?? undefined;
      const { authorizationUrl } = await publisher.getConnectUrl({
        platform: PLATFORM,
        profileId,
        redirectUrl,
      });
      return json({ authorizationUrl });
    }

    if (action === "sync") {
      const accounts = await publisher.listAccounts(PLATFORM);
      if (!accounts.length) {
        return json({ connected: false, error: `No ${platformLabel(PLATFORM)} account found on the provider yet` }, 404);
      }
      const acct = accounts[0];
      const row = {
        user_id: userId,
        provider,
        platform: PLATFORM,
        external_account_id: acct.accountId,
        external_profile_id: acct.profileId ?? null,
        account_label: acct.displayName ?? acct.username ?? null,
        status: acct.status ?? "active",
        connected_at: new Date().toISOString(),
      };
      const { data, error } = await supabase
        .from("social_connections")
        .upsert(row, { onConflict: "user_id,provider,platform" })
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);
      return json({ connected: true, connection: data });
    }

    // status (default)
    const { data } = await supabase
      .from("social_connections")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", provider)
      .eq("platform", PLATFORM)
      .maybeSingle();
    return json({ connected: !!data, connection: data ?? null });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
