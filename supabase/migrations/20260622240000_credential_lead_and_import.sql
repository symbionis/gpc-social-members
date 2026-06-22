-- FEAT-41 follow-up — the lead's seeded ticket and admin-imported tickets must also
-- carry a QR credential (R1: every ticket is a QR). seed_lead_attendee and
-- import_event_attendees previously inserted credential-less 'claimed' rows, so the
-- lead (and any imported attendee) had no scannable QR. Generate a credential at
-- insert, and backfill any existing credential-less in-flight tickets (e.g. leads
-- seeded since the rename).

create or replace function public.seed_lead_attendee(p_registration_id uuid, p_phone_e164 text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
BEGIN
  INSERT INTO public.tickets
    (event_id, registration_id, member_id, name, email, phone_e164, is_lead,
     slot_status, ticket_type_id, credential_token)
  SELECT r.event_id, r.id, r.member_id, r.name, lower(trim(r.email)),
         COALESCE(p_phone_e164, r.phone_e164), true, 'claimed', r.lead_ticket_type_id,
         replace(replace(encode(extensions.gen_random_bytes(24), 'base64'), '+', '-'), '/', '_')
  FROM public.event_registrations r
  WHERE r.id = p_registration_id
    AND r.status IN ('paid', 'free')
    AND trim(COALESCE(r.name, '')) <> ''
    AND trim(COALESCE(r.email, '')) <> ''
    AND NOT EXISTS (
      SELECT 1 FROM public.tickets a
      WHERE a.registration_id = r.id AND a.is_lead = true
    );
END;
$function$;

create or replace function public.import_event_attendees(p_event_id uuid, p_rows jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_results jsonb := '[]'::jsonb;
  v_row     jsonb;
  v_index   integer := -1;
  v_name    text;
  v_email   text;
  v_phone   text;
  v_phone_match_id uuid;
  v_email_match_id uuid;
  v_match_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id) THEN
    RETURN jsonb_build_array(
      jsonb_build_object('index', 0, 'status', 'error', 'message', 'Event not found')
    );
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LOOP
    v_index := v_index + 1;

    v_name  := NULLIF(trim(COALESCE(v_row->>'name', '')), '');
    v_email := lower(NULLIF(trim(COALESCE(v_row->>'email', '')), ''));
    v_phone := NULLIF(trim(COALESCE(v_row->>'phone_e164', '')), '');

    IF v_email IS NULL AND v_phone IS NULL THEN
      v_results := v_results || jsonb_build_object(
        'index', v_index, 'status', 'error', 'message', 'No phone or email'
      );
      CONTINUE;
    END IF;

    IF v_name IS NULL THEN
      v_results := v_results || jsonb_build_object(
        'index', v_index, 'status', 'error', 'message', 'Name is required'
      );
      CONTINUE;
    END IF;

    BEGIN
      v_phone_match_id := NULL;
      v_email_match_id := NULL;

      IF v_phone IS NOT NULL THEN
        SELECT a.id INTO v_phone_match_id
        FROM public.tickets a
        WHERE a.event_id = p_event_id AND a.phone_e164 = v_phone
        ORDER BY a.created_at ASC, a.id ASC
        LIMIT 1;
      END IF;

      IF v_email IS NOT NULL THEN
        SELECT a.id INTO v_email_match_id
        FROM public.tickets a
        WHERE a.event_id = p_event_id AND lower(a.email) = v_email
        ORDER BY a.created_at ASC, a.id ASC
        LIMIT 1;
      END IF;

      IF v_phone_match_id IS NOT NULL AND v_email_match_id IS NOT NULL
         AND v_phone_match_id <> v_email_match_id THEN
        v_results := v_results || jsonb_build_object(
          'index', v_index, 'status', 'error',
          'message', 'Phone and email match different attendees'
        );
        CONTINUE;
      END IF;

      v_match_id := COALESCE(v_phone_match_id, v_email_match_id);

      IF v_match_id IS NOT NULL THEN
        UPDATE public.tickets
        SET
          email      = COALESCE(email, v_email),
          phone_e164 = COALESCE(phone_e164, v_phone)
        WHERE id = v_match_id;

        v_results := v_results || jsonb_build_object('index', v_index, 'status', 'merged');
      ELSE
        INSERT INTO public.tickets
          (event_id, name, email, phone_e164, is_lead, slot_status, credential_token)
        VALUES
          (p_event_id, v_name, v_email, v_phone, false, 'claimed',
           replace(replace(encode(extensions.gen_random_bytes(24), 'base64'), '+', '-'), '/', '_'));

        v_results := v_results || jsonb_build_object('index', v_index, 'status', 'inserted');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_results := v_results || jsonb_build_object(
        'index', v_index, 'status', 'error', 'message', SQLERRM
      );
    END;
  END LOOP;

  RETURN v_results;
END;
$function$;

-- Backfill: give every credential-less, non-released in-flight ticket a QR (leads
-- and imports created since the rename).
update public.tickets t
set credential_token =
      replace(replace(encode(extensions.gen_random_bytes(24), 'base64'), '+', '-'), '/', '_')
from public.event_registrations r
join public.events e on e.id = r.event_id
where t.registration_id = r.id
  and t.credential_token is null
  and t.released_at is null
  and r.status in ('paid', 'free')
  and coalesce(e.end_date, e.start_date) >= current_date;
