-- Roster applies must report the guests they could not name.
--
-- Both apply functions loop `PERFORM claim_ticket(...)` and discard a return value that
-- carries 'full', 'type_full', 'invalid', 'inactive', 'invalid_input' — and, most
-- importantly, `already: true`, which means the guest matched a seat already named on this
-- booking and NO new seat was consumed. The loop then clears pending_roster unconditionally
-- and reports success.
--
-- So a partial or total failure to name looked identical to a clean apply, and the evidence
-- was deleted in the same transaction: the seat is 'issued', the column is NULL, and nothing
-- was written anywhere. The only discovery mechanism was a person at the gate holding a
-- ticket with no name on it.
--
-- The clear stays unconditional — that is what makes replay safe, and changing it would
-- trade a visible problem for a redelivery loop. What changes is that the outcome is now
-- reported: apply_topup_roster returns the unclaimed guests to its caller, and both
-- functions RAISE WARNING so the failure lands in the Postgres log even on the paths whose
-- caller cannot see a return value.
--
-- APPLIED to production 2026-08-11, then exercised against a throwaway fixture in a
-- rolled-back transaction (the DO-block pattern in
-- docs/solutions/best-practices/verify-security-definer-rpc-do-block-rollback.md).
-- ALL_PASS on four assertions: a clean apply reports an empty `unclaimed`; naming the SAME
-- identity onto a second seat still returns 'applied' but now REPORTS that guest by name;
-- and the second seat is verifiably left open. That last case is the identity collision
-- that was previously silent — `parseAttendeeInput` only dedupes within one order, so a
-- lead topping up under a name already on the booking paid for a seat nothing would ever
-- name. The top-up route now refuses it up front (lib/events/attendee-input.ts,
-- collidesWithClaimed); this is the backstop for every other path.

CREATE OR REPLACE FUNCTION public.apply_topup_roster(
  p_topup_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg_id    uuid;
  v_roster    jsonb;
  v_guest     jsonb;
  v_res       jsonb;
  v_unclaimed jsonb := '[]'::jsonb;
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
    v_res := public.claim_ticket(
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
    -- `already: true` counts as unclaimed on purpose: it means this guest matched a seat
    -- that was ALREADY named, so no new seat was filled and one stays open and unnamed.
    IF COALESCE(v_res ->> 'status', '') <> 'claimed'
       OR COALESCE((v_res ->> 'already')::boolean, false) THEN
      v_unclaimed := v_unclaimed || jsonb_build_object(
        'name',           v_guest ->> 'name',
        'email',          v_guest ->> 'email',
        'ticket_type_id', v_guest ->> 'ticket_type_id',
        'result',         v_res
      );
    END IF;
  END LOOP;

  -- Clear in the SAME transaction as the claims above.
  UPDATE public.event_registration_topups
  SET pending_roster = NULL
  WHERE id = p_topup_id;

  IF jsonb_array_length(v_unclaimed) > 0 THEN
    RAISE WARNING 'apply_topup_roster: % of % guests left UNNAMED for top-up %: %',
      jsonb_array_length(v_unclaimed), jsonb_array_length(v_roster), p_topup_id, v_unclaimed;
  END IF;

  RETURN jsonb_build_object('status', 'applied', 'unclaimed', v_unclaimed);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_topup_roster(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_topup_roster(uuid) TO service_role;

-- Same blindness on the original-checkout path. Signature stays `void` (its caller has no
-- decision to make and changing it would touch the main checkout flow), so the report goes
-- to the Postgres log only.
CREATE OR REPLACE FUNCTION public.apply_pending_roster(
  p_registration_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_roster    jsonb;
  v_guest     jsonb;
  v_res       jsonb;
  v_unclaimed jsonb := '[]'::jsonb;
BEGIN
  SELECT pending_roster INTO v_roster
  FROM public.event_registrations
  WHERE id = p_registration_id
  FOR UPDATE;

  IF v_roster IS NULL THEN
    RETURN;
  END IF;

  FOR v_guest IN SELECT * FROM jsonb_array_elements(v_roster)
  LOOP
    v_res := public.claim_ticket(
      p_registration_id,
      v_guest ->> 'name',
      v_guest ->> 'email',
      NULL, NULL, NULL, false, false,
      (v_guest ->> 'ticket_type_id')::uuid
    );
    IF COALESCE(v_res ->> 'status', '') <> 'claimed'
       OR COALESCE((v_res ->> 'already')::boolean, false) THEN
      v_unclaimed := v_unclaimed || jsonb_build_object(
        'name',           v_guest ->> 'name',
        'email',          v_guest ->> 'email',
        'ticket_type_id', v_guest ->> 'ticket_type_id',
        'result',         v_res
      );
    END IF;
  END LOOP;

  UPDATE public.event_registrations
  SET pending_roster = NULL
  WHERE id = p_registration_id;

  IF jsonb_array_length(v_unclaimed) > 0 THEN
    RAISE WARNING 'apply_pending_roster: % of % guests left UNNAMED for registration %: %',
      jsonb_array_length(v_unclaimed), jsonb_array_length(v_roster), p_registration_id, v_unclaimed;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_pending_roster(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_pending_roster(uuid) TO service_role;
