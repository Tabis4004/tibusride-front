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
      audit_logs: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string
          created_at: string
          details: Json | null
          id: string
          target_id: string | null
          target_label: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id: string
          created_at?: string
          details?: Json | null
          id?: string
          target_id?: string | null
          target_label?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string
          created_at?: string
          details?: Json | null
          id?: string
          target_id?: string | null
          target_label?: string | null
          target_type?: string | null
        }
        Relationships: []
      }
      commission_schedules: {
        Row: {
          active: boolean
          category: Database["public"]["Enums"]["vehicle_category"]
          commission_flat_xof: number
          commission_rate: number
          commission_type: Database["public"]["Enums"]["commission_kind"]
          country: string | null
          created_at: string
          created_by: string | null
          ends_at: string | null
          id: string
          notes: string | null
          priority: number
          program_id: string | null
          starts_at: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          category: Database["public"]["Enums"]["vehicle_category"]
          commission_flat_xof?: number
          commission_rate?: number
          commission_type?: Database["public"]["Enums"]["commission_kind"]
          country?: string | null
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          notes?: string | null
          priority?: number
          program_id?: string | null
          starts_at: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: Database["public"]["Enums"]["vehicle_category"]
          commission_flat_xof?: number
          commission_rate?: number
          commission_type?: Database["public"]["Enums"]["commission_kind"]
          country?: string | null
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          notes?: string | null
          priority?: number
          program_id?: string | null
          starts_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_schedules_program_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "country_market_config"
            referencedColumns: ["program_id"]
          },
          {
            foreignKeyName: "commission_schedules_program_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "market_programs"
            referencedColumns: ["program_id"]
          },
        ]
      }
      corporate_accounts: {
        Row: {
          active: boolean
          address: string | null
          city: string | null
          contact_name: string | null
          country: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          tax_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          address?: string | null
          city?: string | null
          contact_name?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          tax_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          address?: string | null
          city?: string | null
          contact_name?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          tax_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      country_bonus_rules: {
        Row: {
          active: boolean
          bonus_percent: number | null
          bonus_xof: number
          config: Json
          country: string
          created_at: string
          description: string | null
          id: string
          label: string
          program_id: string
          rule_code: string
          threshold: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          bonus_percent?: number | null
          bonus_xof?: number
          config?: Json
          country: string
          created_at?: string
          description?: string | null
          id?: string
          label: string
          program_id: string
          rule_code: string
          threshold?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          bonus_percent?: number | null
          bonus_xof?: number
          config?: Json
          country?: string
          created_at?: string
          description?: string | null
          id?: string
          label?: string
          program_id?: string
          rule_code?: string
          threshold?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "country_bonus_rules_program_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "country_market_config"
            referencedColumns: ["program_id"]
          },
          {
            foreignKeyName: "country_bonus_rules_program_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "market_programs"
            referencedColumns: ["program_id"]
          },
        ]
      }
      country_payment_providers: {
        Row: {
          config: Json
          country: string
          created_at: string
          id: string
          is_active: boolean
          label: string
          program_id: string
          provider_code: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          config?: Json
          country: string
          created_at?: string
          id?: string
          is_active?: boolean
          label: string
          program_id: string
          provider_code: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          config?: Json
          country?: string
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          program_id?: string
          provider_code?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "country_payment_providers_program_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "country_market_config"
            referencedColumns: ["program_id"]
          },
          {
            foreignKeyName: "country_payment_providers_program_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "market_programs"
            referencedColumns: ["program_id"]
          },
        ]
      }
      country_pricing_overrides: {
        Row: {
          active: boolean
          base_fare_xof: number
          category: Database["public"]["Enums"]["vehicle_category"]
          commission_rate: number | null
          country: string
          created_at: string
          id: string
          min_fare_xof: number
          per_km_xof: number
          per_min_xof: number
          program_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          base_fare_xof: number
          category: Database["public"]["Enums"]["vehicle_category"]
          commission_rate?: number | null
          country: string
          created_at?: string
          id?: string
          min_fare_xof: number
          per_km_xof: number
          per_min_xof: number
          program_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          base_fare_xof?: number
          category?: Database["public"]["Enums"]["vehicle_category"]
          commission_rate?: number | null
          country?: string
          created_at?: string
          id?: string
          min_fare_xof?: number
          per_km_xof?: number
          per_min_xof?: number
          program_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "country_pricing_overrides_program_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "country_market_config"
            referencedColumns: ["program_id"]
          },
          {
            foreignKeyName: "country_pricing_overrides_program_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "market_programs"
            referencedColumns: ["program_id"]
          },
        ]
      }
      driver_profiles: {
        Row: {
          assigned_category: string | null
          availability_notes: string | null
          city: string | null
          created_at: string
          current_lat: number | null
          current_lng: number | null
          enrollment_notes: string | null
          enrollment_submitted_at: string | null
          fuel_type: Database["public"]["Enums"]["fuel_type"] | null
          id_document_url: string | null
          insurance_document_url: string | null
          insurance_expires_at: string | null
          is_online: boolean
          license_document_url: string | null
          license_expires_at: string | null
          license_number: string | null
          partner_type: string
          physical_verified_at: string | null
          physical_verified_by: string | null
          preferred_zones: string[] | null
          program_id: string | null
          rating_avg: number | null
          rejection_reason: string | null
          rides_count: number
          status: Database["public"]["Enums"]["driver_status"]
          status_updated_at: string | null
          status_updated_by: string | null
          total_earnings: number
          updated_at: string
          user_id: string
          vehicle_color: string | null
          vehicle_condition_url: string | null
          vehicle_doc_expires_at: string | null
          vehicle_document_url: string | null
          vehicle_model: string | null
          vehicle_plate: string | null
          vehicle_type: string | null
        }
        Insert: {
          assigned_category?: string | null
          availability_notes?: string | null
          city?: string | null
          created_at?: string
          current_lat?: number | null
          current_lng?: number | null
          enrollment_notes?: string | null
          enrollment_submitted_at?: string | null
          fuel_type?: Database["public"]["Enums"]["fuel_type"] | null
          id_document_url?: string | null
          insurance_document_url?: string | null
          insurance_expires_at?: string | null
          is_online?: boolean
          license_document_url?: string | null
          license_expires_at?: string | null
          license_number?: string | null
          partner_type?: string
          physical_verified_at?: string | null
          physical_verified_by?: string | null
          preferred_zones?: string[] | null
          program_id?: string | null
          rating_avg?: number | null
          rejection_reason?: string | null
          rides_count?: number
          status?: Database["public"]["Enums"]["driver_status"]
          status_updated_at?: string | null
          status_updated_by?: string | null
          total_earnings?: number
          updated_at?: string
          user_id: string
          vehicle_color?: string | null
          vehicle_condition_url?: string | null
          vehicle_doc_expires_at?: string | null
          vehicle_document_url?: string | null
          vehicle_model?: string | null
          vehicle_plate?: string | null
          vehicle_type?: string | null
        }
        Update: {
          assigned_category?: string | null
          availability_notes?: string | null
          city?: string | null
          created_at?: string
          current_lat?: number | null
          current_lng?: number | null
          enrollment_notes?: string | null
          enrollment_submitted_at?: string | null
          fuel_type?: Database["public"]["Enums"]["fuel_type"] | null
          id_document_url?: string | null
          insurance_document_url?: string | null
          insurance_expires_at?: string | null
          is_online?: boolean
          license_document_url?: string | null
          license_expires_at?: string | null
          license_number?: string | null
          partner_type?: string
          physical_verified_at?: string | null
          physical_verified_by?: string | null
          preferred_zones?: string[] | null
          program_id?: string | null
          rating_avg?: number | null
          rejection_reason?: string | null
          rides_count?: number
          status?: Database["public"]["Enums"]["driver_status"]
          status_updated_at?: string | null
          status_updated_by?: string | null
          total_earnings?: number
          updated_at?: string
          user_id?: string
          vehicle_color?: string | null
          vehicle_condition_url?: string | null
          vehicle_doc_expires_at?: string | null
          vehicle_document_url?: string | null
          vehicle_model?: string | null
          vehicle_plate?: string | null
          vehicle_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_profiles_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "country_market_config"
            referencedColumns: ["program_id"]
          },
          {
            foreignKeyName: "driver_profiles_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "market_programs"
            referencedColumns: ["program_id"]
          },
        ]
      }
      driver_wallets: {
        Row: {
          balance_xof: number
          updated_at: string
          user_id: string
        }
        Insert: {
          balance_xof?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          balance_xof?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      fraud_logs: {
        Row: {
          created_at: string
          details: Json
          id: string
          kind: string
          reference: string | null
          ride_id: string | null
          severity: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          details?: Json
          id?: string
          kind: string
          reference?: string | null
          ride_id?: string | null
          severity?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          details?: Json
          id?: string
          kind?: string
          reference?: string | null
          ride_id?: string | null
          severity?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fraud_logs_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      governance_proposals: {
        Row: {
          applied_at: string | null
          country: string
          created_at: string
          description: string | null
          effective_at: string | null
          id: string
          notice_starts_at: string | null
          org_id: string | null
          payload: Json
          program_id: string | null
          proposal_type: Database["public"]["Enums"]["governance_proposal_type"]
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["governance_proposal_status"]
          submitted_by: string | null
          title: string
          updated_at: string
        }
        Insert: {
          applied_at?: string | null
          country: string
          created_at?: string
          description?: string | null
          effective_at?: string | null
          id?: string
          notice_starts_at?: string | null
          org_id?: string | null
          payload?: Json
          program_id?: string | null
          proposal_type: Database["public"]["Enums"]["governance_proposal_type"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["governance_proposal_status"]
          submitted_by?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          applied_at?: string | null
          country?: string
          created_at?: string
          description?: string | null
          effective_at?: string | null
          id?: string
          notice_starts_at?: string | null
          org_id?: string | null
          payload?: Json
          program_id?: string | null
          proposal_type?: Database["public"]["Enums"]["governance_proposal_type"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["governance_proposal_status"]
          submitted_by?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "governance_proposals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "stakeholder_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_proposals_program_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "country_market_config"
            referencedColumns: ["program_id"]
          },
          {
            foreignKeyName: "governance_proposals_program_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "market_programs"
            referencedColumns: ["program_id"]
          },
        ]
      }
      governance_votes: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          proposal_id: string
          vote: boolean
          voter_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          proposal_id: string
          vote: boolean
          voter_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          proposal_id?: string
          vote?: boolean
          voter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "governance_votes_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "governance_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          created_at: string
          description: string
          id: string
          invoice_id: string
          quantity: number
          ride_id: string | null
          total_xof: number
          unit_price_xof: number
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          quantity?: number
          ride_id?: string | null
          total_xof?: number
          unit_price_xof?: number
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          quantity?: number
          ride_id?: string | null
          total_xof?: number
          unit_price_xof?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_payments: {
        Row: {
          amount_xof: number
          created_at: string
          id: string
          invoice_id: string
          method: Database["public"]["Enums"]["payment_method_type"]
          notes: string | null
          paid_on: string
          recorded_by: string | null
          reference: string | null
        }
        Insert: {
          amount_xof: number
          created_at?: string
          id?: string
          invoice_id: string
          method: Database["public"]["Enums"]["payment_method_type"]
          notes?: string | null
          paid_on?: string
          recorded_by?: string | null
          reference?: string | null
        }
        Update: {
          amount_xof?: number
          created_at?: string
          id?: string
          invoice_id?: string
          method?: Database["public"]["Enums"]["payment_method_type"]
          notes?: string | null
          paid_on?: string
          recorded_by?: string | null
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          cancelled_at: string | null
          corporate_id: string
          created_at: string
          created_by: string | null
          due_date: string | null
          id: string
          issued_at: string | null
          notes: string | null
          number: string | null
          paid_at: string | null
          paid_xof: number
          period_end: string | null
          period_start: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal_xof: number
          total_xof: number
          updated_at: string
          vat_rate: number
          vat_xof: number
        }
        Insert: {
          cancelled_at?: string | null
          corporate_id: string
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          issued_at?: string | null
          notes?: string | null
          number?: string | null
          paid_at?: string | null
          paid_xof?: number
          period_end?: string | null
          period_start?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal_xof?: number
          total_xof?: number
          updated_at?: string
          vat_rate?: number
          vat_xof?: number
        }
        Update: {
          cancelled_at?: string | null
          corporate_id?: string
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          issued_at?: string | null
          notes?: string | null
          number?: string | null
          paid_at?: string | null
          paid_xof?: number
          period_end?: string | null
          period_start?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal_xof?: number
          total_xof?: number
          updated_at?: string
          vat_rate?: number
          vat_xof?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoices_corporate_id_fkey"
            columns: ["corporate_id"]
            isOneToOne: false
            referencedRelation: "corporate_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      market_programs: {
        Row: {
          auth_email: boolean
          auth_phone_otp: boolean
          branding: Json
          commission_default: number
          commission_locked: boolean
          country: string
          created_at: string
          currency: string
          default_language: string
          dispatch_mode: string
          dispatch_offer_seconds: number
          display_name: string
          features: Json
          governance_min_notice_days: number
          is_active: boolean
          is_default: boolean
          notes: string | null
          program_code: Database["public"]["Enums"]["market_program"]
          program_id: string
          stakeholder_org_id: string | null
          supported_languages: string[]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          auth_email?: boolean
          auth_phone_otp?: boolean
          branding?: Json
          commission_default?: number
          commission_locked?: boolean
          country: string
          created_at?: string
          currency?: string
          default_language?: string
          dispatch_mode?: string
          dispatch_offer_seconds?: number
          display_name: string
          features?: Json
          governance_min_notice_days?: number
          is_active?: boolean
          is_default?: boolean
          notes?: string | null
          program_code?: Database["public"]["Enums"]["market_program"]
          program_id: string
          stakeholder_org_id?: string | null
          supported_languages?: string[]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          auth_email?: boolean
          auth_phone_otp?: boolean
          branding?: Json
          commission_default?: number
          commission_locked?: boolean
          country?: string
          created_at?: string
          currency?: string
          default_language?: string
          dispatch_mode?: string
          dispatch_offer_seconds?: number
          display_name?: string
          features?: Json
          governance_min_notice_days?: number
          is_active?: boolean
          is_default?: boolean
          notes?: string | null
          program_code?: Database["public"]["Enums"]["market_program"]
          program_id?: string
          stakeholder_org_id?: string | null
          supported_languages?: string[]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "country_market_config_stakeholder_fk"
            columns: ["stakeholder_org_id"]
            isOneToOne: false
            referencedRelation: "stakeholder_organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_zones: {
        Row: {
          center_lat: number
          center_lng: number
          created_at: string
          driver_id: string
          id: string
          is_active: boolean
          radius_km: number
          updated_at: string
        }
        Insert: {
          center_lat: number
          center_lng: number
          created_at?: string
          driver_id: string
          id?: string
          is_active?: boolean
          radius_km?: number
          updated_at?: string
        }
        Update: {
          center_lat?: number
          center_lng?: number
          created_at?: string
          driver_id?: string
          id?: string
          is_active?: boolean
          radius_km?: number
          updated_at?: string
        }
        Relationships: []
      }
      ride_offers: {
        Row: {
          created_at: string
          distance_km: number | null
          driver_id: string
          expires_at: string
          id: string
          offered_at: string
          responded_at: string | null
          ride_id: string
          sequence_no: number
          status: string
        }
        Insert: {
          created_at?: string
          distance_km?: number | null
          driver_id: string
          expires_at: string
          id?: string
          offered_at?: string
          responded_at?: string | null
          ride_id: string
          sequence_no?: number
          status?: string
        }
        Update: {
          created_at?: string
          distance_km?: number | null
          driver_id?: string
          expires_at?: string
          id?: string
          offered_at?: string
          responded_at?: string | null
          ride_id?: string
          sequence_no?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ride_offers_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_prefs: {
        Row: {
          channel_system: boolean
          channel_toast: boolean
          notify_driver_arriving: boolean
          notify_driver_nearby: boolean
          notify_new_ride: boolean
          notify_status_change: boolean
          sound_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          channel_system?: boolean
          channel_toast?: boolean
          notify_driver_arriving?: boolean
          notify_driver_nearby?: boolean
          notify_new_ride?: boolean
          notify_status_change?: boolean
          sound_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          channel_system?: boolean
          channel_toast?: boolean
          notify_driver_arriving?: boolean
          notify_driver_nearby?: boolean
          notify_new_ride?: boolean
          notify_status_change?: boolean
          sound_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      passenger_wallet_transactions: {
        Row: {
          amount_pts: number
          balance_after_pts: number
          created_at: string
          id: string
          notes: string | null
          reference: string | null
          ride_id: string | null
          type: Database["public"]["Enums"]["passenger_wallet_tx_type"]
          user_id: string
        }
        Insert: {
          amount_pts: number
          balance_after_pts: number
          created_at?: string
          id?: string
          notes?: string | null
          reference?: string | null
          ride_id?: string | null
          type: Database["public"]["Enums"]["passenger_wallet_tx_type"]
          user_id: string
        }
        Update: {
          amount_pts?: number
          balance_after_pts?: number
          created_at?: string
          id?: string
          notes?: string | null
          reference?: string | null
          ride_id?: string | null
          type?: Database["public"]["Enums"]["passenger_wallet_tx_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "passenger_wallet_transactions_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      passenger_wallets: {
        Row: {
          balance_pts: number
          updated_at: string
          user_id: string
        }
        Insert: {
          balance_pts?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          balance_pts?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount_xof: number
          created_at: string
          id: string
          method: Database["public"]["Enums"]["payment_method"]
          provider: string | null
          provider_ref: string | null
          ride_id: string
          status: Database["public"]["Enums"]["payment_status"]
        }
        Insert: {
          amount_xof: number
          created_at?: string
          id?: string
          method: Database["public"]["Enums"]["payment_method"]
          provider?: string | null
          provider_ref?: string | null
          ride_id: string
          status?: Database["public"]["Enums"]["payment_status"]
        }
        Update: {
          amount_xof?: number
          created_at?: string
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          provider?: string | null
          provider_ref?: string | null
          ride_id?: string
          status?: Database["public"]["Enums"]["payment_status"]
        }
        Relationships: [
          {
            foreignKeyName: "payments_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      dynamic_pricing_settings: {
        Row: {
          active: boolean
          created_at: string
          id: string
          notes: string | null
          program_id: string | null
          rounding_increment_xof: number
          traffic_coefficient: number
          traffic_ratio_cap: number
          updated_at: string
          updated_by: string | null
          weather_cloudy_multiplier: number
          weather_rainy_multiplier: number
          weather_sunny_multiplier: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          notes?: string | null
          program_id?: string | null
          rounding_increment_xof?: number
          traffic_coefficient?: number
          traffic_ratio_cap?: number
          updated_at?: string
          updated_by?: string | null
          weather_cloudy_multiplier?: number
          weather_rainy_multiplier?: number
          weather_sunny_multiplier?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          notes?: string | null
          program_id?: string | null
          rounding_increment_xof?: number
          traffic_coefficient?: number
          traffic_ratio_cap?: number
          updated_at?: string
          updated_by?: string | null
          weather_cloudy_multiplier?: number
          weather_rainy_multiplier?: number
          weather_sunny_multiplier?: number
        }
        Relationships: [
          {
            foreignKeyName: "dynamic_pricing_settings_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "market_programs"
            referencedColumns: ["program_id"]
          },
        ]
      }
      pricing_settings: {
        Row: {
          active: boolean
          base_fare_xof: number
          category: Database["public"]["Enums"]["vehicle_category"]
          commission_flat_xof: number
          commission_rate: number
          commission_type: Database["public"]["Enums"]["commission_kind"]
          created_at: string
          id: string
          min_fare_xof: number
          per_km_xof: number
          per_min_xof: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          base_fare_xof?: number
          category: Database["public"]["Enums"]["vehicle_category"]
          commission_flat_xof?: number
          commission_rate?: number
          commission_type?: Database["public"]["Enums"]["commission_kind"]
          created_at?: string
          id?: string
          min_fare_xof?: number
          per_km_xof?: number
          per_min_xof?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          base_fare_xof?: number
          category?: Database["public"]["Enums"]["vehicle_category"]
          commission_flat_xof?: number
          commission_rate?: number
          commission_type?: Database["public"]["Enums"]["commission_kind"]
          created_at?: string
          id?: string
          min_fare_xof?: number
          per_km_xof?: number
          per_min_xof?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          city: string | null
          country: string | null
          created_at: string
          full_name: string | null
          id: string
          language: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          language?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          language?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      published_kpi_reports: {
        Row: {
          country: string
          created_at: string
          document_url: string | null
          id: string
          is_public: boolean
          metrics: Json
          period_end: string
          period_label: string
          period_start: string
          program_id: string | null
          published_at: string
          published_by: string | null
        }
        Insert: {
          country: string
          created_at?: string
          document_url?: string | null
          id?: string
          is_public?: boolean
          metrics?: Json
          period_end: string
          period_label: string
          period_start: string
          program_id?: string | null
          published_at?: string
          published_by?: string | null
        }
        Update: {
          country?: string
          created_at?: string
          document_url?: string | null
          id?: string
          is_public?: boolean
          metrics?: Json
          period_end?: string
          period_label?: string
          period_start?: string
          program_id?: string | null
          published_at?: string
          published_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "published_kpi_reports_program_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "country_market_config"
            referencedColumns: ["program_id"]
          },
          {
            foreignKeyName: "published_kpi_reports_program_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "market_programs"
            referencedColumns: ["program_id"]
          },
        ]
      }
      ratings: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          ratee_id: string
          rater_id: string
          ride_id: string
          score: number
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          ratee_id: string
          rater_id: string
          ride_id: string
          score: number
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          ratee_id?: string
          rater_id?: string
          ride_id?: string
          score?: number
        }
        Relationships: [
          {
            foreignKeyName: "ratings_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_codes: {
        Row: {
          code: string
          created_at: string
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      referrals: {
        Row: {
          created_at: string
          id: string
          referee_id: string
          referee_role: Database["public"]["Enums"]["app_role"]
          referrer_id: string
          reward_pts: number | null
          reward_xof: number | null
          rewarded_at: string | null
          status: Database["public"]["Enums"]["referral_status"]
          validated_at: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          referee_id: string
          referee_role: Database["public"]["Enums"]["app_role"]
          referrer_id: string
          reward_pts?: number | null
          reward_xof?: number | null
          rewarded_at?: string | null
          status?: Database["public"]["Enums"]["referral_status"]
          validated_at?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          referee_id?: string
          referee_role?: Database["public"]["Enums"]["app_role"]
          referrer_id?: string
          reward_pts?: number | null
          reward_xof?: number | null
          rewarded_at?: string | null
          status?: Database["public"]["Enums"]["referral_status"]
          validated_at?: string | null
        }
        Relationships: []
      }
      reward_settings: {
        Row: {
          driver_referral_bonus_xof: number
          driver_referral_per_ride_xof: number
          driver_share_bonus_xof: number
          driver_share_daily_cap: number
          id: boolean
          passenger_referral_bonus_pts: number
          passenger_ride_earn_pts: number
          point_value_xof: number
          updated_at: string
        }
        Insert: {
          driver_referral_bonus_xof?: number
          driver_referral_per_ride_xof?: number
          driver_share_bonus_xof?: number
          driver_share_daily_cap?: number
          id?: boolean
          passenger_referral_bonus_pts?: number
          passenger_ride_earn_pts?: number
          point_value_xof?: number
          updated_at?: string
        }
        Update: {
          driver_referral_bonus_xof?: number
          driver_referral_per_ride_xof?: number
          driver_share_bonus_xof?: number
          driver_share_daily_cap?: number
          id?: boolean
          passenger_referral_bonus_pts?: number
          passenger_ride_earn_pts?: number
          point_value_xof?: number
          updated_at?: string
        }
        Relationships: []
      }
      ride_payouts: {
        Row: {
          commission_xof: number
          driver_id: string
          error: string | null
          gross_xof: number
          id: string
          net_xof: number
          processed_at: string
          ride_id: string
          status: Database["public"]["Enums"]["ride_payout_status"]
        }
        Insert: {
          commission_xof?: number
          driver_id: string
          error?: string | null
          gross_xof?: number
          id?: string
          net_xof?: number
          processed_at?: string
          ride_id: string
          status?: Database["public"]["Enums"]["ride_payout_status"]
        }
        Update: {
          commission_xof?: number
          driver_id?: string
          error?: string | null
          gross_xof?: number
          id?: string
          net_xof?: number
          processed_at?: string
          ride_id?: string
          status?: Database["public"]["Enums"]["ride_payout_status"]
        }
        Relationships: [
          {
            foreignKeyName: "ride_payouts_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: true
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      ride_tracking_events: {
        Row: {
          actor_id: string | null
          created_at: string
          details: Json | null
          event_type: string
          id: string
          lat: number | null
          lng: number | null
          ride_id: string
          status: Database["public"]["Enums"]["ride_status"] | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          event_type: string
          id?: string
          lat?: number | null
          lng?: number | null
          ride_id: string
          status?: Database["public"]["Enums"]["ride_status"] | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          event_type?: string
          id?: string
          lat?: number | null
          lng?: number | null
          ride_id?: string
          status?: Database["public"]["Enums"]["ride_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "ride_tracking_events_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      rides: {
        Row: {
          accepted_at: string | null
          cancelled_at: string | null
          category: Database["public"]["Enums"]["vehicle_category"]
          city: string
          commission_rate: number | null
          commission_xof: number | null
          completed_at: string | null
          country: string | null
          created_at: string
          currency: string
          delivery_confirmation_code: string | null
          delivery_confirmed_at: string | null
          delivery_insulated_bag: boolean
          delivery_photo_url: string | null
          delivery_urgent: boolean
          delivery_vehicle: string | null
          distance_km: number | null
          driver_earnings_xof: number | null
          driver_id: string | null
          driver_lat: number | null
          driver_lng: number | null
          driver_location_updated_at: string | null
          driver_shares_phone: boolean
          dropoff_address: string
          dropoff_lat: number | null
          dropoff_lng: number | null
          duration_min: number | null
          eta_seconds: number | null
          id: string
          market_program: Database["public"]["Enums"]["market_program"] | null
          notes: string | null
          package_type: string | null
          passenger_id: string
          passenger_phone: string | null
          passenger_shares_phone: boolean
          payment_method: Database["public"]["Enums"]["payment_method"]
          pickup_address: string
          pickup_lat: number | null
          pickup_lng: number | null
          price_xof: number
          program_id: string | null
          requested_at: string
          service_type: string
          started_at: string | null
          status: Database["public"]["Enums"]["ride_status"]
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          cancelled_at?: string | null
          category?: Database["public"]["Enums"]["vehicle_category"]
          city?: string
          commission_rate?: number | null
          commission_xof?: number | null
          completed_at?: string | null
          country?: string | null
          created_at?: string
          currency?: string
          delivery_confirmation_code?: string | null
          delivery_confirmed_at?: string | null
          delivery_insulated_bag?: boolean
          delivery_photo_url?: string | null
          delivery_urgent?: boolean
          delivery_vehicle?: string | null
          distance_km?: number | null
          driver_earnings_xof?: number | null
          driver_id?: string | null
          driver_lat?: number | null
          driver_lng?: number | null
          driver_location_updated_at?: string | null
          driver_shares_phone?: boolean
          dropoff_address: string
          dropoff_lat?: number | null
          dropoff_lng?: number | null
          duration_min?: number | null
          eta_seconds?: number | null
          id?: string
          market_program?: Database["public"]["Enums"]["market_program"] | null
          notes?: string | null
          package_type?: string | null
          passenger_id: string
          passenger_phone?: string | null
          passenger_shares_phone?: boolean
          payment_method?: Database["public"]["Enums"]["payment_method"]
          pickup_address: string
          pickup_lat?: number | null
          pickup_lng?: number | null
          price_xof: number
          program_id?: string | null
          requested_at?: string
          service_type?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["ride_status"]
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          cancelled_at?: string | null
          category?: Database["public"]["Enums"]["vehicle_category"]
          city?: string
          commission_rate?: number | null
          commission_xof?: number | null
          completed_at?: string | null
          country?: string | null
          created_at?: string
          currency?: string
          delivery_confirmation_code?: string | null
          delivery_confirmed_at?: string | null
          delivery_insulated_bag?: boolean
          delivery_photo_url?: string | null
          delivery_urgent?: boolean
          delivery_vehicle?: string | null
          distance_km?: number | null
          driver_earnings_xof?: number | null
          driver_id?: string | null
          driver_lat?: number | null
          driver_lng?: number | null
          driver_location_updated_at?: string | null
          driver_shares_phone?: boolean
          dropoff_address?: string
          dropoff_lat?: number | null
          dropoff_lng?: number | null
          duration_min?: number | null
          eta_seconds?: number | null
          id?: string
          market_program?: Database["public"]["Enums"]["market_program"] | null
          notes?: string | null
          package_type?: string | null
          passenger_id?: string
          passenger_phone?: string | null
          passenger_shares_phone?: boolean
          payment_method?: Database["public"]["Enums"]["payment_method"]
          pickup_address?: string
          pickup_lat?: number | null
          pickup_lng?: number | null
          price_xof?: number
          program_id?: string | null
          requested_at?: string
          service_type?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["ride_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rides_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "country_market_config"
            referencedColumns: ["program_id"]
          },
          {
            foreignKeyName: "rides_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "market_programs"
            referencedColumns: ["program_id"]
          },
        ]
      }
      share_events: {
        Row: {
          channel: string
          created_at: string
          id: string
          reward_xof: number | null
          rewarded: boolean
          user_id: string
        }
        Insert: {
          channel: string
          created_at?: string
          id?: string
          reward_xof?: number | null
          rewarded?: boolean
          user_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          id?: string
          reward_xof?: number | null
          rewarded?: boolean
          user_id?: string
        }
        Relationships: []
      }
      stakeholder_members: {
        Row: {
          can_approve_drivers: boolean
          can_approve_governance: boolean
          can_view_financials: boolean
          created_at: string
          id: string
          is_active: boolean
          org_id: string
          title: string | null
          user_id: string
        }
        Insert: {
          can_approve_drivers?: boolean
          can_approve_governance?: boolean
          can_view_financials?: boolean
          created_at?: string
          id?: string
          is_active?: boolean
          org_id: string
          title?: string | null
          user_id: string
        }
        Update: {
          can_approve_drivers?: boolean
          can_approve_governance?: boolean
          can_view_financials?: boolean
          created_at?: string
          id?: string
          is_active?: boolean
          org_id?: string
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stakeholder_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "stakeholder_organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      stakeholder_organizations: {
        Row: {
          contact_email: string | null
          contact_phone: string | null
          country: string
          created_at: string
          id: string
          is_active: boolean
          legal_name: string | null
          logo_url: string | null
          metadata: Json
          name: string
          program_id: string | null
          role: Database["public"]["Enums"]["stakeholder_role"]
          updated_at: string
        }
        Insert: {
          contact_email?: string | null
          contact_phone?: string | null
          country: string
          created_at?: string
          id?: string
          is_active?: boolean
          legal_name?: string | null
          logo_url?: string | null
          metadata?: Json
          name: string
          program_id?: string | null
          role: Database["public"]["Enums"]["stakeholder_role"]
          updated_at?: string
        }
        Update: {
          contact_email?: string | null
          contact_phone?: string | null
          country?: string
          created_at?: string
          id?: string
          is_active?: boolean
          legal_name?: string | null
          logo_url?: string | null
          metadata?: Json
          name?: string
          program_id?: string | null
          role?: Database["public"]["Enums"]["stakeholder_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stakeholder_organizations_program_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "country_market_config"
            referencedColumns: ["program_id"]
          },
          {
            foreignKeyName: "stakeholder_organizations_program_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "market_programs"
            referencedColumns: ["program_id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          assigned_to: string | null
          category: Database["public"]["Enums"]["ticket_category"]
          closed_at: string | null
          created_at: string
          created_by: string
          id: string
          last_message_at: string
          priority: Database["public"]["Enums"]["ticket_priority"]
          ride_id: string | null
          status: Database["public"]["Enums"]["ticket_status"]
          subject: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          category?: Database["public"]["Enums"]["ticket_category"]
          closed_at?: string | null
          created_at?: string
          created_by: string
          id?: string
          last_message_at?: string
          priority?: Database["public"]["Enums"]["ticket_priority"]
          ride_id?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          subject: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          category?: Database["public"]["Enums"]["ticket_category"]
          closed_at?: string | null
          created_at?: string
          created_by?: string
          id?: string
          last_message_at?: string
          priority?: Database["public"]["Enums"]["ticket_priority"]
          ride_id?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_messages: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          is_internal: boolean
          ticket_id: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          is_internal?: boolean
          ticket_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          is_internal?: boolean
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      topup_orders: {
        Row: {
          amount_xof: number
          created_at: string
          id: string
          paid_at: string | null
          payload: Json | null
          provider: string
          provider_reference: string | null
          status: Database["public"]["Enums"]["topup_status"]
          user_id: string
        }
        Insert: {
          amount_xof: number
          created_at?: string
          id?: string
          paid_at?: string | null
          payload?: Json | null
          provider: string
          provider_reference?: string | null
          status?: Database["public"]["Enums"]["topup_status"]
          user_id: string
        }
        Update: {
          amount_xof?: number
          created_at?: string
          id?: string
          paid_at?: string | null
          payload?: Json | null
          provider?: string
          provider_reference?: string | null
          status?: Database["public"]["Enums"]["topup_status"]
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vehicles: {
        Row: {
          brand: string | null
          category: Database["public"]["Enums"]["vehicle_category"]
          color: string | null
          created_at: string
          driver_id: string
          id: string
          model: string | null
          plate: string
          year: number | null
        }
        Insert: {
          brand?: string | null
          category: Database["public"]["Enums"]["vehicle_category"]
          color?: string | null
          created_at?: string
          driver_id: string
          id?: string
          model?: string | null
          plate: string
          year?: number | null
        }
        Update: {
          brand?: string | null
          category?: Database["public"]["Enums"]["vehicle_category"]
          color?: string | null
          created_at?: string
          driver_id?: string
          id?: string
          model?: string | null
          plate?: string
          year?: number | null
        }
        Relationships: []
      }
      wallet_transactions: {
        Row: {
          amount_xof: number
          balance_after_xof: number
          created_at: string
          created_by: string | null
          driver_id: string
          id: string
          notes: string | null
          reference: string | null
          ride_id: string | null
          type: Database["public"]["Enums"]["wallet_tx_type"]
        }
        Insert: {
          amount_xof: number
          balance_after_xof: number
          created_at?: string
          created_by?: string | null
          driver_id: string
          id?: string
          notes?: string | null
          reference?: string | null
          ride_id?: string | null
          type: Database["public"]["Enums"]["wallet_tx_type"]
        }
        Update: {
          amount_xof?: number
          balance_after_xof?: number
          created_at?: string
          created_by?: string | null
          driver_id?: string
          id?: string
          notes?: string | null
          reference?: string | null
          ride_id?: string | null
          type?: Database["public"]["Enums"]["wallet_tx_type"]
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      country_market_config: {
        Row: {
          auth_email: boolean | null
          auth_phone_otp: boolean | null
          branding: Json | null
          commission_default: number | null
          commission_locked: boolean | null
          country: string | null
          created_at: string | null
          currency: string | null
          default_language: string | null
          dispatch_mode: string | null
          display_name: string | null
          features: Json | null
          governance_min_notice_days: number | null
          is_active: boolean | null
          notes: string | null
          program_code: Database["public"]["Enums"]["market_program"] | null
          program_id: string | null
          stakeholder_org_id: string | null
          supported_languages: string[] | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          auth_email?: boolean | null
          auth_phone_otp?: boolean | null
          branding?: Json | null
          commission_default?: number | null
          commission_locked?: boolean | null
          country?: string | null
          created_at?: string | null
          currency?: string | null
          default_language?: string | null
          dispatch_mode?: string | null
          display_name?: string | null
          features?: Json | null
          governance_min_notice_days?: number | null
          is_active?: boolean | null
          notes?: string | null
          program_code?: Database["public"]["Enums"]["market_program"] | null
          program_id?: string | null
          stakeholder_org_id?: string | null
          supported_languages?: string[] | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          auth_email?: boolean | null
          auth_phone_otp?: boolean | null
          branding?: Json | null
          commission_default?: number | null
          commission_locked?: boolean | null
          country?: string | null
          created_at?: string | null
          currency?: string | null
          default_language?: string | null
          dispatch_mode?: string | null
          display_name?: string | null
          features?: Json | null
          governance_min_notice_days?: number | null
          is_active?: boolean | null
          notes?: string | null
          program_code?: Database["public"]["Enums"]["market_program"] | null
          program_id?: string | null
          stakeholder_org_id?: string | null
          supported_languages?: string[] | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "country_market_config_stakeholder_fk"
            columns: ["stakeholder_org_id"]
            isOneToOne: false
            referencedRelation: "stakeholder_organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_country: { Args: { _uid: string }; Returns: string }
      apply_passenger_wallet_tx: {
        Args: {
          _amount_pts: number
          _notes?: string
          _reference?: string
          _ride_id?: string
          _type: Database["public"]["Enums"]["passenger_wallet_tx_type"]
          _user_id: string
        }
        Returns: number
      }
      apply_wallet_transaction: {
        Args: {
          _actor?: string
          _amount_xof: number
          _driver_id: string
          _notes?: string
          _reference?: string
          _ride_id?: string
          _type: Database["public"]["Enums"]["wallet_tx_type"]
        }
        Returns: number
      }
      claim_driver_share_reward: { Args: { _channel: string }; Returns: Json }
      confirm_topup: {
        Args: { _provider_ref?: string; _topup_id: string }
        Returns: Json
      }
      country_slug: { Args: { _country: string }; Returns: string }
      get_country_market_config: {
        Args: { _country: string }
        Returns: {
          auth_email: boolean | null
          auth_phone_otp: boolean | null
          branding: Json | null
          commission_default: number | null
          commission_locked: boolean | null
          country: string | null
          created_at: string | null
          currency: string | null
          default_language: string | null
          dispatch_mode: string | null
          display_name: string | null
          features: Json | null
          governance_min_notice_days: number | null
          is_active: boolean | null
          notes: string | null
          program_code: Database["public"]["Enums"]["market_program"] | null
          program_id: string | null
          stakeholder_org_id: string | null
          supported_languages: string[] | null
          updated_at: string | null
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "country_market_config"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_default_market_program: {
        Args: { _country: string }
        Returns: {
          auth_email: boolean
          auth_phone_otp: boolean
          branding: Json
          commission_default: number
          commission_locked: boolean
          country: string
          created_at: string
          currency: string
          default_language: string
          dispatch_mode: string
          display_name: string
          features: Json
          governance_min_notice_days: number
          is_active: boolean
          is_default: boolean
          notes: string | null
          program_code: Database["public"]["Enums"]["market_program"]
          program_id: string
          stakeholder_org_id: string | null
          supported_languages: string[]
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "market_programs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_market_program: {
        Args: { _program_id: string }
        Returns: {
          auth_email: boolean
          auth_phone_otp: boolean
          branding: Json
          commission_default: number
          commission_locked: boolean
          country: string
          created_at: string
          currency: string
          default_language: string
          dispatch_mode: string
          display_name: string
          features: Json
          governance_min_notice_days: number
          is_active: boolean
          is_default: boolean
          notes: string | null
          program_code: Database["public"]["Enums"]["market_program"]
          program_id: string
          stakeholder_org_id: string | null
          supported_languages: string[]
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "market_programs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_or_create_referral_code: {
        Args: { _user_id: string }
        Returns: string
      }
      get_ride_driver_public: {
        Args: { _ride_id: string }
        Returns: {
          avatar_url: string
          full_name: string
          phone: string
          rating_avg: number
          vehicle_color: string
          vehicle_model: string
          vehicle_plate: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_superadmin: { Args: { _uid: string }; Returns: boolean }
      list_market_programs: {
        Args: { _country: string }
        Returns: {
          auth_email: boolean
          auth_phone_otp: boolean
          branding: Json
          commission_default: number
          commission_locked: boolean
          country: string
          created_at: string
          currency: string
          default_language: string
          dispatch_mode: string
          display_name: string
          features: Json
          governance_min_notice_days: number
          is_active: boolean
          is_default: boolean
          notes: string | null
          program_code: Database["public"]["Enums"]["market_program"]
          program_id: string
          stakeholder_org_id: string | null
          supported_languages: string[]
          updated_at: string
          updated_by: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "market_programs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      set_default_market_program: {
        Args: { _country: string; _program_id: string }
        Returns: {
          auth_email: boolean
          auth_phone_otp: boolean
          branding: Json
          commission_default: number
          commission_locked: boolean
          country: string
          created_at: string
          currency: string
          default_language: string
          dispatch_mode: string
          dispatch_offer_seconds: number
          display_name: string
          features: Json
          governance_min_notice_days: number
          is_active: boolean
          is_default: boolean
          notes: string | null
          program_code: Database["public"]["Enums"]["market_program"]
          program_id: string
          stakeholder_org_id: string | null
          supported_languages: string[]
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "market_programs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      accept_ride_offer: {
        Args: { _ride_id: string }
        Returns: {
          accepted_at: string | null
          cancelled_at: string | null
          category: Database["public"]["Enums"]["vehicle_category"]
          city: string
          commission_rate: number | null
          commission_xof: number | null
          completed_at: string | null
          country: string | null
          created_at: string
          currency: string
          delivery_confirmation_code: string | null
          delivery_confirmed_at: string | null
          delivery_insulated_bag: boolean
          delivery_photo_url: string | null
          delivery_urgent: boolean
          delivery_vehicle: string | null
          distance_km: number | null
          driver_earnings_xof: number | null
          driver_id: string | null
          driver_lat: number | null
          driver_lng: number | null
          driver_location_updated_at: string | null
          driver_shares_phone: boolean
          dropoff_address: string
          dropoff_lat: number | null
          dropoff_lng: number | null
          duration_min: number | null
          eta_seconds: number | null
          id: string
          market_program: Database["public"]["Enums"]["market_program"] | null
          notes: string | null
          package_type: string | null
          passenger_id: string
          passenger_phone: string | null
          passenger_shares_phone: boolean
          payment_method: Database["public"]["Enums"]["payment_method"]
          pickup_address: string
          pickup_lat: number | null
          pickup_lng: number | null
          price_xof: number
          program_id: string | null
          requested_at: string
          service_type: string
          started_at: string | null
          status: Database["public"]["Enums"]["ride_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "rides"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      decline_ride_offer: {
        Args: { _ride_id: string }
        Returns: undefined
      }
      dispatch_offer_next: {
        Args: { _ride_id: string }
        Returns: string
      }
      haversine_km: {
        Args: { lat1: number; lng1: number; lat2: number; lng2: number }
        Returns: number
      }
      expire_ride_offers: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      redeem_points_for_ride: {
        Args: { _pts: number; _ride_id: string }
        Returns: Json
      }
      register_referral: { Args: { _code: string }; Returns: Json }
      resolve_commission: {
        Args: {
          _at: string
          _category: Database["public"]["Enums"]["vehicle_category"]
        }
        Returns: {
          commission_flat_xof: number
          commission_rate: number
          commission_type: Database["public"]["Enums"]["commission_kind"]
        }[]
      }
      resolve_country_commission: {
        Args: {
          _at?: string
          _category: Database["public"]["Enums"]["vehicle_category"]
          _country: string
        }
        Returns: {
          commission_flat_xof: number
          commission_rate: number
          commission_type: Database["public"]["Enums"]["commission_kind"]
        }[]
      }
      resolve_dynamic_pricing_settings: {
        Args: {
          _program_id: string | null
        }
        Returns: {
          active: boolean
          created_at: string
          id: string
          notes: string | null
          program_id: string | null
          rounding_increment_xof: number
          traffic_coefficient: number
          traffic_ratio_cap: number
          updated_at: string
          updated_by: string | null
          weather_cloudy_multiplier: number
          weather_rainy_multiplier: number
          weather_sunny_multiplier: number
        }
      }
      resolve_program_commission: {
        Args: {
          _at?: string
          _category: Database["public"]["Enums"]["vehicle_category"]
          _program_id: string
        }
        Returns: {
          commission_flat_xof: number
          commission_rate: number
          commission_type: Database["public"]["Enums"]["commission_kind"]
        }[]
      }
    }
    Enums: {
      app_role:
        | "passenger"
        | "driver"
        | "admin"
        | "support"
        | "superadmin"
        | "stakeholder"
      commission_kind: "percent" | "flat"
      driver_status:
        | "pending"
        | "under_review"
        | "approved"
        | "rejected"
        | "suspended"
      fuel_type: "thermal" | "electric" | "hybrid"
      governance_proposal_status:
        | "draft"
        | "pending_review"
        | "approved"
        | "rejected"
        | "applied"
        | "cancelled"
      governance_proposal_type:
        | "commission_change"
        | "zone_pricing"
        | "bonus_rule"
        | "feature_toggle"
        | "other"
      invoice_status: "draft" | "issued" | "paid" | "cancelled"
      market_program: "tibus_standard" | "eco_tibus"
      passenger_wallet_tx_type:
        | "topup"
        | "ride_earn"
        | "referral_bonus"
        | "ride_redeem"
        | "adjustment"
        | "refund"
      payment_method: "mobile_money" | "cash" | "card"
      payment_method_type:
        | "bank_transfer"
        | "mobile_money"
        | "cash"
        | "card"
        | "other"
      payment_status: "pending" | "paid" | "failed" | "refunded"
      referral_status: "pending" | "validated" | "rewarded" | "cancelled"
      ride_payout_status: "paid" | "failed" | "skipped"
      ride_status:
        | "requested"
        | "accepted"
        | "arriving"
        | "in_progress"
        | "completed"
        | "cancelled"
      stakeholder_role:
        | "platform"
        | "association"
        | "payment_partner"
        | "insurer"
        | "operator"
      ticket_category:
        | "account"
        | "payment"
        | "ride"
        | "driver"
        | "passenger"
        | "technical"
        | "other"
      ticket_priority: "low" | "normal" | "high" | "urgent"
      ticket_status: "open" | "pending" | "resolved" | "closed"
      topup_status: "pending" | "paid" | "failed" | "cancelled"
      vehicle_category: "taxi" | "eco" | "confort" | "confort_plus" | "vip"
      wallet_tx_type:
        | "topup"
        | "commission"
        | "adjustment"
        | "refund"
        | "reward"
        | "referral"
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
    Enums: {
      app_role: [
        "passenger",
        "driver",
        "admin",
        "support",
        "superadmin",
        "stakeholder",
      ],
      commission_kind: ["percent", "flat"],
      driver_status: [
        "pending",
        "under_review",
        "approved",
        "rejected",
        "suspended",
      ],
      fuel_type: ["thermal", "electric", "hybrid"],
      governance_proposal_status: [
        "draft",
        "pending_review",
        "approved",
        "rejected",
        "applied",
        "cancelled",
      ],
      governance_proposal_type: [
        "commission_change",
        "zone_pricing",
        "bonus_rule",
        "feature_toggle",
        "other",
      ],
      invoice_status: ["draft", "issued", "paid", "cancelled"],
      market_program: ["tibus_standard", "eco_tibus"],
      passenger_wallet_tx_type: [
        "topup",
        "ride_earn",
        "referral_bonus",
        "ride_redeem",
        "adjustment",
        "refund",
      ],
      payment_method: ["mobile_money", "cash", "card"],
      payment_method_type: [
        "bank_transfer",
        "mobile_money",
        "cash",
        "card",
        "other",
      ],
      payment_status: ["pending", "paid", "failed", "refunded"],
      referral_status: ["pending", "validated", "rewarded", "cancelled"],
      ride_payout_status: ["paid", "failed", "skipped"],
      ride_status: [
        "requested",
        "accepted",
        "arriving",
        "in_progress",
        "completed",
        "cancelled",
      ],
      stakeholder_role: [
        "platform",
        "association",
        "payment_partner",
        "insurer",
        "operator",
      ],
      ticket_category: [
        "account",
        "payment",
        "ride",
        "driver",
        "passenger",
        "technical",
        "other",
      ],
      ticket_priority: ["low", "normal", "high", "urgent"],
      ticket_status: ["open", "pending", "resolved", "closed"],
      topup_status: ["pending", "paid", "failed", "cancelled"],
      vehicle_category: ["taxi", "eco", "confort", "confort_plus", "vip"],
      wallet_tx_type: [
        "topup",
        "commission",
        "adjustment",
        "refund",
        "reward",
        "referral",
      ],
    },
  },
} as const
