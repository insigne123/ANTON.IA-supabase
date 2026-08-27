export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
      activity_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json | null
          organization_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json | null
          organization_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json | null
          organization_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      antonia_app_suggestions: {
        Row: {
          context: string | null
          created_at: string
          description: string
          id: string
          is_read: boolean
          suggested_by_mission_id: string | null
          suggestion_type: string
        }
        Insert: {
          context?: string | null
          created_at?: string
          description: string
          id?: string
          is_read?: boolean
          suggested_by_mission_id?: string | null
          suggestion_type?: string
        }
        Update: {
          context?: string | null
          created_at?: string
          description?: string
          id?: string
          is_read?: boolean
          suggested_by_mission_id?: string | null
          suggestion_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "antonia_app_suggestions_suggested_by_mission_id_fkey"
            columns: ["suggested_by_mission_id"]
            isOneToOne: false
            referencedRelation: "antonia_missions"
            referencedColumns: ["id"]
          },
        ]
      }
      antonia_company_research_cache: {
        Row: {
          cache_key: string
          created_at: string
          created_by: string | null
          expires_at: string
          generated_at: string
          organization_id: string
          payload: Json
          updated_at: string
        }
        Insert: {
          cache_key: string
          created_at?: string
          created_by?: string | null
          expires_at: string
          generated_at: string
          organization_id: string
          payload: Json
          updated_at?: string
        }
        Update: {
          cache_key?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          generated_at?: string
          organization_id?: string
          payload?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "antonia_company_research_cache_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      antonia_config: {
        Row: {
          allow_reply_attachments: boolean
          approval_mode: string
          auto_send_booking_replies: boolean
          autopilot_enabled: boolean
          autopilot_mode: string
          booking_link: string | null
          created_at: string
          daily_contact_limit: number | null
          daily_enrich_limit: number
          daily_investigate_limit: number
          daily_report_enabled: boolean
          daily_search_limit: number
          instant_alerts_enabled: boolean
          meeting_instructions: string | null
          min_auto_send_score: number
          min_review_score: number
          notification_email: string | null
          organization_id: string
          pause_on_failure_spike: boolean
          pause_on_negative_reply: boolean
          reply_approval_mode: string
          reply_autopilot_enabled: boolean
          reply_autopilot_mode: string
          reply_max_auto_turns: number
          tracking_enabled: boolean
          updated_at: string
        }
        Insert: {
          allow_reply_attachments?: boolean
          approval_mode?: string
          auto_send_booking_replies?: boolean
          autopilot_enabled?: boolean
          autopilot_mode?: string
          booking_link?: string | null
          created_at?: string
          daily_contact_limit?: number | null
          daily_enrich_limit?: number
          daily_investigate_limit?: number
          daily_report_enabled?: boolean
          daily_search_limit?: number
          instant_alerts_enabled?: boolean
          meeting_instructions?: string | null
          min_auto_send_score?: number
          min_review_score?: number
          notification_email?: string | null
          organization_id: string
          pause_on_failure_spike?: boolean
          pause_on_negative_reply?: boolean
          reply_approval_mode?: string
          reply_autopilot_enabled?: boolean
          reply_autopilot_mode?: string
          reply_max_auto_turns?: number
          tracking_enabled?: boolean
          updated_at?: string
        }
        Update: {
          allow_reply_attachments?: boolean
          approval_mode?: string
          auto_send_booking_replies?: boolean
          autopilot_enabled?: boolean
          autopilot_mode?: string
          booking_link?: string | null
          created_at?: string
          daily_contact_limit?: number | null
          daily_enrich_limit?: number
          daily_investigate_limit?: number
          daily_report_enabled?: boolean
          daily_search_limit?: number
          instant_alerts_enabled?: boolean
          meeting_instructions?: string | null
          min_auto_send_score?: number
          min_review_score?: number
          notification_email?: string | null
          organization_id?: string
          pause_on_failure_spike?: boolean
          pause_on_negative_reply?: boolean
          reply_approval_mode?: string
          reply_autopilot_enabled?: boolean
          reply_autopilot_mode?: string
          reply_max_auto_turns?: number
          tracking_enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "antonia_config_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      antonia_daily_usage: {
        Row: {
          date: string
          leads_enriched: number
          leads_investigated: number
          leads_searched: number
          organization_id: string
          search_runs: number
          updated_at: string
        }
        Insert: {
          date: string
          leads_enriched?: number
          leads_investigated?: number
          leads_searched?: number
          organization_id: string
          search_runs?: number
          updated_at?: string
        }
        Update: {
          date?: string
          leads_enriched?: number
          leads_investigated?: number
          leads_searched?: number
          organization_id?: string
          search_runs?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "antonia_daily_usage_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      antonia_event_ledger: {
        Row: {
          actor_ref: string | null
          actor_type: string
          actor_user_id: string | null
          attempt_number: number
          campaign_id: string | null
          campaign_step_id: string | null
          causation_id: string | null
          contacted_id: string | null
          correlation_id: string | null
          created_at: string
          dispatch_id: string | null
          duration_ms: number | null
          entity_id: string | null
          entity_type: string | null
          error_code: string | null
          event_key: string
          event_type: string
          event_version: number
          external_entity_id: string | null
          id: string
          idempotency_key: string | null
          initiated_by_ref: string | null
          initiated_by_user_id: string | null
          lead_id: string | null
          message: string | null
          metrics: Json
          mission_id: string | null
          occurred_at: string
          operation_id: string | null
          organization_id: string | null
          organization_ref: string | null
          outcome: string | null
          payload_hash: string | null
          payload_retention_until: string
          privacy_class: string
          provider: string | null
          provider_request_id: string | null
          recorded_at: string
          redacted_payload: Json
          reporting_group_id: string | null
          request_id: string | null
          research_job_id: string | null
          retention_until: string
          severity: string | null
          source_confidence: string
          source_route: string | null
          source_system: string
          status: string | null
          task_id: string | null
        }
        Insert: {
          actor_ref?: string | null
          actor_type?: string
          actor_user_id?: string | null
          attempt_number?: number
          campaign_id?: string | null
          campaign_step_id?: string | null
          causation_id?: string | null
          contacted_id?: string | null
          correlation_id?: string | null
          created_at?: string
          dispatch_id?: string | null
          duration_ms?: number | null
          entity_id?: string | null
          entity_type?: string | null
          error_code?: string | null
          event_key: string
          event_type: string
          event_version?: number
          external_entity_id?: string | null
          id?: string
          idempotency_key?: string | null
          initiated_by_ref?: string | null
          initiated_by_user_id?: string | null
          lead_id?: string | null
          message?: string | null
          metrics?: Json
          mission_id?: string | null
          occurred_at?: string
          operation_id?: string | null
          organization_id?: string | null
          organization_ref?: string | null
          outcome?: string | null
          payload_hash?: string | null
          payload_retention_until?: string
          privacy_class?: string
          provider?: string | null
          provider_request_id?: string | null
          recorded_at?: string
          redacted_payload?: Json
          reporting_group_id?: string | null
          request_id?: string | null
          research_job_id?: string | null
          retention_until?: string
          severity?: string | null
          source_confidence?: string
          source_route?: string | null
          source_system?: string
          status?: string | null
          task_id?: string | null
        }
        Update: {
          actor_ref?: string | null
          actor_type?: string
          actor_user_id?: string | null
          attempt_number?: number
          campaign_id?: string | null
          campaign_step_id?: string | null
          causation_id?: string | null
          contacted_id?: string | null
          correlation_id?: string | null
          created_at?: string
          dispatch_id?: string | null
          duration_ms?: number | null
          entity_id?: string | null
          entity_type?: string | null
          error_code?: string | null
          event_key?: string
          event_type?: string
          event_version?: number
          external_entity_id?: string | null
          id?: string
          idempotency_key?: string | null
          initiated_by_ref?: string | null
          initiated_by_user_id?: string | null
          lead_id?: string | null
          message?: string | null
          metrics?: Json
          mission_id?: string | null
          occurred_at?: string
          operation_id?: string | null
          organization_id?: string | null
          organization_ref?: string | null
          outcome?: string | null
          payload_hash?: string | null
          payload_retention_until?: string
          privacy_class?: string
          provider?: string | null
          provider_request_id?: string | null
          recorded_at?: string
          redacted_payload?: Json
          reporting_group_id?: string | null
          request_id?: string | null
          research_job_id?: string | null
          retention_until?: string
          severity?: string | null
          source_confidence?: string
          source_route?: string | null
          source_system?: string
          status?: string | null
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "antonia_event_ledger_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "antonia_event_ledger_reporting_group_id_fkey"
            columns: ["reporting_group_id"]
            isOneToOne: false
            referencedRelation: "organization_reporting_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      antonia_event_rollups_daily: {
        Row: {
          actor_user_id: string | null
          bucket_date: string
          created_at: string
          event_count: number
          event_type: string
          first_occurred_at: string
          id: string
          last_occurred_at: string
          organization_id: string | null
          outcome: string | null
          provider: string | null
          refreshed_at: string
          source_confidence: string
          source_system: string
          status: string | null
          total_duration_ms: number
        }
        Insert: {
          actor_user_id?: string | null
          bucket_date: string
          created_at?: string
          event_count: number
          event_type: string
          first_occurred_at: string
          id?: string
          last_occurred_at: string
          organization_id?: string | null
          outcome?: string | null
          provider?: string | null
          refreshed_at?: string
          source_confidence?: string
          source_system: string
          status?: string | null
          total_duration_ms?: number
        }
        Update: {
          actor_user_id?: string | null
          bucket_date?: string
          created_at?: string
          event_count?: number
          event_type?: string
          first_occurred_at?: string
          id?: string
          last_occurred_at?: string
          organization_id?: string | null
          outcome?: string | null
          provider?: string | null
          refreshed_at?: string
          source_confidence?: string
          source_system?: string
          status?: string | null
          total_duration_ms?: number
        }
        Relationships: [
          {
            foreignKeyName: "antonia_event_rollups_daily_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      antonia_exceptions: {
        Row: {
          category: string
          created_at: string
          dedupe_key: string | null
          description: string | null
          id: string
          lead_id: string | null
          mission_id: string | null
          organization_id: string | null
          payload: Json
          resolution_note: string | null
          resolved_at: string | null
          severity: string
          status: string
          task_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          dedupe_key?: string | null
          description?: string | null
          id?: string
          lead_id?: string | null
          mission_id?: string | null
          organization_id?: string | null
          payload?: Json
          resolution_note?: string | null
          resolved_at?: string | null
          severity?: string
          status?: string
          task_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          dedupe_key?: string | null
          description?: string | null
          id?: string
          lead_id?: string | null
          mission_id?: string | null
          organization_id?: string | null
          payload?: Json
          resolution_note?: string | null
          resolved_at?: string | null
          severity?: string
          status?: string
          task_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "antonia_exceptions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "antonia_exceptions_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "antonia_missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "antonia_exceptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "antonia_exceptions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "antonia_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      antonia_lead_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          lead_id: string | null
          message: string | null
          meta: Json | null
          mission_id: string | null
          organization_id: string | null
          outcome: string | null
          stage: string | null
          task_id: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          lead_id?: string | null
          message?: string | null
          meta?: Json | null
          mission_id?: string | null
          organization_id?: string | null
          outcome?: string | null
          stage?: string | null
          task_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          lead_id?: string | null
          message?: string | null
          meta?: Json | null
          mission_id?: string | null
          organization_id?: string | null
          outcome?: string | null
          stage?: string | null
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "antonia_lead_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "antonia_lead_events_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "antonia_missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "antonia_lead_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      antonia_logs: {
        Row: {
          created_at: string
          details: Json | null
          id: string
          level: string
          message: string
          mission_id: string | null
          organization_id: string | null
        }
        Insert: {
          created_at?: string
          details?: Json | null
          id?: string
          level?: string
          message: string
          mission_id?: string | null
          organization_id?: string | null
        }
        Update: {
          created_at?: string
          details?: Json | null
          id?: string
          level?: string
          message?: string
          mission_id?: string | null
          organization_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "antonia_logs_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "antonia_missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "antonia_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      antonia_missions: {
        Row: {
          created_at: string
          daily_contact_limit: number
          daily_enrich_limit: number
          daily_investigate_limit: number
          daily_search_limit: number
          goal_summary: string | null
          id: string
          organization_id: string | null
          params: Json
          status: string
          title: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          daily_contact_limit?: number
          daily_enrich_limit?: number
          daily_investigate_limit?: number
          daily_search_limit?: number
          goal_summary?: string | null
          id?: string
          organization_id?: string | null
          params?: Json
          status?: string
          title: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          daily_contact_limit?: number
          daily_enrich_limit?: number
          daily_investigate_limit?: number
          daily_search_limit?: number
          goal_summary?: string | null
          id?: string
          organization_id?: string | null
          params?: Json
          status?: string
          title?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "antonia_missions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      antonia_provider_usage_snapshots: {
        Row: {
          captured_at: string
          created_at: string
          cycle_end: string | null
          cycle_start: string | null
          id: string
          provider: string
          provider_account_id: string | null
          provider_user_id: string | null
          request_id: string | null
          scope_type: string
          source: string
          usage: Json
        }
        Insert: {
          captured_at?: string
          created_at?: string
          cycle_end?: string | null
          cycle_start?: string | null
          id?: string
          provider: string
          provider_account_id?: string | null
          provider_user_id?: string | null
          request_id?: string | null
          scope_type: string
          source?: string
          usage?: Json
        }
        Update: {
          captured_at?: string
          created_at?: string
          cycle_end?: string | null
          cycle_start?: string | null
          id?: string
          provider?: string
          provider_account_id?: string | null
          provider_user_id?: string | null
          request_id?: string | null
          scope_type?: string
          source?: string
          usage?: Json
        }
        Relationships: []
      }
      antonia_quota_operations: {
        Row: {
          claim_token: string | null
          claimed_at: string | null
          completed_at: string | null
          consumed_count: number
          created_at: string
          id: string
          operation_id: string
          organization_id: string
          quota_allowed: boolean
          quota_count_after: number
          quota_day: string
          quota_limit: number
          quota_scope: string
          request_fingerprint: string
          requested_count: number
          resource: string
          response_payload: Json | null
          response_status: number | null
          status: string
          submitted_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          claim_token?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          consumed_count?: number
          created_at?: string
          id?: string
          operation_id: string
          organization_id: string
          quota_allowed?: boolean
          quota_count_after?: number
          quota_day: string
          quota_limit: number
          quota_scope: string
          request_fingerprint: string
          requested_count: number
          resource: string
          response_payload?: Json | null
          response_status?: number | null
          status: string
          submitted_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          claim_token?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          consumed_count?: number
          created_at?: string
          id?: string
          operation_id?: string
          organization_id?: string
          quota_allowed?: boolean
          quota_count_after?: number
          quota_day?: string
          quota_limit?: number
          quota_scope?: string
          request_fingerprint?: string
          requested_count?: number
          resource?: string
          response_payload?: Json | null
          response_status?: number | null
          status?: string
          submitted_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "antonia_quota_operations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      antonia_reply_lab_runs: {
        Row: {
          config_snapshot: Json
          created_at: string
          id: string
          mode: string
          organization_id: string | null
          results: Json
          summary: Json
          user_id: string | null
        }
        Insert: {
          config_snapshot?: Json
          created_at?: string
          id?: string
          mode?: string
          organization_id?: string | null
          results?: Json
          summary?: Json
          user_id?: string | null
        }
        Update: {
          config_snapshot?: Json
          created_at?: string
          id?: string
          mode?: string
          organization_id?: string | null
          results?: Json
          summary?: Json
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "antonia_reply_lab_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      antonia_reports: {
        Row: {
          content: string
          created_at: string
          id: string
          mission_id: string | null
          organization_id: string | null
          sent_to: string[] | null
          summary_data: Json | null
          type: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          mission_id?: string | null
          organization_id?: string | null
          sent_to?: string[] | null
          summary_data?: Json | null
          type: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          mission_id?: string | null
          organization_id?: string | null
          sent_to?: string[] | null
          summary_data?: Json | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "antonia_reports_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "antonia_missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "antonia_reports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      antonia_segment_templates: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string
          generated_at: string
          organization_id: string
          payload: Json
          segment: string
          style_revision: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at: string
          generated_at: string
          organization_id: string
          payload: Json
          segment: string
          style_revision: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          generated_at?: string
          organization_id?: string
          payload?: Json
          segment?: string
          style_revision?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "antonia_segment_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      antonia_tasks: {
        Row: {
          created_at: string
          error_message: string | null
          heartbeat_at: string | null
          id: string
          idempotency_key: string | null
          mission_id: string | null
          organization_id: string | null
          payload: Json | null
          processing_started_at: string | null
          progress_current: number | null
          progress_label: string | null
          progress_total: number | null
          result: Json | null
          retry_count: number
          scheduled_for: string | null
          status: string
          type: string
          updated_at: string
          worker_id: string | null
          worker_source: string | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          heartbeat_at?: string | null
          id?: string
          idempotency_key?: string | null
          mission_id?: string | null
          organization_id?: string | null
          payload?: Json | null
          processing_started_at?: string | null
          progress_current?: number | null
          progress_label?: string | null
          progress_total?: number | null
          result?: Json | null
          retry_count?: number
          scheduled_for?: string | null
          status?: string
          type: string
          updated_at?: string
          worker_id?: string | null
          worker_source?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          heartbeat_at?: string | null
          id?: string
          idempotency_key?: string | null
          mission_id?: string | null
          organization_id?: string | null
          payload?: Json | null
          processing_started_at?: string | null
          progress_current?: number | null
          progress_label?: string | null
          progress_total?: number | null
          result?: Json | null
          retry_count?: number
          scheduled_for?: string | null
          status?: string
          type?: string
          updated_at?: string
          worker_id?: string | null
          worker_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "antonia_tasks_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "antonia_missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "antonia_tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      antonia_usage_increments: {
        Row: {
          amount: number
          created_at: string
          id: string
          increment_type: string
          organization_id: string | null
          task_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          id?: string
          increment_type: string
          organization_id?: string | null
          task_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          increment_type?: string
          organization_id?: string | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "antonia_usage_increments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      antonia_user_daily_usage: {
        Row: {
          date: string
          organization_id: string
          resource: string
          updated_at: string
          usage_count: number
          user_id: string
        }
        Insert: {
          date: string
          organization_id: string
          resource: string
          updated_at?: string
          usage_count?: number
          user_id: string
        }
        Update: {
          date?: string
          organization_id?: string
          resource?: string
          updated_at?: string
          usage_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "antonia_user_daily_usage_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      antonia_workflow_email_drafts: {
        Row: {
          alternative_subject: string | null
          angle_used: string | null
          body: string | null
          created_at: string
          cta: string | null
          draft_revision: number
          draft_series_key: string
          generated_at: string
          generation_id: string
          id: string
          lead_ref: string
          no_send_reason: string | null
          organization_id: string
          personalization_data: string | null
          profile_revision: number
          provider_mode: string
          quality: Json
          quality_ok: boolean
          raw_draft: Json
          schedule_state: string
          style_revision: number
          subject: string | null
          suggested_send_at: string | null
          supporting_url: string | null
          user_id: string
          wait_suggested_days: number
          workflow_research_result_id: string
          workflow_version: string
        }
        Insert: {
          alternative_subject?: string | null
          angle_used?: string | null
          body?: string | null
          created_at?: string
          cta?: string | null
          draft_revision: number
          draft_series_key: string
          generated_at: string
          generation_id: string
          id?: string
          lead_ref: string
          no_send_reason?: string | null
          organization_id: string
          personalization_data?: string | null
          profile_revision: number
          provider_mode: string
          quality: Json
          quality_ok: boolean
          raw_draft: Json
          schedule_state?: string
          style_revision: number
          subject?: string | null
          suggested_send_at?: string | null
          supporting_url?: string | null
          user_id: string
          wait_suggested_days?: number
          workflow_research_result_id: string
          workflow_version: string
        }
        Update: {
          alternative_subject?: string | null
          angle_used?: string | null
          body?: string | null
          created_at?: string
          cta?: string | null
          draft_revision?: number
          draft_series_key?: string
          generated_at?: string
          generation_id?: string
          id?: string
          lead_ref?: string
          no_send_reason?: string | null
          organization_id?: string
          personalization_data?: string | null
          profile_revision?: number
          provider_mode?: string
          quality?: Json
          quality_ok?: boolean
          raw_draft?: Json
          schedule_state?: string
          style_revision?: number
          subject?: string | null
          suggested_send_at?: string | null
          supporting_url?: string | null
          user_id?: string
          wait_suggested_days?: number
          workflow_research_result_id?: string
          workflow_version?: string
        }
        Relationships: [
          {
            foreignKeyName: "antonia_workflow_email_drafts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "antonia_workflow_email_drafts_workflow_research_result_id__fkey"
            columns: [
              "workflow_research_result_id",
              "organization_id",
              "user_id",
            ]
            isOneToOne: false
            referencedRelation: "antonia_workflow_research_results"
            referencedColumns: ["id", "organization_id", "user_id"]
          },
        ]
      }
      antonia_workflow_research_results: {
        Row: {
          assigned_angle: Json | null
          cache_key: string
          created_at: string
          enriched_lead_id: string | null
          functional_role: string | null
          generated_at: string
          generation_id: string
          id: string
          lead_ref: string
          organization_id: string
          priority: string
          provider_mode: string
          raw_result: Json
          recommendation: string
          research_insufficient: boolean
          result_revision: number
          segment: string | null
          send_order: number | null
          user_id: string
          wait_suggested_days: number
          workflow_version: string
        }
        Insert: {
          assigned_angle?: Json | null
          cache_key: string
          created_at?: string
          enriched_lead_id?: string | null
          functional_role?: string | null
          generated_at: string
          generation_id: string
          id?: string
          lead_ref: string
          organization_id: string
          priority: string
          provider_mode: string
          raw_result: Json
          recommendation: string
          research_insufficient?: boolean
          result_revision: number
          segment?: string | null
          send_order?: number | null
          user_id: string
          wait_suggested_days?: number
          workflow_version: string
        }
        Update: {
          assigned_angle?: Json | null
          cache_key?: string
          created_at?: string
          enriched_lead_id?: string | null
          functional_role?: string | null
          generated_at?: string
          generation_id?: string
          id?: string
          lead_ref?: string
          organization_id?: string
          priority?: string
          provider_mode?: string
          raw_result?: Json
          recommendation?: string
          research_insufficient?: boolean
          result_revision?: number
          segment?: string | null
          send_order?: number | null
          user_id?: string
          wait_suggested_days?: number
          workflow_version?: string
        }
        Relationships: [
          {
            foreignKeyName: "antonia_workflow_research_results_enriched_lead_id_fkey"
            columns: ["enriched_lead_id"]
            isOneToOne: false
            referencedRelation: "enriched_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "antonia_workflow_research_results_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      antonia_workflow_settings: {
        Row: {
          created_at: string
          created_by: string | null
          icp: Json
          organization_id: string
          profile_revision: number
          research_config: Json
          style_revision: number
          updated_at: string
          updated_by: string | null
          user_company_profile: Json
          writing_style: Json
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          icp?: Json
          organization_id: string
          profile_revision?: number
          research_config?: Json
          style_revision?: number
          updated_at?: string
          updated_by?: string | null
          user_company_profile?: Json
          writing_style?: Json
        }
        Update: {
          created_at?: string
          created_by?: string | null
          icp?: Json
          organization_id?: string
          profile_revision?: number
          research_config?: Json
          style_revision?: number
          updated_at?: string
          updated_by?: string | null
          user_company_profile?: Json
          writing_style?: Json
        }
        Relationships: [
          {
            foreignKeyName: "antonia_workflow_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      apollo_enrichment_callbacks: {
        Row: {
          apollo_person_id: string
          attempts: number
          created_at: string
          expires_at: string
          id: string
          idempotency_key: string
          last_error_code: string | null
          operation_id: string
          organization_id: string
          payload_hash: string | null
          processed_at: string | null
          provider_queued_at: string | null
          provider_request_id: string | null
          reveal_email: boolean
          reveal_phone: boolean
          status: string
          target_lead_id: string
          target_table: string
          token_hash: string
          updated_at: string
          user_id: string
        }
        Insert: {
          apollo_person_id: string
          attempts?: number
          created_at?: string
          expires_at: string
          id?: string
          idempotency_key: string
          last_error_code?: string | null
          operation_id: string
          organization_id: string
          payload_hash?: string | null
          processed_at?: string | null
          provider_queued_at?: string | null
          provider_request_id?: string | null
          reveal_email?: boolean
          reveal_phone?: boolean
          status?: string
          target_lead_id: string
          target_table: string
          token_hash: string
          updated_at?: string
          user_id: string
        }
        Update: {
          apollo_person_id?: string
          attempts?: number
          created_at?: string
          expires_at?: string
          id?: string
          idempotency_key?: string
          last_error_code?: string | null
          operation_id?: string
          organization_id?: string
          payload_hash?: string | null
          processed_at?: string | null
          provider_queued_at?: string | null
          provider_request_id?: string | null
          reveal_email?: boolean
          reveal_phone?: boolean
          status?: string
          target_lead_id?: string
          target_table?: string
          token_hash?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "apollo_enrichment_callbacks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      axis_empresas: {
        Row: {
          apollo_org_id: string | null
          ciudad: string | null
          created_at: string | null
          dominio: string | null
          empleados: number | null
          excluida: boolean | null
          id: string
          nombre: string
          notas: string | null
          pais: string | null
          perfil_comercial: string | null
          razon_exclusion: string | null
          sector: string | null
          updated_at: string | null
        }
        Insert: {
          apollo_org_id?: string | null
          ciudad?: string | null
          created_at?: string | null
          dominio?: string | null
          empleados?: number | null
          excluida?: boolean | null
          id?: string
          nombre: string
          notas?: string | null
          pais?: string | null
          perfil_comercial?: string | null
          razon_exclusion?: string | null
          sector?: string | null
          updated_at?: string | null
        }
        Update: {
          apollo_org_id?: string | null
          ciudad?: string | null
          created_at?: string | null
          dominio?: string | null
          empleados?: number | null
          excluida?: boolean | null
          id?: string
          nombre?: string
          notas?: string | null
          pais?: string | null
          perfil_comercial?: string | null
          razon_exclusion?: string | null
          sector?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      axis_leads: {
        Row: {
          angulo_outreach: string | null
          apellido: string | null
          apollo_person_id: string | null
          cargo: string | null
          created_at: string | null
          email: string | null
          email_status: string | null
          empresa_id: string | null
          estado: string | null
          fuente: string | null
          id: string
          linkedin_url: string | null
          nombre: string | null
          nombre_completo: string | null
          notas: string | null
          prioridad: string | null
          razon_encaje: string | null
          ronda: string | null
          score: number | null
          segmento_axis: string | null
          seniority: string | null
          telefono: string | null
          tipo_cargo: string | null
          updated_at: string | null
        }
        Insert: {
          angulo_outreach?: string | null
          apellido?: string | null
          apollo_person_id?: string | null
          cargo?: string | null
          created_at?: string | null
          email?: string | null
          email_status?: string | null
          empresa_id?: string | null
          estado?: string | null
          fuente?: string | null
          id?: string
          linkedin_url?: string | null
          nombre?: string | null
          nombre_completo?: string | null
          notas?: string | null
          prioridad?: string | null
          razon_encaje?: string | null
          ronda?: string | null
          score?: number | null
          segmento_axis?: string | null
          seniority?: string | null
          telefono?: string | null
          tipo_cargo?: string | null
          updated_at?: string | null
        }
        Update: {
          angulo_outreach?: string | null
          apellido?: string | null
          apollo_person_id?: string | null
          cargo?: string | null
          created_at?: string | null
          email?: string | null
          email_status?: string | null
          empresa_id?: string | null
          estado?: string | null
          fuente?: string | null
          id?: string
          linkedin_url?: string | null
          nombre?: string | null
          nombre_completo?: string | null
          notas?: string | null
          prioridad?: string | null
          razon_encaje?: string | null
          ronda?: string | null
          score?: number | null
          segmento_axis?: string | null
          seniority?: string | null
          telefono?: string | null
          tipo_cargo?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "axis_leads_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "axis_empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      axis_respuestas: {
        Row: {
          created_at: string | null
          cuerpo: string | null
          fecha: string | null
          id: string
          lead_id: string
          resumen: string | null
          tipo: string | null
          toque_id: string | null
        }
        Insert: {
          created_at?: string | null
          cuerpo?: string | null
          fecha?: string | null
          id?: string
          lead_id: string
          resumen?: string | null
          tipo?: string | null
          toque_id?: string | null
        }
        Update: {
          created_at?: string | null
          cuerpo?: string | null
          fecha?: string | null
          id?: string
          lead_id?: string
          resumen?: string | null
          tipo?: string | null
          toque_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "axis_respuestas_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "axis_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "axis_respuestas_toque_id_fkey"
            columns: ["toque_id"]
            isOneToOne: false
            referencedRelation: "axis_toques"
            referencedColumns: ["id"]
          },
        ]
      }
      axis_rondas: {
        Row: {
          created_at: string | null
          creditos_consumidos: number | null
          descripcion: string | null
          fecha_fin: string | null
          fecha_inicio: string | null
          filtros_apollo: Json | null
          id: string
          nombre: string
          notas: string | null
          total_leads: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          creditos_consumidos?: number | null
          descripcion?: string | null
          fecha_fin?: string | null
          fecha_inicio?: string | null
          filtros_apollo?: Json | null
          id?: string
          nombre: string
          notas?: string | null
          total_leads?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          creditos_consumidos?: number | null
          descripcion?: string | null
          fecha_fin?: string | null
          fecha_inicio?: string | null
          filtros_apollo?: Json | null
          id?: string
          nombre?: string
          notas?: string | null
          total_leads?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      axis_toques: {
        Row: {
          angulo_usado: string | null
          asunto: string | null
          canal: string | null
          created_at: string | null
          cuerpo: string | null
          cuerpo_html: string | null
          email_from: string | null
          email_to: string | null
          estado: string | null
          fecha_enviada: string | null
          fecha_programada: string | null
          fecha_respuesta: string | null
          framework: string | null
          gmail_draft_id: string | null
          gmail_message_id: string | null
          gmail_thread_id: string | null
          id: string
          lead_id: string
          ronda_id: string | null
          tipo: string
          tracking_label: string | null
          updated_at: string | null
        }
        Insert: {
          angulo_usado?: string | null
          asunto?: string | null
          canal?: string | null
          created_at?: string | null
          cuerpo?: string | null
          cuerpo_html?: string | null
          email_from?: string | null
          email_to?: string | null
          estado?: string | null
          fecha_enviada?: string | null
          fecha_programada?: string | null
          fecha_respuesta?: string | null
          framework?: string | null
          gmail_draft_id?: string | null
          gmail_message_id?: string | null
          gmail_thread_id?: string | null
          id?: string
          lead_id: string
          ronda_id?: string | null
          tipo: string
          tracking_label?: string | null
          updated_at?: string | null
        }
        Update: {
          angulo_usado?: string | null
          asunto?: string | null
          canal?: string | null
          created_at?: string | null
          cuerpo?: string | null
          cuerpo_html?: string | null
          email_from?: string | null
          email_to?: string | null
          estado?: string | null
          fecha_enviada?: string | null
          fecha_programada?: string | null
          fecha_respuesta?: string | null
          framework?: string | null
          gmail_draft_id?: string | null
          gmail_message_id?: string | null
          gmail_thread_id?: string | null
          id?: string
          lead_id?: string
          ronda_id?: string | null
          tipo?: string
          tracking_label?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "axis_toques_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "axis_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "axis_toques_ronda_id_fkey"
            columns: ["ronda_id"]
            isOneToOne: false
            referencedRelation: "axis_rondas"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_deliveries: {
        Row: {
          campaign_id: string
          completed_at: string | null
          contacted_id: string
          created_at: string
          delivery_state: string
          dispatch_id: string
          draft_id: string
          draft_version_id: string
          error_code: string | null
          error_message: string | null
          id: string
          organization_id: string
          provider: string
          provider_message_id: string | null
          provider_metadata: Json
          recipient_email: string
          recipient_key: string
          reconciled_at: string | null
          requested_at: string
          sent_at: string | null
          started_at: string | null
          step_index: number
          updated_at: string
          user_id: string
        }
        Insert: {
          campaign_id: string
          completed_at?: string | null
          contacted_id: string
          created_at?: string
          delivery_state: string
          dispatch_id: string
          draft_id: string
          draft_version_id: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          organization_id: string
          provider: string
          provider_message_id?: string | null
          provider_metadata?: Json
          recipient_email: string
          recipient_key: string
          reconciled_at?: string | null
          requested_at: string
          sent_at?: string | null
          started_at?: string | null
          step_index: number
          updated_at?: string
          user_id: string
        }
        Update: {
          campaign_id?: string
          completed_at?: string | null
          contacted_id?: string
          created_at?: string
          delivery_state?: string
          dispatch_id?: string
          draft_id?: string
          draft_version_id?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          organization_id?: string
          provider?: string
          provider_message_id?: string | null
          provider_metadata?: Json
          recipient_email?: string
          recipient_key?: string
          reconciled_at?: string | null
          requested_at?: string
          sent_at?: string | null
          started_at?: string | null
          step_index?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_deliveries_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_deliveries_contacted_id_fkey"
            columns: ["contacted_id"]
            isOneToOne: false
            referencedRelation: "contacted_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_deliveries_dispatch_id_fkey"
            columns: ["dispatch_id"]
            isOneToOne: true
            referencedRelation: "outbound_dispatches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_deliveries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_enrollments: {
        Row: {
          campaign_id: string
          completed_at: string | null
          created_at: string
          id: string
          initial_sent_at: string | null
          organization_id: string
          recipient_email: string
          recipient_lead_ref: string | null
          recipient_name: string | null
          research_snapshot_id: string
          sequence_version_id: string
          status: string
          stopped_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          campaign_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          initial_sent_at?: string | null
          organization_id: string
          recipient_email: string
          recipient_lead_ref?: string | null
          recipient_name?: string | null
          research_snapshot_id: string
          sequence_version_id: string
          status?: string
          stopped_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          campaign_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          initial_sent_at?: string | null
          organization_id?: string
          recipient_email?: string
          recipient_lead_ref?: string | null
          recipient_name?: string | null
          research_snapshot_id?: string
          sequence_version_id?: string
          status?: string
          stopped_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_enrollments_campaign_fkey"
            columns: ["campaign_id", "organization_id", "user_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id", "organization_id", "user_id"]
          },
          {
            foreignKeyName: "campaign_enrollments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_enrollments_snapshot_fkey"
            columns: ["research_snapshot_id", "organization_id", "user_id"]
            isOneToOne: false
            referencedRelation: "research_snapshots"
            referencedColumns: ["id", "organization_id", "user_id"]
          },
          {
            foreignKeyName: "campaign_enrollments_version_fkey"
            columns: ["sequence_version_id", "organization_id", "user_id"]
            isOneToOne: false
            referencedRelation: "campaign_sequence_versions"
            referencedColumns: ["id", "organization_id", "user_id"]
          },
        ]
      }
      campaign_recipient_steps: {
        Row: {
          campaign_id: string
          contacted_id: string | null
          created_at: string
          due_at: string | null
          enrollment_id: string
          id: string
          inbox_order_at: string | null
          last_error: string | null
          native_draft_id: string | null
          native_version_id: string | null
          organization_id: string
          outbound_dispatch_id: string | null
          preparation_claim_token: string | null
          preparation_claimed_at: string | null
          reserved_native_draft_id: string | null
          reserved_native_version_id: string | null
          sent_at: string | null
          sequence_step_id: string
          state: string
          step_index: number
          updated_at: string
          user_id: string
        }
        Insert: {
          campaign_id: string
          contacted_id?: string | null
          created_at?: string
          due_at?: string | null
          enrollment_id: string
          id?: string
          inbox_order_at?: string | null
          last_error?: string | null
          native_draft_id?: string | null
          native_version_id?: string | null
          organization_id: string
          outbound_dispatch_id?: string | null
          preparation_claim_token?: string | null
          preparation_claimed_at?: string | null
          reserved_native_draft_id?: string | null
          reserved_native_version_id?: string | null
          sent_at?: string | null
          sequence_step_id: string
          state: string
          step_index: number
          updated_at?: string
          user_id: string
        }
        Update: {
          campaign_id?: string
          contacted_id?: string | null
          created_at?: string
          due_at?: string | null
          enrollment_id?: string
          id?: string
          inbox_order_at?: string | null
          last_error?: string | null
          native_draft_id?: string | null
          native_version_id?: string | null
          organization_id?: string
          outbound_dispatch_id?: string | null
          preparation_claim_token?: string | null
          preparation_claimed_at?: string | null
          reserved_native_draft_id?: string | null
          reserved_native_version_id?: string | null
          sent_at?: string | null
          sequence_step_id?: string
          state?: string
          step_index?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_recipient_steps_campaign_fkey"
            columns: ["campaign_id", "organization_id", "user_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id", "organization_id", "user_id"]
          },
          {
            foreignKeyName: "campaign_recipient_steps_enrollment_fkey"
            columns: ["enrollment_id", "organization_id", "user_id"]
            isOneToOne: false
            referencedRelation: "campaign_enrollments"
            referencedColumns: ["id", "organization_id", "user_id"]
          },
          {
            foreignKeyName: "campaign_recipient_steps_native_version_fkey"
            columns: [
              "native_draft_id",
              "native_version_id",
              "organization_id",
              "user_id",
            ]
            isOneToOne: false
            referencedRelation: "messaging_draft_versions"
            referencedColumns: ["draft_id", "id", "organization_id", "user_id"]
          },
          {
            foreignKeyName: "campaign_recipient_steps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_recipient_steps_sequence_step_fkey"
            columns: ["sequence_step_id", "organization_id", "user_id"]
            isOneToOne: false
            referencedRelation: "campaign_sequence_steps_v2"
            referencedColumns: ["id", "organization_id", "user_id"]
          },
        ]
      }
      campaign_sequence_steps_v2: {
        Row: {
          created_at: string
          id: string
          instruction: string
          name: string
          offset_days: number
          organization_id: string
          sequence_version_id: string
          step_index: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          instruction: string
          name: string
          offset_days: number
          organization_id: string
          sequence_version_id: string
          step_index: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          instruction?: string
          name?: string
          offset_days?: number
          organization_id?: string
          sequence_version_id?: string
          step_index?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_sequence_steps_v2_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_sequence_steps_v2_version_fkey"
            columns: ["sequence_version_id", "organization_id", "user_id"]
            isOneToOne: false
            referencedRelation: "campaign_sequence_versions"
            referencedColumns: ["id", "organization_id", "user_id"]
          },
        ]
      }
      campaign_sequence_versions: {
        Row: {
          campaign_id: string
          content_hash: string
          created_at: string
          id: string
          organization_id: string
          published_at: string
          status: string
          user_id: string
          version_number: number
        }
        Insert: {
          campaign_id: string
          content_hash: string
          created_at?: string
          id?: string
          organization_id: string
          published_at?: string
          status?: string
          user_id: string
          version_number: number
        }
        Update: {
          campaign_id?: string
          content_hash?: string
          created_at?: string
          id?: string
          organization_id?: string
          published_at?: string
          status?: string
          user_id?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "campaign_sequence_versions_campaign_fkey"
            columns: ["campaign_id", "organization_id", "user_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id", "organization_id", "user_id"]
          },
          {
            foreignKeyName: "campaign_sequence_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_steps: {
        Row: {
          attachments: Json | null
          body_template: string
          campaign_id: string | null
          created_at: string | null
          id: string
          name: string | null
          offset_days: number | null
          order_index: number
          subject_template: string
          variant_b: Json | null
        }
        Insert: {
          attachments?: Json | null
          body_template: string
          campaign_id?: string | null
          created_at?: string | null
          id?: string
          name?: string | null
          offset_days?: number | null
          order_index: number
          subject_template: string
          variant_b?: Json | null
        }
        Update: {
          attachments?: Json | null
          body_template?: string
          campaign_id?: string | null
          created_at?: string | null
          id?: string
          name?: string | null
          offset_days?: number | null
          order_index?: number
          subject_template?: string
          variant_b?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_steps_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_v2_draft_reservations: {
        Row: {
          campaign_id: string
          created_at: string
          draft_id: string
          enrollment_id: string
          linked_at: string | null
          organization_id: string
          recipient_step_id: string
          user_id: string
          version_id: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          draft_id: string
          enrollment_id: string
          linked_at?: string | null
          organization_id: string
          recipient_step_id: string
          user_id: string
          version_id: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          draft_id?: string
          enrollment_id?: string
          linked_at?: string | null
          organization_id?: string
          recipient_step_id?: string
          user_id?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_v2_draft_reservations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          campaign_type: string
          created_at: string | null
          excluded_lead_ids: string[] | null
          id: string
          initial_native_draft_id: string | null
          last_run_at: string | null
          last_run_status: string | null
          last_run_summary: Json
          name: string
          organization_id: string | null
          outreach_version: number
          sent_records: Json | null
          settings: Json | null
          status: string | null
          updated_at: string | null
          user_id: string | null
          v2_activated_at: string | null
          v2_status: string | null
          v2_stopped_at: string | null
        }
        Insert: {
          campaign_type?: string
          created_at?: string | null
          excluded_lead_ids?: string[] | null
          id?: string
          initial_native_draft_id?: string | null
          last_run_at?: string | null
          last_run_status?: string | null
          last_run_summary?: Json
          name: string
          organization_id?: string | null
          outreach_version?: number
          sent_records?: Json | null
          settings?: Json | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
          v2_activated_at?: string | null
          v2_status?: string | null
          v2_stopped_at?: string | null
        }
        Update: {
          campaign_type?: string
          created_at?: string | null
          excluded_lead_ids?: string[] | null
          id?: string
          initial_native_draft_id?: string | null
          last_run_at?: string | null
          last_run_status?: string | null
          last_run_summary?: Json
          name?: string
          organization_id?: string | null
          outreach_version?: number
          sent_records?: Json | null
          settings?: Json | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
          v2_activated_at?: string | null
          v2_status?: string | null
          v2_stopped_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_initial_native_draft_fkey"
            columns: ["initial_native_draft_id", "organization_id", "user_id"]
            isOneToOne: false
            referencedRelation: "messaging_drafts"
            referencedColumns: ["id", "organization_id", "user_id"]
          },
          {
            foreignKeyName: "campaigns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          content: string
          created_at: string | null
          entity_id: string
          entity_type: string
          id: string
          organization_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          entity_id: string
          entity_type: string
          id?: string
          organization_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          organization_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contacted_leads: {
        Row: {
          bounce_category: string | null
          bounce_reason: string | null
          bounced_at: string | null
          campaign_followup_allowed: boolean | null
          campaign_followup_reason: string | null
          city: string | null
          click_count: number | null
          clicked_at: string | null
          company: string | null
          conversation_id: string | null
          country: string | null
          created_at: string
          data: Json | null
          delivered_at: string | null
          delivery_receipt_message_id: string | null
          delivery_status: string
          email: string | null
          engagement_score: number | null
          evaluation_status: string | null
          follow_up_count: number | null
          id: string
          industry: string | null
          internet_message_id: string | null
          last_event_at: string | null
          last_event_type: string | null
          last_follow_up_at: string | null
          last_interaction_at: string | null
          last_reply_text: string | null
          last_step_idx: number | null
          last_update_at: string | null
          lead_id: string | null
          lifecycle_state: string | null
          linkedin_message_status: string | null
          message_id: string | null
          mission_id: string | null
          name: string | null
          opened_at: string | null
          organization_id: string | null
          preflight_reason: string | null
          preflight_status: string | null
          provider: string | null
          read_receipt_message_id: string | null
          replied_at: string | null
          reply_confidence: number | null
          reply_intent: string | null
          reply_message_id: string | null
          reply_preview: string | null
          reply_sentiment: string | null
          reply_snippet: string | null
          reply_subject: string | null
          reply_summary: string | null
          role: string | null
          sent_at: string | null
          status: string | null
          subject: string | null
          thread_id: string | null
          thread_key: string | null
          user_id: string
        }
        Insert: {
          bounce_category?: string | null
          bounce_reason?: string | null
          bounced_at?: string | null
          campaign_followup_allowed?: boolean | null
          campaign_followup_reason?: string | null
          city?: string | null
          click_count?: number | null
          clicked_at?: string | null
          company?: string | null
          conversation_id?: string | null
          country?: string | null
          created_at?: string
          data?: Json | null
          delivered_at?: string | null
          delivery_receipt_message_id?: string | null
          delivery_status?: string
          email?: string | null
          engagement_score?: number | null
          evaluation_status?: string | null
          follow_up_count?: number | null
          id?: string
          industry?: string | null
          internet_message_id?: string | null
          last_event_at?: string | null
          last_event_type?: string | null
          last_follow_up_at?: string | null
          last_interaction_at?: string | null
          last_reply_text?: string | null
          last_step_idx?: number | null
          last_update_at?: string | null
          lead_id?: string | null
          lifecycle_state?: string | null
          linkedin_message_status?: string | null
          message_id?: string | null
          mission_id?: string | null
          name?: string | null
          opened_at?: string | null
          organization_id?: string | null
          preflight_reason?: string | null
          preflight_status?: string | null
          provider?: string | null
          read_receipt_message_id?: string | null
          replied_at?: string | null
          reply_confidence?: number | null
          reply_intent?: string | null
          reply_message_id?: string | null
          reply_preview?: string | null
          reply_sentiment?: string | null
          reply_snippet?: string | null
          reply_subject?: string | null
          reply_summary?: string | null
          role?: string | null
          sent_at?: string | null
          status?: string | null
          subject?: string | null
          thread_id?: string | null
          thread_key?: string | null
          user_id: string
        }
        Update: {
          bounce_category?: string | null
          bounce_reason?: string | null
          bounced_at?: string | null
          campaign_followup_allowed?: boolean | null
          campaign_followup_reason?: string | null
          city?: string | null
          click_count?: number | null
          clicked_at?: string | null
          company?: string | null
          conversation_id?: string | null
          country?: string | null
          created_at?: string
          data?: Json | null
          delivered_at?: string | null
          delivery_receipt_message_id?: string | null
          delivery_status?: string
          email?: string | null
          engagement_score?: number | null
          evaluation_status?: string | null
          follow_up_count?: number | null
          id?: string
          industry?: string | null
          internet_message_id?: string | null
          last_event_at?: string | null
          last_event_type?: string | null
          last_follow_up_at?: string | null
          last_interaction_at?: string | null
          last_reply_text?: string | null
          last_step_idx?: number | null
          last_update_at?: string | null
          lead_id?: string | null
          lifecycle_state?: string | null
          linkedin_message_status?: string | null
          message_id?: string | null
          mission_id?: string | null
          name?: string | null
          opened_at?: string | null
          organization_id?: string | null
          preflight_reason?: string | null
          preflight_status?: string | null
          provider?: string | null
          read_receipt_message_id?: string | null
          replied_at?: string | null
          reply_confidence?: number | null
          reply_intent?: string | null
          reply_message_id?: string | null
          reply_preview?: string | null
          reply_sentiment?: string | null
          reply_snippet?: string | null
          reply_subject?: string | null
          reply_summary?: string | null
          role?: string | null
          sent_at?: string | null
          status?: string | null
          subject?: string | null
          thread_id?: string | null
          thread_key?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacted_leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_events: {
        Row: {
          contacted_id: string | null
          created_at: string
          event_at: string
          event_source: string | null
          event_type: string
          id: string
          inbound_event_key: string | null
          internet_message_id: string | null
          lead_id: string | null
          message_id: string | null
          meta: Json
          mission_id: string | null
          organization_id: string | null
          provider: string | null
          thread_key: string | null
        }
        Insert: {
          contacted_id?: string | null
          created_at?: string
          event_at?: string
          event_source?: string | null
          event_type: string
          id?: string
          inbound_event_key?: string | null
          internet_message_id?: string | null
          lead_id?: string | null
          message_id?: string | null
          meta?: Json
          mission_id?: string | null
          organization_id?: string | null
          provider?: string | null
          thread_key?: string | null
        }
        Update: {
          contacted_id?: string | null
          created_at?: string
          event_at?: string
          event_source?: string | null
          event_type?: string
          id?: string
          inbound_event_key?: string | null
          internet_message_id?: string | null
          lead_id?: string | null
          message_id?: string | null
          meta?: Json
          mission_id?: string | null
          organization_id?: string | null
          provider?: string | null
          thread_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_events_contacted_id_fkey"
            columns: ["contacted_id"]
            isOneToOne: false
            referencedRelation: "contacted_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      email_style_profiles: {
        Row: {
          content_hash: string
          created_at: string
          id: string
          is_default: boolean
          name: string
          organization_id: string
          profile: Json
          revision: number
          updated_at: string
          user_id: string
        }
        Insert: {
          content_hash: string
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          organization_id: string
          profile?: Json
          revision?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          content_hash?: string
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          organization_id?: string
          profile?: Json
          revision?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_style_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      enriched_leads: {
        Row: {
          city: string | null
          company_name: string | null
          country: string | null
          created_at: string
          data: Json | null
          departments: Json | null
          email: string | null
          email_status: string | null
          enrichment_status: string | null
          full_name: string | null
          headline: string | null
          id: string
          linkedin_url: string | null
          organization_domain: string | null
          organization_id: string | null
          organization_industry: string | null
          organization_size: number | null
          phone_numbers: Json | null
          photo_url: string | null
          primary_phone: string | null
          seniority: string | null
          source_provider: string | null
          source_provider_id: string | null
          state: string | null
          title: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          city?: string | null
          company_name?: string | null
          country?: string | null
          created_at?: string
          data?: Json | null
          departments?: Json | null
          email?: string | null
          email_status?: string | null
          enrichment_status?: string | null
          full_name?: string | null
          headline?: string | null
          id: string
          linkedin_url?: string | null
          organization_domain?: string | null
          organization_id?: string | null
          organization_industry?: string | null
          organization_size?: number | null
          phone_numbers?: Json | null
          photo_url?: string | null
          primary_phone?: string | null
          seniority?: string | null
          source_provider?: string | null
          source_provider_id?: string | null
          state?: string | null
          title?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          city?: string | null
          company_name?: string | null
          country?: string | null
          created_at?: string
          data?: Json | null
          departments?: Json | null
          email?: string | null
          email_status?: string | null
          enrichment_status?: string | null
          full_name?: string | null
          headline?: string | null
          id?: string
          linkedin_url?: string | null
          organization_domain?: string | null
          organization_id?: string | null
          organization_industry?: string | null
          organization_size?: number | null
          phone_numbers?: Json | null
          photo_url?: string | null
          primary_phone?: string | null
          seniority?: string | null
          source_provider?: string | null
          source_provider_id?: string | null
          state?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "enriched_leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      enriched_opportunities: {
        Row: {
          company_name: string | null
          contacted_count: number | null
          created_at: string | null
          data: Json | null
          email: string | null
          email_status: string | null
          enrichment_status: string | null
          full_name: string | null
          id: string
          linkedin_url: string | null
          organization_id: string | null
          phone_numbers: Json | null
          primary_phone: string | null
          source_provider: string | null
          source_provider_id: string | null
          title: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          company_name?: string | null
          contacted_count?: number | null
          created_at?: string | null
          data?: Json | null
          email?: string | null
          email_status?: string | null
          enrichment_status?: string | null
          full_name?: string | null
          id?: string
          linkedin_url?: string | null
          organization_id?: string | null
          phone_numbers?: Json | null
          primary_phone?: string | null
          source_provider?: string | null
          source_provider_id?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          company_name?: string | null
          contacted_count?: number | null
          created_at?: string | null
          data?: Json | null
          email?: string | null
          email_status?: string | null
          enrichment_status?: string | null
          full_name?: string | null
          id?: string
          linkedin_url?: string | null
          organization_id?: string | null
          phone_numbers?: Json | null
          primary_phone?: string | null
          source_provider?: string | null
          source_provider_id?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "enriched_opportunities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_reply_event_aliases: {
        Row: {
          contacted_id: string
          created_at: string
          event_key: string
          identity_key: string
        }
        Insert: {
          contacted_id: string
          created_at?: string
          event_key: string
          identity_key: string
        }
        Update: {
          contacted_id?: string
          created_at?: string
          event_key?: string
          identity_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbound_reply_event_aliases_contacted_id_fkey"
            columns: ["contacted_id"]
            isOneToOne: false
            referencedRelation: "contacted_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_research_jobs: {
        Row: {
          attempt_count: number
          company_domain: string | null
          company_name: string | null
          completed_at: string | null
          created_at: string
          email: string | null
          error_code: string | null
          error_message: string | null
          id: string
          lead_id: string | null
          lead_ref: string
          max_attempts: number
          organization_id: string | null
          provider: string
          provider_report_id: string | null
          quota_consumed_at: string | null
          quota_day: string | null
          quota_scope: string | null
          request_claim_state: string | null
          request_claim_token: string | null
          request_claimed_at: string | null
          request_idempotency_key: string | null
          request_payload: Json
          research_snapshot_id: string | null
          result_payload: Json | null
          scheduled_for: string
          scope_key: string
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempt_count?: number
          company_domain?: string | null
          company_name?: string | null
          completed_at?: string | null
          created_at?: string
          email?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          lead_id?: string | null
          lead_ref: string
          max_attempts?: number
          organization_id?: string | null
          provider: string
          provider_report_id?: string | null
          quota_consumed_at?: string | null
          quota_day?: string | null
          quota_scope?: string | null
          request_claim_state?: string | null
          request_claim_token?: string | null
          request_claimed_at?: string | null
          request_idempotency_key?: string | null
          request_payload?: Json
          research_snapshot_id?: string | null
          result_payload?: Json | null
          scheduled_for?: string
          scope_key: string
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempt_count?: number
          company_domain?: string | null
          company_name?: string | null
          completed_at?: string | null
          created_at?: string
          email?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          lead_id?: string | null
          lead_ref?: string
          max_attempts?: number
          organization_id?: string | null
          provider?: string
          provider_report_id?: string | null
          quota_consumed_at?: string | null
          quota_day?: string | null
          quota_scope?: string | null
          request_claim_state?: string | null
          request_claim_token?: string | null
          request_claimed_at?: string | null
          request_idempotency_key?: string | null
          request_payload?: Json
          research_snapshot_id?: string | null
          result_payload?: Json | null
          scheduled_for?: string
          scope_key?: string
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_research_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_research_jobs_research_snapshot_id_organization_id_us_fkey"
            columns: ["research_snapshot_id", "organization_id", "user_id"]
            isOneToOne: false
            referencedRelation: "research_snapshots"
            referencedColumns: ["id", "organization_id", "user_id"]
          },
          {
            foreignKeyName: "lead_research_jobs_research_snapshot_id_scope_key_user_id_fkey"
            columns: ["research_snapshot_id", "scope_key", "user_id"]
            isOneToOne: false
            referencedRelation: "research_snapshots"
            referencedColumns: ["id", "scope_key", "user_id"]
          },
        ]
      }
      lead_research_reports: {
        Row: {
          company_domain: string | null
          company_name: string | null
          created_at: string
          email: string | null
          generated_at: string
          id: string
          lead_id: string | null
          lead_ref: string
          organization_id: string | null
          provider: string
          report: Json
          report_id: string | null
          scope_key: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          company_domain?: string | null
          company_name?: string | null
          created_at?: string
          email?: string | null
          generated_at?: string
          id?: string
          lead_id?: string | null
          lead_ref: string
          organization_id?: string | null
          provider?: string
          report: Json
          report_id?: string | null
          scope_key: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          company_domain?: string | null
          company_name?: string | null
          created_at?: string
          email?: string | null
          generated_at?: string
          id?: string
          lead_id?: string | null
          lead_ref?: string
          organization_id?: string | null
          provider?: string
          report?: Json
          report_id?: string | null
          scope_key?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      lead_responses: {
        Row: {
          contacted_id: string | null
          content: string | null
          created_at: string
          email_message_id: string | null
          id: string
          inbound_event_key: string | null
          lead_id: string | null
          mission_id: string | null
          organization_id: string | null
          type: string
        }
        Insert: {
          contacted_id?: string | null
          content?: string | null
          created_at?: string
          email_message_id?: string | null
          id?: string
          inbound_event_key?: string | null
          lead_id?: string | null
          mission_id?: string | null
          organization_id?: string | null
          type: string
        }
        Update: {
          contacted_id?: string | null
          content?: string | null
          created_at?: string
          email_message_id?: string | null
          id?: string
          inbound_event_key?: string | null
          lead_id?: string | null
          mission_id?: string | null
          organization_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_responses_contacted_id_fkey"
            columns: ["contacted_id"]
            isOneToOne: false
            referencedRelation: "contacted_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          apollo_id: string | null
          avatar: string | null
          city: string | null
          company: string
          company_linkedin: string | null
          company_website: string | null
          country: string | null
          created_at: string
          email: string | null
          email_enrichment: Json | null
          enrichment_error: string | null
          id: string
          industry: string | null
          investigation_error: string | null
          last_contacted_at: string | null
          last_enriched_at: string | null
          last_enrichment_attempt_at: string | null
          last_investigated_at: string | null
          last_scored_at: string | null
          linkedin_url: string | null
          location: string | null
          mission_id: string | null
          name: string
          organization_id: string | null
          score: number
          score_reason: string | null
          score_tier: string
          source_provider: string | null
          source_provider_id: string | null
          status: string
          title: string
          user_id: string
        }
        Insert: {
          apollo_id?: string | null
          avatar?: string | null
          city?: string | null
          company: string
          company_linkedin?: string | null
          company_website?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          email_enrichment?: Json | null
          enrichment_error?: string | null
          id?: string
          industry?: string | null
          investigation_error?: string | null
          last_contacted_at?: string | null
          last_enriched_at?: string | null
          last_enrichment_attempt_at?: string | null
          last_investigated_at?: string | null
          last_scored_at?: string | null
          linkedin_url?: string | null
          location?: string | null
          mission_id?: string | null
          name: string
          organization_id?: string | null
          score?: number
          score_reason?: string | null
          score_tier?: string
          source_provider?: string | null
          source_provider_id?: string | null
          status?: string
          title: string
          user_id: string
        }
        Update: {
          apollo_id?: string | null
          avatar?: string | null
          city?: string | null
          company?: string
          company_linkedin?: string | null
          company_website?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          email_enrichment?: Json | null
          enrichment_error?: string | null
          id?: string
          industry?: string | null
          investigation_error?: string | null
          last_contacted_at?: string | null
          last_enriched_at?: string | null
          last_enrichment_attempt_at?: string | null
          last_investigated_at?: string | null
          last_scored_at?: string | null
          linkedin_url?: string | null
          location?: string | null
          mission_id?: string | null
          name?: string
          organization_id?: string | null
          score?: number
          score_reason?: string | null
          score_tier?: string
          source_provider?: string | null
          source_provider_id?: string | null
          status?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      messaging_draft_generation_metadata: {
        Row: {
          claim_ids: Json
          created_at: string
          draft_id: string
          generation_method: string
          model: string | null
          organization_id: string
          prompt_version: string
          provider: string | null
          research_snapshot_id: string | null
          style_profile_id: string | null
          user_id: string
          version_id: string
        }
        Insert: {
          claim_ids?: Json
          created_at?: string
          draft_id: string
          generation_method: string
          model?: string | null
          organization_id: string
          prompt_version: string
          provider?: string | null
          research_snapshot_id?: string | null
          style_profile_id?: string | null
          user_id: string
          version_id: string
        }
        Update: {
          claim_ids?: Json
          created_at?: string
          draft_id?: string
          generation_method?: string
          model?: string | null
          organization_id?: string
          prompt_version?: string
          provider?: string | null
          research_snapshot_id?: string | null
          style_profile_id?: string | null
          user_id?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messaging_draft_generation_metadata_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messaging_draft_generation_metadata_research_snapshot_id_fkey"
            columns: ["research_snapshot_id"]
            isOneToOne: false
            referencedRelation: "research_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messaging_draft_generation_metadata_style_profile_id_fkey"
            columns: ["style_profile_id"]
            isOneToOne: false
            referencedRelation: "email_style_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messaging_draft_generation_metadata_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: true
            referencedRelation: "messaging_draft_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      messaging_draft_versions: {
        Row: {
          approval: Json
          channel: string
          content: Json
          content_hash: string
          created_at: string
          draft_id: string
          id: string
          lifecycle: string
          organization_id: string
          parent_version_id: string | null
          payload: Json
          persisted_at: string
          preflight: Json
          recipient: Json
          research_snapshot_id: string | null
          revision: number
          user_id: string
        }
        Insert: {
          approval: Json
          channel: string
          content: Json
          content_hash: string
          created_at: string
          draft_id: string
          id: string
          lifecycle: string
          organization_id: string
          parent_version_id?: string | null
          payload: Json
          persisted_at?: string
          preflight: Json
          recipient: Json
          research_snapshot_id?: string | null
          revision: number
          user_id: string
        }
        Update: {
          approval?: Json
          channel?: string
          content?: Json
          content_hash?: string
          created_at?: string
          draft_id?: string
          id?: string
          lifecycle?: string
          organization_id?: string
          parent_version_id?: string | null
          payload?: Json
          persisted_at?: string
          preflight?: Json
          recipient?: Json
          research_snapshot_id?: string | null
          revision?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messaging_draft_versions_draft_id_organization_id_user_id_fkey"
            columns: ["draft_id", "organization_id", "user_id"]
            isOneToOne: false
            referencedRelation: "messaging_drafts"
            referencedColumns: ["id", "organization_id", "user_id"]
          },
          {
            foreignKeyName: "messaging_draft_versions_draft_id_parent_version_id_fkey"
            columns: ["draft_id", "parent_version_id"]
            isOneToOne: false
            referencedRelation: "messaging_draft_versions"
            referencedColumns: ["draft_id", "id"]
          },
          {
            foreignKeyName: "messaging_draft_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messaging_draft_versions_research_snapshot_id_organization_fkey"
            columns: ["research_snapshot_id", "organization_id", "user_id"]
            isOneToOne: false
            referencedRelation: "research_snapshots"
            referencedColumns: ["id", "organization_id", "user_id"]
          },
        ]
      }
      messaging_drafts: {
        Row: {
          channel: string
          created_at: string
          current_revision: number
          current_version_id: string | null
          id: string
          lifecycle: string
          organization_id: string
          research_snapshot_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          channel: string
          created_at?: string
          current_revision?: number
          current_version_id?: string | null
          id: string
          lifecycle?: string
          organization_id: string
          research_snapshot_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          current_revision?: number
          current_version_id?: string | null
          id?: string
          lifecycle?: string
          organization_id?: string
          research_snapshot_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messaging_drafts_current_version_fk"
            columns: ["id", "current_version_id"]
            isOneToOne: false
            referencedRelation: "messaging_draft_versions"
            referencedColumns: ["draft_id", "id"]
          },
          {
            foreignKeyName: "messaging_drafts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messaging_drafts_research_snapshot_id_organization_id_user_fkey"
            columns: ["research_snapshot_id", "organization_id", "user_id"]
            isOneToOne: false
            referencedRelation: "research_snapshots"
            referencedColumns: ["id", "organization_id", "user_id"]
          },
        ]
      }
      native_draft_generation_claims: {
        Row: {
          claim_token: string
          claimed_at: string
          created_at: string
          draft_id: string
          identity_hash: string | null
          organization_id: string
          research_snapshot_id: string
          subject_email: string
          updated_at: string
          user_id: string
          version_id: string | null
        }
        Insert: {
          claim_token?: string
          claimed_at?: string
          created_at?: string
          draft_id: string
          identity_hash?: string | null
          organization_id: string
          research_snapshot_id: string
          subject_email: string
          updated_at?: string
          user_id: string
          version_id?: string | null
        }
        Update: {
          claim_token?: string
          claimed_at?: string
          created_at?: string
          draft_id?: string
          identity_hash?: string | null
          organization_id?: string
          research_snapshot_id?: string
          subject_email?: string
          updated_at?: string
          user_id?: string
          version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "native_draft_generation_claims_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_draft_generation_claims_research_snapshot_id_fkey"
            columns: ["research_snapshot_id"]
            isOneToOne: false
            referencedRelation: "research_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunities: {
        Row: {
          company_name: string | null
          created_at: string
          data: Json | null
          id: string
          job_url: string | null
          status: string | null
          title: string | null
          user_id: string
        }
        Insert: {
          company_name?: string | null
          created_at?: string
          data?: Json | null
          id: string
          job_url?: string | null
          status?: string | null
          title?: string | null
          user_id: string
        }
        Update: {
          company_name?: string | null
          created_at?: string
          data?: Json | null
          id?: string
          job_url?: string | null
          status?: string | null
          title?: string | null
          user_id?: string
        }
        Relationships: []
      }
      organization_collaboration_events: {
        Row: {
          actor_user_id: string | null
          contact_thread_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          event_type: string
          id: string
          lead_id: string | null
          metadata: Json
          organization_id: string
        }
        Insert: {
          actor_user_id?: string | null
          contact_thread_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          event_type: string
          id?: string
          lead_id?: string | null
          metadata?: Json
          organization_id: string
        }
        Update: {
          actor_user_id?: string | null
          contact_thread_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          event_type?: string
          id?: string
          lead_id?: string | null
          metadata?: Json
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_collaboration_events_contact_thread_fkey"
            columns: ["contact_thread_id"]
            isOneToOne: false
            referencedRelation: "organization_contact_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_collaboration_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_collaboration_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_contact_threads: {
        Row: {
          active_campaign_id: string | null
          active_lead_id: string | null
          channel: string
          closed_at: string | null
          created_at: string
          first_contacted_at: string | null
          id: string
          last_contacted_at: string | null
          last_sent_by_user_id: string | null
          opened_by_user_id: string | null
          organization_id: string
          recipient_email: string | null
          recipient_key: string
          reopen_reason: string | null
          reopened_at: string | null
          reopened_by_user_id: string | null
          reservation_expires_at: string | null
          reserved_dispatch_id: string | null
          root_dispatch_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          active_campaign_id?: string | null
          active_lead_id?: string | null
          channel: string
          closed_at?: string | null
          created_at?: string
          first_contacted_at?: string | null
          id?: string
          last_contacted_at?: string | null
          last_sent_by_user_id?: string | null
          opened_by_user_id?: string | null
          organization_id: string
          recipient_email?: string | null
          recipient_key: string
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_by_user_id?: string | null
          reservation_expires_at?: string | null
          reserved_dispatch_id?: string | null
          root_dispatch_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          active_campaign_id?: string | null
          active_lead_id?: string | null
          channel?: string
          closed_at?: string | null
          created_at?: string
          first_contacted_at?: string | null
          id?: string
          last_contacted_at?: string | null
          last_sent_by_user_id?: string | null
          opened_by_user_id?: string | null
          organization_id?: string
          recipient_email?: string | null
          recipient_key?: string
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_by_user_id?: string | null
          reservation_expires_at?: string | null
          reserved_dispatch_id?: string | null
          root_dispatch_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_contact_threads_active_lead_id_fkey"
            columns: ["active_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_contact_threads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_contact_threads_reserved_dispatch_fkey"
            columns: ["reserved_dispatch_id"]
            isOneToOne: false
            referencedRelation: "outbound_dispatches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_contact_threads_root_dispatch_fkey"
            columns: ["root_dispatch_id"]
            isOneToOne: false
            referencedRelation: "outbound_dispatches"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          organization_id: string
          revoked_at: string | null
          revoked_by: string | null
          role: string | null
          token: string | null
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          organization_id: string
          revoked_at?: string | null
          revoked_by?: string | null
          role?: string | null
          token?: string | null
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          organization_id?: string
          revoked_at?: string | null
          revoked_by?: string | null
          role?: string | null
          token?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_lead_collaboration: {
        Row: {
          assigned_at: string | null
          assigned_by_user_id: string | null
          assigned_to_user_id: string | null
          claim_expires_at: string | null
          claimed_by_user_id: string | null
          contact_state: string
          created_at: string
          discovered_at: string
          discovered_by_user_id: string | null
          lead_id: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          assigned_at?: string | null
          assigned_by_user_id?: string | null
          assigned_to_user_id?: string | null
          claim_expires_at?: string | null
          claimed_by_user_id?: string | null
          contact_state?: string
          created_at?: string
          discovered_at?: string
          discovered_by_user_id?: string | null
          lead_id: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          assigned_at?: string | null
          assigned_by_user_id?: string | null
          assigned_to_user_id?: string | null
          claim_expires_at?: string | null
          claimed_by_user_id?: string | null
          contact_state?: string
          created_at?: string
          discovered_at?: string
          discovered_by_user_id?: string | null
          lead_id?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_lead_collaboration_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_lead_collaboration_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          organization_id: string
          role: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          role?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          role?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_profiles"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_reporting_group_members: {
        Row: {
          assigned_at: string
          group_id: string
          is_primary: boolean
          organization_id: string
          unassigned_at: string | null
          user_id: string
        }
        Insert: {
          assigned_at?: string
          group_id: string
          is_primary?: boolean
          organization_id: string
          unassigned_at?: string | null
          user_id: string
        }
        Update: {
          assigned_at?: string
          group_id?: string
          is_primary?: boolean
          organization_id?: string
          unassigned_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_reporting_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "organization_reporting_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_reporting_group_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_reporting_groups: {
        Row: {
          color: string | null
          country_code: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          slug: string
          updated_at: string
        }
        Insert: {
          color?: string | null
          country_code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          slug: string
          updated_at?: string
        }
        Update: {
          color?: string | null
          country_code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_reporting_groups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          collaboration_v1_enabled: boolean
          created_at: string
          feature_campaigns_v2_enabled: boolean
          id: string
          name: string
        }
        Insert: {
          collaboration_v1_enabled?: boolean
          created_at?: string
          feature_campaigns_v2_enabled?: boolean
          id?: string
          name: string
        }
        Update: {
          collaboration_v1_enabled?: boolean
          created_at?: string
          feature_campaigns_v2_enabled?: boolean
          id?: string
          name?: string
        }
        Relationships: []
      }
      outbound_contact_quota_buckets: {
        Row: {
          baseline_count: number
          quota_day: string
          reservation_count: number
          scope_key: string
          updated_at: string
        }
        Insert: {
          baseline_count: number
          quota_day: string
          reservation_count?: number
          scope_key: string
          updated_at?: string
        }
        Update: {
          baseline_count?: number
          quota_day?: string
          reservation_count?: number
          scope_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      outbound_dispatches: {
        Row: {
          attempt_count: number
          campaign_recipient_step_id: string | null
          channel: string
          completed_at: string | null
          contact_thread_id: string | null
          content_hash: string
          created_at: string
          draft_id: string
          error_code: string | null
          error_message: string | null
          history_repair_attempt_count: number
          history_repair_error: string | null
          history_repair_status: string
          id: string
          idempotency_key: string
          last_history_repair_at: string | null
          last_reconciliation_at: string | null
          metadata: Json
          organization_id: string
          provider: string
          provider_message_id: string | null
          provider_response: Json | null
          reconciled_at: string | null
          reconciliation_attempt_count: number
          reconciliation_claimed_at: string | null
          reconciliation_details: Json | null
          requested_at: string
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
          version_id: string
        }
        Insert: {
          attempt_count?: number
          campaign_recipient_step_id?: string | null
          channel: string
          completed_at?: string | null
          contact_thread_id?: string | null
          content_hash: string
          created_at?: string
          draft_id: string
          error_code?: string | null
          error_message?: string | null
          history_repair_attempt_count?: number
          history_repair_error?: string | null
          history_repair_status?: string
          id?: string
          idempotency_key: string
          last_history_repair_at?: string | null
          last_reconciliation_at?: string | null
          metadata: Json
          organization_id: string
          provider: string
          provider_message_id?: string | null
          provider_response?: Json | null
          reconciled_at?: string | null
          reconciliation_attempt_count?: number
          reconciliation_claimed_at?: string | null
          reconciliation_details?: Json | null
          requested_at: string
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
          version_id: string
        }
        Update: {
          attempt_count?: number
          campaign_recipient_step_id?: string | null
          channel?: string
          completed_at?: string | null
          contact_thread_id?: string | null
          content_hash?: string
          created_at?: string
          draft_id?: string
          error_code?: string | null
          error_message?: string | null
          history_repair_attempt_count?: number
          history_repair_error?: string | null
          history_repair_status?: string
          id?: string
          idempotency_key?: string
          last_history_repair_at?: string | null
          last_reconciliation_at?: string | null
          metadata?: Json
          organization_id?: string
          provider?: string
          provider_message_id?: string | null
          provider_response?: Json | null
          reconciled_at?: string | null
          reconciliation_attempt_count?: number
          reconciliation_claimed_at?: string | null
          reconciliation_details?: Json | null
          requested_at?: string
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "outbound_dispatches_campaign_recipient_step_fkey"
            columns: [
              "campaign_recipient_step_id",
              "organization_id",
              "user_id",
            ]
            isOneToOne: false
            referencedRelation: "campaign_recipient_steps"
            referencedColumns: ["id", "organization_id", "user_id"]
          },
          {
            foreignKeyName: "outbound_dispatches_contact_thread_fkey"
            columns: ["contact_thread_id"]
            isOneToOne: false
            referencedRelation: "organization_contact_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_dispatches_draft_id_version_id_organization_id_us_fkey"
            columns: ["draft_id", "version_id", "organization_id", "user_id"]
            isOneToOne: false
            referencedRelation: "messaging_draft_versions"
            referencedColumns: ["draft_id", "id", "organization_id", "user_id"]
          },
          {
            foreignKeyName: "outbound_dispatches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      outbound_quota_reservations: {
        Row: {
          created_at: string
          dispatch_id: string
          organization_id: string
          quota_day: string
          quota_scope: string
          reservation_status: string
          settled_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          dispatch_id: string
          organization_id: string
          quota_day: string
          quota_scope: string
          reservation_status?: string
          settled_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          dispatch_id?: string
          organization_id?: string
          quota_day?: string
          quota_scope?: string
          reservation_status?: string
          settled_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "outbound_quota_reservations_dispatch_fk"
            columns: ["dispatch_id"]
            isOneToOne: true
            referencedRelation: "outbound_dispatches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_quota_reservations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_template_cache: {
        Row: {
          body_template: string
          created_at: string
          expires_at: string
          id: string
          metadata: Json
          offer_hash: string
          organization_id: string
          segment_key: string
          style_hash: string
          subject_template: string
          template_version: string
          updated_at: string
        }
        Insert: {
          body_template: string
          created_at?: string
          expires_at: string
          id?: string
          metadata?: Json
          offer_hash: string
          organization_id: string
          segment_key: string
          style_hash: string
          subject_template: string
          template_version: string
          updated_at?: string
        }
        Update: {
          body_template?: string
          created_at?: string
          expires_at?: string
          id?: string
          metadata?: Json
          offer_hash?: string
          organization_id?: string
          segment_key?: string
          style_hash?: string
          subject_template?: string
          template_version?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outreach_template_cache_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      people_search_leads: {
        Row: {
          apollo_person_id: string | null
          batch_run_id: string | null
          city: string | null
          country: string | null
          created_at: string
          departments: Json | null
          email: string | null
          email_status: string | null
          enrichment_status: string | null
          first_name: string | null
          headline: string | null
          id: string
          industry: string | null
          last_name: string | null
          linkedin_url: string | null
          name: string | null
          org_name: string | null
          organization_domain: string | null
          organization_id: string | null
          organization_industry: string | null
          organization_name: string | null
          organization_size: number | null
          organization_website: string | null
          page: number | null
          phone_numbers: Json | null
          photo_url: string | null
          primary_phone: string | null
          seniority: string | null
          source_provider: string | null
          source_provider_id: string | null
          state: string | null
          title: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          apollo_person_id?: string | null
          batch_run_id?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          departments?: Json | null
          email?: string | null
          email_status?: string | null
          enrichment_status?: string | null
          first_name?: string | null
          headline?: string | null
          id: string
          industry?: string | null
          last_name?: string | null
          linkedin_url?: string | null
          name?: string | null
          org_name?: string | null
          organization_domain?: string | null
          organization_id?: string | null
          organization_industry?: string | null
          organization_name?: string | null
          organization_size?: number | null
          organization_website?: string | null
          page?: number | null
          phone_numbers?: Json | null
          photo_url?: string | null
          primary_phone?: string | null
          seniority?: string | null
          source_provider?: string | null
          source_provider_id?: string | null
          state?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          apollo_person_id?: string | null
          batch_run_id?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          departments?: Json | null
          email?: string | null
          email_status?: string | null
          enrichment_status?: string | null
          first_name?: string | null
          headline?: string | null
          id?: string
          industry?: string | null
          last_name?: string | null
          linkedin_url?: string | null
          name?: string | null
          org_name?: string | null
          organization_domain?: string | null
          organization_id?: string | null
          organization_industry?: string | null
          organization_name?: string | null
          organization_size?: number | null
          organization_website?: string | null
          page?: number | null
          phone_numbers?: Json | null
          photo_url?: string | null
          primary_phone?: string | null
          seniority?: string | null
          source_provider?: string | null
          source_provider_id?: string | null
          state?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      privacy_incidents: {
        Row: {
          affected_scope: string | null
          contained_at: string | null
          created_at: string
          data_types: string | null
          detected_at: string
          id: string
          incident_at: string
          metadata: Json
          reported_by_email: string | null
          resolution_notes: string | null
          resolved_at: string | null
          severity: string
          status: string
          summary: string
          title: string
          updated_at: string
        }
        Insert: {
          affected_scope?: string | null
          contained_at?: string | null
          created_at?: string
          data_types?: string | null
          detected_at?: string
          id?: string
          incident_at?: string
          metadata?: Json
          reported_by_email?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          severity?: string
          status?: string
          summary: string
          title: string
          updated_at?: string
        }
        Update: {
          affected_scope?: string | null
          contained_at?: string | null
          created_at?: string
          data_types?: string | null
          detected_at?: string
          id?: string
          incident_at?: string
          metadata?: Json
          reported_by_email?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          severity?: string
          status?: string
          summary?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      privacy_requests: {
        Row: {
          created_by_user_id: string | null
          details: string
          id: string
          last_action_at: string | null
          last_action_summary: Json
          last_action_type: string | null
          metadata: Json
          relation_to_data: string | null
          request_source: string
          request_type: string
          requester_company: string | null
          requester_email: string
          requester_name: string | null
          resolved_at: string | null
          reviewed_by_email: string | null
          status: string
          submitted_at: string
          target_email: string | null
          updated_at: string
        }
        Insert: {
          created_by_user_id?: string | null
          details: string
          id?: string
          last_action_at?: string | null
          last_action_summary?: Json
          last_action_type?: string | null
          metadata?: Json
          relation_to_data?: string | null
          request_source?: string
          request_type: string
          requester_company?: string | null
          requester_email: string
          requester_name?: string | null
          resolved_at?: string | null
          reviewed_by_email?: string | null
          status?: string
          submitted_at?: string
          target_email?: string | null
          updated_at?: string
        }
        Update: {
          created_by_user_id?: string | null
          details?: string
          id?: string
          last_action_at?: string | null
          last_action_summary?: Json
          last_action_type?: string | null
          metadata?: Json
          relation_to_data?: string | null
          request_source?: string
          request_type?: string
          requester_company?: string | null
          requester_email?: string
          requester_name?: string | null
          resolved_at?: string | null
          reviewed_by_email?: string | null
          status?: string
          submitted_at?: string
          target_email?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          company_domain: string | null
          company_name: string | null
          company_profile: Json | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          job_title: string | null
          signature: string | null
          signatures: Json | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          company_domain?: string | null
          company_name?: string | null
          company_profile?: Json | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          job_title?: string | null
          signature?: string | null
          signatures?: Json | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          company_domain?: string | null
          company_name?: string | null
          company_profile?: Json | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          job_title?: string | null
          signature?: string | null
          signatures?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      provider_tokens: {
        Row: {
          expires_at: string | null
          provider: string
          refresh_token: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          expires_at?: string | null
          provider: string
          refresh_token: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          expires_at?: string | null
          provider?: string
          refresh_token?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      research_company_artifacts: {
        Row: {
          cache_identity: string
          company_identity: string
          completed_at: string | null
          country_code: string
          created_at: string
          error_code: string | null
          error_message: string | null
          error_metadata: Json
          expires_at: string
          generation_claim_expires_at: string | null
          generation_claim_token: string | null
          generation_claimed_at: string | null
          icp_hash: string
          id: string
          organization_id: string
          payload: Json
          profile_revision: string
          prompt_version: string
          provider: string
          provider_version: string
          research_depth: string
          research_language: string
          revision: number
          status: string
          updated_at: string
        }
        Insert: {
          cache_identity: string
          company_identity: string
          completed_at?: string | null
          country_code: string
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          error_metadata?: Json
          expires_at: string
          generation_claim_expires_at?: string | null
          generation_claim_token?: string | null
          generation_claimed_at?: string | null
          icp_hash: string
          id?: string
          organization_id: string
          payload?: Json
          profile_revision: string
          prompt_version: string
          provider: string
          provider_version: string
          research_depth: string
          research_language: string
          revision: number
          status?: string
          updated_at?: string
        }
        Update: {
          cache_identity?: string
          company_identity?: string
          completed_at?: string | null
          country_code?: string
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          error_metadata?: Json
          expires_at?: string
          generation_claim_expires_at?: string | null
          generation_claim_token?: string | null
          generation_claimed_at?: string | null
          icp_hash?: string
          id?: string
          organization_id?: string
          payload?: Json
          profile_revision?: string
          prompt_version?: string
          provider?: string
          provider_version?: string
          research_depth?: string
          research_language?: string
          revision?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_company_artifacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      research_report_documents: {
        Row: {
          content_hash: string
          created_at: string
          document: Json
          error_code: string | null
          error_message: string | null
          generated_at: string
          generation_method: string
          id: string
          model: string | null
          organization_id: string
          prompt_version: string
          provider: string
          research_snapshot_id: string
          retryable: boolean
          schema_version: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content_hash: string
          created_at?: string
          document: Json
          error_code?: string | null
          error_message?: string | null
          generated_at: string
          generation_method: string
          id?: string
          model?: string | null
          organization_id: string
          prompt_version: string
          provider: string
          research_snapshot_id: string
          retryable?: boolean
          schema_version: string
          status: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content_hash?: string
          created_at?: string
          document?: Json
          error_code?: string | null
          error_message?: string | null
          generated_at?: string
          generation_method?: string
          id?: string
          model?: string | null
          organization_id?: string
          prompt_version?: string
          provider?: string
          research_snapshot_id?: string
          retryable?: boolean
          schema_version?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_report_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_report_documents_snapshot_scope_fk"
            columns: ["research_snapshot_id", "organization_id", "user_id"]
            isOneToOne: false
            referencedRelation: "research_snapshots"
            referencedColumns: ["id", "organization_id", "user_id"]
          },
        ]
      }
      research_run_items: {
        Row: {
          created_at: string
          error_code: string | null
          error_message: string | null
          id: string
          job_id: string
          lead_ref: string
          organization_id: string
          position: number
          run_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          job_id: string
          lead_ref: string
          organization_id: string
          position?: number
          run_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          job_id?: string
          lead_ref?: string
          organization_id?: string
          position?: number
          run_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_run_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "lead_research_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_run_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_run_items_run_id_organization_id_user_id_fkey"
            columns: ["run_id", "organization_id", "user_id"]
            isOneToOne: false
            referencedRelation: "research_runs"
            referencedColumns: ["id", "organization_id", "user_id"]
          },
        ]
      }
      research_runs: {
        Row: {
          completed_at: string | null
          completed_count: number
          created_at: string
          failed_count: number
          id: string
          organization_id: string
          request_payload: Json
          started_at: string | null
          status: string
          total_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          completed_count?: number
          created_at?: string
          failed_count?: number
          id?: string
          organization_id: string
          request_payload?: Json
          started_at?: string | null
          status?: string
          total_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          completed_count?: number
          created_at?: string
          failed_count?: number
          id?: string
          organization_id?: string
          request_payload?: Json
          started_at?: string | null
          status?: string
          total_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      research_snapshots: {
        Row: {
          captured_at: string
          content_hash: string
          created_at: string
          id: string
          lead_ref: string
          organization_id: string | null
          payload: Json
          schema_version: number
          scope_key: string
          source: string
          user_id: string
        }
        Insert: {
          captured_at?: string
          content_hash: string
          created_at?: string
          id?: string
          lead_ref: string
          organization_id?: string | null
          payload: Json
          schema_version?: number
          scope_key: string
          source: string
          user_id: string
        }
        Update: {
          captured_at?: string
          content_hash?: string
          created_at?: string
          id?: string
          lead_ref?: string
          organization_id?: string | null
          payload?: Json
          schema_version?: number
          scope_key?: string
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_opportunities: {
        Row: {
          apply_url: string | null
          company_domain: string | null
          company_linkedin_url: string | null
          company_name: string
          contract_type: string | null
          created_at: string | null
          description_snippet: string | null
          experience_level: string | null
          id: string
          job_url: string
          location: string | null
          organization_id: string | null
          posted_time: string | null
          published_at: string | null
          source: string | null
          title: string
          updated_at: string | null
          user_id: string | null
          work_type: string | null
        }
        Insert: {
          apply_url?: string | null
          company_domain?: string | null
          company_linkedin_url?: string | null
          company_name: string
          contract_type?: string | null
          created_at?: string | null
          description_snippet?: string | null
          experience_level?: string | null
          id?: string
          job_url: string
          location?: string | null
          organization_id?: string | null
          posted_time?: string | null
          published_at?: string | null
          source?: string | null
          title: string
          updated_at?: string | null
          user_id?: string | null
          work_type?: string | null
        }
        Update: {
          apply_url?: string | null
          company_domain?: string | null
          company_linkedin_url?: string | null
          company_name?: string
          contract_type?: string | null
          created_at?: string | null
          description_snippet?: string | null
          experience_level?: string | null
          id?: string
          job_url?: string
          location?: string | null
          organization_id?: string | null
          posted_time?: string | null
          published_at?: string | null
          source?: string | null
          title?: string
          updated_at?: string | null
          user_id?: string | null
          work_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "saved_opportunities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_searches: {
        Row: {
          created_at: string | null
          criteria: Json
          id: string
          is_shared: boolean | null
          name: string
          organization_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          criteria: Json
          id?: string
          is_shared?: boolean | null
          name: string
          organization_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          criteria?: Json
          id?: string
          is_shared?: boolean | null
          name?: string
          organization_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_searches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_searches_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      suplia_agent_runs: {
        Row: {
          agent_name: string
          conversation_id: string
          created_at: string
          error_message: string | null
          estimated_cost: number | null
          finished_at: string | null
          id: string
          input_payload: Json
          job_id: string
          model_name: string | null
          model_tier: string | null
          organization_id: string
          output_payload: Json
          reasoning_summary: string | null
          started_at: string | null
          status: string
          step_id: string | null
          token_usage: Json | null
          user_id: string | null
        }
        Insert: {
          agent_name: string
          conversation_id: string
          created_at?: string
          error_message?: string | null
          estimated_cost?: number | null
          finished_at?: string | null
          id?: string
          input_payload?: Json
          job_id: string
          model_name?: string | null
          model_tier?: string | null
          organization_id: string
          output_payload?: Json
          reasoning_summary?: string | null
          started_at?: string | null
          status?: string
          step_id?: string | null
          token_usage?: Json | null
          user_id?: string | null
        }
        Update: {
          agent_name?: string
          conversation_id?: string
          created_at?: string
          error_message?: string | null
          estimated_cost?: number | null
          finished_at?: string | null
          id?: string
          input_payload?: Json
          job_id?: string
          model_name?: string | null
          model_tier?: string | null
          organization_id?: string
          output_payload?: Json
          reasoning_summary?: string | null
          started_at?: string | null
          status?: string
          step_id?: string | null
          token_usage?: Json | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suplia_agent_runs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "suplia_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_agent_runs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "suplia_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_agent_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_agent_runs_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "suplia_job_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      suplia_artifact_versions: {
        Row: {
          artifact_id: string
          change_summary: string | null
          content: string | null
          conversation_id: string
          created_at: string
          data: Json
          id: string
          job_id: string | null
          organization_id: string
          source_message_id: string | null
          title: string
          user_id: string | null
          version_number: number
        }
        Insert: {
          artifact_id: string
          change_summary?: string | null
          content?: string | null
          conversation_id: string
          created_at?: string
          data?: Json
          id?: string
          job_id?: string | null
          organization_id: string
          source_message_id?: string | null
          title: string
          user_id?: string | null
          version_number?: number
        }
        Update: {
          artifact_id?: string
          change_summary?: string | null
          content?: string | null
          conversation_id?: string
          created_at?: string
          data?: Json
          id?: string
          job_id?: string | null
          organization_id?: string
          source_message_id?: string | null
          title?: string
          user_id?: string | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "suplia_artifact_versions_artifact_id_fkey"
            columns: ["artifact_id"]
            isOneToOne: false
            referencedRelation: "suplia_artifacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_artifact_versions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "suplia_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_artifact_versions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "suplia_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_artifact_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_artifact_versions_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "suplia_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      suplia_artifacts: {
        Row: {
          artifact_kind: string | null
          content: string | null
          conversation_id: string
          created_at: string
          data: Json
          id: string
          job_id: string | null
          organization_id: string
          source_message_id: string | null
          status: string
          title: string
          type: string
          updated_at: string
          user_id: string | null
          version_number: number
        }
        Insert: {
          artifact_kind?: string | null
          content?: string | null
          conversation_id: string
          created_at?: string
          data?: Json
          id?: string
          job_id?: string | null
          organization_id: string
          source_message_id?: string | null
          status?: string
          title: string
          type?: string
          updated_at?: string
          user_id?: string | null
          version_number?: number
        }
        Update: {
          artifact_kind?: string | null
          content?: string | null
          conversation_id?: string
          created_at?: string
          data?: Json
          id?: string
          job_id?: string | null
          organization_id?: string
          source_message_id?: string | null
          status?: string
          title?: string
          type?: string
          updated_at?: string
          user_id?: string | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "suplia_artifacts_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "suplia_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_artifacts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "suplia_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_artifacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_artifacts_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "suplia_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      suplia_campaign_previews: {
        Row: {
          audience_count: number
          campaign_id: string | null
          created_at: string
          excluded_count: number
          id: string
          job_id: string | null
          organization_id: string
          preflight_result: Json
          preview_type: string
          risk_summary: Json
          sample_count: number
          sample_messages: Json
        }
        Insert: {
          audience_count?: number
          campaign_id?: string | null
          created_at?: string
          excluded_count?: number
          id?: string
          job_id?: string | null
          organization_id: string
          preflight_result?: Json
          preview_type?: string
          risk_summary?: Json
          sample_count?: number
          sample_messages?: Json
        }
        Update: {
          audience_count?: number
          campaign_id?: string | null
          created_at?: string
          excluded_count?: number
          id?: string
          job_id?: string | null
          organization_id?: string
          preflight_result?: Json
          preview_type?: string
          risk_summary?: Json
          sample_count?: number
          sample_messages?: Json
        }
        Relationships: [
          {
            foreignKeyName: "suplia_campaign_previews_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "suplia_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_campaign_previews_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      suplia_company_scores: {
        Row: {
          company_key: string | null
          company_name: string
          created_at: string
          domain: string | null
          id: string
          job_id: string | null
          matched_segments: Json
          organization_id: string
          reasons: Json
          risks: Json
          score: number
          score_label: string
          source_payload: Json
        }
        Insert: {
          company_key?: string | null
          company_name: string
          created_at?: string
          domain?: string | null
          id?: string
          job_id?: string | null
          matched_segments?: Json
          organization_id: string
          reasons?: Json
          risks?: Json
          score?: number
          score_label?: string
          source_payload?: Json
        }
        Update: {
          company_key?: string | null
          company_name?: string
          created_at?: string
          domain?: string | null
          id?: string
          job_id?: string | null
          matched_segments?: Json
          organization_id?: string
          reasons?: Json
          risks?: Json
          score?: number
          score_label?: string
          source_payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "suplia_company_scores_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "suplia_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_company_scores_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      suplia_conversations: {
        Row: {
          created_at: string
          id: string
          metadata: Json
          organization_id: string
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          metadata?: Json
          organization_id: string
          status?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          metadata?: Json
          organization_id?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "suplia_conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      suplia_job_events: {
        Row: {
          agent_run_id: string | null
          created_at: string
          event_type: string
          id: string
          job_id: string | null
          message: string | null
          metadata: Json
          organization_id: string
          severity: string
          step_id: string | null
          title: string
          tool_run_id: string | null
        }
        Insert: {
          agent_run_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          job_id?: string | null
          message?: string | null
          metadata?: Json
          organization_id: string
          severity?: string
          step_id?: string | null
          title: string
          tool_run_id?: string | null
        }
        Update: {
          agent_run_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          job_id?: string | null
          message?: string | null
          metadata?: Json
          organization_id?: string
          severity?: string
          step_id?: string | null
          title?: string
          tool_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suplia_job_events_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "suplia_agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_job_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "suplia_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_job_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_job_events_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "suplia_job_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_job_events_tool_run_id_fkey"
            columns: ["tool_run_id"]
            isOneToOne: false
            referencedRelation: "suplia_tool_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      suplia_job_steps: {
        Row: {
          agent_name: string | null
          approval_action_id: string | null
          can_run_in_parallel: boolean
          conversation_id: string
          created_at: string
          depends_on_step_ids: string[]
          description: string | null
          error_message: string | null
          finished_at: string | null
          id: string
          input_payload: Json
          job_id: string
          lock_token: string | null
          locked_at: string | null
          max_attempts: number
          organization_id: string
          output_payload: Json
          progress_current: number
          progress_total: number
          requires_approval: boolean
          retry_count: number
          scheduled_for: string
          started_at: string | null
          status: string
          step_key: string
          step_order: number
          step_type: string
          title: string
          tool_run_id: string | null
          updated_at: string
        }
        Insert: {
          agent_name?: string | null
          approval_action_id?: string | null
          can_run_in_parallel?: boolean
          conversation_id: string
          created_at?: string
          depends_on_step_ids?: string[]
          description?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          input_payload?: Json
          job_id: string
          lock_token?: string | null
          locked_at?: string | null
          max_attempts?: number
          organization_id: string
          output_payload?: Json
          progress_current?: number
          progress_total?: number
          requires_approval?: boolean
          retry_count?: number
          scheduled_for?: string
          started_at?: string | null
          status?: string
          step_key: string
          step_order?: number
          step_type?: string
          title: string
          tool_run_id?: string | null
          updated_at?: string
        }
        Update: {
          agent_name?: string | null
          approval_action_id?: string | null
          can_run_in_parallel?: boolean
          conversation_id?: string
          created_at?: string
          depends_on_step_ids?: string[]
          description?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          input_payload?: Json
          job_id?: string
          lock_token?: string | null
          locked_at?: string | null
          max_attempts?: number
          organization_id?: string
          output_payload?: Json
          progress_current?: number
          progress_total?: number
          requires_approval?: boolean
          retry_count?: number
          scheduled_for?: string
          started_at?: string | null
          status?: string
          step_key?: string
          step_order?: number
          step_type?: string
          title?: string
          tool_run_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suplia_job_steps_approval_action_id_fkey"
            columns: ["approval_action_id"]
            isOneToOne: false
            referencedRelation: "suplia_pending_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_job_steps_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "suplia_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_job_steps_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "suplia_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_job_steps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_job_steps_tool_run_id_fkey"
            columns: ["tool_run_id"]
            isOneToOne: false
            referencedRelation: "suplia_tool_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      suplia_jobs: {
        Row: {
          cancelled_at: string | null
          conversation_id: string
          created_at: string
          current_step_id: string | null
          error_message: string | null
          finished_at: string | null
          goal: string
          id: string
          input_payload: Json
          job_type: string
          last_heartbeat_at: string | null
          lock_token: string | null
          locked_at: string | null
          organization_id: string
          output_payload: Json
          paused_at: string | null
          priority: number
          progress_current: number
          progress_label: string | null
          progress_total: number
          queued_at: string
          started_at: string | null
          status: string
          title: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          cancelled_at?: string | null
          conversation_id: string
          created_at?: string
          current_step_id?: string | null
          error_message?: string | null
          finished_at?: string | null
          goal: string
          id?: string
          input_payload?: Json
          job_type?: string
          last_heartbeat_at?: string | null
          lock_token?: string | null
          locked_at?: string | null
          organization_id: string
          output_payload?: Json
          paused_at?: string | null
          priority?: number
          progress_current?: number
          progress_label?: string | null
          progress_total?: number
          queued_at?: string
          started_at?: string | null
          status?: string
          title: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          cancelled_at?: string | null
          conversation_id?: string
          created_at?: string
          current_step_id?: string | null
          error_message?: string | null
          finished_at?: string | null
          goal?: string
          id?: string
          input_payload?: Json
          job_type?: string
          last_heartbeat_at?: string | null
          lock_token?: string | null
          locked_at?: string | null
          organization_id?: string
          output_payload?: Json
          paused_at?: string | null
          priority?: number
          progress_current?: number
          progress_label?: string | null
          progress_total?: number
          queued_at?: string
          started_at?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suplia_jobs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "suplia_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_jobs_current_step_id_fkey"
            columns: ["current_step_id"]
            isOneToOne: false
            referencedRelation: "suplia_job_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      suplia_lead_scores: {
        Row: {
          company_name: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          job_id: string | null
          lead_id: string | null
          lead_key: string | null
          organization_id: string
          reasons: Json
          recommended_action: string | null
          risks: Json
          score: number
          score_label: string
          source_payload: Json
        }
        Insert: {
          company_name?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          job_id?: string | null
          lead_id?: string | null
          lead_key?: string | null
          organization_id: string
          reasons?: Json
          recommended_action?: string | null
          risks?: Json
          score?: number
          score_label?: string
          source_payload?: Json
        }
        Update: {
          company_name?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          job_id?: string | null
          lead_id?: string | null
          lead_key?: string | null
          organization_id?: string
          reasons?: Json
          recommended_action?: string | null
          risks?: Json
          score?: number
          score_label?: string
          source_payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "suplia_lead_scores_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "suplia_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_lead_scores_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      suplia_memories: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          confidence: number
          created_at: string
          expires_at: string | null
          id: string
          key: string
          memory_type: string
          organization_id: string
          scope: string
          source_conversation_id: string | null
          source_job_id: string | null
          status: string
          updated_at: string
          user_id: string | null
          value: Json
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          confidence?: number
          created_at?: string
          expires_at?: string | null
          id?: string
          key: string
          memory_type: string
          organization_id: string
          scope?: string
          source_conversation_id?: string | null
          source_job_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
          value?: Json
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          confidence?: number
          created_at?: string
          expires_at?: string | null
          id?: string
          key?: string
          memory_type?: string
          organization_id?: string
          scope?: string
          source_conversation_id?: string | null
          source_job_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "suplia_memories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_memories_source_conversation_id_fkey"
            columns: ["source_conversation_id"]
            isOneToOne: false
            referencedRelation: "suplia_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_memories_source_job_id_fkey"
            columns: ["source_job_id"]
            isOneToOne: false
            referencedRelation: "suplia_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      suplia_message_feedback: {
        Row: {
          comment: string | null
          conversation_id: string
          created_at: string
          id: string
          message_id: string
          organization_id: string
          rating: string
          updated_at: string
          user_id: string
        }
        Insert: {
          comment?: string | null
          conversation_id: string
          created_at?: string
          id?: string
          message_id: string
          organization_id: string
          rating: string
          updated_at?: string
          user_id: string
        }
        Update: {
          comment?: string | null
          conversation_id?: string
          created_at?: string
          id?: string
          message_id?: string
          organization_id?: string
          rating?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      suplia_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          metadata: Json
          organization_id: string
          role: string
          user_id: string | null
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          metadata?: Json
          organization_id: string
          role: string
          user_id?: string | null
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          organization_id?: string
          role?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suplia_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "suplia_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      suplia_pending_actions: {
        Row: {
          action_type: string
          approval_kind: string
          approval_reason: string | null
          approved_at: string | null
          approved_by: string | null
          conversation_id: string
          created_at: string
          description: string | null
          error_message: string | null
          executed_at: string | null
          id: string
          job_id: string | null
          organization_id: string
          payload: Json
          requires_approval: boolean
          result: Json | null
          risk_level: string
          status: string
          step_id: string | null
          title: string
          tool_name: string | null
          tool_run_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          action_type: string
          approval_kind?: string
          approval_reason?: string | null
          approved_at?: string | null
          approved_by?: string | null
          conversation_id: string
          created_at?: string
          description?: string | null
          error_message?: string | null
          executed_at?: string | null
          id?: string
          job_id?: string | null
          organization_id: string
          payload?: Json
          requires_approval?: boolean
          result?: Json | null
          risk_level?: string
          status?: string
          step_id?: string | null
          title: string
          tool_name?: string | null
          tool_run_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          action_type?: string
          approval_kind?: string
          approval_reason?: string | null
          approved_at?: string | null
          approved_by?: string | null
          conversation_id?: string
          created_at?: string
          description?: string | null
          error_message?: string | null
          executed_at?: string | null
          id?: string
          job_id?: string | null
          organization_id?: string
          payload?: Json
          requires_approval?: boolean
          result?: Json | null
          risk_level?: string
          status?: string
          step_id?: string | null
          title?: string
          tool_name?: string | null
          tool_run_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suplia_pending_actions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "suplia_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_pending_actions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "suplia_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_pending_actions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_pending_actions_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "suplia_job_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_pending_actions_tool_run_id_fkey"
            columns: ["tool_run_id"]
            isOneToOne: false
            referencedRelation: "suplia_tool_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      suplia_playbooks: {
        Row: {
          created_at: string
          description: string | null
          guardrails: Json
          id: string
          input_schema: Json
          name: string
          organization_id: string
          performance_summary: Json
          playbook_type: string
          status: string
          steps: Json
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          guardrails?: Json
          id?: string
          input_schema?: Json
          name: string
          organization_id: string
          performance_summary?: Json
          playbook_type?: string
          status?: string
          steps?: Json
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          guardrails?: Json
          id?: string
          input_schema?: Json
          name?: string
          organization_id?: string
          performance_summary?: Json
          playbook_type?: string
          status?: string
          steps?: Json
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suplia_playbooks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      suplia_reply_drafts: {
        Row: {
          approval_action_id: string | null
          classification: string | null
          contacted_id: string | null
          conversation_id: string | null
          created_at: string
          html_body: string | null
          id: string
          job_id: string | null
          organization_id: string
          reasoning_summary: string | null
          status: string
          subject: string | null
          text_body: string | null
          thread_key: string | null
          to_email: string | null
          updated_at: string
        }
        Insert: {
          approval_action_id?: string | null
          classification?: string | null
          contacted_id?: string | null
          conversation_id?: string | null
          created_at?: string
          html_body?: string | null
          id?: string
          job_id?: string | null
          organization_id: string
          reasoning_summary?: string | null
          status?: string
          subject?: string | null
          text_body?: string | null
          thread_key?: string | null
          to_email?: string | null
          updated_at?: string
        }
        Update: {
          approval_action_id?: string | null
          classification?: string | null
          contacted_id?: string | null
          conversation_id?: string | null
          created_at?: string
          html_body?: string | null
          id?: string
          job_id?: string | null
          organization_id?: string
          reasoning_summary?: string | null
          status?: string
          subject?: string | null
          text_body?: string | null
          thread_key?: string | null
          to_email?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suplia_reply_drafts_approval_action_id_fkey"
            columns: ["approval_action_id"]
            isOneToOne: false
            referencedRelation: "suplia_pending_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_reply_drafts_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "suplia_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_reply_drafts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "suplia_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_reply_drafts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      suplia_research_cache: {
        Row: {
          cache_key: string
          created_at: string
          domain: string | null
          expires_at: string
          fetched_at: string | null
          hit_count: number
          id: string
          last_hit_at: string | null
          organization_id: string
          payload: Json
          provider: string
          query: string | null
          status: string
          updated_at: string
        }
        Insert: {
          cache_key: string
          created_at?: string
          domain?: string | null
          expires_at: string
          fetched_at?: string | null
          hit_count?: number
          id?: string
          last_hit_at?: string | null
          organization_id: string
          payload?: Json
          provider: string
          query?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          cache_key?: string
          created_at?: string
          domain?: string | null
          expires_at?: string
          fetched_at?: string | null
          hit_count?: number
          id?: string
          last_hit_at?: string | null
          organization_id?: string
          payload?: Json
          provider?: string
          query?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suplia_research_cache_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      suplia_review_items: {
        Row: {
          antonia_report_id: string | null
          created_at: string
          id: string
          item_type: string
          messaging_draft_id: string | null
          metadata: Json
          organization_id: string
          requested_by_user_id: string | null
          resolution_note: string | null
          reviewed_at: string | null
          reviewed_by_user_id: string | null
          sender_user_id: string | null
          severity: string
          status: string
          summary: string
          title: string
          updated_at: string
        }
        Insert: {
          antonia_report_id?: string | null
          created_at?: string
          id?: string
          item_type: string
          messaging_draft_id?: string | null
          metadata?: Json
          organization_id: string
          requested_by_user_id?: string | null
          resolution_note?: string | null
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          sender_user_id?: string | null
          severity?: string
          status?: string
          summary: string
          title: string
          updated_at?: string
        }
        Update: {
          antonia_report_id?: string | null
          created_at?: string
          id?: string
          item_type?: string
          messaging_draft_id?: string | null
          metadata?: Json
          organization_id?: string
          requested_by_user_id?: string | null
          resolution_note?: string | null
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          sender_user_id?: string | null
          severity?: string
          status?: string
          summary?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suplia_review_items_antonia_report_id_fkey"
            columns: ["antonia_report_id"]
            isOneToOne: false
            referencedRelation: "antonia_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_review_items_messaging_draft_id_fkey"
            columns: ["messaging_draft_id"]
            isOneToOne: false
            referencedRelation: "messaging_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_review_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      suplia_tool_leases: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          job_id: string | null
          lease_token: string
          max_concurrent: number
          metadata: Json
          organization_id: string
          released_at: string | null
          resource_key: string
          step_id: string | null
          tool_run_id: string | null
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          job_id?: string | null
          lease_token: string
          max_concurrent?: number
          metadata?: Json
          organization_id: string
          released_at?: string | null
          resource_key: string
          step_id?: string | null
          tool_run_id?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          job_id?: string | null
          lease_token?: string
          max_concurrent?: number
          metadata?: Json
          organization_id?: string
          released_at?: string | null
          resource_key?: string
          step_id?: string | null
          tool_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suplia_tool_leases_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "suplia_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_tool_leases_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_tool_leases_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "suplia_job_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_tool_leases_tool_run_id_fkey"
            columns: ["tool_run_id"]
            isOneToOne: false
            referencedRelation: "suplia_tool_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      suplia_tool_runs: {
        Row: {
          agent_run_id: string | null
          approval_kind: string
          approval_reason: string | null
          approved_at: string | null
          approved_by: string | null
          conversation_id: string
          created_at: string
          duration_ms: number | null
          error_message: string | null
          estimated_cost: number | null
          finished_at: string | null
          id: string
          input_payload: Json
          job_id: string | null
          message_id: string | null
          model_name: string | null
          model_tier: string | null
          organization_id: string
          output_payload: Json | null
          pending_action_id: string | null
          requires_approval: boolean
          risk_level: string
          started_at: string | null
          status: string
          step_id: string | null
          token_usage: Json | null
          tool_name: string
          user_id: string | null
        }
        Insert: {
          agent_run_id?: string | null
          approval_kind?: string
          approval_reason?: string | null
          approved_at?: string | null
          approved_by?: string | null
          conversation_id: string
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          estimated_cost?: number | null
          finished_at?: string | null
          id?: string
          input_payload?: Json
          job_id?: string | null
          message_id?: string | null
          model_name?: string | null
          model_tier?: string | null
          organization_id: string
          output_payload?: Json | null
          pending_action_id?: string | null
          requires_approval?: boolean
          risk_level?: string
          started_at?: string | null
          status?: string
          step_id?: string | null
          token_usage?: Json | null
          tool_name: string
          user_id?: string | null
        }
        Update: {
          agent_run_id?: string | null
          approval_kind?: string
          approval_reason?: string | null
          approved_at?: string | null
          approved_by?: string | null
          conversation_id?: string
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          estimated_cost?: number | null
          finished_at?: string | null
          id?: string
          input_payload?: Json
          job_id?: string | null
          message_id?: string | null
          model_name?: string | null
          model_tier?: string | null
          organization_id?: string
          output_payload?: Json | null
          pending_action_id?: string | null
          requires_approval?: boolean
          risk_level?: string
          started_at?: string | null
          status?: string
          step_id?: string | null
          token_usage?: Json | null
          tool_name?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suplia_tool_runs_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "suplia_agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_tool_runs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "suplia_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_tool_runs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "suplia_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_tool_runs_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "suplia_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_tool_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_tool_runs_pending_action_id_fkey"
            columns: ["pending_action_id"]
            isOneToOne: false
            referencedRelation: "suplia_pending_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suplia_tool_runs_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "suplia_job_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      unified_crm_data: {
        Row: {
          autopilot_status: string | null
          id: string
          last_autopilot_event: string | null
          meeting_link: string | null
          next_action: string | null
          next_action_due_at: string | null
          next_action_type: string | null
          notes: string | null
          organization_id: string | null
          owner: string | null
          stage: string | null
          updated_at: string
        }
        Insert: {
          autopilot_status?: string | null
          id: string
          last_autopilot_event?: string | null
          meeting_link?: string | null
          next_action?: string | null
          next_action_due_at?: string | null
          next_action_type?: string | null
          notes?: string | null
          organization_id?: string | null
          owner?: string | null
          stage?: string | null
          updated_at?: string
        }
        Update: {
          autopilot_status?: string | null
          id?: string
          last_autopilot_event?: string | null
          meeting_link?: string | null
          next_action?: string | null
          next_action_due_at?: string | null
          next_action_type?: string | null
          notes?: string | null
          organization_id?: string | null
          owner?: string | null
          stage?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "unified_crm_data_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      unified_sheet: {
        Row: {
          gid: string
          kind: string | null
          notes: string | null
          owner: string | null
          source_id: string | null
          stage: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          gid: string
          kind?: string | null
          notes?: string | null
          owner?: string | null
          source_id?: string | null
          stage?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          gid?: string
          kind?: string | null
          notes?: string | null
          owner?: string | null
          source_id?: string | null
          stage?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      unsubscribed_emails: {
        Row: {
          created_at: string | null
          email: string
          id: string
          organization_id: string | null
          reason: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          organization_id?: string | null
          reason?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          organization_id?: string | null
          reason?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "unsubscribed_emails_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_quota_overrides: {
        Row: {
          created_at: string
          daily_contact_limit: number | null
          daily_enrich_limit: number | null
          daily_investigate_limit: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          daily_contact_limit?: number | null
          daily_enrich_limit?: number | null
          daily_investigate_limit?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          daily_contact_limit?: number | null
          daily_enrich_limit?: number | null
          daily_investigate_limit?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      abandon_outbound_dispatch_reconciliation_v1: {
        Args: {
          p_claimed_at: string
          p_dispatch_id: string
          p_expected_attempt_count: number
        }
        Returns: boolean
      }
      abort_native_lead_research_request_claim_v1: {
        Args: {
          p_claim_token: string
          p_error_code: string
          p_error_message: string
          p_job_id: string
          p_organization_id: string
          p_scope_key: string
          p_user_id: string
        }
        Returns: boolean
      }
      accept_invite: { Args: { invite_token: string }; Returns: boolean }
      accept_organization_invite_v1: {
        Args: { p_token_hash: string }
        Returns: string
      }
      antonia_event_uuid_or_null: { Args: { p_value: string }; Returns: string }
      append_antonia_event_v1: { Args: { p_event: Json }; Returns: Json }
      append_messaging_draft_revision_v1: {
        Args: {
          p_content_hash: string
          p_draft_id: string
          p_expected_parent_version_id: string
          p_payload: Json
        }
        Returns: Json
      }
      append_organization_collaboration_event_v1: {
        Args: {
          p_actor_user_id: string
          p_contact_thread_id?: string
          p_entity_id?: string
          p_entity_type: string
          p_event_type: string
          p_lead_id?: string
          p_metadata?: Json
          p_organization_id: string
        }
        Returns: string
      }
      apply_privacy_suppression_v2: {
        Args: { p_email: string; p_reason?: string }
        Returns: Json
      }
      approve_messaging_draft_v1: {
        Args: {
          p_draft_id: string
          p_organization_id: string
          p_user_id: string
          p_version_id: string
          p_warnings?: Json
        }
        Returns: Json
      }
      assign_organization_lead_v1: {
        Args: { p_assigned_to_user_id: string; p_lead_id: string }
        Returns: Json
      }
      cancel_native_lead_research_request_claim_v1: {
        Args: {
          p_claim_token: string
          p_job_id: string
          p_organization_id: string
          p_scope_key: string
          p_user_id: string
        }
        Returns: boolean
      }
      claim_antonia_quota_operation_v1: {
        Args: {
          p_limit: number
          p_operation_id: string
          p_organization_id: string
          p_request_fingerprint: string
          p_requested_count: number
          p_resource: string
          p_scope: string
          p_stale_after_seconds?: number
          p_user_id: string
        }
        Returns: Json
      }
      claim_antonia_tasks: {
        Args: {
          p_limit?: number
          p_worker_id?: string
          p_worker_source?: string
        }
        Returns: {
          created_at: string
          error_message: string | null
          heartbeat_at: string | null
          id: string
          idempotency_key: string | null
          mission_id: string | null
          organization_id: string | null
          payload: Json | null
          processing_started_at: string | null
          progress_current: number | null
          progress_label: string | null
          progress_total: number | null
          result: Json | null
          retry_count: number
          scheduled_for: string | null
          status: string
          type: string
          updated_at: string
          worker_id: string | null
          worker_source: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "antonia_tasks"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_campaign_recipient_step_prepare_v2: {
        Args: {
          p_organization_id: string
          p_step_id: string
          p_user_id: string
        }
        Returns: Json
      }
      claim_lead_research_request_v1: {
        Args: {
          p_company_domain: string
          p_company_name: string
          p_email: string
          p_lead_id: string
          p_lead_ref: string
          p_organization_id: string
          p_request_idempotency_key: string
          p_request_payload: Json
          p_scope_key: string
          p_stale_after_seconds?: number
          p_user_id: string
        }
        Returns: Json
      }
      claim_native_draft_generation_v1: {
        Args: {
          p_draft_id: string
          p_organization_id: string
          p_research_snapshot_id: string
          p_stale_after_seconds?: number
          p_subject_email: string
          p_user_id: string
        }
        Returns: Json
      }
      claim_native_lead_research_request_v1: {
        Args: {
          p_company_domain: string
          p_company_name: string
          p_email: string
          p_lead_id: string
          p_lead_ref: string
          p_organization_id: string
          p_request_idempotency_key: string
          p_request_payload: Json
          p_scope_key: string
          p_stale_after_seconds?: number
          p_user_id: string
        }
        Returns: Json
      }
      claim_organization_lead_v1: {
        Args: { p_lead_id: string; p_minutes?: number }
        Returns: Json
      }
      claim_outbound_dispatch_reconciliation_v1: {
        Args: {
          p_claimed_at: string
          p_dispatch_id: string
          p_expected_attempt_count: number
          p_expected_status: string
          p_stale_claim_before: string
          p_stale_sending_before: string
        }
        Returns: Json
      }
      claim_outbound_dispatch_sending_v2: {
        Args: {
          p_dispatch_id: string
          p_expected_attempt_count: number
          p_started_at: string
        }
        Returns: Json
      }
      claim_research_company_artifact_v1: {
        Args: {
          p_cache_identity: string
          p_company_identity: string
          p_country_code: string
          p_force_refresh?: boolean
          p_icp_hash: string
          p_lease_seconds?: number
          p_organization_id: string
          p_profile_revision: string
          p_prompt_version: string
          p_provider: string
          p_provider_version: string
          p_research_depth: string
          p_research_language: string
        }
        Returns: Json
      }
      claim_suplia_tool_lease: {
        Args: {
          p_job_id?: string
          p_max_concurrent: number
          p_metadata?: Json
          p_organization_id: string
          p_resource_key: string
          p_step_id?: string
          p_tool_run_id?: string
          p_ttl_seconds: number
        }
        Returns: {
          acquired: boolean
          active_count: number
          expires_at: string
          lease_id: string
          lease_token: string
        }[]
      }
      complete_antonia_quota_operation_v1: {
        Args: {
          p_claim_token: string
          p_operation_id: string
          p_organization_id: string
          p_resource: string
          p_response_payload: Json
          p_response_status: number
          p_status: string
          p_user_id: string
        }
        Returns: boolean
      }
      complete_lead_research_request_claim_v1: {
        Args: {
          p_claim_token: string
          p_company_domain: string
          p_company_name: string
          p_email: string
          p_job_id: string
          p_lead_id: string
          p_lead_ref: string
          p_organization_id: string
          p_provider_report_id: string
          p_provider_status: string
          p_request_payload: Json
          p_scope_key: string
          p_user_id: string
        }
        Returns: Json
      }
      complete_research_company_artifact_v1: {
        Args: {
          p_artifact_id: string
          p_cache_identity: string
          p_claim_token: string
          p_error_code?: string
          p_error_message?: string
          p_error_metadata?: Json
          p_expires_at: string
          p_organization_id: string
          p_payload: Json
          p_status: string
        }
        Returns: Json
      }
      consume_antonia_daily_quota_v1: {
        Args: {
          p_limit: number
          p_organization_id: string
          p_requested_count: number
          p_resource: string
          p_scope: string
          p_user_id: string
        }
        Returns: Json
      }
      consume_lead_research_request_quota_v1: {
        Args: {
          p_claim_token: string
          p_job_id: string
          p_limit: number
          p_organization_id: string
          p_scope_key: string
          p_user_id: string
        }
        Returns: Json
      }
      create_first_contact_campaign_plan_v2:
        | {
            Args: {
              p_draft_id: string
              p_organization_id: string
              p_steps: Json
              p_user_id: string
              p_version_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_draft_id: string
              p_organization_id: string
              p_sequence_instruction: string
              p_steps: Json
              p_style_profile_id: string
              p_user_id: string
              p_version_id: string
            }
            Returns: Json
          }
      create_messaging_draft_v1: {
        Args: { p_content_hash: string; p_payload: Json }
        Returns: Json
      }
      create_new_organization: { Args: { org_name: string }; Returns: string }
      create_organization_invite_v1: {
        Args: {
          p_email: string
          p_organization_id: string
          p_role: string
          p_token_hash: string
        }
        Returns: Json
      }
      current_user_shares_organization: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      delete_native_research_messaging_subject_core_v1: {
        Args: { p_email: string }
        Returns: Json
      }
      delete_native_research_messaging_subject_v1: {
        Args: { p_email: string }
        Returns: Json
      }
      delete_research_messaging_retention_core_v1: {
        Args: {
          p_cutoff: string
          p_dispatch_cutoff?: string
          p_draft_cutoff?: string
          p_dry_run?: boolean
          p_job_cutoff?: string
          p_resource: string
        }
        Returns: Json
      }
      delete_research_messaging_retention_v1: {
        Args: {
          p_cutoff: string
          p_dispatch_cutoff?: string
          p_draft_cutoff?: string
          p_dry_run?: boolean
          p_job_cutoff?: string
          p_resource: string
        }
        Returns: Json
      }
      delete_research_messaging_subject_v1: {
        Args: { p_email: string }
        Returns: Json
      }
      fail_lead_research_request_claim_v1: {
        Args: {
          p_claim_token: string
          p_error_code: string
          p_error_message: string
          p_job_id: string
          p_organization_id: string
          p_result_payload: Json
          p_scope_key: string
          p_user_id: string
        }
        Returns: boolean
      }
      finalize_campaign_delivery_outcome_v1: {
        Args: { p_dispatch_id: string }
        Returns: Json
      }
      finalize_campaign_recipient_step_dispatch_v2: {
        Args: { p_dispatch_id: string }
        Returns: Json
      }
      finalize_lead_research_request_terminal_v1: {
        Args: {
          p_claim_token: string
          p_company_domain: string
          p_company_name: string
          p_email: string
          p_job_id: string
          p_lead_id: string
          p_lead_ref: string
          p_organization_id: string
          p_provider_report_id: string
          p_provider_status: string
          p_request_payload: Json
          p_scope_key: string
          p_user_id: string
        }
        Returns: Json
      }
      finalize_sent_outbound_dispatch_history_core_v1: {
        Args: { p_dispatch_id: string }
        Returns: Json
      }
      finalize_sent_outbound_dispatch_history_v1: {
        Args: { p_dispatch_id: string }
        Returns: Json
      }
      get_my_org_ids: { Args: never; Returns: string[] }
      get_user_org_ids: { Args: never; Returns: string[] }
      increment_contacted_count: {
        Args: { row_id: string }
        Returns: undefined
      }
      increment_daily_usage: {
        Args: {
          p_date: string
          p_leads_enriched?: number
          p_leads_investigated?: number
          p_leads_searched?: number
          p_organization_id: string
          p_search_runs?: number
        }
        Returns: undefined
      }
      ingest_inbound_reply_core_v1: {
        Args: {
          p_classification: Json
          p_contacted_id: string
          p_content: string
          p_conversation_id: string
          p_event_at: string
          p_event_source: string
          p_event_type: string
          p_internet_message_id: string
          p_message_id: string
          p_preview: string
          p_provider: string
          p_recipient_email: string
          p_subject: string
          p_thread_id: string
          p_thread_key: string
        }
        Returns: Json
      }
      ingest_inbound_reply_v1: {
        Args: {
          p_classification: Json
          p_contacted_id: string
          p_content: string
          p_conversation_id: string
          p_event_at: string
          p_event_source: string
          p_event_type: string
          p_internet_message_id: string
          p_message_id: string
          p_preview: string
          p_provider: string
          p_recipient_email: string
          p_subject: string
          p_thread_id: string
          p_thread_key: string
        }
        Returns: Json
      }
      is_current_user_organization_member: {
        Args: { p_organization_id: string }
        Returns: boolean
      }
      is_organization_admin: {
        Args: { p_organization_id: string; p_user_id?: string }
        Returns: boolean
      }
      leave_organization_v1: {
        Args: { p_organization_id: string }
        Returns: boolean
      }
      link_campaign_recipient_step_draft_v2: {
        Args: {
          p_draft_id: string
          p_organization_id: string
          p_step_id: string
          p_user_id: string
          p_version_id: string
        }
        Returns: Json
      }
      lookup_campaign_v2_subject_v2: {
        Args: { p_email: string }
        Returns: Json
      }
      lookup_research_messaging_subject_core_v1: {
        Args: { p_email: string }
        Returns: Json
      }
      lookup_research_messaging_subject_v1: {
        Args: { p_email: string }
        Returns: Json
      }
      mark_antonia_quota_operation_submitted_v1: {
        Args: {
          p_claim_token: string
          p_operation_id: string
          p_organization_id: string
          p_resource: string
          p_user_id: string
        }
        Returns: boolean
      }
      mark_lead_research_request_submitting_v1: {
        Args: {
          p_claim_token: string
          p_job_id: string
          p_organization_id: string
          p_scope_key: string
          p_user_id: string
        }
        Returns: boolean
      }
      mark_lead_research_request_unknown_v1: {
        Args: {
          p_claim_token: string
          p_error_code: string
          p_error_message: string
          p_job_id: string
          p_organization_id: string
          p_scope_key: string
          p_user_id: string
        }
        Returns: boolean
      }
      organization_collaboration_rollout_report_v1: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      organization_has_role_v1: {
        Args: { p_organization_id: string; p_roles?: string[] }
        Returns: boolean
      }
      promote_due_campaign_recipient_steps_v2: {
        Args: { p_limit?: number }
        Returns: Json
      }
      query_antonia_event_ledger_v1: {
        Args: {
          p_actor_user_id?: string
          p_entity_type?: string
          p_event_type?: string
          p_from?: string
          p_limit?: number
          p_organization_id?: string
          p_to?: string
        }
        Returns: {
          actor_ref: string | null
          actor_type: string
          actor_user_id: string | null
          attempt_number: number
          campaign_id: string | null
          campaign_step_id: string | null
          causation_id: string | null
          contacted_id: string | null
          correlation_id: string | null
          created_at: string
          dispatch_id: string | null
          duration_ms: number | null
          entity_id: string | null
          entity_type: string | null
          error_code: string | null
          event_key: string
          event_type: string
          event_version: number
          external_entity_id: string | null
          id: string
          idempotency_key: string | null
          initiated_by_ref: string | null
          initiated_by_user_id: string | null
          lead_id: string | null
          message: string | null
          metrics: Json
          mission_id: string | null
          occurred_at: string
          operation_id: string | null
          organization_id: string | null
          organization_ref: string | null
          outcome: string | null
          payload_hash: string | null
          payload_retention_until: string
          privacy_class: string
          provider: string | null
          provider_request_id: string | null
          recorded_at: string
          redacted_payload: Json
          reporting_group_id: string | null
          request_id: string | null
          research_job_id: string | null
          retention_until: string
          severity: string | null
          source_confidence: string
          source_route: string | null
          source_system: string
          status: string | null
          task_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "antonia_event_ledger"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      query_antonia_event_rollups_daily_v1: {
        Args: {
          p_actor_user_id?: string
          p_event_type?: string
          p_from?: string
          p_limit?: number
          p_organization_id?: string
          p_to?: string
        }
        Returns: {
          actor_user_id: string | null
          bucket_date: string
          created_at: string
          event_count: number
          event_type: string
          first_occurred_at: string
          id: string
          last_occurred_at: string
          organization_id: string | null
          outcome: string | null
          provider: string | null
          refreshed_at: string
          source_confidence: string
          source_system: string
          status: string | null
          total_duration_ms: number
        }[]
        SetofOptions: {
          from: "*"
          to: "antonia_event_rollups_daily"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      record_inbound_unsubscribe_v1: {
        Args: {
          p_contacted_id: string
          p_event_key: string
          p_recipient_email: string
        }
        Returns: Json
      }
      record_scoped_unsubscribe_v2: {
        Args: {
          p_email: string
          p_organization_id: string
          p_reason: string
          p_user_id: string
        }
        Returns: Json
      }
      redact_antonia_event_v1: {
        Args: { p_event_id: string; p_reason: string }
        Returns: boolean
      }
      redact_expired_antonia_event_payloads_v1: {
        Args: { p_limit?: number }
        Returns: number
      }
      refresh_antonia_event_rollups_daily_v1: {
        Args: { p_from?: string; p_to?: string }
        Returns: number
      }
      release_antonia_quota_operation_v1: {
        Args: {
          p_claim_token: string
          p_operation_id: string
          p_organization_id: string
          p_resource: string
          p_user_id: string
        }
        Returns: boolean
      }
      release_lead_research_request_claim_v1: {
        Args: {
          p_claim_token: string
          p_error_code: string
          p_error_message: string
          p_job_id: string
          p_organization_id: string
          p_scope_key: string
          p_user_id: string
        }
        Returns: boolean
      }
      release_native_draft_generation_claim_v1: {
        Args: {
          p_claim_token: string
          p_draft_id: string
          p_organization_id: string
          p_user_id: string
        }
        Returns: boolean
      }
      release_organization_lead_claim_v1: {
        Args: { p_lead_id: string }
        Returns: boolean
      }
      release_outbound_contact_quota_v1: {
        Args: { p_dispatch_id: string }
        Returns: boolean
      }
      release_research_company_artifact_claim_v1: {
        Args: {
          p_artifact_id: string
          p_cache_identity: string
          p_claim_token: string
          p_error_code: string
          p_error_message: string
          p_error_metadata?: Json
          p_organization_id: string
        }
        Returns: boolean
      }
      release_suplia_tool_lease: {
        Args: { p_lease_token: string }
        Returns: boolean
      }
      remove_organization_member_v1: {
        Args: { p_organization_id: string; p_user_id: string }
        Returns: boolean
      }
      reopen_organization_contact_thread_v1: {
        Args: { p_contact_thread_id: string; p_reason: string }
        Returns: Json
      }
      repair_reconciled_sent_dispatch_history_v1: {
        Args: { p_dispatch_id: string }
        Returns: Json
      }
      research_messaging_is_iso_timestamptz_v1: {
        Args: { p_value: string }
        Returns: boolean
      }
      research_messaging_iso_timestamptz_equals_v1: {
        Args: { p_expected: string; p_value: string }
        Returns: boolean
      }
      research_messaging_jsonb_string_array_v1: {
        Args: {
          p_max_items: number
          p_max_length: number
          p_min_length: number
          p_value: Json
        }
        Returns: boolean
      }
      research_messaging_row_access: {
        Args: { p_organization_id: string; p_user_id: string }
        Returns: boolean
      }
      reserve_campaign_recipient_step_draft_v2: {
        Args: {
          p_draft_id: string
          p_organization_id: string
          p_step_id: string
          p_user_id: string
          p_version_id: string
        }
        Returns: Json
      }
      reserve_outbound_contact_quota_v1: {
        Args: {
          p_base_count: number
          p_dispatch_id: string
          p_limit: number
          p_organization_id: string
          p_scope: string
          p_user_id: string
        }
        Returns: Json
      }
      revoke_organization_invite_v1: {
        Args: { p_invite_id: string }
        Returns: boolean
      }
      safety_stop_campaign_recipient_from_contacted_v2: {
        Args: { p_contacted_id: string; p_reason?: string }
        Returns: Json
      }
      safety_stop_campaign_recipient_v2: {
        Args: {
          p_email: string
          p_organization_id?: string
          p_reason?: string
          p_user_id?: string
        }
        Returns: Json
      }
      schedule_daily_mission_tasks: {
        Args: never
        Returns: {
          mission_id: string
        }[]
      }
      set_organization_collaboration_v1_enabled: {
        Args: {
          p_enabled: boolean
          p_organization_id: string
          p_reason: string
        }
        Returns: Json
      }
      settle_native_research_run_items_v1: {
        Args: {
          p_error_code?: string
          p_error_message?: string
          p_job_id: string
          p_organization_id: string
          p_status: string
          p_user_id: string
        }
        Returns: Json
      }
      settle_suppressed_native_lead_research_job_v1: {
        Args: {
          p_email: string
          p_job_id: string
          p_organization_id: string
          p_scope_key: string
          p_user_id: string
        }
        Returns: boolean
      }
      stop_campaign_enrollment_v2: {
        Args: {
          p_campaign_id: string
          p_enrollment_id: string
          p_organization_id: string
          p_user_id: string
        }
        Returns: Json
      }
      store_lead_research_request_terminal_v1: {
        Args: {
          p_claim_token: string
          p_company_domain: string
          p_company_name: string
          p_email: string
          p_job_id: string
          p_lead_id: string
          p_lead_ref: string
          p_organization_id: string
          p_provider_report_id: string
          p_provider_status: string
          p_request_payload: Json
          p_result_payload: Json
          p_scope_key: string
          p_user_id: string
        }
        Returns: Json
      }
      summarize_antonia_events_v1: {
        Args: {
          p_actor_user_id?: string
          p_from?: string
          p_organization_id?: string
          p_to?: string
        }
        Returns: {
          event_count: number
          event_type: string
          first_occurred_at: string
          last_occurred_at: string
          outcome: string
          provider: string
          status: string
          total_duration_ms: number
        }[]
      }
      update_organization_member_role_v1: {
        Args: { p_organization_id: string; p_role: string; p_user_id: string }
        Returns: boolean
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
