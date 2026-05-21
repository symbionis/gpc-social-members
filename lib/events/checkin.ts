// Event door check-in domain logic: email matching and idempotent recording.
//
// See docs/plans/2026-05-20-001-feat-event-door-checkin-plan.md (U2).
//
// Matching is the new piece this feature introduces: an unauthenticated guest's
// typed email is matched against the event's registrations and the active member
// directory (registration precedence). This is distinct from the registration
// flow, which detects membership from the auth session, never a typed email.
// The same normalization point (normalizeEmail) is used by the match and submit
// endpoints so they cannot diverge.

import { WAIVER_VERSION, type WaiverLanguage } from "@/lib/events/waiver";
import { createAdminClient } from "@/lib/supabase/admin";

export type CheckinKind = "registered" | "member" | "guest";

export type MatchResult =
  | { kind: "registered"; registrationId: string }
  | { kind: "member"; memberId: string }
  | { kind: "guest" };

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

type RegRow = { id: string; email: string | null };
type MemberRow = { id: string; email: string | null };

/**
 * Pure precedence/normalization logic. Compares the normalized email against
 * both candidate sets, registrations winning over members. Members passed here
 * are already filtered to active status by the query in matchEmail.
 */
export function resolveMatch(
  email: string,
  registrations: RegRow[],
  activeMembers: MemberRow[]
): MatchResult {
  const e = normalizeEmail(email);

  const reg = registrations.find((r) => (r.email ?? "").toLowerCase() === e);
  if (reg) return { kind: "registered", registrationId: reg.id };

  const member = activeMembers.find((m) => (m.email ?? "").toLowerCase() === e);
  if (member) return { kind: "member", memberId: member.id };

  return { kind: "guest" };
}

/**
 * Match a typed email against this event's paid/free registrations, then the
 * active member directory. Both legs use the same case-insensitive comparison;
 * the escaped `ilike` matches the email literally (no wildcard over-match) and
 * resolveMatch does the exact lowercase comparison. Registrations are ordered so
 * a duplicate-email registrant links to a deterministic (earliest) row.
 *
 * Query errors throw rather than coercing to an empty result — a silent "no
 * match" would misclassify a registered member as a guest (or, under strict,
 * block them) on a transient database failure.
 */
export async function matchEmail(
  eventId: string,
  email: string
): Promise<MatchResult> {
  const supabase = createAdminClient();
  const e = normalizeEmail(email);
  const pattern = escapeLike(e);

  const { data: regs, error: regsError } = await supabase
    .from("event_registrations")
    .select("id, email, created_at")
    .eq("event_id", eventId)
    .in("status", ["paid", "free"])
    .ilike("email", pattern)
    .order("created_at", { ascending: true });
  if (regsError) throw regsError;

  const { data: members, error: membersError } = await supabase
    .from("members")
    .select("id, email")
    .eq("status", "active")
    .ilike("email", pattern);
  if (membersError) throw membersError;

  return resolveMatch(e, regs ?? [], members ?? []);
}

/** Postgres unique-violation SQLSTATE — a repeat check-in for the same email. */
export function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

/**
 * Whether a check-in row already exists for (event, email), and its acceptance
 * time. Used to keep repeat check-ins idempotent even under strict mode — a
 * person who already checked in must still get the green confirmation, not a
 * "see the desk" block, if strict was flipped on after they arrived.
 */
export async function findExistingCheckin(
  eventId: string,
  email: string
): Promise<{ checkedInAt: string | null } | null> {
  const supabase = createAdminClient();
  const e = normalizeEmail(email);
  const { data, error } = await supabase
    .from("event_checkins")
    .select("waiver_accepted_at")
    .eq("event_id", eventId)
    .eq("email", e)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { checkedInAt: data.waiver_accepted_at ?? null };
}

export type RecordCheckinInput = {
  eventId: string;
  name: string;
  email: string;
  language: WaiverLanguage;
  match: MatchResult;
  inviterName?: string | null;
  /** Registration the guest picked as their inviter (typeahead). Guests only. */
  invitedByRegistrationId?: string | null;
  /** Optional communication/marketing consent from the waiver step (ticked by default). */
  marketingConsent?: boolean;
};

export type RecordCheckinResult = {
  already: boolean;
  checkedInAt: string | null;
};

/**
 * Insert a single event_checkins row (the per-person waiver audit). waiver_version
 * is sourced server-side from WAIVER_VERSION, never the client. A repeat check-in
 * for the same (event_id, email) raises 23505, which is a benign "already checked
 * in" outcome — we return the original acceptance time rather than erroring.
 */
export async function recordCheckin(
  input: RecordCheckinInput
): Promise<RecordCheckinResult> {
  const supabase = createAdminClient();
  const e = normalizeEmail(input.email);

  const row = {
    event_id: input.eventId,
    registration_id:
      input.match.kind === "registered" ? input.match.registrationId : null,
    member_id: input.match.kind === "member" ? input.match.memberId : null,
    name: input.name.trim(),
    email: e,
    kind: input.match.kind,
    inviter_name:
      input.match.kind === "guest" ? input.inviterName?.trim() || null : null,
    invited_by_registration_id:
      input.match.kind === "guest" ? input.invitedByRegistrationId ?? null : null,
    language: input.language,
    marketing_consent: input.marketingConsent ?? true,
    waiver_version: WAIVER_VERSION,
  };

  const { data, error } = await supabase
    .from("event_checkins")
    .insert(row)
    .select("waiver_accepted_at")
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      const { data: existing, error: refetchError } = await supabase
        .from("event_checkins")
        .select("waiver_accepted_at")
        .eq("event_id", input.eventId)
        .eq("email", e)
        .single();
      if (refetchError) throw refetchError;
      return {
        already: true,
        checkedInAt: existing?.waiver_accepted_at ?? null,
      };
    }
    throw error;
  }

  return { already: false, checkedInAt: data?.waiver_accepted_at ?? null };
}
