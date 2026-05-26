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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      admin_users: {
        Row: {
          auth_user_id: string | null
          can_invite_honorary: boolean
          created_at: string
          email: string
          first_name: string
          id: string
          invite_code: string | null
          invite_link_active: boolean
          is_approval_committee: boolean
          is_originator: boolean
          last_name: string
          role: Database["public"]["Enums"]["admin_role"]
          updated_at: string
        }
        Insert: {
          auth_user_id?: string | null
          can_invite_honorary?: boolean
          created_at?: string
          email: string
          first_name: string
          id?: string
          invite_code?: string | null
          invite_link_active?: boolean
          is_approval_committee?: boolean
          is_originator?: boolean
          last_name: string
          role?: Database["public"]["Enums"]["admin_role"]
          updated_at?: string
        }
        Update: {
          auth_user_id?: string | null
          can_invite_honorary?: boolean
          created_at?: string
          email?: string
          first_name?: string
          id?: string
          invite_code?: string | null
          invite_link_active?: boolean
          is_approval_committee?: boolean
          is_originator?: boolean
          last_name?: string
          role?: Database["public"]["Enums"]["admin_role"]
          updated_at?: string
        }
        Relationships: []
      }
      applications: {
        Row: {
          created_at: string
          id: string
          member_id: string
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["member_status"]
        }
        Insert: {
          created_at?: string
          id?: string
          member_id: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["member_status"]
        }
        Update: {
          created_at?: string
          id?: string
          member_id?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["member_status"]
        }
        Relationships: [
          {
            foreignKeyName: "applications_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcast_recipients: {
        Row: {
          broadcast_id: string
          created_at: string
          email: string
          error: string | null
          id: string
          member_id: string | null
          provider_message_id: string | null
          status: string
        }
        Insert: {
          broadcast_id: string
          created_at?: string
          email: string
          error?: string | null
          id?: string
          member_id?: string | null
          provider_message_id?: string | null
          status: string
        }
        Update: {
          broadcast_id?: string
          created_at?: string
          email?: string
          error?: string | null
          id?: string
          member_id?: string | null
          provider_message_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_recipients_broadcast_id_fkey"
            columns: ["broadcast_id"]
            isOneToOne: false
            referencedRelation: "broadcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_recipients_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcasts: {
        Row: {
          audience_filter: Json
          body_html: string
          channel: string
          created_at: string
          created_by: string | null
          error_count: number
          event_id: string | null
          id: string
          idempotency_key: string | null
          kind: string
          recipient_count: number
          sent_at: string | null
          skipped_count: number
          status: string
          subject: string
        }
        Insert: {
          audience_filter: Json
          body_html: string
          channel?: string
          created_at?: string
          created_by?: string | null
          error_count?: number
          event_id?: string | null
          id?: string
          idempotency_key?: string | null
          kind?: string
          recipient_count?: number
          sent_at?: string | null
          skipped_count?: number
          status?: string
          subject: string
        }
        Update: {
          audience_filter?: Json
          body_html?: string
          channel?: string
          created_at?: string
          created_by?: string | null
          error_count?: number
          event_id?: string | null
          id?: string
          idempotency_key?: string | null
          kind?: string
          recipient_count?: number
          sent_at?: string | null
          skipped_count?: number
          status?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "broadcasts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcasts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      cron_job_runs: {
        Row: {
          finished_at: string | null
          id: string
          job_key: string
          result: Json | null
          started_at: string
          status: string
          triggered_by: string
        }
        Insert: {
          finished_at?: string | null
          id?: string
          job_key: string
          result?: Json | null
          started_at?: string
          status: string
          triggered_by: string
        }
        Update: {
          finished_at?: string | null
          id?: string
          job_key?: string
          result?: Json | null
          started_at?: string
          status?: string
          triggered_by?: string
        }
        Relationships: []
      }
      email_settings: {
        Row: {
          enabled: boolean
          id: string
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          enabled?: boolean
          id?: string
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          enabled?: boolean
          id?: string
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "email_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
        ]
      }
      event_checkins: {
        Row: {
          created_at: string
          email: string
          event_id: string
          id: string
          invited_by_member_id: string | null
          invited_by_registration_id: string | null
          inviter_name: string | null
          kind: string
          language: string
          marketing_consent: boolean | null
          member_id: string | null
          name: string
          registration_id: string | null
          waiver_accepted_at: string
          waiver_version: string
        }
        Insert: {
          created_at?: string
          email: string
          event_id: string
          id?: string
          invited_by_member_id?: string | null
          invited_by_registration_id?: string | null
          inviter_name?: string | null
          kind: string
          language: string
          marketing_consent?: boolean | null
          member_id?: string | null
          name: string
          registration_id?: string | null
          waiver_accepted_at?: string
          waiver_version: string
        }
        Update: {
          created_at?: string
          email?: string
          event_id?: string
          id?: string
          invited_by_member_id?: string | null
          invited_by_registration_id?: string | null
          inviter_name?: string | null
          kind?: string
          language?: string
          marketing_consent?: boolean | null
          member_id?: string | null
          name?: string
          registration_id?: string | null
          waiver_accepted_at?: string
          waiver_version?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_checkins_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_checkins_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_checkins_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "event_registrations"
            referencedColumns: ["id"]
          },
        ]
      }
      event_registrations: {
        Row: {
          converted_by: string | null
          created_at: string
          email: string
          event_id: string
          id: string
          is_member: boolean
          member_id: string | null
          name: string
          paid_at: string | null
          quantity: number
          reference_code: string
          status: string
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          total_amount_chf: number
          unit_amount_chf: number
        }
        Insert: {
          converted_by?: string | null
          created_at?: string
          email: string
          event_id: string
          id?: string
          is_member: boolean
          member_id?: string | null
          name: string
          paid_at?: string | null
          quantity: number
          reference_code: string
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          total_amount_chf: number
          unit_amount_chf: number
        }
        Update: {
          converted_by?: string | null
          created_at?: string
          email?: string
          event_id?: string
          id?: string
          is_member?: boolean
          member_id?: string | null
          name?: string
          paid_at?: string | null
          quantity?: number
          reference_code?: string
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          total_amount_chf?: number
          unit_amount_chf?: number
        }
        Relationships: [
          {
            foreignKeyName: "event_registrations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_registrations_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_registrations_converted_by_fkey"
            columns: ["converted_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
        ]
      }
      event_reminder_sends: {
        Row: {
          days_before: number
          event_id: string
          id: string
          registration_id: string
          sent_at: string
          slot: string
        }
        Insert: {
          days_before: number
          event_id: string
          id?: string
          registration_id: string
          sent_at?: string
          slot: string
        }
        Update: {
          days_before?: number
          event_id?: string
          id?: string
          registration_id?: string
          sent_at?: string
          slot?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_reminder_sends_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_reminder_sends_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "event_registrations"
            referencedColumns: ["id"]
          },
        ]
      }
      event_types: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          slug: string
          sort_order: number
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          slug: string
          sort_order?: number
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      event_waitlist: {
        Row: {
          created_at: string
          email: string
          event_id: string
          id: string
          name: string
          quantity: number | null
          ticket_type_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          event_id: string
          id?: string
          name: string
          quantity?: number | null
          ticket_type_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          event_id?: string
          id?: string
          name?: string
          quantity?: number | null
          ticket_type_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_waitlist_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_waitlist_ticket_type_id_fkey"
            columns: ["ticket_type_id"]
            isOneToOne: false
            referencedRelation: "event_ticket_types"
            referencedColumns: ["id"]
          },
        ]
      }
      event_ticket_types: {
        Row: {
          archived_at: string | null
          counts_as_seat: boolean
          created_at: string
          event_id: string
          id: string
          invite_price: number | null
          price_member: number | null
          price_non_member: number | null
          sort_order: number
          title: string
        }
        Insert: {
          archived_at?: string | null
          counts_as_seat?: boolean
          created_at?: string
          event_id: string
          id?: string
          invite_price?: number | null
          price_member?: number | null
          price_non_member?: number | null
          sort_order?: number
          title: string
        }
        Update: {
          archived_at?: string | null
          counts_as_seat?: boolean
          created_at?: string
          event_id?: string
          id?: string
          invite_price?: number | null
          price_member?: number | null
          price_non_member?: number | null
          sort_order?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_ticket_types_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_registration_items: {
        Row: {
          created_at: string
          id: string
          line_total_chf: number
          quantity: number
          registration_id: string
          ticket_type_id: string
          title_snapshot: string
          unit_amount_chf: number
        }
        Insert: {
          created_at?: string
          id?: string
          line_total_chf: number
          quantity: number
          registration_id: string
          ticket_type_id: string
          title_snapshot: string
          unit_amount_chf: number
        }
        Update: {
          created_at?: string
          id?: string
          line_total_chf?: number
          quantity?: number
          registration_id?: string
          ticket_type_id?: string
          title_snapshot?: string
          unit_amount_chf?: number
        }
        Relationships: [
          {
            foreignKeyName: "event_registration_items_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "event_registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_registration_items_ticket_type_id_fkey"
            columns: ["ticket_type_id"]
            isOneToOne: false
            referencedRelation: "event_ticket_types"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string
          description: string | null
          end_date: string | null
          event_type_id: string
          id: string
          image_url: string | null
          image_url_2: string | null
          images: Json
          invite_code: string | null
          is_confirmed: boolean
          is_published: boolean
          location: string | null
          notes: string | null
          registration_enabled: boolean
          reminder_schedule: Json
          season_id: string | null
          seat_cap: number | null
          start_date: string
          start_time: string | null
          strict_checkin: boolean
          title: string
          updated_at: string
          visibility: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          end_date?: string | null
          event_type_id: string
          id?: string
          image_url?: string | null
          image_url_2?: string | null
          images?: Json
          invite_code?: string | null
          is_confirmed?: boolean
          is_published?: boolean
          location?: string | null
          notes?: string | null
          registration_enabled?: boolean
          reminder_schedule?: Json
          season_id?: string | null
          seat_cap?: number | null
          start_date: string
          start_time?: string | null
          strict_checkin?: boolean
          title: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          end_date?: string | null
          event_type_id?: string
          id?: string
          image_url?: string | null
          image_url_2?: string | null
          images?: Json
          invite_code?: string | null
          is_confirmed?: boolean
          is_published?: boolean
          location?: string | null
          notes?: string | null
          registration_enabled?: boolean
          reminder_schedule?: Json
          season_id?: string | null
          seat_cap?: number | null
          start_date?: string
          start_time?: string | null
          strict_checkin?: boolean
          title?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_event_type_id_fkey"
            columns: ["event_type_id"]
            isOneToOne: false
            referencedRelation: "event_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      lounge_sessions: {
        Row: {
          day_of_week: string
          field_number: number
          id: string
          is_open: boolean
          time_slot: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          day_of_week: string
          field_number?: number
          id?: string
          is_open?: boolean
          time_slot: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          day_of_week?: string
          field_number?: number
          id?: string
          is_open?: boolean
          time_slot?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lounge_sessions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          address: string | null
          approved_at: string | null
          approved_by: string | null
          auth_user_id: string | null
          communication_preferences: Json
          company_name: string | null
          company_role: string | null
          consent_given_at: string | null
          consent_ip: string | null
          created_at: string
          declined_reason: string | null
          email: string
          end_date: string | null
          first_name: string
          id: string
          is_migrated: boolean
          last_name: string
          last_reactivation_sent_at: string | null
          last_reminder_sent_at: string | null
          linkedin_url: string | null
          marketing_consent: boolean
          member_number: string | null
          metadata: Json
          originator_id: string | null
          originator_note: string | null
          phone: string | null
          profile_photo_url: string | null
          renewal_reminder_1_sent_at: string | null
          renewal_reminder_2_sent_at: string | null
          renewal_reminder_3_sent_at: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["member_status"]
          stripe_customer_id: string | null
          tier_id: string
          title: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          approved_at?: string | null
          approved_by?: string | null
          auth_user_id?: string | null
          communication_preferences?: Json
          company_name?: string | null
          company_role?: string | null
          consent_given_at?: string | null
          consent_ip?: string | null
          created_at?: string
          declined_reason?: string | null
          email: string
          end_date?: string | null
          first_name: string
          id?: string
          is_migrated?: boolean
          last_name: string
          last_reactivation_sent_at?: string | null
          last_reminder_sent_at?: string | null
          linkedin_url?: string | null
          marketing_consent?: boolean
          member_number?: string | null
          metadata?: Json
          originator_id?: string | null
          originator_note?: string | null
          phone?: string | null
          profile_photo_url?: string | null
          renewal_reminder_1_sent_at?: string | null
          renewal_reminder_2_sent_at?: string | null
          renewal_reminder_3_sent_at?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["member_status"]
          stripe_customer_id?: string | null
          tier_id: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          approved_at?: string | null
          approved_by?: string | null
          auth_user_id?: string | null
          communication_preferences?: Json
          company_name?: string | null
          company_role?: string | null
          consent_given_at?: string | null
          consent_ip?: string | null
          created_at?: string
          declined_reason?: string | null
          email?: string
          end_date?: string | null
          first_name?: string
          id?: string
          is_migrated?: boolean
          last_name?: string
          last_reactivation_sent_at?: string | null
          last_reminder_sent_at?: string | null
          linkedin_url?: string | null
          marketing_consent?: boolean
          member_number?: string | null
          metadata?: Json
          originator_id?: string | null
          originator_note?: string | null
          phone?: string | null
          profile_photo_url?: string | null
          renewal_reminder_1_sent_at?: string | null
          renewal_reminder_2_sent_at?: string | null
          renewal_reminder_3_sent_at?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["member_status"]
          stripe_customer_id?: string | null
          tier_id?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "members_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_originator_id_fkey"
            columns: ["originator_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "membership_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_cards: {
        Row: {
          card_number: string
          created_at: string
          id: string
          is_active: boolean
          member_id: string
          qr_code_data: string
          tier_id: string
          valid_from: string
          valid_until: string
        }
        Insert: {
          card_number: string
          created_at?: string
          id?: string
          is_active?: boolean
          member_id: string
          qr_code_data: string
          tier_id: string
          valid_from: string
          valid_until: string
        }
        Update: {
          card_number?: string
          created_at?: string
          id?: string
          is_active?: boolean
          member_id?: string
          qr_code_data?: string
          tier_id?: string
          valid_from?: string
          valid_until?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_cards_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_cards_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "membership_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_tiers: {
        Row: {
          benefits: Json
          category: Database["public"]["Enums"]["membership_category"]
          company_size_label: string | null
          created_at: string
          currency: string
          guest_invitations_per_season: number
          id: string
          is_active: boolean
          name: string
          price_eur: number
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          benefits?: Json
          category: Database["public"]["Enums"]["membership_category"]
          company_size_label?: string | null
          created_at?: string
          currency?: string
          guest_invitations_per_season?: number
          id?: string
          is_active?: boolean
          name: string
          price_eur: number
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          benefits?: Json
          category?: Database["public"]["Enums"]["membership_category"]
          company_size_label?: string | null
          created_at?: string
          currency?: string
          guest_invitations_per_season?: number
          id?: string
          is_active?: boolean
          name?: string
          price_eur?: number
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      payment_retry_tokens: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          member_id: string
          payment_id: string
          token: string
          used: boolean
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          member_id: string
          payment_id: string
          token: string
          used?: boolean
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          member_id?: string
          payment_id?: string
          token?: string
          used?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "payment_retry_tokens_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_retry_tokens_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_eur: number
          authorized_at: string | null
          capture_before: string | null
          created_at: string
          currency: string
          id: string
          member_id: string
          notes: string | null
          paid_at: string | null
          payment_capture_status:
            | Database["public"]["Enums"]["payment_capture_status"]
            | null
          payment_failed_at: string | null
          payment_method: string | null
          payment_retry_deadline: string | null
          payment_status: Database["public"]["Enums"]["payment_status"]
          reminder_day1_sent: boolean
          reminder_day3_sent: boolean
          reminder_day4_sent: boolean
          season: string | null
          stripe_checkout_session_id: string | null
          stripe_invoice_id: string | null
          stripe_payment_intent_id: string | null
          stripe_payment_method_id: string | null
          tier_id: string
          updated_at: string
        }
        Insert: {
          amount_eur: number
          authorized_at?: string | null
          capture_before?: string | null
          created_at?: string
          currency?: string
          id?: string
          member_id: string
          notes?: string | null
          paid_at?: string | null
          payment_capture_status?:
            | Database["public"]["Enums"]["payment_capture_status"]
            | null
          payment_failed_at?: string | null
          payment_method?: string | null
          payment_retry_deadline?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          reminder_day1_sent?: boolean
          reminder_day3_sent?: boolean
          reminder_day4_sent?: boolean
          season?: string | null
          stripe_checkout_session_id?: string | null
          stripe_invoice_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_payment_method_id?: string | null
          tier_id: string
          updated_at?: string
        }
        Update: {
          amount_eur?: number
          authorized_at?: string | null
          capture_before?: string | null
          created_at?: string
          currency?: string
          id?: string
          member_id?: string
          notes?: string | null
          paid_at?: string | null
          payment_capture_status?:
            | Database["public"]["Enums"]["payment_capture_status"]
            | null
          payment_failed_at?: string | null
          payment_method?: string | null
          payment_retry_deadline?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          reminder_day1_sent?: boolean
          reminder_day3_sent?: boolean
          reminder_day4_sent?: boolean
          season?: string | null
          stripe_checkout_session_id?: string | null
          stripe_invoice_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_payment_method_id?: string | null
          tier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "membership_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          converted_at: string | null
          created_at: string
          id: string
          invite_code_used: string | null
          member_id: string
          originator_id: string
          status: string
        }
        Insert: {
          converted_at?: string | null
          created_at?: string
          id?: string
          invite_code_used?: string | null
          member_id: string
          originator_id: string
          status?: string
        }
        Update: {
          converted_at?: string | null
          created_at?: string
          id?: string
          invite_code_used?: string | null
          member_id?: string
          originator_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "referrals_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_originator_id_fkey"
            columns: ["originator_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
        ]
      }
      renewal_tokens: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          member_id: string
          originator_id: string
          token: string
          used: boolean
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          member_id: string
          originator_id: string
          token: string
          used?: boolean
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          member_id?: string
          originator_id?: string
          token?: string
          used?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "renewal_tokens_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "renewal_tokens_originator_id_fkey"
            columns: ["originator_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
        ]
      }
      seasons: {
        Row: {
          created_at: string
          end_date: string
          id: string
          is_current: boolean
          name: string
          renewal_open_date: string | null
          slug: string
          start_date: string
        }
        Insert: {
          created_at?: string
          end_date: string
          id?: string
          is_current?: boolean
          name: string
          renewal_open_date?: string | null
          slug: string
          start_date: string
        }
        Update: {
          created_at?: string
          end_date?: string
          id?: string
          is_current?: boolean
          name?: string
          renewal_open_date?: string | null
          slug?: string
          start_date?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      seats_used: { Args: { eid: string }; Returns: number }
      seats_used_by_events: {
        Args: { ids: string[] }
        Returns: {
          event_id: string
          seats_used: number
        }[]
      }
      // HAND-AUTHORED nullable RPC args (re-apply after every `supabase gen
      // types` — the generator types these non-null, which breaks the
      // anonymous-registration / not-converted call sites that pass null).
      // Same re-append discipline as the manual aliases at the file end.
      create_event_registration: {
        Args: {
          p_event_id: string
          p_name: string
          p_email: string
          p_is_member: boolean
          p_member_id: string | null
          p_status: string
          p_reference_code: string
          p_paid_at: string | null
          p_converted_by: string | null
          p_items: Json
        }
        Returns: string
      }
      create_event_with_ticket_types: {
        Args: { p_event: Json; p_types: Json }
        Returns: string
      }
    }
    Enums: {
      admin_role: "super_admin" | "team_admin" | "originator" | "events_admin"
      member_status:
        | "pending"
        | "approved"
        | "active"
        | "expired"
        | "suspended"
        | "declined"
      membership_category: "individual" | "corporate"
      payment_capture_status:
        | "pending"
        | "authorized"
        | "hold_expired"
        | "charging_offsession"
        | "succeeded"
        | "failed"
        | "requires_action"
        | "cancelled"
      payment_status: "free" | "pending" | "paid" | "overdue" | "refunded"
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
      admin_role: ["super_admin", "team_admin", "originator", "events_admin"],
      member_status: [
        "pending",
        "approved",
        "active",
        "expired",
        "suspended",
        "declined",
      ],
      membership_category: ["individual", "corporate"],
      payment_capture_status: [
        "pending",
        "authorized",
        "hold_expired",
        "charging_offsession",
        "succeeded",
        "failed",
        "requires_action",
        "cancelled",
      ],
      payment_status: ["free", "pending", "paid", "overdue", "refunded"],
    },
  },
} as const

// --- Manual aliases (re-append after every Supabase regen) ---
export type MemberStatus = Database["public"]["Enums"]["member_status"]
export type PaymentCaptureStatus = Database["public"]["Enums"]["payment_capture_status"]
