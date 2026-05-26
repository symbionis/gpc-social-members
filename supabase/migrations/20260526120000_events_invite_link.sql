-- Add the private invite-link columns to events.
--
-- invite_code:  a per-event secret appended to the public event URL
--               (/public/events/[id]?code=XXX). A valid code lets a logged-out
--               visitor register for a members_only event, bypassing the
--               members-only gate in app/api/events/[id]/register/route.ts.
--               Multi-use; "regenerate = revoke" is implemented by overwriting
--               this column (see POST /api/admin/events/[id]/invite-code).
-- invite_price: the flat guest price (CHF) charged to a logged-out invitee.
--               members_only events deliberately carry a NULL price_non_member
--               (constraint events_prices_required_when_registration_enabled
--               requires only price_member for them), so the invite flow needs
--               its own price column. 0 = free for invited guests. A logged-in
--               active member still pays price_member, decided by session.
--
-- Both columns are nullable and OWNED solely by the invite-code endpoint
-- (POST regenerates invite_code, PATCH sets invite_price). The bulk event
-- update route and the settings PATCH route must never write them.
--
-- DEPLOY ORDERING: purely additive nullable columns — safe to apply before the
-- code that reads them ships. No existing code references these columns, so
-- older deployments are unaffected. NB: dev and prod share one Supabase
-- database, so applying this locally mutates production schema immediately.
-- ADD COLUMN (nullable, no default) is metadata-only — no table rewrite.

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS invite_code text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS invite_price numeric(10,2);
