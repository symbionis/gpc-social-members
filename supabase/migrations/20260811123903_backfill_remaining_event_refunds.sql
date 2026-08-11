-- Backfill the event refunds Stripe issued that the app never recorded (CHF 270).
--
-- APPLIED to production 2026-08-11 with the owner's approval. Data-only; it edits financial
-- records, which is why it carries the self-check below.
--
-- Audited against Stripe, not against our own tables — the whole reason the Pilates & Polo 3.0
-- figure was wrong is that a read-only query over our own flags returns a confidently wrong
-- number when the flags are what is missing. `GET /v1/refunds` returns 12 refunds lifetime;
-- this closes the only four belonging to live event registrations and absent from finance:
--
--   EV-EUW88758  Vera Legros       Polo & Banya 2.0   CHF 100  re_3Tl4IoBarHU2p05x1ngQrBhS
--   EV-KXZHSY67  Lana Victoria     Polo & Banya 2.0   CHF  50  re_3ToOn2BarHU2p05x1yiPRmu4
--   EV-UQEGNVML  Freya Fawzy       Bohemian Chic      CHF  40  re_3TqZcCBarHU2p05x1ranFvEB
--   EV-YCMSBZQJ  Charline Fuhrer   Season Kick-Off    CHF  80  pyr_1Tl7EbBarHU2p05xaSog2po8
--
-- All four are FULL refunds of the whole booking, on events that have already happened, so no
-- seat is being freed for resale.
--
-- The other eight are deliberately untouched, each for a reason:
--   * 4 (CHF 560) are Pilates & Polo 3.0, already backfilled by 20260810204016.
--   * 2 (CHF 220) belong to an event deleted along with its registrations. With no rows on
--     either side they contribute nothing to gross and nothing to refunds, so finance already
--     nets them to zero. Re-creating rows would invent revenue nothing claims.
--   * 2 (EUR 210) are Luma ("Air, Fire & Steam", metadata luma_payment_started_api_id) — a
--     different platform's ledger, never in these books.
--
-- Timestamps come from each Stripe refund's `created`, when the money actually moved. COALESCE
-- preserves any existing value rather than rewriting an audit trail.

BEGIN;

-- 1. Vera Legros — CHF 100 across 2 seats at CHF 50.
UPDATE public.tickets t
SET cancellation_status       = 'refunded',
    cancellation_requested_at = COALESCE(t.cancellation_requested_at, to_timestamp(1782994809)),
    cancellation_refunded_at  = COALESCE(t.cancellation_refunded_at,  to_timestamp(1782994809)),
    refund_amount_chf         = 50.00,
    stripe_refund_id          = 're_3Tl4IoBarHU2p05x1ngQrBhS'
FROM public.event_registrations r
WHERE r.id = t.registration_id
  AND r.reference_code = 'EV-EUW88758'
  AND t.cancellation_status IS NULL
  AND t.released_at IS NULL;

-- 2. Lana Victoria — CHF 50, one seat.
UPDATE public.tickets t
SET cancellation_status       = 'refunded',
    cancellation_requested_at = COALESCE(t.cancellation_requested_at, to_timestamp(1782995007)),
    cancellation_refunded_at  = COALESCE(t.cancellation_refunded_at,  to_timestamp(1782995007)),
    refund_amount_chf         = 50.00,
    stripe_refund_id          = 're_3ToOn2BarHU2p05x1yiPRmu4'
FROM public.event_registrations r
WHERE r.id = t.registration_id
  AND r.reference_code = 'EV-KXZHSY67'
  AND t.cancellation_status IS NULL
  AND t.released_at IS NULL;

-- 3. Freya Fawzy — CHF 40, one seat.
UPDATE public.tickets t
SET cancellation_status       = 'refunded',
    cancellation_requested_at = COALESCE(t.cancellation_requested_at, to_timestamp(1783947449)),
    cancellation_refunded_at  = COALESCE(t.cancellation_refunded_at,  to_timestamp(1783947449)),
    refund_amount_chf         = 40.00,
    stripe_refund_id          = 're_3TqZcCBarHU2p05x1ranFvEB'
FROM public.event_registrations r
WHERE r.id = t.registration_id
  AND r.reference_code = 'EV-UQEGNVML'
  AND t.cancellation_status IS NULL
  AND t.released_at IS NULL;

-- 4. Charline Fuhrer — CHF 80. Season Kick-Off (31 May) predates per-ticket minting, so this
--    booking has no ticket row at all, and event refunds are computed from tickets. Mint the
--    seat it always had, already marked refunded.
--
--    Deliberately NO credential_token: a refunded seat must never carry an admission token,
--    and the column is nullable precisely so a row can exist without one. The alternative —
--    setting the registration's status to 'refunded' — would drop the CHF 80 out of gross
--    entirely, reporting that the sale never happened rather than that it was refunded.
INSERT INTO public.tickets (
  event_id, registration_id, ticket_type_id, name, email, is_lead, slot_status, created_at,
  cancellation_status, cancellation_requested_at, cancellation_refunded_at,
  refund_amount_chf, stripe_refund_id
)
SELECT r.event_id, r.id, i.ticket_type_id, r.name, r.email, true, 'claimed', r.created_at,
       'refunded', to_timestamp(1782132353), to_timestamp(1782132353),
       80.00, 'pyr_1Tl7EbBarHU2p05xaSog2po8'
FROM public.event_registrations r
JOIN public.event_registration_items i ON i.registration_id = r.id
WHERE r.reference_code = 'EV-YCMSBZQJ'
  AND NOT EXISTS (
    SELECT 1 FROM public.tickets t WHERE t.registration_id = r.id AND t.released_at IS NULL
  );

-- Self-check, in two parts.
--
-- The first pass of this migration asserted a LIFETIME total of CHF 830 and failed on 950. The
-- extra CHF 120 is a synthetic refund on '[DEMO] Waitlist Offer Walkthrough', a seeded demo
-- (DEMOAAA* refs, @example.com addresses, no PaymentIntents) that also contributes CHF 1,000 of
-- fake gross. That is a real problem and is being handled separately — the point here is that
-- the assertion is scoped to REAL bookings rather than widened until it passes, because
-- widening it would have silently blessed the demo's fake money as expected.
DO $$
DECLARE
  v_new_total  numeric(10,2);
  v_new_seats  integer;
  v_real_total numeric(10,2);
BEGIN
  SELECT COALESCE(SUM(t.refund_amount_chf), 0), COUNT(*)
  INTO v_new_total, v_new_seats
  FROM public.tickets t
  JOIN public.event_registrations r ON r.id = t.registration_id
  WHERE r.reference_code IN ('EV-EUW88758','EV-KXZHSY67','EV-UQEGNVML','EV-YCMSBZQJ')
    AND t.cancellation_status = 'refunded'
    AND t.released_at IS NULL;

  IF v_new_total <> 270.00 OR v_new_seats <> 5 THEN
    RAISE EXCEPTION
      'Event refund backfill mismatch: got CHF % over % seats, expected CHF 270.00 over 5',
      v_new_total, v_new_seats;
  END IF;

  -- Every refund now recorded against a booking that has a real Stripe refund id must total
  -- the CHF 830 Stripe actually returned for events (560 prior + 270 here).
  SELECT COALESCE(SUM(t.refund_amount_chf), 0) INTO v_real_total
  FROM public.tickets t
  WHERE t.cancellation_status = 'refunded'
    AND t.released_at IS NULL
    AND t.stripe_refund_id IS NOT NULL;

  IF v_real_total <> 830.00 THEN
    RAISE EXCEPTION
      'Stripe-backed event refunds total CHF %, expected CHF 830.00', v_real_total;
  END IF;
END $$;

COMMIT;
