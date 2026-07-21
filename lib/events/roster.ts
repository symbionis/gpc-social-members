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
// email (naming is mandatory, no exemption for a former child type), so email is
// non-null. The lead is excluded (seeded from lead_ticket_type_id), so this list is
// guests only.
export interface RosterFillAttendee {
  ticket_type_id: string;
  name: string;
  email: string;
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
 * calling claim_ticket once per attendee. Use this ONLY on the synchronous free
 * path, where there is no webhook replay — it is not atomic across attendees, unlike
 * applyPendingRoster (which the paid path must use instead).
 *
 * Sequential on purpose: claim_ticket takes `SELECT ... FOR UPDATE` on the
 * registration row as its first statement, so concurrent calls for one registration
 * serialize at the DB anyway. Firing them in parallel would only open N connections
 * all blocked on the same lock, with no latency gain — so we keep the connection
 * footprint to one at a time and let each call's error be logged and skipped.
 */
export async function fillRegistrationRoster(
  registrationId: string,
  attendees: RosterFillAttendee[],
): Promise<void> {
  if (attendees.length === 0) return;
  const supabase = createAdminClient();
  for (const a of attendees) {
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
  }
}

// The admin bulk-import wrapper lived here until the Guest list tab replaced the Import
// tab. Its RPC (import_event_attendees) still exists in the database but now has no
// caller — see docs/plans/2026-07-11-001-feat-admin-guest-list-door-console-plan.md.
