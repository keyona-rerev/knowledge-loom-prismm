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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
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
      drafts: {
        Row: {
          approval_status: string | null
          article_relevance_scores: Json | null
          autopilot_template_id: string | null
          body: string | null
          content_type: string | null
          created_at: string | null
          id: string
          insights_summary: string[] | null
          manual_revision_notes: string | null
          reference_card_ids: string[] | null
          review_notes: string | null
          reviewed_at: string | null
          revised_from: string | null
          revision_count: number | null
          revision_feedback: string | null
          scheduled_publish_date: string | null
          seed_category: string | null
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
          id?: string
          insights_summary?: string[] | null
          manual_revision_notes?: string | null
          reference_card_ids?: string[] | null
          review_notes?: string | null
          reviewed_at?: string | null
          revised_from?: string | null
          revision_count?: number | null
          revision_feedback?: string | null
          scheduled_publish_date?: string | null
          seed_category?: string | null
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
          id?: string
          insights_summary?: string[] | null
          manual_revision_notes?: string | null
          reference_card_ids?: string[] | null
          review_notes?: string | null
          reviewed_at?: string | null
          revised_from?: string | null
          revision_count?: number | null
          revision_feedback?: string | null
          scheduled_publish_date?: string | null
          seed_category?: string | null
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
            foreignKeyName: "drafts_revised_from_fkey"
            columns: ["revised_from"]
            isOneToOne: false
            referencedRelation: "drafts"
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
      profiles: {
        Row: {
          accent_color: string | null
          ai_model: string | null
          ai_provider: string | null
          brand_voice: string | null
          business_description: string | null
          business_name: string | null
          created_at: string | null
          custom_ai_endpoint: string | null
          custom_ai_model_name: string | null
          email: string | null
          google_ai_api_key: string | null
          id: string
          primary_color: string | null
          secondary_color: string | null
          target_audience: string | null
          updated_at: string | null
          user_id: string
          writing_examples: Json | null
        }
        Insert: {
          accent_color?: string | null
          ai_model?: string | null
          ai_provider?: string | null
          brand_voice?: string | null
          business_description?: string | null
          business_name?: string | null
          created_at?: string | null
          custom_ai_endpoint?: string | null
          custom_ai_model_name?: string | null
          email?: string | null
          google_ai_api_key?: string | null
          id?: string
          primary_color?: string | null
          secondary_color?: string | null
          target_audience?: string | null
          updated_at?: string | null
          user_id: string
          writing_examples?: Json | null
        }
        Update: {
          accent_color?: string | null
          ai_model?: string | null
          ai_provider?: string | null
          brand_voice?: string | null
          business_description?: string | null
          business_name?: string | null
          created_at?: string | null
          custom_ai_endpoint?: string | null
          custom_ai_model_name?: string | null
          email?: string | null
          google_ai_api_key?: string | null
          id?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
