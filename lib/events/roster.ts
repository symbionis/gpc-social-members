// Roster (event_attendees) write helpers. Kept in lib/ — never exported from a
// route.ts — so the register route, the Stripe webhook, and the self-registration
// routes can share them (Next.js App Router forbids non-handler exports from route
// files).

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Seed the purchaser as an is_lead attendee for a confirmed registration. The work
 * (paid/free gate, NOT EXISTS guard, idempotency) lives in the seed_lead_attendee
 * SECURITY DEFINER function, so this is safe to call from the free-registration
 * path and the Stripe webhook alike.
 *
 * Best-effort: a seed failure is logged, not thrown. The registration has already
 * succeeded, and the roster has other on-ramps (backfill, bulk import, ops), so a
 * transient seed error must not fail registration or a Stripe webhook retry. The
 * log line is the signal to reconcile.
 */
export async function seedLeadAttendee(
  registrationId: string,
  phoneE164?: string | null,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.rpc("seed_lead_attendee", {
    p_registration_id: registrationId,
    // In-hand override (the free-registration path passes the captured phone) so a
    // failed best-effort phone UPDATE doesn't drop it; null falls back to the row.
    p_phone_e164: phoneE164 ?? null,
  });
  if (error) {
    console.error("[roster] seed_lead_attendee failed", {
      registrationId,
      err: error,
    });
  }
}

/**
 * Mint one issued, credentialled ticket per purchased-but-unfilled slot for a
 * confirmed registration. Call AFTER seedLeadAttendee — the lead's claimed row is
 * counted as existing, so the mint creates (purchased − existing) issued rows per
 * type. The work (registration lock, per-type shortfall, credential generation,
 * idempotency) lives in the mint_registration_tickets SECURITY DEFINER function, so
 * this is safe to call from the free path and the Stripe webhook (replay-safe).
 *
 * Best-effort: a mint failure is logged, not thrown — the registration has already
 * succeeded and the mint is idempotent, so a retry/backfill reconciles. The log
 * line is the signal.
 */
export async function mintRegistrationTickets(
  registrationId: string,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.rpc("mint_registration_tickets", {
    p_registration_id: registrationId,
  });
  if (error) {
    console.error("[roster] mint_registration_tickets failed", {
      registrationId,
      err: error,
    });
  }
}

// One booker-entered guest ticket to name at checkout. Every ticket now requires an
// email (naming is mandatory, no exemption for a former child type). The lead is
// excluded (seeded from lead_ticket_type_id), so this list is guests only.
export interface RosterFillAttendee {
  ticket_type_id: string;
  name: string;
  email: string | null;
}

/**
 * Apply a PAID registration's stored `pending_roster` atomically: the
 * apply_pending_roster SECURITY DEFINER function claims each guest and clears the
 * column in one transaction under a row lock. Use this on the Stripe webhook path —
 * unlike fillRegistrationRoster it is fully replay-safe (children included), because
 * a crash rolls back both the claims and the clear, and concurrent redeliveries
 * serialize on the lock.
 *
 * Best-effort: a failure is logged, not thrown — the payment already succeeded and
 * the un-cleared roster makes a later redelivery re-apply cleanly.
 */
export async function applyPendingRoster(registrationId: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.rpc("apply_pending_roster", {
    p_registration_id: registrationId,
  });
  if (error) {
    console.error("[roster] apply_pending_roster failed", { registrationId, err: error });
  }
}

/**
 * Apply booker-entered guest names to a confirmed registration's issued tickets by
 * calling claim_ticket once per attendee, in parallel (each targets a distinct
 * ticket type/slot, so the calls are independent). Use this ONLY on the synchronous
 * free path, where there is no webhook replay — it is not atomic across attendees,
 * unlike applyPendingRoster (which the paid path must use instead).
 */
export async function fillRegistrationRoster(
  registrationId: string,
  attendees: RosterFillAttendee[],
): Promise<void> {
  if (attendees.length === 0) return;
  const supabase = createAdminClient();
  await Promise.allSettled(
    attendees.map(async (a) => {
      const { error } = await supabase.rpc("claim_ticket", {
        p_registration_id: registrationId,
        p_name: a.name,
        p_email: a.email,
        p_phone_e164: null,
        p_language: null,
        p_waiver_version: null,
        p_waiver_accepted: false,
        p_marketing_consent: false,
        p_ticket_type_id: a.ticket_type_id,
      });
      if (error) {
        console.error("[roster] claim_ticket (checkout fill) failed", {
          registrationId,
          ticketTypeId: a.ticket_type_id,
          err: error,
        });
      }
    }),
  );
}

// The admin bulk-import wrapper lived here until the Guest list tab replaced the Import
// tab. Its RPC (import_event_attendees) still exists in the database but now has no
// caller — see docs/plans/2026-07-11-001-feat-admin-guest-list-door-console-plan.md.

// Self-registration claim (U9). The guest opens a per-registration link and adds
// themselves to the party's roster. Inputs are already validated/normalized by the
// claim route; the work (token lookup, row lock, cap, idempotency, optional waiver)
// lives in the claim_self_registration RPC so the cap is race-safe at the DB level.
export interface SelfRegistrationClaimInput {
  token: string;
  name: string;
  email: string | null;
  phone_e164: string | null;
  language: string | null;
  /** Server-sourced waiver version (WAIVER_VERSION); null leaves the waiver unsigned. */
  waiverVersion: string | null;
  waiverAccepted: boolean;
  marketingConsent: boolean;
  /**
   * The event_ticket_types row the guest selected (their meal/ticket for an asado).
   * null lets the RPC auto-assign the party's sole purchased type, or leave it open
   * for a mixed booking. A non-event id is ignored server-side.
   */
  ticketTypeId: string | null;
}

export type SelfRegistrationClaimResult =
  | { status: "claimed"; attendeeId: string; name: string | null; already: boolean }
  | { status: "full" }
  | { status: "type_full" }
  | { status: "inactive" }
  | { status: "invalid" }
  | { status: "invalid_input"; reason?: string };

// Add name-only children to a party (U13). The adult who self-registers names their
// kids; each becomes a contactless, waiver-exempt attendee on the party, drawn from
// the party's children-ticket allotment. The cap + child-type resolution live in the
// add_self_registration_children RPC (race-safe under the registration row lock).
export type AddChildrenResult =
  | { status: "ok"; added: number; remaining: number }
  | { status: "full"; added: number }
  | { status: "no_child_tickets"; added: number }
  | { status: "multiple_child_types"; added: number }
  | { status: "inactive" }
  | { status: "invalid" };

export async function addSelfRegistrationChildren(
  token: string,
  names: string[]
): Promise<AddChildrenResult> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("add_self_registration_children", {
    p_token: token,
    p_names: names,
  });
  if (error) {
    console.error("[roster] add_self_registration_children failed", { err: error });
    throw new Error(error.message || "Could not add children");
  }
  return data as AddChildrenResult;
}

/**
 * Claim a self-registration slot via the RPC. Query errors throw (the route maps
 * them to a 5xx) rather than being coerced into a misleading "invalid".
 */
export async function claimSelfRegistration(
  input: SelfRegistrationClaimInput
): Promise<SelfRegistrationClaimResult> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("claim_self_registration", {
    p_token: input.token,
    p_name: input.name,
    p_email: input.email,
    p_phone_e164: input.phone_e164,
    p_language: input.language,
    p_waiver_version: input.waiverVersion,
    p_waiver_accepted: input.waiverAccepted,
    p_marketing_consent: input.marketingConsent,
    p_ticket_type_id: input.ticketTypeId,
  });
  if (error) {
    console.error("[roster] claim_self_registration failed", { err: error });
    throw new Error(error.message || "Claim failed");
  }
  return data as SelfRegistrationClaimResult;
}
