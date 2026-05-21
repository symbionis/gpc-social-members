-- Door check-in: optional marketing/communication consent captured on the waiver step.
-- Nullable on purpose: NULL means "not asked" (rows created before this feature
-- existed). New check-ins always write an explicit true/false from the form, where
-- the box is ticked by default.
ALTER TABLE public.event_checkins
  ADD COLUMN marketing_consent boolean;

COMMENT ON COLUMN public.event_checkins.marketing_consent IS
  'Communication/marketing consent given at door check-in. NULL = not asked (pre-feature rows).';
