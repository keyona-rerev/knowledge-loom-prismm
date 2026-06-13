export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audience_profile: {
        Row: {
          asset_range: string | null
          channels: string[]
          core_systems: string | null
          created_at: string
          fit_criteria: string[]
          id: string
          institution_type: string | null
          language_avoid: string[]
          language_use: string[]
          thesis: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          asset_range?: string | null
          channels?: string[]
          core_systems?: string | null
          created_at?: string
          fit_criteria?: string[]
          id?: string
          institution_type?: string | null
          language_avoid?: string[]
          language_use?: string[]
          thesis?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          asset_range?: string | null
          channels?: string[]
          core_systems?: string | null
          created_at?: string
          fit_criteria?: string[]
          id?: string
          institution_type?: string | null
          language_avoid?: string[]
          language_use?: string[]
          thesis?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      autopilot_templates: {
        Row: {
          approval_required: boolean | null
          content_type: string | null
          created_at: string | null
          custom_template_id: string | null
          expected_delivery_time: string | null
          frequency: string | null
          id: string
          is_active: boolean | null
          last_run_at: string | null
          name: string
          next_run_at: string | null
          output_format: string | null
          schedule_config: Json | null
          source_feed_ids: string[] | null
          topic_filters: string[] | null
          updated_at: string | null
          use_global_questions: boolean | null
          user_id: string | null
        }
        Insert: {
          approval_required?: boolean | null
          content_type?: string | null
          created_at?: string | null
          custom_template_id?: string | null
          expected_delivery_time?: string | null
          frequency?: string | null
          id?: string
          is_active?: boolean | null
          last_run_at?: string | null
          name: string
          next_run_at?: string | null
          output_format?: string | null
          schedule_config?: Json | null
          source_feed_ids?: string[] | null
          topic_filters?: string[] | null
          updated_at?: string | null
          use_global_questions?: boolean | null
          user_id?: string | null
        }
        Update: {
          approval_required?: boolean | null
          content_type?: string | null
          created_at?: string | null
          custom_template_id?: string | null
          expected_delivery_time?: string | null
          frequency?: string | null
          id?: string
          is_active?: boolean | null
          last_run_at?: string | null
          name?: string
          next_run_at?: string | null
          output_format?: string | null
          schedule_config?: Json | null
          source_feed_ids?: string[] | null
          topic_filters?: string[] | null
          updated_at?: string | null
          use_global_questions?: boolean | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "autopilot_templates_custom_template_id_fkey"
            columns: ["custom_template_id"]
            isOneToOne: false
            referencedRelation: "reference_card_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      content_calendar: {
        Row: {
          content_type: string | null
          created_at: string | null
          draft_id: string | null
          id: string
          scheduled_date: string
          status: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          content_type?: string | null
          created_at?: string | null
          draft_id?: string | null
          id?: string
          scheduled_date: string
          status?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          content_type?: string | null
          created_at?: string | null
          draft_id?: string | null
          id?: string
          scheduled_date?: string
          status?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_calendar_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "drafts"
            referencedColumns: ["id"]
          },
        ]
      }
      content_schedules: {
        Row: {
          anchor: number | null
          child_format_id: string | null
          child_nature_id: string | null
          created_at: string
          day_of_week: number
          format_id: string
          frequency: string
          id: string
          is_active: boolean
          job_id: string
          lane_id: string | null
          max_reuse_count: number
          nature_id: string
          reader_id: string | null
          requires_child: boolean
          reuse_window_days: number
          updated_at: string
          user_id: string
        }
        Insert: {
          anchor?: number | null
          child_format_id?: string | null
          child_nature_id?: string | null
          created_at?: string
          day_of_week: number
          format_id: string
          frequency?: string
          id?: string
          is_active?: boolean
          job_id: string
          lane_id?: string | null
          max_reuse_count?: number
          nature_id: string
          reader_id?: string | null
          requires_child?: boolean
          reuse_window_days?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          anchor?: number | null
          child_format_id?: string | null
          child_nature_id?: string | null
          created_at?: string
          day_of_week?: number
          format_id?: string
          frequency?: string
          id?: string
          is_active?: boolean
          job_id?: string
          lane_id?: string | null
          max_reuse_count?: number
          nature_id?: string
          reader_id?: string | null
          requires_child?: boolean
          reuse_window_days?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_schedules_child_format_id_fkey"
            columns: ["child_format_id"]
            isOneToOne: false
            referencedRelation: "formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_schedules_child_nature_id_fkey"
            columns: ["child_nature_id"]
            isOneToOne: false
            referencedRelation: "natures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_schedules_format_id_fkey"
            columns: ["format_id"]
            isOneToOne: false
            referencedRelation: "formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_schedules_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_schedules_lane_id_fkey"
            columns: ["lane_id"]
            isOneToOne: false
            referencedRelation: "lanes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_schedules_nature_id_fkey"
            columns: ["nature_id"]
            isOneToOne: false
            referencedRelation: "natures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_schedules_reader_id_fkey"
            columns: ["reader_id"]
            isOneToOne: false
            referencedRelation: "readers"
            referencedColumns: ["id"]
          },
        ]
      }
      content_templates: {
        Row: {
          content_type: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          is_system_template: boolean | null
          name: string
          template_structure: Json
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          content_type: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_system_template?: boolean | null
          name: string
          template_structure: Json
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          content_type?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_system_template?: boolean | null
          name?: string
          template_structure?: Json
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      draft_revisions: {
        Row: {
          body: string | null
          changes_summary: string | null
          created_at: string | null
          draft_id: string | null
          id: string
          version: number
        }
        Insert: {
          body?: string | null
          changes_summary?: string | null
          created_at?: string | null
          draft_id?: string | null
          id?: string
          version: number
        }
        Update: {
          body?: string | null
          changes_summary?: string | null
          created_at?: string | null
          draft_id?: string | null
          id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "draft_revisions_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "drafts"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_visuals: {
        Row: {
          created_at: string | null
          draft_id: string
          error_message: string | null
          html_content: string
          id: string
          status: string | null
          updated_at: string | null
          user_id: string
          visual_type: string
        }
        Insert: {
          created_at?: string | null
          draft_id: string
          error_message?: string | null
          html_content: string
          id?: string
          status?: string | null
          updated_at?: string | null
          user_id: string
          visual_type: string
        }
        Update: {
          created_at?: string | null
          draft_id?: string
          error_message?: string | null
          html_content?: string
          id?: string
          status?: string | null
          updated_at?: string | null
          user_id?: string
          visual_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "draft_visuals_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "drafts"
            referencedColumns: ["id"]
          },
        ]
      }
      drafts: {
        Row: {
          approval_status: string | null
          article_relevance_scores: Json | null
          autopilot_template_id: string | null
          body: string | null
          content_type: string | null
          created_at: string | null
          format_id: string | null
          id: string
          insights_summary: string[] | null
          job_id: string | null
          lane_id: string | null
          manual_revision_notes: string | null
          max_reuse_count: number | null
          nature_id: string | null
          parent_draft_id: string | null
          published_at: string | null
          reader_id: string | null
          reference_card_ids: string[] | null
          reuse_angles_used: Json
          reuse_count: number
          reuse_window_days: number | null
          review_notes: string | null
          reviewed_at: string | null
          revised_from: string | null
          revision_count: number | null
          revision_feedback: string | null
          schedule_id: string | null
          scheduled_publish_date: string | null
          seed_category: string | null
          seed_id: string | null
          seed_insight: string | null
          selected_direction: string | null
          status: string | null
          submitted_for_approval_at: string | null
          template_id: string | null
          title: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          approval_status?: string | null
          article_relevance_scores?: Json | null
          autopilot_template_id?: string | null
          body?: string | null
          content_type?: string | null
          created_at?: string | null
          format_id?: string | null
          id?: string
          insights_summary?: string[] | null
          job_id?: string | null
          lane_id?: string | null
          manual_revision_notes?: string | null
          max_reuse_count?: number | null
          nature_id?: string | null
          parent_draft_id?: string | null
          published_at?: string | null
          reader_id?: string | null
          reference_card_ids?: string[] | null
          reuse_angles_used?: Json
          reuse_count?: number
          reuse_window_days?: number | null
          review_notes?: string | null
          reviewed_at?: string | null
          revised_from?: string | null
          revision_count?: number | null
          revision_feedback?: string | null
          schedule_id?: string | null
          scheduled_publish_date?: string | null
          seed_category?: string | null
          seed_id?: string | null
          seed_insight?: string | null
          selected_direction?: string | null
          status?: string | null
          submitted_for_approval_at?: string | null
          template_id?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          approval_status?: string | null
          article_relevance_scores?: Json | null
          autopilot_template_id?: string | null
          body?: string | null
          content_type?: string | null
          created_at?: string | null
          format_id?: string | null
          id?: string
          insights_summary?: string[] | null
          job_id?: string | null
          lane_id?: string | null
          manual_revision_notes?: string | null
          max_reuse_count?: number | null
          nature_id?: string | null
          parent_draft_id?: string | null
          published_at?: string | null
          reader_id?: string | null
          reference_card_ids?: string[] | null
          reuse_angles_used?: Json
          reuse_count?: number
          reuse_window_days?: number | null
          review_notes?: string | null
          reviewed_at?: string | null
          revised_from?: string | null
          revision_count?: number | null
          revision_feedback?: string | null
          schedule_id?: string | null
          scheduled_publish_date?: string | null
          seed_category?: string | null
          seed_id?: string | null
          seed_insight?: string | null
          selected_direction?: string | null
          status?: string | null
          submitted_for_approval_at?: string | null
          template_id?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "drafts_autopilot_template_id_fkey"
            columns: ["autopilot_template_id"]
            isOneToOne: false
            referencedRelation: "autopilot_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drafts_format_id_fkey"
            columns: ["format_id"]
            isOneToOne: false
            referencedRelation: "formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drafts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drafts_lane_id_fkey"
            columns: ["lane_id"]
            isOneToOne: false
            referencedRelation: "lanes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drafts_nature_id_fkey"
            columns: ["nature_id"]
            isOneToOne: false
            referencedRelation: "natures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drafts_parent_draft_id_fkey"
            columns: ["parent_draft_id"]
            isOneToOne: false
            referencedRelation: "drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drafts_reader_id_fkey"
            columns: ["reader_id"]
            isOneToOne: false
            referencedRelation: "readers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drafts_revised_from_fkey"
            columns: ["revised_from"]
            isOneToOne: false
            referencedRelation: "drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drafts_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "content_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drafts_seed_id_fkey"
            columns: ["seed_id"]
            isOneToOne: false
            referencedRelation: "seeds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drafts_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "content_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      email_notifications: {
        Row: {
          action_taken: string | null
          clicked_at: string | null
          created_at: string | null
          draft_id: string | null
          id: string
          opened_at: string | null
          sent_at: string | null
          type: string
          user_id: string
        }
        Insert: {
          action_taken?: string | null
          clicked_at?: string | null
          created_at?: string | null
          draft_id?: string | null
          id?: string
          opened_at?: string | null
          sent_at?: string | null
          type: string
          user_id: string
        }
        Update: {
          action_taken?: string | null
          clicked_at?: string | null
          created_at?: string | null
          draft_id?: string | null
          id?: string
          opened_at?: string | null
          sent_at?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_notifications_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "drafts"
            referencedColumns: ["id"]
          },
        ]
      }
      formats: {
        Row: {
          created_at: string
          definition: string | null
          id: string
          is_active: boolean
          key: string
          max_words: number | null
          min_words: number | null
          name: string
          platform: string
          sort_order: number
          updated_at: string
          user_id: string
          writing_samples: Json
        }
        Insert: {
          created_at?: string
          definition?: string | null
          id?: string
          is_active?: boolean
          key: string
          max_words?: number | null
          min_words?: number | null
          name: string
          platform?: string
          sort_order?: number
          updated_at?: string
          user_id: string
          writing_samples?: Json
        }
        Update: {
          created_at?: string
          definition?: string | null
          id?: string
          is_active?: boolean
          key?: string
          max_words?: number | null
          min_words?: number | null
          name?: string
          platform?: string
          sort_order?: number
          updated_at?: string
          user_id?: string
          writing_samples?: Json
        }
        Relationships: []
      }
      insight_cards: {
        Row: {
          content: string
          context: string | null
          created_at: string
          id: string
          insight_type: string | null
          priority: number | null
          status: string | null
          tags: string[] | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          context?: string | null
          created_at?: string
          id?: string
          insight_type?: string | null
          priority?: number | null
          status?: string | null
          tags?: string[] | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          context?: string | null
          created_at?: string
          id?: string
          insight_type?: string | null
          priority?: number | null
          status?: string | null
          tags?: string[] | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "insight_cards_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      insight_ratings: {
        Row: {
          created_at: string | null
          draft_id: string | null
          id: string
          rating: number | null
          reference_card_id: string | null
          revision_version: number | null
        }
        Insert: {
          created_at?: string | null
          draft_id?: string | null
          id?: string
          rating?: number | null
          reference_card_id?: string | null
          revision_version?: number | null
        }
        Update: {
          created_at?: string | null
          draft_id?: string | null
          id?: string
          rating?: number | null
          reference_card_id?: string | null
          revision_version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "insight_ratings_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insight_ratings_reference_card_id_fkey"
            columns: ["reference_card_id"]
            isOneToOne: false
            referencedRelation: "reference_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          created_at: string
          description: string | null
          funnel_stage: string
          id: string
          is_active: boolean
          key: string
          kind: string
          name: string
          sort_order: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          funnel_stage?: string
          id?: string
          is_active?: boolean
          key: string
          kind?: string
          name: string
          sort_order?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          funnel_stage?: string
          id?: string
          is_active?: boolean
          key?: string
          kind?: string
          name?: string
          sort_order?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      lanes: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          is_wedge: boolean
          key: string
          name: string
          sort_order: number
          updated_at: string
          user_id: string
          vocabulary: string[]
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_wedge?: boolean
          key: string
          name: string
          sort_order?: number
          updated_at?: string
          user_id: string
          vocabulary?: string[]
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_wedge?: boolean
          key?: string
          name?: string
          sort_order?: number
          updated_at?: string
          user_id?: string
          vocabulary?: string[]
        }
        Relationships: []
      }
      natures: {
        Row: {
          absorbs: string[]
          created_at: string
          evidence_type: string | null
          fit: string
          id: string
          is_active: boolean
          key: string
          move: string | null
          name: string
          rotation_mode: string
          sort_order: number
          updated_at: string
          user_id: string
          writing_samples: Json
        }
        Insert: {
          absorbs?: string[]
          created_at?: string
          evidence_type?: string | null
          fit?: string
          id?: string
          is_active?: boolean
          key: string
          move?: string | null
          name: string
          rotation_mode?: string
          sort_order?: number
          updated_at?: string
          user_id: string
          writing_samples?: Json
        }
        Update: {
          absorbs?: string[]
          created_at?: string
          evidence_type?: string | null
          fit?: string
          id?: string
          is_active?: boolean
          key?: string
          move?: string | null
          name?: string
          rotation_mode?: string
          sort_order?: number
          updated_at?: string
          user_id?: string
          writing_samples?: Json
        }
        Relationships: []
      }
      newsletter_emails: {
        Row: {
          from_address: string | null
          gmail_message_id: string | null
          id: string
          processing_status: string | null
          received_at: string | null
          reference_card_id: string | null
          subject: string | null
          user_id: string
        }
        Insert: {
          from_address?: string | null
          gmail_message_id?: string | null
          id?: string
          processing_status?: string | null
          received_at?: string | null
          reference_card_id?: string | null
          subject?: string | null
          user_id: string
        }
        Update: {
          from_address?: string | null
          gmail_message_id?: string | null
          id?: string
          processing_status?: string | null
          received_at?: string | null
          reference_card_id?: string | null
          subject?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "newsletter_emails_reference_card_id_fkey"
            columns: ["reference_card_id"]
            isOneToOne: false
            referencedRelation: "reference_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          accent_color: string | null
          active_question_indices: number[] | null
          ai_model: string | null
          ai_provider: string | null
          brand_voice: string | null
          business_description: string | null
          business_name: string | null
          content_type_templates: Json | null
          created_at: string | null
          custom_ai_endpoint: string | null
          custom_ai_model_name: string | null
          email: string | null
          google_ai_api_key: string | null
          id: string
          newsletter_domain: string | null
          primary_color: string | null
          secondary_color: string | null
          target_audience: string | null
          updated_at: string | null
          user_id: string
          writing_examples: Json | null
        }
        Insert: {
          accent_color?: string | null
          active_question_indices?: number[] | null
          ai_model?: string | null
          ai_provider?: string | null
          brand_voice?: string | null
          business_description?: string | null
          business_name?: string | null
          content_type_templates?: Json | null
          created_at?: string | null
          custom_ai_endpoint?: string | null
          custom_ai_model_name?: string | null
          email?: string | null
          google_ai_api_key?: string | null
          id?: string
          newsletter_domain?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          target_audience?: string | null
          updated_at?: string | null
          user_id: string
          writing_examples?: Json | null
        }
        Update: {
          accent_color?: string | null
          active_question_indices?: number[] | null
          ai_model?: string | null
          ai_provider?: string | null
          brand_voice?: string | null
          business_description?: string | null
          business_name?: string | null
          content_type_templates?: Json | null
          created_at?: string | null
          custom_ai_endpoint?: string | null
          custom_ai_model_name?: string | null
          email?: string | null
          google_ai_api_key?: string | null
          id?: string
          newsletter_domain?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          target_audience?: string | null
          updated_at?: string | null
          user_id?: string
          writing_examples?: Json | null
        }
        Relationships: []
      }
      question_sets: {
        Row: {
          created_at: string
          id: string
          is_active: boolean | null
          is_global: boolean | null
          name: string
          questions: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean | null
          is_global?: boolean | null
          name: string
          questions: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean | null
          is_global?: boolean | null
          name?: string
          questions?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      rate_limit_logs: {
        Row: {
          action: string
          created_at: string | null
          id: string
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string | null
          id?: string
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string | null
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      reader_questions: {
        Row: {
          created_at: string
          id: string
          question: string
          reader_id: string
          sort_order: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          question: string
          reader_id: string
          sort_order?: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          question?: string
          reader_id?: string
          sort_order?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reader_questions_reader_id_fkey"
            columns: ["reader_id"]
            isOneToOne: false
            referencedRelation: "readers"
            referencedColumns: ["id"]
          },
        ]
      }
      readers: {
        Row: {
          activation_trigger: string | null
          avatar_initials: string | null
          created_at: string
          id: string
          is_active: boolean
          is_published_to: boolean
          key: string
          lane_scope: string
          role: string
          side: string
          sort_order: number
          threat_item_id: string | null
          updated_at: string
          user_id: string
          who: string | null
        }
        Insert: {
          activation_trigger?: string | null
          avatar_initials?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_published_to?: boolean
          key: string
          lane_scope?: string
          role: string
          side?: string
          sort_order?: number
          threat_item_id?: string | null
          updated_at?: string
          user_id: string
          who?: string | null
        }
        Update: {
          activation_trigger?: string | null
          avatar_initials?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_published_to?: boolean
          key?: string
          lane_scope?: string
          role?: string
          side?: string
          sort_order?: number
          threat_item_id?: string | null
          updated_at?: string
          user_id?: string
          who?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "readers_threat_item_id_fkey"
            columns: ["threat_item_id"]
            isOneToOne: false
            referencedRelation: "swot_items"
            referencedColumns: ["id"]
          },
        ]
      }
      reference_card_templates: {
        Row: {
          created_at: string | null
          custom_questions: Json | null
          id: string
          is_active: boolean | null
          name: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          custom_questions?: Json | null
          id?: string
          is_active?: boolean | null
          name: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          custom_questions?: Json | null
          id?: string
          is_active?: boolean | null
          name?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      reference_cards: {
        Row: {
          ai_summary: string | null
          content_quality: string | null
          content_warning: string | null
          created_at: string | null
          global_relevance_score: number | null
          id: string
          insight_answers: Json | null
          is_used: boolean | null
          modified_by_user: boolean | null
          original_text: string | null
          question_set_id: string | null
          source_feed_id: string | null
          source_type: string | null
          source_url: string | null
          status: string | null
          template_id: string | null
          title: string | null
          updated_at: string | null
          user_id: string | null
          version_history: Json | null
        }
        Insert: {
          ai_summary?: string | null
          content_quality?: string | null
          content_warning?: string | null
          created_at?: string | null
          global_relevance_score?: number | null
          id?: string
          insight_answers?: Json | null
          is_used?: boolean | null
          modified_by_user?: boolean | null
          original_text?: string | null
          question_set_id?: string | null
          source_feed_id?: string | null
          source_type?: string | null
          source_url?: string | null
          status?: string | null
          template_id?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
          version_history?: Json | null
        }
        Update: {
          ai_summary?: string | null
          content_quality?: string | null
          content_warning?: string | null
          created_at?: string | null
          global_relevance_score?: number | null
          id?: string
          insight_answers?: Json | null
          is_used?: boolean | null
          modified_by_user?: boolean | null
          original_text?: string | null
          question_set_id?: string | null
          source_feed_id?: string | null
          source_type?: string | null
          source_url?: string | null
          status?: string | null
          template_id?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
          version_history?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "reference_cards_source_feed_id_fkey"
            columns: ["source_feed_id"]
            isOneToOne: false
            referencedRelation: "source_feeds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_cards_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "reference_card_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      seeds: {
        Row: {
          category: string | null
          created_at: string
          id: string
          is_active: boolean
          lane_scope: string
          last_used_at: string | null
          premise: string
          sort_order: number
          suggested_nature_key: string | null
          times_used: number
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          lane_scope?: string
          last_used_at?: string | null
          premise: string
          sort_order?: number
          suggested_nature_key?: string | null
          times_used?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          lane_scope?: string
          last_used_at?: string | null
          premise?: string
          sort_order?: number
          suggested_nature_key?: string | null
          times_used?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      source_feeds: {
        Row: {
          created_at: string | null
          credibility_score: number | null
          default_template_id: string | null
          feed_type: string | null
          health_status: string | null
          id: string
          is_active: boolean | null
          last_pulled_at: string | null
          last_successful_pull_at: string | null
          name: string
          topic_keywords: string[] | null
          updated_at: string | null
          url: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          credibility_score?: number | null
          default_template_id?: string | null
          feed_type?: string | null
          health_status?: string | null
          id?: string
          is_active?: boolean | null
          last_pulled_at?: string | null
          last_successful_pull_at?: string | null
          name: string
          topic_keywords?: string[] | null
          updated_at?: string | null
          url: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          credibility_score?: number | null
          default_template_id?: string | null
          feed_type?: string | null
          health_status?: string | null
          id?: string
          is_active?: boolean | null
          last_pulled_at?: string | null
          last_successful_pull_at?: string | null
          name?: string
          topic_keywords?: string[] | null
          updated_at?: string | null
          url?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "source_feeds_default_template_id_fkey"
            columns: ["default_template_id"]
            isOneToOne: false
            referencedRelation: "reference_card_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      swot_items: {
        Row: {
          body: string
          created_at: string
          id: string
          lane_id: string | null
          quadrant: string
          sort_order: number
          threat_class: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          lane_id?: string | null
          quadrant: string
          sort_order?: number
          threat_class?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          lane_id?: string | null
          quadrant?: string
          sort_order?: number
          threat_class?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "swot_items_lane_id_fkey"
            columns: ["lane_id"]
            isOneToOne: false
            referencedRelation: "lanes"
            referencedColumns: ["id"]
          },
        ]
      }
      user_newsletter_emails: {
        Row: {
          created_at: string | null
          email_address: string
          email_prefix: string
          id: string
          is_active: boolean | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          email_address: string
          email_prefix: string
          id?: string
          is_active?: boolean | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          email_address?: string
          email_prefix?: string
          id?: string
          is_active?: boolean | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_rate_limit_logs: { Args: never; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
