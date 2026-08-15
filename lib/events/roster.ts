// Roster (event_attendees) write helpers. Kept in lib/ — never exported from a
// route.ts — so the register route, the Stripe webhook, and the self-registration
// routes can share them (Next.js App Router forbids non-handler exports from route
// files).

import { createAdminClient } from "@/lib/supabase/admin";

// seedLeadAttendee (and the seed_lead_attendee RPC it called) is retired (U2, KTD3).
// Under the people contract the buyer is person zero — no more special-cased than
// any other entry — so their ticket is minted and claimed the same way every
// guest's is, via mintRegistrationTickets + fillRegistrationRoster/
// applyPendingRoster below. markLeadTickets (further down) is what now flips
// is_lead, since neither of those two ever does. The SQL function itself is left
// in place, unused, the way import_event_attendees was (see the file's trailing
// comment) — retiring it is a migration, out of scope here.

/**
 * Mint one issued, credentialled ticket per purchased-but-unfilled slot for a
 * confirmed registration. Nothing is pre-seeded before this runs (KTD3) — the buyer's
 * own seat(s) mint issued and unclaimed exactly like every guest's, so the mint
 * creates (purchased − existing) issued rows per type against whatever is already
 * claimed at call time. The work (registration lock, per-type shortfall, credential
 * generation, idempotency) lives in the mint_registration_tickets SECURITY DEFINER
 * function, so this is safe to call from the free path and the Stripe webhook
 * (replay-safe).
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

// One person's claim on one ticket type, to name at checkout or apply after
// payment. Every ticket now requires an email (naming is mandatory, no exemption
// for a former child type), so email is non-null. Under the people contract (U2,
// KTD3) the buyer (people[0]) is one more entry here, not excluded — there is
// nothing left that makes their seat different from a guest's.
export interface RosterFillAttendee {
  ticket_type_id: string;
  name: string;
  email: string;
}

/**
 * What a checkout fill actually achieved, per guest. `unnamed` is the important half: those
 * seats exist and are paid for, but nobody is on them, and their QR never reaches anyone
 * either — grouped delivery keys on the guest's own email, which is NULL on an unnamed seat.
 * So the seat is counted against the event while the person holding it is unknown and
 * unreachable. `reason` distinguishes a transport failure (`rpc_error`) from the guard
 * collapsing the guest onto a seat that was already named (`collapsed_onto_existing_seat`)
 * from a refusal claim_ticket reported by status (`full`, `type_full`, `inactive`,
 * `invalid_input`).
 */
export interface RosterFillResult {
  filled: number;
  unnamed: { attendee: RosterFillAttendee; reason: string }[];
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
 * Flip is_lead=true on every one of this registration's claimed tickets that match the
 * buyer's own identity (KTD3/KTD9). Under the people contract the buyer is claimed through
 * the same claim_ticket path as every guest — neither mint_registration_tickets nor
 * claim_ticket ever sets is_lead, so this is the one remaining step that does, and it must
 * run after the buyer's own claim (fillRegistrationRoster on the free path,
 * applyPendingRoster on the paid path).
 *
 * Matched by (registration_id, name, email) rather than a fixed ticket type: a buyer can now
 * hold more than one type (a multi-day pass), and every one of those tickets is equally
 * "their own" — several is_lead rows on one registration is correct, not a bug. See
 * lib/events/household.ts's `isLead` doc comment: it drives the receipt link on EACH ticket,
 * so a multi-day buyer seeing it on both of their own tickets is the wanted behaviour.
 *
 * `name`/`email` must be exactly what was passed to claim_ticket for this person — this
 * route's own (already-trimmed, already-lowercased-for-email) `name`/`email` variables.
 * claim_ticket lowercases email itself but stores name exactly as given (trimmed only), so
 * this match is exact, never case-folded.
 *
 * Best-effort: a failure is logged, not thrown — the registration and its tickets already
 * exist; a stuck is_lead flag is a "My Bookings" access problem to reconcile by hand, not a
 * reason to fail an otherwise-successful checkout or webhook delivery.
 */
export async function markLeadTickets(
  registrationId: string,
  name: string,
  email: string,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("tickets")
    .update({ is_lead: true })
    .eq("registration_id", registrationId)
    .eq("name", name)
    .eq("email", email)
    .is("released_at", null);
  if (error) {
    console.error("[roster] markLeadTickets failed", { registrationId, err: error });
  }
}

/**
 * What apply_topup_roster reports back.
 *
 * `no_roster` means nothing was staged on the top-up row — the ordinary redelivery answer,
 * already applied and cleared. `error` is this helper's own signal, never a value the RPC
 * returns, and it is the one a caller MUST act on: it means the apply rolled back with the
 * names still staged, so the work is unfinished.
 *
 * There was briefly a `legacy_roster` member here, distinguishing top-ups that predated
 * per-top-up rosters so the webhook could fall back to the registration-level slot for them.
 * That shim is retired. The RPC still reports `legacy` for the same distinction; nothing
 * consumes it, and it is left in place rather than spending a migration on cosmetics.
 */
export type TopupRosterStatus = "applied" | "no_roster" | "not_found" | "error";

/**
 * Apply ONE top-up's staged guest names atomically.
 *
 * A top-up owns the names it bought — they live on the top-up row, not on the shared
 * `event_registrations.pending_roster`. That is what keeps a redelivery of the booking's
 * ORIGINAL checkout from consuming a top-up's names, and keeps two concurrent top-ups on
 * one booking from overwriting each other.
 *
 * Returns a status rather than throwing because the caller has a decision to make: `error`
 * warrants asking Stripe to retry. Do NOT collapse this to `void` now that the legacy
 * fallback is gone — that return value is the only thing standing between a failed apply and
 * a 200 that strands the names in a column nothing else reads.
 *
 * A failure is logged, not thrown — the payment has already succeeded, so throwing past a
 * captured charge helps nobody. The roster stays staged on failure, which is what makes a
 * retry re-apply cleanly. **That retry is not automatic:** it happens only because the
 * webhook turns `error` into a 500. On the free top-up path there is no webhook and no
 * retry at all, so that caller surfaces the failure to the lead instead.
 */
export async function applyTopupRoster(topupId: string): Promise<TopupRosterStatus> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("apply_topup_roster", {
    p_topup_id: topupId,
  });
  if (error) {
    console.error("[roster] apply_topup_roster failed", { topupId, err: error });
    return "error";
  }
  const payload = data as { status?: string; unclaimed?: unknown[] } | null;
  const status = payload?.status;
  // The RPC clears the staged roster whether or not every guest was placed, so this log is
  // the only surviving record that someone paid for a seat nothing named. `already: true`
  // is in here too: that guest matched a seat already named on the booking, so no new seat
  // was consumed and one stays open. Recoverable by hand from the booking page.
  if (Array.isArray(payload?.unclaimed) && payload.unclaimed.length > 0) {
    console.error("[roster] top-up seats left UNNAMED — needs manual naming", {
      topupId,
      unclaimed: payload.unclaimed,
    });
  }
  if (status === "applied" || status === "no_roster" || status === "not_found") {
    return status;
  }
  console.error("[roster] apply_topup_roster returned an unrecognised status", {
    topupId,
    status,
  });
  return "error";
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
): Promise<RosterFillResult> {
  const result: RosterFillResult = { filled: 0, unnamed: [] };
  if (attendees.length === 0) return result;
  const supabase = createAdminClient();
  for (const a of attendees) {
    const { data, error } = await supabase.rpc("claim_ticket", {
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
      result.unnamed.push({ attendee: a, reason: "rpc_error" });
      continue;
    }
    // An RPC that did not throw is NOT an RPC that named someone. `already: true` means the
    // replay guard matched an existing seat and claimed nothing — the guest's slot is still
    // issued and unnamed, and its QR goes nowhere, because delivery groups by the guest's
    // email. This return value used to be discarded, which is precisely why four bookings
    // reached the door with a blank on the roster and nobody knew. Anything short of a fresh
    // claim is a failure and says so.
    const res = (data ?? {}) as { status?: string; already?: boolean };
    if (res.status === "claimed" && !res.already) {
      result.filled += 1;
    } else {
      result.unnamed.push({
        attendee: a,
        reason: res.already ? "collapsed_onto_existing_seat" : (res.status ?? "unknown"),
      });
    }
  }
  if (result.unnamed.length > 0) {
    // Loud, greppable, and carries enough to reconcile by hand: which booking, which type,
    // which guest, and why. The registration itself has already succeeded and the seats are
    // sold, so there is nothing to roll back — this line is the only way anyone finds out.
    console.error("[roster] SEATS LEFT UNNAMED after checkout fill", {
      registrationId,
      requested: attendees.length,
      filled: result.filled,
      unnamed: result.unnamed.map((u) => ({
        name: u.attendee.name,
        email: u.attendee.email,
        ticketTypeId: u.attendee.ticket_type_id,
        reason: u.reason,
      })),
    });
  }
  return result;
}

// The admin bulk-import wrapper lived here until the Guest list tab replaced the Import
// tab. Its RPC (import_event_attendees) still exists in the database but now has no
// caller — see docs/plans/2026-07-11-001-feat-admin-guest-list-door-console-plan.md.
