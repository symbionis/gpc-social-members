-- Waitlist paid offer flow: offer state on event_waitlist + a link from a
-- registration back to the waitlist entry it redeemed.
--
-- See docs/plans/2026-08-11-001-feat-waitlist-paid-offer-flow-plan.md (U1)
--
-- SHARED DEV/PROD DATABASE: this applies to production immediately.
-- Additive only. No backfill, no data repair — U2/R14 make repair an admin
-- action, not a migration concern.

-- offer_token: per-entry secret minted when an admin offers a seat. Unguessable
--   (24 CSPRNG bytes, base64url — see generateSelfRegToken()), resolved
--   server-side only (event_waitlist has RLS with no policies). Cleared on
--   withdraw or left as-is on redemption; never regenerated on resend.
-- offered_at / offered_by: when and which admin most recently sent an offer.
-- offer_sent_count: how many times Offer/Resend has fired for this entry.
ALTER TABLE public.event_waitlist ADD COLUMN IF NOT EXISTS offer_token text;
ALTER TABLE public.event_waitlist ADD COLUMN IF NOT EXISTS offered_at timestamptz;
ALTER TABLE public.event_waitlist ADD COLUMN IF NOT EXISTS offered_by uuid
  REFERENCES public.admin_users(id) ON DELETE SET NULL;
ALTER TABLE public.event_waitlist ADD COLUMN IF NOT EXISTS offer_sent_count integer NOT NULL DEFAULT 0;

-- A token is a live credential; two entries must never share one.
CREATE UNIQUE INDEX IF NOT EXISTS event_waitlist_offer_token_unique
  ON public.event_waitlist (offer_token)
  WHERE offer_token IS NOT NULL;

-- waitlist_entry_id: which waitlist entry (if any) this registration redeemed.
-- Nullable — most registrations don't originate from an offer. SET NULL so a
-- deleted waitlist entry never orphans a paid registration; the registration
-- is the record of truth once payment lands (KTD3).
ALTER TABLE public.event_registrations ADD COLUMN IF NOT EXISTS waitlist_entry_id uuid
  REFERENCES public.event_waitlist(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS event_registrations_waitlist_entry_id_idx
  ON public.event_registrations (waitlist_entry_id)
  WHERE waitlist_entry_id IS NOT NULL;

-- Rollback (manual; no down-migration):
--   DROP INDEX IF EXISTS public.event_registrations_waitlist_entry_id_idx;
--   ALTER TABLE public.event_registrations DROP COLUMN IF EXISTS waitlist_entry_id;
--   DROP INDEX IF EXISTS public.event_waitlist_offer_token_unique;
--   ALTER TABLE public.event_waitlist DROP COLUMN IF EXISTS offer_sent_count;
--   ALTER TABLE public.event_waitlist DROP COLUMN IF EXISTS offered_by;
--   ALTER TABLE public.event_waitlist DROP COLUMN IF EXISTS offered_at;
--   ALTER TABLE public.event_waitlist DROP COLUMN IF EXISTS offer_token;
-- All safe: every new column is nullable or has a default, and both indexes
-- can be recreated.
