// Roster (event_attendees) write helpers. Kept in lib/ — never exported from a
// route.ts — so the register route, the Stripe webhook, and the admin import can
// share them (Next.js App Router forbids non-handler exports from route files).

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

// One ALREADY-NORMALIZED import row handed to the import_event_attendees RPC: the
// name plus a lowercased email and/or an E.164 phone (either may be null). The route
// builds these from the parsed rows (lib/events/roster-import.ts) after normalizing
// each phone via lib/phone.ts toE164.
export interface NormalizedImportRow {
  name: string;
  email: string | null;
  phone_e164: string | null;
}

// Per-row outcome returned by the RPC. `index` is the position in the rows array
// passed to importAttendees (not the original pasted line — the route maps it back).
export interface ImportRowResult {
  index: number;
  status: "inserted" | "merged" | "error";
  message?: string;
}

/**
 * Bulk-import attendees for an event via the import_event_attendees SECURITY DEFINER
 * RPC. The RPC dedupes by phone OR lower(email) within the event, enriches an
 * existing row's NULL contact (never overwriting a waiver/arrival/non-null contact),
 * and reports per-row results — a single bad row never aborts the batch.
 *
 * Kept in lib/ — never exported from a route.ts — so it's reusable and App Router's
 * route-file export restriction is respected.
 */
export async function importAttendees(
  eventId: string,
  rows: NormalizedImportRow[]
): Promise<ImportRowResult[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("import_event_attendees", {
    p_event_id: eventId,
    p_rows: rows,
  });
  if (error) {
    console.error("[roster] import_event_attendees failed", { eventId, err: error });
    throw new Error(error.message || "Import failed");
  }
  return (data ?? []) as ImportRowResult[];
}

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
}

export type SelfRegistrationClaimResult =
  | { status: "claimed"; attendeeId: string; name: string | null; already: boolean }
  | { status: "full" }
  | { status: "inactive" }
  | { status: "invalid" }
  | { status: "invalid_input"; reason?: string };

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
  });
  if (error) {
    console.error("[roster] claim_self_registration failed", { err: error });
    throw new Error(error.message || "Claim failed");
  }
  return data as SelfRegistrationClaimResult;
}
