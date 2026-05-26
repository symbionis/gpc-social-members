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

const INVITE_CODE_LENGTH = 16;

/**
 * A per-event invite-link secret: 16 chars (~80 bits) from REF_ALPHABET.
 *
 * Unlike generateReferenceCode, this is a security credential that gates
 * members-only registration, so it draws from a CSPRNG (crypto.getRandomValues)
 * rather than Math.random. REF_ALPHABET has exactly 32 characters, which divides
 * 256 evenly, so `byte % 32` is an unbiased mapping (no rejection sampling
 * needed). No EV- prefix — the whole string is the secret.
 */
export function generateInviteCode(): string {
  const bytes = new Uint8Array(INVITE_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < INVITE_CODE_LENGTH; i += 1) {
    code += REF_ALPHABET[bytes[i] % REF_ALPHABET.length];
  }
  return code;
}

/**
 * Whether a supplied invite code matches an event's stored code.
 *
 * Shared by the register API (app/api/events/[id]/register/route.ts) and the
 * public event page so the two surfaces cannot drift. The strict guard means a
 * blank `?code=` can never match a null or empty stored invite_code. Comparison
 * is case-sensitive and trimmed-but-not-lowercased: generated codes are always
 * uppercase REF_ALPHABET, so a case-insensitive match would silently accept
 * lowercase variants the generator never produces.
 */
export function isValidInviteCode(
  storedCode: string | null | undefined,
  supplied: string | null | undefined
): boolean {
  if (typeof storedCode !== "string" || storedCode.length === 0) return false;
  if (typeof supplied !== "string") return false;
  return supplied.trim() === storedCode;
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
