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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          id: number
          new_data: Json | null
          old_data: Json | null
          org_id: string
          record_id: string | null
          table_name: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          id?: number
          new_data?: Json | null
          old_data?: Json | null
          org_id: string
          record_id?: string | null
          table_name: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          id?: number
          new_data?: Json | null
          old_data?: Json | null
          org_id?: string
          record_id?: string | null
          table_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      case_types: {
        Row: {
          created_at: string | null
          id: string
          is_archived: boolean | null
          map_tag: string | null
          name: string
          org_id: string
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_archived?: boolean | null
          map_tag?: string | null
          name: string
          org_id: string
          sort_order?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_archived?: boolean | null
          map_tag?: string | null
          name?: string
          org_id?: string
          sort_order?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "case_types_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string | null
          id: string
          is_archived: boolean | null
          name: string
          org_id: string
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_archived?: boolean | null
          name: string
          org_id: string
          sort_order?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_archived?: boolean | null
          name?: string
          org_id?: string
          sort_order?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categories_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      constraints: {
        Row: {
          created_at: string | null
          id: string
          is_archived: boolean | null
          mapped_key: string
          max_allowed_value: number | null
          min_allowed_value: number | null
          name: string
          no_label: string | null
          no_maps_to: string | null
          org_id: string
          secondary_mapped_key: string | null
          sort_order: number
          type: string
          updated_at: string | null
          yes_label: string | null
          yes_maps_to: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_archived?: boolean | null
          mapped_key: string
          max_allowed_value?: number | null
          min_allowed_value?: number | null
          name: string
          no_label?: string | null
          no_maps_to?: string | null
          org_id: string
          secondary_mapped_key?: string | null
          sort_order?: number
          type: string
          updated_at?: string | null
          yes_label?: string | null
          yes_maps_to?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_archived?: boolean | null
          mapped_key?: string
          max_allowed_value?: number | null
          min_allowed_value?: number | null
          name?: string
          no_label?: string | null
          no_maps_to?: string | null
          org_id?: string
          secondary_mapped_key?: string | null
          sort_order?: number
          type?: string
          updated_at?: string | null
          yes_label?: string | null
          yes_maps_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "constraints_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      import_history: {
        Row: {
          created_at: string | null
          duplicates_detected: number | null
          errors: number | null
          filename: string | null
          id: string
          mapping_template: Json | null
          org_id: string
          providers_created: number | null
          providers_updated: number | null
          rows_processed: number | null
        }
        Insert: {
          created_at?: string | null
          duplicates_detected?: number | null
          errors?: number | null
          filename?: string | null
          id?: string
          mapping_template?: Json | null
          org_id: string
          providers_created?: number | null
          providers_updated?: number | null
          rows_processed?: number | null
        }
        Update: {
          created_at?: string | null
          duplicates_detected?: number | null
          errors?: number | null
          filename?: string | null
          id?: string
          mapping_template?: Json | null
          org_id?: string
          providers_created?: number | null
          providers_updated?: number | null
          rows_processed?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "import_history_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          address: string | null
          created_at: string | null
          directions_url: string | null
          id: string
          is_archived: boolean | null
          name: string
          org_id: string
          phone: string | null
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string | null
          directions_url?: string | null
          id?: string
          is_archived?: boolean | null
          name: string
          org_id: string
          phone?: string | null
          sort_order?: number
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string | null
          directions_url?: string | null
          id?: string
          is_archived?: boolean | null
          name?: string
          org_id?: string
          phone?: string | null
          sort_order?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "locations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      offerings: {
        Row: {
          case_type_id: string
          constraints: Json | null
          created_at: string | null
          id: string
          is_archived: boolean | null
          location_ids: string[]
          org_id: string
          provider_id: string
          updated_at: string | null
        }
        Insert: {
          case_type_id: string
          constraints?: Json | null
          created_at?: string | null
          id?: string
          is_archived?: boolean | null
          location_ids?: string[]
          org_id: string
          provider_id: string
          updated_at?: string | null
        }
        Update: {
          case_type_id?: string
          constraints?: Json | null
          created_at?: string | null
          id?: string
          is_archived?: boolean | null
          location_ids?: string[]
          org_id?: string
          provider_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "offerings_case_type_id_fkey"
            columns: ["case_type_id"]
            isOneToOne: false
            referencedRelation: "case_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offerings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offerings_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          org_id: string
          role: string
          status: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          org_id: string
          role?: string
          status?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          org_id?: string
          role?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_invitations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          allowed_domains: string[] | null
          created_at: string | null
          default_booking_mode: string | null
          default_phone_mode: string | null
          fallback_message: string | null
          fallback_phone: string | null
          id: string
          name: string
          onboarding_completed: boolean | null
          updated_at: string | null
        }
        Insert: {
          allowed_domains?: string[] | null
          created_at?: string | null
          default_booking_mode?: string | null
          default_phone_mode?: string | null
          fallback_message?: string | null
          fallback_phone?: string | null
          id?: string
          name: string
          onboarding_completed?: boolean | null
          updated_at?: string | null
        }
        Update: {
          allowed_domains?: string[] | null
          created_at?: string | null
          default_booking_mode?: string | null
          default_phone_mode?: string | null
          fallback_message?: string | null
          fallback_phone?: string | null
          id?: string
          name?: string
          onboarding_completed?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      provider_locations: {
        Row: {
          bio_link: string | null
          booking_link: string | null
          created_at: string | null
          id: string
          location_id: string
          phone: string | null
          provider_id: string
          updated_at: string | null
        }
        Insert: {
          bio_link?: string | null
          booking_link?: string | null
          created_at?: string | null
          id?: string
          location_id: string
          phone?: string | null
          provider_id: string
          updated_at?: string | null
        }
        Update: {
          bio_link?: string | null
          booking_link?: string | null
          created_at?: string | null
          id?: string
          location_id?: string
          phone?: string | null
          provider_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_locations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_locations_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      providers: {
        Row: {
          bio_link: string | null
          booking_mode: string | null
          category_ids: string[]
          created_at: string | null
          email: string | null
          id: string
          image_url: string | null
          is_archived: boolean | null
          name: string
          normalized_name: string | null
          npi: string | null
          org_id: string
          phone_mode: string | null
          subtitle: string | null
          updated_at: string | null
        }
        Insert: {
          bio_link?: string | null
          booking_mode?: string | null
          category_ids?: string[]
          created_at?: string | null
          email?: string | null
          id?: string
          image_url?: string | null
          is_archived?: boolean | null
          name: string
          normalized_name?: string | null
          npi?: string | null
          org_id: string
          phone_mode?: string | null
          subtitle?: string | null
          updated_at?: string | null
        }
        Update: {
          bio_link?: string | null
          booking_mode?: string | null
          category_ids?: string[]
          created_at?: string | null
          email?: string | null
          id?: string
          image_url?: string | null
          is_archived?: boolean | null
          name?: string
          normalized_name?: string | null
          npi?: string | null
          org_id?: string
          phone_mode?: string | null
          subtitle?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "providers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      questions: {
        Row: {
          constraint_id: string | null
          created_at: string | null
          id: string
          input_type: string
          is_archived: boolean | null
          order_rank: number
          org_id: string
          question_text: string
          question_type: string
          required: boolean
          subtext: string | null
          system_config: Json | null
          updated_at: string | null
        }
        Insert: {
          constraint_id?: string | null
          created_at?: string | null
          id?: string
          input_type?: string
          is_archived?: boolean | null
          order_rank?: number
          org_id: string
          question_text: string
          question_type?: string
          required?: boolean
          subtext?: string | null
          system_config?: Json | null
          updated_at?: string | null
        }
        Update: {
          constraint_id?: string | null
          created_at?: string | null
          id?: string
          input_type?: string
          is_archived?: boolean | null
          order_rank?: number
          org_id?: string
          question_text?: string
          question_type?: string
          required?: boolean
          subtext?: string | null
          system_config?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "questions_constraint_id_fkey"
            columns: ["constraint_id"]
            isOneToOne: false
            referencedRelation: "constraints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string | null
          email: string
          id: string
          name: string | null
          org_id: string
          role: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          id: string
          name?: string | null
          org_id: string
          role?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          name?: string | null
          org_id?: string
          role?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      widget_session_events: {
        Row: {
          answer_text: string | null
          created_at: string | null
          event_type: string
          id: string
          org_id: string
          question_id: string | null
          question_text: string | null
          session_id: string
          step_index: number | null
          widget_id: string
        }
        Insert: {
          answer_text?: string | null
          created_at?: string | null
          event_type: string
          id?: string
          org_id: string
          question_id?: string | null
          question_text?: string | null
          session_id: string
          step_index?: number | null
          widget_id: string
        }
        Update: {
          answer_text?: string | null
          created_at?: string | null
          event_type?: string
          id?: string
          org_id?: string
          question_id?: string | null
          question_text?: string | null
          session_id?: string
          step_index?: number | null
          widget_id?: string
        }
        Relationships: []
      }
      widget_sessions: {
        Row: {
          answers: Json | null
          case_type_id: string | null
          clicks_detail: Json
          created_at: string | null
          id: string
          org_id: string | null
          providers_clicked: string[] | null
          providers_shown: string[]
          providers_shown_source: string
          results_count: number | null
          results_positions: Json
          scroll_depth: Json | null
          session_id: string
          widget_id: string | null
          zero_results: boolean | null
        }
        Insert: {
          answers?: Json | null
          case_type_id?: string | null
          clicks_detail?: Json
          created_at?: string | null
          id?: string
          org_id?: string | null
          providers_clicked?: string[] | null
          providers_shown?: string[]
          providers_shown_source?: string
          results_count?: number | null
          results_positions?: Json
          scroll_depth?: Json | null
          session_id: string
          widget_id?: string | null
          zero_results?: boolean | null
        }
        Update: {
          answers?: Json | null
          case_type_id?: string | null
          clicks_detail?: Json
          created_at?: string | null
          id?: string
          org_id?: string | null
          providers_clicked?: string[] | null
          providers_shown?: string[]
          providers_shown_source?: string
          results_count?: number | null
          results_positions?: Json
          scroll_depth?: Json | null
          session_id?: string
          widget_id?: string | null
          zero_results?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "widget_sessions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "widget_sessions_widget_id_fkey"
            columns: ["widget_id"]
            isOneToOne: false
            referencedRelation: "widgets"
            referencedColumns: ["id"]
          },
        ]
      }
      widgets: {
        Row: {
          button_animation: string
          button_icon_type: string
          button_icon_value: string | null
          button_subtext: string | null
          button_text: string | null
          created_at: string | null
          disclaimer_text: string | null
          embed_mode: string | null
          fallback_message: string | null
          greeting_text: string | null
          id: string
          name: string
          open_delay_enabled: boolean
          open_delay_seconds: number
          org_id: string
          primary_color: string | null
          privacy_url: string | null
          published_at: string | null
          published_snapshot: Json | null
          question_order: Json
          scoped_case_type_ids: string[]
          scoped_location_ids: string[]
          scoped_provider_ids: string[]
          scoped_question_ids: string[]
          show_worth_the_drive: boolean | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          button_animation?: string
          button_icon_type?: string
          button_icon_value?: string | null
          button_subtext?: string | null
          button_text?: string | null
          created_at?: string | null
          disclaimer_text?: string | null
          embed_mode?: string | null
          fallback_message?: string | null
          greeting_text?: string | null
          id?: string
          name: string
          open_delay_enabled?: boolean
          open_delay_seconds?: number
          org_id: string
          primary_color?: string | null
          privacy_url?: string | null
          published_at?: string | null
          published_snapshot?: Json | null
          question_order?: Json
          scoped_case_type_ids?: string[]
          scoped_location_ids?: string[]
          scoped_provider_ids?: string[]
          scoped_question_ids?: string[]
          show_worth_the_drive?: boolean | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          button_animation?: string
          button_icon_type?: string
          button_icon_value?: string | null
          button_subtext?: string | null
          button_text?: string | null
          created_at?: string | null
          disclaimer_text?: string | null
          embed_mode?: string | null
          fallback_message?: string | null
          greeting_text?: string | null
          id?: string
          name?: string
          open_delay_enabled?: boolean
          open_delay_seconds?: number
          org_id?: string
          primary_color?: string | null
          privacy_url?: string | null
          published_at?: string | null
          published_snapshot?: Json | null
          question_order?: Json
          scoped_case_type_ids?: string[]
          scoped_location_ids?: string[]
          scoped_provider_ids?: string[]
          scoped_question_ids?: string[]
          show_worth_the_drive?: boolean | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "widgets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      complete_signup: {
        Args: { p_org_name: string; p_user_name: string }
        Returns: Json
      }
      execute_provider_import: { Args: { p_payload: Json }; Returns: Json }
      normalize_name: { Args: { input: string }; Returns: string }
      set_organization_member_role: {
        Args: { p_role: string; p_user_id: string }
        Returns: undefined
      }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
