import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";
import { assessRelevance } from "../_shared/relevance-gate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * SSRF Protection: Validates that a URL is safe to fetch
 * Blocks internal/private IP ranges and dangerous protocols
 */
function isAllowedUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    
    // Block dangerous protocols
    if (!['http:', 'https:'].includes(url.protocol)) {
      console.log('❌ SSRF blocked: dangerous protocol:', url.protocol);
      return false;
    }
    
    const hostname = url.hostname.toLowerCase();
    
    // Block localhost and internal hosts
    if (hostname === 'localhost' || 
        hostname === '127.0.0.1' ||
        hostname === '0.0.0.0' ||
        hostname === '::1' ||
        hostname.endsWith('.local') ||
        hostname.endsWith('.internal') ||
        hostname.endsWith('.localhost')) {
      console.log('❌ SSRF blocked: internal host:', hostname);
      return false;
    }
    
    // Block private IP ranges
    const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      const [, a, b] = ipv4Match.map(Number);
      
      // 10.0.0.0/8 - Private
      if (a === 10) {
        console.log('❌ SSRF blocked: private IP range 10.x.x.x');
        return false;
      }
      // 172.16.0.0/12 - Private
      if (a === 172 && b >= 16 && b <= 31) {
        console.log('❌ SSRF blocked: private IP range 172.16-31.x.x');
        return false;
      }
      // 192.168.0.0/16 - Private
      if (a === 192 && b === 168) {
        console.log('❌ SSRF blocked: private IP range 192.168.x.x');
        return false;
      }
      // 169.254.0.0/16 - Link-local
      if (a === 169 && b === 254) {
        console.log('❌ SSRF blocked: link-local IP range');
        return false;
      }
      // 127.0.0.0/8 - Loopback
      if (a === 127) {
        console.log('❌ SSRF blocked: loopback IP range');
        return false;
      }
      // 0.0.0.0/8
      if (a === 0) {
        console.log('❌ SSRF blocked: zero IP range');
        return false;
      }
    }
    
    return true;
  } catch (e) {
    console.log('❌ SSRF blocked: invalid URL:', e);
    return false;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    // Verify user authentication from JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("❌ Missing authorization header");
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const supabaseAuth = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
    
    if (authError || !user) {
      console.error("❌ Invalid token:", authError?.message);
      return new Response(
        JSON.stringify({ error: "Invalid or expired authentication token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = user.id;
    console.log("✅ Authenticated user:", userId);

    // Use service role client for database operations
    const supabaseClient = createClient(supabaseUrl, serviceRoleKey);

    const { feedId, maxItems = 10 } = await req.json();

    if (!feedId) {
      return new Response(
        JSON.stringify({ error: "feedId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get feed - verify it belongs to the authenticated user
    const { data: feed, error: feedError } = await supabaseClient
      .from("source_feeds")
      .select("*")
      .eq("id", feedId)
      .eq("user_id", userId)
      .single();

    if (feedError || !feed) {
      console.error("❌ Feed not found or access denied:", feedError);
      return new Response(
        JSON.stringify({ error: "Feed not found or access denied" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("📡 Pulling feed:", feed.name, "URL:", feed.url);

    // SSRF protection check
    if (!isAllowedUrl(feed.url)) {
      console.error("❌ SSRF blocked URL:", feed.url);
      await supabaseClient
        .from("source_feeds")
        .update({ health_status: "error", last_pulled_at: new Date().toISOString() })
        .eq("id", feedId);
      
      return new Response(
        JSON.stringify({ error: "Invalid feed URL - blocked by security policy" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch the RSS feed
    let response;
    try {
      response = await fetch(feed.url, {
        headers: {
          "User-Agent": "InsightForge RSS Reader/1.0",
          "Accept": "application/rss+xml, application/xml, text/xml, */*"
        }
      });
    } catch (fetchError) {
      console.error("❌ Failed to fetch feed:", fetchError);
      await supabaseClient
        .from("source_feeds")
        .update({ health_status: "error", last_pulled_at: new Date().toISOString() })
        .eq("id", feedId);
      
      throw new Error(`Failed to fetch feed: ${fetchError instanceof Error ? fetchError.message : "Network error"}`);
    }

    if (!response.ok) {
      await supabaseClient
        .from("source_feeds")
        .update({ health_status: "error", last_pulled_at: new Date().toISOString() })
        .eq("id", feedId);
      
      throw new Error(`Feed returned status ${response.status}`);
    }

    const xmlText = await response.text();
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, "text/xml");

    if (!xmlDoc) {
      throw new Error("Failed to parse XML");
    }

    // Parse RSS items
    const items = Array.from(xmlDoc.querySelectorAll("item")) as any[];
    const createdCards = [];
    let skippedIrrelevant = 0;

    console.log(`📰 Found ${items.length} items in feed`);

    for (let i = 0; i < Math.min(items.length, maxItems); i++) {
      const item = items[i];
      const title = item.querySelector("title")?.textContent || "Untitled";
      const link = item.querySelector("link")?.textContent || "";
      const description = item.querySelector("description")?.textContent || "";
      const pubDate = item.querySelector("pubDate")?.textContent;

      // Check if article already exists
      if (link) {
        const { data: existing } = await supabaseClient
          .from("reference_cards")
          .select("id")
          .eq("source_url", link)
          .eq("user_id", userId)
          .single();

        if (existing) {
          console.log("⏭️ Skipping existing article:", title.substring(0, 50));
          continue;
        }
      }

      // Clean HTML from description
      const cleanDescription = description
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .trim()
        .substring(0, 10000);

      // Relevance gate: skip creating a card at all for noise (ads, broken
      // scrapes, off-topic content) before it eats up review-queue space.
      const verdict = await assessRelevance(supabaseClient, userId, { title, content: cleanDescription });
      if (!verdict.relevant) {
        console.log("⏭️ Skipping irrelevant article:", title.substring(0, 50), "-", verdict.reason);
        skippedIrrelevant++;
        continue;
      }

      // Create reference card
      const { data: card, error: cardError } = await supabaseClient
        .from("reference_cards")
        .insert({
          user_id: userId,
          source_feed_id: feedId,
          title: title.substring(0, 500),
          source_url: link,
          original_text: cleanDescription,
          source_type: "rss",
          status: "active",
          template_id: feed.default_template_id
        })
        .select()
        .single();

      if (cardError) {
        console.error("❌ Failed to create card:", cardError);
        continue;
      }

      console.log("✅ Created card:", card.id, "-", title.substring(0, 40));
      createdCards.push(card);
    }

    // Update feed status
    await supabaseClient
      .from("source_feeds")
      .update({
        last_pulled_at: new Date().toISOString(),
        last_successful_pull_at: new Date().toISOString(),
        health_status: "healthy"
      })
      .eq("id", feedId);

    console.log(`✅ Feed pull complete. Created ${createdCards.length} new cards, skipped ${skippedIrrelevant} as irrelevant.`);

    return new Response(
      JSON.stringify({
        success: true,
        cardsCreated: createdCards.length,
        cardIds: createdCards.map(c => c.id),
        skippedIrrelevant
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("💥 Error pulling feed:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
