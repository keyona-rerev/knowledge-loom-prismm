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
          created_at: string | null
          custom_template_id: string | null
          frequency: string | null
          id: string
          is_active: boolean | null
          last_run_at: string | null
          name: string
          output_format: string | null
          source_feed_ids: string[] | null
          topic_filters: string[] | null
          updated_at: string | null
          use_global_questions: boolean | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          custom_template_id?: string | null
          frequency?: string | null
          id?: string
          is_active?: boolean | null
          last_run_at?: string | null
          name: string
          output_format?: string | null
          source_feed_ids?: string[] | null
          topic_filters?: string[] | null
          updated_at?: string | null
          use_global_questions?: boolean | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          custom_template_id?: string | null
          frequency?: string | null
          id?: string
          is_active?: boolean | null
          last_run_at?: string | null
          name?: string
          output_format?: string | null
          source_feed_ids?: string[] | null
          topic_filters?: string[] | null
          updated_at?: string | null
          use_global_questions?: boolean | null
          user_id?: string
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
          article_relevance_scores: Json | null
          autopilot_template_id: string | null
          body: string | null
          content_type: string | null
          created_at: string | null
          id: string
          insights_summary: string[] | null
          manual_revision_notes: string | null
          reference_card_ids: string[] | null
          revision_count: number | null
          seed_category: string | null
          seed_insight: string | null
          selected_direction: string | null
          status: string | null
          title: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          article_relevance_scores?: Json | null
          autopilot_template_id?: string | null
          body?: string | null
          content_type?: string | null
          created_at?: string | null
          id?: string
          insights_summary?: string[] | null
          manual_revision_notes?: string | null
          reference_card_ids?: string[] | null
          revision_count?: number | null
          seed_category?: string | null
          seed_insight?: string | null
          selected_direction?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          article_relevance_scores?: Json | null
          autopilot_template_id?: string | null
          body?: string | null
          content_type?: string | null
          created_at?: string | null
          id?: string
          insights_summary?: string[] | null
          manual_revision_notes?: string | null
          reference_card_ids?: string[] | null
          revision_count?: number | null
          seed_category?: string | null
          seed_insight?: string | null
          selected_direction?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "drafts_autopilot_template_id_fkey"
            columns: ["autopilot_template_id"]
            isOneToOne: false
            referencedRelation: "autopilot_templates"
            referencedColumns: ["id"]
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
          brand_voice: string | null
          business_description: string | null
          business_name: string | null
          created_at: string | null
          global_insight_questions: Json | null
          id: string
          target_audience: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          brand_voice?: string | null
          business_description?: string | null
          business_name?: string | null
          created_at?: string | null
          global_insight_questions?: Json | null
          id?: string
          target_audience?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          brand_voice?: string | null
          business_description?: string | null
          business_name?: string | null
          created_at?: string | null
          global_insight_questions?: Json | null
          id?: string
          target_audience?: string | null
          updated_at?: string | null
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
          created_at: string | null
          global_relevance_score: number | null
          id: string
          insight_answers: Json | null
          is_used: boolean | null
          modified_by_user: boolean | null
          original_text: string | null
          source_feed_id: string | null
          source_type: string | null
          source_url: string | null
          status: string | null
          template_id: string | null
          title: string | null
          updated_at: string | null
          user_id: string
          version_history: Json | null
        }
        Insert: {
          created_at?: string | null
          global_relevance_score?: number | null
          id?: string
          insight_answers?: Json | null
          is_used?: boolean | null
          modified_by_user?: boolean | null
          original_text?: string | null
          source_feed_id?: string | null
          source_type?: string | null
          source_url?: string | null
          status?: string | null
          template_id?: string | null
          title?: string | null
          updated_at?: string | null
          user_id: string
          version_history?: Json | null
        }
        Update: {
          created_at?: string | null
          global_relevance_score?: number | null
          id?: string
          insight_answers?: Json | null
          is_used?: boolean | null
          modified_by_user?: boolean | null
          original_text?: string | null
          source_feed_id?: string | null
          source_type?: string | null
          source_url?: string | null
          status?: string | null
          template_id?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string
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
          user_id: string
        }
        Insert: {
          created_at?: string | null
          credibility_score?: number | null
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
          user_id: string
        }
        Update: {
          created_at?: string | null
          credibility_score?: number | null
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
          user_id?: string
        }
        Relationships: []
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
