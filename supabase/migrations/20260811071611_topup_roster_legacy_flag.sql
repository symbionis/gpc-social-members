-- Make the legacy-roster fallback self-expiring, and state the lock invariant it rests on.
--
-- apply_topup_roster returned a bare 'no_roster' for three different situations: a top-up
-- staged before per-top-up rosters existed (the ONLY one the webhook's fallback is for), a
-- redelivery whose roster already applied and cleared, and a row that staged nothing. The
-- webhook treated all three as "legacy" and re-ran the registration-level apply.
--
-- That is benign today only because event_registrations.pending_roster is single-producer
-- again and is already NULL on a paid registration. But it is not NULL in one real state:
-- a first delivery that set 'paid' and then crashed before applying leaves it set, and that
-- is exactly the state the paid short-circuit exists to recover. A top-up redelivery landing
-- in that window would consume the ORIGINAL booking's names early. The outcome is harmless
-- (all the slots involved are interchangeable unnamed seats on one registration) — but it is
-- harmless by luck, and "harmless by luck" is what this whole change is about not shipping.
--
-- So say which case it is. `legacy` is true only for rows created before per-top-up rosters
-- existed, which makes the webhook's fallback provably dead after the retry window rather
-- than something a future reader has to reason about. No new column: created_at already
-- carries the answer.
--
-- APPLIED to production 2026-08-11, then exercised in a rolled-back transaction (the
-- DO-block pattern in docs/solutions/best-practices/verify-security-definer-rpc-do-block-rollback.md).
-- ALL_PASS on three assertions: a pre-migration top-up returns legacy:true, a post-migration
-- one returns legacy:false, and an unknown id still returns not_found.

CREATE OR REPLACE FUNCTION public.apply_topup_roster(
  p_topup_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- The instant per-top-up rosters shipped (migration 20260811064034). A top-up row created
  -- before this could only have staged its names on the registration.
  c_legacy_before constant timestamptz := '2026-08-11 06:40:34+00';
  v_reg_id     uuid;
  v_created_at timestamptz;
  v_roster     jsonb;
  v_guest      jsonb;
  v_res        jsonb;
  v_unclaimed  jsonb := '[]'::jsonb;
BEGIN
  SELECT registration_id, created_at INTO v_reg_id, v_created_at
  FROM public.event_registration_topups
  WHERE id = p_topup_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  -- Lock the PARENT registration, not the top-up row. claim_ticket takes exactly this lock
  -- as its first statement, so holding it here is what serializes this apply against
  -- concurrent claims and against a second delivery of this same top-up.
  --
  -- LOCK ORDER, and it is load-bearing: apply_registration_topup takes the TOP-UP row first
  -- and then the registration, i.e. the opposite order. No cycle is reachable today, because
  -- apply_topup_roster only ever runs after apply_registration_topup has committed, and a
  -- concurrent call on that row returns at its status = 'applied' check before it ever asks
  -- for the registration lock. Anything added AFTER that status check would open a real
  -- deadlock, and the loser would be this function.
  PERFORM 1 FROM public.event_registrations WHERE id = v_reg_id FOR UPDATE;

  -- Re-read under the lock — a concurrent redelivery may have cleared it.
  SELECT pending_roster INTO v_roster
  FROM public.event_registration_topups
  WHERE id = p_topup_id;

  IF v_roster IS NULL THEN
    -- `legacy` distinguishes "this top-up predates per-top-up rosters, so its names are on
    -- the registration" from "already applied and cleared", which needs no fallback at all.
    RETURN jsonb_build_object(
      'status', 'no_roster',
      'legacy', v_created_at < c_legacy_before
    );
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
