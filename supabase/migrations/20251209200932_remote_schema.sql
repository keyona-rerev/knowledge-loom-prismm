


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."cleanup_rate_limit_logs"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  DELETE FROM public.rate_limit_logs WHERE created_at < now() - interval '24 hours';
END;
$$;


ALTER FUNCTION "public"."cleanup_rate_limit_logs"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (
    user_id,
    business_name,
    business_description,
    target_audience,
    brand_voice,
    email
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'business_name', 'My Business'),
    '',
    '',
    '',
    NEW.email
  );
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."autopilot_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "name" "text" NOT NULL,
    "is_active" boolean DEFAULT true,
    "frequency" "text" DEFAULT 'weekly'::"text",
    "source_feed_ids" "uuid"[],
    "topic_filters" "text"[],
    "output_format" "text" DEFAULT 'text'::"text",
    "use_global_questions" boolean DEFAULT true,
    "custom_template_id" "uuid",
    "last_run_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "next_run_at" timestamp with time zone,
    "approval_required" boolean DEFAULT true,
    "schedule_config" "jsonb" DEFAULT '{}'::"jsonb",
    "expected_delivery_time" "text",
    "content_type" "text",
    CONSTRAINT "autopilot_templates_frequency_check" CHECK (("frequency" = ANY (ARRAY['weekly'::"text", 'bi-weekly'::"text", 'monthly'::"text"]))),
    CONSTRAINT "autopilot_templates_output_format_check" CHECK (("output_format" = ANY (ARRAY['text'::"text", 'visual'::"text"])))
);


ALTER TABLE "public"."autopilot_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."content_calendar" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "draft_id" "uuid",
    "scheduled_date" timestamp with time zone NOT NULL,
    "content_type" "text" DEFAULT 'blog_post'::"text",
    "status" "text" DEFAULT 'scheduled'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."content_calendar" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."content_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "name" character varying NOT NULL,
    "content_type" character varying NOT NULL,
    "description" "text",
    "template_structure" "jsonb" NOT NULL,
    "is_active" boolean DEFAULT true,
    "is_system_template" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."content_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."draft_revisions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "draft_id" "uuid",
    "version" integer NOT NULL,
    "body" "text",
    "changes_summary" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."draft_revisions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."drafts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "autopilot_template_id" "uuid",
    "title" "text",
    "body" "text",
    "content_type" "text",
    "seed_insight" "text",
    "seed_category" "text",
    "selected_direction" "text",
    "reference_card_ids" "uuid"[],
    "article_relevance_scores" "jsonb" DEFAULT '{}'::"jsonb",
    "status" "text" DEFAULT 'draft'::"text",
    "revision_count" integer DEFAULT 0,
    "insights_summary" "text"[],
    "manual_revision_notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "approval_status" "text" DEFAULT 'pending'::"text",
    "submitted_for_approval_at" timestamp with time zone,
    "reviewed_at" timestamp with time zone,
    "review_notes" "text",
    "revision_feedback" "text",
    "revised_from" "uuid",
    "scheduled_publish_date" timestamp with time zone,
    "template_id" "uuid",
    CONSTRAINT "drafts_content_type_check" CHECK (("content_type" = ANY (ARRAY['autopilot'::"text", 'ad-hoc'::"text"]))),
    CONSTRAINT "drafts_seed_category_check" CHECK (("seed_category" = ANY (ARRAY['thesis'::"text", 'hook'::"text", 'closing'::"text", 'contrarian'::"text", 'other'::"text"]))),
    CONSTRAINT "drafts_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'in_revision'::"text", 'final'::"text", 'published'::"text"])))
);


ALTER TABLE "public"."drafts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "draft_id" "uuid",
    "type" "text" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"(),
    "opened_at" timestamp with time zone,
    "clicked_at" timestamp with time zone,
    "action_taken" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."email_notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."insight_cards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "content" "text" NOT NULL,
    "insight_type" "text" DEFAULT 'observation'::"text",
    "context" "text",
    "priority" integer DEFAULT 3,
    "tags" "text"[],
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'active'::"text"
);


ALTER TABLE "public"."insight_cards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."insight_ratings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "draft_id" "uuid",
    "reference_card_id" "uuid",
    "rating" integer,
    "revision_version" integer DEFAULT 1,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "insight_ratings_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 3)))
);


ALTER TABLE "public"."insight_ratings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."newsletter_emails" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "from_address" "text",
    "subject" "text",
    "received_at" timestamp with time zone DEFAULT "now"(),
    "reference_card_id" "uuid",
    "processing_status" "text" DEFAULT 'pending'::"text"
);


ALTER TABLE "public"."newsletter_emails" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "business_name" "text",
    "business_description" "text",
    "target_audience" "text",
    "brand_voice" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "email" "text",
    "primary_color" "text" DEFAULT '#9b87f5'::"text",
    "secondary_color" "text" DEFAULT '#7E69AB'::"text",
    "accent_color" "text" DEFAULT '#6E59A5'::"text",
    "ai_provider" "text" DEFAULT 'google-ai'::"text",
    "ai_model" "text" DEFAULT 'gemini-2.0-flash-exp'::"text",
    "google_ai_api_key" "text",
    "custom_ai_endpoint" "text",
    "custom_ai_model_name" "text",
    "writing_examples" "jsonb" DEFAULT '[]'::"jsonb",
    "content_type_templates" "jsonb" DEFAULT '[{"id": "linkedin", "name": "LinkedIn Post", "prompt": "LinkedIn posts are concise, professional updates (1300-1500 characters max). Structure: Hook opening line, 2-3 key points with line breaks for readability, call-to-action or question to drive engagement. Tone: Professional yet conversational, thought leadership style. Include: Industry insights, actionable takeaways, personal perspective. Formatting: Short paragraphs (1-2 sentences), strategic emoji use, clear spacing."}, {"id": "blog_post", "name": "Blog Post", "prompt": "Blog posts are comprehensive, SEO-optimized articles (1200-2000 words). Structure: Compelling headline, engaging introduction with hook, 3-5 main sections with H2/H3 headers, concrete examples and data, summary with clear takeaways. Tone: Authoritative yet accessible, educational. Include: Research-backed insights, real-world examples, actionable advice, internal/external links. Formatting: Scannable with subheadings, bullet points, short paragraphs (3-4 sentences)."}, {"id": "case_study", "name": "Case Study", "prompt": "Case studies are detailed success stories (1500-2500 words). Structure: Executive summary, challenge/problem statement, solution approach with methodology, results with specific metrics/outcomes, key learnings. Tone: Professional, analytical, results-focused. Include: Specific data and metrics, before/after comparisons, quotes or testimonials, visual data representations. Formatting: Clear sections with headers, data callout boxes, conclusion with replicable insights."}]'::"jsonb",
    "active_question_indices" integer[] DEFAULT '{}'::integer[],
    "newsletter_domain" "text",
    CONSTRAINT "profiles_ai_provider_check" CHECK (("ai_provider" = ANY (ARRAY['google-ai'::"text", 'custom'::"text", 'lovable-ai'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."profiles"."writing_examples" IS 'Array of up to 4 writing examples to train AI on user voice and style';



COMMENT ON COLUMN "public"."profiles"."content_type_templates" IS 'User-defined content type templates with custom prompts for AI generation';



CREATE TABLE IF NOT EXISTS "public"."question_sets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "questions" "text"[] NOT NULL,
    "is_global" boolean DEFAULT false,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."question_sets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rate_limit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."rate_limit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reference_card_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "custom_questions" "jsonb" DEFAULT '[]'::"jsonb",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."reference_card_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reference_cards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "source_feed_id" "uuid",
    "template_id" "uuid",
    "source_type" "text",
    "source_url" "text",
    "original_text" "text",
    "title" "text",
    "insight_answers" "jsonb" DEFAULT '{}'::"jsonb",
    "global_relevance_score" integer DEFAULT 5,
    "status" "text" DEFAULT 'active'::"text",
    "is_used" boolean DEFAULT false,
    "modified_by_user" boolean DEFAULT false,
    "version_history" "jsonb" DEFAULT '[]'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "ai_summary" "text",
    "content_quality" "text" DEFAULT 'unknown'::"text",
    "content_warning" "text",
    "question_set_id" "uuid",
    CONSTRAINT "reference_cards_global_relevance_score_check" CHECK ((("global_relevance_score" >= 1) AND ("global_relevance_score" <= 10))),
    CONSTRAINT "reference_cards_source_type_check" CHECK (("source_type" = ANY (ARRAY['rss'::"text", 'manual'::"text", 'pdf'::"text", 'newsletter'::"text"]))),
    CONSTRAINT "reference_cards_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text", 'processing'::"text", 'needs_review'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."reference_cards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."source_feeds" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "url" "text" NOT NULL,
    "name" "text" NOT NULL,
    "feed_type" "text" DEFAULT 'rss'::"text",
    "credibility_score" integer DEFAULT 5,
    "topic_keywords" "text"[],
    "is_active" boolean DEFAULT true,
    "last_pulled_at" timestamp with time zone,
    "last_successful_pull_at" timestamp with time zone,
    "health_status" "text" DEFAULT 'healthy'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "default_template_id" "uuid",
    CONSTRAINT "source_feeds_credibility_score_check" CHECK ((("credibility_score" >= 1) AND ("credibility_score" <= 10))),
    CONSTRAINT "source_feeds_health_status_check" CHECK (("health_status" = ANY (ARRAY['healthy'::"text", 'failing'::"text", 'inactive'::"text"])))
);


ALTER TABLE "public"."source_feeds" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_newsletter_emails" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "email_address" "text" NOT NULL,
    "email_prefix" "text" NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_newsletter_emails" OWNER TO "postgres";


ALTER TABLE ONLY "public"."autopilot_templates"
    ADD CONSTRAINT "autopilot_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content_calendar"
    ADD CONSTRAINT "content_calendar_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content_templates"
    ADD CONSTRAINT "content_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."draft_revisions"
    ADD CONSTRAINT "draft_revisions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."drafts"
    ADD CONSTRAINT "drafts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_notifications"
    ADD CONSTRAINT "email_notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_newsletter_emails"
    ADD CONSTRAINT "email_prefix_unique" UNIQUE ("email_prefix");



ALTER TABLE ONLY "public"."insight_cards"
    ADD CONSTRAINT "insight_cards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."insight_ratings"
    ADD CONSTRAINT "insight_ratings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."newsletter_emails"
    ADD CONSTRAINT "newsletter_emails_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."question_sets"
    ADD CONSTRAINT "question_sets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rate_limit_logs"
    ADD CONSTRAINT "rate_limit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reference_card_templates"
    ADD CONSTRAINT "reference_card_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reference_cards"
    ADD CONSTRAINT "reference_cards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."source_feeds"
    ADD CONSTRAINT "source_feeds_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_newsletter_emails"
    ADD CONSTRAINT "user_newsletter_emails_email_address_key" UNIQUE ("email_address");



ALTER TABLE ONLY "public"."user_newsletter_emails"
    ADD CONSTRAINT "user_newsletter_emails_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_content_calendar_scheduled_date" ON "public"."content_calendar" USING "btree" ("scheduled_date");



CREATE INDEX "idx_content_calendar_status" ON "public"."content_calendar" USING "btree" ("status");



CREATE INDEX "idx_content_calendar_user_id" ON "public"."content_calendar" USING "btree" ("user_id");



CREATE INDEX "idx_email_notifications_draft_id" ON "public"."email_notifications" USING "btree" ("draft_id");



CREATE INDEX "idx_email_notifications_sent_at" ON "public"."email_notifications" USING "btree" ("sent_at");



CREATE INDEX "idx_email_notifications_user_id" ON "public"."email_notifications" USING "btree" ("user_id");



CREATE INDEX "idx_insight_cards_created_at" ON "public"."insight_cards" USING "btree" ("created_at");



CREATE INDEX "idx_insight_cards_status" ON "public"."insight_cards" USING "btree" ("status");



CREATE INDEX "idx_insight_cards_user_id" ON "public"."insight_cards" USING "btree" ("user_id");



CREATE INDEX "idx_newsletter_emails_user_received" ON "public"."newsletter_emails" USING "btree" ("user_id", "received_at");



CREATE INDEX "idx_rate_limit_user_action_time" ON "public"."rate_limit_logs" USING "btree" ("user_id", "action", "created_at");



CREATE INDEX "idx_reference_cards_question_set_id" ON "public"."reference_cards" USING "btree" ("question_set_id");



CREATE OR REPLACE TRIGGER "update_autopilot_updated_at" BEFORE UPDATE ON "public"."autopilot_templates" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "update_cards_updated_at" BEFORE UPDATE ON "public"."reference_cards" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "update_content_calendar_updated_at" BEFORE UPDATE ON "public"."content_calendar" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "update_content_templates_updated_at" BEFORE UPDATE ON "public"."content_templates" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "update_drafts_updated_at" BEFORE UPDATE ON "public"."drafts" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "update_feeds_updated_at" BEFORE UPDATE ON "public"."source_feeds" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "update_insight_cards_updated_at" BEFORE UPDATE ON "public"."insight_cards" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "update_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "update_question_sets_updated_at" BEFORE UPDATE ON "public"."question_sets" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "update_templates_updated_at" BEFORE UPDATE ON "public"."reference_card_templates" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



ALTER TABLE ONLY "public"."autopilot_templates"
    ADD CONSTRAINT "autopilot_templates_custom_template_id_fkey" FOREIGN KEY ("custom_template_id") REFERENCES "public"."reference_card_templates"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."content_calendar"
    ADD CONSTRAINT "content_calendar_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_templates"
    ADD CONSTRAINT "content_templates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."draft_revisions"
    ADD CONSTRAINT "draft_revisions_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."drafts"
    ADD CONSTRAINT "drafts_autopilot_template_id_fkey" FOREIGN KEY ("autopilot_template_id") REFERENCES "public"."autopilot_templates"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."drafts"
    ADD CONSTRAINT "drafts_revised_from_fkey" FOREIGN KEY ("revised_from") REFERENCES "public"."drafts"("id");



ALTER TABLE ONLY "public"."drafts"
    ADD CONSTRAINT "drafts_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."content_templates"("id");



ALTER TABLE ONLY "public"."email_notifications"
    ADD CONSTRAINT "email_notifications_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."email_notifications"
    ADD CONSTRAINT "email_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."insight_cards"
    ADD CONSTRAINT "insight_cards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."insight_ratings"
    ADD CONSTRAINT "insight_ratings_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."insight_ratings"
    ADD CONSTRAINT "insight_ratings_reference_card_id_fkey" FOREIGN KEY ("reference_card_id") REFERENCES "public"."reference_cards"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."newsletter_emails"
    ADD CONSTRAINT "newsletter_emails_reference_card_id_fkey" FOREIGN KEY ("reference_card_id") REFERENCES "public"."reference_cards"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."newsletter_emails"
    ADD CONSTRAINT "newsletter_emails_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reference_cards"
    ADD CONSTRAINT "reference_cards_source_feed_id_fkey" FOREIGN KEY ("source_feed_id") REFERENCES "public"."source_feeds"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reference_cards"
    ADD CONSTRAINT "reference_cards_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."reference_card_templates"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."source_feeds"
    ADD CONSTRAINT "source_feeds_default_template_id_fkey" FOREIGN KEY ("default_template_id") REFERENCES "public"."reference_card_templates"("id");



ALTER TABLE ONLY "public"."user_newsletter_emails"
    ADD CONSTRAINT "user_newsletter_emails_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Anyone can view global question sets" ON "public"."question_sets" FOR SELECT USING (("is_global" = true));



CREATE POLICY "Service role can manage rate limits" ON "public"."rate_limit_logs" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Users can delete own autopilot templates" ON "public"."autopilot_templates" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete own calendar slots" ON "public"."content_calendar" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete own cards" ON "public"."reference_cards" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete own drafts" ON "public"."drafts" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete own feeds" ON "public"."source_feeds" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete own insight cards" ON "public"."insight_cards" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete own question sets" ON "public"."question_sets" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete own templates" ON "public"."content_templates" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete own templates" ON "public"."reference_card_templates" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own autopilot templates" ON "public"."autopilot_templates" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own calendar slots" ON "public"."content_calendar" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own cards" ON "public"."reference_cards" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own draft revisions" ON "public"."draft_revisions" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."drafts"
  WHERE (("drafts"."id" = "draft_revisions"."draft_id") AND ("drafts"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can insert own drafts" ON "public"."drafts" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own email notifications" ON "public"."email_notifications" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own feeds" ON "public"."source_feeds" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own insight cards" ON "public"."insight_cards" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own insight ratings" ON "public"."insight_ratings" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."drafts"
  WHERE (("drafts"."id" = "insight_ratings"."draft_id") AND ("drafts"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can insert own newsletter email" ON "public"."user_newsletter_emails" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own profile" ON "public"."profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own question sets" ON "public"."question_sets" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own templates" ON "public"."content_templates" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own templates" ON "public"."reference_card_templates" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own autopilot templates" ON "public"."autopilot_templates" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own calendar slots" ON "public"."content_calendar" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own cards" ON "public"."reference_cards" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own drafts" ON "public"."drafts" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own email notifications" ON "public"."email_notifications" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own feeds" ON "public"."source_feeds" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own insight cards" ON "public"."insight_cards" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own newsletter email" ON "public"."user_newsletter_emails" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own profile" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own question sets" ON "public"."question_sets" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own templates" ON "public"."content_templates" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own templates" ON "public"."reference_card_templates" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own autopilot templates" ON "public"."autopilot_templates" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own calendar slots" ON "public"."content_calendar" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own cards" ON "public"."reference_cards" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own draft revisions" ON "public"."draft_revisions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."drafts"
  WHERE (("drafts"."id" = "draft_revisions"."draft_id") AND ("drafts"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view own drafts" ON "public"."drafts" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own email notifications" ON "public"."email_notifications" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own feeds" ON "public"."source_feeds" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own insight cards" ON "public"."insight_cards" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own insight ratings" ON "public"."insight_ratings" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."drafts"
  WHERE (("drafts"."id" = "insight_ratings"."draft_id") AND ("drafts"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view own newsletter email" ON "public"."user_newsletter_emails" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own newsletter emails" ON "public"."newsletter_emails" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own profile" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own question sets" ON "public"."question_sets" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own templates" ON "public"."reference_card_templates" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own templates and system templates" ON "public"."content_templates" FOR SELECT USING ((("auth"."uid"() = "user_id") OR ("is_system_template" = true)));



ALTER TABLE "public"."content_calendar" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."content_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."email_notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."insight_cards" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."newsletter_emails" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."question_sets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rate_limit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_newsletter_emails" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

























































































































































GRANT ALL ON FUNCTION "public"."cleanup_rate_limit_logs"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_rate_limit_logs"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_rate_limit_logs"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "service_role";


















GRANT ALL ON TABLE "public"."autopilot_templates" TO "anon";
GRANT ALL ON TABLE "public"."autopilot_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."autopilot_templates" TO "service_role";



GRANT ALL ON TABLE "public"."content_calendar" TO "anon";
GRANT ALL ON TABLE "public"."content_calendar" TO "authenticated";
GRANT ALL ON TABLE "public"."content_calendar" TO "service_role";



GRANT ALL ON TABLE "public"."content_templates" TO "anon";
GRANT ALL ON TABLE "public"."content_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."content_templates" TO "service_role";



GRANT ALL ON TABLE "public"."draft_revisions" TO "anon";
GRANT ALL ON TABLE "public"."draft_revisions" TO "authenticated";
GRANT ALL ON TABLE "public"."draft_revisions" TO "service_role";



GRANT ALL ON TABLE "public"."drafts" TO "anon";
GRANT ALL ON TABLE "public"."drafts" TO "authenticated";
GRANT ALL ON TABLE "public"."drafts" TO "service_role";



GRANT ALL ON TABLE "public"."email_notifications" TO "anon";
GRANT ALL ON TABLE "public"."email_notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."email_notifications" TO "service_role";



GRANT ALL ON TABLE "public"."insight_cards" TO "anon";
GRANT ALL ON TABLE "public"."insight_cards" TO "authenticated";
GRANT ALL ON TABLE "public"."insight_cards" TO "service_role";



GRANT ALL ON TABLE "public"."insight_ratings" TO "anon";
GRANT ALL ON TABLE "public"."insight_ratings" TO "authenticated";
GRANT ALL ON TABLE "public"."insight_ratings" TO "service_role";



GRANT ALL ON TABLE "public"."newsletter_emails" TO "anon";
GRANT ALL ON TABLE "public"."newsletter_emails" TO "authenticated";
GRANT ALL ON TABLE "public"."newsletter_emails" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."question_sets" TO "anon";
GRANT ALL ON TABLE "public"."question_sets" TO "authenticated";
GRANT ALL ON TABLE "public"."question_sets" TO "service_role";



GRANT ALL ON TABLE "public"."rate_limit_logs" TO "anon";
GRANT ALL ON TABLE "public"."rate_limit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."rate_limit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."reference_card_templates" TO "anon";
GRANT ALL ON TABLE "public"."reference_card_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."reference_card_templates" TO "service_role";



GRANT ALL ON TABLE "public"."reference_cards" TO "anon";
GRANT ALL ON TABLE "public"."reference_cards" TO "authenticated";
GRANT ALL ON TABLE "public"."reference_cards" TO "service_role";



GRANT ALL ON TABLE "public"."source_feeds" TO "anon";
GRANT ALL ON TABLE "public"."source_feeds" TO "authenticated";
GRANT ALL ON TABLE "public"."source_feeds" TO "service_role";



GRANT ALL ON TABLE "public"."user_newsletter_emails" TO "anon";
GRANT ALL ON TABLE "public"."user_newsletter_emails" TO "authenticated";
GRANT ALL ON TABLE "public"."user_newsletter_emails" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


