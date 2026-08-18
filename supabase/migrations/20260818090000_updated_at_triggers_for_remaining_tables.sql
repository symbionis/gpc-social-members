-- Maintain updated_at on the three tables that carry the column but never had a trigger.
--
-- 20260324101441_create_membership_schema.sql created update_updated_at() and attached it
-- to members, admin_users, membership_tiers and payments. Every table added after that
-- migration inherited the column convention but not the trigger, so on events,
-- email_settings and lounge_sessions the column has never once been written: nothing in
-- the app sets it, and without a BEFORE UPDATE trigger nothing else does either.
--
-- Found while investigating how a registration existed on an unpublished event
-- (Raclette & Wine Tasting, 2026-08-03). events.updated_at was identical to created_at on
-- all 24 rows -- including events whose seat_cap had demonstrably been edited days earlier
-- -- so the column could not confirm or refute a publish/unpublish. The answer had to be
-- inferred from application code instead.
--
-- SCOPE: this records WHEN a row last changed, not what changed or who changed it. It does
-- not give publish/unpublish attribution; that needs an audit table and is deliberately out
-- of scope here.
--
-- NO BACKFILL, by design: a synthetic stamp on existing rows would assert an edit time we
-- do not know. Rows keep created_at until their next real update, so until then
-- updated_at = created_at means "not edited since 2026-08-18", NOT "never edited".
--
-- Fires on every UPDATE, including one that changes no values -- matching the four
-- pre-existing triggers exactly rather than introducing a second, stricter convention.

CREATE TRIGGER trg_events_updated_at
  BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_email_settings_updated_at
  BEFORE UPDATE ON public.email_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_lounge_sessions_updated_at
  BEFORE UPDATE ON public.lounge_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
