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

export type AdminRole = "super_admin" | "team_admin";

export type MembershipCategory = "individual" | "corporate";

export interface Database {
  public: {
    Tables: {
      membership_tiers: {
        Row: {
          id: string;
          name: string;
          price_cents: number;
          category: MembershipCategory;
          stripe_price_id: string | null;
          benefits: Json | null;
          guest_invitation_limit: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          price_cents: number;
          category: MembershipCategory;
          stripe_price_id?: string | null;
          benefits?: Json | null;
          guest_invitation_limit?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          price_cents?: number;
          category?: MembershipCategory;
          stripe_price_id?: string | null;
          benefits?: Json | null;
          guest_invitation_limit?: number;
          is_active?: boolean;
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
          created_at?: string;
          updated_at?: string;
        };
      };
      members: {
        Row: {
          id: string;
          auth_user_id: string | null;
          email: string;
          title: string | null;
          first_name: string;
          last_name: string;
          phone: string | null;
          company: string | null;
          role_title: string | null;
          member_number: string | null;
          tier_id: string;
          status: MemberStatus;
          payment_status: PaymentStatus;
          originator_id: string | null;
          season_id: string | null;
          is_migrated: boolean;
          connection_note: string | null;
          metadata: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          auth_user_id?: string | null;
          email: string;
          title?: string | null;
          first_name: string;
          last_name: string;
          phone?: string | null;
          company?: string | null;
          role_title?: string | null;
          member_number?: string | null;
          tier_id: string;
          status?: MemberStatus;
          payment_status?: PaymentStatus;
          originator_id?: string | null;
          season_id?: string | null;
          is_migrated?: boolean;
          connection_note?: string | null;
          metadata?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          auth_user_id?: string | null;
          email?: string;
          title?: string | null;
          first_name?: string;
          last_name?: string;
          phone?: string | null;
          company?: string | null;
          role_title?: string | null;
          member_number?: string | null;
          tier_id?: string;
          status?: MemberStatus;
          payment_status?: PaymentStatus;
          originator_id?: string | null;
          season_id?: string | null;
          is_migrated?: boolean;
          connection_note?: string | null;
          metadata?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      payments: {
        Row: {
          id: string;
          member_id: string;
          season_id: string | null;
          amount_cents: number;
          status: PaymentStatus;
          stripe_session_id: string | null;
          stripe_payment_intent_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          member_id: string;
          season_id?: string | null;
          amount_cents: number;
          status?: PaymentStatus;
          stripe_session_id?: string | null;
          stripe_payment_intent_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          member_id?: string;
          season_id?: string | null;
          amount_cents?: number;
          status?: PaymentStatus;
          stripe_session_id?: string | null;
          stripe_payment_intent_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      membership_cards: {
        Row: {
          id: string;
          member_id: string;
          card_number: string;
          valid_from: string;
          valid_until: string;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          member_id: string;
          card_number: string;
          valid_from: string;
          valid_until: string;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          member_id?: string;
          card_number?: string;
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
          reviewed_by: string | null;
          decision: string;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          member_id: string;
          reviewed_by?: string | null;
          decision: string;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          member_id?: string;
          reviewed_by?: string | null;
          decision?: string;
          notes?: string | null;
          created_at?: string;
        };
      };
      referrals: {
        Row: {
          id: string;
          originator_id: string;
          member_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          originator_id: string;
          member_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          originator_id?: string;
          member_id?: string;
          created_at?: string;
        };
      };
      seasons: {
        Row: {
          id: string;
          year: number;
          start_date: string;
          end_date: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          year: number;
          start_date: string;
          end_date: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          year?: number;
          start_date?: string;
          end_date?: string;
          created_at?: string;
        };
      };
    };
    Enums: {
      member_status: MemberStatus;
      payment_status: PaymentStatus;
      admin_role: AdminRole;
      membership_category: MembershipCategory;
    };
  };
}
