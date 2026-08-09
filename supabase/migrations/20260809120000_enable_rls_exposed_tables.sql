-- SECURITY / CRITICAL — close four publicly readable+writable tables.
--
-- Supabase advisor `rls_disabled_in_public` flagged this. Confirmed against production
-- on 2026-08-09 via pg_class.relrowsecurity — these four had RLS off:
--
--     broadcast_recipients   3229 rows   member email addresses
--     event_reminder_sends    584 rows   per-member send log
--     broadcasts               45 rows   message bodies
--     event_waitlist           21 rows   name/contact of waitlisted people
--
-- Every one of them grants DELETE/INSERT/SELECT/UPDATE to both `anon` and
-- `authenticated` (the Supabase default), so with RLS off there was no gate at all:
-- anyone holding the project URL and the public anon key could read, modify or delete
-- all rows. broadcast_recipients is the severe one — it is the full member mailing list.
--
-- NOT included, deliberately: membership_tiers and seasons already have RLS enabled
-- with an intentional "publicly readable" SELECT policy (USING true, role public).
-- RLS-on with no UPDATE/DELETE policy already denies writes on those two, so they need
-- no change here. (An earlier probe of this migration's scope appeared to show them
-- writable; that was a false positive — a zero-match DELETE returns 204 whether RLS
-- blocks it or simply matches no rows.)
--
-- WHY NO POLICIES: every application query against these four tables goes through the
-- service-role admin client (lib/supabase/admin.ts), which bypasses RLS. Traced all
-- call sites — including files that also construct an SSR anon client
-- (app/(admin)/admin/messages/*, app/api/admin/events/[id]/waitlist/convert) — in every
-- case the receiver is `adminClient`, or a local named `supabase` assigned from
-- createAdminClient(). No browser-client (anon) read path exists for any of them. So
-- RLS-on with zero policies is deny-all for anon/authenticated and a no-op for the app.
-- Mirrors the convention already used by event_registration_topups and
-- event_ticket_type_conversions.
--
-- SHARED DEV/PROD DATABASE: this applies to production immediately. It is a permission
-- tightening with no schema or data change, and is safe to apply independently of any
-- deploy — there is no accompanying code change.

alter table public.broadcast_recipients enable row level security;
alter table public.event_reminder_sends enable row level security;
alter table public.broadcasts           enable row level security;
alter table public.event_waitlist       enable row level security;

-- Guard: RLS was disabled on these tables, so any policy defined on them until now was
-- inert. Enabling RLS activates them. Fail loudly if one would still expose the table
-- to anon/authenticated, rather than leaving the hole open behind an "RLS enabled" badge.
do $$
declare
  offending text;
begin
  select string_agg(format('%s.%s (roles: %s)', tablename, policyname, roles::text), ', ')
    into offending
  from pg_policies
  where schemaname = 'public'
    and tablename in (
      'broadcast_recipients', 'event_reminder_sends', 'broadcasts', 'event_waitlist'
    )
    and (roles && array['anon', 'authenticated', 'public']::name[]);

  if offending is not null then
    raise exception
      'RLS enabled but pre-existing policies still expose these tables to anon/authenticated: %',
      offending;
  end if;
end $$;
