-- FEAT-41 follow-up — drop the transitional event_attendees view.
--
-- The rename migration (20260622170000_rename_attendees_to_tickets) created a
-- security_invoker view aliasing event_attendees -> tickets to bridge the
-- apply->redeploy gap, so code still referencing the old name kept working. The new
-- code is now deployed and references public.tickets + the new RPCs directly, so the
-- bridge is no longer needed.
--
-- DEPLOY NOTE: apply this to prod only AFTER confirming the new build is healthy under
-- normal traffic (ideally after the first real event). Dropping it early is harmless
-- to the new code but removes the safety net for an old-code rollback.

drop view if exists public.event_attendees;
