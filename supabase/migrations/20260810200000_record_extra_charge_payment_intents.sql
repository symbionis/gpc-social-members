-- Record the PaymentIntent behind a top-up and a priced ticket-type conversion.
--
-- A booking is not one payment. The original checkout is one PaymentIntent; every top-up and
-- every priced conversion is another. Until now only the first was ever stored:
-- `event_registrations.stripe_payment_intent_id` is written on the pending→paid transition
-- (app/api/webhooks/stripe/route.ts), and the top-up and conversion branches return BEFORE
-- that write. So the money for a topped-up seat sat on a charge no row in this database named.
--
-- That was harmless while nothing refunded automatically. It stopped being harmless when the
-- admin roster began issuing Stripe refunds: refunding a topped-up seat would draw against the
-- ORIGINAL charge, and once that charge was exhausted Stripe would answer
-- `charge_already_refunded` — which the route read as "already done" and recorded as a
-- successful refund for money that never moved.
--
-- Refunds treat a booking's charges as one pool (lib/events/refund-pool.ts): one payer, one
-- card, one booking, so any charge on it can fund the refund as long as total refunded never
-- exceeds total captured. These columns are what let that pool be complete.
--
-- Nullable, and backfilled for nothing: the six top-ups predating this migration keep NULL,
-- and the pool simply falls back to the charges it does know. Five of those six were CHF 0 and
-- the sixth is on a past event, so there is no historical money to reattach. New rows get the
-- id at apply time, where the webhook already holds it.

ALTER TABLE public.event_registration_topups
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text;

ALTER TABLE public.event_ticket_type_conversions
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text;

COMMENT ON COLUMN public.event_registration_topups.stripe_payment_intent_id IS
  'The PaymentIntent that paid for this top-up. NULL on rows predating refund pooling, and on '
  'zero-value top-ups that never reached Stripe. Feeds the booking''s refundable charge pool.';

COMMENT ON COLUMN public.event_ticket_type_conversions.stripe_payment_intent_id IS
  'The PaymentIntent that paid this conversion''s delta. NULL for a zero-delta conversion, '
  'which is applied inline without checkout. Feeds the booking''s refundable charge pool.';

-- Drop an index added earlier in this series that turned out to protect a scan nobody performs.
-- `tickets_refunded_idx (event_id) WHERE cancellation_status = 'refunded'` was justified by
-- "finance and the admin roster scan settled-refund rows per event". Neither does: finance reads
-- the table unfiltered and filters in JavaScript, and the roster filters on event/slot/released.
-- It is also strictly redundant with `tickets_cancellation_idx (event_id) WHERE
-- cancellation_status IS NOT NULL`, whose predicate is a superset on the same column. A false
-- performance rationale is worse than no index, because the next reader preserves it.
DROP INDEX IF EXISTS public.tickets_refunded_idx;
