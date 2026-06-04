// Event door check-in domain logic: phone-or-email roster matching and idempotent
// recording on the attendee row.
//
// See docs/plans/2026-06-03-001-feat-event-guest-roster-checkin-plan.md (U4, U5).
//
// The door is a strict gate for every event: an arrival is matched against the
// event's roster (event_attendees) by phone or email; found → checked in (signing
// the waiver first if unsigned), not found → "see the welcome desk". event_checkins
// is retired for new writes; the attendee row is the per-person source of truth for
// identity, waiver acceptance, and arrival. The same normalization point
// (normalizeEmail) is used by the match and submit endpoints so they cannot diverge.

import { WAIVER_VERSION, type WaiverLanguage } from "@/lib/events/waiver";
import { createAdminClient } from "@/lib/supabase/admin";

/** Single normalization point shared by matching and recording. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Escape Postgres LIKE/ILIKE metacharacters so a typed email is matched
 * literally. Without this, an email containing `%` or `_` (both legal in a local
 * part) acts as a wildcard, widening the candidate set — on the global members
 * leg that can blow past the silent 1000-row fetch cap and hide the real match.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// ---------------------------------------------------------------------------
// Phone-or-email roster matching (U4) — the strict-door identity path.
//
// Matches an arrival against event_attendees (the roster) by phone or email,
// whichever was provided. The phone is expected already in E.164 (the door form
// captures it through PhoneInput / lib/phone). With phone + email captured at
// every entry point, a contact rarely maps to more than one attendee; when it
// does (a shared family number), we resolve deterministically to the earliest-
// created row — there is no name lookup (KTD10). The advisory match route returns
// only a boolean, so this never discloses who is on a roster.
// ---------------------------------------------------------------------------

export type AttendeeMatchRow = {
  id: string;
  email: string | null;
  phone_e164: string | null;
  created_at: string;
};

export type ContactInput = { email?: string | null; phone?: string | null };

export type ContactMatch =
  | { kind: "none" }
  | { kind: "one"; attendeeId: string };

/**
 * Pure deterministic resolution over already-fetched candidate attendees. Picks
 * the earliest-created row on a shared-contact collision; no name disambiguation.
 */
export function resolveContactMatch(
  candidates: AttendeeMatchRow[]
): ContactMatch {
  if (candidates.length === 0) return { kind: "none" };
  let earliest = candidates[0];
  for (const c of candidates) {
    if (c.created_at < earliest.created_at) earliest = c;
  }
  return { kind: "one", attendeeId: earliest.id };
}

/**
 * Match an arrival to a claimed roster row by email and/or phone (E.164). Runs one
 * indexed lookup per provided channel and unions the candidates by id, so a person
 * who supplied an email that's on the roster matches even if their phone isn't (and
 * vice versa). Query errors throw rather than coercing to "none" — a silent miss
 * would wrongly send a registered attendee to the welcome desk.
 */
export async function matchContact(
  eventId: string,
  input: ContactInput
): Promise<ContactMatch> {
  const supabase = createAdminClient();
  const email = input.email ? normalizeEmail(input.email) : "";
  const phone = input.phone ? input.phone.trim() : "";
  if (!email && !phone) return { kind: "none" };

  const byId = new Map<string, AttendeeMatchRow>();

  if (email) {
    const { data, error } = await supabase
      .from("event_attendees")
      .select("id, email, phone_e164, created_at")
      .eq("event_id", eventId)
      .eq("slot_status", "claimed")
      .is("released_at", null)
      .ilike("email", escapeLike(email));
    if (error) throw error;
    for (const r of (data ?? []) as AttendeeMatchRow[]) byId.set(r.id, r);
  }

  if (phone) {
    const { data, error } = await supabase
      .from("event_attendees")
      .select("id, email, phone_e164, created_at")
      .eq("event_id", eventId)
      .eq("slot_status", "claimed")
      .is("released_at", null)
      .eq("phone_e164", phone);
    if (error) throw error;
    for (const r of (data ?? []) as AttendeeMatchRow[]) byId.set(r.id, r);
  }

  return resolveContactMatch([...byId.values()]);
}

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
    .from("event_attendees")
    .select("id, name, registration_id, waiver_accepted_at, language, marketing_consent, checked_in_at")
    .eq("id", input.attendeeId)
    .eq("event_id", input.eventId)
    .maybeSingle();
  if (error) throw error;
  if (!attendee) return { ok: false, reason: "not_found" };

  const name = (attendee.name as string | null) ?? null;
  const registrationId = (attendee.registration_id as string | null) ?? null;

  // Already checked in — idempotent, return the original arrival time. No re-prompt,
  // no re-stamp (honors any signed waiver version unchanged).
  if (attendee.checked_in_at) {
    return { ok: true, already: true, checkedInAt: attendee.checked_in_at, name, registrationId };
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
    .from("event_attendees")
    .update(update)
    .eq("id", input.attendeeId)
    .eq("event_id", input.eventId)
    .is("checked_in_at", null)
    .select("checked_in_at");
  if (updateError) throw updateError;

  if (!updated || updated.length === 0) {
    const { data: existing } = await supabase
      .from("event_attendees")
      .select("checked_in_at")
      .eq("id", input.attendeeId)
      .eq("event_id", input.eventId)
      .maybeSingle();
    return { ok: true, already: true, checkedInAt: existing?.checked_in_at ?? now, name, registrationId };
  }

  return { ok: true, already: false, checkedInAt: now, name, registrationId };
}

/**
 * The party's children who haven't arrived yet — name-only contactless attendees the
 * accompanying adult can check in alongside themselves at the kiosk. Read-only.
 */
export async function listPartyChildrenToCheckIn(
  eventId: string,
  registrationId: string
): Promise<{ id: string; name: string }[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("event_attendees")
    .select("id, name")
    .eq("event_id", eventId)
    .eq("registration_id", registrationId)
    .eq("is_child", true)
    .eq("slot_status", "claimed")
    .is("released_at", null)
    .is("checked_in_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id as string, name: (r.name as string | null) ?? "" }));
}

/**
 * Mark the given children arrived (kiosk "checking in with me" / door fallback).
 * Strictly scoped: only is_child rows in this event that aren't already checked in.
 * Children skip the waiver, so this only stamps the arrival. Returns the count
 * actually flipped (a row already arrived or not a child is silently skipped).
 */
export async function checkInChildren(
  eventId: string,
  attendeeIds: string[]
): Promise<number> {
  if (attendeeIds.length === 0) return 0;
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("event_attendees")
    .update({ checked_in_at: new Date().toISOString() })
    .in("id", attendeeIds)
    .eq("event_id", eventId)
    .eq("is_child", true)
    .eq("slot_status", "claimed")
    .is("released_at", null)
    .is("checked_in_at", null)
    .select("id");
  if (error) throw error;
  return (data ?? []).length;
}
