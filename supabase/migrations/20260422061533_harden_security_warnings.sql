-- RECOVERED 2026-08-10 from supabase_migrations.schema_migrations (statements column).
-- Applied 2026-04-22, never committed. Recorded version stamp preserved, so
-- `db push` treats it as already applied and will not re-run it.

alter function public.generate_member_number() set search_path = public;
alter function public.update_updated_at() set search_path = public;

drop policy if exists "Service role full access" on public.payment_retry_tokens;

drop policy if exists "Public read access for event images" on storage.objects;
drop policy if exists "Profile photos are publicly readable" on storage.objects;
