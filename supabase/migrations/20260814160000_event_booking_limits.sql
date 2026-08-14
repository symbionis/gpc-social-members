-- Per-event, per-rate-class ticket limits (U1).
--
-- Three nullable columns, one per rate class (mirrors price_member / invite_price /
-- price_non_member — see lib/events/pricing.ts). NULL means "use the app default" (10,
-- see lib/events/booking-limits.ts DEFAULT_BOOKING_LIMIT) — deliberately no DB default,
-- so "unset" stays a distinct, queryable state from "explicitly 10".
--
-- The CHECK bounds each column to 1..20. 20 is ABSOLUTE_MAX_TICKETS, the existing
-- per-request ceiling both purchase routes already enforce (MAX_TICKETS in the register
-- route, MAX_QTY in the top-up route) — a stored value above it could never take effect,
-- so the constraint rejects it at the source rather than silently clamping later.
--
-- ADDITIVE ONLY: three nullable columns plus a bounds CHECK. Safe to apply ahead of the
-- app code landing.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS max_tickets_member integer,
  ADD COLUMN IF NOT EXISTS max_tickets_invite integer,
  ADD COLUMN IF NOT EXISTS max_tickets_non_member integer;

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_max_tickets_member_check,
  DROP CONSTRAINT IF EXISTS events_max_tickets_invite_check,
  DROP CONSTRAINT IF EXISTS events_max_tickets_non_member_check;

ALTER TABLE public.events
  ADD CONSTRAINT events_max_tickets_member_check
    CHECK (max_tickets_member IS NULL OR max_tickets_member BETWEEN 1 AND 20),
  ADD CONSTRAINT events_max_tickets_invite_check
    CHECK (max_tickets_invite IS NULL OR max_tickets_invite BETWEEN 1 AND 20),
  ADD CONSTRAINT events_max_tickets_non_member_check
    CHECK (max_tickets_non_member IS NULL OR max_tickets_non_member BETWEEN 1 AND 20);
