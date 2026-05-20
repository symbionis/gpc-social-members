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

import { createAdminClient } from "@/lib/supabase/admin";
import { WAIVER_VERSION } from "@/lib/events/waiver";

export type CheckinKind = "registered" | "member" | "guest";

export type MatchResult =
  | { kind: "registered"; registrationId: string }
  | { kind: "member"; memberId: string }
  | { kind: "guest" };

export type CheckinLanguage = "fr" | "en";

/** Single normalization point shared by matching and recording. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
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
 * the `ilike` narrows the candidate set and resolveMatch does the exact
 * lowercase comparison so wildcard chars in an email can never over-match.
 */
export async function matchEmail(
  eventId: string,
  email: string
): Promise<MatchResult> {
  const supabase = createAdminClient();
  const e = normalizeEmail(email);

  const { data: regs } = await supabase
    .from("event_registrations")
    .select("id, email")
    .eq("event_id", eventId)
    .in("status", ["paid", "free"])
    .ilike("email", e);

  const { data: members } = await supabase
    .from("members")
    .select("id, email")
    .eq("status", "active")
    .ilike("email", e);

  return resolveMatch(e, regs ?? [], members ?? []);
}

/** Postgres unique-violation SQLSTATE — a repeat check-in for the same email. */
export function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

export type RecordCheckinInput = {
  eventId: string;
  name: string;
  email: string;
  language: CheckinLanguage;
  match: MatchResult;
  inviterName?: string | null;
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
    language: input.language,
    waiver_version: WAIVER_VERSION,
  };

  const { data, error } = await supabase
    .from("event_checkins")
    .insert(row)
    .select("waiver_accepted_at")
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      const { data: existing } = await supabase
        .from("event_checkins")
        .select("waiver_accepted_at")
        .eq("event_id", input.eventId)
        .eq("email", e)
        .single();
      return {
        already: true,
        checkedInAt: existing?.waiver_accepted_at ?? null,
      };
    }
    throw error;
  }

  return { already: false, checkedInAt: data?.waiver_accepted_at ?? null };
}
