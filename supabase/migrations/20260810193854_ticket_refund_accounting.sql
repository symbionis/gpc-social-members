-- Event refund accounting — make a cancelled ticket say what happened to the money.
--
-- Before this, `cancellation_status` was ('requested','refunded') and carried no amount, so
-- finance had nothing to subtract and reported event revenue GROSS of refunds. On Pilates &
-- Polo 3.0 that overstated collected revenue by CHF 560 on CHF 960 charged (verified against
-- live Stripe): two refunds issued in the Stripe dashboard were never mirrored back into the
-- app at all, and a third was mirrored for one ticket when the whole PaymentIntent had been
-- refunded.
--
-- The state machine is deliberately UNCHANGED: 'requested' → 'refunded' still covers every
-- cancellation. A third "cancelled but payment kept" state was considered and rejected — the
-- club's process is that a cancelling guest gets refunded, and across the whole history of the
-- database there are three cancellations, all paid, all refunded, none comped. A seat with
-- nothing to refund (a comp, a free booking) closes as 'refunded' at CHF 0 rather than needing
-- an outcome of its own. If a no-refund policy ever appears, widening the CHECK then is a
-- one-line migration; carrying an unused state now is not.
--
-- What this migration adds is `refund_amount_chf` + `stripe_refund_id`: what actually moved,
-- and the Stripe object proving it. Finance prefers this stored amount and falls back to the
-- registration's snapshotted per-ticket price when it is NULL, so tickets refunded before this
-- migration still net out correctly without a backfill.

-- What the refund was worth, and its Stripe receipt.
--
-- `refund_amount_chf` is nullable on purpose. A refunded ticket with NULL means "refunded,
-- amount not recorded" — true of every row predating this migration — and finance derives the
-- value from the registration's item line rather than dropping it silently. New refunds always
-- write it, because the route now issues the Stripe refund itself and knows the exact figure.
--
-- `stripe_refund_id` is the audit trail: it ties the row to a `re_…`/`pyr_…` object so a
-- reconciliation against Stripe can be exact rather than by-amount guesswork. It stays NULL for
-- a ticket healed from an out-of-band dashboard refund, where the app never held the id.
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS refund_amount_chf numeric(10,2),
  ADD COLUMN IF NOT EXISTS stripe_refund_id text;

COMMENT ON COLUMN public.tickets.cancellation_status IS
  'NULL = live. ''requested'' = holder cancelled, refund not yet processed (still counts as '
  'revenue, but as an open liability). ''refunded'' = settled, excluded from revenue — a seat '
  'with nothing to refund settles here at CHF 0. Both non-NULL values free the seat.';

COMMENT ON COLUMN public.tickets.refund_amount_chf IS
  'CHF actually refunded for this ticket. NULL on rows refunded before refund accounting '
  'existed; finance falls back to the registration item line''s snapshotted unit price.';

COMMENT ON COLUMN public.tickets.stripe_refund_id IS
  'Stripe Refund id (re_…/pyr_…) for this ticket. NULL when the refund was issued outside the '
  'app and the row was reconciled after the fact.';

-- Partial index: finance and the admin roster both scan only settled-refund rows per event.
-- The overwhelming majority of tickets are live (NULL) and stay out of the index entirely.
CREATE INDEX IF NOT EXISTS tickets_refunded_idx
  ON public.tickets (event_id)
  WHERE cancellation_status = 'refunded';
