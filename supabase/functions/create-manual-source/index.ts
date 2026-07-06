import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("🟡 create-manual-source started");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("❌ Missing environment variables");
      return new Response(JSON.stringify({ error: "Server configuration error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("❌ Missing authorization header");
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAuth = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();

    if (authError || !user) {
      console.error("❌ Authentication failed:", authError);
      return new Response(JSON.stringify({ error: "Invalid or expired authentication token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const user_id = user.id;
    console.log("✅ Authenticated user:", user_id);

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Rate limiting: 200 manual sources per hour per user. Raised from the
    // original 50 once Discover Sources started calling this function in
    // bulk (a single search can legitimately try 20-30 candidate URLs to
    // find enough that clear the relevance threshold) — 50/hour was sized
    // for one person pasting one link at a time and left almost no
    // headroom for a single discovery run, let alone a few in a row.
    const windowStart = new Date();
    windowStart.setMinutes(windowStart.getMinutes() - 60);

    const { count: rateCount, error: rateError } = await supabase
      .from("rate_limit_logs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user_id)
      .eq("action", "manual_source")
      .gte("created_at", windowStart.toISOString());

    if (!rateError && (rateCount || 0) >= 200) {
      console.log("❌ Rate limit exceeded for user:", user_id);
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Maximum 200 manual sources per hour." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await supabase.from("rate_limit_logs").insert({ user_id, action: "manual_source" });

    const requestBody = await req.json();
    console.log("📦 Request body keys:", Object.keys(requestBody));

    const { type, url, pdf_text, pdf_title, paste_text, paste_title, question_set_id, from_company, force_keep } = requestBody;

    // Validate required fields per type
    if (!type) {
      return new Response(JSON.stringify({ error: "Missing source type" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (type === "url" && !url) {
      return new Response(JSON.stringify({ error: "URL is required for url type" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (type === "pdf" && !pdf_text) {
      return new Response(JSON.stringify({ error: "pdf_text is required for pdf type" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (type === "paste" && !paste_text) {
      return new Response(JSON.stringify({ error: "paste_text is required for paste type" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let title = "Untitled Article";
    let textContent = "";
    let contentQuality = "good";
    let contentWarning = null;
    let sourceUrl = url || "";
    let contentBlocked = false;

    if (type === "pdf") {
      console.log("📄 Processing PDF source");
      title = pdf_title || "PDF Document";
      textContent = pdf_text;
      sourceUrl = "";
      if (textContent.length < 100) {
        contentQuality = "partial";
        contentWarning = "PDF content appears incomplete";
      }
    } else if (type === "paste") {
      // Pasted text — treat identically to PDF content-wise
      console.log("📋 Processing pasted text source");
      title = paste_title?.trim() || "Pasted Article";
      textContent = paste_text.trim();
      sourceUrl = "";
      if (textContent.length < 100) {
        contentQuality = "partial";
        contentWarning = "Pasted content is very short — consider adding more text for better insights";
      }
    } else {
      // URL type
      console.log("🌐 Fetching content from:", url);

      let articleResponse;
      try {
        articleResponse = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          },
        });
        console.log("📄 Response status:", articleResponse.status);

        if (articleResponse.status === 403 || articleResponse.status === 429) {
          console.log("⚠️ Site blocked automated access");
          contentBlocked = true;
        } else if (!articleResponse.ok) {
          throw new Error(`HTTP ${articleResponse.status}: ${articleResponse.statusText}`);
        }
      } catch (fetchError) {
        console.error("❌ Fetch failed:", fetchError);
        return new Response(
          JSON.stringify({ error: `Failed to fetch URL: ${fetchError instanceof Error ? fetchError.message : "Unknown error"}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (contentBlocked) {
        console.log("🛡️ Creating card with limited content (site blocked)");
        title = "Site Blocked Access - Manual Review Needed";
        textContent = "This site blocks automated content access. Please add content manually or try a different source.";
        contentQuality = "title_only";
        contentWarning = "Site blocks automated content access - manual review required";
      } else {
        const articleHtml = await articleResponse.text();
        console.log("📝 HTML content length:", articleHtml.length);

        const titleMatch = /<title>(.*?)<\/title>/i.exec(articleHtml);
        title = titleMatch?.[1]?.trim() || "Untitled Article";
        console.log("📌 Extracted title:", title);

        textContent = articleHtml
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .substring(0, 10000);

        console.log("📄 Clean content length:", textContent.length);

        if (textContent.length < 50) {
          contentQuality = "title_only";
          contentWarning = "Limited content available - only title accessible";
        } else if (textContent.length < 500) {
          contentQuality = "partial";
          contentWarning = "Partial content - full article may not be accessible";
        }
      }
    }

    // Create source feed entry
    console.log("💾 Creating source feed entry...");
    const { data: feedData, error: feedError } = await supabase
      .from("source_feeds")
      .insert({
        name: title.substring(0, 255),
        url: sourceUrl,
        feed_type: "manual",
        is_active: true,
        credibility_score: 5,
        user_id: user_id,
      })
      .select()
      .single();

    if (feedError) {
      console.error("❌ Failed to create source feed entry:", feedError);
    } else {
      console.log("✅ Source feed created:", feedData.id);
    }

    // Create reference card
    console.log("💾 Creating reference card...");
    const sourceType = type === "url" ? "manual" : type === "pdf" ? "pdf" : "paste";
    const insertData: any = {
      title: title.substring(0, 255),
      original_text: textContent,
      source_url: sourceUrl,
      source_type: sourceType,
      source_feed_id: feedData?.id,
      status: (type === "url" && contentBlocked) ? "needs_review" : "processing",
      // Explicitly null, not a placeholder number. The auto-delete trigger
      // (enforce_relevance_threshold) is written to skip rows where
      // global_relevance_score is null — that's its intended way of saying
      // "not scored yet, don't judge it." A hardcoded placeholder of 5 here
      // defeated that entirely: the trigger fired on THIS insert, saw 5,
      // and deleted the row immediately whenever the threshold was above 5
      // — before process-reference-card ever got a chance to compute the
      // real score. The column itself even has a default of 5, so leaving
      // this key out isn't enough; it must be set to null explicitly.
      global_relevance_score: null,
      user_id: user_id,
      content_quality: contentQuality,
      content_warning: contentWarning,
      from_company: from_company === true,
      // Manual human override (e.g. "Keep anyway" on a Discover Sources
      // candidate that scored too low). Read by trg_enforce_relevance_threshold,
      // which otherwise deletes the row the instant it's scored below the
      // account's auto-delete threshold.
      force_keep: force_keep === true,
    };

    if (question_set_id && question_set_id.trim() !== "") {
      insertData.question_set_id = question_set_id;
      console.log("✅ Adding question_set_id:", question_set_id);
    }

    const { data: cardData, error: insertError } = await supabase
      .from("reference_cards")
      .insert(insertData)
      .select()
      .single();

    if (insertError) {
      console.error("❌ Failed to create reference card:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to create reference card", details: insertError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("✅ Reference card created:", cardData.id);

    if (!contentBlocked && textContent.length >= 100) {
      console.log("🚀 Triggering auto-processing for card:", cardData.id);
      try {
        // userId is passed explicitly here (not just cardId) so
        // process-reference-card's service-role path doesn't have to
        // re-look-up this row by id right after we just inserted it.
        const { error: processError } = await supabase.functions.invoke("process-reference-card", {
          body: { cardId: cardData.id, userId: user_id },
        });

        if (processError) {
          console.error("⚠️ Auto-processing failed:", processError);
          await supabase.from("reference_cards").update({ status: "needs_review" }).eq("id", cardData.id);
        } else {
          console.log("✅ Auto-processing triggered successfully");
        }
      } catch (processInvokeError) {
        console.error("⚠️ Failed to invoke auto-processing:", processInvokeError);
      }
    } else {
      console.log("⏸️ Skipping auto-processing - insufficient content or blocked site");
    }

    console.log("🎉 create-manual-source completed successfully");
    return new Response(
      JSON.stringify({
        success: true,
        cardId: cardData.id,
        message: contentBlocked
          ? "Reference card created (site blocked full access - manual review needed)"
          : "Reference card created successfully",
        contentStatus: contentBlocked ? "blocked" : "processed",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("💥 CRITICAL Error in create-manual-source:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to create manual source",
        details: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
