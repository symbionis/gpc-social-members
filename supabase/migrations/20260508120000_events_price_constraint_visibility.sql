-- Relax the events price-required CHECK constraint so members_only events
-- can have a null price_non_member when registration is enabled.
--
-- The previous constraint required both price_member AND price_non_member
-- whenever registration_enabled was true, with no visibility carve-out, so
-- toggling a registration-enabled event from public to members_only failed
-- with a 23514 check_violation.
--
-- New rule:
--   registration_enabled = false  -> no price requirement
--   registration_enabled = true  AND visibility = 'public'        -> both prices required
--   registration_enabled = true  AND visibility = 'members_only'  -> only price_member required

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_prices_required_when_registration_enabled;

ALTER TABLE public.events
  ADD CONSTRAINT events_prices_required_when_registration_enabled
  CHECK (
    registration_enabled = false
    OR (
      price_member IS NOT NULL
      AND (
        visibility = 'members_only'
        OR price_non_member IS NOT NULL
      )
    )
  );
