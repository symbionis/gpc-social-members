-- R28 — retire the ticket-forwarding flow.
--
-- The lead "forward a batch to a delegate" flow is superseded by the per-ticket
-- manage-token household model (U9–U12): a ticket at a different email already gets its
-- own QR email + manage link, so a separate forward step is redundant. The route
-- (bookings/[token]/forward), the delegate batch page + its fill route, the ForwardedTickets
-- component, and the event-ticket-forward Postmark template are all removed in this change.
--
-- These two SECURITY DEFINER RPCs were called ONLY by those deleted routes, so they are now
-- callerless. The `tickets.batch_token` column is KEPT — 44 historical tickets on past events
-- carry it, and it still reads as a harmless provenance marker; only the write path is gone.

DROP FUNCTION IF EXISTS public.forward_ticket_batch(p_manage_token text, p_ticket_ids uuid[]);

DROP FUNCTION IF EXISTS public.fill_batch_ticket(
  p_batch_token text, p_ticket_id uuid, p_name text, p_email text, p_phone_e164 text,
  p_language text, p_waiver_version text, p_waiver_accepted boolean, p_marketing_consent boolean
);
