-- The payer's own ticket was being created without a manage_token.
--
-- 20260721170000_ticket_manage_token.sql introduced per-ticket manage_tokens: it added the
-- column, backfilled every existing row, and patched mint_registration_tickets to mint one
-- on each newly-issued ticket. But tickets have TWO insert paths, and it only patched one.
-- seed_lead_attendee — which creates the purchaser's own 'claimed' ticket at checkout,
-- before mint runs — was missed, so every lead ticket created since has had a null
-- manage_token. 26 live ones at the time of writing.
--
-- That stayed invisible while the lead managed their booking through the REGISTRATION
-- manage_token on the booking page. Consolidating the ticket surfaces made it user-facing
-- in two places at once:
--
--   * The grouped ticket email takes its manage link from any ticket in the recipient's
--     email group (lib/email/household-tickets.ts). The payer is normally alone in theirs,
--     so with no token on their own ticket the link resolved to null and the email arrived
--     with no manage button — while every named guest's email had one.
--   * The retired booking page redirects the payer to their own ticket page via
--     resolvePayerTicket (lib/events/booking-redirect.ts), which only considers tickets
--     carrying a manage_token. With none, it returns null and the payer got the
--     "this booking's ticket isn't currently active" notice instead of a redirect.
--
-- Net effect: the payer had no route to their own manage page at all.
--
-- Uses gen_url_token() for the manage_token, matching mint_registration_tickets. The
-- credential_token keeps its own inline generation, unchanged from the live definition —
-- the only change to this function is the added column and value.

create or replace function public.seed_lead_attendee(
  p_registration_id uuid,
  p_phone_e164 text default null::text
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
BEGIN
  INSERT INTO public.tickets
    (event_id, registration_id, member_id, name, email, phone_e164, is_lead,
     slot_status, ticket_type_id, credential_token, manage_token)
  SELECT r.event_id, r.id, r.member_id, r.name, lower(trim(r.email)),
         COALESCE(p_phone_e164, r.phone_e164), true, 'claimed', r.lead_ticket_type_id,
         replace(replace(encode(extensions.gen_random_bytes(24), 'base64'), '+', '-'), '/', '_'),
         public.gen_url_token()
  FROM public.event_registrations r
  WHERE r.id = p_registration_id
    AND r.status IN ('paid', 'free')
    AND trim(COALESCE(r.name, '')) <> ''
    AND trim(COALESCE(r.email, '')) <> ''
    AND NOT EXISTS (
      SELECT 1 FROM public.tickets a WHERE a.registration_id = r.id AND a.is_lead = true
    );
END;
$function$;

-- Backfill the tickets already created without one. gen_url_token() is volatile, so this
-- produces a distinct token per row; the tickets_manage_token_uniq partial unique index
-- (WHERE manage_token IS NOT NULL) enforces that. Scoped to live rows for the same reason
-- the original backfill was: a released tombstone needs no manage link.
update public.tickets
  set manage_token = public.gen_url_token()
  where manage_token is null
    and released_at is null;
