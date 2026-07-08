-- Atomic apply of the checkout-time guest roster (U-plan 2026-07-08-002).
--
-- The Stripe webhook applies pending_roster after payment. Doing that as an
-- app-side loop of claim_ticket calls followed by a separate "clear the column"
-- UPDATE leaves a crash window: if the webhook dies after some claims but before
-- the clear, a redelivery re-runs the whole fill. claim_ticket only dedupes when a
-- contact is present, so ADULTS are safe on replay but CHILDREN (name-only, no
-- contact) get double-claimed — and name-based dedup is unsafe because two kids can
-- legitimately share a name.
--
-- This function makes fill + clear a single transaction under a row lock:
--   * a crash rolls BOTH back → pending_roster stays set → a redelivery re-applies
--     cleanly from scratch (nothing was half-applied),
--   * concurrent redeliveries serialize on the FOR UPDATE lock; the loser reads a
--     NULL roster and returns without re-claiming.
-- So the paid-path fill is genuinely run-once, children included (R7).
--
-- pending_roster shape: jsonb array of { ticket_type_id: uuid, name, email|null }.
-- Reuses claim_ticket for each guest (adults carry email; children pass null email;
-- is_child is derived inside claim_ticket from the ticket type — never passed).

CREATE OR REPLACE FUNCTION public.apply_pending_roster(
  p_registration_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_roster jsonb;
  v_guest  jsonb;
BEGIN
  -- Lock the registration row so a concurrent redelivery waits, then sees the
  -- cleared roster and no-ops.
  SELECT pending_roster INTO v_roster
  FROM public.event_registrations
  WHERE id = p_registration_id
  FOR UPDATE;

  IF v_roster IS NULL THEN
    RETURN;
  END IF;

  FOR v_guest IN SELECT * FROM jsonb_array_elements(v_roster)
  LOOP
    -- Best-effort per guest: claim_ticket returns a status (e.g. 'type_full') it
    -- never raises on, so a slot that can't be filled simply stays 'issued' and is
    -- reachable via the self-registration link. is_child is derived from the type.
    PERFORM public.claim_ticket(
      p_registration_id,
      v_guest ->> 'name',
      v_guest ->> 'email',
      NULL,            -- p_phone_e164
      NULL,            -- p_language
      NULL,            -- p_waiver_version
      false,           -- p_waiver_accepted
      false,           -- p_marketing_consent (a booker can't opt a guest in)
      (v_guest ->> 'ticket_type_id')::uuid
    );
  END LOOP;

  -- Clear in the SAME transaction as the claims above → fill + clear commit together.
  UPDATE public.event_registrations
  SET pending_roster = NULL
  WHERE id = p_registration_id;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_pending_roster(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_pending_roster(uuid) TO service_role;
