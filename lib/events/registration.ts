// Shared event-registration helpers used by both the public register route and
// the admin waitlist-convert route.
//
// See docs/plans/2026-05-21-001-feat-waitlist-to-registration-plan.md (U1).

import { createAdminClient } from "@/lib/supabase/admin";

// Registration statuses that occupy a seat / count as "registered". Kept in sync
// with the partial unique index event_registrations_event_email_paidfree_uniq
// (WHERE status IN ('paid','free')).
export const REGISTERED_STATUSES = ["paid", "free"] as const;

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Short human-friendly registration reference, e.g. EV-AB12CD34. */
export function generateReferenceCode(): string {
  let code = "";
  for (let i = 0; i < 8; i += 1) {
    code += REF_ALPHABET[Math.floor(Math.random() * REF_ALPHABET.length)];
  }
  return `EV-${code}`;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Escape LIKE/ILIKE metacharacters so a typed email matches literally. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * The earliest active member whose email matches (case-insensitive), or null.
 * The `ilike` narrows the candidate set; the exact lowercase compare in JS
 * neutralizes any wildcard over-match. Ordered by created_at so a duplicate
 * email resolves deterministically to the earliest member.
 */
export async function findActiveMemberByEmail(
  email: string
): Promise<{ id: string } | null> {
  const supabase = createAdminClient();
  const e = normalizeEmail(email);

  const { data, error } = await supabase
    .from("members")
    .select("id, email, created_at")
    .eq("status", "active")
    .ilike("email", escapeLike(e))
    .order("created_at", { ascending: true })
    .limit(20);
  if (error) throw error;

  const match = (data ?? []).find(
    (m: { email: string | null }) => (m.email ?? "").toLowerCase() === e
  );
  return match ? { id: match.id } : null;
}

/** Whether the email already holds a paid/free registration for the event. */
export async function hasExistingRegistration(
  eventId: string,
  email: string
): Promise<boolean> {
  const supabase = createAdminClient();
  const e = normalizeEmail(email);

  const { data, error } = await supabase
    .from("event_registrations")
    .select("id, email")
    .eq("event_id", eventId)
    .in("status", [...REGISTERED_STATUSES])
    .ilike("email", escapeLike(e))
    .limit(50);
  if (error) throw error;

  return (data ?? []).some(
    (r: { email: string | null }) => (r.email ?? "").toLowerCase() === e
  );
}
