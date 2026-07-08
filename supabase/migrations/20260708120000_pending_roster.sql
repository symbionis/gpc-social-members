-- Checkout-time nominative roster (U-plan 2026-07-08-002).
--
-- The public checkout now lets the booker name each ticket (name + email) up
-- front. Free registrations apply those names synchronously in the register
-- route; paid registrations must carry them across the Stripe round-trip, so we
-- stash the booker-entered guest roster here and the Stripe webhook applies it
-- after payment (seed → mint → fill), then clears this column.
--
-- Shape: jsonb array of { ticket_type_id: uuid, name: text, email: text|null }.
-- email is null for children (name-only). The lead is NOT stored here — the lead
-- is seeded from lead_ticket_type_id via seed_lead_attendee; only guest rows live
-- in pending_roster.
--
-- TRANSIENT PII: holds third-party guest names + emails supplied by an
-- unauthenticated booker. Cleared on successful fill. An abandoned paid checkout
-- is swept by the checkout.session.expired webhook handler, which nulls this
-- column so guest PII does not linger indefinitely.
--
-- ADDITIVE (nullable column). NB: dev and prod share one Supabase database, so
-- applying this mutates production immediately.

ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS pending_roster jsonb;

COMMENT ON COLUMN public.event_registrations.pending_roster IS
  'Transient booker-entered guest roster captured at checkout: jsonb array of '
  '{ ticket_type_id, name, email|null }. Applied to issued tickets after '
  'confirmation (free path inline, paid path in the Stripe webhook) then set '
  'NULL. Swept to NULL on checkout.session.expired. Guest PII — not for long-term '
  'storage; the named tickets themselves carry the durable record.';
