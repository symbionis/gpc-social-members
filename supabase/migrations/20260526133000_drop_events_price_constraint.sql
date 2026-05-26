-- Drop the event-level price CHECK so the new ticket-types create flow works.
--
-- events_prices_required_when_registration_enabled required price_member (and,
-- for public events, price_non_member) whenever registration_enabled was true.
-- The new create flow (create_event_with_ticket_types RPC) inserts events with
-- NO price columns set — prices live on event_ticket_types now — so a
-- registration-enabled event would violate this constraint.
--
-- SAFE / ADDITIVE: this is a relaxation. Currently-deployed code sets
-- price_member in-app before insert, so dropping the CHECK does not change its
-- behaviour (its own app-level validation still runs). The per-type
-- equivalent now lives in assertEventRegistrationPriceable
-- (lib/events/ticket-types.ts), enforced on every registration-enable path.
-- This MUST be applied before/with the cutover code; the actual price-column
-- drop is the later, irreversible step (20260526140000).

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_prices_required_when_registration_enabled;
