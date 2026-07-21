// Event door check-in domain logic: idempotent arrival recording on the ticket row.
//
// See docs/plans/2026-06-03-001-feat-event-guest-roster-checkin-plan.md (U4, U5) and
// docs/plans/2026-06-22-001-feat-event-ticket-qr-credentials-plan.md (U7).
//
// All check-in now flows through the staffed door console: a scan resolves a ticket
// credential (checkInByCredential) and a lost-QR guest is checked in by id
// (recordAttendeeCheckin). Every ticket carries a credential regardless of type, so the
// former child-only bypass (checkInChildren) is retired — former child tickets check in
// via their credential like everyone else. The ticket row is the per-person source of
// truth for identity, waiver acceptance, and arrival. The legacy phone/email
// self-service matching was retired with the public kiosk (FEAT-41 / U8).

import { WAIVER_VERSION, type WaiverLanguage } from "@/lib/events/waiver";
import { createAdminClient } from "@/lib/supabase/admin";


export type RecordAttendeeCheckinInput = {
  eventId: string;
  attendeeId: string;
  language: WaiverLanguage;
  /** Optional communication/marketing consent from the waiver step (ticked by default). */
  marketingConsent?: boolean;
  /** Whether the arrival accepted the waiver in this submission. */
  waiverAccepted?: boolean;
};

export type RecordAttendeeCheckinResult =
  | {
      ok: true;
      already: boolean;
      checkedInAt: string | null;
      name: string | null;
      /** The attendee's party, so the caller can offer to check in its children. */
      registrationId: string | null;
      /** The attendee's ticket type id, resolved to a title for the bracelet handoff. */
      ticketTypeId: string | null;
    }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "needs_waiver" };

/**
 * Record a check-in on the attendee row (the per-person source of truth). Idempotent
 * on the row itself: if checked_in_at is already set, returns the original arrival
 * time without re-prompting or re-stamping the waiver.
 *
 * Waiver: if the attendee has no waiver_accepted_at yet, the arrival must accept it
 * now (waiverAccepted) — otherwise we signal needs_waiver. When accepted, the waiver
 * fields (version sourced server-side from WAIVER_VERSION, accepted_at, language,
 * marketing_consent) are written ONLY if currently null, so an early self-registration
 * signature is honored as-is (R22) and never clobbered. A previously-signed attendee
 * is never re-asked.
 */
export async function recordAttendeeCheckin(
  input: RecordAttendeeCheckinInput
): Promise<RecordAttendeeCheckinResult> {
  const supabase = createAdminClient();

  const { data: attendee, error } = await supabase
    .from("tickets")
    .select("id, name, registration_id, ticket_type_id, waiver_accepted_at, language, marketing_consent, checked_in_at")
    .eq("id", input.attendeeId)
    .eq("event_id", input.eventId)
    .maybeSingle();
  if (error) throw error;
  if (!attendee) return { ok: false, reason: "not_found" };

  const name = (attendee.name as string | null) ?? null;
  const registrationId = (attendee.registration_id as string | null) ?? null;
  const ticketTypeId = (attendee.ticket_type_id as string | null) ?? null;

  // Already checked in — idempotent, return the original arrival time. No re-prompt,
  // no re-stamp (honors any signed waiver version unchanged).
  if (attendee.checked_in_at) {
    return { ok: true, already: true, checkedInAt: attendee.checked_in_at, name, registrationId, ticketTypeId };
  }

  const needsWaiver = attendee.waiver_accepted_at == null;
  if (needsWaiver && input.waiverAccepted !== true) {
    return { ok: false, reason: "needs_waiver" };
  }

  const now = new Date().toISOString();
  const update: Record<string, unknown> = { checked_in_at: now };

  // Sign now only if not already signed — never clobber an early self-reg signature.
  if (needsWaiver) {
    update.waiver_version = WAIVER_VERSION;
    update.waiver_accepted_at = now;
    update.language = input.language;
    update.marketing_consent = input.marketingConsent ?? true;
  }

  // Guard the flip on checked_in_at IS NULL so a concurrent door double-tap can't
  // double-stamp the arrival (or re-stamp the waiver). If zero rows update, another
  // submit won the race — re-read and report idempotently rather than overwriting.
  const { data: updated, error: updateError } = await supabase
    .from("tickets")
    .update(update)
    .eq("id", input.attendeeId)
    .eq("event_id", input.eventId)
    .is("checked_in_at", null)
    .select("checked_in_at");
  if (updateError) throw updateError;

  if (!updated || updated.length === 0) {
    const { data: existing } = await supabase
      .from("tickets")
      .select("checked_in_at")
      .eq("id", input.attendeeId)
      .eq("event_id", input.eventId)
      .maybeSingle();
    return { ok: true, already: true, checkedInAt: existing?.checked_in_at ?? now, name, registrationId, ticketTypeId };
  }

  return { ok: true, already: false, checkedInAt: now, name, registrationId, ticketTypeId };
}

// ---------------------------------------------------------------------------
// Info-desk scan check-in (U7 / FEAT-41). Resolve a scanned ticket credential to
// its exact row (scoped to the active event) and stamp the arrival, filling any
// missing name/waiver on the spot. All of it lives in the checkin_by_credential
// SECURITY DEFINER RPC; this is a thin typed wrapper.
// ---------------------------------------------------------------------------

export type CredentialCheckinStatus =
  | "not_recognised"
  | "not_for_event"
  | "already"
  | "needs_name"
  | "needs_waiver"
  | "checked_in";

export type CredentialCheckinResult = {
  status: CredentialCheckinStatus;
  ticket_id?: string;
  name?: string | null;
  ticket_type_id?: string | null;
  ticket_type_title?: string | null;
  checked_in_at?: string | null;
};

export type CheckInByCredentialInput = {
  eventId: string;
  credentialToken: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  language?: WaiverLanguage | null;
  waiverVersion?: string | null;
  waiverAccepted?: boolean;
  marketingConsent?: boolean;
};

export async function checkInByCredential(
  input: CheckInByCredentialInput
): Promise<CredentialCheckinResult> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("checkin_by_credential", {
    p_event_id: input.eventId,
    p_credential_token: input.credentialToken,
    p_name: input.name ?? null,
    p_email: input.email ?? null,
    p_phone_e164: input.phone ?? null,
    p_language: input.language ?? null,
    p_waiver_version: input.waiverVersion ?? null,
    p_waiver_accepted: input.waiverAccepted ?? false,
    p_marketing_consent: input.marketingConsent ?? null,
  });
  if (error) throw error;
  return (data ?? { status: "not_recognised" }) as CredentialCheckinResult;
}
