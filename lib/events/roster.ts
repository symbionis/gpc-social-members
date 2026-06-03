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
export async function seedLeadAttendee(registrationId: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.rpc("seed_lead_attendee", {
    p_registration_id: registrationId,
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
