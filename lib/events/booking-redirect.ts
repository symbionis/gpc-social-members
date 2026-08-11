// The redirect decision behind the booking page (U3 of
// docs/plans/2026-08-11-002-feat-consolidate-ticket-surfaces-plan.md). The booking page is a
// server component the repo does not unit-test (no page.test.tsx precedent anywhere under
// app/(checkin)/public/), so the branch that actually matters — which ticket an old booking
// link should now land on — is extracted here where it can be proven directly.
//
// An ordinary (non-comp) booking's manage link should now open the PAYER's own ticket manage
// page rather than the old booking page (R18, KTD2). "The payer" is whoever the registration's
// own email belongs to: match live tickets on the registration by that email, the same
// case-folded comparison lib/events/household.ts uses for siblings. A blank registration email
// falls back to the ticket seeded as `is_lead` (the payer's own attendee row — see
// supabase/migrations/20260603121000_event_registrations_phone_and_lead_seed.sql), mirroring
// household.ts's blank-email SOLO fallback.
//
// A payer who holds several live tickets on their own address (plausible — the payer can also
// be a named holder elsewhere in the party) resolves to the EARLIEST-created one, for a
// deterministic answer. The plan leaves this choice to the implementer; either "any one" or
// "earliest" satisfies R18, and earliest is the more stable pick against retries/reordering.

export interface PayerCandidateTicket {
  id: string;
  email: string | null;
  manageToken: string | null;
  isLead: boolean;
  createdAt: string;
}

export interface PayerTicket {
  id: string;
  manageToken: string;
}

/**
 * Resolve the payer's own live ticket among a registration's live tickets.
 *
 * Returns null when the payer holds no live ticket at all (cancelled, released, or never
 * minted) — the page renders an explanatory notice for that case rather than a redirect.
 */
export function resolvePayerTicket(
  registrationEmail: string | null,
  tickets: PayerCandidateTicket[]
): PayerTicket | null {
  const normalizedEmail = (registrationEmail ?? "").trim().toLowerCase();

  const candidates = normalizedEmail
    ? tickets.filter((t) => (t.email ?? "").trim().toLowerCase() === normalizedEmail)
    : tickets.filter((t) => t.isLead);

  const withToken = candidates.filter(
    (t): t is PayerCandidateTicket & { manageToken: string } =>
      typeof t.manageToken === "string" && t.manageToken.length > 0
  );
  if (withToken.length === 0) return null;

  const sorted = withToken.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const winner = sorted[0];
  return { id: winner.id, manageToken: winner.manageToken };
}
