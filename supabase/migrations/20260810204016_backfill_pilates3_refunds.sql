-- BACKFILL — record four Stripe refunds that were never mirrored into the app.
--
-- APPLIED to production on 2026-08-10 with the owner's explicit approval, after the self-check
-- below passed. It edits financial records, which is why it was held back from the schema
-- migration it shipped alongside and applied separately.
--
-- Every row was verified against the LIVE Stripe account (acct_1SptJdBarHU2p05x) on 2026-08-10
-- by reading the PaymentIntent and its refunds; the Stripe refund id is recorded on each row so
-- the claim can be re-checked rather than trusted. Post-apply the event reconciles exactly:
-- CHF 960 gross, CHF 560 refunded over 7 seats, CHF 400 net — matching Stripe to the centime.
--
-- Why it is needed: refunds were issued in the Stripe dashboard, and the separate "mark
-- refunded" step in the app was applied inconsistently. Pilates & Polo 3.0 charged CHF 960 and
-- refunded CHF 560, but the app recorded only three refunded seats and no amounts — so finance
-- reported CHF 960 of revenue against CHF 400 actually collected. The accompanying schema
-- migration makes finance net refunds out; this makes the historical rows tell the truth.
--
--   ref            payer                  Stripe refund                    CHF   seats
--   EV-68A9WE6U    Souade Amiar           re_3TuXSyBarHU2p05x1TXCnMV9       80   1 (already marked)
--   EV-YGQWLCX4    Fatima Cubukcu         pyr_1TxlcaBarHU2p05x2fd02PiF      80   1 (already marked)
--   EV-QUMG4SD4    Charlotte De Hantsett. re_3TuRwhBarHU2p05x1NWH9CJx      240   3 (1 marked, 2 missed)
--   EV-LQNA63SA    Eya Turki              pyr_1Tyw63BarHU2p05xKYxMKa2T     160   2 (none marked)
--                                                                         ----
--                                                                          560
--
-- Existing `cancellation_refunded_at` values are left untouched: they record when an admin
-- marked the refund in the app, and rewriting them to the Stripe timestamp would destroy that
-- audit trail for no gain. Rows being marked for the first time get the Stripe refund time,
-- which is when the money actually moved.
--
-- Released tickets (tombstones left behind when a guest slot was re-issued) are excluded — they
-- are not live seats and must not be counted as refunded.

BEGIN;

-- 1. Souade Amiar — already 'refunded', missing only the amount and the Stripe reference.
UPDATE public.tickets t
SET refund_amount_chf = 80.00,
    stripe_refund_id  = 're_3TuXSyBarHU2p05x1TXCnMV9'
FROM public.event_registrations r
WHERE r.id = t.registration_id
  AND r.reference_code = 'EV-68A9WE6U'
  AND t.cancellation_status = 'refunded'
  AND t.refund_amount_chf IS NULL;

-- 2. Fatima Cubukcu — same shape.
UPDATE public.tickets t
SET refund_amount_chf = 80.00,
    stripe_refund_id  = 'pyr_1TxlcaBarHU2p05x2fd02PiF'
FROM public.event_registrations r
WHERE r.id = t.registration_id
  AND r.reference_code = 'EV-YGQWLCX4'
  AND t.cancellation_status = 'refunded'
  AND t.refund_amount_chf IS NULL;

-- 3. Charlotte De Hantsetters — the whole PaymentIntent (CHF 240, 3 seats) was refunded, but
--    only her own lead ticket was marked. Fill that one, then mark the two live seats that were
--    refunded with it.
UPDATE public.tickets t
SET refund_amount_chf = 80.00,
    stripe_refund_id  = 're_3TuRwhBarHU2p05x1NWH9CJx'
FROM public.event_registrations r
WHERE r.id = t.registration_id
  AND r.reference_code = 'EV-QUMG4SD4'
  AND t.cancellation_status = 'refunded'
  AND t.refund_amount_chf IS NULL;

UPDATE public.tickets t
SET cancellation_status     = 'refunded',
    cancellation_refunded_at = TIMESTAMPTZ '2026-07-27T10:20:57Z',
    refund_amount_chf        = 80.00,
    stripe_refund_id         = 're_3TuRwhBarHU2p05x1NWH9CJx'
FROM public.event_registrations r
WHERE r.id = t.registration_id
  AND r.reference_code = 'EV-QUMG4SD4'
  AND t.cancellation_status IS NULL
  AND t.released_at IS NULL;

-- 4. Eya Turki — CHF 160 refunded in full on 30 July with no trace in the app at all. She
--    rebooked an hour later (EV-MKNPPDY8), which is the CHF 160 that WAS kept; that booking is
--    deliberately untouched.
UPDATE public.tickets t
SET cancellation_status      = 'refunded',
    cancellation_refunded_at = TIMESTAMPTZ '2026-07-30T15:42:11Z',
    refund_amount_chf        = 80.00,
    stripe_refund_id         = 'pyr_1Tyw63BarHU2p05xKYxMKa2T'
FROM public.event_registrations r
WHERE r.id = t.registration_id
  AND r.reference_code = 'EV-LQNA63SA'
  AND t.cancellation_status IS NULL
  AND t.released_at IS NULL;

-- Self-check: the event's recorded refunds must now equal the CHF 560 Stripe actually returned,
-- across exactly 7 seats. If the live data has moved since it was verified, fail the migration
-- rather than commit a number nobody checked.
DO $$
DECLARE
  v_total numeric(10,2);
  v_seats integer;
BEGIN
  SELECT COALESCE(SUM(t.refund_amount_chf), 0), COUNT(*)
  INTO v_total, v_seats
  FROM public.tickets t
  JOIN public.event_registrations r ON r.id = t.registration_id
  JOIN public.events e ON e.id = r.event_id
  WHERE e.title = 'Pilates & Polo 3.0'
    AND t.cancellation_status = 'refunded';

  IF v_total <> 560.00 OR v_seats <> 7 THEN
    RAISE EXCEPTION
      'Pilates & Polo 3.0 refund backfill mismatch: got CHF % over % seats, expected CHF 560.00 over 7',
      v_total, v_seats;
  END IF;
END $$;

COMMIT;
