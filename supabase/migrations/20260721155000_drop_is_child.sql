-- U8 (Phase B / step B6) — drop the is_child columns. The only IRREVERSIBLE step.
-- Plan: docs/plans/2026-07-20-001-feat-ticket-naming-and-guest-self-service-plan.md
--
-- Precondition (met): U7a (#79) removed every app-side is_child read/write; U7b (#80,
-- deployed + door-scan verified 2026-07-21) removed every DB-function read/write. A live
-- dependency audit found the ONLY remaining references were the transitional
-- `event_attendees` bridge view (dropped just before this migration via the repo's
-- committed 20260622250000_drop_attendees_view.sql) and a comment. No index, constraint,
-- generated column, RLS policy, or other view/function depends on either column.
--
-- tickets first, then event_ticket_types (mirrors the plan's stated order). Not combined
-- with any other schema change.

alter table public.tickets drop column is_child;
alter table public.event_ticket_types drop column is_child;
