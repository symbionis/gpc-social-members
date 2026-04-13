export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type MemberStatus =
  | "pending"
  | "approved"
  | "active"
  | "expired"
  | "suspended"
  | "declined";

export type PaymentStatus =
  | "free"
  | "pending"
  | "paid"
  | "overdue"
  | "refunded";

export type PaymentCaptureStatus =
  | "pending"
  | "authorized"
  | "hold_expired"
  | "charging_offsession"
  | "succeeded"
  | "failed"
  | "requires_action"
  | "cancelled";

export type ApplicationStatus =
  | "pending"
  | "approved"
  | "declined";

export type AdminRole = "super_admin" | "team_admin" | "originator";

export type MembershipCategory = "individual" | "corporate";

export interface Database {
  public: {
    Tables: {
      membership_tiers: {
        Row: {
          id: string;
          name: string;
          slug: string;
          category: MembershipCategory;
          price_eur: number;
          currency: string;
          company_size_label: string | null;
          benefits: Json | null;
          guest_invitations_per_season: number;
          stripe_price_id: string | null;
          is_active: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          category: MembershipCategory;
          price_eur: number;
          currency?: string;
          company_size_label?: string | null;
          benefits?: Json | null;
          guest_invitations_per_season?: number;
          stripe_price_id?: string | null;
          is_active?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          category?: MembershipCategory;
          price_eur?: number;
          currency?: string;
          company_size_label?: string | null;
          benefits?: Json | null;
          guest_invitations_per_season?: number;
          stripe_price_id?: string | null;
          is_active?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
      admin_users: {
        Row: {
          id: string;
          auth_user_id: string | null;
          email: string;
          first_name: string;
          last_name: string;
          role: AdminRole;
          is_originator: boolean;
          is_approval_committee: boolean;
          invite_code: string | null;
          invite_link_active: boolean;
          can_invite_honorary: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          auth_user_id?: string | null;
          email: string;
          first_name: string;
          last_name: string;
          role?: AdminRole;
          is_originator?: boolean;
          is_approval_committee?: boolean;
          invite_code?: string | null;
          invite_link_active?: boolean;
          can_invite_honorary?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          auth_user_id?: string | null;
          email?: string;
          first_name?: string;
          last_name?: string;
          role?: AdminRole;
          is_originator?: boolean;
          is_approval_committee?: boolean;
          invite_code?: string | null;
          invite_link_active?: boolean;
          can_invite_honorary?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      members: {
        Row: {
          id: string;
          auth_user_id: string | null;
          member_number: string | null;
          title: string | null;
          first_name: string;
          last_name: string;
          email: string;
          phone: string | null;
          address: string | null;
          company_name: string | null;
          company_role: string | null;
          linkedin_url: string | null;
          profile_photo_url: string | null;
          tier_id: string;
          status: MemberStatus;
          originator_id: string | null;
          originator_note: string | null;
          approved_by: string | null;
          approved_at: string | null;
          declined_reason: string | null;
          start_date: string | null;
          end_date: string | null;
          is_migrated: boolean;
          communication_preferences: Json | null;
          metadata: Json | null;
          stripe_customer_id: string | null;
          consent_given_at: string | null;
          consent_ip: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          auth_user_id?: string | null;
          member_number?: string | null;
          title?: string | null;
          first_name: string;
          last_name: string;
          email: string;
          phone?: string | null;
          address?: string | null;
          company_name?: string | null;
          company_role?: string | null;
          linkedin_url?: string | null;
          profile_photo_url?: string | null;
          tier_id: string;
          status?: MemberStatus;
          originator_id?: string | null;
          originator_note?: string | null;
          approved_by?: string | null;
          approved_at?: string | null;
          declined_reason?: string | null;
          start_date?: string | null;
          end_date?: string | null;
          is_migrated?: boolean;
          communication_preferences?: Json | null;
          metadata?: Json | null;
          stripe_customer_id?: string | null;
          consent_given_at?: string | null;
          consent_ip?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          auth_user_id?: string | null;
          member_number?: string | null;
          title?: string | null;
          first_name?: string;
          last_name?: string;
          email?: string;
          phone?: string | null;
          address?: string | null;
          company_name?: string | null;
          company_role?: string | null;
          linkedin_url?: string | null;
          profile_photo_url?: string | null;
          tier_id?: string;
          status?: MemberStatus;
          originator_id?: string | null;
          originator_note?: string | null;
          approved_by?: string | null;
          approved_at?: string | null;
          declined_reason?: string | null;
          start_date?: string | null;
          end_date?: string | null;
          is_migrated?: boolean;
          communication_preferences?: Json | null;
          metadata?: Json | null;
          stripe_customer_id?: string | null;
          consent_given_at?: string | null;
          consent_ip?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      payments: {
        Row: {
          id: string;
          member_id: string;
          tier_id: string | null;
          amount_eur: number;
          currency: string;
          payment_status: PaymentStatus;
          payment_capture_status: PaymentCaptureStatus | null;
          stripe_payment_intent_id: string | null;
          stripe_checkout_session_id: string | null;
          stripe_invoice_id: string | null;
          stripe_payment_method_id: string | null;
          payment_method: string | null;
          paid_at: string | null;
          authorized_at: string | null;
          capture_before: string | null;
          payment_failed_at: string | null;
          payment_retry_deadline: string | null;
          reminder_day1_sent: boolean;
          reminder_day3_sent: boolean;
          reminder_day4_sent: boolean;
          notes: string | null;
          season: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          member_id: string;
          tier_id?: string | null;
          amount_eur: number;
          currency?: string;
          payment_status?: PaymentStatus;
          payment_capture_status?: PaymentCaptureStatus | null;
          stripe_payment_intent_id?: string | null;
          stripe_checkout_session_id?: string | null;
          stripe_invoice_id?: string | null;
          stripe_payment_method_id?: string | null;
          payment_method?: string | null;
          paid_at?: string | null;
          authorized_at?: string | null;
          capture_before?: string | null;
          payment_failed_at?: string | null;
          payment_retry_deadline?: string | null;
          reminder_day1_sent?: boolean;
          reminder_day3_sent?: boolean;
          reminder_day4_sent?: boolean;
          notes?: string | null;
          season?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          member_id?: string;
          tier_id?: string | null;
          amount_eur?: number;
          currency?: string;
          payment_status?: PaymentStatus;
          payment_capture_status?: PaymentCaptureStatus | null;
          stripe_payment_intent_id?: string | null;
          stripe_checkout_session_id?: string | null;
          stripe_invoice_id?: string | null;
          stripe_payment_method_id?: string | null;
          payment_method?: string | null;
          paid_at?: string | null;
          authorized_at?: string | null;
          capture_before?: string | null;
          payment_failed_at?: string | null;
          payment_retry_deadline?: string | null;
          reminder_day1_sent?: boolean;
          reminder_day3_sent?: boolean;
          reminder_day4_sent?: boolean;
          notes?: string | null;
          season?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      membership_cards: {
        Row: {
          id: string;
          member_id: string;
          card_number: string;
          qr_code_data: string | null;
          tier_id: string | null;
          valid_from: string;
          valid_until: string;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          member_id: string;
          card_number: string;
          qr_code_data?: string | null;
          tier_id?: string | null;
          valid_from: string;
          valid_until: string;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          member_id?: string;
          card_number?: string;
          qr_code_data?: string | null;
          tier_id?: string | null;
          valid_from?: string;
          valid_until?: string;
          is_active?: boolean;
          created_at?: string;
        };
      };
      applications: {
        Row: {
          id: string;
          member_id: string;
          status: ApplicationStatus;
          reviewed_by: string | null;
          review_notes: string | null;
          reviewed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          member_id: string;
          status?: ApplicationStatus;
          reviewed_by?: string | null;
          review_notes?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          member_id?: string;
          status?: ApplicationStatus;
          reviewed_by?: string | null;
          review_notes?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
        };
      };
      referrals: {
        Row: {
          id: string;
          originator_id: string;
          member_id: string;
          invite_code_used: string | null;
          status: string;
          converted_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          originator_id: string;
          member_id: string;
          invite_code_used?: string | null;
          status?: string;
          converted_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          originator_id?: string;
          member_id?: string;
          invite_code_used?: string | null;
          status?: string;
          converted_at?: string | null;
          created_at?: string;
        };
      };
      renewal_tokens: {
        Row: {
          id: string;
          member_id: string;
          originator_id: string;
          token: string;
          used: boolean;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          member_id: string;
          originator_id: string;
          token: string;
          used?: boolean;
          expires_at: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          member_id?: string;
          originator_id?: string;
          token?: string;
          used?: boolean;
          expires_at?: string;
          created_at?: string;
        };
      };
      payment_retry_tokens: {
        Row: {
          id: string;
          member_id: string;
          payment_id: string;
          token: string;
          used: boolean;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          member_id: string;
          payment_id: string;
          token: string;
          used?: boolean;
          expires_at: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          member_id?: string;
          payment_id?: string;
          token?: string;
          used?: boolean;
          expires_at?: string;
          created_at?: string;
        };
      };
      seasons: {
        Row: {
          id: string;
          name: string;
          slug: string;
          start_date: string;
          end_date: string;
          renewal_open_date: string | null;
          is_current: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          start_date: string;
          end_date: string;
          renewal_open_date?: string | null;
          is_current?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          start_date?: string;
          end_date?: string;
          renewal_open_date?: string | null;
          is_current?: boolean;
          created_at?: string;
        };
      };
      event_types: {
        Row: {
          id: string;
          name: string;
          slug: string;
          color: string;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          color?: string;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          color?: string;
          sort_order?: number;
          created_at?: string;
        };
      };
      events: {
        Row: {
          id: string;
          event_type_id: string;
          season_id: string | null;
          title: string;
          description: string | null;
          start_date: string;
          end_date: string | null;
          start_time: string | null;
          location: string | null;
          is_confirmed: boolean;
          is_published: boolean;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          event_type_id: string;
          season_id?: string | null;
          title: string;
          description?: string | null;
          start_date: string;
          end_date?: string | null;
          start_time?: string | null;
          location?: string | null;
          is_confirmed?: boolean;
          is_published?: boolean;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          event_type_id?: string;
          season_id?: string | null;
          title?: string;
          description?: string | null;
          start_date?: string;
          end_date?: string | null;
          start_time?: string | null;
          location?: string | null;
          is_confirmed?: boolean;
          is_published?: boolean;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      lounge_sessions: {
        Row: {
          id: string;
          day_of_week: string;
          time_slot: string;
          field_number: number;
          is_open: boolean;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          day_of_week: string;
          time_slot: string;
          field_number?: number;
          is_open?: boolean;
          updated_by?: string | null;
          updated_at?: string;
        };
        Update: {
          id?: string;
          day_of_week?: string;
          time_slot?: string;
          field_number?: number;
          is_open?: boolean;
          updated_by?: string | null;
          updated_at?: string;
        };
      };
      email_settings: {
        Row: {
          id: string;
          key: string;
          value: Json;
          enabled: boolean;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          id?: string;
          key: string;
          value?: Json;
          enabled?: boolean;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          id?: string;
          key?: string;
          value?: Json;
          enabled?: boolean;
          updated_at?: string;
          updated_by?: string | null;
        };
      };
    };
    Enums: {
      member_status: MemberStatus;
      payment_status: PaymentStatus;
      payment_capture_status: PaymentCaptureStatus;
      application_status: ApplicationStatus;
      admin_role: AdminRole;
      membership_category: MembershipCategory;
    };
  };
}
