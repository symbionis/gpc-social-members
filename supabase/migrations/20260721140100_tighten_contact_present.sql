-- U5 (Phase B / step B3) — tighten tickets_contact_present: drop the `is_child = true`
-- disjunct. Plan: docs/plans/2026-07-20-001-feat-ticket-naming-and-guest-self-service-plan.md
--
-- Apply AFTER 20260721140000_rpcs_drop_child_exception so no RPC can still insert a
-- contactless child row against the tightened predicate. Audited 2026-07-21: zero
-- existing rows would violate the tightened constraint (the 5 contactless child tickets
-- are all checked-in; the remaining contactless rows are comp guests kept by is_comp),
-- so VALIDATE passes. is_comp stays — comp guests are legitimately name-only.
--
-- NOT VALID then VALIDATE splits the exclusive-lock table rewrite from the row scan.

alter table public.tickets drop constraint tickets_contact_present;

alter table public.tickets add constraint tickets_contact_present check (
  slot_status = any (array['unclaimed'::text, 'issued'::text])
  or email is not null
  or phone_e164 is not null
  or checked_in_at is not null
  or is_comp = true
) not valid;

alter table public.tickets validate constraint tickets_contact_present;
