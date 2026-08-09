-- SECURITY — revoke anon/authenticated EXECUTE on the last four SECURITY DEFINER
-- functions that still had it.
--
-- Supabase advisors `anon_security_definer_function_executable` and
-- `authenticated_security_definer_function_executable`. Postgres grants EXECUTE to
-- PUBLIC by default on new functions, so any SECURITY DEFINER function whose
-- migration never revoked it stays callable with the public anon key — and being
-- SECURITY DEFINER, it runs as the owner and bypasses RLS entirely.
--
-- 15 of the 19 SECURITY DEFINER functions in `public` were already locked down.
-- These four were missed:
--
--   create_event_with_ticket_types   anon could create real events
--   create_event_registration        anon could create registrations / consume seats
--   seats_used                       seat-count read
--   seats_used_by_events             seat-count read
--
-- Confirmed reachable, not just granted in the catalog: calling seats_used over
-- PostgREST with the public anon key returned a live count on 2026-08-09.
--
-- SAFE TO REVOKE: every caller of all four goes through the service-role admin
-- client (lib/supabase/admin.ts), which is unaffected by these grants. Verified
-- exhaustively — all 21 .rpc() call sites in the app, all 11 callers of the
-- lib/events/seat-usage.ts helpers (which take an injected client), the public
-- token-based booking routes, the door console, and the check-in pages. No
-- .rpc() call sits in a "use client" component, and there are no Edge Functions.
--
-- Mirrors the pattern and the comment already established by
-- 20260708120000_ticket_type_conversions.sql: revoking FROM PUBLIC alone is not
-- enough on Supabase, since anon and authenticated hold the grant directly.
--
-- SHARED DEV/PROD DATABASE: applies to production immediately. Permission-only,
-- no schema or data change, and safe to apply independently of any deploy.

revoke all on function public.create_event_with_ticket_types(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_event_with_ticket_types(jsonb, jsonb)
  to service_role;

revoke all on function public.create_event_registration(
  uuid, text, text, boolean, uuid, text, text, timestamptz, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.create_event_registration(
  uuid, text, text, boolean, uuid, text, text, timestamptz, uuid, jsonb
) to service_role;

revoke all on function public.seats_used(uuid) from public, anon, authenticated;
grant execute on function public.seats_used(uuid) to service_role;

revoke all on function public.seats_used_by_events(uuid[]) from public, anon, authenticated;
grant execute on function public.seats_used_by_events(uuid[]) to service_role;

-- Guard: fail loudly if any SECURITY DEFINER function in `public` is still
-- anon-executable, so this class of gap cannot silently reappear.
do $$
declare
  offending text;
begin
  select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ')
    into offending
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and has_function_privilege('anon', p.oid, 'EXECUTE');

  if offending is not null then
    raise exception
      'SECURITY DEFINER functions still executable by anon: %', offending;
  end if;
end $$;
