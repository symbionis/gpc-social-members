-- Admin bulk-import of attendees (U3): insert a collected roster for one event,
-- deduplicated against existing attendees, with per-row results.
--
-- For June 6 ops pastes a hand-collected guest list (name + phone/email) into the
-- admin import UI. The route (app/api/admin/events/[id]/attendees/import/route.ts)
-- parses + normalizes each row (lib/events/roster-import.ts parser, lib/phone.ts
-- toE164) and passes ALREADY-NORMALIZED rows here:
--   { name, email (lowercased or null), phone_e164 (E.164 or null) }
--
-- This function dedupes by normalized phone_e164 OR lower(email) within the event
-- (NO name matching — KTD10). On a match it ENRICHES the existing row (fills a NULL
-- phone or NULL email from the import) but NEVER overwrites a non-null contact, an
-- accepted waiver, or a recorded arrival (single-writer carry-through). Otherwise it
-- inserts a new claimed, non-lead attendee. Partial success: one bad row is reported
-- as 'error', it never aborts the batch.
--
-- This migration is ADDITIVE ONLY (a new function). NB: dev and prod share one
-- Supabase database, so applying this mutates production immediately; nothing calls
-- it until the cutover code ships. DEPLOY ORDERING: apply after
-- 20260603120000_event_attendees (it inserts into / reads event_attendees).
-- SECURITY DEFINER + REVOKE/GRANT mirrors 20260526131000_event_write_rpcs.sql:
-- callable only by the service_role the app uses (createAdminClient), never anon/auth.

CREATE OR REPLACE FUNCTION public.import_event_attendees(
  p_event_id uuid,
  p_rows     jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_results jsonb := '[]'::jsonb;
  v_row     jsonb;
  v_index   integer := -1;
  v_name    text;
  v_email   text;
  v_phone   text;
  v_match   public.event_attendees%ROWTYPE;
BEGIN
  -- Validate the event exists; if not, return a single error marker rather than
  -- raising, so the route can surface it cleanly.
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id) THEN
    RETURN jsonb_build_array(
      jsonb_build_object('index', 0, 'status', 'error', 'message', 'Event not found')
    );
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LOOP
    v_index := v_index + 1;

    -- Normalize the row's fields. NULLIF('' -> NULL) so an empty string is treated
    -- as absent and the email-lower / contact CHECKs are honored.
    v_name  := NULLIF(trim(COALESCE(v_row->>'name', '')), '');
    v_email := lower(NULLIF(trim(COALESCE(v_row->>'email', '')), ''));
    v_phone := NULLIF(trim(COALESCE(v_row->>'phone_e164', '')), '');

    -- A row with neither contact can't live in (or match) the roster.
    IF v_email IS NULL AND v_phone IS NULL THEN
      v_results := v_results || jsonb_build_object(
        'index', v_index, 'status', 'error', 'message', 'No phone or email'
      );
      CONTINUE;
    END IF;

    -- Each row is its own savepoint: a single failure is reported, not fatal.
    BEGIN
      -- Dedupe by phone_e164 OR lower(email) within the event (earliest-created
      -- wins, matching the door's deterministic resolution). No name matching.
      SELECT a.* INTO v_match
      FROM public.event_attendees a
      WHERE a.event_id = p_event_id
        AND (
          (v_phone IS NOT NULL AND a.phone_e164 = v_phone)
          OR (v_email IS NOT NULL AND lower(a.email) = v_email)
        )
      ORDER BY a.created_at ASC, a.id ASC
      LIMIT 1;

      IF FOUND THEN
        -- Enrich: only fill a NULL contact from the import. Never overwrite an
        -- existing non-null email/phone, waiver, or arrival.
        UPDATE public.event_attendees
        SET
          email      = COALESCE(email, v_email),
          phone_e164 = COALESCE(phone_e164, v_phone)
        WHERE id = v_match.id;

        v_results := v_results || jsonb_build_object(
          'index', v_index, 'status', 'merged'
        );
      ELSE
        INSERT INTO public.event_attendees
          (event_id, name, email, phone_e164, is_lead, slot_status)
        VALUES
          (p_event_id, v_name, v_email, v_phone, false, 'claimed');

        v_results := v_results || jsonb_build_object(
          'index', v_index, 'status', 'inserted'
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_results := v_results || jsonb_build_object(
        'index', v_index, 'status', 'error', 'message', SQLERRM
      );
    END;
  END LOOP;

  RETURN v_results;
END;
$$;

-- Writes the RLS-protected event_attendees table and bypasses RLS — restrict to the
-- service_role the app uses. Never callable by anon/authenticated.
REVOKE ALL ON FUNCTION public.import_event_attendees(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_event_attendees(uuid, jsonb) TO service_role;
