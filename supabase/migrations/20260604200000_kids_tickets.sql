-- Children's tickets (U13): pre-register kids by name, no contact, linked to the party.
--
-- A child has no email/phone and can't self-check-in at the strict door — they
-- arrive with an adult. We mark a ticket type as a children's type (is_child) so the
-- self-reg form offers an "Add children (name only)" control, the contact CHECK is
-- waived for those rows, and they skip the waiver. Children attach to the party
-- (Option A — no per-guardian link); capacity is the existing per-type cap.
--
-- ADDITIVE (nullable→defaulted columns, widened CHECK, new RPC). NB: dev and prod
-- share one Supabase database, so applying this mutates production immediately.

-- 1. Flags.
ALTER TABLE public.event_ticket_types
  ADD COLUMN IF NOT EXISTS is_child boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.event_ticket_types.is_child IS
  'A children''s ticket: attendees of this type self-register by name only (no '
  'contact), skip the waiver, and are checked in via their accompanying adult.';

ALTER TABLE public.event_attendees
  ADD COLUMN IF NOT EXISTS is_child boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.event_attendees.is_child IS
  'This attendee holds a children''s ticket — name-only, contactless, no waiver.';

-- 2. Backfill: any existing kids ticket type + its attendees.
UPDATE public.event_ticket_types
  SET is_child = true
  WHERE is_child = false AND title ~* '(kid|child|enfant)';

UPDATE public.event_attendees a
  SET is_child = true
  FROM public.event_ticket_types tt
  WHERE a.ticket_type_id = tt.id AND tt.is_child AND a.is_child = false;

-- 3. Widen the contact CHECK: a contactless row is also allowed when it's a child.
ALTER TABLE public.event_attendees
  DROP CONSTRAINT IF EXISTS event_attendees_contact_present;
ALTER TABLE public.event_attendees
  ADD CONSTRAINT event_attendees_contact_present CHECK (
    slot_status = 'unclaimed'
    OR email IS NOT NULL
    OR phone_e164 IS NOT NULL
    OR checked_in_at IS NOT NULL
    OR is_child = true
  );

-- 4. Carry is_child through event creation (the edit path normalizes it separately).
CREATE OR REPLACE FUNCTION public.create_event_with_ticket_types(
  p_event jsonb,
  p_types jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  INSERT INTO public.events (
    title, event_type_id, start_date, end_date, start_time, location,
    description, is_confirmed, is_published, notes, season_id,
    image_url, image_url_2, images, visibility, registration_enabled,
    reminder_schedule
  )
  VALUES (
    p_event->>'title',
    NULLIF(p_event->>'event_type_id', '')::uuid,
    (p_event->>'start_date')::date,
    NULLIF(p_event->>'end_date', '')::date,
    NULLIF(p_event->>'start_time', ''),
    NULLIF(p_event->>'location', ''),
    NULLIF(p_event->>'description', ''),
    COALESCE((p_event->>'is_confirmed')::boolean, false),
    COALESCE((p_event->>'is_published')::boolean, false),
    NULLIF(p_event->>'notes', ''),
    NULLIF(p_event->>'season_id', '')::uuid,
    NULLIF(p_event->>'image_url', ''),
    NULLIF(p_event->>'image_url_2', ''),
    COALESCE(p_event->'images', '[]'::jsonb),
    COALESCE(p_event->>'visibility', 'members_only'),
    COALESCE((p_event->>'registration_enabled')::boolean, false),
    COALESCE(p_event->'reminder_schedule', '[]'::jsonb)
  )
  RETURNING id INTO v_event_id;

  INSERT INTO public.event_ticket_types
    (event_id, title, price_member, price_non_member, invite_price, counts_as_seat, is_child, sort_order)
  SELECT
    v_event_id,
    t->>'title',
    NULLIF(t->>'price_member', '')::numeric,
    NULLIF(t->>'price_non_member', '')::numeric,
    NULLIF(t->>'invite_price', '')::numeric,
    COALESCE((t->>'counts_as_seat')::boolean, true),
    COALESCE((t->>'is_child')::boolean, false),
    COALESCE((t->>'sort_order')::integer, 0)
  FROM jsonb_array_elements(p_types) AS t;

  RETURN v_event_id;
END;
$$;

-- 5. Add name-only children to a party via its self-reg token. Locks the
-- registration row so the per-type cap (purchased − claimed of the child type) is
-- race-safe; inserts up to the remaining allotment, skipping blank names. The party
-- must have exactly one children's ticket type (the common case).
CREATE OR REPLACE FUNCTION public.add_self_registration_children(
  p_token text,
  p_names text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg         record;
  v_child_count integer;
  v_child_type  uuid;
  v_purchased   integer;
  v_claimed     integer;
  v_remaining   integer;
  v_added       integer := 0;
  v_name        text;
  v_clean       text;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  SELECT id, event_id, status INTO v_reg
  FROM public.event_registrations
  WHERE self_reg_token = p_token
  FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  IF v_reg.status NOT IN ('paid', 'free') THEN
    RETURN jsonb_build_object('status', 'inactive');
  END IF;

  SELECT count(DISTINCT ri.ticket_type_id),
         (array_agg(DISTINCT ri.ticket_type_id))[1]
    INTO v_child_count, v_child_type
  FROM public.event_registration_items ri
  JOIN public.event_ticket_types tt ON tt.id = ri.ticket_type_id
  WHERE ri.registration_id = v_reg.id AND tt.is_child;

  IF v_child_count = 0 THEN
    RETURN jsonb_build_object('status', 'no_child_tickets', 'added', 0);
  END IF;
  IF v_child_count > 1 THEN
    RETURN jsonb_build_object('status', 'multiple_child_types', 'added', 0);
  END IF;

  SELECT COALESCE(sum(quantity), 0) INTO v_purchased
  FROM public.event_registration_items
  WHERE registration_id = v_reg.id AND ticket_type_id = v_child_type;

  SELECT count(*) INTO v_claimed
  FROM public.event_attendees
  WHERE registration_id = v_reg.id AND slot_status = 'claimed'
    AND released_at IS NULL AND ticket_type_id = v_child_type;

  v_remaining := v_purchased - v_claimed;
  IF v_remaining <= 0 THEN
    RETURN jsonb_build_object('status', 'full', 'added', 0);
  END IF;

  FOREACH v_name IN ARRAY COALESCE(p_names, ARRAY[]::text[]) LOOP
    EXIT WHEN v_added >= v_remaining;
    v_clean := NULLIF(trim(v_name), '');
    IF v_clean IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.event_attendees
      (event_id, registration_id, name, is_lead, slot_status, ticket_type_id, is_child)
    VALUES
      (v_reg.event_id, v_reg.id, v_clean, false, 'claimed', v_child_type, true);
    v_added := v_added + 1;
  END LOOP;

  RETURN jsonb_build_object('status', 'ok', 'added', v_added,
                            'remaining', v_remaining - v_added);
END;
$$;

REVOKE ALL ON FUNCTION public.add_self_registration_children(text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_self_registration_children(text, text[]) TO service_role;
