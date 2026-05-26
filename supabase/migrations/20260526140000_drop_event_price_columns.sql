-- Cutover phase 3 (IRREVERSIBLE): drop the per-event price columns now that
-- every reader and writer uses event_ticket_types instead.
--
-- *** DO NOT APPLY until ALL of the following hold: ***
--   1. The cutover code (ticket-types API, register API, admin editor, agent
--      routes, pages, email) is DEPLOYED to production. Until then the live
--      app still reads these columns and dropping them would 500 production.
--   2. A fresh full database backup / PITR restore point has been taken
--      immediately beforehand (there are no down-migrations).
--   3. In-flight `pending` checkouts have drained or been back-backfilled, and
--      the zero-items monitoring count is reconciled (see the plan's rollout).
--
-- The price-required-when-registration-enabled rule that this constraint
-- enforced now lives per-type in assertEventRegistrationPriceable
-- (lib/events/ticket-types.ts), called by every registration-enable path.
--
-- NB: events.invite_code is RETAINED (still used by the invite link); only the
-- three price columns and the constraint are removed.

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_prices_required_when_registration_enabled;

ALTER TABLE public.events DROP COLUMN IF EXISTS price_member;
ALTER TABLE public.events DROP COLUMN IF EXISTS price_non_member;
ALTER TABLE public.events DROP COLUMN IF EXISTS invite_price;
