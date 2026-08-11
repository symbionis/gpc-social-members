-- A top-up owns the names it bought (fixes a shared-staging-slot race).
--
-- `event_registrations.pending_roster` was built as the ORIGINAL checkout's staging
-- slot: the register route stashes the booker's guest names there before payment, and
-- the Stripe webhook applies+clears them atomically (20260708130000_apply_pending_roster).
-- One producer, one consumer.
--
-- U6 (top-ups) added a SECOND producer writing the same column on an already-'paid'
-- registration, which opens two ways to lose a paid seat's name:
--
--   1. Redelivery of the ORIGINAL checkout session. The webhook's paid short-circuit
--      gates on `alreadyPaid AND pending_roster IS NULL` (deliberately — it is how a
--      mid-crash first delivery recovers). While a top-up's names sit staged, that gate
--      fails, execution falls through, and the generic fill consumes the TOP-UP's names
--      against the pre-top-up slot set, then clears. The top-up's own webhook then mints
--      its seats with an empty roster: unnamed, contactless seats.
--   2. Two concurrent top-ups on one booking. The second stash overwrites the first's
--      names outright, so the first top-up's seats mint unnamed.
--
-- Both are the same defect: a single unkeyed slot with two producers, consumed by a
-- handler keyed only on the registration. The fix is ownership, not a bigger guard —
-- the names belong to the top-up that bought them, so they live on the top-up row.
-- After this, `event_registrations.pending_roster` is once again single-producer.
--
-- pending_roster shape is unchanged: jsonb array of { ticket_type_id, name, email|null }.

ALTER TABLE public.event_registration_topups
  ADD COLUMN IF NOT EXISTS pending_roster jsonb;

COMMENT ON COLUMN public.event_registration_topups.pending_roster IS
  'Guest names staged before this top-up''s checkout, applied and cleared by apply_topup_roster. NULL once applied (or for top-ups predating this column).';

-- Atomic apply of ONE top-up's staged roster. Mirrors apply_pending_roster: fill and
-- clear commit together under the parent registration's row lock, so a crash rolls both
-- back (a redelivery re-applies cleanly) and concurrent redeliveries serialize, with the
-- loser reading a cleared roster and no-oping.
--
-- Returns a status rather than void so the caller can distinguish "nothing staged" from
-- "applied" — the webhook uses that to fall back to the legacy registration-level slot
-- for top-ups that were already in flight when this shipped.
CREATE OR REPLACE FUNCTION public.apply_topup_roster(
  p_topup_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg_id uuid;
  v_roster jsonb;
  v_guest  jsonb;
BEGIN
  SELECT registration_id INTO v_reg_id
  FROM public.event_registration_topups
  WHERE id = p_topup_id;

  IF v_reg_id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  -- Lock the PARENT registration, not the top-up row: claim_ticket takes exactly this
  -- lock as its first statement, and every other roster path locks it too, so this is
  -- what serializes them against each other.
  PERFORM 1 FROM public.event_registrations WHERE id = v_reg_id FOR UPDATE;

  -- Re-read under the lock — a concurrent redelivery may have cleared it.
  SELECT pending_roster INTO v_roster
  FROM public.event_registration_topups
  WHERE id = p_topup_id;

  IF v_roster IS NULL THEN
    RETURN jsonb_build_object('status', 'no_roster');
  END IF;

  FOR v_guest IN SELECT * FROM jsonb_array_elements(v_roster)
  LOOP
    -- Best-effort per guest, as in apply_pending_roster: claim_ticket returns a status
    -- it never raises on, so a seat that cannot be filled stays 'issued' rather than
    -- aborting the whole apply.
    PERFORM public.claim_ticket(
      v_reg_id,
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

  -- Clear in the SAME transaction as the claims above.
  UPDATE public.event_registration_topups
  SET pending_roster = NULL
  WHERE id = p_topup_id;

  RETURN jsonb_build_object('status', 'applied');
END;
$$;

REVOKE ALL ON FUNCTION public.apply_topup_roster(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_topup_roster(uuid) TO service_role;
